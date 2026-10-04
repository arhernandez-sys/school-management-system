"""In-process, per-client-IP throttling for the unauthenticated auth endpoints.

WHY THIS EXISTS
───────────────────────────────────────────────────────────────────────────────
`auth/service.py` already locks an ACCOUNT after N failed passwords (FR-AUTH-07),
which stops someone grinding one victim's password. It does nothing about the
inverse attack, which is the one that actually works against a school directory:
spray ONE likely password (`Belize2026!`) across every account in turn. Each
account sees a single failure, no lock ever trips, and the attempt log grows a row
per guess. `/auth/refresh` had no throttle of any kind — a forged cookie could be
retried forever. `RateLimited` (429) and its OpenAPI declaration on both routes
existed already; nothing raised it. This module is what raises it.

Denying BEFORE the service call also caps the `login_attempts` write amplification
called out in OQ-DB6: an unknown-identifier miss inserts a row, and an unthrottled
sprayer can therefore grow that table as fast as it can open sockets.

WHAT IS COUNTED — FAILURES, NOT REQUESTS
───────────────────────────────────────────────────────────────────────────────
The counters are incremented by `penalize()` only after an attempt is REJECTED.
A school has one NAT egress address, so counting every request would throttle the
whole campus at the 8am bell while adding nothing against the threat: password
spraying and refresh-cookie brute force are made entirely of failures. Successful
authentication costs a client nothing here.

LIMITATION — THIS IS PER-PROCESS, AND THAT IS NOT A DETAIL
───────────────────────────────────────────────────────────────────────────────
State lives in this process's memory. Anyone scaling this deployment must know:

  * Run it with more than ONE worker (`uvicorn --workers N`, gunicorn, multiple
    containers, any autoscaler) and each worker keeps its OWN counters, so the
    EFFECTIVE limit becomes `N x` the configured value and an attacker whose
    connections land round-robin gets N times the budget.
  * A restart or redeploy clears every counter.
  * A per-IP flood large enough to exceed `RATE_LIMIT_MAX_TRACKED_KEYS` starts
    evicting the least-recently-seen keys (see below), so a distributed attack
    degrades this from a limiter into a nuisance.

That is an accepted trade-off for a single-instance modular monolith serving one
school, and it buys a hard dependency-free implementation. The moment a second
instance is introduced, replace the storage here with a shared counter (Redis
`INCR` + `EXPIRE`, or the reverse proxy's own limiter) — the `guard()`/`penalize()`
call sites in `auth/router.py` are the only thing that would need to keep working.

ALGORITHM
───────────────────────────────────────────────────────────────────────────────
Fixed window per key: the first failure in a window starts a `window_seconds`
clock, subsequent failures increment, and the whole thing resets once the window
lapses. A sliding-log limiter would be smoother at a boundary but stores one
timestamp per event — the fixed window stores two floats and an int per key, which
is what makes the memory bound trivially provable. `retry_after_seconds` reports
the exact time remaining in the current window, so the SPA can re-enable its
controls at the right moment instead of guessing.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

from app.config import Settings
from app.core.errors import RateLimited

logger = logging.getLogger("sis.ratelimit")

#: How often the limiter walks its whole map dropping lapsed windows. Sweeping on
#: every call would be O(n) per request; sweeping never would let keys that are
#: seen once and abandoned sit until the LRU ceiling evicts them. Once a minute is
#: cheap (n <= max_keys) and keeps steady-state memory near the ACTIVE key count.
_SWEEP_INTERVAL_SECONDS = 60.0


@dataclass(frozen=True, slots=True)
class RateLimitPolicy:
    """One endpoint's throttle, resolved from settings.

    `scope` namespaces the key so /login and /refresh budgets are independent for
    the same IP; `enabled` is carried on the policy so every call site is a single
    unconditional call rather than a scattered `if settings.rate_limit_enabled`.
    """

    scope: str
    limit: int
    window_seconds: int
    enabled: bool
    message: str


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    #: Seconds until the current window lapses. 0 when allowed.
    retry_after_seconds: int
    #: Failures already recorded in the current window.
    count: int


@dataclass(slots=True)
class _Bucket:
    window_start: float  # time.monotonic() at the first failure of the window
    window_seconds: float
    count: int


class FixedWindowRateLimiter:
    """Thread-safe, memory-bounded fixed-window counter.

    Thread safety is required, not optional: the auth endpoints are `def` (not
    `async def`), so Starlette runs them in a threadpool and several can touch the
    same key concurrently.

    Uses `time.monotonic()` rather than wall time so an NTP correction or a DST
    change cannot retroactively extend or erase a window.
    """

    def __init__(self, *, max_keys: int = 10_000) -> None:
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()
        self._lock = threading.Lock()
        self._max_keys = max(1, max_keys)
        self._last_sweep = time.monotonic()

    # ── configuration ────────────────────────────────────────────────────────
    def configure(self, *, max_keys: int) -> None:
        """Apply the settings-driven ceiling. Called once from the app factory."""
        with self._lock:
            self._max_keys = max(1, max_keys)
            self._evict_locked()

    # ── queries ──────────────────────────────────────────────────────────────
    def check(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        """Would another attempt from `key` be allowed? Does NOT count anything.

        Read-only on purpose: the caller counts a failure via `penalize()` only
        once the attempt has actually been rejected, so a legitimate user is never
        charged for succeeding.
        """
        now = time.monotonic()
        with self._lock:
            self._maybe_sweep_locked(now)
            bucket = self._buckets.get(key)
            if bucket is None or now - bucket.window_start >= bucket.window_seconds:
                return RateLimitDecision(allowed=True, retry_after_seconds=0, count=0)
            self._buckets.move_to_end(key)
            if bucket.count < limit:
                return RateLimitDecision(
                    allowed=True, retry_after_seconds=0, count=bucket.count
                )
            remaining = bucket.window_start + bucket.window_seconds - now
            # Round UP (ceil, not int()+1): telling a client to retry at the exact
            # boundary invites an immediate second 429 from sub-second skew, while
            # int()+1 would over-report by a whole second and could exceed the
            # window itself. Floor of 1s so the value is never 0 or negative.
            return RateLimitDecision(
                allowed=False,
                retry_after_seconds=max(1, math.ceil(remaining)),
                count=bucket.count,
            )

    def record(self, key: str, *, window_seconds: int) -> None:
        """Count one failure against `key`, starting a window if none is open.

        Recording while ALREADY over the limit deliberately does not push the
        window start forward, so `retry_after_seconds` keeps counting down toward
        a real reset instead of receding forever.
        """
        now = time.monotonic()
        with self._lock:
            self._maybe_sweep_locked(now)
            bucket = self._buckets.get(key)
            if bucket is None or now - bucket.window_start >= bucket.window_seconds:
                bucket = _Bucket(
                    window_start=now, window_seconds=float(window_seconds), count=0
                )
                self._buckets[key] = bucket
            bucket.count += 1
            self._buckets.move_to_end(key)
            self._evict_locked()

    # ── housekeeping ─────────────────────────────────────────────────────────
    def _maybe_sweep_locked(self, now: float) -> None:
        if now - self._last_sweep < _SWEEP_INTERVAL_SECONDS:
            return
        self._last_sweep = now
        expired = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.window_start >= bucket.window_seconds
        ]
        for key in expired:
            del self._buckets[key]

    def _evict_locked(self) -> None:
        """Enforce the hard ceiling by dropping least-recently-seen keys.

        This is the memory bound. It fails OPEN for the evicted key (its history
        is forgotten, so it gets a fresh budget) — the alternative, refusing to
        track new keys, would fail open for every NEW client instead, which is
        strictly worse since a flood is made of new keys.
        """
        while len(self._buckets) > self._max_keys:
            self._buckets.popitem(last=False)

    # ── test/introspection helpers ───────────────────────────────────────────
    def reset(self) -> None:
        """Drop all state. Used by the test harness between cases."""
        with self._lock:
            self._buckets.clear()
            self._last_sweep = time.monotonic()

    def __len__(self) -> int:
        with self._lock:
            return len(self._buckets)


# ── Process-wide singleton ──────────────────────────────────────────────────────
# One limiter shared by both scopes so `max_keys` bounds TOTAL memory rather than
# per-endpoint memory; scopes stay independent via the key prefix.
_LIMITER = FixedWindowRateLimiter()


def get_limiter() -> FixedWindowRateLimiter:
    return _LIMITER


def configure(settings: Settings) -> None:
    """Apply settings to the singleton. Called from `create_app`."""
    _LIMITER.configure(max_keys=settings.rate_limit_max_tracked_keys)


# ── Policies (the settings → policy mapping lives here, not in the router) ──────
_LOGIN_MESSAGE = "Too many failed sign-in attempts from this network. Try again shortly."
_REFRESH_MESSAGE = "Too many failed session refreshes from this network. Try again shortly."


def login_policy(settings: Settings) -> RateLimitPolicy:
    return RateLimitPolicy(
        scope="login",
        limit=settings.rate_limit_login_max_failures,
        window_seconds=settings.rate_limit_login_window,
        enabled=settings.rate_limit_enabled,
        message=_LOGIN_MESSAGE,
    )


def refresh_policy(settings: Settings) -> RateLimitPolicy:
    return RateLimitPolicy(
        scope="refresh",
        limit=settings.rate_limit_refresh_max_failures,
        window_seconds=settings.rate_limit_refresh_window,
        enabled=settings.rate_limit_enabled,
        message=_REFRESH_MESSAGE,
    )


# ── Call-site API ───────────────────────────────────────────────────────────────
def guard(policy: RateLimitPolicy, key: str) -> None:
    """Raise `RateLimited` (429) if `key` is over `policy`. Otherwise return.

    The error body carries `retry_after_seconds` exactly as the 423 lockout in
    `auth/service.py` does, so the SPA has ONE field to read for "when may I
    re-enable the button" regardless of which throttle it hit. The standard
    `Retry-After` header is set alongside it for proxies and non-browser clients;
    it is in the CORS `expose_headers` list so cross-origin JS can read it too.
    """
    if not policy.enabled:
        return
    decision = _LIMITER.check(
        f"{policy.scope}:{key}",
        limit=policy.limit,
        window_seconds=policy.window_seconds,
    )
    if decision.allowed:
        return
    # A security-relevant event: log it so a spray is visible without a debugger.
    # The IP is already recorded in `login_attempts`, so this adds no new exposure.
    logger.warning(
        "rate_limited scope=%s client=%s failures=%s limit=%s retry_after=%s",
        policy.scope,
        key,
        decision.count,
        policy.limit,
        decision.retry_after_seconds,
    )
    raise RateLimited(
        policy.message,
        extra={
            "retry_after_seconds": decision.retry_after_seconds,
            "window_seconds": policy.window_seconds,
        },
        headers={"Retry-After": str(decision.retry_after_seconds)},
    )


def penalize(policy: RateLimitPolicy, key: str) -> None:
    """Charge one failed attempt against `key`. Never raises."""
    if not policy.enabled:
        return
    _LIMITER.record(f"{policy.scope}:{key}", window_seconds=policy.window_seconds)

"""Application configuration (architecture.md §8.4).

Pydantic-settings reads 12-factor env vars. Sensible local defaults are provided
so the app constructs without a fully-populated .env, but security-critical values
(JWT_SECRET, DATABASE_URL) are guarded against shipping a default to non-local
environments — see `validate_runtime()`, which the app factory calls before the
server binds a port.

Every knob added by the production-hardening pass (rate limiting, trusted
proxies, security headers, connection pool, retention windows) is env-driven with
a working local default, because the deployment target is deliberately undecided:
the same image must run self-hosted behind nginx/Caddy or on a PaaS with no
reverse proxy at all.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT_SECRET = "change-me-in-prod-use-a-32+-byte-random-secret"

#: The developer-convenience DATABASE_URL baked in below. Exported because two
#: other places need to recognise "this is the default, not a real database":
#: `validate_runtime()` (refuses it outside `local`) and `tests/conftest.py`
#: (treats it as "no test DB configured" and skips cleanly). Keeping ONE constant
#: means the test guard can never drift out of sync with the default again.
LOCAL_DEFAULT_DATABASE_URL = "mysql+pymysql://sis:sis@127.0.0.1:3306/sims"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Database ──────────────────────────────────────────────────────────────
    # NOTE: a password containing reserved characters MUST be URL-encoded here
    # (`@` → `%40`, `#` → `%23`, `/` → `%2F`). Both `alembic/env.py` and
    # `tests/conftest.py` pass this value through verbatim without decoding it.
    database_url: str = LOCAL_DEFAULT_DATABASE_URL

    # ── Database connection pool ──────────────────────────────────────────────
    # Sync endpoints run in Starlette's threadpool (40 threads by default), so up
    # to 40 requests can want a connection at once; 10 + 20 overflow = 30 covers
    # realistic concurrency for one school without approaching MariaDB's default
    # `max_connections` (151) even with a couple of app processes.
    db_pool_size: int = 10
    db_max_overflow: int = 20
    # MariaDB closes idle connections after `wait_timeout` (default 28800s = 8h)
    # and a self-hosted my.cnf often lowers it to 600s. Recycling every 30 min
    # keeps us comfortably under both, so `pool_pre_ping` almost never has to
    # discover a dead socket the hard way (pre_ping stays on as the backstop).
    db_pool_recycle: int = 1800
    # How long a request waits for a free pooled connection before failing fast
    # rather than piling up. 30s is SQLAlchemy's own default, restated so it is
    # tunable without a code change.
    db_pool_timeout: int = 30

    # ── JWT / tokens ──────────────────────────────────────────────────────────
    jwt_secret: str = _INSECURE_DEFAULT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_access_ttl: int = 900  # 15 min
    jwt_refresh_ttl: int = 604_800  # 7 days

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Stored as a raw string and split, so a single comma-separated env var works.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # ── Auth policy ───────────────────────────────────────────────────────────
    lockout_threshold: int = 5
    lockout_duration: int = 900  # seconds locked once threshold hit
    session_idle_timeout: int = 1800  # FR-AUTH-10 idle window (seconds)
    password_min_length: int = 10

    # ── Argon2id parameters ───────────────────────────────────────────────────
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65_536  # KiB
    argon2_parallelism: int = 4

    # ── Reverse proxy / client IP (app/core/net.py) ───────────────────────────
    # Comma-separated IPs or CIDRs of reverse proxies we are willing to believe.
    # EMPTY BY DEFAULT and that is the safe posture: with no trusted proxy,
    # `X-Forwarded-For` is ignored entirely and the recorded/limited address is
    # always the real TCP peer. Only populate this once a proxy actually fronts
    # the app, because anything listed here can dictate the client IP the rate
    # limiter and the `login_attempts` audit trail see.
    trusted_proxies: str = ""

    # ── Security headers / host allow-list (app/core/security_headers.py) ─────
    # HSTS lifetime in seconds. Sent ONLY when environment != local (see
    # `hsts_enabled`) because advertising HSTS over plain http is meaningless and
    # pinning `localhost` to https breaks every other local project on the box.
    # One year is the value the preload list expects; drop it to a few hours for
    # the first days of a new TLS rollout, since HSTS cannot be un-sent from a
    # browser that already cached it.
    hsts_max_age: int = 31_536_000
    # Comma-separated Host header allow-list. "*" disables the check (the local
    # default). Set it in production to defeat Host-header poisoning.
    trusted_hosts: str = "*"

    # ── Rate limiting (app/core/ratelimit.py) ─────────────────────────────────
    # Master switch — set false to disable entirely (the test harness does).
    rate_limit_enabled: bool = True
    # The counters below track FAILED attempts per client IP, not total requests.
    # That choice is deliberate: a school sits behind one NAT egress address, so
    # counting successful logins would throttle the whole campus at the 8am bell
    # while doing nothing extra against the actual threat. The abuse we are
    # blocking — spraying one password across many accounts, or hammering
    # /auth/refresh with forged cookies — is made of failures by definition.
    #
    # 30 failures / 5 min from ONE address is already far outside normal typo
    # behaviour yet leaves room for a shared-IP campus; raise it if a large site
    # sees spurious 429s, lower it for a single-tenant deployment.
    rate_limit_login_max_failures: int = 30
    rate_limit_login_window: int = 300
    # Refresh failures are rarer for legitimate clients: the SPA stops retrying
    # and redirects to login on the first 401, so a healthy browser produces at
    # most one. 60 / 5 min leaves generous headroom for a NAT'd campus while
    # still capping a brute-force at ~17k/day instead of unbounded.
    rate_limit_refresh_max_failures: int = 60
    rate_limit_refresh_window: int = 300
    # Hard cap on tracked keys. An unbounded dict keyed by client IP is itself a
    # DoS (a spoofed/distributed flood would grow it without limit), so the
    # limiter evicts least-recently-seen keys past this ceiling. ~10k keys is a
    # couple of MB and far more addresses than a school will ever see.
    rate_limit_max_tracked_keys: int = 10_000

    # ── Retention / purge job (app/jobs/purge.py, OQ-DB6) ─────────────────────
    # Windows for `python -m app.jobs.purge`. Nothing runs this automatically —
    # scheduling is the deploy target's job and the target is undecided.
    retention_login_attempts_days: int = 90
    retention_audit_log_days: int = 365
    # Expired refresh sessions are useless to the app the moment they lapse, but
    # keeping a week of them lets "which device held this session" be answered
    # after an incident is noticed.
    retention_refresh_session_grace_days: int = 7
    # Rows deleted per statement. Small enough that MariaDB never holds a long
    # row-lock span on `audit_log`, large enough that a year of backlog clears in
    # a sane number of round trips.
    purge_batch_size: int = 1_000

    # ── Environment ───────────────────────────────────────────────────────────
    environment: str = "local"

    # ── Seed ──────────────────────────────────────────────────────────────────
    seed_admin_email: str = "principal@school.local"
    seed_admin_password: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_local(self) -> bool:
        return self.environment.lower() == "local"

    @property
    def cookie_secure(self) -> bool:
        # Secure is mandatory whenever SameSite=None (cross-origin). Only relaxed
        # for a same-origin local dev server over http://localhost.
        return not self.is_local

    @property
    def hsts_enabled(self) -> bool:
        """HSTS is an https-only promise — never advertise it from local http."""
        return not self.is_local

    @property
    def trusted_host_list(self) -> list[str]:
        return [h.strip() for h in self.trusted_hosts.split(",") if h.strip()]

    @field_validator("trusted_proxies")
    @classmethod
    def _validate_trusted_proxies(cls, v: str) -> str:
        """Reject an unparseable proxy entry at STARTUP rather than silently
        ignoring it at request time.

        A typo here fails open in the worst way: the entry never matches, so the
        proxy is untrusted, so every client looks like the proxy and the audit
        trail quietly collapses to one address. Better to refuse to boot.
        """
        for part in v.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                ipaddress.ip_network(part, strict=False)
            except ValueError as exc:
                raise ValueError(
                    f"TRUSTED_PROXIES entry {part!r} is not a valid IP or CIDR."
                ) from exc
        return v

    def validate_runtime(self) -> None:
        """Fail fast on insecure production config. Called from the app factory."""
        if not self.is_local and self.jwt_secret == _INSECURE_DEFAULT_SECRET:
            raise RuntimeError(
                "JWT_SECRET must be set to a strong random value outside 'local' "
                "environment; refusing to start with the insecure default."
            )
        if not self.is_local and self.database_url == LOCAL_DEFAULT_DATABASE_URL:
            # The default is a plausible-looking localhost MariaDB URL, so a
            # deployment that forgot to set DATABASE_URL would CONNECT (to
            # whatever happens to listen on 3306) instead of failing — the worst
            # possible outcome for a student-records system. Refuse to start.
            raise RuntimeError(
                "DATABASE_URL must be set explicitly outside 'local' environment; "
                "refusing to start on the built-in localhost default."
            )
        if not self.cors_origin_list:
            raise RuntimeError("CORS_ORIGINS must list at least one explicit origin.")
        if "*" in self.cors_origin_list:
            raise RuntimeError(
                "CORS_ORIGINS must not contain '*' — credentialed CORS requires an "
                "explicit allow-list (architecture.md §3.1)."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()

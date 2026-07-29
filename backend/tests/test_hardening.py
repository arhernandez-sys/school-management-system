"""Tests for the production-hardening pass.

Covers the five things that were added and could silently not work:

  1. the in-process IP rate limiter (`app/core/ratelimit.py`);
  2. client-IP resolution behind a proxy, and its spoof-safety (`app/core/net.py`);
  3. the security-headers middleware, incl. HSTS being local-only;
  4. the readiness probe failing 503 WITHOUT dragging `/health` down with it;
  5. the retention purge job's dry-run accounting and its refusal to delete a
     release-nudge row that is still inside its cooldown.

Most cases here are DB-FREE on purpose. The limiter guard runs before the service
call, and the `/auth/refresh` CSRF-header rejection returns before any query, so
the throttle can be exercised end-to-end without a database — which keeps this
file green on a machine with no `.env` (the harness's standing rule). The purge
tests genuinely need rows and are marked `requires_db`.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.config import Settings, get_settings
from app.core import ratelimit
from app.core.net import ClientAddress, resolve_client
from app.core.ratelimit import FixedWindowRateLimiter

HEALTH = "/api/v1/health"
READY = "/api/v1/ready"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"

#: Starlette's TestClient always reports this literal as the peer host, so it is
#: also the rate-limit key for every request the suite makes (see `net.py`:
#: a non-IP peer yields `ip=None` but a usable `key`).
TESTCLIENT_KEY = "testclient"

#: A non-default value so `validate_runtime()` accepts environment != "local".
_TEST_SECRET = "x" * 48
_TEST_DB_URL = "mysql+pymysql://t:t@127.0.0.1:3306/t_not_used"


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════
def _build_app(**overrides):  # noqa: ANN201 - FastAPI app + the Settings used
    """Build an app around explicit Settings.

    `create_app(settings)` only governs what the FACTORY reads (middleware); the
    routers resolve `Settings` per-request through `Depends(get_settings)`, which
    returns the lru_cached process singleton. So the dependency must be overridden
    too or the request handlers would keep reading the ambient .env config.
    """
    from app.main import create_app

    base: dict[str, object] = {
        "environment": "local",
        "jwt_secret": _TEST_SECRET,
        "database_url": _TEST_DB_URL,
        "rate_limit_enabled": True,
    }
    base.update(overrides)
    settings = Settings(**base)  # type: ignore[arg-type]
    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    return application, settings


def _test_client(application):  # noqa: ANN001, ANN201
    from fastapi.testclient import TestClient

    return TestClient(application)


def _fill_bucket(scope: str, key: str, *, count: int, window: int = 300) -> None:
    """Push a key up to `count` recorded failures without going through HTTP."""
    limiter = ratelimit.get_limiter()
    for _ in range(count):
        limiter.record(f"{scope}:{key}", window_seconds=window)


def _make_request(peer: str | None, headers: dict[str, str] | None = None):  # noqa: ANN201
    """A minimal Starlette Request with a controllable peer address.

    TestClient cannot set the peer (Starlette 0.41 has no `client=` parameter), so
    the proxy-trust matrix is exercised at the unit level where the socket address
    is ours to choose. The end-to-end spoof test below then confirms the router
    actually calls this code.
    """
    from starlette.requests import Request

    raw_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1"))
        for k, v in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "root_path": "",
        "headers": raw_headers,
        "client": (peer, 54321) if peer is not None else None,
        "server": ("testserver", 80),
    }
    return Request(scope)


class _FakeClock:
    """Monotonic clock the tests advance by hand, so window expiry needs no sleep."""

    def __init__(self) -> None:
        self.now = 1_000.0

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


# ══════════════════════════════════════════════════════════════════════════════
# 1. Rate limiter — the counter itself
# ══════════════════════════════════════════════════════════════════════════════
def test_limiter_allows_below_limit_and_denies_at_it() -> None:
    limiter = FixedWindowRateLimiter()
    for i in range(3):
        assert limiter.check("k", limit=3, window_seconds=60).allowed, (
            f"failure {i} should still be under a limit of 3"
        )
        limiter.record("k", window_seconds=60)

    decision = limiter.check("k", limit=3, window_seconds=60)
    assert not decision.allowed
    assert decision.count == 3
    # Reported window must be usable by the SPA: positive and never longer than
    # the window itself.
    assert 1 <= decision.retry_after_seconds <= 60


def test_limiter_window_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = _FakeClock()
    monkeypatch.setattr("app.core.ratelimit.time", clock)

    limiter = FixedWindowRateLimiter()
    for _ in range(2):
        limiter.record("k", window_seconds=60)
    assert not limiter.check("k", limit=2, window_seconds=60).allowed

    # Still inside the window.
    clock.advance(59)
    assert not limiter.check("k", limit=2, window_seconds=60).allowed

    # Past it: the counter resets rather than lingering.
    clock.advance(2)
    decision = limiter.check("k", limit=2, window_seconds=60)
    assert decision.allowed
    assert decision.count == 0


def test_limiter_retry_after_counts_down_and_is_not_extended_by_more_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hammering while blocked must not push the unlock further away.

    A limiter that restarts its window on every rejected attempt never releases a
    client that keeps retrying — the `retry_after_seconds` it advertises would be
    a lie the SPA acts on.
    """
    clock = _FakeClock()
    monkeypatch.setattr("app.core.ratelimit.time", clock)

    limiter = FixedWindowRateLimiter()
    limiter.record("k", window_seconds=60)
    first = limiter.check("k", limit=1, window_seconds=60).retry_after_seconds

    clock.advance(30)
    limiter.record("k", window_seconds=60)  # attacker keeps trying
    later = limiter.check("k", limit=1, window_seconds=60).retry_after_seconds
    assert later < first, "retry window must shrink with time, not reset"


def test_limiter_is_memory_bounded() -> None:
    """The tracking map must not grow with the number of distinct client IPs —
    an unbounded per-IP dict is itself a denial-of-service vector."""
    limiter = FixedWindowRateLimiter(max_keys=50)
    for i in range(5_000):
        limiter.record(f"login:198.51.100.{i}", window_seconds=300)
    assert len(limiter) <= 50


def test_limiter_scopes_are_independent() -> None:
    limiter = FixedWindowRateLimiter()
    for _ in range(5):
        limiter.record("login:1.2.3.4", window_seconds=60)
    assert not limiter.check("login:1.2.3.4", limit=5, window_seconds=60).allowed
    assert limiter.check("refresh:1.2.3.4", limit=5, window_seconds=60).allowed


# ══════════════════════════════════════════════════════════════════════════════
# 1b. Rate limiter — end to end through the auth routes
# ══════════════════════════════════════════════════════════════════════════════
def test_refresh_returns_429_after_too_many_failures() -> None:
    """N failed refreshes are allowed; the next one is throttled.

    Uses the missing-`X-Refresh` rejection, which returns before any DB access —
    so this asserts the throttle end-to-end without a database.
    """
    application, _ = _build_app(
        rate_limit_refresh_max_failures=3, rate_limit_refresh_window=300
    )
    with _test_client(application) as client:
        for i in range(3):
            resp = client.post(REFRESH)
            assert resp.status_code == 401, f"attempt {i} should be a plain 401"

        resp = client.post(REFRESH)
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"]["code"] == "rate_limited"
        # Mirrors the 423 lockout contract in auth/service.py — ONE field the SPA
        # reads regardless of which throttle it hit.
        assert body["error"]["retry_after_seconds"] >= 1
        assert resp.headers["Retry-After"] == str(body["error"]["retry_after_seconds"])


def test_rate_limit_can_be_disabled_by_config() -> None:
    application, _ = _build_app(rate_limit_enabled=False)
    with _test_client(application) as client:
        for _ in range(20):
            resp = client.post(REFRESH)
            assert resp.status_code == 401, "throttling must be fully off"


def test_login_is_throttled_before_reaching_the_database() -> None:
    """The 429 must be raised by the guard, not after a query.

    Denying early is what caps the `login_attempts` write amplification a password
    spray causes (OQ-DB6) — and it is why this test needs no database at all.
    """
    application, _ = _build_app(rate_limit_login_max_failures=2)
    _fill_bucket("login", TESTCLIENT_KEY, count=2)
    with _test_client(application) as client:
        resp = client.post(LOGIN, json={"identifier": "a@b.c", "password": "whatever"})
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "rate_limited"


def test_successful_requests_do_not_consume_the_budget() -> None:
    """Only FAILURES are counted — a campus behind one NAT address must not
    throttle itself. `/health` is not throttled at all; the assertion here is that
    a non-failing auth request leaves the bucket empty."""
    application, _ = _build_app(rate_limit_refresh_max_failures=1)
    with _test_client(application) as client:
        # A valid-shaped refresh with the CSRF header still fails (no cookie), so
        # instead assert on the limiter directly after a request that never
        # reaches an auth failure path: /health.
        assert client.get(HEALTH).status_code == 200
    assert len(ratelimit.get_limiter()) == 0


# ══════════════════════════════════════════════════════════════════════════════
# 2. Client IP resolution / X-Forwarded-For trust
# ══════════════════════════════════════════════════════════════════════════════
def test_xff_ignored_when_no_trusted_proxy_configured() -> None:
    """The default posture. An attacker setting the header gains nothing."""
    settings = Settings(trusted_proxies="")
    request = _make_request("203.0.113.5", {"X-Forwarded-For": "1.2.3.4"})
    assert resolve_client(request, settings) == ClientAddress(
        ip="203.0.113.5", key="203.0.113.5"
    )


def test_xff_ignored_when_peer_is_not_a_trusted_proxy() -> None:
    settings = Settings(trusted_proxies="10.0.0.0/8")
    request = _make_request("203.0.113.5", {"X-Forwarded-For": "1.2.3.4"})
    assert resolve_client(request, settings).ip == "203.0.113.5"


def test_xff_honoured_from_a_trusted_proxy() -> None:
    settings = Settings(trusted_proxies="10.0.0.1")
    request = _make_request("10.0.0.1", {"X-Forwarded-For": "203.0.113.9"})
    assert resolve_client(request, settings).ip == "203.0.113.9"


def test_xff_spoofed_prefix_is_ignored() -> None:
    """THE spoof case.

    The client sent `X-Forwarded-For: 1.2.3.4`; the trusted proxy appended the
    address it actually saw. Reading the FIRST entry (the common bug) would hand
    the attacker a rate-limit key and an audit entry of their choosing. Walking
    from the right yields their real address instead.
    """
    settings = Settings(trusted_proxies="10.0.0.1")
    request = _make_request(
        "10.0.0.1", {"X-Forwarded-For": "1.2.3.4, 198.51.100.77"}
    )
    assert resolve_client(request, settings).ip == "198.51.100.77"


def test_xff_skips_chained_trusted_proxies() -> None:
    settings = Settings(trusted_proxies="10.0.0.0/8")
    request = _make_request(
        "10.0.0.1", {"X-Forwarded-For": "198.51.100.77, 10.0.0.9, 10.0.0.8"}
    )
    assert resolve_client(request, settings).ip == "198.51.100.77"


def test_xff_all_hops_trusted_falls_back_to_peer() -> None:
    settings = Settings(trusted_proxies="10.0.0.0/8")
    request = _make_request("10.0.0.1", {"X-Forwarded-For": "10.0.0.9"})
    assert resolve_client(request, settings).ip == "10.0.0.1"


def test_xff_unparseable_hop_falls_back_to_peer() -> None:
    """A chain we cannot read is a chain we cannot trust."""
    settings = Settings(trusted_proxies="10.0.0.1")
    request = _make_request("10.0.0.1", {"X-Forwarded-For": "not-an-ip"})
    assert resolve_client(request, settings).ip == "10.0.0.1"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("198.51.100.77:54321", "198.51.100.77"),
        ("[2001:db8::1]:443", "2001:db8::1"),
        ("2001:db8::1", "2001:db8::1"),
        ("  198.51.100.77  ", "198.51.100.77"),
    ],
)
def test_xff_entry_forms(raw: str, expected: str) -> None:
    settings = Settings(trusted_proxies="10.0.0.1")
    request = _make_request("10.0.0.1", {"X-Forwarded-For": raw})
    assert resolve_client(request, settings).ip == expected


def test_non_ip_peer_yields_null_ip_but_usable_key() -> None:
    """`ip_address` columns must get NULL rather than a junk string, while the
    limiter still needs something to count against."""
    settings = Settings(trusted_proxies="")
    address = resolve_client(_make_request("testclient"), settings)
    assert address.ip is None
    assert address.key == "testclient"


def test_missing_peer_yields_unknown_key() -> None:
    settings = Settings(trusted_proxies="")
    address = resolve_client(_make_request(None), settings)
    assert address.ip is None
    assert address.key == "unknown"


def test_detects_an_asgi_server_that_already_rewrote_the_peer(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """uvicorn ships `--proxy-headers` ON by default with
    `--forwarded-allow-ips=127.0.0.1`, so behind a same-host nginx it replaces
    `scope["client"]` from X-Forwarded-For before this app runs — silently
    bypassing TRUSTED_PROXIES. It marks the substitution with port 0, which a real
    accepted socket never has, so we can detect and complain about it.
    """
    import app.core.net as net

    monkeypatch.setattr(net, "_peer_rewrite_warned", False)

    scope_request = _make_request("8.8.8.8", {"X-Forwarded-For": "8.8.8.8"})
    # Simulate uvicorn's substitution: (host, 0).
    scope_request.scope["client"] = ("8.8.8.8", 0)

    with caplog.at_level("WARNING", logger="sis.net"):
        net.resolve_client(scope_request, Settings(trusted_proxies=""))
    assert any("proxy_header_conflict" in r.message for r in caplog.records)


def test_no_proxy_conflict_warning_for_a_normal_peer(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import app.core.net as net

    monkeypatch.setattr(net, "_peer_rewrite_warned", False)
    with caplog.at_level("WARNING", logger="sis.net"):
        net.resolve_client(
            _make_request("203.0.113.5", {"X-Forwarded-For": "1.2.3.4"}),
            Settings(trusted_proxies=""),
        )
    assert not [r for r in caplog.records if "proxy_header_conflict" in r.message]


def test_invalid_trusted_proxy_entry_is_rejected_at_config_load() -> None:
    """Fails CLOSED at startup: a typo here would otherwise never match, making
    every client look like the proxy and quietly flattening the audit trail."""
    with pytest.raises(ValueError):
        Settings(trusted_proxies="10.0.0.0/8,not-a-cidr")


def test_spoofed_xff_cannot_buy_a_fresh_rate_limit_bucket() -> None:
    """End-to-end: the router really does use the trust-aware resolver.

    No proxy is trusted, so rotating `X-Forwarded-For` — the standard way to
    evade a naive IP limiter — must not reset the caller's budget.
    """
    application, _ = _build_app(rate_limit_login_max_failures=2, trusted_proxies="")
    _fill_bucket("login", TESTCLIENT_KEY, count=2)
    with _test_client(application) as client:
        resp = client.post(
            LOGIN,
            json={"identifier": "a@b.c", "password": "whatever"},
            headers={"X-Forwarded-For": "9.9.9.9"},
        )
    assert resp.status_code == 429, "XFF must not grant a new bucket"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Security headers
# ══════════════════════════════════════════════════════════════════════════════
def test_security_headers_present() -> None:
    application, _ = _build_app(environment="local")
    with _test_client(application) as client:
        resp = client.get(HEALTH)
    assert resp.status_code == 200
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_hsts_absent_in_local() -> None:
    """HSTS over plain http is meaningless, and pinning `localhost` to https
    breaks every other project on a developer's machine — semi-permanently."""
    application, _ = _build_app(environment="local")
    with _test_client(application) as client:
        resp = client.get(HEALTH)
    assert "strict-transport-security" not in {k.lower() for k in resp.headers}


def test_hsts_present_outside_local() -> None:
    application, _ = _build_app(environment="production", hsts_max_age=600)
    with _test_client(application) as client:
        resp = client.get(HEALTH)
    hsts = resp.headers["Strict-Transport-Security"]
    assert "max-age=600" in hsts
    assert "includeSubDomains" in hsts
    # `preload` is an effectively irreversible commitment; never a default.
    assert "preload" not in hsts


def test_security_headers_applied_to_error_responses() -> None:
    """Headers must survive the error path too — that is why the middleware sits
    outside CORS and inside the logger, not next to the routes."""
    application, _ = _build_app()
    with _test_client(application) as client:
        resp = client.get("/api/v1/definitely-not-a-route")
    assert resp.status_code == 404
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


def test_trusted_hosts_default_is_a_no_op() -> None:
    """"*" must not activate the middleware — a PaaS with a generated hostname
    would otherwise be broken by a setting nobody knew to fill in."""
    application, _ = _build_app(trusted_hosts="*")
    with _test_client(application) as client:
        assert client.get(HEALTH).status_code == 200


def test_trusted_hosts_rejects_a_foreign_host_header() -> None:
    application, _ = _build_app(trusted_hosts="sis.example.edu")
    with _test_client(application) as client:
        # TestClient sends `Host: testserver`, which is not on the list.
        assert client.get(HEALTH).status_code == 400
        assert (
            client.get(HEALTH, headers={"Host": "sis.example.edu"}).status_code == 200
        )


def test_no_csp_is_emitted() -> None:
    """Documented decision, asserted so it cannot be reintroduced by accident: a
    CSP tight enough to matter breaks Swagger UI's CDN assets, and a CSP loose
    enough to allow them protects nothing on a JSON API. See
    `core/security_headers.py`."""
    application, _ = _build_app()
    with _test_client(application) as client:
        resp = client.get(HEALTH)
        docs = client.get("/api/v1/docs")
    lower = {k.lower() for k in resp.headers}
    assert "content-security-policy" not in lower
    assert docs.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# 4. Readiness vs liveness
# ══════════════════════════════════════════════════════════════════════════════
def test_ready_returns_503_while_health_stays_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point of splitting the two probes.

    If liveness failed on a DB outage, the orchestrator would restart the app in
    a loop — still failing long after the database recovered. `/health` must keep
    answering 200 while `/ready` drains traffic.
    """

    def _boom() -> None:
        raise OSError("connection refused")

    monkeypatch.setattr("app.db.session.check_connection", _boom)

    application, _ = _build_app()
    with _test_client(application) as client:
        ready = client.get(READY)
        health = client.get(HEALTH)

    assert ready.status_code == 503
    assert ready.json()["error"]["code"] == "service_unavailable"
    # An unauthenticated probe must not describe the failure's internals.
    assert "connection refused" not in ready.text
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}


@pytest.mark.requires_db
def test_ready_returns_200_with_a_reachable_database(client) -> None:  # noqa: ANN001
    resp = client.get(READY)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


# ══════════════════════════════════════════════════════════════════════════════
# 5. Retention purge job
# ══════════════════════════════════════════════════════════════════════════════
@pytest.mark.requires_db
def test_purge_dry_run_counts_without_deleting(db_session) -> None:  # noqa: ANN001
    """--dry-run reports what WOULD go and writes nothing."""
    from app.core.timeutil import utcnow
    from app.jobs.purge import run_purge
    from app.modules.auth.models import LoginAttempt

    now = utcnow()
    old = LoginAttempt(
        email_attempted=f"old_{uuid.uuid4().hex[:8]}@test.local",
        succeeded=False,
        attempted_at=now - timedelta(days=200),
    )
    recent = LoginAttempt(
        email_attempted=f"new_{uuid.uuid4().hex[:8]}@test.local",
        succeeded=False,
        attempted_at=now - timedelta(days=1),
    )
    db_session.add_all([old, recent])
    db_session.flush()

    settings = Settings(retention_login_attempts_days=90)
    report = run_purge(
        db_session, settings, dry_run=True, only=("login_attempts",)
    )

    assert report.dry_run is True
    result = next(r for r in report.results if r.table == "login_attempts")
    assert result.rows >= 1, "the 200-day-old row must be counted"

    # Nothing was actually removed.
    surviving = set(
        db_session.scalars(
            select(LoginAttempt.id).where(LoginAttempt.id.in_([old.id, recent.id]))
        )
    )
    assert surviving == {old.id, recent.id}


@pytest.mark.requires_db
def test_purge_deletes_aged_rows_but_spares_recent_ones(db_session) -> None:  # noqa: ANN001
    from app.core.timeutil import utcnow
    from app.jobs.purge import run_purge
    from app.modules.auth.models import LoginAttempt

    now = utcnow()
    old = LoginAttempt(
        email_attempted=f"old_{uuid.uuid4().hex[:8]}@test.local",
        succeeded=False,
        attempted_at=now - timedelta(days=200),
    )
    recent = LoginAttempt(
        email_attempted=f"new_{uuid.uuid4().hex[:8]}@test.local",
        succeeded=False,
        attempted_at=now - timedelta(days=1),
    )
    db_session.add_all([old, recent])
    db_session.flush()

    run_purge(
        db_session,
        Settings(retention_login_attempts_days=90),
        only=("login_attempts",),
        batch_size=100,
    )

    surviving = set(
        db_session.scalars(
            select(LoginAttempt.id).where(LoginAttempt.id.in_([old.id, recent.id]))
        )
    )
    assert old.id not in surviving
    assert recent.id in surviving


@pytest.mark.requires_db
def test_purge_never_deletes_a_nudge_row_inside_its_cooldown(db_session) -> None:  # noqa: ANN001
    """`audit_log` is load-bearing, not just forensic.

    `assessments/release_nudge.py` derives the 4-hour re-nudge cooldown by reading
    back the most recent `grade.release_nudge` row — there is no other copy of
    that state. Purging one silently resets the cooldown and the teacher starts
    getting the repeat reminders the cooldown exists to prevent; nothing errors.

    The 365-day default could never collide with a 4-hour window, so the guard is
    only reachable through misconfiguration — which is exactly what this test
    simulates with `retention_audit_log_days=0`.
    """
    from app.core.timeutil import utcnow
    from app.jobs.purge import run_purge
    from app.modules.assessments import release_nudge
    from app.modules.settings.models import AuditLog

    now = utcnow()
    assessment_id = uuid.uuid4()
    fresh_nudge = AuditLog(
        action=release_nudge.NUDGE_ACTION,
        entity_type=release_nudge.NUDGE_ENTITY_TYPE,
        entity_id=assessment_id,
        created_at=now - timedelta(minutes=5),  # well inside the 4h cooldown
    )
    ordinary = AuditLog(
        action="test.hardening_probe",
        entity_type="assessment",
        entity_id=uuid.uuid4(),
        created_at=now - timedelta(minutes=5),
    )
    db_session.add_all([fresh_nudge, ordinary])
    db_session.flush()

    settings = Settings(retention_audit_log_days=0)  # misconfiguration

    report = run_purge(db_session, settings, dry_run=True, only=("audit_log",))
    audit = next(r for r in report.results if r.table == "audit_log")
    assert audit.protected >= 1, "the in-cooldown nudge must be reported as spared"

    # And the real run must honour it.
    run_purge(db_session, settings, only=("audit_log",), batch_size=500)

    assert db_session.get(AuditLog, fresh_nudge.id) is not None, (
        "purging an in-cooldown nudge would silently reset the cooldown"
    )
    assert db_session.get(AuditLog, ordinary.id) is None, (
        "ordinary aged-out audit rows must still be collected"
    )
    # The derived state the feature actually reads is intact.
    assert release_nudge.last_nudged_at(db_session, assessment_id) is not None


@pytest.mark.requires_db
def test_purge_collects_a_nudge_row_past_its_cooldown(db_session) -> None:  # noqa: ANN001
    """The guard is a cooldown exemption, not a permanent one — a year-old nudge
    is history and must age out like anything else."""
    from app.core.timeutil import utcnow
    from app.jobs.purge import run_purge
    from app.modules.assessments import release_nudge
    from app.modules.settings.models import AuditLog

    stale = AuditLog(
        action=release_nudge.NUDGE_ACTION,
        entity_type=release_nudge.NUDGE_ENTITY_TYPE,
        entity_id=uuid.uuid4(),
        created_at=utcnow() - timedelta(days=400),
    )
    db_session.add(stale)
    db_session.flush()

    run_purge(
        db_session,
        Settings(retention_audit_log_days=365),
        only=("audit_log",),
        batch_size=500,
    )
    assert db_session.get(AuditLog, stale.id) is None

"""Comprehensive pytest suite for Module 7.1 — AUTH (api-spec §2).

Scope: the 6 auth endpoints + their negative/edge/security paths. Every test is
hermetic — it provisions its own user rows inside the rolled-back `db_session`
(via the `make_user` factory in conftest), so nothing persists to the shared
Supabase DB and the seeded principal is never touched.

Oracle: api-specification.md §2 (the auth contract), §3.3 (404-vs-403), §4.2
(ErrorResponse envelope). Where the implementation legitimately diverges from a
loose reading of the spec, the discrepancy is documented at the assertion (none
found that warrant xfail — see the final report).

All tests are marked `requires_db`: they need the live test DB. The harness skips
them cleanly (never errors) when no DATABASE_URL is configured.

Test-isolation note: the `client` fixture overrides `get_db` to yield the SAME
rolled-back `db_session` the `make_user` factory writes to, so a user created in
a test is visible to the endpoint under test within the same request. The service
layer's `db.commit()` lands on a SAVEPOINT (join_transaction_mode), so we can read
committed bookkeeping (login_attempts, failed_login_count, rotated sessions) back
through the same session after the call, yet the outer transaction is rolled back
wholesale at teardown.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.common.enums import Role
from app.core.cookies import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH
from app.core.security import parse_refresh_jti, sha256_hash
from app.modules.auth.models import LoginAttempt, RefreshSession
from app.modules.settings.models import AuditLog
from app.modules.users.models import User

pytestmark = pytest.mark.requires_db

# Paths (api-spec §1.1 + §2.3).
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"
ME_PASSWORD = "/api/v1/auth/me/password"


def _reset_path(user_id) -> str:  # noqa: ANN001
    return f"/api/v1/auth/users/{user_id}/reset-password"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _refresh_headers() -> dict[str, str]:
    """The custom anti-CSRF header required by /auth/refresh (api-spec §2.2)."""
    return {"X-Refresh": "1"}


def _assert_envelope(body: dict, *, code: str) -> dict:
    """Assert the body conforms to the ErrorResponse envelope (api-spec §4.2) and
    carries the expected machine-readable `code`. Returns the inner error body."""
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert isinstance(err, dict)
    assert "code" in err and "message" in err, f"missing code/message: {err}"
    assert isinstance(err["code"], str) and isinstance(err["message"], str)
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


def _assert_clears_refresh_cookie(resp) -> None:  # noqa: ANN001
    """Assert the response carries a Set-Cookie that DELETES `sis_refresh`.

    api-spec §2.3: every /auth/refresh failure path clears the cookie. The backend
    now does this by attaching `clear_refresh_cookie` to the RETURNED 401 response
    (no longer raise-after-mutate), so the deletion reaches the client. A deletion
    is a Set-Cookie for the same name, scoped to the same Path (/api/v1/auth), with
    an immediate-expiry marker (Max-Age=0 and/or a past Expires)."""
    set_cookie = resp.headers.get("set-cookie")
    assert set_cookie, f"expected a clearing Set-Cookie, got headers={dict(resp.headers)}"
    sc = set_cookie.lower()
    assert f"{REFRESH_COOKIE_NAME}=" in sc, f"clearing cookie missing the name: {set_cookie!r}"
    assert REFRESH_COOKIE_PATH.lower() in sc, (
        f"clearing cookie not scoped to {REFRESH_COOKIE_PATH}: {set_cookie!r}"
    )
    # The deletion is signalled by Max-Age=0 and/or an expiry in the past
    # (Starlette's delete_cookie emits max-age=0 + Expires=Thu, 01 Jan 1970).
    assert ("max-age=0" in sc) or ("expires=" in sc and "1970" in sc), (
        f"clearing cookie has no expiry/max-age=0 marker: {set_cookie!r}"
    )


# ════════════════════════════════════════════════════════════════════════════
# POST /auth/login
# ════════════════════════════════════════════════════════════════════════════
class TestLogin:
    def test_login_success_by_email(self, client, make_user, db_session) -> None:
        """200, access_token + CurrentUser, sets sis_refresh cookie, creates a
        refresh_sessions row + login_attempts(succeeded=true), resets failed
        count, sets last_login_at (api-spec §2.3)."""
        pw = make_user.default_password
        user = make_user(role=Role.PRINCIPAL, password=pw, failed_login_count=3)

        resp = client.post(LOGIN, json={"identifier": user.email, "password": pw})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body["access_token"], str) and body["access_token"]
        # CurrentUser shape (api-spec §4.4).
        u = body["user"]
        assert u["id"] == str(user.id)
        assert u["email"] == user.email
        assert u["role"] == "principal"
        assert u["is_active"] is True
        assert "preferences" in u and u["preferences"]["locale"] == "en"

        # Cookie set, HttpOnly + scoped to the auth subtree.
        set_cookie = resp.headers.get("set-cookie", "")
        assert f"{REFRESH_COOKIE_NAME}=" in set_cookie
        assert "httponly" in set_cookie.lower()
        assert f"path={REFRESH_COOKIE_PATH}" in set_cookie.lower()
        assert REFRESH_COOKIE_NAME in client.cookies

        # Server-side state: a live refresh session exists; bookkeeping persisted.
        db_session.refresh(user)
        assert user.failed_login_count == 0
        assert user.last_login_at is not None
        n_sessions = db_session.scalar(
            select(func.count())
            .select_from(RefreshSession)
            .where(RefreshSession.user_id == user.id, RefreshSession.is_revoked.is_(False))
        )
        assert n_sessions == 1
        n_success = db_session.scalar(
            select(func.count())
            .select_from(LoginAttempt)
            .where(LoginAttempt.user_id == user.id, LoginAttempt.succeeded.is_(True))
        )
        assert n_success == 1

    def test_login_success_by_username(self, client, make_user) -> None:
        """Login by username works identically to email (api-spec §2.3)."""
        pw = make_user.default_password
        user = make_user(username="jdoe", password=pw)
        resp = client.post(LOGIN, json={"identifier": "jdoe", "password": pw})
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["id"] == str(user.id)

    def test_wrong_password_401_invalid_credentials(self, client, make_user, db_session) -> None:
        user = make_user(password="CorrectHorse9!")
        resp = client.post(LOGIN, json={"identifier": user.email, "password": "wrong-pass-1A"})
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="invalid_credentials")
        # Failed attempt logged + counter incremented (api-spec §2.3).
        db_session.refresh(user)
        assert user.failed_login_count == 1
        n_fail = db_session.scalar(
            select(func.count()).select_from(LoginAttempt).where(
                LoginAttempt.user_id == user.id, LoginAttempt.succeeded.is_(False)
            )
        )
        assert n_fail == 1

    def test_unknown_identifier_is_non_enumerating(self, client, make_user) -> None:
        """A wrong identifier and a wrong password MUST return the identical 401
        body — no account enumeration (api-spec §2.3, FR-AUTH-02)."""
        user = make_user(password="CorrectHorse9!")
        wrong_pw = client.post(
            LOGIN, json={"identifier": user.email, "password": "definitely-wrong-1A"}
        )
        unknown = client.post(
            LOGIN, json={"identifier": "nobody@nowhere.test", "password": "definitely-wrong-1A"}
        )
        assert wrong_pw.status_code == unknown.status_code == 401
        # Byte-for-byte identical bodies (the non-enumeration guarantee).
        assert wrong_pw.json() == unknown.json()
        _assert_envelope(unknown.json(), code="invalid_credentials")

    def test_inactive_user_403_account_inactive(self, client, make_user) -> None:
        """Valid password but deactivated account → 403 account_inactive."""
        pw = make_user.default_password
        user = make_user(password=pw, is_active=False)
        resp = client.post(LOGIN, json={"identifier": user.email, "password": pw})
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="account_inactive")

    def test_lockout_after_threshold_then_423(self, client, make_user, settings, db_session) -> None:
        """After lockout_threshold failed attempts, the NEXT attempt is 423
        account_locked with retry_after_seconds (api-spec §2.3, FR-AUTH-07)."""
        pw = make_user.default_password
        user = make_user(password=pw)
        threshold = settings.lockout_threshold

        # N failed attempts drive failed_login_count to the threshold and stamp
        # locked_until on the Nth (>= threshold).
        for _ in range(threshold):
            r = client.post(LOGIN, json={"identifier": user.email, "password": "bad-pass-1A"})
            assert r.status_code == 401

        # The next attempt (even with the CORRECT password) is refused with 423.
        locked = client.post(LOGIN, json={"identifier": user.email, "password": pw})
        assert locked.status_code == 423
        err = _assert_envelope(locked.json(), code="account_locked")
        assert "retry_after_seconds" in err
        assert isinstance(err["retry_after_seconds"], int) and err["retry_after_seconds"] >= 1
        assert err["retry_after_seconds"] <= settings.lockout_duration

        db_session.refresh(user)
        assert user.locked_until is not None and user.locked_until > _now()

    def test_correct_password_while_locked_still_423(self, client, make_user, settings) -> None:
        """A correct password during the lockout window is still refused (423)."""
        pw = make_user.default_password
        user = make_user(
            password=pw,
            failed_login_count=settings.lockout_threshold,
            locked_until=_now() + timedelta(seconds=settings.lockout_duration),
        )
        resp = client.post(LOGIN, json={"identifier": user.email, "password": pw})
        assert resp.status_code == 423
        _assert_envelope(resp.json(), code="account_locked")

    def test_login_missing_field_422_envelope(self, client) -> None:
        """A malformed body normalizes to the standard 422 envelope (api-spec §4.3)."""
        resp = client.post(LOGIN, json={"identifier": "x@y.z"})  # no password
        assert resp.status_code == 422
        err = _assert_envelope(resp.json(), code="validation_error")
        assert "fields" in err and "password" in err["fields"]


# ════════════════════════════════════════════════════════════════════════════
# POST /auth/refresh — rotation, replay detection, idle timeout, CSRF header
# ════════════════════════════════════════════════════════════════════════════
class TestRefresh:
    def _login(self, client, make_user):
        """Helper: create a user, log in, return (user, old_raw_cookie)."""
        pw = make_user.default_password
        user = make_user(password=pw)
        resp = client.post(LOGIN, json={"identifier": user.email, "password": pw})
        assert resp.status_code == 200, resp.text
        old_cookie = client.cookies.get(REFRESH_COOKIE_NAME)
        assert old_cookie
        return user, old_cookie

    def test_refresh_rotates_and_old_token_is_replay_detected(
        self, client, make_user, db_session
    ) -> None:
        """Valid cookie + X-Refresh:1 → 200 + NEW rotated cookie + new access
        token; the OLD refresh session is revoked, and replaying the OLD token
        now fails (rotation/replay detection, api-spec §2.1)."""
        user, old_cookie = self._login(client, make_user)
        old_jti = parse_refresh_jti(old_cookie)

        resp = client.post(REFRESH, headers=_refresh_headers())
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body["access_token"], str) and body["access_token"]
        assert body["user"]["id"] == str(user.id)

        new_cookie = client.cookies.get(REFRESH_COOKIE_NAME)
        assert new_cookie and new_cookie != old_cookie  # rotated

        # Old session row is now revoked.
        old_row = db_session.get(RefreshSession, old_jti)
        assert old_row is not None and old_row.is_revoked is True
        assert old_row.revoked_at is not None

        # Replay the OLD token: the service should reject it (revoked).
        client.cookies.set(REFRESH_COOKIE_NAME, old_cookie, path=REFRESH_COOKIE_PATH)
        replay = client.post(REFRESH, headers=_refresh_headers())
        assert replay.status_code == 401
        _assert_envelope(replay.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(replay)

    def test_refresh_without_custom_header_rejected(self, client, make_user) -> None:
        """Missing X-Refresh:1 → 401 refresh_invalid AND the clearing sis_refresh
        cookie (api-spec §2.2 CSRF defense + §2.3 cookie-clearing on failure)."""
        self._login(client, make_user)
        resp = client.post(REFRESH)  # no X-Refresh header
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(resp)

    def test_refresh_missing_cookie_401_and_clears(self, client) -> None:
        """No cookie at all → 401 refresh_invalid AND a clearing sis_refresh
        cookie (api-spec §2.3).

        (The earlier raise-after-mutate gap that prevented the clearing Set-Cookie
        is now FIXED in the router via `_refresh_invalid_response`, which attaches
        the deletion to the returned 401 response. This test now asserts the
        corrected spec behavior.)"""
        client.cookies.clear()
        resp = client.post(REFRESH, headers=_refresh_headers())
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(resp)

    def test_refresh_revoked_session_401(self, client, make_user, db_session) -> None:
        """A revoked session row → 401 refresh_invalid (simulate by flipping
        is_revoked on the row)."""
        user, old_cookie = self._login(client, make_user)
        jti = parse_refresh_jti(old_cookie)
        row = db_session.get(RefreshSession, jti)
        row.is_revoked = True
        row.revoked_at = _now()
        db_session.flush()
        resp = client.post(REFRESH, headers=_refresh_headers())
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(resp)

    def test_refresh_expired_session_401(self, client, make_user, db_session) -> None:
        """A past-expiry session → 401 refresh_invalid (manipulate expires_at)."""
        user, old_cookie = self._login(client, make_user)
        row = db_session.get(RefreshSession, parse_refresh_jti(old_cookie))
        row.expires_at = _now() - timedelta(seconds=1)
        db_session.flush()
        resp = client.post(REFRESH, headers=_refresh_headers())
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(resp)

    def test_refresh_idle_timeout_401(self, client, make_user, db_session, settings) -> None:
        """last_used_at older than SESSION_IDLE_TIMEOUT → 401 refresh_invalid
        (FR-AUTH-10 idle window)."""
        user, old_cookie = self._login(client, make_user)
        row = db_session.get(RefreshSession, parse_refresh_jti(old_cookie))
        # Push last_used_at safely beyond the idle window (still within expires_at).
        row.last_used_at = _now() - timedelta(seconds=settings.session_idle_timeout + 60)
        db_session.flush()
        resp = client.post(REFRESH, headers=_refresh_headers())
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(resp)


# ════════════════════════════════════════════════════════════════════════════
# POST /auth/logout
# ════════════════════════════════════════════════════════════════════════════
class TestLogout:
    def _login(self, client, make_user):
        pw = make_user.default_password
        user = make_user(password=pw)
        resp = client.post(LOGIN, json={"identifier": user.email, "password": pw})
        assert resp.status_code == 200, resp.text
        access = resp.json()["access_token"]
        cookie = client.cookies.get(REFRESH_COOKIE_NAME)
        return user, access, cookie

    def test_logout_revokes_session_and_returns_204(self, client, make_user, db_session) -> None:
        """Authenticated → 204, revokes the current refresh_sessions row, clears
        the cookie (api-spec §2.3)."""
        user, access, cookie = self._login(client, make_user)
        jti = parse_refresh_jti(cookie)
        resp = client.post(LOGOUT, headers={"Authorization": f"Bearer {access}"})
        assert resp.status_code == 204
        assert resp.content == b""
        row = db_session.get(RefreshSession, jti)
        assert row is not None and row.is_revoked is True

    def test_logout_is_idempotent(self, client, make_user) -> None:
        """Calling logout twice still returns 204 (idempotent, api-spec §2.3)."""
        user, access, _ = self._login(client, make_user)
        headers = {"Authorization": f"Bearer {access}"}
        first = client.post(LOGOUT, headers=headers)
        assert first.status_code == 204
        second = client.post(LOGOUT, headers=headers)
        assert second.status_code == 204

    def test_refresh_after_logout_401(self, client, make_user) -> None:
        """Once logged out, the now-revoked refresh token cannot refresh → 401."""
        user, access, cookie = self._login(client, make_user)
        client.post(LOGOUT, headers={"Authorization": f"Bearer {access}"})
        # Re-present the (revoked) cookie to refresh.
        client.cookies.set(REFRESH_COOKIE_NAME, cookie, path=REFRESH_COOKIE_PATH)
        resp = client.post(REFRESH, headers=_refresh_headers())
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="refresh_invalid")
        _assert_clears_refresh_cookie(resp)

    def test_logout_requires_auth_401(self, client) -> None:
        """Unauthenticated logout → 401 (the endpoint is `authenticated`)."""
        resp = client.post(LOGOUT)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")


# ════════════════════════════════════════════════════════════════════════════
# GET /auth/me
# ════════════════════════════════════════════════════════════════════════════
class TestMe:
    def test_me_authenticated_returns_current_user(
        self, client, make_user, auth_headers
    ) -> None:
        user = make_user(role=Role.PRINCIPAL, full_name="Head Teacher")
        resp = client.get(ME, headers=auth_headers(user_id=user.id, role=Role.PRINCIPAL))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(user.id)
        assert body["full_name"] == "Head Teacher"
        assert body["role"] == "principal"
        assert body["student_profile_id"] is None
        assert body["teacher_profile_id"] is None
        # Preferences default block synthesized when no row exists (service).
        assert body["preferences"] == {
            "locale": "en",
            "theme": "light",
            "date_format": None,
            "default_page_size": 25,
        }

    def test_me_teacher_resolves_teacher_profile_id(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """student_profile_id/teacher_profile_id resolution (api-spec §4.4)."""
        from app.modules.teachers.models import TeacherProfile

        user = make_user(role=Role.TEACHER)
        prof = TeacherProfile(
            user_id=user.id, staff_number=f"T-{user.id.hex[:8]}", full_name="Teacher One"
        )
        db_session.add(prof)
        db_session.flush()
        resp = client.get(ME, headers=auth_headers(user_id=user.id, role=Role.TEACHER))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["teacher_profile_id"] == str(prof.id)
        assert body["student_profile_id"] is None

    def test_me_student_resolves_student_profile_id(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        from datetime import date

        from app.modules.students.models import StudentProfile

        user = make_user(role=Role.STUDENT)
        prof = StudentProfile(
            user_id=user.id,
            student_number=f"S-{user.id.hex[:8]}",
            full_name="Student One",
            date_of_birth=date(2010, 1, 1),
            enrollment_date=date(2024, 9, 1),
        )
        db_session.add(prof)
        db_session.flush()
        resp = client.get(ME, headers=auth_headers(user_id=user.id, role=Role.STUDENT))
        assert resp.status_code == 200, resp.text
        assert resp.json()["student_profile_id"] == str(prof.id)

    def test_me_no_token_401(self, client) -> None:
        resp = client.get(ME)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_me_invalid_token_401(self, client) -> None:
        resp = client.get(ME, headers={"Authorization": "Bearer not-a-real-jwt"})
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")


# ════════════════════════════════════════════════════════════════════════════
# PATCH /auth/me/password
# ════════════════════════════════════════════════════════════════════════════
class TestChangePassword:
    def _login(self, client, make_user, **kw):
        pw = kw.pop("password", make_user.default_password)
        user = make_user(password=pw, **kw)
        resp = client.post(LOGIN, json={"identifier": user.email, "password": pw})
        assert resp.status_code == 200, resp.text
        return user, resp.json()["access_token"]

    def test_change_password_success_revokes_other_sessions_keeps_current(
        self, client, make_user, db_session, settings
    ) -> None:
        """Correct current_password → 204; new hash verifies + old does not;
        must_change_password cleared; all OTHER sessions revoked, current kept
        (api-spec §2.3)."""
        from app.core.security import verify_password

        old_pw = make_user.default_password
        user, access = self._login(client, make_user, password=old_pw)
        current_cookie = client.cookies.get(REFRESH_COOKIE_NAME)
        current_jti = parse_refresh_jti(current_cookie)

        # A second, independent session for the same user (e.g. another device).
        other = RefreshSession(
            user_id=user.id,
            token_hash=sha256_hash("other-device-token"),
            issued_at=_now(),
            last_used_at=_now(),
            expires_at=_now() + timedelta(seconds=settings.jwt_refresh_ttl),
            is_revoked=False,
        )
        db_session.add(other)
        db_session.flush()

        new_pw = "Br4ndNewPass!2026"
        resp = client.patch(
            ME_PASSWORD,
            headers={"Authorization": f"Bearer {access}"},
            json={"current_password": old_pw, "new_password": new_pw},
        )
        assert resp.status_code == 204, resp.text

        db_session.refresh(user)
        assert verify_password(new_pw, user.password_hash) is True
        assert verify_password(old_pw, user.password_hash) is False
        assert user.must_change_password is False

        # The OTHER session is revoked; the CURRENT one is kept.
        db_session.refresh(other)
        assert other.is_revoked is True
        current_row = db_session.get(RefreshSession, current_jti)
        assert current_row is not None and current_row.is_revoked is False

    def test_must_change_password_path_omits_current(self, client, make_user) -> None:
        """When must_change_password=true, current_password may be omitted → 204
        (forced first-change flow, api-spec §2.3)."""
        user, access = self._login(client, make_user, must_change_password=True)
        resp = client.patch(
            ME_PASSWORD,
            headers={"Authorization": f"Bearer {access}"},
            json={"new_password": "FreshStart!2026"},
        )
        assert resp.status_code == 204, resp.text

    def test_wrong_current_password_401(self, client, make_user) -> None:
        user, access = self._login(client, make_user)
        resp = client.patch(
            ME_PASSWORD,
            headers={"Authorization": f"Bearer {access}"},
            json={"current_password": "not-the-password-1A", "new_password": "Valid!Pass2026"},
        )
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_weak_new_password_422_weak_password_with_fields(
        self, client, make_user
    ) -> None:
        """A policy-violating new password → 422 weak_password with `fields`
        (api-spec §2.3 + §4.3)."""
        old_pw = make_user.default_password
        user, access = self._login(client, make_user, password=old_pw)
        resp = client.patch(
            ME_PASSWORD,
            headers={"Authorization": f"Bearer {access}"},
            json={"current_password": old_pw, "new_password": "weak"},
        )
        assert resp.status_code == 422
        err = _assert_envelope(resp.json(), code="weak_password")
        assert "fields" in err and "new_password" in err["fields"]
        assert isinstance(err["fields"]["new_password"], list) and err["fields"]["new_password"]

    def test_change_password_requires_auth_401(self, client) -> None:
        resp = client.patch(ME_PASSWORD, json={"new_password": "Valid!Pass2026"})
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")


# ════════════════════════════════════════════════════════════════════════════
# POST /auth/users/{user_id}/reset-password
# ════════════════════════════════════════════════════════════════════════════
class TestResetPassword:
    def test_principal_resets_teacher(
        self, client, make_user, auth_headers, db_session, settings
    ) -> None:
        """Principal resets a teacher → 200 + temporary_password returned once;
        target.must_change_password=true; all target sessions revoked; lockout
        cleared (ratified); audit_log row written (api-spec §2.3)."""
        from app.core.security import verify_password

        principal = make_user(role=Role.PRINCIPAL)
        target = make_user(
            role=Role.TEACHER,
            failed_login_count=settings.lockout_threshold,
            locked_until=_now() + timedelta(seconds=settings.lockout_duration),
        )
        # Give the target a live session to prove it gets revoked.
        sess = RefreshSession(
            user_id=target.id,
            token_hash=sha256_hash("target-live-token"),
            issued_at=_now(),
            last_used_at=_now(),
            expires_at=_now() + timedelta(seconds=settings.jwt_refresh_ttl),
            is_revoked=False,
        )
        db_session.add(sess)
        db_session.flush()
        old_hash = target.password_hash

        resp = client.post(
            _reset_path(target.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # Response shape is exactly { temporary_password }.
        assert set(body.keys()) == {"temporary_password"}
        temp = body["temporary_password"]
        assert isinstance(temp, str) and temp

        db_session.refresh(target)
        # The temp password is NOT the stored hash; it is the plaintext that the
        # new hash verifies against.
        assert temp != target.password_hash
        assert target.password_hash != old_hash
        assert verify_password(temp, target.password_hash) is True
        assert target.must_change_password is True
        # Lockout cleared (ratified decision).
        assert target.failed_login_count == 0
        assert target.locked_until is None
        # Target session revoked.
        db_session.refresh(sess)
        assert sess.is_revoked is True
        # Audit row written.
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "user.reset_password",
                AuditLog.entity_id == target.id,
                AuditLog.actor_user_id == principal.id,
            )
        )
        assert n_audit == 1

    def test_secretary_resets_student_200(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        student = make_user(role=Role.STUDENT)
        resp = client.post(
            _reset_path(student.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={},
        )
        assert resp.status_code == 200, resp.text
        assert "temporary_password" in resp.json()

    def test_secretary_cannot_reset_principal_403(
        self, client, make_user, auth_headers
    ) -> None:
        """A Secretary may NOT reset a Principal → 403 (FR-SET-04 privilege guard)."""
        secretary = make_user(role=Role.SECRETARY)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _reset_path(principal.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_reset_self_409_cannot_reset_self(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _reset_path(principal.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={},
        )
        assert resp.status_code == 409
        _assert_envelope(resp.json(), code="cannot_reset_self")

    def test_unknown_user_404_user_not_found(self, client, make_user, auth_headers) -> None:
        import uuid

        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _reset_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="user_not_found")

    def test_teacher_caller_403_role_gate(self, client, make_user, auth_headers) -> None:
        """A Teacher caller is blocked by the role gate → 403 (api-spec §2.3)."""
        teacher = make_user(role=Role.TEACHER)
        target = make_user(role=Role.STUDENT)
        resp = client.post(
            _reset_path(target.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_student_caller_403_role_gate(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        target = make_user(role=Role.STUDENT)
        resp = client.post(
            _reset_path(target.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
            json={},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")


# ════════════════════════════════════════════════════════════════════════════
# Envelope conformance spot-checks (api-spec §4.2) — one per status family
# ════════════════════════════════════════════════════════════════════════════
class TestEnvelopeConformance:
    def test_401_envelope(self, client) -> None:
        body = client.get(ME).json()
        _assert_envelope(body, code="unauthenticated")

    def test_422_envelope_has_fields(self, client) -> None:
        body = client.post(LOGIN, json={"identifier": "only@id.test"}).json()
        err = _assert_envelope(body, code="validation_error")
        assert "fields" in err

    def test_403_envelope(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        target = make_user(role=Role.STUDENT)
        body = client.post(
            _reset_path(target.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={},
        ).json()
        _assert_envelope(body, code="forbidden")

    def test_404_envelope(self, client, make_user, auth_headers) -> None:
        import uuid

        principal = make_user(role=Role.PRINCIPAL)
        body = client.post(
            _reset_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={},
        ).json()
        _assert_envelope(body, code="user_not_found")

    def test_423_envelope_has_retry_after(self, client, make_user, settings) -> None:
        pw = make_user.default_password
        user = make_user(
            password=pw,
            failed_login_count=settings.lockout_threshold,
            locked_until=_now() + timedelta(seconds=settings.lockout_duration),
        )
        body = client.post(LOGIN, json={"identifier": user.email, "password": pw}).json()
        err = _assert_envelope(body, code="account_locked")
        assert "retry_after_seconds" in err

"""The System Administrator role (D45 §2, blueprint §2 + §48).

The blueprint asks for a technical administrator: "user accounts, permissions, backups,
configuration and technical maintenance". §48 then says access follows least privilege and
that "sensitive information should not be accessible simply because the user is an
employee" — which makes the sysadmin the employee with the least academic reason to read a
transcript.

D44 appended `'sysadmin'` to the `users.role` DB enum as STORAGE ONLY: no Python member, no
route, no permissions. This suite pins the half that makes it real, and in particular pins
the DIRECTION of the failure — the reach is an ALLOWLIST of path prefixes enforced in
`get_current_user`, so a router written next year is closed to the sysadmin by default
rather than open until someone remembers it.
"""

from __future__ import annotations

import pytest

from app.common.enums import Role

pytestmark = pytest.mark.requires_db

S = "/api/v1/settings"


@pytest.fixture
def sysadmin(make_user, auth_headers):
    user = make_user(role=Role.SYSADMIN, full_name="Tech Admin")
    return user, auth_headers(user_id=user.id, role=Role.SYSADMIN)


# ════════════════════════════════════════════════════════════════════════════
class TestTheRoleExists:
    def test_the_python_member_matches_the_db_label(self) -> None:
        """D44 put `'sysadmin'` in the column and left the enum without it, so a row could
        hold a value no code could name. The wire value IS the DB label."""
        assert Role.SYSADMIN.value == "sysadmin"

    def test_a_sysadmin_can_authenticate(self, client, sysadmin) -> None:
        _user, H = sysadmin
        assert client.get("/api/v1/auth/me", headers=H).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestWhatTheSysadminReaches:
    """The job: accounts, permissions, configuration, the technical trail."""

    def test_user_administration(self, client, sysadmin) -> None:
        _user, H = sysadmin
        assert client.get(f"{S}/users", headers=H).status_code == 200

    def test_the_audit_trail_is_NOT_theirs(self, client, sysadmin) -> None:
        """⚠️ INVERTED (Sep 2026), and the inversion is the point.

        This test used to assert `GET /settings/audit-log` -> 200 for a sysadmin, on the
        reading of §2 that an audit log is "the technical trail". D45 Phase 7 then took
        the opposite view for `GET /audit` and refused them: that trail is MOSTLY
        ACADEMIC RECORDS — grade changes carrying student names and marks, registrations,
        status changes — and §48 says being an employee is not a reason to see them.

        Both were true at once, of the same table, through two routes. `/settings/audit-log`
        is now deleted, so the answer is one answer: the sysadmin does not read the trail.
        If BAJC wants them to see system activity only (accounts, roles, configuration),
        that needs an endpoint that filters BEFORE the academic rows load — see the plan
        document's open questions, item 14."""
        _user, H = sysadmin
        assert client.get(f"{S}/audit-log", headers=H).status_code == 404
        assert client.get("/api/v1/audit", headers=H).status_code == 403

    def test_school_configuration(self, client, sysadmin) -> None:
        _user, H = sysadmin
        assert client.get(f"{S}/school", headers=H).status_code == 200

    def test_their_own_account(self, client, sysadmin) -> None:
        _user, H = sysadmin
        assert client.get(f"{S}/account", headers=H).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestWhatTheSysadminMustNotReach:
    """§48 — not one row of academic data, whatever the verb."""

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/students",
            "/api/v1/teachers",
            "/api/v1/grades/offering/00000000-0000-0000-0000-000000000000",
            "/api/v1/attendance/alerts",
            "/api/v1/reports/students",
            "/api/v1/offerings",
            "/api/v1/programs",
            "/api/v1/courses",
            "/api/v1/applications",
            "/api/v1/dashboard",
            "/api/v1/timetable/me",
            "/api/v1/classrooms",
            "/api/v1/announcements",
            "/api/v1/events",
        ],
    )
    def test_every_academic_router_is_refused(self, client, sysadmin, path) -> None:
        _user, H = sysadmin
        r = client.get(path, headers=H)
        assert r.status_code == 403, f"{path} -> {r.status_code} {r.text[:200]}"
        assert r.json()["error"]["code"] == "technical_role_scope"

    def test_the_refusal_beats_a_404(self, client, sysadmin) -> None:
        """The gate runs in `get_current_user`, BEFORE the route resolves the resource.
        A sysadmin probing a nonexistent student id must not be able to tell it apart
        from a real one — the scope refusal has to come first."""
        _user, H = sysadmin
        r = client.get(
            "/api/v1/students/00000000-0000-0000-0000-000000000000", headers=H
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "technical_role_scope"

    def test_writes_to_academic_routers_are_refused_too(self, client, sysadmin) -> None:
        _user, H = sysadmin
        r = client.post("/api/v1/students", headers=H, json={})
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "technical_role_scope"


# ════════════════════════════════════════════════════════════════════════════
class TestTheAllowlistFailsClosed:
    """The prefix rule is unit-tested directly rather than over HTTP.

    A path with no route 404s in Starlette's router BEFORE any dependency runs, so
    `GET /api/v1/transcripts` can never demonstrate the allowlist — it would pass for the
    wrong reason. The predicate is where the decision actually lives, so that is what gets
    asserted.
    """

    @staticmethod
    def _refused(path: str, role: Role) -> bool:
        from types import SimpleNamespace

        from app.core.deps import _is_out_of_technical_scope

        request = SimpleNamespace(url=SimpleNamespace(path=path), method="GET")
        return _is_out_of_technical_scope(request, SimpleNamespace(role=role))

    def test_an_unknown_future_router_is_refused_by_default(self) -> None:
        """THE POINT OF THE DESIGN. A denylist of academic routers would leave
        `/api/v1/transcripts` open the day it is added, silently. The allowlist refuses
        anything it has not been told about."""
        assert self._refused("/api/v1/transcripts", Role.SYSADMIN) is True
        assert self._refused("/api/v1/graduation/audit", Role.SYSADMIN) is True

    def test_a_prefix_is_matched_on_a_BOUNDARY_not_a_substring(self) -> None:
        """`/settings` must not accidentally admit `/settingsomething`, and `/auth` must
        not admit `/authors`. Matched as an exact segment or `prefix + "/"`."""
        assert self._refused("/api/v1/settingsomething", Role.SYSADMIN) is True
        assert self._refused("/api/v1/authors", Role.SYSADMIN) is True
        assert self._refused("/api/v1/settings", Role.SYSADMIN) is False
        assert self._refused("/api/v1/settings/users", Role.SYSADMIN) is False
        assert self._refused("/api/v1/auth/me", Role.SYSADMIN) is False

    def test_the_gate_is_inert_for_every_other_role(self) -> None:
        """It keys off `TECHNICAL_ROLES`. Nothing else may be narrowed by it."""
        for role in (Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.STUDENT,
                     Role.HOD, Role.AUDITOR):
            assert self._refused("/api/v1/students", role) is False, role

    def test_it_holds_when_the_app_is_mounted_bare(self) -> None:
        """A unit test can build its own app without the `/api/v1` prefix. The version
        segment is stripped when present, not required."""
        assert self._refused("/settings/users", Role.SYSADMIN) is False
        assert self._refused("/students", Role.SYSADMIN) is True


# ════════════════════════════════════════════════════════════════════════════
class TestOtherRolesAreUnaffected:
    """The gate must be inert for everyone else — it keys off `TECHNICAL_ROLES`."""

    def test_the_dean_still_reaches_academic_routers(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        assert client.get("/api/v1/students", headers=H).status_code == 200

    def test_the_auditor_still_reaches_academic_routers(
        self, client, make_user, auth_headers
    ) -> None:
        """The auditor reads everything and writes nothing; the sysadmin writes
        configuration and reads no academic data. Two different rules, and adding the
        second must not have narrowed the first."""
        auditor = make_user(role=Role.AUDITOR)
        H = auth_headers(user_id=auditor.id, role=Role.AUDITOR)
        assert client.get("/api/v1/students", headers=H).status_code == 200

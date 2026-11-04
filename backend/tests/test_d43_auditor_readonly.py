"""D43 — the Auditor role reads everything and writes nothing.

**Why this suite is verb-driven rather than endpoint-driven.** `require_role` is an
allowlist of role NAMES; it cannot express "GET only". Expressing the auditor's rule
through it would have meant getting all 121 `Depends(...)` tuples across 17 routers
right, where one miss is a read-only account that can delete a student. So the ban lives
in `get_current_user` — the single dependency every authenticated route passes through —
and the test that matters is not "is endpoint X guarded" but **"is there ANY mutating
route in the whole app that an auditor can reach"**.

`test_no_mutating_route_is_reachable` therefore walks the live FastAPI route table rather
than a hand-written list. A route added next year by someone who has never heard of this
role is covered the day it is written, and cannot be forgotten the way a checklist can.

The three exemptions are the writes that are not writes to school data — logout, own
password, own preferences. The password one is load-bearing: it is the only way out of
`must_change_password`, so banning it would permanently trap an auditor issued a
temporary password.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import pytest

from app.common.enums import Role

pytestmark = pytest.mark.requires_db

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

#: Path suffixes the guard deliberately lets through — mirrors `deps._READ_ONLY_EXEMPT`.
_EXEMPT = {
    ("POST", "/auth/logout"),
    ("PATCH", "/auth/me/password"),
    ("PATCH", "/auth/me/preferences"),
}

#: Routes the guard cannot and must not touch: they do not depend on `get_current_user`
#: at all, authenticating by password / refresh cookie instead. An auditor "reaching"
#: login is an auditor logging in. Listed explicitly so the walk below stays a whitelist
#: of known exceptions rather than quietly skipping anything that fails to 401.
_UNAUTHENTICATED = {
    ("POST", "/auth/login"),
    ("POST", "/auth/refresh"),
    ("POST", "/auth/password-reset/request"),
    ("POST", "/auth/password-reset/confirm"),
}


def _assert_envelope(body: dict, *, code: str) -> None:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body


def _skip(path: str, method: str) -> bool:
    """Whether the route walk should pass over this (method, path)."""
    stripped = path.rstrip("/") or "/"
    return any(
        method == m and stripped.endswith(s) for m, s in _EXEMPT | _UNAUTHENTICATED
    )


class TestAuditorCannotWrite:
    def test_write_is_refused_with_the_read_only_code(
        self, client, make_user, auth_headers
    ) -> None:
        """The canonical refusal: a distinct code, not a generic `forbidden`.

        The distinction matters to the client — "you are not allowed here" and "your
        account never writes anywhere" are different messages and the UI shows different
        things for them.
        """
        auditor = make_user(role=Role.AUDITOR)
        resp = client.post(
            "/api/v1/courses",
            json={"name": "Ledgerless Accounting", "code": "ACC9999", "credits": 3},
            headers=auth_headers(user_id=auditor.id, role=Role.AUDITOR),
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="read_only_role")

    def test_no_mutating_route_is_reachable(
        self, app, client, make_user, auth_headers
    ) -> None:
        """Walk the REAL route table: no mutating route may answer an auditor.

        This is the test that makes the guard a guarantee instead of a claim. It asserts
        over the app's own routes, so it grows automatically with the API.

        A refusal is any 4xx that is not 405 (wrong verb for the path). We accept 403
        `read_only_role` as the expected answer and fail loudly on anything that got
        PAST the guard into real handling — 200/201/204, or a 409/422 that proves the
        request reached business logic.
        """
        auditor = make_user(role=Role.AUDITOR)
        headers = auth_headers(user_id=auditor.id, role=Role.AUDITOR)

        leaked: list[str] = []
        seen_verbs: set[str] = set()
        checked = 0

        for route in app.routes:
            path = getattr(route, "path", None)
            methods = getattr(route, "methods", None) or set()
            if not path or not path.startswith("/api/v1"):
                continue
            for method in sorted(methods & _WRITE_METHODS):
                if _skip(path, method):
                    continue
                # Fill path params with a syntactically valid UUID; the guard fires
                # long before anything tries to look it up.
                concrete = path
                while "{" in concrete:
                    head, _, rest = concrete.partition("{")
                    _, _, tail = rest.partition("}")
                    concrete = f"{head}00000000-0000-4000-8000-000000000000{tail}"

                resp = client.request(method, concrete, json={}, headers=headers)
                checked += 1
                seen_verbs.add(method)
                if resp.status_code != 403 or resp.json().get("error", {}).get(
                    "code"
                ) != "read_only_role":
                    leaked.append(f"{method} {path} → {resp.status_code} {resp.text[:120]}")

        assert checked > 50, f"route walk found only {checked} mutating routes — too few"
        # No verb is special, and this asserts the walk actually exercised all four
        # rather than passing because it only ever tried POST.
        assert seen_verbs == _WRITE_METHODS, f"verbs not covered: {_WRITE_METHODS - seen_verbs}"
        assert not leaked, "auditor reached a mutating route:\n" + "\n".join(leaked)


class TestAuditorKeepsItsOwnAccount:
    def test_logout_still_works(self, client, make_user, auth_headers) -> None:
        """Walking away must always be possible."""
        auditor = make_user(role=Role.AUDITOR)
        resp = client.post(
            "/api/v1/auth/logout",
            headers=auth_headers(user_id=auditor.id, role=Role.AUDITOR),
        )
        assert resp.status_code in (200, 204), resp.text

    def test_own_password_change_is_not_banned_by_the_read_only_guard(
        self, client, make_user, auth_headers
    ) -> None:
        """The only way out of `must_change_password`. Banning it traps the account.

        Asserts on the CODE, not merely the status: a 403 here would be fine by accident
        if it came from a wrong current password, and that would hide the trap.
        """
        auditor = make_user(role=Role.AUDITOR, must_change_password=True)
        resp = client.patch(
            "/api/v1/auth/me/password",
            json={
                "current_password": make_user.default_password,
                "new_password": "An0ther!Sup3rSecret",
            },
            headers=auth_headers(user_id=auditor.id, role=Role.AUDITOR),
        )
        assert resp.status_code != 403 or resp.json()["error"]["code"] != "read_only_role", (
            "the read-only guard trapped the account in must_change_password: "
            f"{resp.text}"
        )


class TestOtherRolesAreUnaffected:
    """The guard keys on the ROLE. Nobody else may notice it exists."""

    @pytest.mark.parametrize(
        "role", [Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.STUDENT, Role.HOD]
    )
    def test_write_refusals_for_other_roles_are_never_read_only(
        self, client, make_user, auth_headers, role
    ) -> None:
        """A Student POSTing to /courses must still get plain `forbidden`.

        If this ever returned `read_only_role` the guard would be keying on something
        other than the role and would eventually ban a lecturer from entering grades.
        """
        user = make_user(role=role)
        resp = client.post(
            "/api/v1/courses",
            json={"name": "Probe", "code": "PRB9999", "credits": 3},
            headers=auth_headers(user_id=user.id, role=role),
        )
        if resp.status_code == 403:
            assert resp.json()["error"]["code"] != "read_only_role", (
                f"{role.value} was refused as read-only: {resp.text}"
            )

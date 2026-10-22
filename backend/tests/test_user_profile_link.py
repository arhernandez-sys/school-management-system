"""A login is linked to the lecturer / student profile it belongs to, at creation.

Before this, a lecturer created WITHOUT a login could never get one: `POST
/settings/users` made a bare `users` row and nothing linked it to the profile. That
login then 404'd on its own students and offerings, because every lecturer-scoped
read starts by resolving the caller's `teacher_profiles` row
(`app.core.rbac._teacher_profile_id`) and treats "none" as not-found.

Now student / teacher / hod logins must name an unlinked profile (`profile_id`), the
picker reads `GET /settings/users/linkable-profiles`, and a role change cannot move a
login into one of those roles without its profile. The roles that take no profile -
principal, secretary, auditor, sysadmin - are pinned here as working on the role alone.
"""

from __future__ import annotations

import uuid
from datetime import date

from app.common.enums import Role, TeacherStatus
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User
from tests.conftest import split_name

USERS = "/api/v1/settings/users"
LINKABLE = f"{USERS}/linkable-profiles"


def _teacher(db, *, user_id=None, name="Lin Lecturer") -> TeacherProfile:  # noqa: ANN001
    t = TeacherProfile(
        user_id=user_id, staff_number=f"L-{uuid.uuid4().hex[:8]}",
        full_name=name, status=TeacherStatus.ACTIVE, email="lin@example.test",
    )
    db.add(t)
    db.flush()
    return t


def _student(db, *, user_id=None, name="Sam Student") -> StudentProfile:  # noqa: ANN001
    s = StudentProfile(
        user_id=user_id, student_number=f"S-{uuid.uuid4().hex[:8]}", **split_name(name),
        date_of_birth=date(2006, 1, 1), enrollment_date=date(2025, 9, 1), status="Active",
    )
    db.add(s)
    db.flush()
    return s


def _first_login_done(db, user_id) -> None:  # noqa: ANN001
    """A new login must change its password before anything else answers; that gate
    is not what these tests are about, so pass it."""
    db.get(User, user_id).must_change_password = False
    db.flush()


def _new_email() -> str:
    return f"link_{uuid.uuid4().hex[:8]}@test.local"


class TestLinkableProfiles:
    def test_lists_only_unlinked_profiles_of_the_roles_kind(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        free = _teacher(db_session, name="Zed Unlinked")
        taken = _teacher(db_session, user_id=make_user(role=Role.TEACHER).id, name="Zed Taken")
        stu = _student(db_session, name="Zed Pupil")

        ids = {r["id"] for r in client.get(LINKABLE, params={"role": "teacher", "search": "Zed"}, headers=H).json()}
        assert str(free.id) in ids
        assert str(taken.id) not in ids
        assert str(stu.id) not in ids

        # An HOD is a lecturer: same table.
        hod_ids = {r["id"] for r in client.get(LINKABLE, params={"role": "hod", "search": "Zed"}, headers=H).json()}
        assert str(free.id) in hod_ids

        stu_rows = client.get(LINKABLE, params={"role": "student", "search": "Zed"}, headers=H).json()
        assert [r["id"] for r in stu_rows] == [str(stu.id)]
        assert stu_rows[0]["kind"] == "student" and stu_rows[0]["number"] == stu.student_number

    def test_search_matches_the_staff_number(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        t = _teacher(db_session)
        rows = client.get(
            LINKABLE, params={"role": "teacher", "search": t.staff_number},
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        assert [r["id"] for r in rows] == [str(t.id)]

    def test_profile_free_roles_get_an_empty_list(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        _teacher(db_session)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        for role in ("auditor", "sysadmin", "secretary", "principal"):
            assert client.get(LINKABLE, params={"role": role}, headers=H).json() == []

    def test_a_lecturer_cannot_read_it(self, client, make_user, auth_headers) -> None:
        t = make_user(role=Role.TEACHER)
        resp = client.get(
            LINKABLE, params={"role": "teacher"},
            headers=auth_headers(user_id=t.id, role=Role.TEACHER),
        )
        assert resp.status_code == 403


class TestCreateLinksTheProfile:
    def test_new_lecturer_login_is_linked_and_can_read_its_own_scope(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The reported defect, end to end: the new login's students/offerings no
        longer 404."""
        dean = make_user(role=Role.PRINCIPAL)
        t = _teacher(db_session)
        resp = client.post(
            USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"email": _new_email(), "full_name": t.full_name, "role": "teacher",
                  "profile_id": str(t.id)},
        )
        assert resp.status_code == 201, resp.text
        new_id = uuid.UUID(resp.json()["user"]["id"])
        db_session.refresh(t)
        assert t.user_id == new_id
        _first_login_done(db_session, new_id)

        H = auth_headers(user_id=new_id, role=Role.TEACHER)
        for path in ("/api/v1/students", "/api/v1/offerings", "/api/v1/auth/me"):
            r = client.get(path, headers=H)
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"
        me = client.get("/api/v1/auth/me", headers=H).json()
        assert me.get("teacher_id") == str(t.id) or str(t.id) in str(me)

    def test_new_student_login_is_linked(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        s = _student(db_session)
        resp = client.post(
            USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"email": _new_email(), "full_name": "Sam Student", "role": "student",
                  "profile_id": str(s.id)},
        )
        assert resp.status_code == 201, resp.text
        db_session.refresh(s)
        assert s.user_id == uuid.UUID(resp.json()["user"]["id"])

    def test_lecturer_login_without_a_profile_is_refused_and_not_created(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        email = _new_email()
        for role in ("teacher", "hod", "student"):
            resp = client.post(
                USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
                json={"email": email, "full_name": "Nobody", "role": role},
            )
            assert resp.status_code == 422, resp.text
            assert resp.json()["error"]["code"] == "profile_required"
        assert db_session.query(User).filter(User.email == email).count() == 0

    def test_already_linked_profile_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        t = _teacher(db_session, user_id=make_user(role=Role.TEACHER).id)
        resp = client.post(
            USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"email": _new_email(), "full_name": "X", "role": "teacher",
                  "profile_id": str(t.id)},
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"]["code"] == "profile_already_linked"

    def test_wrong_kind_of_profile_404(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A student profile id offered for a lecturer login."""
        dean = make_user(role=Role.PRINCIPAL)
        s = _student(db_session)
        resp = client.post(
            USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"email": _new_email(), "full_name": "X", "role": "teacher",
                  "profile_id": str(s.id)},
        )
        assert resp.status_code == 404, resp.text
        db_session.refresh(s)
        assert s.user_id is None

    def test_profile_free_role_refuses_a_profile(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        t = _teacher(db_session)
        resp = client.post(
            USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"email": _new_email(), "full_name": "X", "role": "auditor",
                  "profile_id": str(t.id)},
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "profile_not_allowed"


class TestProfileFreeRoles:
    def test_create_and_use_without_any_profile(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Principal, secretary, auditor and sysadmin need only their role. No 404 and
        no 500 on the screens they land on; a sysadmin's 403 on academic data is its
        allowlist doing its job, not a missing profile."""
        dean = make_user(role=Role.PRINCIPAL)
        for role in (Role.PRINCIPAL, Role.SECRETARY, Role.AUDITOR, Role.SYSADMIN):
            resp = client.post(
                USERS, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
                json={"email": _new_email(), "full_name": f"New {role.value}", "role": role.value},
            )
            assert resp.status_code == 201, f"{role}: {resp.text}"
            new_id = uuid.UUID(resp.json()["user"]["id"])
            _first_login_done(db_session, new_id)
            H = auth_headers(user_id=new_id, role=role)
            for path in ("/api/v1/auth/me", "/api/v1/dashboard", "/api/v1/students",
                         "/api/v1/offerings", USERS):
                r = client.get(path, headers=H)
                assert r.status_code not in (404, 500), f"{role.value} {path}: {r.status_code} {r.text[:200]}"
                if role != Role.SYSADMIN:
                    assert r.status_code == 200, f"{role.value} {path}: {r.status_code} {r.text[:200]}"


class TestRoleChangeKeepsTheLink:
    def test_into_a_lecturer_role_without_a_profile_422(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.AUDITOR)
        resp = client.patch(
            f"{USERS}/{target.id}", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"role": "teacher"},
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "profile_required"

    def test_lecturer_promoted_to_hod_keeps_its_profile(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.TEACHER)
        _teacher(db_session, user_id=target.id)
        resp = client.patch(
            f"{USERS}/{target.id}", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"role": "hod"},
        )
        assert resp.status_code == 200, resp.text


class TestUnlinkedLoginSeesEmptyPages:
    """A lecturer or student login with no linked profile gets EMPTY answers, never an
    error: the same thing a lecturer who teaches nothing, or a student with nothing
    recorded, sees. Only GET /students/me keeps its 404 no_student_profile (there is no
    record to describe); the frontend renders that code as an empty profile."""

    LECTURER_LISTS = (
        "/api/v1/students", "/api/v1/offerings", "/api/v1/assessments",
        "/api/v1/assessments/offerings", "/api/v1/grades/offerings", "/api/v1/grades/term",
        "/api/v1/attendance/offerings", "/api/v1/attendance/alerts", "/api/v1/timetable/me",
        "/api/v1/dashboard",
    )
    STUDENT_PAGES = (
        "/api/v1/students/me/years", "/api/v1/attendance/me", "/api/v1/timetable/me",
        "/api/v1/dashboard", "/api/v1/auth/me",
    )

    def test_unlinked_lecturer_gets_empty_lists(self, client, make_user, auth_headers) -> None:
        for role in (Role.TEACHER, Role.HOD):
            u = make_user(role=role)
            H = auth_headers(user_id=u.id, role=role)
            for path in self.LECTURER_LISTS:
                r = client.get(path, headers=H)
                # An HOD's 403 on a lecturer-only screen is its role gate, not a profile.
                ok = (200, 403) if role == Role.HOD else (200,)
                assert r.status_code in ok, f"{role.value} {path}: {r.status_code} {r.text[:200]}"
            page = client.get("/api/v1/students", headers=H).json()
            assert page["items"] == [] and page["total"] == 0

    def test_unlinked_lecturer_still_cannot_open_a_specific_offering(
        self, client, make_user, auth_headers, db_session, make_offering
    ) -> None:
        """Empty lists must not become access: ownership checks still say 404."""
        from app.modules.offerings.models import Course

        tag = uuid.uuid4().hex[:6]
        course = Course(name=f"Unlinked {tag}", code=f"UL{tag.upper()}")
        db_session.add(course)
        db_session.flush()
        off = make_offering(course.id)
        u = make_user(role=Role.TEACHER)
        r = client.get(
            f"/api/v1/grades/offering/{off.id}",
            headers=auth_headers(user_id=u.id, role=Role.TEACHER),
        )
        assert r.status_code in (403, 404), r.text

    def test_unlinked_student_gets_empty_pages(self, client, make_user, auth_headers) -> None:
        u = make_user(role=Role.STUDENT)
        H = auth_headers(user_id=u.id, role=Role.STUDENT)
        for path in self.STUDENT_PAGES:
            r = client.get(path, headers=H)
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"
        assert client.get("/api/v1/students/me/years", headers=H).json() == {"items": []}
        att = client.get("/api/v1/attendance/me", headers=H).json()
        assert att["history"] == []
        me = client.get("/api/v1/students/me", headers=H)
        assert me.status_code == 404 and me.json()["error"]["code"] == "no_student_profile"


class TestEditRelinksTheProfile:
    """The edit form carries the same picker as create: an existing login can be linked
    for the first time, or re-pointed at another profile with no login."""

    def test_links_a_login_that_never_had_one(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.TEACHER)
        t = _teacher(db_session)
        resp = client.patch(
            f"{USERS}/{target.id}", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"profile_id": str(t.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["linked_profile"]["id"] == str(t.id)
        db_session.refresh(t)
        assert t.user_id == target.id

    def test_relink_releases_the_old_profile(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.SECRETARY)
        target = make_user(role=Role.STUDENT)
        old = _student(db_session, user_id=target.id, name="Old Pupil")
        new = _student(db_session, name="New Pupil")
        resp = client.patch(
            f"{USERS}/{target.id}", headers=auth_headers(user_id=dean.id, role=Role.SECRETARY),
            json={"profile_id": str(new.id)},
        )
        assert resp.status_code == 200, resp.text
        db_session.refresh(old)
        db_session.refresh(new)
        assert old.user_id is None and new.user_id == target.id

    def test_resending_the_current_profile_is_a_no_op(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.TEACHER)
        t = _teacher(db_session, user_id=target.id)
        resp = client.patch(
            f"{USERS}/{target.id}", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"full_name": "Renamed", "profile_id": str(t.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["linked_profile"]["id"] == str(t.id)

    def test_role_change_with_a_profile_passes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """auditor -> lecturer was refused for want of a profile; naming one fixes it."""
        dean = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.AUDITOR)
        t = _teacher(db_session)
        resp = client.patch(
            f"{USERS}/{target.id}", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"role": "teacher", "profile_id": str(t.id)},
        )
        assert resp.status_code == 200, resp.text
        db_session.refresh(t)
        assert t.user_id == target.id

    def test_refusals_match_create(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        lecturer = make_user(role=Role.TEACHER)
        mine = _teacher(db_session, user_id=lecturer.id)
        taken = _teacher(db_session, user_id=make_user(role=Role.TEACHER).id)
        stu = _student(db_session)
        auditor = make_user(role=Role.AUDITOR)

        r = client.patch(f"{USERS}/{lecturer.id}", headers=H, json={"profile_id": str(taken.id)})
        assert r.status_code == 409 and r.json()["error"]["code"] == "profile_already_linked"
        r = client.patch(f"{USERS}/{lecturer.id}", headers=H, json={"profile_id": str(stu.id)})
        assert r.status_code == 404, r.text
        r = client.patch(f"{USERS}/{auditor.id}", headers=H, json={"profile_id": str(stu.id)})
        assert r.status_code == 422 and r.json()["error"]["code"] == "profile_not_allowed"
        db_session.refresh(mine)
        db_session.refresh(stu)
        assert mine.user_id == lecturer.id and stu.user_id is None

    def test_list_shows_the_link(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.TEACHER)
        t = _teacher(db_session, user_id=target.id)
        page = client.get(
            USERS, params={"search": target.email, "page_size": 5},
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        row = next(u for u in page["items"] if u["id"] == str(target.id))
        assert row["linked_profile"]["number"] == t.staff_number

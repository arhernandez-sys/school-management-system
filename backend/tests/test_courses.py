"""Comprehensive pytest suite for Module 5b — COURSES catalog (api-spec §5b).

Scope: the 4 catalog endpoints (GET list / POST / PATCH / DELETE) + their
negative / edge / security paths.

Oracle: api-specification.md §5b (Module 5b — Subjects), §3.4 permission matrix,
§4.2 ErrorResponse envelope, §6 pagination.

Hermetic + rolled-back via the `db_session` transactional rollback (conftest
7.0c). The `Subject` model lives in app/modules/classes/models.py. The
DELETE course_in_use guard is exercised by creating a CourseOffering offering via
the `make_offering` conftest fixture (inside the rollback).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.common.enums import Role
from app.modules.offerings.models import Course
from app.modules.settings.models import AuditLog

pytestmark = pytest.mark.requires_db

COURSES = "/api/v1/courses"


def _subject_path(subject_id) -> str:  # noqa: ANN001
    return f"/api/v1/courses/{subject_id}"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert "code" in err and "message" in err
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


def _make_subject(
    db_session, *, name=None, code=None, credits=3, component=None, is_active=True
) -> Course:
    """Insert a course directly in the rolled-back session (for read/guard setup).

    D30: `code` is NOT NULL on `courses`, so it is defaulted here rather than left
    None — a code-less course is no longer representable, which is the point."""
    s = Course(
        name=name or f"Subject {uuid.uuid4().hex[:8]}",
        code=code or uuid.uuid4().hex[:8].upper(),
        credits=credits,
        component=component,
        is_active=is_active,
    )
    db_session.add(s)
    db_session.flush()
    return s


# ════════════════════════════════════════════════════════════════════════════
# GET /subjects
# ════════════════════════════════════════════════════════════════════════════
class TestListSubjects:
    def test_list_authenticated_any_role_page_shape(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """GET /subjects (authenticated — everyone reads reference data) →
        Page[SubjectListItem]."""
        # Unique code — a hardcoded code (e.g. "MATH") collides with seeded data.
        _make_subject(db_session, name=f"Math {uuid.uuid4().hex[:6]}", code=uuid.uuid4().hex[:6].upper())
        student = make_user(role=Role.STUDENT)
        resp = client.get(COURSES, headers=auth_headers(user_id=student.id, role=Role.STUDENT))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"items", "total", "page", "page_size", "total_pages"} <= set(body.keys())
        if body["items"]:
            item = body["items"][0]
            # D30 §D2: `credits` is the field that finally lets a stored grade reach a
            # credit value (plan §B3), so it is part of the list shape, not just detail.
            assert {"id", "name", "code", "credits", "component", "is_active"} == set(
                item.keys()
            )

    def test_list_unauthenticated_401(self, client) -> None:
        resp = client.get(COURSES)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_list_default_hides_retired(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Default (no is_active param) hides retired subjects (is_active=false)."""
        retired = _make_subject(
            db_session, name=f"Retired {uuid.uuid4().hex[:6]}", is_active=False
        )
        active = _make_subject(
            db_session, name=f"Active {uuid.uuid4().hex[:6]}", is_active=True
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            COURSES,
            params={"page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(active.id) in ids
        assert str(retired.id) not in ids

    def test_list_is_active_false_shows_retired(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """?is_active=false opts into the retired view."""
        retired = _make_subject(
            db_session, name=f"Retired {uuid.uuid4().hex[:6]}", is_active=False
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            COURSES,
            params={"is_active": "false", "page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(retired.id) in ids
        # And all returned rows are retired.
        assert all(i["is_active"] is False for i in resp.json()["items"])

    def test_list_search_filter(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        tag = uuid.uuid4().hex[:8]
        s = _make_subject(db_session, name=f"Zoology{tag}", code=f"ZOO{tag[:4]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            COURSES,
            params={"search": f"Zoology{tag}"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(s.id) in ids

    def test_list_invalid_sort_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            COURSES,
            params={"sort": "color"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="invalid_sort_field")


# ════════════════════════════════════════════════════════════════════════════
# POST /subjects
# ════════════════════════════════════════════════════════════════════════════
class TestCreateSubject:
    def test_create_by_principal_201(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        name = f"Chemistry {uuid.uuid4().hex[:6]}"
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": name, "code": f"CHEM{uuid.uuid4().hex[:4]}"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["name"] == name
        assert body["is_active"] is True
        # Audit row written.
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "course.create",
                AuditLog.entity_id == uuid.UUID(body["id"]),
            )
        )
        assert n_audit == 1

    def test_create_by_secretary_403(self, client, make_user, auth_headers) -> None:
        """D30: the course catalog is DEAN-ONLY to write (brief §6) — "Do not allow the
        Registrar or Lecturer to create courses."

        This test previously asserted 201: the Registrar (secretary) could create a
        subject when `subjects` was a high-school subject list. Under the tertiary model
        a catalog row is an academic course with credits, a component and prerequisites,
        which is the Dean's authority. Scheduling an OFFERING of a course (`/classes`)
        is still Registrar work and is unaffected.
        """
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"name": f"Biology {uuid.uuid4().hex[:6]}", "code": f"BIOL{uuid.uuid4().hex[:4]}"},
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="forbidden")

    def test_create_duplicate_name_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        existing = _make_subject(db_session, name=f"History {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": existing.name, "code": f"HIST{uuid.uuid4().hex[:4]}"},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_course_name")

    def test_create_duplicate_name_case_insensitive_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Name uniqueness is case-insensitive (service lowercases)."""
        existing = _make_subject(db_session, name=f"Physics{uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": existing.name.upper(), "code": f"PHYS{uuid.uuid4().hex[:4]}"},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_course_name")

    def test_create_duplicate_code_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        code = f"GEO{uuid.uuid4().hex[:5]}"
        _make_subject(db_session, name=f"Geography {uuid.uuid4().hex[:6]}", code=code)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": f"Geo2 {uuid.uuid4().hex[:6]}", "code": code},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_course_code")

    def test_create_missing_name_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"code": "NONAME"},
        )
        assert resp.status_code == 422
        _assert_envelope(resp.json(), code="validation_error")

    def test_create_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"name": f"Art {uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_create_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
            json={"name": f"Music {uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# D30 §D2 — the catalog cutover from `subjects` to `courses`
# ════════════════════════════════════════════════════════════════════════════
class TestCourseCatalogCutover:
    """The behaviour `006_courses_cutover.sql` and the ORM change bought.

    These are separated from the CRUD tests above because they are about the SWAP
    itself, and one of them is a direct regression on the way it was first got wrong.
    """

    def test_code_is_required(self, client, make_user, auth_headers) -> None:
        """`courses.code` is NOT NULL where `subjects.code` was nullable.

        Without the schema change the request would reach the database and come back
        as a 500; the point of making it required in the request model is that the
        caller gets a 422 naming the field instead.
        """
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": f"Codeless {uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 422, resp.text
        assert "code" in resp.json()["error"]["fields"]

    def test_credits_and_component_round_trip(
        self, client, make_user, auth_headers
    ) -> None:
        """Credits are the whole reason the catalog moved (plan §B3)."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "name": f"Internship {uuid.uuid4().hex[:6]}",
                "code": f"EDUC{uuid.uuid4().hex[:4]}",
                "credits": 9,
                "component": "CEC",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["credits"] == 9
        assert body["component"] == "CEC"

    def test_credits_default_to_three(self, client, make_user, auth_headers) -> None:
        """The same default `005_tertiary.sql` gave the carried-over rows."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": f"Default {uuid.uuid4().hex[:6]}", "code": f"D{uuid.uuid4().hex[:5]}"},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["credits"] == 3

    def test_zero_credits_rejected(self, client, make_user, auth_headers) -> None:
        """`ck_courses_credits` is `credits > 0`; the schema says 422, not 500."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "name": f"Zero {uuid.uuid4().hex[:6]}",
                "code": f"Z{uuid.uuid4().hex[:5]}",
                "credits": 0,
            },
        )
        assert resp.status_code == 422, resp.text

    def test_a_newly_created_course_can_be_attached_to_a_class(
        self, client, make_user, auth_headers, db_session, make_offering
    ) -> None:
        """THE REGRESSION. This is the exact path that broke 73 tests once.

        An earlier version of `005` re-pointed `class_subjects.subject_id` at
        `courses` on its own. Copying the EXISTING rows across was only half the job:
        every write path still created a catalog row in `subjects`, so a course
        created through the API had nothing for the FK to resolve against and
        attaching it failed with MariaDB 1452. The fix was to move the FK swap into
        `006` and apply it WITH the ORM change — this test is what proves the two
        halves are in step, and it would fail loudly if the model were ever pointed
        back at `subjects`.
        """
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": f"Fresh {uuid.uuid4().hex[:6]}", "code": f"F{uuid.uuid4().hex[:5]}"},
        )
        assert resp.status_code == 201, resp.text
        course_id = uuid.UUID(resp.json()["id"])

        # The FK resolves → no 1452.
        offering = make_offering(course_id)
        assert offering.course_id == course_id

    def test_the_catalog_row_lives_in_courses_and_subjects_is_retired(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Belt and braces on the cutover: the row the API created is in `courses`, and
        the retired `subjects` table is gone entirely.

        D31 finished what `006` started. `006` re-pointed the FKs and left `subjects`
        standing with its 11 dormant rows; `008` renamed it to `subjects_legacy_pre_d31`.
        So the assertion changed from "no row landed in `subjects`" to "there is no
        `subjects` table to land in" — which is the stronger statement, and the one that
        fails loudly if a later migration ever recreates it.
        """
        from sqlalchemy import text

        principal = make_user(role=Role.PRINCIPAL)
        code = f"X{uuid.uuid4().hex[:5]}"
        resp = client.post(
            COURSES,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": f"Placed {uuid.uuid4().hex[:6]}", "code": code},
        )
        assert resp.status_code == 201, resp.text

        in_courses = db_session.scalar(
            text("SELECT COUNT(*) FROM courses WHERE code = :c"), {"c": code}
        )
        assert in_courses == 1

        live_subjects = db_session.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name = 'subjects'"
            )
        )
        quarantined = db_session.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() "
                "  AND table_name = 'subjects_legacy_pre_d31'"
            )
        )
        assert live_subjects == 0, "`subjects` should have been quarantined by 008"
        assert quarantined == 1, "the quarantined copy must be KEPT, never dropped"


# ════════════════════════════════════════════════════════════════════════════
# PATCH /subjects/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestUpdateSubject:
    def test_rename_200(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"OldName {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        new_name = f"NewName {uuid.uuid4().hex[:6]}"
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": new_name},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == new_name

    def test_retire_via_is_active_false(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Retire a subject by setting is_active=false (preferred over delete)."""
        s = _make_subject(db_session, name=f"ToRetire {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"is_active": False},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is False

    def test_patch_duplicate_name_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        a = _make_subject(db_session, name=f"AlphaName {uuid.uuid4().hex[:6]}")
        b = _make_subject(db_session, name=f"BetaName {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _subject_path(b.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": a.name},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_course_name")

    def test_patch_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _subject_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": "Ghost"},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_patch_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"NoTouch {uuid.uuid4().hex[:6]}")
        teacher = make_user(role=Role.TEACHER)
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"name": "Hacked"},
        )
        assert resp.status_code == 403

    def test_patch_secretary_403(self, client, make_user, auth_headers, db_session) -> None:
        """D30: catalog edits are Dean-only — the Registrar may read, not rename."""
        s = _make_subject(db_session, name=f"RegistrarNoTouch {uuid.uuid4().hex[:6]}")
        secretary = make_user(role=Role.SECRETARY)
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"name": "Renamed by the Registrar"},
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="forbidden")


# ════════════════════════════════════════════════════════════════════════════
# DELETE /subjects/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestDeleteSubject:
    def test_delete_unused_204(self, client, make_user, auth_headers, db_session) -> None:
        """A subject referenced by no offering soft-deletes → 204."""
        s = _make_subject(db_session, name=f"Unused {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 204, resp.text
        assert resp.content == b""
        # Soft-deleted: deleted_at set; no longer returned by the list.
        db_session.expire_all()
        db_session.refresh(s)
        assert s.deleted_at is not None

    def test_delete_in_use_409(
        self, client, make_user, auth_headers, db_session, make_offering
    ) -> None:
        """A subject taught in any section (CourseOffering offering) → 409
        course_in_use (retire instead). FK is RESTRICT."""
        s = _make_subject(db_session, name=f"InUse {uuid.uuid4().hex[:6]}")
        make_offering(s.id)  # creates a CourseOffering referencing the subject
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="course_in_use")

    def test_delete_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _subject_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_delete_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"NoDelete {uuid.uuid4().hex[:6]}")
        teacher = make_user(role=Role.TEACHER)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
        )
        assert resp.status_code == 403

    def test_delete_student_403(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"NoDelete2 {uuid.uuid4().hex[:6]}")
        student = make_user(role=Role.STUDENT)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403

    def test_delete_secretary_403(self, client, make_user, auth_headers, db_session) -> None:
        """D30: removing a course from the catalog is Dean-only."""
        s = _make_subject(db_session, name=f"NoDelete3 {uuid.uuid4().hex[:6]}")
        secretary = make_user(role=Role.SECRETARY)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="forbidden")

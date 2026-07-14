"""Comprehensive pytest suite for Module 7.3 — TEACHERS (api-spec §5 Module 4).

Scope: the 6 teacher endpoints (GET list / GET {id} / POST / PATCH / POST status /
DELETE) + their negative / edge / security paths.

Oracle: api-specification.md §5 Module 4 (authoritative status/error codes), §3.4
permission matrix (Teacher directory = read-only; Student → 403 on every teacher
route), §4.2 ErrorResponse envelope, §6 pagination.

Special focus (backend-engineer flagged, CASE 3): the `create_login` temp-password
contract — `temporary_password` is returned EXACTLY ONCE on POST /teachers with
create_login, and NEVER on a plain profile create or any other endpoint.

Also covered (CASE 6): teacher deactivate/delete blocked while assigned to an active
class_subject → 409 teacher_has_active_assignments.

Hermetic + rolled-back via the `db_session` transactional rollback (conftest 7.0c).
DB-dependent tests marked `requires_db` (skip cleanly with no DATABASE_URL / when
psycopg's pq DLL fails to load under the sandbox).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.classes.models import Class, ClassSubject, ClassTeacher, Subject
from app.modules.settings.models import AcademicYear, AuditLog
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User

pytestmark = pytest.mark.requires_db

TEACHERS = "/api/v1/teachers"


def _teacher_path(teacher_id) -> str:  # noqa: ANN001
    return f"/api/v1/teachers/{teacher_id}"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert isinstance(err, dict)
    assert "code" in err and "message" in err, f"missing code/message: {err}"
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


# ──────────────────────────────────────────────────────────────────────────────
# Factories
# ──────────────────────────────────────────────────────────────────────────────
def _make_teacher_profile(
    db_session,  # noqa: ANN001
    *,
    staff_number=None,
    full_name="Existing Teacher",
    status=TeacherStatus.ACTIVE,
    email=None,
    specializations=None,
    user_id=None,
) -> TeacherProfile:
    t = TeacherProfile(
        user_id=user_id,
        staff_number=staff_number or f"T{uuid.uuid4().hex[:10]}",
        full_name=full_name,
        status=status,
        email=email,
        subject_specializations=specializations or [],
    )
    db_session.add(t)
    db_session.flush()
    return t


def _active_year_id(db_session) -> uuid.UUID:  # noqa: ANN001
    return db_session.scalar(
        select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


def _assign_active_subject(db_session, teacher) -> ClassTeacher:  # noqa: ANN001
    """Give the teacher an ACTIVE class_subject assignment (for the deactivate/delete
    409 guards)."""
    section = Class(
        academic_year_id=_active_year_id(db_session),
        name=f"Section {uuid.uuid4().hex[:8]}",
        grade_level="Form 1",
    )
    db_session.add(section)
    db_session.flush()
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:8]}")
    db_session.add(subject)
    db_session.flush()
    cs = ClassSubject(class_id=section.id, subject_id=subject.id, is_active=True)
    db_session.add(cs)
    db_session.flush()
    ct = ClassTeacher(class_subject_id=cs.id, teacher_id=teacher.id)
    db_session.add(ct)
    db_session.flush()
    return ct


# ════════════════════════════════════════════════════════════════════════════
# GET /teachers — directory (P/S/Teacher RO; Student 403)
# ════════════════════════════════════════════════════════════════════════════
class TestListTeachers:
    def test_list_principal_page_shape(self, client, make_user, auth_headers, db_session) -> None:
        _make_teacher_profile(db_session, full_name=f"Dir {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(TEACHERS, headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"items", "total", "page", "page_size", "total_pages"} <= set(body.keys())
        if body["items"]:
            item = body["items"][0]
            assert {"id", "staff_number", "full_name", "status", "subject_specializations"} <= set(item.keys())

    def test_list_teacher_readonly_allowed(self, client, make_user, auth_headers) -> None:
        """FR-TCH-07: teachers may READ the directory."""
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(TEACHERS, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER))
        assert resp.status_code == 200, resp.text

    def test_list_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.get(TEACHERS, headers=auth_headers(user_id=student.id, role=Role.STUDENT))
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_list_unauthenticated_401(self, client) -> None:
        resp = client.get(TEACHERS)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_list_invalid_sort_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            TEACHERS, params={"sort": "salary"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="invalid_sort_field")

    def test_list_status_filter(self, client, make_user, auth_headers, db_session) -> None:
        inactive = _make_teacher_profile(db_session, status=TeacherStatus.INACTIVE)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            TEACHERS, params={"status": "inactive", "page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert str(inactive.id) in {i["id"] for i in items}
        assert all(i["status"] == "inactive" for i in items)

    def test_list_specialization_array_filter(self, client, make_user, auth_headers, db_session) -> None:
        tag = f"Robotics{uuid.uuid4().hex[:6]}"
        t = _make_teacher_profile(db_session, specializations=[tag, "Math"])
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            TEACHERS, params={"specialization": tag, "page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert str(t.id) in {i["id"] for i in resp.json()["items"]}


# ════════════════════════════════════════════════════════════════════════════
# GET /teachers/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestGetTeacher:
    def test_get_by_principal_200_shape(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session, specializations=["Chemistry"])
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _teacher_path(t.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(t.id)
        assert body["subject_specializations"] == ["Chemistry"]
        assert "classes_taught" in body and isinstance(body["classes_taught"], list)
        assert "audit" in body
        # Never leak a temp password on a read.
        assert "temporary_password" not in body

    def test_get_teacher_directory_readable_by_teacher(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Directory is NOT scoped by ownership — any teacher may read any teacher."""
        t = _make_teacher_profile(db_session)
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(
            _teacher_path(t.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
        )
        assert resp.status_code == 200, resp.text

    def test_get_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _teacher_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_get_student_403(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session)
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            _teacher_path(t.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /teachers — create + create_login temp-password contract (FLAGGED CASE 3)
# ════════════════════════════════════════════════════════════════════════════
class TestCreateTeacher:
    def _payload(self, **over) -> dict:
        base = {
            "staff_number": f"NEW{uuid.uuid4().hex[:8]}",
            "full_name": "New Teacher",
        }
        base.update(over)
        return base

    def test_create_plain_profile_201_no_temp_password(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 3: a plain profile create (no create_login) returns
        temporary_password=None and creates NO linked users row."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(email="contact@school.test", phone="555-1234"),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["teacher"]["staff_number"] == resp.json()["teacher"]["staff_number"]
        assert body["temporary_password"] is None, "no login provisioned → no secret"
        # Audit row for teacher.create written; NO user.create audit.
        tid = uuid.UUID(body["teacher"]["id"])
        n_teacher = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "teacher.create", AuditLog.entity_id == tid,
            )
        )
        assert n_teacher == 1

    def test_create_with_login_returns_temp_password_once(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 3: create_login=true returns a non-empty temporary_password
        EXACTLY ONCE, provisions a linked teacher users row with
        must_change_password=true, and writes both a user.create + teacher.create
        audit."""
        principal = make_user(role=Role.PRINCIPAL)
        login_email = f"newteacher_{uuid.uuid4().hex[:8]}@test.local"
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(create_login={"email": login_email, "role": "teacher"}),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        temp = body["temporary_password"]
        assert isinstance(temp, str) and temp, "temp password must be present + non-empty"

        # A linked, active teacher user exists, must_change_password=true.
        user = db_session.scalar(select(User).where(User.email == login_email))
        assert user is not None
        assert user.role == Role.TEACHER
        assert user.must_change_password is True
        assert user.is_active is True
        # The stored hash is NOT the plaintext temp password.
        assert user.password_hash != temp
        # The teacher profile is linked to the new user.
        tid = uuid.UUID(body["teacher"]["id"])
        teacher = db_session.get(TeacherProfile, tid)
        assert teacher.user_id == user.id
        # Both audits written.
        n_user = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "user.create", AuditLog.entity_id == user.id,
            )
        )
        assert n_user == 1

    def test_temp_password_not_echoed_on_subsequent_get(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 3: after create_login, GET /teachers/{id} NEVER returns the
        temp password (it is one-time, on the create response only)."""
        principal = make_user(role=Role.PRINCIPAL)
        headers = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        created = client.post(
            TEACHERS, headers=headers,
            json=self._payload(create_login={"email": f"once_{uuid.uuid4().hex[:8]}@test.local"}),
        )
        assert created.status_code == 201, created.text
        tid = created.json()["teacher"]["id"]
        got = client.get(_teacher_path(tid), headers=headers)
        assert got.status_code == 200, got.text
        assert "temporary_password" not in got.json()

    def test_create_login_email_collision_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A create_login email that collides with an existing live user → 409
        duplicate_email; no orphan teacher profile is committed (rolled back)."""
        existing = make_user(role=Role.STUDENT)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(create_login={"email": existing.email}),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_email")

    def test_create_duplicate_staff_number_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        existing = _make_teacher_profile(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(staff_number=existing.staff_number),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_staff_number")

    def test_create_duplicate_staff_number_case_insensitive_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        existing = _make_teacher_profile(db_session, staff_number=f"stf{uuid.uuid4().hex[:8]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(staff_number=existing.staff_number.upper()),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_staff_number")

    def test_create_by_secretary_201(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json=self._payload(),
        )
        assert resp.status_code == 201, resp.text

    def test_create_teacher_role_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json=self._payload(),
        )
        assert resp.status_code == 403

    def test_create_missing_full_name_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"staff_number": f"NF{uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 422, resp.text

    def test_create_extra_field_forbidden_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            TEACHERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(salary=999),
        )
        assert resp.status_code == 422, resp.text


# ════════════════════════════════════════════════════════════════════════════
# PATCH /teachers/{id} — benign profile edits (no temp password ever)
# ════════════════════════════════════════════════════════════════════════════
class TestUpdateTeacher:
    def test_patch_full_name_200(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _teacher_path(t.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"full_name": "Renamed Teacher"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["full_name"] == "Renamed Teacher"
        assert "temporary_password" not in body  # FLAGGED CASE 3: never on PATCH

    def test_patch_specializations_replace(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session, specializations=["Old"])
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _teacher_path(t.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"subject_specializations": ["Physics", "Math"]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["subject_specializations"] == ["Physics", "Math"]

    def test_patch_status_field_rejected_422(self, client, make_user, auth_headers, db_session) -> None:
        """`status` is ABSENT from TeacherUpdateRequest (extra=forbid) → PATCH cannot
        deactivate; that goes through POST /status (Principal-only)."""
        t = _make_teacher_profile(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _teacher_path(t.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "inactive"},
        )
        assert resp.status_code == 422, resp.text

    def test_patch_duplicate_staff_number_409(self, client, make_user, auth_headers, db_session) -> None:
        a = _make_teacher_profile(db_session, staff_number=f"AA{uuid.uuid4().hex[:8]}")
        b = _make_teacher_profile(db_session, staff_number=f"BB{uuid.uuid4().hex[:8]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _teacher_path(b.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"staff_number": a.staff_number},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_staff_number")

    def test_patch_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _teacher_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"full_name": "Ghost"},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_patch_teacher_role_403(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session)
        teacher = make_user(role=Role.TEACHER)
        resp = client.patch(
            _teacher_path(t.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"full_name": "Hacked"},
        )
        assert resp.status_code == 403

    def test_patch_student_403(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session)
        student = make_user(role=Role.STUDENT)
        resp = client.patch(
            _teacher_path(t.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
            json={"full_name": "Hacked"},
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /teachers/{id}/status — Principal-only, blocked if active assignments (CASE 6)
# ════════════════════════════════════════════════════════════════════════════
class TestChangeTeacherStatus:
    def test_deactivate_unassigned_200(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session, status=TeacherStatus.ACTIVE)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"{TEACHERS}/{t.id}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "inactive"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "inactive"

    def test_reactivate_200(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session, status=TeacherStatus.INACTIVE)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"{TEACHERS}/{t.id}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "active"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "active"

    def test_deactivate_with_active_assignment_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 6: deactivating a teacher assigned to an active class_subject
        is blocked → 409 teacher_has_active_assignments, with offending refs."""
        t = _make_teacher_profile(db_session, status=TeacherStatus.ACTIVE)
        _assign_active_subject(db_session, t)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"{TEACHERS}/{t.id}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "inactive"},
        )
        assert resp.status_code == 409, resp.text
        err = _assert_envelope(resp.json(), code="teacher_has_active_assignments")
        assert "class_subjects" in err and len(err["class_subjects"]) >= 1

    def test_deactivate_secretary_403(self, client, make_user, auth_headers, db_session) -> None:
        """Status change is Principal-only; Secretary → 403 (even though S can
        create/patch teachers)."""
        t = _make_teacher_profile(db_session)
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            f"{TEACHERS}/{t.id}/status",
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"status": "inactive"},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_status_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"{TEACHERS}/{uuid.uuid4()}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "inactive"},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_status_invalid_enum_422(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"{TEACHERS}/{t.id}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "on_leave"},  # not a TeacherStatus
        )
        assert resp.status_code == 422, resp.text


# ════════════════════════════════════════════════════════════════════════════
# DELETE /teachers/{id} — Principal-only, blocked if assigned (FLAGGED CASE 6)
# ════════════════════════════════════════════════════════════════════════════
class TestDeleteTeacher:
    def test_delete_unassigned_204_soft_deletes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        t = _make_teacher_profile(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _teacher_path(t.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 204, resp.text
        assert resp.content == b""
        db_session.expire_all()
        db_session.refresh(t)
        assert t.deleted_at is not None

    def test_delete_assigned_409(self, client, make_user, auth_headers, db_session) -> None:
        """FLAGGED CASE 6: any class_teachers row referencing the teacher blocks the
        delete (FK RESTRICT) → 409 teacher_has_active_assignments."""
        t = _make_teacher_profile(db_session)
        _assign_active_subject(db_session, t)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _teacher_path(t.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="teacher_has_active_assignments")

    def test_delete_secretary_403(self, client, make_user, auth_headers, db_session) -> None:
        """Delete is Principal-only; Secretary → 403."""
        t = _make_teacher_profile(db_session)
        secretary = make_user(role=Role.SECRETARY)
        resp = client.delete(
            _teacher_path(t.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
        )
        assert resp.status_code == 403

    def test_delete_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _teacher_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_delete_teacher_role_403(self, client, make_user, auth_headers, db_session) -> None:
        t = _make_teacher_profile(db_session)
        teacher = make_user(role=Role.TEACHER)
        resp = client.delete(
            _teacher_path(t.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
        )
        assert resp.status_code == 403

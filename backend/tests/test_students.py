"""Comprehensive pytest suite for Module 7.3 — STUDENTS (api-spec §5 Module 3).

Scope: the 8 student endpoints (GET list / GET me / GET {id} / GET {id}/assessments
/ POST / PATCH / POST status / DELETE) + their negative / edge / security paths,
plus a compile+execution-level regression test for the fixed rbac helper
`app.core.rbac.assert_teacher_owns_section`.

Oracle: api-specification.md §5 Module 3 (authoritative status/error codes), §3.2/§3.3
(server-derived scope + 404-vs-403 no-existence-leak discipline), §3.4 permission
matrix, §4.2 ErrorResponse envelope, §6 pagination. Where the implemented status-
transition matrix (FR-STU-04) is not spec-enumerated, tests assert the IMPLEMENTED
matrix and the module report flags it against product intent.

Hermetic + rolled-back: every test runs inside the `db_session` transactional
rollback (savepoint isolation, conftest 7.0c) so NOTHING commits to the shared
Supabase DB and the seeded principal + seeded active year `2025-2026`/`Semester 1`
stay intact. DB-dependent tests are marked `requires_db` (skip cleanly with no
DATABASE_URL / when psycopg's pq DLL fails to load under the sandbox).

Seed preconditions (progress-tracker DISCOVERY 2026-06-29): ONE active academic
year `2025-2026` with `Semester 1` active. Factories below build sections /
enrollments / class_subjects / class_teachers / grades / attendance inside the
rollback so the ownership-scope and academic-history paths are exercised end-to-end.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.common.enums import (
    AcademicYearStatus,
    AssessmentStatus,
    AssessmentType,
    GradeStatus,
    Role,
    StudentStatus,
)
from app.modules.assessments.models import Assessment
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"


def _student_path(student_id) -> str:  # noqa: ANN001
    return f"/api/v1/students/{student_id}"


def _assert_envelope(body: dict, *, code: str) -> dict:
    """Assert the ErrorResponse envelope (api-spec §4.2) + the machine `code`."""
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert isinstance(err, dict)
    assert "code" in err and "message" in err, f"missing code/message: {err}"
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


# ──────────────────────────────────────────────────────────────────────────────
# Factories (all write into the rolled-back db_session)
# ──────────────────────────────────────────────────────────────────────────────
def _active_year_id(db_session) -> uuid.UUID:  # noqa: ANN001
    return db_session.scalar(
        select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


def _active_semester_id(db_session) -> uuid.UUID:  # noqa: ANN001
    return db_session.scalar(select(Semester.id).where(Semester.is_active.is_(True)))


def _make_student(
    db_session,  # noqa: ANN001
    *,
    student_number=None,
    full_name="Test Student",
    status=StudentStatus.ACTIVE,
    user_id=None,
    date_of_birth=None,
    enrollment_date=None,
    deleted_at=None,
) -> StudentProfile:
    s = StudentProfile(
        user_id=user_id,
        student_number=student_number or f"S{uuid.uuid4().hex[:10]}",
        full_name=full_name,
        date_of_birth=date_of_birth or date(2010, 1, 1),
        enrollment_date=enrollment_date or date(2025, 9, 1),
        status=status,
        deleted_at=deleted_at,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _make_section(db_session, *, name=None, grade_level="Form 1", is_archived=False,
                  academic_year_id=None) -> Class:  # noqa: ANN001
    section = Class(
        academic_year_id=academic_year_id or _active_year_id(db_session),
        name=name or f"Section {uuid.uuid4().hex[:8]}",
        grade_level=grade_level,
        is_archived=is_archived,
    )
    db_session.add(section)
    db_session.flush()
    return section


def _make_subject(db_session, *, name=None) -> Subject:  # noqa: ANN001
    subj = Subject(name=name or f"Subject {uuid.uuid4().hex[:8]}")
    db_session.add(subj)
    db_session.flush()
    return subj


def _make_class_subject(db_session, *, section, subject=None) -> ClassSubject:  # noqa: ANN001
    subject = subject or _make_subject(db_session)
    cs = ClassSubject(class_id=section.id, subject_id=subject.id, is_active=True)
    db_session.add(cs)
    db_session.flush()
    return cs


def _make_teacher_profile(db_session, *, user_id=None, staff_number=None) -> TeacherProfile:  # noqa: ANN001
    t = TeacherProfile(
        user_id=user_id,
        staff_number=staff_number or f"T{uuid.uuid4().hex[:10]}",
        full_name="Test Teacher",
    )
    db_session.add(t)
    db_session.flush()
    return t


def _assign_teacher(db_session, *, class_subject, teacher) -> ClassTeacher:  # noqa: ANN001
    ct = ClassTeacher(class_subject_id=class_subject.id, teacher_id=teacher.id)
    db_session.add(ct)
    db_session.flush()
    return ct


def _enroll(db_session, *, student, section, semester_id=None, unenrolled_at=None) -> ClassEnrollment:  # noqa: ANN001
    enr = ClassEnrollment(
        class_id=section.id,
        student_id=student.id,
        semester_id=semester_id or _active_semester_id(db_session),
        unenrolled_at=unenrolled_at,
    )
    db_session.add(enr)
    db_session.flush()
    return enr


def _make_owned_student(db_session, teacher_user):  # noqa: ANN001
    """A student enrolled in a section the given teacher-user owns a subject of.
    Returns (student, section, class_subject)."""
    teacher = _make_teacher_profile(db_session, user_id=teacher_user.id)
    section = _make_section(db_session)
    cs = _make_class_subject(db_session, section=section)
    _assign_teacher(db_session, class_subject=cs, teacher=teacher)
    student = _make_student(db_session)
    _enroll(db_session, student=student, section=section)
    return student, section, cs


# ════════════════════════════════════════════════════════════════════════════
# GET /students — list (P/S all; Teacher scoped; Student 403)
# ════════════════════════════════════════════════════════════════════════════
class TestListStudents:
    def test_list_principal_page_shape(self, client, make_user, auth_headers, db_session) -> None:
        _make_student(db_session, full_name=f"Alpha {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(STUDENTS, headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"items", "total", "page", "page_size", "total_pages"} <= set(body.keys())
        if body["items"]:
            item = body["items"][0]
            assert {"id", "student_number", "full_name", "status"} <= set(item.keys())
            assert "current_section" in item and "guardian_name" in item

    def test_list_secretary_allowed(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.get(STUDENTS, headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY))
        assert resp.status_code == 200, resp.text

    def test_list_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.get(STUDENTS, headers=auth_headers(user_id=student.id, role=Role.STUDENT))
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_list_unauthenticated_401(self, client) -> None:
        resp = client.get(STUDENTS)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_list_invalid_sort_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS, params={"sort": "ssn"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="invalid_sort_field")

    def test_list_status_filter(self, client, make_user, auth_headers, db_session) -> None:
        tag = uuid.uuid4().hex[:6]
        grad = _make_student(db_session, full_name=f"Grad {tag}", status=StudentStatus.GRADUATED)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS, params={"status": "graduated", "page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert str(grad.id) in {i["id"] for i in items}
        assert all(i["status"] == "graduated" for i in items)

    def test_list_search_by_number(self, client, make_user, auth_headers, db_session) -> None:
        num = f"SRCH{uuid.uuid4().hex[:8]}"
        s = _make_student(db_session, student_number=num)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS, params={"search": num},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert str(s.id) in {i["id"] for i in resp.json()["items"]}

    def test_list_teacher_scoped_to_own_sections(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FR-STU-08: a teacher lists ONLY students in a section they own a subject
        of. An unrelated student must NOT appear."""
        teacher_user = make_user(role=Role.TEACHER)
        owned_student, _, _ = _make_owned_student(db_session, teacher_user)
        # An unrelated student, enrolled in a DIFFERENT section the teacher doesn't own.
        other_section = _make_section(db_session)
        _make_class_subject(db_session, section=other_section)
        outsider = _make_student(db_session)
        _enroll(db_session, student=outsider, section=other_section)

        resp = client.get(
            STUDENTS, params={"page_size": 200},
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(owned_student.id) in ids
        assert str(outsider.id) not in ids, "teacher must not see students outside own sections"

    def test_list_teacher_with_no_profile_404(self, client, make_user, auth_headers) -> None:
        """A teacher login with no teacher_profile owns nothing → the scope filter
        resolves via _teacher_profile_id which raises NotFound (404)."""
        teacher_user = make_user(role=Role.TEACHER)  # no TeacherProfile row
        resp = client.get(STUDENTS, headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER))
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")


# ════════════════════════════════════════════════════════════════════════════
# GET /students/me — self (server-derived)
# ════════════════════════════════════════════════════════════════════════════
class TestGetMyStudent:
    def test_me_returns_linked_profile(self, client, make_user, auth_headers, db_session) -> None:
        student_user = make_user(role=Role.STUDENT)
        profile = _make_student(db_session, user_id=student_user.id, full_name="Self Kid")
        resp = client.get(
            f"{STUDENTS}/me",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == str(profile.id)
        assert resp.json()["full_name"] == "Self Kid"

    def test_me_server_derived_ignores_other_students(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Scope is derived from the token's user, never a client id (§3.2). A
        student with a linked profile sees ONLY their own — there is no id param to
        supply, and another student's profile is never returned."""
        student_user = make_user(role=Role.STUDENT)
        mine = _make_student(db_session, user_id=student_user.id)
        other_user = make_user(role=Role.STUDENT)
        _make_student(db_session, user_id=other_user.id)
        resp = client.get(
            f"{STUDENTS}/me",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == str(mine.id)

    def test_me_no_profile_linked_404(self, client, make_user, auth_headers) -> None:
        student_user = make_user(role=Role.STUDENT)  # no profile row
        resp = client.get(
            f"{STUDENTS}/me",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="no_student_profile")

    def test_me_non_student_403(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/me",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_me_route_wins_over_uuid_path(self, client, make_user, auth_headers, db_session) -> None:
        """Route ordering: /me is declared before /{student_id}. A student hitting
        /me must be handled by get_my_student (student role allowed), not parsed as
        an id then rejected by the P/S/Teacher gate."""
        student_user = make_user(role=Role.STUDENT)
        _make_student(db_session, user_id=student_user.id)
        resp = client.get(
            f"{STUDENTS}/me",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 200, resp.text


# ════════════════════════════════════════════════════════════════════════════
# GET /students/{id} — detail + 404-vs-403 discipline
# ════════════════════════════════════════════════════════════════════════════
class TestGetStudent:
    def test_get_by_principal_200_with_audit_and_section(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        section = _make_section(db_session)
        _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(student.id)
        assert "audit" in body
        assert body["current_section"] is not None
        assert body["current_section"]["id"] == str(section.id)

    def test_get_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _student_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_get_student_role_403(self, client, make_user, auth_headers, db_session) -> None:
        target = _make_student(db_session)
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            _student_path(target.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_get_teacher_owns_section_200(self, client, make_user, auth_headers, db_session) -> None:
        teacher_user = make_user(role=Role.TEACHER)
        student, _, _ = _make_owned_student(db_session, teacher_user)
        resp = client.get(
            _student_path(student.id),
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == str(student.id)

    def test_get_teacher_not_sharing_section_404_not_403(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """§3.3: a teacher requesting a student in a section they do NOT share gets
        404 (no existence leak) — NOT 403. The student genuinely exists."""
        teacher_user = make_user(role=Role.TEACHER)
        _make_teacher_profile(db_session, user_id=teacher_user.id)  # teacher owns nothing
        outsider = _make_student(db_session)  # exists, but teacher can't reach it
        other_section = _make_section(db_session)
        _make_class_subject(db_session, section=other_section)
        _enroll(db_session, student=outsider, section=other_section)
        resp = client.get(
            _student_path(outsider.id),
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")


# ════════════════════════════════════════════════════════════════════════════
# POST /students — create (+ optional enroll, section_archived guard)
# ════════════════════════════════════════════════════════════════════════════
class TestCreateStudent:
    def _payload(self, **over) -> dict:
        base = {
            "student_number": f"NEW{uuid.uuid4().hex[:8]}",
            "full_name": "Fresh Student",
            "date_of_birth": "2011-05-05",
            "enrollment_date": "2025-09-01",
        }
        base.update(over)
        return base

    def test_create_by_principal_201_and_audit(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "active"
        assert body["current_section"] is None  # no section_id given
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "student.create",
                AuditLog.entity_id == uuid.UUID(body["id"]),
            )
        )
        assert n_audit == 1

    def test_create_by_secretary_201(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json=self._payload(),
        )
        assert resp.status_code == 201, resp.text

    def test_create_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json=self._payload(),
        )
        assert resp.status_code == 403

    def test_create_student_role_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
            json=self._payload(),
        )
        assert resp.status_code == 403

    def test_create_duplicate_number_409(self, client, make_user, auth_headers, db_session) -> None:
        existing = _make_student(db_session, student_number=f"DUP{uuid.uuid4().hex[:8]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(student_number=existing.student_number),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_student_number")

    def test_create_duplicate_number_case_insensitive_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        existing = _make_student(db_session, student_number=f"case{uuid.uuid4().hex[:8]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(student_number=existing.student_number.upper()),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_student_number")

    def test_create_future_dob_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        # Clearly-future (server uses UTC _now().date(); avoid a day-boundary tie).
        future = (date.today() + timedelta(days=3650)).isoformat()
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(date_of_birth=future),
        )
        assert resp.status_code == 422, resp.text
        err = _assert_envelope(resp.json(), code="validation_error")
        assert "date_of_birth" in (err.get("fields") or {})

    def test_create_extra_field_forbidden_422(self, client, make_user, auth_headers) -> None:
        """extra='forbid' on the write model: an unknown field is 422, not dropped."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(surprise="boo"),
        )
        assert resp.status_code == 422, resp.text

    def test_create_status_not_editable_field_is_accepted_on_create(
        self, client, make_user, auth_headers
    ) -> None:
        """`status` IS accepted on create (defaults active); the write model allows
        it here (lifecycle CHANGES go through the status endpoint)."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(status="inactive"),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "inactive"

    def test_create_with_enroll_into_section_201(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FR-STU-05: section_id enrolls into the active semester in the same txn;
        current_section is populated on the response."""
        section = _make_section(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(section_id=str(section.id)),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["current_section"] is not None
        assert body["current_section"]["id"] == str(section.id)
        # An enrollment row was created for the active semester.
        n_enr = db_session.scalar(
            select(func.count()).select_from(ClassEnrollment).where(
                ClassEnrollment.student_id == uuid.UUID(body["id"]),
                ClassEnrollment.class_id == section.id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        )
        assert n_enr == 1

    def test_create_enroll_unknown_section_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(section_id=str(uuid.uuid4())),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="section_not_found")

    def test_create_enroll_into_archived_section_flag_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 2: enrolling into a section with Class.is_archived=True →
        409 section_archived."""
        archived_section = _make_section(db_session, is_archived=True)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(section_id=str(archived_section.id)),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="section_archived")

    def test_create_enroll_into_section_of_archived_year_409(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """FLAGGED CASE 2 (year branch): the detection is `Class.is_archived OR the
        year's archived_at set`. Settings' archive endpoint sets year.status=archived
        AND year.archived_at. We build a section on the seeded active year, then
        archive that year the way Settings does. NOTE: archive_seeded_active_year in
        conftest flips status but does NOT set archived_at — the service checks
        `year.archived_at is not None`, so we set archived_at explicitly here to model
        the real Settings write and assert the intended guard fires."""
        from datetime import datetime, timezone

        section = _make_section(db_session, is_archived=False)
        year = db_session.get(AcademicYear, section.academic_year_id)
        year.status = AcademicYearStatus.ARCHIVED
        year.archived_at = datetime.now(tz=timezone.utc)
        db_session.flush()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(section_id=str(section.id)),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="section_archived")


# ════════════════════════════════════════════════════════════════════════════
# PATCH /students/{id} — profile edit (status NOT editable here)
# ════════════════════════════════════════════════════════════════════════════
class TestUpdateStudent:
    def test_patch_full_name_200(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"full_name": "Renamed Student"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["full_name"] == "Renamed Student"

    def test_patch_status_field_rejected_422(self, client, make_user, auth_headers, db_session) -> None:
        """`status` is intentionally ABSENT from StudentUpdateRequest (extra=forbid)
        → sending it is 422, proving PATCH cannot change lifecycle."""
        student = _make_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "graduated"},
        )
        assert resp.status_code == 422, resp.text

    def test_patch_duplicate_number_409(self, client, make_user, auth_headers, db_session) -> None:
        a = _make_student(db_session, student_number=f"A{uuid.uuid4().hex[:8]}")
        b = _make_student(db_session, student_number=f"B{uuid.uuid4().hex[:8]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _student_path(b.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"student_number": a.student_number},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_student_number")

    def test_patch_same_number_unchanged_ok(self, client, make_user, auth_headers, db_session) -> None:
        """Re-submitting the student's OWN number (case-variant) must not self-collide."""
        student = _make_student(db_session, student_number=f"self{uuid.uuid4().hex[:8]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"student_number": student.student_number.upper()},
        )
        assert resp.status_code == 200, resp.text

    def test_patch_future_dob_422(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        future = (date.today() + timedelta(days=3650)).isoformat()
        resp = client.patch(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"date_of_birth": future},
        )
        assert resp.status_code == 422, resp.text

    def test_patch_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _student_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"full_name": "Ghost"},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_patch_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        teacher = make_user(role=Role.TEACHER)
        resp = client.patch(
            _student_path(student.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"full_name": "Hacked"},
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /students/{id}/status — the FR-STU-04 transition matrix (FLAGGED CASE 1)
# ════════════════════════════════════════════════════════════════════════════
class TestStudentStatusMatrix:
    """The implemented matrix (service._ALLOWED_STATUS_TRANSITIONS):
      active     -> {inactive, transferred, graduated, withdrawn}
      inactive   -> {active, transferred, graduated, withdrawn}
      transferred-> {active, inactive}
      graduated  -> {active, inactive}
      withdrawn  -> {active, inactive}
    Terminal->terminal is blocked (422 invalid_transition). Same->same is a no-op
    (allowed). These tests assert the IMPLEMENTED matrix; the module report flags
    it against product intent (FR-STU-04 does not enumerate transitions)."""

    def _set_status(self, client, auth_headers, principal, student_id, new_status):
        return client.post(
            f"{STUDENTS}/{student_id}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": new_status},
        )

    @pytest.mark.parametrize("start,target", [
        (StudentStatus.ACTIVE, "inactive"),
        (StudentStatus.ACTIVE, "transferred"),
        (StudentStatus.ACTIVE, "graduated"),
        (StudentStatus.ACTIVE, "withdrawn"),
        (StudentStatus.INACTIVE, "active"),
        (StudentStatus.INACTIVE, "graduated"),
        (StudentStatus.TRANSFERRED, "active"),
        (StudentStatus.TRANSFERRED, "inactive"),
        (StudentStatus.GRADUATED, "active"),
        (StudentStatus.WITHDRAWN, "inactive"),
    ])
    def test_allowed_transitions_200(
        self, client, make_user, auth_headers, db_session, start, target
    ) -> None:
        student = _make_student(db_session, status=start)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._set_status(client, auth_headers, principal, student.id, target)
        assert resp.status_code == 200, f"{start.value}->{target}: {resp.text}"
        assert resp.json()["status"] == target

    @pytest.mark.parametrize("start,target", [
        (StudentStatus.GRADUATED, "withdrawn"),
        (StudentStatus.GRADUATED, "transferred"),
        (StudentStatus.WITHDRAWN, "graduated"),
        (StudentStatus.WITHDRAWN, "transferred"),
        (StudentStatus.TRANSFERRED, "graduated"),
        (StudentStatus.TRANSFERRED, "withdrawn"),
    ])
    def test_terminal_to_terminal_blocked_422(
        self, client, make_user, auth_headers, db_session, start, target
    ) -> None:
        student = _make_student(db_session, status=start)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._set_status(client, auth_headers, principal, student.id, target)
        assert resp.status_code == 422, f"{start.value}->{target}: {resp.text}"
        _assert_envelope(resp.json(), code="invalid_transition")

    def test_same_status_noop_200(self, client, make_user, auth_headers, db_session) -> None:
        """before == after short-circuits the matrix check → allowed no-op."""
        student = _make_student(db_session, status=StudentStatus.GRADUATED)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._set_status(client, auth_headers, principal, student.id, "graduated")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "graduated"

    def test_status_change_audits_before_after(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session, status=StudentStatus.ACTIVE)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._set_status(client, auth_headers, principal, student.id, "graduated")
        assert resp.status_code == 200, resp.text
        row = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "student.status_change",
                AuditLog.entity_id == student.id,
            )
        )
        assert row is not None
        assert row.summary["before"] == "active"
        assert row.summary["after"] == "graduated"

    def test_status_unknown_student_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._set_status(client, auth_headers, principal, uuid.uuid4(), "inactive")
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_status_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        teacher = make_user(role=Role.TEACHER)
        resp = client.post(
            f"{STUDENTS}/{student.id}/status",
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"status": "inactive"},
        )
        assert resp.status_code == 403

    def test_status_invalid_enum_422(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"{STUDENTS}/{student.id}/status",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"status": "expelled"},  # not a StudentStatus
        )
        assert resp.status_code == 422, resp.text


# ════════════════════════════════════════════════════════════════════════════
# DELETE /students/{id} — soft-delete guarded by academic history (FLAGGED CASE 6)
# ════════════════════════════════════════════════════════════════════════════
class TestDeleteStudent:
    def test_delete_no_history_204_soft_deletes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 204, resp.text
        assert resp.content == b""
        db_session.expire_all()
        db_session.refresh(student)
        assert student.deleted_at is not None

    def test_delete_blocked_by_grade_history_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 6: an assessment_grades row referencing the student blocks
        the soft-delete → 409 has_academic_history."""
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        enr = _enroll(db_session, student=student, section=section)
        assessment = Assessment(
            class_subject_id=cs.id,
            semester_id=_active_semester_id(db_session),
            title="Quiz 1",
            type=AssessmentType.QUIZ,
            max_score=100,
            status=AssessmentStatus.PUBLISHED,
        )
        db_session.add(assessment)
        db_session.flush()
        from app.modules.grades.models import AssessmentGrade
        db_session.add(AssessmentGrade(
            assessment_id=assessment.id,
            student_id=student.id,
            enrollment_id=enr.id,
            status=GradeStatus.PENDING,
        ))
        db_session.flush()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="has_academic_history")

    def test_delete_blocked_by_attendance_history_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FLAGGED CASE 6: an attendance_records row blocks the soft-delete → 409."""
        from app.common.enums import AttendanceStatus
        from app.modules.attendance.models import AttendanceRecord

        section = _make_section(db_session)
        student = _make_student(db_session)
        enr = _enroll(db_session, student=student, section=section)
        db_session.add(AttendanceRecord(
            class_id=section.id,
            student_id=student.id,
            enrollment_id=enr.id,
            semester_id=_active_semester_id(db_session),
            attendance_date=date(2025, 9, 15),
            status=AttendanceStatus.PRESENT,
        ))
        db_session.flush()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="has_academic_history")

    def test_delete_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _student_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_delete_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        teacher = make_user(role=Role.TEACHER)
        resp = client.delete(
            _student_path(student.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# GET /students/{id}/assessments
# ════════════════════════════════════════════════════════════════════════════
class TestStudentAssessments:
    def test_assessments_returns_published_for_section_subjects(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        sem = _active_semester_id(db_session)
        pub = Assessment(
            class_subject_id=cs.id, semester_id=sem, title="Published Test",
            type=AssessmentType.TEST, max_score=50, status=AssessmentStatus.PUBLISHED,
        )
        draft = Assessment(
            class_subject_id=cs.id, semester_id=sem, title="Draft Test",
            type=AssessmentType.TEST, max_score=50, status=AssessmentStatus.DRAFT,
        )
        db_session.add_all([pub, draft])
        db_session.flush()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{student.id}/assessments",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        titles = {i["title"] for i in items}
        assert "Published Test" in titles
        assert "Draft Test" not in titles, "draft assessments are internal-only"

    def test_assessments_no_enrollment_returns_empty(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session)  # not enrolled anywhere
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{student.id}/assessments",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    def test_assessments_unknown_student_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{uuid.uuid4()}/assessments",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_assessments_teacher_not_sharing_404(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """§3.3 applies here too: a teacher who doesn't share the student's section
        → 404, not 403."""
        teacher_user = make_user(role=Role.TEACHER)
        _make_teacher_profile(db_session, user_id=teacher_user.id)
        section = _make_section(db_session)
        _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        resp = client.get(
            f"{STUDENTS}/{student.id}/assessments",
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")

    def test_assessments_student_role_403(self, client, make_user, auth_headers, db_session) -> None:
        student_profile = _make_student(db_session)
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            f"{STUDENTS}/{student_profile.id}/assessments",
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# FLAGGED CASE 4 — rbac.assert_teacher_owns_section execution-level regression
# ════════════════════════════════════════════════════════════════════════════
class TestRbacAssertTeacherOwnsSection:
    """The helper was fixed from an invalid `exists().join()` (AttributeError at
    runtime) to `select(...).join(...).where(...).exists()`. These tests execute the
    statement against Postgres to prove (a) it compiles/executes without raising
    AttributeError, and (b) it correctly returns owns/not-owns."""

    def test_owns_section_passes_silently(self, make_user, db_session) -> None:
        from app.core.rbac import assert_teacher_owns_section

        teacher_user = make_user(role=Role.TEACHER)
        _, section, _ = _make_owned_student(db_session, teacher_user)
        # Owns a class_subject of the section → must NOT raise.
        assert assert_teacher_owns_section(db_session, teacher_user, section.id) is None

    def test_not_owning_section_raises_notfound(self, make_user, db_session) -> None:
        from app.core.errors import NotFound
        from app.core.rbac import assert_teacher_owns_section

        teacher_user = make_user(role=Role.TEACHER)
        _make_teacher_profile(db_session, user_id=teacher_user.id)  # owns nothing
        section = _make_section(db_session)
        _make_class_subject(db_session, section=section)  # a subject, but no ClassTeacher
        with pytest.raises(NotFound):
            assert_teacher_owns_section(db_session, teacher_user, section.id)

    def test_teacher_with_no_profile_raises_notfound(self, make_user, db_session) -> None:
        from app.core.errors import NotFound
        from app.core.rbac import assert_teacher_owns_section

        teacher_user = make_user(role=Role.TEACHER)  # no TeacherProfile
        section = _make_section(db_session)
        with pytest.raises(NotFound):
            assert_teacher_owns_section(db_session, teacher_user, section.id)

    def test_assert_teacher_owns_class_subject_executes(self, make_user, db_session) -> None:
        """Sibling helper — same fixed pattern family; prove owns + not-owns."""
        from app.core.errors import NotFound
        from app.core.rbac import assert_teacher_owns_class_subject

        teacher_user = make_user(role=Role.TEACHER)
        teacher = _make_teacher_profile(db_session, user_id=teacher_user.id)
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        _assign_teacher(db_session, class_subject=cs, teacher=teacher)
        assert assert_teacher_owns_class_subject(db_session, teacher_user, cs.id) is None
        # A different class_subject the teacher does not own.
        other_cs = _make_class_subject(db_session, section=_make_section(db_session))
        with pytest.raises(NotFound):
            assert_teacher_owns_class_subject(db_session, teacher_user, other_cs.id)

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
from app.modules.grades.models import AssessmentGrade
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


def _make_year(  # noqa: ANN001
    db_session, *, name=None, start=None, status=AcademicYearStatus.ARCHIVED
) -> AcademicYear:
    """A non-active year. Default status is `archived` on purpose — the DB enforces
    at most one ACTIVE year, and the seeded `2025-2026` already holds that slot."""
    start = start or date(2020, 9, 1)
    y = AcademicYear(
        name=name or f"Year {uuid.uuid4().hex[:8]}",
        start_date=start,
        end_date=date(start.year + 1, 6, 30),
        status=status,
    )
    db_session.add(y)
    db_session.flush()
    return y


def _make_semester(db_session, *, year, sequence=1, is_active=False) -> Semester:  # noqa: ANN001
    """A non-active semester (the DB allows only one active semester globally)."""
    s = Semester(
        academic_year_id=year.id,
        name=f"Semester {sequence} {uuid.uuid4().hex[:4]}",
        sequence=sequence,
        start_date=year.start_date,
        end_date=year.end_date,
        is_active=is_active,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _make_assessment(  # noqa: ANN001
    db_session,
    *,
    class_subject,
    semester_id=None,
    title=None,
    type_=AssessmentType.TEST,
    max_score=50,
    weight=1,
    status=AssessmentStatus.GRADED,
    is_released=False,
    assessment_date=None,
) -> Assessment:
    a = Assessment(
        class_subject_id=class_subject.id,
        semester_id=semester_id or _active_semester_id(db_session),
        title=title or f"Assessment {uuid.uuid4().hex[:6]}",
        type=type_,
        max_score=max_score,
        weight=weight,
        status=status,
        is_released=is_released,
        assessment_date=assessment_date,
    )
    db_session.add(a)
    db_session.flush()
    return a


def _make_grade(  # noqa: ANN001
    db_session,
    *,
    assessment,
    student,
    enrollment,
    status=GradeStatus.GRADED,
    score=None,
    is_released=None,
) -> AssessmentGrade:
    g = AssessmentGrade(
        assessment_id=assessment.id,
        student_id=student.id,
        enrollment_id=enrollment.id,
        status=status,
        score=score,
        is_released=is_released,
    )
    db_session.add(g)
    db_session.flush()
    return g


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
            assert "year_group" in item and "class_count" in item and "guardian_name" in item

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
        assert [c["id"] for c in body["current_classes"]] == [str(section.id)]

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
        assert body["current_classes"] == []  # no class_ids given
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
        """FR-STU-05: class_ids enrols into the active semester in the same txn;
        current_classes is populated on the response."""
        section = _make_section(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            STUDENTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(class_ids=[str(section.id)]),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert [c["id"] for c in body["current_classes"]] == [str(section.id)]
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
            json=self._payload(class_ids=[str(uuid.uuid4())]),
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
            json=self._payload(class_ids=[str(archived_section.id)]),
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
            json=self._payload(class_ids=[str(section.id)]),
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
    """The response is the `{items:[...]}` envelope the finished frontend reads
    (`features/students/api/studentsApi.ts` does `res.data.items`), grouped by
    class_subject, each group carrying the student's term grade and per-assessment
    lines with THAT STUDENT's grade status/score. api-spec §5.0a: the frontend is
    binding; this endpoint used to return a bare, flat array of assessment
    metadata, which crashed the Grades/Assessments tab."""

    def _get(self, client, auth_headers, student_id, *, user, role=Role.PRINCIPAL, params=None):  # noqa: ANN001
        return client.get(
            f"{STUDENTS}/{student_id}/assessments",
            params=params,
            headers=auth_headers(user_id=user.id, role=role),
        )

    def test_assessments_items_envelope_grouped_by_class_subject(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The envelope + grouping contract: one group per offering, ordered by
        subject name, each with subject / term_grade / assessments."""
        tag = uuid.uuid4().hex[:6]
        section = _make_section(db_session)
        cs_a = _make_class_subject(
            db_session, section=section, subject=_make_subject(db_session, name=f"AAA {tag}")
        )
        cs_z = _make_class_subject(
            db_session, section=section, subject=_make_subject(db_session, name=f"ZZZ {tag}")
        )
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        _make_assessment(db_session, class_subject=cs_a, title="A-Quiz")
        _make_assessment(db_session, class_subject=cs_z, title="Z-Quiz")

        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body, dict) and set(body.keys()) == {
            "items",
            "nudge_cooldown_seconds",
        }, "must be an {items:[...]} envelope, not a bare array"
        groups = {g["class_subject_id"]: g for g in body["items"]}
        assert {str(cs_a.id), str(cs_z.id)} <= set(groups)

        group = groups[str(cs_a.id)]
        assert set(group.keys()) == {
            "class_subject_id", "subject", "term_grade", "assessments",
        }
        assert group["subject"]["name"] == f"AAA {tag}"
        assert set(group["term_grade"].keys()) == {"numeric", "letter"}
        assert [a["title"] for a in group["assessments"]] == ["A-Quiz"]
        # `last_nudged_at` arrives with the release-nudge feature. It belongs on the
        # LINE, not just in the envelope: `RemindTeacherButton` computes the
        # remaining cooldown per assessment from `last_nudged_at` + the envelope's
        # `nudge_cooldown_seconds`, and `frontend/src/features/students/types.ts:64`
        # declares it `string | null` — so a nullable key that is always PRESENT.
        # (This assertion was missed when the feature landed; the envelope-level one
        # above was updated, this one was not.)
        assert set(group["assessments"][0].keys()) == {
            "id", "title", "type", "max_score", "weight",
            "assessment_date", "status", "score", "is_released",
            "last_nudged_at",
        }
        # Ordered by subject name.
        ordered = [g["class_subject_id"] for g in body["items"]]
        assert ordered.index(str(cs_a.id)) < ordered.index(str(cs_z.id))

    def test_assessments_drafts_excluded(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        _make_assessment(
            db_session, class_subject=cs, title="Published Test",
            status=AssessmentStatus.PUBLISHED,
        )
        _make_assessment(
            db_session, class_subject=cs, title="Draft Test", status=AssessmentStatus.DRAFT
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        titles = {
            a["title"] for g in resp.json()["items"] for a in g["assessments"]
        }
        assert "Published Test" in titles
        assert "Draft Test" not in titles, "draft assessments are internal-only"

    def test_assessments_unreleased_row_is_listed_but_score_withheld(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Unlike the student's own /grades/me view, an admin/teacher still SEES the
        row; only `score` is withheld until release."""
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        enr = _enroll(db_session, student=student, section=section)
        a = _make_assessment(db_session, class_subject=cs, max_score=50, is_released=False)
        _make_grade(
            db_session, assessment=a, student=student, enrollment=enr,
            status=GradeStatus.GRADED, score=40,
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        line = resp.json()["items"][0]["assessments"][0]
        assert line["id"] == str(a.id)
        assert line["is_released"] is False
        assert line["status"] == "graded", "the STUDENT's grade status, not the assessment's"
        assert line["score"] is None, "score is withheld while unreleased"

    def test_assessments_released_graded_row_surfaces_score(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        enr = _enroll(db_session, student=student, section=section)
        a = _make_assessment(db_session, class_subject=cs, max_score=50, is_released=True)
        _make_grade(
            db_session, assessment=a, student=student, enrollment=enr,
            status=GradeStatus.GRADED, score=40,
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        line = resp.json()["items"][0]["assessments"][0]
        assert line["is_released"] is True
        assert line["score"] == 40.0

    def test_assessments_grade_row_release_overrides_assessment(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`is_released` = grade.is_released when set, else the assessment's."""
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        enr = _enroll(db_session, student=student, section=section)
        a = _make_assessment(db_session, class_subject=cs, max_score=50, is_released=False)
        _make_grade(
            db_session, assessment=a, student=student, enrollment=enr,
            status=GradeStatus.GRADED, score=45, is_released=True,
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        line = resp.json()["items"][0]["assessments"][0]
        assert line["is_released"] is True
        assert line["score"] == 45.0

    def test_assessments_status_defaults_pending_with_no_grade_row(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """No `assessment_grades` row at all → the line still lists, status
        'pending', score null (schema §10.2b treats no-row as pending)."""
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        _make_assessment(db_session, class_subject=cs, is_released=True)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        line = resp.json()["items"][0]["assessments"][0]
        assert line["status"] == "pending"
        assert line["score"] is None
        assert resp.json()["items"][0]["term_grade"]["numeric"] is None

    def test_assessments_term_grade_comes_from_the_grade_engine(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """One graded 40/50 assessment, weight 1, no categories → 80.00. The number
        is produced by grades/calc.py, not recomputed in the Students module. It is
        computed with released_only=False, so it appears even while UNRELEASED —
        this deliberately differs from the student's own /grades/me view."""
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        enr = _enroll(db_session, student=student, section=section)
        a = _make_assessment(
            db_session, class_subject=cs, max_score=50, weight=1,
            status=AssessmentStatus.GRADED, is_released=False,
        )
        _make_grade(
            db_session, assessment=a, student=student, enrollment=enr,
            status=GradeStatus.GRADED, score=40,
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        group = resp.json()["items"][0]
        assert group["term_grade"]["numeric"] == 80.0
        assert group["assessments"][0]["score"] is None, "still withheld on the line"

    def test_assessments_academic_year_scopes_to_that_years_section(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`academic_year_id` picks the section the student sat in THAT year (a year
        spans both semesters), not the active one."""
        # Current year section + offering.
        current_section = _make_section(db_session)
        current_cs = _make_class_subject(db_session, section=current_section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=current_section)
        _make_assessment(db_session, class_subject=current_cs, title="Current Year Quiz")

        # A prior year the student also sat in.
        past_year = _make_year(db_session)
        past_sem = _make_semester(db_session, year=past_year)
        past_section = _make_section(db_session, academic_year_id=past_year.id)
        past_cs = _make_class_subject(db_session, section=past_section)
        past_enr = _enroll(
            db_session, student=student, section=past_section, semester_id=past_sem.id
        )
        past_enr.unenrolled_at = None
        _make_assessment(
            db_session, class_subject=past_cs, semester_id=past_sem.id,
            title="Past Year Quiz",
        )

        principal = make_user(role=Role.PRINCIPAL)

        past = self._get(
            client, auth_headers, student.id, user=principal,
            params={"academic_year_id": str(past_year.id)},
        )
        assert past.status_code == 200, past.text
        past_titles = {a["title"] for g in past.json()["items"] for a in g["assessments"]}
        assert past_titles == {"Past Year Quiz"}

        current = self._get(client, auth_headers, student.id, user=principal)
        current_titles = {
            a["title"] for g in current.json()["items"] for a in g["assessments"]
        }
        assert current_titles == {"Current Year Quiz"}

    def test_assessments_explicit_unknown_year_returns_empty_items(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """An EXPLICIT year the student never sat in yields no groups — it must not
        silently fall back to answering about a different year."""
        section = _make_section(db_session)
        cs = _make_class_subject(db_session, section=section)
        student = _make_student(db_session)
        _enroll(db_session, student=student, section=section)
        _make_assessment(db_session, class_subject=cs)
        other_year = _make_year(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(
            client, auth_headers, student.id, user=principal,
            params={"academic_year_id": str(other_year.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []

    def test_assessments_teacher_owning_section_200(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        teacher_user = make_user(role=Role.TEACHER)
        student, _, cs = _make_owned_student(db_session, teacher_user)
        _make_assessment(db_session, class_subject=cs, title="Owned Quiz")
        resp = self._get(
            client, auth_headers, student.id, user=teacher_user, role=Role.TEACHER
        )
        assert resp.status_code == 200, resp.text
        titles = {a["title"] for g in resp.json()["items"] for a in g["assessments"]}
        assert "Owned Quiz" in titles

    def test_assessments_no_enrollment_returns_empty(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session)  # not enrolled anywhere
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._get(client, auth_headers, student.id, user=principal)
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []

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
# academic_year_id — the module year switcher on GET /students and /students/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestYearScoping:
    """`academic_year_id` was previously undeclared on both endpoints, so FastAPI
    dropped it silently: the profile header showed the CURRENT classes while the
    assessments tab showed the past year's — contradictory data on one screen.

    Contract:
      * detail — with a year, the classes sat that year (strictly, `[]` if none);
        without, the current classes.
      * list — a PAST year FILTERS the student set; the active year / no year lists
        the whole directory. Row `class_count` is never rescoped — it describes the
        student's live load.
    """

    def _two_year_student(self, db_session, *, tag=None):  # noqa: ANN001
        """A student who sat in a DIFFERENT section object in each of two years.
        Returns (student, past_year, past_section, current_section)."""
        tag = tag or uuid.uuid4().hex[:6]
        student = _make_student(db_session, full_name=f"Switcher {tag}")
        current_section = _make_section(db_session, name=f"Cur {tag}")
        _enroll(db_session, student=student, section=current_section)

        past_year = _make_year(db_session, start=date(2019, 9, 1))
        past_sem = _make_semester(db_session, year=past_year)
        past_section = _make_section(
            db_session, name=f"Past {tag}", academic_year_id=past_year.id
        )
        _enroll(
            db_session, student=student, section=past_section, semester_id=past_sem.id
        )
        return student, past_year, past_section, current_section

    # ── GET /students/{id} ──────────────────────────────────────────────────
    def test_detail_explicit_past_year_returns_that_years_classes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student, past_year, past_section, current_section = self._two_year_student(
            db_session
        )
        principal = make_user(role=Role.PRINCIPAL)
        headers = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        past = client.get(
            _student_path(student.id),
            params={"academic_year_id": str(past_year.id)},
            headers=headers,
        )
        assert past.status_code == 200, past.text
        past_ids = [c["id"] for c in past.json()["current_classes"]]
        assert past_ids == [str(past_section.id)]
        assert str(current_section.id) not in past_ids, (
            "the year switcher must not fall through to the live classes"
        )

    def test_detail_no_year_param_returns_current_classes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student, _, past_section, current_section = self._two_year_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _student_path(student.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = [c["id"] for c in resp.json()["current_classes"]]
        assert ids == [str(current_section.id)]
        assert str(past_section.id) not in ids

    def test_detail_explicit_unmatched_year_returns_no_classes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Strictness, consistent with the assessments tab: an explicit year the
        student never sat in yields an empty list — never another year's classes."""
        student, _, _, _ = self._two_year_student(db_session)
        stranger_year = _make_year(db_session, start=date(2014, 9, 1))
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _student_path(student.id),
            params={"academic_year_id": str(stranger_year.id)},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["current_classes"] == []

    def test_detail_and_assessments_agree_on_the_same_year(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The regression this fix exists for: both screens must name the SAME
        classes for the selected year."""
        student, past_year, past_section, _ = self._two_year_student(db_session)
        past_cs = _make_class_subject(db_session, section=past_section)
        _make_assessment(
            db_session,
            class_subject=past_cs,
            semester_id=db_session.scalar(
                select(Semester.id).where(Semester.academic_year_id == past_year.id)
            ),
            title="Past Paper",
        )
        principal = make_user(role=Role.PRINCIPAL)
        headers = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        params = {"academic_year_id": str(past_year.id)}

        detail = client.get(_student_path(student.id), params=params, headers=headers)
        asmts = client.get(
            f"{STUDENTS}/{student.id}/assessments", params=params, headers=headers
        )
        assert detail.status_code == 200 and asmts.status_code == 200
        assert [c["id"] for c in detail.json()["current_classes"]] == [str(past_section.id)]
        assert {g["class_subject_id"] for g in asmts.json()["items"]} == {str(past_cs.id)}

    def test_detail_year_param_does_not_widen_teacher_scope(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """RBAC is unchanged: ownership is still evaluated against LIVE enrollments,
        so passing a past year cannot let a teacher reach a student — still 404."""
        teacher_user = make_user(role=Role.TEACHER)
        _make_teacher_profile(db_session, user_id=teacher_user.id)  # owns nothing
        student, past_year, _, _ = self._two_year_student(db_session)
        resp = client.get(
            _student_path(student.id),
            params={"academic_year_id": str(past_year.id)},
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")

    # ── GET /students ───────────────────────────────────────────────────────
    def test_list_past_year_filters_to_students_enrolled_that_year(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        tag = uuid.uuid4().hex[:6]
        sat, past_year, _, _ = self._two_year_student(db_session, tag=tag)
        # A second student who only ever sat in the CURRENT year.
        never = _make_student(db_session, full_name=f"Switcher {tag} Never")
        _enroll(db_session, student=never, section=_make_section(db_session))

        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS,
            params={
                "search": f"Switcher {tag}",
                "page_size": 200,
                "academic_year_id": str(past_year.id),
            },
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(sat.id) in ids
        assert str(never.id) not in ids, "past year must exclude students not enrolled then"

    def test_list_past_year_keeps_rows_current_class_count(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Rows are NOT rescoped — `class_count` describes the student's LIVE load, so
        selecting a past year filters WHICH students appear without changing the count
        shown for each."""
        tag = uuid.uuid4().hex[:6]
        student, past_year, past_section, current_section = self._two_year_student(
            db_session, tag=tag
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS,
            params={
                "search": f"Switcher {tag}",
                "page_size": 200,
                "academic_year_id": str(past_year.id),
            },
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        row = next(i for i in resp.json()["items"] if i["id"] == str(student.id))
        # The student sits exactly one live class (`current_section`), so the live
        # count is 1 regardless of the past year being selected.
        assert row["class_count"] == 1

    def test_list_active_year_does_not_filter_the_directory(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The active year means 'the directory', so students with NO active
        enrollment (graduated / withdrawn) must still list — otherwise the
        status=graduated view silently empties."""
        tag = uuid.uuid4().hex[:6]
        grad = _make_student(
            db_session, full_name=f"Ungrouped {tag}", status=StudentStatus.GRADUATED
        )  # never enrolled anywhere
        principal = make_user(role=Role.PRINCIPAL)
        headers = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        active_year_id = _active_year_id(db_session)

        for params in (
            {"search": f"Ungrouped {tag}", "page_size": 200},
            {
                "search": f"Ungrouped {tag}",
                "page_size": 200,
                "academic_year_id": str(active_year_id),
            },
        ):
            resp = client.get(STUDENTS, params=params, headers=headers)
            assert resp.status_code == 200, resp.text
            ids = {i["id"] for i in resp.json()["items"]}
            assert str(grad.id) in ids, f"unenrolled student dropped for params={params}"

    def test_list_unmatched_year_returns_no_rows(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        tag = uuid.uuid4().hex[:6]
        student, _, _, _ = self._two_year_student(db_session, tag=tag)
        stranger_year = _make_year(db_session, start=date(2013, 9, 1))
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS,
            params={
                "search": f"Switcher {tag}",
                "page_size": 200,
                "academic_year_id": str(stranger_year.id),
            },
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert str(student.id) not in {i["id"] for i in resp.json()["items"]}

    def test_list_past_year_still_applies_teacher_scope(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """FR-STU-08 composes with the year filter: a teacher browsing a past year
        sees only students in sections they own that year."""
        tag = uuid.uuid4().hex[:6]
        teacher_user = make_user(role=Role.TEACHER)
        teacher = _make_teacher_profile(db_session, user_id=teacher_user.id)

        past_year = _make_year(db_session, start=date(2012, 9, 1))
        past_sem = _make_semester(db_session, year=past_year)

        owned_section = _make_section(db_session, academic_year_id=past_year.id)
        owned_cs = _make_class_subject(db_session, section=owned_section)
        _assign_teacher(db_session, class_subject=owned_cs, teacher=teacher)
        mine = _make_student(db_session, full_name=f"Scoped {tag} Mine")
        _enroll(db_session, student=mine, section=owned_section, semester_id=past_sem.id)

        other_section = _make_section(db_session, academic_year_id=past_year.id)
        _make_class_subject(db_session, section=other_section)
        theirs = _make_student(db_session, full_name=f"Scoped {tag} Theirs")
        _enroll(
            db_session, student=theirs, section=other_section, semester_id=past_sem.id
        )

        resp = client.get(
            STUDENTS,
            params={
                "search": f"Scoped {tag}",
                "page_size": 200,
                "academic_year_id": str(past_year.id),
            },
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(mine.id) in ids
        assert str(theirs.id) not in ids, "teacher scope must survive the year filter"

    def test_list_past_year_counts_ended_enrollments(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A past year's enrollments normally have `unenrolled_at` set; requiring it
        NULL would return an empty historical directory."""
        from datetime import datetime, timezone

        tag = uuid.uuid4().hex[:6]
        student = _make_student(db_session, full_name=f"Ended {tag}")
        past_year = _make_year(db_session, start=date(2011, 9, 1))
        past_sem = _make_semester(db_session, year=past_year)
        section = _make_section(db_session, academic_year_id=past_year.id)
        _enroll(
            db_session, student=student, section=section, semester_id=past_sem.id,
            unenrolled_at=datetime.now(tz=timezone.utc),
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            STUDENTS,
            params={
                "search": f"Ended {tag}",
                "page_size": 200,
                "academic_year_id": str(past_year.id),
            },
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert str(student.id) in {i["id"] for i in resp.json()["items"]}


# ════════════════════════════════════════════════════════════════════════════
# GET /students/{id}/years + GET /students/me/years — the year switcher
# ════════════════════════════════════════════════════════════════════════════
class TestStudentYears:
    """Both routes return `{items:[{id,name,status}]}` newest year first — the shape
    `features/students/api/studentsApi.ts` and `app/providers/YearContext.tsx` read
    (`res.data.items`). Years are the ones the student was ACTUALLY enrolled in,
    resolved class_enrollments → semesters → academic_years."""

    def _enroll_in_new_year(self, db_session, student, *, start):  # noqa: ANN001
        year = _make_year(db_session, start=start)
        sem = _make_semester(db_session, year=year)
        section = _make_section(db_session, academic_year_id=year.id)
        _enroll(db_session, student=student, section=section, semester_id=sem.id)
        return year

    def test_years_lists_enrolled_years_newest_first(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session)
        older = self._enroll_in_new_year(db_session, student, start=date(2018, 9, 1))
        newer = self._enroll_in_new_year(db_session, student, start=date(2021, 9, 1))
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{student.id}/years",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert list(body.keys()) == ["items"]
        ids = [y["id"] for y in body["items"]]
        assert str(newer.id) in ids and str(older.id) in ids
        assert ids.index(str(newer.id)) < ids.index(str(older.id)), "newest first"
        item = next(y for y in body["items"] if y["id"] == str(newer.id))
        assert set(item.keys()) == {"id", "name", "status"}
        assert item["name"] == newer.name
        assert item["status"] == newer.status.value

    def test_years_excludes_years_the_student_never_sat_in(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session)
        mine = self._enroll_in_new_year(db_session, student, start=date(2019, 9, 1))
        untouched = _make_year(db_session, start=date(2017, 9, 1))
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{student.id}/years",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {y["id"] for y in resp.json()["items"]}
        assert str(mine.id) in ids
        assert str(untouched.id) not in ids

    def test_years_counts_ended_enrollments(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`unenrolled_at` is deliberately NOT filtered — reaching past years is the
        whole point of the switcher."""
        from datetime import datetime, timezone

        student = _make_student(db_session)
        year = _make_year(db_session, start=date(2016, 9, 1))
        sem = _make_semester(db_session, year=year)
        section = _make_section(db_session, academic_year_id=year.id)
        _enroll(
            db_session, student=student, section=section, semester_id=sem.id,
            unenrolled_at=datetime.now(tz=timezone.utc),
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{student.id}/years",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert str(year.id) in {y["id"] for y in resp.json()["items"]}

    def test_years_no_enrollments_empty_items(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        student = _make_student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{student.id}/years",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"items": []}

    def test_years_secretary_allowed(self, client, make_user, auth_headers, db_session) -> None:
        student = _make_student(db_session)
        secretary = make_user(role=Role.SECRETARY)
        resp = client.get(
            f"{STUDENTS}/{student.id}/years",
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
        )
        assert resp.status_code == 200, resp.text

    def test_years_unknown_student_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/{uuid.uuid4()}/years",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")

    def test_years_teacher_owning_section_200(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        teacher_user = make_user(role=Role.TEACHER)
        student, _, _ = _make_owned_student(db_session, teacher_user)
        resp = client.get(
            f"{STUDENTS}/{student.id}/years",
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["items"]) >= 1

    def test_years_teacher_not_sharing_section_404_not_403(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """§3.3 no-existence-leak: 404, never 403."""
        teacher_user = make_user(role=Role.TEACHER)
        _make_teacher_profile(db_session, user_id=teacher_user.id)  # owns nothing
        section = _make_section(db_session)
        _make_class_subject(db_session, section=section)
        outsider = _make_student(db_session)
        _enroll(db_session, student=outsider, section=section)
        resp = client.get(
            f"{STUDENTS}/{outsider.id}/years",
            headers=auth_headers(user_id=teacher_user.id, role=Role.TEACHER),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")

    def test_years_student_role_403_on_id_route(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        target = _make_student(db_session)
        student_user = make_user(role=Role.STUDENT)
        resp = client.get(
            f"{STUDENTS}/{target.id}/years",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="forbidden")

    def test_years_unauthenticated_401(self, client, db_session) -> None:
        student = _make_student(db_session)
        resp = client.get(f"{STUDENTS}/{student.id}/years")
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    # ── /students/me/years ──────────────────────────────────────────────────
    def test_me_years_route_wins_over_uuid_path(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Route ordering: /me/years is declared BEFORE /{student_id}/years, so "me"
        is never parsed as a UUID (which would 422)."""
        student_user = make_user(role=Role.STUDENT)
        profile = _make_student(db_session, user_id=student_user.id)
        year = self._enroll_in_new_year(db_session, profile, start=date(2022, 9, 1))
        resp = client.get(
            f"{STUDENTS}/me/years",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 200, resp.text
        assert str(year.id) in {y["id"] for y in resp.json()["items"]}

    def test_me_years_server_derived_ignores_other_students(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """§3.2: scope comes from the token, never a param — another student's years
        are never returned."""
        student_user = make_user(role=Role.STUDENT)
        mine = _make_student(db_session, user_id=student_user.id)
        my_year = self._enroll_in_new_year(db_session, mine, start=date(2023, 9, 1))

        other_user = make_user(role=Role.STUDENT)
        theirs = _make_student(db_session, user_id=other_user.id)
        their_year = self._enroll_in_new_year(db_session, theirs, start=date(2015, 9, 1))

        resp = client.get(
            f"{STUDENTS}/me/years",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 200, resp.text
        ids = {y["id"] for y in resp.json()["items"]}
        assert str(my_year.id) in ids
        assert str(their_year.id) not in ids

    def test_me_years_no_profile_linked_404(self, client, make_user, auth_headers) -> None:
        student_user = make_user(role=Role.STUDENT)  # no profile row
        resp = client.get(
            f"{STUDENTS}/me/years",
            headers=auth_headers(user_id=student_user.id, role=Role.STUDENT),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="no_student_profile")

    def test_me_years_non_student_403(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            f"{STUDENTS}/me/years",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="forbidden")


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

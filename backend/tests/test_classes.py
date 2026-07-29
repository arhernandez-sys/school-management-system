"""Comprehensive pytest suite for Module 5 — CLASSES / sections (api-spec §5.5).

Scope: the 13 endpoints (sections CRUD, subject attach/detach, teacher assignment,
roster, enrollable picker, enroll/unenroll) + negative / edge / security paths.

Oracle: api-specification.md §5 Module 5 + the frontend MSW contract
(`frontend/src/shared/api/mocks/handlers/classes.ts`) which wins on divergence
(ClassSubjectItem.lead_teacher_id; GET .../enrollable-students → {items:[...]}).

Hermetic + rolled-back via the `db_session` transactional rollback (conftest 7.0c):
each test archives the seeded active year and creates its OWN active year + active
semester, then builds a section graph — nothing depends on the demo seed and
nothing is committed to the shared DB.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.common.enums import Role, StudentStatus, TeacherStatus
from app.common.enums import AcademicYearStatus
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile

pytestmark = pytest.mark.requires_db

CLASSES = "/api/v1/classes"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# Hermetic graph builders (all inside the rolled-back db_session)
# ──────────────────────────────────────────────────────────────────────────────
def _writable_year(db_session, archive_seeded_active_year) -> tuple[AcademicYear, Semester]:
    """Free the one-active invariant (archive the seeded year), then create a fresh
    active year + active semester so section writes are permitted."""
    archive_seeded_active_year()
    tag = uuid.uuid4().hex[:6]
    year = AcademicYear(
        name=f"TestYear {tag}",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 6, 30),
        status=AcademicYearStatus.ACTIVE,
    )
    db_session.add(year)
    db_session.flush()
    sem = Semester(
        academic_year_id=year.id, name="Semester 1", sequence=1,
        start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
    )
    db_session.add(sem)
    db_session.flush()
    return year, sem


def _archived_year(db_session) -> AcademicYear:
    tag = uuid.uuid4().hex[:6]
    year = AcademicYear(
        name=f"OldYear {tag}", start_date=date(2023, 9, 1), end_date=date(2024, 6, 30),
        status=AcademicYearStatus.ARCHIVED, archived_at=_now(),
    )
    db_session.add(year)
    db_session.flush()
    return year


def _section(db_session, year_id, *, name=None, archived=False, capacity=None) -> Class:
    sec = Class(
        academic_year_id=year_id, name=name or f"Sec {uuid.uuid4().hex[:6]}",
        grade_level="Form 1", section="A", capacity=capacity, is_archived=archived,
    )
    db_session.add(sec)
    db_session.flush()
    return sec


def _subject(db_session, *, name=None) -> Subject:
    s = Subject(name=name or f"Subj {uuid.uuid4().hex[:6]}", code=uuid.uuid4().hex[:6])
    db_session.add(s)
    db_session.flush()
    return s


def _student(db_session, *, status=StudentStatus.ACTIVE) -> StudentProfile:
    s = StudentProfile(
        student_number=f"S-{uuid.uuid4().hex[:8]}", full_name=f"Stu {uuid.uuid4().hex[:5]}",
        date_of_birth=date(2012, 5, 1), enrollment_date=date(2025, 9, 1), status=status,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _teacher(db_session, *, user_id=None) -> TeacherProfile:
    t = TeacherProfile(
        user_id=user_id, staff_number=f"T-{uuid.uuid4().hex[:8]}",
        full_name=f"Teacher {uuid.uuid4().hex[:5]}", status=TeacherStatus.ACTIVE,
    )
    db_session.add(t)
    db_session.flush()
    return t


def _offering(db_session, section_id, subject_id, *, active=True) -> ClassSubject:
    cs = ClassSubject(class_id=section_id, subject_id=subject_id, is_active=active)
    db_session.add(cs)
    db_session.flush()
    return cs


def _enroll(db_session, section_id, student_id, semester_id) -> ClassEnrollment:
    e = ClassEnrollment(class_id=section_id, student_id=student_id, semester_id=semester_id)
    db_session.add(e)
    db_session.flush()
    return e


def _P(auth_headers, make_user):
    u = make_user(role=Role.PRINCIPAL)
    return u, auth_headers(user_id=u.id, role=Role.PRINCIPAL)


# ════════════════════════════════════════════════════════════════════════════
# Auth / role gate
# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_list_requires_auth(self, client) -> None:
        assert client.get(CLASSES).status_code == 401

    def test_create_forbidden_for_teacher(self, client, make_user, auth_headers, db_session) -> None:
        t = make_user(role=Role.TEACHER)
        r = client.post(CLASSES, headers=auth_headers(user_id=t.id, role=Role.TEACHER),
                        json={"name": "X", "grade_level": "Form 1"})
        assert r.status_code == 403

    def test_create_forbidden_for_student(self, client, make_user, auth_headers) -> None:
        s = make_user(role=Role.STUDENT)
        r = client.post(CLASSES, headers=auth_headers(user_id=s.id, role=Role.STUDENT),
                        json={"name": "X", "grade_level": "Form 1"})
        assert r.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /classes
# ════════════════════════════════════════════════════════════════════════════
class TestCreate:
    def test_create_ok(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "Form 1 Alpha", "grade_level": "Form 1", "section": "A", "capacity": 30,
            "academic_year_id": str(year.id)})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "Form 1 Alpha"
        assert body["academic_year"]["id"] == str(year.id)
        assert body["enrolled_count"] == 0 and body["over_capacity"] is False

    def test_create_defaults_to_active_year(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={"name": "NoYear Given", "grade_level": "Form 2"})
        assert r.status_code == 201, r.text
        assert r.json()["academic_year"]["id"] == str(year.id)

    def test_duplicate_name_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        _section(db_session, year.id, name="Dup Name")
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "Dup Name", "grade_level": "Form 1", "academic_year_id": str(year.id)})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="duplicate_class_name")

    def test_empty_name_422(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={"name": "", "grade_level": "Form 1"})
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="validation_error")
        assert "name" in (err.get("fields") or {})

    def test_create_in_archived_year_409(self, client, make_user, auth_headers, db_session) -> None:
        old = _archived_year(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "In Old Year", "grade_level": "Form 1", "academic_year_id": str(old.id)})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


# ════════════════════════════════════════════════════════════════════════════
# GET list / detail + scoping
# ════════════════════════════════════════════════════════════════════════════
class TestReadAndScope:
    def test_list_shape_and_counts(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id, capacity=30)
        subj = _subject(db_session)
        _offering(db_session, sec.id, subj.id)
        stu = _student(db_session)
        _enroll(db_session, sec.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.get(f"{CLASSES}?academic_year_id={year.id}&page_size=100", headers=H)
        assert r.status_code == 200
        item = next(x for x in r.json()["items"] if x["id"] == str(sec.id))
        assert item["enrolled_count"] == 1 and item["subject_count"] == 1

    def test_detail_over_capacity_flag(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id, capacity=1)
        for _ in range(2):
            _enroll(db_session, sec.id, _student(db_session).id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.get(f"{CLASSES}/{sec.id}", headers=H)
        assert r.status_code == 200 and r.json()["over_capacity"] is True

    def test_detail_not_found(self, client, make_user, auth_headers) -> None:
        _u, H = _P(auth_headers, make_user)
        r = client.get(f"{CLASSES}/{uuid.uuid4()}", headers=H)
        assert r.status_code == 404

    def test_teacher_scope_only_owned(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        owned = _section(db_session, year.id, name="Owned")
        _other = _section(db_session, year.id, name="Other")
        subj = _subject(db_session)
        cs = _offering(db_session, owned.id, subj.id)
        tuser = make_user(role=Role.TEACHER)
        teacher = _teacher(db_session, user_id=tuser.id)
        db_session.add(ClassTeacher(class_subject_id=cs.id, teacher_id=teacher.id, is_lead=True))
        db_session.flush()
        r = client.get(f"{CLASSES}?academic_year_id={year.id}&page_size=100",
                       headers=auth_headers(user_id=tuser.id, role=Role.TEACHER))
        assert r.status_code == 200
        names = {x["name"] for x in r.json()["items"]}
        assert "Owned" in names and "Other" not in names

    def test_teacher_detail_denied_is_404(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        tuser = make_user(role=Role.TEACHER)
        _teacher(db_session, user_id=tuser.id)  # owns nothing
        r = client.get(f"{CLASSES}/{sec.id}", headers=auth_headers(user_id=tuser.id, role=Role.TEACHER))
        assert r.status_code == 404


# ════════════════════════════════════════════════════════════════════════════
# PATCH / DELETE section
# ════════════════════════════════════════════════════════════════════════════
class TestUpdateDelete:
    def test_patch_ok(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id, capacity=20)
        _u, H = _P(auth_headers, make_user)
        r = client.patch(f"{CLASSES}/{sec.id}", headers=H, json={"capacity": 45, "name": "Renamed"})
        assert r.status_code == 200 and r.json()["capacity"] == 45 and r.json()["name"] == "Renamed"

    def test_delete_empty_ok(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        _u, H = _P(auth_headers, make_user)
        assert client.delete(f"{CLASSES}/{sec.id}", headers=H).status_code == 204
        assert client.get(f"{CLASSES}/{sec.id}", headers=H).status_code == 404

    def test_delete_with_attendance_history_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        from app.modules.attendance.models import AttendanceRecord
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        stu = _student(db_session)
        enr = _enroll(db_session, sec.id, stu.id, sem.id)
        db_session.add(AttendanceRecord(
            class_id=sec.id, student_id=stu.id, enrollment_id=enr.id, semester_id=sem.id,
            attendance_date=date(2025, 10, 1), status="present"))
        db_session.flush()
        _u, H = _P(auth_headers, make_user)
        r = client.delete(f"{CLASSES}/{sec.id}", headers=H)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="class_has_history")


# ════════════════════════════════════════════════════════════════════════════
# Subjects attach / detach + teachers
# ════════════════════════════════════════════════════════════════════════════
class TestSubjectsAndTeachers:
    def test_attach_and_list(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        subj = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/subjects", headers=H, json={"subject_id": str(subj.id)})
        assert r.status_code == 201, r.text
        item = r.json()
        assert item["subject"]["id"] == str(subj.id) and item["is_active"] is True
        assert item["actionable_by_caller"] is True
        lst = client.get(f"{CLASSES}/{sec.id}/subjects", headers=H).json()
        assert any(cs["class_subject_id"] == item["class_subject_id"] for cs in lst)

    def test_attach_duplicate_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        subj = _subject(db_session)
        _offering(db_session, sec.id, subj.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/subjects", headers=H, json={"subject_id": str(subj.id)})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="subject_already_in_section")

    def test_attach_unknown_subject_404(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/subjects", headers=H, json={"subject_id": str(uuid.uuid4())})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="subject_not_found")

    def test_assign_teachers_ok(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        cs = _offering(db_session, sec.id, _subject(db_session).id)
        t1, t2 = _teacher(db_session), _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/subjects/{cs.id}/teachers", headers=H,
                       json={"teacher_ids": [str(t1.id), str(t2.id)], "lead_teacher_id": str(t2.id)})
        assert r.status_code == 200, r.text
        body = r.json()
        assert {t["id"] for t in body["teachers"]} == {str(t1.id), str(t2.id)}
        assert body["lead_teacher_id"] == str(t2.id)

    def test_assign_lead_not_in_set_422(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        cs = _offering(db_session, sec.id, _subject(db_session).id)
        t1 = _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/subjects/{cs.id}/teachers", headers=H,
                       json={"teacher_ids": [str(t1.id)], "lead_teacher_id": str(uuid.uuid4())})
        assert r.status_code == 422

    def test_assign_unknown_teacher_404(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        cs = _offering(db_session, sec.id, _subject(db_session).id)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/subjects/{cs.id}/teachers", headers=H,
                       json={"teacher_ids": [str(uuid.uuid4())]})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="teacher_not_found")

    def test_detach_with_assessments_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        from app.modules.assessments.models import Assessment
        from decimal import Decimal
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        cs = _offering(db_session, sec.id, _subject(db_session).id)
        db_session.add(Assessment(
            class_subject_id=cs.id, semester_id=sem.id, title="Quiz", type="quiz",
            max_score=Decimal("20"), weight=Decimal("1.00"), status="draft"))
        db_session.flush()
        _u, H = _P(auth_headers, make_user)
        r = client.delete(f"{CLASSES}/{sec.id}/subjects/{cs.id}", headers=H)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="class_subject_has_history")

    def test_detach_clean_204(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        cs = _offering(db_session, sec.id, _subject(db_session).id)
        _u, H = _P(auth_headers, make_user)
        assert client.delete(f"{CLASSES}/{sec.id}/subjects/{cs.id}", headers=H).status_code == 204


# ════════════════════════════════════════════════════════════════════════════
# Roster / enrollment
# ════════════════════════════════════════════════════════════════════════════
class TestEnrollment:
    def test_enroll_and_roster(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        students = [_student(db_session) for _ in range(3)]
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/enrollments", headers=H,
                        json={"student_ids": [str(s.id) for s in students]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["enrolled"]) == 3 and body["transferred"] == []
        roster = client.get(f"{CLASSES}/{sec.id}/roster", headers=H).json()
        assert len(roster) == 3

    def test_enroll_transfer(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        src = _section(db_session, year.id, name="Src")
        dst = _section(db_session, year.id, name="Dst")
        stu = _student(db_session)
        _enroll(db_session, src.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{dst.id}/enrollments", headers=H, json={"student_ids": [str(stu.id)]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["transferred"]) == 1
        assert body["transferred"][0]["from_class_id"] == str(src.id)
        # source roster now empty, dest has the student
        assert client.get(f"{CLASSES}/{src.id}/roster", headers=H).json() == []
        assert len(client.get(f"{CLASSES}/{dst.id}/roster", headers=H).json()) == 1

    def test_enroll_over_capacity_warns_not_blocks(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id, capacity=1)
        students = [_student(db_session) for _ in range(2)]
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/enrollments", headers=H,
                        json={"student_ids": [str(s.id) for s in students]})
        assert r.status_code == 200
        assert r.json()["over_capacity_warning"] is True
        assert len(r.json()["enrolled"]) == 2  # not blocked

    def test_enroll_unknown_student_404(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/enrollments", headers=H, json={"student_ids": [str(uuid.uuid4())]})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="student_not_found")

    def test_unenroll(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        stu = _student(db_session)
        enr = _enroll(db_session, sec.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        assert client.delete(f"{CLASSES}/{sec.id}/enrollments/{enr.id}", headers=H).status_code == 204
        assert client.get(f"{CLASSES}/{sec.id}/roster", headers=H).json() == []

    def test_roster_include_withdrawn(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        stu = _student(db_session)
        enr = _enroll(db_session, sec.id, stu.id, sem.id)
        enr.unenrolled_at = _now()
        db_session.flush()
        _u, H = _P(auth_headers, make_user)
        assert client.get(f"{CLASSES}/{sec.id}/roster", headers=H).json() == []
        withdrawn = client.get(f"{CLASSES}/{sec.id}/roster?include=withdrawn", headers=H).json()
        assert len(withdrawn) == 1 and withdrawn[0]["unenrolled_at"] is not None

    def test_enrollable_excludes_roster(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        on_roster = _student(db_session)
        _enroll(db_session, sec.id, on_roster.id, sem.id)
        off_roster = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.get(f"{CLASSES}/{sec.id}/enrollable-students", headers=H)
        assert r.status_code == 200
        ids = {s["id"] for s in r.json()["items"]}
        assert str(off_roster.id) in ids and str(on_roster.id) not in ids

    def test_student_cannot_read_roster(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        s = make_user(role=Role.STUDENT)
        r = client.get(f"{CLASSES}/{sec.id}/roster", headers=auth_headers(user_id=s.id, role=Role.STUDENT))
        assert r.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# Archived-year write guard (applies to every write path)
# ════════════════════════════════════════════════════════════════════════════
class TestArchivedYearGuard:
    def test_enroll_into_archived_year_409(self, client, make_user, auth_headers, db_session) -> None:
        old = _archived_year(db_session)
        sec = _section(db_session, old.id, archived=True)
        stu = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/enrollments", headers=H, json={"student_ids": [str(stu.id)]})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

    def test_patch_archived_section_409(self, client, make_user, auth_headers, db_session) -> None:
        old = _archived_year(db_session)
        sec = _section(db_session, old.id, archived=True)
        _u, H = _P(auth_headers, make_user)
        r = client.patch(f"{CLASSES}/{sec.id}", headers=H, json={"capacity": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

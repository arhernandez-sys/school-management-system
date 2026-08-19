"""Comprehensive pytest suite for Module 5 — CLASSES (api-spec §5.5).

Scope: the 15 endpoints (class CRUD, subject attach/detach, teacher assignment,
weekly meetings, roster, enrollable picker, enroll/unenroll) + negative / edge /
security paths.

**D29** — a class is one SUBJECT CLASS ("Math-1"), not a homeroom. The two tests that
carry the weight of that decision:
  * `TestEnrollment.test_enroll_does_not_transfer` — the inverse of the old
    `test_enroll_transfer`. Enrolling Freddy in Biology must NOT drop him from Math.
  * `TestMeetings.*` — the weekly schedule, including that clashes WARN rather than
    block (D-Q6 precedent).

Oracle: api-specification.md §5 Module 5 + the frontend MSW contract
(`frontend/src/shared/api/mocks/handlers/classes.ts`) which wins on divergence
(ClassSubjectItem.lead_teacher_id; GET .../enrollable-students → {items:[...]}).

Hermetic + rolled-back via the `db_session` transactional rollback (conftest 7.0c):
each test archives the seeded active year and creates its OWN active year + active
semester, then builds a class graph — nothing depends on the demo seed and
nothing is committed to the shared DB.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import select

from app.common.enums import Role, StudentStatus, TeacherStatus
from app.common.enums import AcademicYearStatus
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassMeeting,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

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
        student_number=f"S-{uuid.uuid4().hex[:8]}", **split_name(f"Stu {uuid.uuid4().hex[:5]}"),
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


def _meeting(db_session, cs_id, *, day=1, start="08:00", end="09:30", room=None) -> ClassMeeting:
    m = ClassMeeting(
        class_subject_id=cs_id,
        day_of_week=day,
        start_time=time.fromisoformat(start),
        end_time=time.fromisoformat(end),
        room=room,
    )
    db_session.add(m)
    db_session.flush()
    return m


def _subject_class(db_session, year_id, *, name=None, teacher=None, capacity=None):
    """A complete D29 subject class: Class + its single offering (+ optional teacher).

    Most tests want the whole unit, since a class with no offering can't be scheduled
    or graded — `_section` + `_offering` are kept for the tests that need the pieces
    apart (or need a deliberately subject-less pre-D29 row).
    """
    sec = _section(db_session, year_id, name=name, capacity=capacity)
    cs = _offering(db_session, sec.id, _subject(db_session).id)
    if teacher is not None:
        db_session.add(
            ClassTeacher(class_subject_id=cs.id, teacher_id=teacher.id, is_lead=True)
        )
        db_session.flush()
    return sec, cs


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
                        json={"name": "X", "grade_level": "Lower 6",
                              "subject_id": str(uuid.uuid4())})
        assert r.status_code == 403

    def test_create_forbidden_for_student(self, client, make_user, auth_headers) -> None:
        s = make_user(role=Role.STUDENT)
        r = client.post(CLASSES, headers=auth_headers(user_id=s.id, role=Role.STUDENT),
                        json={"name": "X", "grade_level": "Lower 6",
                              "subject_id": str(uuid.uuid4())})
        assert r.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /classes
# ════════════════════════════════════════════════════════════════════════════
class TestCreate:
    def test_create_ok(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        # No literal subject name: `uq_subjects_name` is school-wide, and the demo seed
        # already owns the obvious ones ("Mathematics" collides).
        subj = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "Math-1", "subject_id": str(subj.id), "grade_level": "Lower 6",
            "section": "A", "capacity": 30, "academic_year_id": str(year.id)})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "Math-1"
        assert body["academic_year"]["id"] == str(year.id)
        assert body["enrolled_count"] == 0 and body["over_capacity"] is False
        # D29: the subject is attached by the create itself, not a follow-up call.
        assert body["subject"]["id"] == str(subj.id)
        assert body["class_subject_id"] is not None

    def test_create_with_teacher_and_meetings_is_atomic(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """One request builds "Math-1, Mr. Smith, Room A, Mon 08:00–09:30"."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        subj = _subject(db_session)
        teacher = _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "Math-Full", "subject_id": str(subj.id), "grade_level": "Lower 6",
            "academic_year_id": str(year.id),
            "teacher_ids": [str(teacher.id)],
            "meetings": [
                {"day_of_week": 1, "start_time": "08:00", "end_time": "09:30", "room": "Room A"},
                {"day_of_week": 3, "start_time": "10:00", "end_time": "11:00", "room": "Room A"},
            ],
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert [t["id"] for t in body["teachers"]] == [str(teacher.id)]
        assert body["lead_teacher_id"] == str(teacher.id)
        assert len(body["meetings"]) == 2
        assert body["meetings"][0]["day_of_week"] == 1
        assert body["meetings"][0]["room"] == "Room A"

    def test_create_without_subject_422(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """A class with no subject cannot be graded or scheduled, so it is rejected."""
        _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={"name": "Nameless", "grade_level": "Lower 6"})
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="validation_error")
        assert "subject_id" in (err.get("fields") or {})

    def test_create_unknown_subject_404(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "Ghost Subject", "grade_level": "Lower 6",
            "subject_id": str(uuid.uuid4())})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="subject_not_found")

    def test_create_defaults_to_active_year(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        subj = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "NoYear Given", "grade_level": "Upper 6", "subject_id": str(subj.id)})
        assert r.status_code == 201, r.text
        assert r.json()["academic_year"]["id"] == str(year.id)

    def test_duplicate_name_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        _section(db_session, year.id, name="Dup Name")
        subj = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "Dup Name", "grade_level": "Lower 6", "subject_id": str(subj.id),
            "academic_year_id": str(year.id)})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="duplicate_class_name")

    def test_empty_name_422(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        _writable_year(db_session, archive_seeded_active_year)
        subj = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "", "grade_level": "Lower 6", "subject_id": str(subj.id)})
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="validation_error")
        assert "name" in (err.get("fields") or {})

    def test_create_in_archived_year_409(self, client, make_user, auth_headers, db_session) -> None:
        old = _archived_year(db_session)
        subj = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(CLASSES, headers=H, json={
            "name": "In Old Year", "grade_level": "Lower 6", "subject_id": str(subj.id),
            "academic_year_id": str(old.id)})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


# ════════════════════════════════════════════════════════════════════════════
# GET list / detail + scoping
# ════════════════════════════════════════════════════════════════════════════
class TestReadAndScope:
    def test_list_shape_and_counts(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """D29: the LIST row carries subject + teacher + meetings, so the classes
        table renders without a follow-up request per row."""
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id, capacity=30)
        subj = _subject(db_session)
        cs = _offering(db_session, sec.id, subj.id)
        teacher = _teacher(db_session)
        db_session.add(ClassTeacher(class_subject_id=cs.id, teacher_id=teacher.id, is_lead=True))
        _meeting(db_session, cs.id, day=2, start="09:00", end="10:00", room="Lab 1")
        stu = _student(db_session)
        _enroll(db_session, sec.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.get(f"{CLASSES}?academic_year_id={year.id}&page_size=100", headers=H)
        assert r.status_code == 200
        item = next(x for x in r.json()["items"] if x["id"] == str(sec.id))
        assert item["enrolled_count"] == 1
        assert item["subject"]["id"] == str(subj.id)
        assert item["class_subject_id"] == str(cs.id)
        assert [t["id"] for t in item["teachers"]] == [str(teacher.id)]
        assert item["meetings"] == [
            {
                "id": item["meetings"][0]["id"],
                "day_of_week": 2,
                "start_time": "09:00:00",
                "end_time": "10:00:00",
                "room": "Lab 1",
            }
        ]

    def test_list_filters_by_subject(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """Two Math classes and one Biology: filtering by Math returns both Maths."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        math = _subject(db_session, name="Math D29")
        bio = _subject(db_session, name="Bio D29")
        m1 = _section(db_session, year.id, name="Math-1")
        m2 = _section(db_session, year.id, name="Math-2")
        b1 = _section(db_session, year.id, name="Biology-10")
        _offering(db_session, m1.id, math.id)
        _offering(db_session, m2.id, math.id)
        _offering(db_session, b1.id, bio.id)
        _u, H = _P(auth_headers, make_user)
        r = client.get(
            f"{CLASSES}?academic_year_id={year.id}&subject_id={math.id}&page_size=100",
            headers=H,
        )
        assert r.status_code == 200
        ids = {x["id"] for x in r.json()["items"]}
        assert {str(m1.id), str(m2.id)} <= ids
        assert str(b1.id) not in ids

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

    def test_attach_second_subject_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """D29 one-subject invariant: a class that already teaches Math cannot also
        teach Biology — that would give it two gradebooks and two timetables."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        _offering(db_session, sec.id, _subject(db_session).id)
        other = _subject(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{sec.id}/subjects", headers=H, json={"subject_id": str(other.id)})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="subject_already_set")

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
        assert len(body["enrolled"]) == 3
        assert body["schedule_conflicts"] == []
        roster = client.get(f"{CLASSES}/{sec.id}/roster", headers=H).json()
        assert len(roster) == 3

    def test_enroll_does_not_transfer(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """THE D29 test. This replaces `test_enroll_transfer`, which asserted the
        opposite: enrolling a student used to close their enrollment everywhere else in
        the semester. In a sixth form that is data loss — adding Freddy to Biology must
        leave him in Math. Both rosters must hold him afterwards.
        """
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        math, _cs_m = _subject_class(db_session, year.id, name="Math-1")
        bio, _cs_b = _subject_class(db_session, year.id, name="Biology-10")
        freddy = _student(db_session)
        _enroll(db_session, math.id, freddy.id, sem.id)
        _u, H = _P(auth_headers, make_user)

        r = client.post(f"{CLASSES}/{bio.id}/enrollments", headers=H,
                        json={"student_ids": [str(freddy.id)]})
        assert r.status_code == 200, r.text
        # `transferred` is gone from the contract entirely.
        assert "transferred" not in r.json()

        math_roster = client.get(f"{CLASSES}/{math.id}/roster", headers=H).json()
        bio_roster = client.get(f"{CLASSES}/{bio.id}/roster", headers=H).json()
        assert [e["student"]["id"] for e in math_roster] == [str(freddy.id)]
        assert [e["student"]["id"] for e in bio_roster] == [str(freddy.id)]

    def test_enroll_is_idempotent(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """Re-enrolling into the SAME class adds no second roster row."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, _cs = _subject_class(db_session, year.id)
        stu = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        body = {"student_ids": [str(stu.id)]}
        assert client.post(f"{CLASSES}/{sec.id}/enrollments", headers=H, json=body).status_code == 200
        assert client.post(f"{CLASSES}/{sec.id}/enrollments", headers=H, json=body).status_code == 200
        assert len(client.get(f"{CLASSES}/{sec.id}/roster", headers=H).json()) == 1

    def test_enroll_reports_student_schedule_clash_but_enrolls(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """A clash is a warning, not a block (D-Q6 precedent)."""
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        math, cs_m = _subject_class(db_session, year.id, name="Math-Clash")
        bio, cs_b = _subject_class(db_session, year.id, name="Bio-Clash")
        _meeting(db_session, cs_m.id, day=1, start="08:00", end="09:30")
        _meeting(db_session, cs_b.id, day=1, start="09:00", end="10:00")  # overlaps
        stu = _student(db_session)
        _enroll(db_session, math.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)

        r = client.post(f"{CLASSES}/{bio.id}/enrollments", headers=H,
                        json={"student_ids": [str(stu.id)]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["enrolled"]) == 1, "the clash must not block the enrollment"
        clashes = body["schedule_conflicts"]
        assert len(clashes) == 1
        assert clashes[0]["kind"] == "student"
        assert clashes[0]["with_class_name"] == "Math-Clash"
        assert "Math-Clash" in clashes[0]["message"]

    def test_enroll_back_to_back_meetings_do_not_clash(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """08:00–09:00 then 09:00–10:00 is a normal school day, not a conflict."""
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        first, cs_1 = _subject_class(db_session, year.id, name="First Period")
        second, cs_2 = _subject_class(db_session, year.id, name="Second Period")
        _meeting(db_session, cs_1.id, day=1, start="08:00", end="09:00")
        _meeting(db_session, cs_2.id, day=1, start="09:00", end="10:00")
        stu = _student(db_session)
        _enroll(db_session, first.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{CLASSES}/{second.id}/enrollments", headers=H,
                        json={"student_ids": [str(stu.id)]})
        assert r.status_code == 200, r.text
        assert r.json()["schedule_conflicts"] == []

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

    def test_replace_meetings_archived_409(self, client, make_user, auth_headers, db_session) -> None:
        old = _archived_year(db_session)
        sec = _section(db_session, old.id, archived=True)
        _offering(db_session, sec.id, _subject(db_session).id)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": []})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


# ════════════════════════════════════════════════════════════════════════════
# Weekly meetings — the D29 schedule (FR-SCH-01/02)
# ════════════════════════════════════════════════════════════════════════════
class TestMeetings:
    def test_replace_and_read_back(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, _cs = _subject_class(db_session, year.id, name="Math-Sched")
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 3, "start_time": "11:00", "end_time": "12:00", "room": "Room D"},
            {"day_of_week": 1, "start_time": "08:00", "end_time": "09:30", "room": "Room A"},
        ]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["conflicts"] == []
        # Sorted Mon→Fri regardless of submit order, so the grid renders in day order.
        assert [m["day_of_week"] for m in body["meetings"]] == [1, 3]
        again = client.get(f"{CLASSES}/{sec.id}/meetings", headers=H).json()
        assert [m["day_of_week"] for m in again["meetings"]] == [1, 3]

    def test_replace_is_a_full_replace(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, cs = _subject_class(db_session, year.id)
        _meeting(db_session, cs.id, day=1)
        _meeting(db_session, cs.id, day=2)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 5, "start_time": "13:00", "end_time": "14:00"},
        ]})
        assert r.status_code == 200, r.text
        assert [m["day_of_week"] for m in r.json()["meetings"]] == [5]

    def test_empty_list_clears_the_week(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, cs = _subject_class(db_session, year.id)
        _meeting(db_session, cs.id)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": []})
        assert r.status_code == 200, r.text
        assert r.json()["meetings"] == []

    def test_weekend_day_422(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """Mon–Fri only: day 6 is rejected at the schema, not silently stored."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, _cs = _subject_class(db_session, year.id)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 6, "start_time": "08:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="validation_error")

    def test_end_before_start_422(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, _cs = _subject_class(db_session, year.id)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "10:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="validation_error")

    def test_class_without_subject_409(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """A pre-D29 row with no offering has nothing to hang a schedule on."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec = _section(db_session, year.id)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "08:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="subject_not_set")

    def test_teacher_double_booking_warns_but_saves(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Mr. Smith cannot teach two classes at once — reported, still written."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        smith = _teacher(db_session)
        other, cs_other = _subject_class(db_session, year.id, name="Math-2", teacher=smith)
        _meeting(db_session, cs_other.id, day=1, start="08:00", end="09:30", room="Room C")
        mine, _cs_mine = _subject_class(db_session, year.id, name="Math-1", teacher=smith)
        _u, H = _P(auth_headers, make_user)

        r = client.put(f"{CLASSES}/{mine.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "09:00", "end_time": "10:00", "room": "Room A"},
        ]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["meetings"]) == 1, "the warning must not block the write"
        kinds = {c["kind"] for c in body["conflicts"]}
        assert "teacher" in kinds
        clash = next(c for c in body["conflicts"] if c["kind"] == "teacher")
        assert clash["with_class_name"] == "Math-2"
        assert clash["label"] == smith.full_name

    def test_room_double_booking_warns(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """Room match is case/whitespace-insensitive — "lab 1" clashes with "Lab 1"."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        other, cs_other = _subject_class(db_session, year.id, name="Bio-Room")
        _meeting(db_session, cs_other.id, day=2, start="09:00", end="10:00", room="Lab 1")
        mine, _cs = _subject_class(db_session, year.id, name="Chem-Room")
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{mine.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 2, "start_time": "09:30", "end_time": "10:30", "room": "  lab 1 "},
        ]})
        assert r.status_code == 200, r.text
        conflicts = r.json()["conflicts"]
        assert any(c["kind"] == "room" and c["with_class_name"] == "Bio-Room" for c in conflicts)

    def test_no_conflict_across_years(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        """Last year's timetable must not flag this year's."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        old = _archived_year(db_session)
        smith = _teacher(db_session)
        _old_cls, cs_old = _subject_class(db_session, old.id, name="Old Math", teacher=smith)
        _meeting(db_session, cs_old.id, day=1, start="08:00", end="09:30", room="Room A")
        mine, _cs = _subject_class(db_session, year.id, name="New Math", teacher=smith)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{mine.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "08:00", "end_time": "09:30", "room": "Room A"},
        ]})
        assert r.status_code == 200, r.text
        assert r.json()["conflicts"] == []

    def test_self_overlap_warns(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, _cs = _subject_class(db_session, year.id, name="Overlapper")
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{CLASSES}/{sec.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "08:00", "end_time": "10:00"},
            {"day_of_week": 1, "start_time": "09:00", "end_time": "11:00"},
        ]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["meetings"]) == 2
        assert any("overlapping" in c["message"] for c in body["conflicts"])

    def test_student_can_read_own_class_meetings(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        sec, cs = _subject_class(db_session, year.id)
        _meeting(db_session, cs.id, day=4, start="14:00", end="15:00", room="Room Z")
        u = make_user(role=Role.STUDENT)
        stu = _student(db_session)
        stu.user_id = u.id
        db_session.flush()
        _enroll(db_session, sec.id, stu.id, sem.id)
        r = client.get(f"{CLASSES}/{sec.id}/meetings",
                       headers=auth_headers(user_id=u.id, role=Role.STUDENT))
        assert r.status_code == 200, r.text
        assert r.json()["meetings"][0]["room"] == "Room Z"

    def test_student_cannot_read_other_class_meetings(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """404, not 403 — no existence leak (§3.3)."""
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, cs = _subject_class(db_session, year.id)
        _meeting(db_session, cs.id)
        u = make_user(role=Role.STUDENT)
        stu = _student(db_session)
        stu.user_id = u.id
        db_session.flush()
        r = client.get(f"{CLASSES}/{sec.id}/meetings",
                       headers=auth_headers(user_id=u.id, role=Role.STUDENT))
        assert r.status_code == 404

    def test_teacher_cannot_write_meetings(self, client, make_user, auth_headers, db_session, archive_seeded_active_year) -> None:
        year, _sem = _writable_year(db_session, archive_seeded_active_year)
        sec, _cs = _subject_class(db_session, year.id)
        t = make_user(role=Role.TEACHER)
        r = client.put(f"{CLASSES}/{sec.id}/meetings",
                       headers=auth_headers(user_id=t.id, role=Role.TEACHER),
                       json={"meetings": []})
        assert r.status_code == 403

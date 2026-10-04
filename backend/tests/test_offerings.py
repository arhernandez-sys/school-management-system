"""Comprehensive pytest suite for Module 5 — COURSE OFFERINGS (api-spec §5.5, D31).

REPLACES `test_classes.py`. That file described the D29 model, where a `classes` row was
scoped to an academic YEAR and `class_subjects` attached the subjects it taught. D31
merged those into `course_offerings`: **one course, one semester, an optional section**.

Three of the 15 endpoints went with the join table and are NOT re-tested here, because
the concept is gone rather than renamed — `GET`/`POST /classes/{id}/subjects` and
`DELETE /classes/{id}/subjects/{cs_id}` existed to manage what a homeroom taught, and an
offering teaches exactly one course, chosen at creation. `PUT .../subjects/{cs}/teachers`
lost its middle segment. **12 endpoints remain.**

The tests carrying the weight of D31 itself:
  * `TestCreate.test_two_sections_of_one_course_coexist_in_one_term` — parallel sections.
  * `TestCreate.test_the_same_course_runs_in_two_semesters` — the thing the year-scoped
    model could not express at all, and the reason the refactor happened.
  * `TestCreate.test_two_unsectioned_offerings_of_one_course_in_one_term_are_refused` —
    the `COALESCE` in the `active_section` generated column is load-bearing; without it
    NULLs would not collide and the duplicate would be allowed.
  * `TestEnrollment.test_enroll_does_not_transfer` — enrolling Freddy in Biology must not
    drop him from Math.
  * `TestMeetings.*` — clashes WARN rather than block (D-Q6 precedent).

Hermetic + rolled back via the `db_session` transactional rollback: each test archives the
seeded active year and creates its OWN active year + semester, so nothing depends on the
demo seed and nothing is committed.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import select

from app.common.enums import AcademicYearStatus, Role, StudentStatus, TeacherStatus
from app.modules.offerings.labels import offering_label
from app.modules.offerings.models import (
    ClassEnrollment,
    ClassMeeting,
    ClassTeacher,
    Course,
    CourseOffering,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

OFFERINGS = "/api/v1/offerings"


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
    """Free the one-active invariant, then create a fresh active year + TWO terms.

    Two semesters, not one: an offering is scoped to a term now, so "the same course in
    another term" — the central D31 capability — is not expressible with only one.
    """
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
    sem1 = Semester(
        academic_year_id=year.id, name="Semester 1", sequence=1,
        start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
    )
    sem2 = Semester(
        academic_year_id=year.id, name="Semester 2", sequence=2,
        start_date=date(2026, 2, 1), end_date=date(2026, 6, 30), is_active=False,
    )
    db_session.add_all([sem1, sem2])
    db_session.flush()
    return year, sem1


def _second_semester(db_session, year) -> Semester:
    return db_session.scalar(
        select(Semester)
        .where(Semester.academic_year_id == year.id, Semester.sequence == 2)
    )


def _archived_year(db_session) -> tuple[AcademicYear, Semester]:
    tag = uuid.uuid4().hex[:6]
    year = AcademicYear(
        name=f"OldYear {tag}", start_date=date(2023, 9, 1), end_date=date(2024, 6, 30),
        status=AcademicYearStatus.ARCHIVED, archived_at=_now(),
    )
    db_session.add(year)
    db_session.flush()
    sem = Semester(
        academic_year_id=year.id, name="Semester 1", sequence=1,
        start_date=date(2023, 9, 1), end_date=date(2024, 1, 31), is_active=False,
    )
    db_session.add(sem)
    db_session.flush()
    return year, sem


def _course(db_session, *, name=None, credits=3) -> Course:
    tag = uuid.uuid4().hex[:6]
    c = Course(
        name=name or f"Course {tag}",
        code=f"C{tag.upper()}",
        credits=credits,
    )
    db_session.add(c)
    db_session.flush()
    return c


def _offering(
    db_session, semester, *, course=None, section_code=None, capacity=None,
    archived=False, teacher=None,
) -> CourseOffering:
    """One offering, optionally staffed. Replaces `_section` + `_subject_class`, which
    built two rows apiece."""
    course = course or _course(db_session)
    off = CourseOffering(
        course_id=course.id,
        semester_id=semester.id,
        # Random by default: identity is (course, semester, section) and several tests
        # put two offerings of one course in one term.
        section_code=section_code or uuid.uuid4().hex[:6],
        capacity=capacity,
        is_archived=archived,
    )
    db_session.add(off)
    db_session.flush()
    if teacher is not None:
        db_session.add(
            ClassTeacher(offering_id=off.id, teacher_id=teacher.id, is_lead=True)
        )
        db_session.flush()
    off._course = course  # for label assertions; see `_label`
    return off


def _label(offering) -> str:
    """What the API sends for this offering — built with the SERVER's `offering_label`
    rather than re-spelled, so the test cannot pin a second formula."""
    return offering_label(offering._course.code, offering.section_code)


def _student(db_session, *, status=StudentStatus.ACTIVE, user_id=None) -> StudentProfile:
    s = StudentProfile(
        user_id=user_id,
        student_number=f"S-{uuid.uuid4().hex[:8]}",
        **split_name(f"Stu {uuid.uuid4().hex[:5]}"),
        date_of_birth=date(2007, 5, 1),
        enrollment_date=date(2025, 9, 1),
        status=status,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _teacher(db_session, *, user_id=None) -> TeacherProfile:
    t = TeacherProfile(
        user_id=user_id,
        staff_number=f"T-{uuid.uuid4().hex[:8]}",
        full_name=f"Lecturer {uuid.uuid4().hex[:5]}",
        status=TeacherStatus.ACTIVE,
    )
    db_session.add(t)
    db_session.flush()
    return t


def _meeting(db_session, offering_id, *, day, start, end, room=None) -> ClassMeeting:
    m = ClassMeeting(
        offering_id=offering_id,
        day_of_week=day,
        start_time=time.fromisoformat(start),
        end_time=time.fromisoformat(end),
        room=room,
    )
    db_session.add(m)
    db_session.flush()
    return m


def _enroll(db_session, offering_id, student_id, semester_id) -> ClassEnrollment:
    e = ClassEnrollment(
        offering_id=offering_id, student_id=student_id, semester_id=semester_id
    )
    db_session.add(e)
    db_session.flush()
    return e


def _P(auth_headers, make_user):
    """Dean headers — scheduling is Dean OR Registrar (D30 §D14)."""
    u = make_user(role=Role.PRINCIPAL)
    return u, auth_headers(user_id=u.id, role=Role.PRINCIPAL)


def _S(auth_headers, make_user):
    u = make_user(role=Role.SECRETARY)
    return u, auth_headers(user_id=u.id, role=Role.SECRETARY)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_list_requires_auth(self, client) -> None:
        assert client.get(OFFERINGS).status_code == 401

    def test_create_forbidden_for_teacher(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        user = make_user(role=Role.TEACHER)
        course = _course(db_session)
        r = client.post(
            OFFERINGS,
            headers=auth_headers(user_id=user.id, role=Role.TEACHER),
            json={"course_id": str(course.id)},
        )
        assert r.status_code == 403

    def test_create_forbidden_for_student(self, client, make_user, auth_headers) -> None:
        user = make_user(role=Role.STUDENT)
        r = client.post(
            OFFERINGS,
            headers=auth_headers(user_id=user.id, role=Role.STUDENT),
            json={"course_id": str(uuid.uuid4())},
        )
        assert r.status_code == 403

    def test_the_registrar_may_schedule(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Scheduling is operational work: Dean OR Registrar (D30 §D14). Only the
        CATALOG and the CURRICULUM are Dean-only."""
        _year, _sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _u, H = _S(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={"course_id": str(course.id)})
        assert r.status_code == 201, r.text


# ════════════════════════════════════════════════════════════════════════════
class TestCreate:
    def test_create_ok(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id),
            "semester_id": str(sem.id),
            "section_code": "01",
            "capacity": 30,
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["course"]["id"] == str(course.id)
        assert body["semester"]["id"] == str(sem.id)
        assert body["section_code"] == "01"
        # The label is DERIVED and sent by the server — there is no stored name.
        assert body["label"] == offering_label(course.code, "01")
        # Credits live only on the catalog, and the ref carries them.
        assert body["course"]["credits"] == 3

    def test_create_with_teachers_and_meetings_is_atomic(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The whole "MATH1110-01, Prof. Cano, Mon 08:00-09:30" in ONE request."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        lecturer = _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id),
            "semester_id": str(sem.id),
            "teacher_ids": [str(lecturer.id)],
            "lead_teacher_id": str(lecturer.id),
            "meetings": [
                {"day_of_week": 1, "start_time": "08:00", "end_time": "09:30",
                 "room": "Room A"},
            ],
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert [t["id"] for t in body["teachers"]] == [str(lecturer.id)]
        assert body["lead_teacher_id"] == str(lecturer.id)
        assert len(body["meetings"]) == 1

    def test_create_without_course_422(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`course_id` is required: D31 removed the two-step "create then attach"."""
        _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={"section_code": "01"})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="validation_error")

    def test_create_unknown_course_404(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _writable_year(db_session, archive_seeded_active_year)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={"course_id": str(uuid.uuid4())})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="course_not_found")

    def test_create_defaults_to_the_active_semester(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={"course_id": str(course.id)})
        assert r.status_code == 201, r.text
        assert r.json()["semester"]["id"] == str(sem.id)

    def test_duplicate_course_term_section_409(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`(course_id, semester_id, section_code)` IS the offering's identity."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _offering(db_session, sem, course=course, section_code="01")
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem.id),
            "section_code": "01",
        })
        assert r.status_code == 409
        _assert_envelope(r.json(), code="duplicate_offering")

    def test_two_sections_of_one_course_coexist_in_one_term(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Parallel sections — §01 and §02 of the same course, same term."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        first = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem.id), "section_code": "01",
        })
        second = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem.id), "section_code": "02",
        })
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        assert first.json()["id"] != second.json()["id"]
        assert first.json()["label"] != second.json()["label"]

    def test_the_same_course_runs_in_two_semesters(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """**The point of D31.** `classes` carried `academic_year_id` and no semester, so
        "Programming I, Semester 1" and "Programming I, Semester 2" could only be told
        apart by two same-year rows with different names."""
        year, sem1 = _writable_year(db_session, archive_seeded_active_year)
        sem2 = _second_semester(db_session, year)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        a = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem1.id),
        })
        b = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem2.id),
        })
        assert a.status_code == 201, a.text
        assert b.status_code == 201, b.text
        assert a.json()["semester"]["id"] == str(sem1.id)
        assert b.json()["semester"]["id"] == str(sem2.id)

    def test_two_unsectioned_offerings_of_one_course_in_one_term_are_refused(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`active_section` is `coalesce(section_code, '')`, and the COALESCE is
        load-bearing: unique indexes do not collide on NULL, so without it a course could
        be offered twice unsectioned in one term with nothing to tell the two apart."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        first = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem.id),
        })
        assert first.status_code == 201, first.text
        second = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem.id),
        })
        assert second.status_code == 409, second.text
        _assert_envelope(second.json(), code="duplicate_offering")

    def test_create_in_archived_year_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        _old, old_sem = _archived_year(db_session)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(old_sem.id),
        })
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

    def test_academic_year_id_is_not_accepted(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """An offering is scheduled into a TERM; the year follows from it and is never
        stored alongside. The request model forbids extras, so sending the old field is a
        422 rather than a silently ignored value."""
        _year, _sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "academic_year_id": str(uuid.uuid4()),
        })
        assert r.status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestReadAndScope:
    def test_list_shape_and_counts(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem, capacity=20)
        stu = _student(db_session)
        _enroll(db_session, off.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        body = client.get(OFFERINGS, headers=H).json()
        row = next(i for i in body["items"] if i["id"] == str(off.id))
        assert row["label"] == _label(off)
        assert row["course"]["id"] == str(off._course.id)
        assert row["semester"]["id"] == str(sem.id)
        assert row["capacity"] == 20
        assert row["enrolled_count"] == 1
        # The homeroom columns are gone entirely, not renamed.
        assert "name" not in row and "grade_level" not in row

    def test_list_filters_by_course(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        wanted = _course(db_session)
        mine = _offering(db_session, sem, course=wanted)
        other = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        ids = {
            i["id"]
            for i in client.get(
                OFFERINGS, headers=H, params={"course_id": str(wanted.id)}
            ).json()["items"]
        }
        assert str(mine.id) in ids
        assert str(other.id) not in ids

    def test_list_filters_by_semester(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`grade_level` is gone as a filter; term is what narrows a list now."""
        year, sem1 = _writable_year(db_session, archive_seeded_active_year)
        sem2 = _second_semester(db_session, year)
        course = _course(db_session)
        first = _offering(db_session, sem1, course=course)
        second = _offering(db_session, sem2, course=course)
        _u, H = _P(auth_headers, make_user)
        ids = {
            i["id"]
            for i in client.get(
                OFFERINGS, headers=H, params={"semester_id": str(sem2.id)}
            ).json()["items"]
        }
        assert str(second.id) in ids
        assert str(first.id) not in ids

    def test_detail_over_capacity_flag(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem, capacity=1)
        for _ in range(2):
            _enroll(db_session, off.id, _student(db_session).id, sem.id)
        _u, H = _P(auth_headers, make_user)
        body = client.get(f"{OFFERINGS}/{off.id}", headers=H).json()
        assert body["over_capacity"] is True
        assert body["enrolled_count"] == 2

    def test_detail_carries_the_year_through_the_semester(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        body = client.get(f"{OFFERINGS}/{off.id}", headers=H).json()
        assert body["academic_year"]["id"] == str(year.id)

    def test_detail_not_found(self, client, make_user, auth_headers) -> None:
        _u, H = _P(auth_headers, make_user)
        assert client.get(f"{OFFERINGS}/{uuid.uuid4()}", headers=H).status_code == 404

    def test_lecturer_scope_only_owned(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        user = make_user(role=Role.TEACHER)
        lecturer = _teacher(db_session, user_id=user.id)
        owned = _offering(db_session, sem, teacher=lecturer)
        other = _offering(db_session, sem)
        H = auth_headers(user_id=user.id, role=Role.TEACHER)
        ids = {i["id"] for i in client.get(OFFERINGS, headers=H).json()["items"]}
        assert str(owned.id) in ids
        assert str(other.id) not in ids

    def test_lecturer_detail_denied_is_404_not_403(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """No existence leak (§3.3): "not yours" and "does not exist" look identical."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        user = make_user(role=Role.TEACHER)
        _teacher(db_session, user_id=user.id)
        other = _offering(db_session, sem)
        H = auth_headers(user_id=user.id, role=Role.TEACHER)
        assert client.get(f"{OFFERINGS}/{other.id}", headers=H).status_code == 404

    def test_student_sees_only_what_they_are_enrolled_in(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        user = make_user(role=Role.STUDENT)
        stu = _student(db_session, user_id=user.id)
        mine = _offering(db_session, sem)
        theirs = _offering(db_session, sem)
        _enroll(db_session, mine.id, stu.id, sem.id)
        H = auth_headers(user_id=user.id, role=Role.STUDENT)
        ids = {i["id"] for i in client.get(OFFERINGS, headers=H).json()["items"]}
        assert str(mine.id) in ids
        assert str(theirs.id) not in ids


# ════════════════════════════════════════════════════════════════════════════
class TestUpdateDelete:
    def test_patch_ok(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem, capacity=10)
        _u, H = _P(auth_headers, make_user)
        r = client.patch(f"{OFFERINGS}/{off.id}", headers=H, json={"capacity": 25})
        assert r.status_code == 200, r.text
        assert r.json()["capacity"] == 25

    def test_the_course_is_not_editable(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Changing the course would silently reinterpret every assessment, grade and
        attendance record already recorded against the offering. Create another one."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.patch(
            f"{OFFERINGS}/{off.id}", headers=H,
            json={"course_id": str(_course(db_session).id)},
        )
        assert r.status_code == 422

    def test_the_semester_is_not_editable(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.patch(
            f"{OFFERINGS}/{off.id}", headers=H,
            json={"semester_id": str(_second_semester(db_session, year).id)},
        )
        assert r.status_code == 422

    def test_delete_empty_ok(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        assert client.delete(f"{OFFERINGS}/{off.id}", headers=H).status_code == 204

    def test_delete_with_academic_history_409(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """History means ASSESSMENTS or ATTENDANCE — things that happened. A live
        enrolment is not history: delete closes it and proceeds (see the next test), which
        is why "archive instead" is only forced once there is a record to preserve."""
        from app.modules.assessments.models import Assessment
        from decimal import Decimal

        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        db_session.add(Assessment(
            offering_id=off.id, semester_id=sem.id, title="Quiz", type="quiz",
            max_score=Decimal("10"), weight=Decimal("1"), status="draft",
        ))
        db_session.flush()
        _u, H = _P(auth_headers, make_user)
        r = client.delete(f"{OFFERINGS}/{off.id}", headers=H)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="offering_has_history")

    def test_delete_closes_live_enrollments_rather_than_refusing(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        enr = _enroll(db_session, off.id, _student(db_session).id, sem.id)
        _u, H = _P(auth_headers, make_user)
        assert client.delete(f"{OFFERINGS}/{off.id}", headers=H).status_code == 204
        db_session.refresh(enr)
        assert enr.unenrolled_at is not None

    def test_a_soft_deleted_offering_releases_its_slot(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`active_section` is NULL once `deleted_at` is set, so the identity frees up and
        a replacement offering of the same course/term/section can be created."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        course = _course(db_session)
        off = _offering(db_session, sem, course=course, section_code="01")
        _u, H = _P(auth_headers, make_user)
        assert client.delete(f"{OFFERINGS}/{off.id}", headers=H).status_code == 204
        r = client.post(OFFERINGS, headers=H, json={
            "course_id": str(course.id), "semester_id": str(sem.id),
            "section_code": "01",
        })
        assert r.status_code == 201, r.text


# ════════════════════════════════════════════════════════════════════════════
class TestTeacherAssignment:
    def test_assign_teachers_ok(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`PUT /offerings/{id}/teachers` — D31 dropped the middle segment from
        `PUT /classes/{id}/subjects/{cs}/teachers`; there is only one gradebook now."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        one, two = _teacher(db_session), _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/teachers", headers=H, json={
            "teacher_ids": [str(one.id), str(two.id)],
            "lead_teacher_id": str(two.id),
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert {t["id"] for t in body["teachers"]} == {str(one.id), str(two.id)}
        assert body["lead_teacher_id"] == str(two.id)

    def test_assign_is_a_full_replace(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        first = _teacher(db_session)
        off = _offering(db_session, sem, teacher=first)
        replacement = _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/teachers", headers=H, json={
            "teacher_ids": [str(replacement.id)],
        })
        assert r.status_code == 200, r.text
        assert {t["id"] for t in r.json()["teachers"]} == {str(replacement.id)}

    def test_assign_lead_not_in_set_422(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        member, outsider = _teacher(db_session), _teacher(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/teachers", headers=H, json={
            "teacher_ids": [str(member.id)], "lead_teacher_id": str(outsider.id),
        })
        assert r.status_code == 422

    def test_assign_unknown_teacher_404(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/teachers", headers=H, json={
            "teacher_ids": [str(uuid.uuid4())],
        })
        assert r.status_code == 404
        _assert_envelope(r.json(), code="teacher_not_found")


# ════════════════════════════════════════════════════════════════════════════
class TestEnrollment:
    def test_enroll_and_roster(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        stu = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H,
                        json={"student_ids": [str(stu.id)]})
        assert r.status_code == 200, r.text
        assert len(r.json()["enrolled"]) == 1
        roster = client.get(f"{OFFERINGS}/{off.id}/roster", headers=H).json()
        assert [e["student"]["id"] for e in roster] == [str(stu.id)]

    def test_enroll_does_not_transfer(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Enrolling Freddy in Biology must NOT drop him from Math. A student takes a
        LOAD of courses, and one enrolment now points at exactly one of them."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        math = _offering(db_session, sem)
        bio = _offering(db_session, sem)
        freddy = _student(db_session)
        _enroll(db_session, math.id, freddy.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{bio.id}/enrollments", headers=H,
                        json={"student_ids": [str(freddy.id)]})
        assert r.status_code == 200, r.text
        math_roster = client.get(f"{OFFERINGS}/{math.id}/roster", headers=H).json()
        assert [e["student"]["id"] for e in math_roster] == [str(freddy.id)], (
            "enrolling elsewhere must not remove the student from Math"
        )

    def test_enroll_is_idempotent(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        stu = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        body = {"student_ids": [str(stu.id)]}
        assert client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H,
                           json=body).status_code == 200
        assert client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H,
                           json=body).status_code == 200
        roster = client.get(f"{OFFERINGS}/{off.id}/roster", headers=H).json()
        assert len(roster) == 1

    def test_enroll_reports_student_schedule_clash_but_enrolls(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """A clash is a warning, not a block (D-Q6 precedent)."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        math = _offering(db_session, sem)
        bio = _offering(db_session, sem)
        _meeting(db_session, math.id, day=1, start="08:00", end="09:30")
        _meeting(db_session, bio.id, day=1, start="09:00", end="10:00")  # overlaps
        stu = _student(db_session)
        _enroll(db_session, math.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{bio.id}/enrollments", headers=H,
                        json={"student_ids": [str(stu.id)]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["enrolled"]) == 1, "the clash must not block the enrollment"
        clashes = body["schedule_conflicts"]
        assert len(clashes) == 1
        assert clashes[0]["kind"] == "student"
        assert clashes[0]["with_offering_id"] == str(math.id)
        assert clashes[0]["with_offering_label"] == _label(math)

    def test_enroll_back_to_back_meetings_do_not_clash(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """08:00-09:00 then 09:00-10:00 is a normal day, not a conflict."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        first = _offering(db_session, sem)
        second = _offering(db_session, sem)
        _meeting(db_session, first.id, day=1, start="08:00", end="09:00")
        _meeting(db_session, second.id, day=1, start="09:00", end="10:00")
        stu = _student(db_session)
        _enroll(db_session, first.id, stu.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{second.id}/enrollments", headers=H,
                        json={"student_ids": [str(stu.id)]})
        assert r.status_code == 200, r.text
        assert r.json()["schedule_conflicts"] == []

    def test_enroll_over_capacity_warns_not_blocks(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem, capacity=1)
        students = [_student(db_session) for _ in range(2)]
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H,
                        json={"student_ids": [str(s.id) for s in students]})
        assert r.status_code == 200, r.text
        assert r.json()["over_capacity_warning"] is True
        assert len(r.json()["enrolled"]) == 2  # not blocked

    def test_enroll_into_a_different_term_409(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """An offering runs in ONE term (D31), so an enrolment naming another is a
        mistake the server can see — and must not silently accept."""
        year, sem1 = _writable_year(db_session, archive_seeded_active_year)
        sem2 = _second_semester(db_session, year)
        off = _offering(db_session, sem1)
        stu = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H, json={
            "student_ids": [str(stu.id)], "semester_id": str(sem2.id),
        })
        assert r.status_code == 409, r.text
        _assert_envelope(r.json(), code="semester_mismatch")

    def test_enroll_unknown_student_404(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H,
                        json={"student_ids": [str(uuid.uuid4())]})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="student_not_found")

    def test_unenroll(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        enr = _enroll(db_session, off.id, _student(db_session).id, sem.id)
        _u, H = _P(auth_headers, make_user)
        r = client.delete(f"{OFFERINGS}/{off.id}/enrollments/{enr.id}", headers=H)
        assert r.status_code == 204, r.text
        assert client.get(f"{OFFERINGS}/{off.id}/roster", headers=H).json() == []

    def test_roster_include_withdrawn(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        enr = _enroll(db_session, off.id, _student(db_session).id, sem.id)
        _u, H = _P(auth_headers, make_user)
        client.delete(f"{OFFERINGS}/{off.id}/enrollments/{enr.id}", headers=H)
        rows = client.get(
            f"{OFFERINGS}/{off.id}/roster", headers=H, params={"include": "withdrawn"}
        ).json()
        assert len(rows) == 1
        assert rows[0]["unenrolled_at"] is not None

    def test_enrollable_excludes_the_roster(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        enrolled = _student(db_session)
        free = _student(db_session)
        _enroll(db_session, off.id, enrolled.id, sem.id)
        _u, H = _P(auth_headers, make_user)
        ids = {
            s["id"]
            for s in client.get(
                f"{OFFERINGS}/{off.id}/enrollable-students", headers=H
            ).json()["items"]
        }
        assert str(free.id) in ids
        assert str(enrolled.id) not in ids

    def test_student_cannot_read_the_roster(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        user = make_user(role=Role.STUDENT)
        stu = _student(db_session, user_id=user.id)
        _enroll(db_session, off.id, stu.id, sem.id)
        H = auth_headers(user_id=user.id, role=Role.STUDENT)
        assert client.get(f"{OFFERINGS}/{off.id}/roster", headers=H).status_code == 403


# ════════════════════════════════════════════════════════════════════════════
class TestArchivedYearGuard:
    def test_enroll_into_archived_year_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        _old, old_sem = _archived_year(db_session)
        off = _offering(db_session, old_sem)
        stu = _student(db_session)
        _u, H = _P(auth_headers, make_user)
        r = client.post(f"{OFFERINGS}/{off.id}/enrollments", headers=H,
                        json={"student_ids": [str(stu.id)]})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

    def test_patch_in_archived_year_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        _old, old_sem = _archived_year(db_session)
        off = _offering(db_session, old_sem)
        _u, H = _P(auth_headers, make_user)
        r = client.patch(f"{OFFERINGS}/{off.id}", headers=H, json={"capacity": 5})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

    def test_replace_meetings_in_archived_year_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        _old, old_sem = _archived_year(db_session)
        off = _offering(db_session, old_sem)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "08:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


# ════════════════════════════════════════════════════════════════════════════
class TestMeetings:
    def test_replace_and_read_back(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "08:00", "end_time": "09:30",
             "room": "Room A"},
            {"day_of_week": 3, "start_time": "10:00", "end_time": "11:00",
             "room": "Room B"},
        ]})
        assert r.status_code == 200, r.text
        assert len(r.json()["meetings"]) == 2
        read = client.get(f"{OFFERINGS}/{off.id}/meetings", headers=H).json()
        assert [(m["day_of_week"], m["room"]) for m in read["meetings"]] == [
            (1, "Room A"), (3, "Room B"),
        ]

    def test_replace_is_a_full_replace(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _meeting(db_session, off.id, day=5, start="14:00", end="15:00")
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 2, "start_time": "08:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 200, r.text
        assert [m["day_of_week"] for m in r.json()["meetings"]] == [2]

    def test_empty_list_clears_the_week(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _meeting(db_session, off.id, day=1, start="08:00", end="09:00")
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H,
                       json={"meetings": []})
        assert r.status_code == 200, r.text
        assert r.json()["meetings"] == []

    def test_weekend_day_422(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 6, "start_time": "08:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 422

    def test_end_before_start_422(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "10:00", "end_time": "09:00"},
        ]})
        assert r.status_code == 422

    def test_teacher_double_booking_warns_but_saves(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """A lecturer cannot teach two offerings at once — reported, still written."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        smith = _teacher(db_session)
        other = _offering(db_session, sem, teacher=smith)
        _meeting(db_session, other.id, day=1, start="08:00", end="09:30", room="Room C")
        mine = _offering(db_session, sem, teacher=smith)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{mine.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "09:00", "end_time": "10:00",
             "room": "Room A"},
        ]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["meetings"]) == 1, "the warning must not block the write"
        clash = next(c for c in body["conflicts"] if c["kind"] == "teacher")
        assert clash["with_offering_id"] == str(other.id)
        assert clash["with_offering_label"] == _label(other)
        assert clash["label"] == smith.full_name

    def test_room_double_booking_warns(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Room match is case/whitespace-insensitive — "lab 1" clashes with "Lab 1"."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        other = _offering(db_session, sem)
        _meeting(db_session, other.id, day=2, start="09:00", end="10:00", room="Lab 1")
        mine = _offering(db_session, sem)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{mine.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 2, "start_time": "09:30", "end_time": "10:30",
             "room": "  lab 1 "},
        ]})
        assert r.status_code == 200, r.text
        assert any(
            c["kind"] == "room" and c["with_offering_id"] == str(other.id)
            for c in r.json()["conflicts"]
        )

    def test_no_conflict_across_years(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Last year's timetable must not flag this year's."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        _old, old_sem = _archived_year(db_session)
        smith = _teacher(db_session)
        old = _offering(db_session, old_sem, teacher=smith)
        _meeting(db_session, old.id, day=1, start="08:00", end="09:30", room="Room A")
        mine = _offering(db_session, sem, teacher=smith)
        _u, H = _P(auth_headers, make_user)
        r = client.put(f"{OFFERINGS}/{mine.id}/meetings", headers=H, json={"meetings": [
            {"day_of_week": 1, "start_time": "08:00", "end_time": "09:30",
             "room": "Room A"},
        ]})
        assert r.status_code == 200, r.text
        assert r.json()["conflicts"] == []

    def test_student_can_read_meetings_of_their_own_offering(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        off = _offering(db_session, sem)
        _meeting(db_session, off.id, day=1, start="08:00", end="09:00")
        user = make_user(role=Role.STUDENT)
        stu = _student(db_session, user_id=user.id)
        _enroll(db_session, off.id, stu.id, sem.id)
        H = auth_headers(user_id=user.id, role=Role.STUDENT)
        r = client.get(f"{OFFERINGS}/{off.id}/meetings", headers=H)
        assert r.status_code == 200, r.text
        assert len(r.json()["meetings"]) == 1

    def test_student_cannot_read_another_offerings_meetings(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        theirs = _offering(db_session, sem)
        user = make_user(role=Role.STUDENT)
        _student(db_session, user_id=user.id)
        H = auth_headers(user_id=user.id, role=Role.STUDENT)
        assert client.get(
            f"{OFFERINGS}/{theirs.id}/meetings", headers=H
        ).status_code == 404

    def test_teacher_cannot_write_meetings(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Scheduling is Dean/Registrar work; a lecturer reads their week, never sets it."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        user = make_user(role=Role.TEACHER)
        lecturer = _teacher(db_session, user_id=user.id)
        off = _offering(db_session, sem, teacher=lecturer)
        H = auth_headers(user_id=user.id, role=Role.TEACHER)
        r = client.put(f"{OFFERINGS}/{off.id}/meetings", headers=H, json={"meetings": []})
        assert r.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
class TestOwnershipGateAfterTheMerge:
    """`assert_teacher_owns_offering` — the ONE gate D31 left behind.

    Before D31 there were two: `assert_teacher_owns_class_subject` ("may this lecturer
    touch this gradebook?") and `assert_teacher_owns_section` ("may they mark this
    register?"). They were different questions only while a `classes` row was a homeroom
    teaching ~7 subjects — owning one subject granted access to the whole section's
    register, and to every student on it. One course per offering makes them the same
    lookup, and the widened access goes with the homeroom.
    """

    def _lecturer_with_one_offering(self, db_session, make_user, auth_headers, sem):
        user = make_user(role=Role.TEACHER)
        lecturer = _teacher(db_session, user_id=user.id)
        mine = _offering(db_session, sem, teacher=lecturer)
        return lecturer, auth_headers(user_id=user.id, role=Role.TEACHER), mine

    def test_teaching_one_offering_does_not_reach_another(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The access the homeroom used to grant is exactly what must NOT survive."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        _lecturer, H, mine = self._lecturer_with_one_offering(
            db_session, make_user, auth_headers, sem
        )
        theirs = _offering(db_session, sem, teacher=_teacher(db_session))

        assert client.get(f"{OFFERINGS}/{mine.id}/roster", headers=H).status_code == 200
        assert client.get(f"{OFFERINGS}/{theirs.id}/roster", headers=H).status_code == 404

    def test_denial_is_404_never_403(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """A 403 would confirm that an offering the caller does not teach EXISTS
        (api-spec §3.3). The unowned id and a made-up one must be indistinguishable."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        _lecturer, H, _mine = self._lecturer_with_one_offering(
            db_session, make_user, auth_headers, sem
        )
        theirs = _offering(db_session, sem, teacher=_teacher(db_session))

        real = client.get(f"{OFFERINGS}/{theirs.id}", headers=H)
        imaginary = client.get(f"{OFFERINGS}/{uuid.uuid4()}", headers=H)
        assert real.status_code == imaginary.status_code == 404
        assert real.json() == imaginary.json(), "the two must be byte-identical"

    def test_the_same_gate_guards_the_register_and_the_gradebook(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """One lookup, two surfaces. Two names for it would imply a distinction that the
        tertiary model no longer has."""
        _year, sem = _writable_year(db_session, archive_seeded_active_year)
        _lecturer, H, _mine = self._lecturer_with_one_offering(
            db_session, make_user, auth_headers, sem
        )
        theirs = _offering(db_session, sem, teacher=_teacher(db_session))

        register = client.get(
            "/api/v1/attendance", headers=H, params={"offering_id": str(theirs.id)}
        )
        gradebook = client.get(f"/api/v1/grades/offering/{theirs.id}", headers=H)
        assert register.status_code == 404, register.text
        assert gradebook.status_code == 404, gradebook.text


# ════════════════════════════════════════════════════════════════════════════
class TestSemesterScoping:
    """An offering reaches its YEAR through its semester (`offerings_in_year`).

    `classes.academic_year_id` answered "which year?" with an attribute access in ~15
    services; the hop is a subquery now, and getting it wrong is invisible until a list
    silently spans years. These pin both directions.
    """

    def test_a_year_filter_spans_both_of_its_terms(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, sem1 = _writable_year(db_session, archive_seeded_active_year)
        sem2 = _second_semester(db_session, year)
        first = _offering(db_session, sem1)
        second = _offering(db_session, sem2)
        _u, H = _P(auth_headers, make_user)
        ids = {
            i["id"]
            for i in client.get(
                OFFERINGS, headers=H,
                params={"academic_year_id": str(year.id), "page_size": 200},
            ).json()["items"]
        }
        assert {str(first.id), str(second.id)} <= ids, (
            "a YEAR filter must reach every term of that year, not just the active one"
        )

    def test_a_year_filter_excludes_another_years_terms(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, sem = _writable_year(db_session, archive_seeded_active_year)
        _old, old_sem = _archived_year(db_session)
        mine = _offering(db_session, sem)
        old = _offering(db_session, old_sem)
        _u, H = _P(auth_headers, make_user)
        ids = {
            i["id"]
            for i in client.get(
                OFFERINGS, headers=H,
                params={"academic_year_id": str(year.id), "page_size": 200},
            ).json()["items"]
        }
        assert str(mine.id) in ids
        assert str(old.id) not in ids

    def test_a_semester_filter_narrows_within_the_year(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, sem1 = _writable_year(db_session, archive_seeded_active_year)
        sem2 = _second_semester(db_session, year)
        course = _course(db_session)
        first = _offering(db_session, sem1, course=course)
        second = _offering(db_session, sem2, course=course)
        _u, H = _P(auth_headers, make_user)
        ids = {
            i["id"]
            for i in client.get(
                OFFERINGS, headers=H,
                params={"semester_id": str(sem1.id), "page_size": 200},
            ).json()["items"]
        }
        assert str(first.id) in ids
        assert str(second.id) not in ids, (
            "the same course in the other term is a DIFFERENT offering"
        )

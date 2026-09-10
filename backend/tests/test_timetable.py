"""Pytest suite for Module 13 — TIMETABLE (D29, FR-SCH-03..05).

Two endpoints:
  GET /timetable/me                  authenticated (Student = enrolled, Teacher = taught)
  GET /timetable/students/{id}       P/S

The scenario every test builds on is the one the stakeholder described:

    Math-1  Mr. Smith   Room A   Mon 08:00      Freddy
    Math-2  Mrs. Jones  Room C   Mon 10:00      John
    Biology-10          Lab 1    Tue 09:00      Freddy + John
    English-5           Room D   Wed 11:00      Freddy + John

Freddy and John share Biology and English but sit in DIFFERENT Math classes, so their
weeks must differ in exactly one slot. That is the assertion that proves the
subject-class model — a homeroom model cannot express it at all.

Hermetic + rolled-back via the `db_session` transactional rollback (conftest 7.0c):
the seeded active year is archived and each test builds its own year, so nothing
depends on the demo seed and nothing is committed.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

import pytest

from app.common.enums import AcademicYearStatus, Role, StudentStatus, TeacherStatus
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassMeeting,
    ClassTeacher,
    Course,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

ME = "/api/v1/timetable/me"
FOR_STUDENT = "/api/v1/timetable/students"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


class _Graph:
    """The Freddy/John scenario, built once per test that asks for it."""

    def __init__(self, db, make_user, auth_headers, archive_seeded_active_year) -> None:
        self._db = db
        #: offering id -> its Course, so `label()` can derive what the API sends.
        self.courses: dict = {}
        self._make_user = make_user
        self._auth = auth_headers
        archive_seeded_active_year()

        tag = uuid.uuid4().hex[:6]
        self.year = AcademicYear(
            name=f"TT Year {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db.add(self.year)
        db.flush()
        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        db.add(self.sem)
        db.flush()

        principal = make_user(role=Role.PRINCIPAL)
        self.P = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        self.smith_user = make_user(role=Role.TEACHER, full_name=f"Smith {tag}")
        self.smith = self._teacher(f"Mr Smith {tag}", user_id=self.smith_user.id)
        self.jones = self._teacher(f"Mrs Jones {tag}")
        self.SMITH = auth_headers(user_id=self.smith_user.id, role=Role.TEACHER)

        self.math1, cs_math1 = self._klass(f"Math-1 {tag}", f"Math {tag}", self.smith)
        self.math2, cs_math2 = self._klass(f"Math-2 {tag}", f"Math2 {tag}", self.jones)
        self.bio, cs_bio = self._klass(f"Biology-10 {tag}", f"Bio {tag}", self.jones)
        self.eng, cs_eng = self._klass(f"English-5 {tag}", f"Eng {tag}", self.smith)

        self._meet(cs_math1, 1, "08:00", "09:30", "Room A")
        self._meet(cs_math2, 1, "10:00", "11:30", "Room C")
        self._meet(cs_bio, 2, "09:00", "10:00", "Lab 1")
        self._meet(cs_eng, 3, "11:00", "12:00", "Room D")

        self.freddy, self.freddy_user = self._student(f"Freddy {tag}")
        self.john, self.john_user = self._student(f"John {tag}")
        self.FREDDY = auth_headers(user_id=self.freddy_user.id, role=Role.STUDENT)
        self.JOHN = auth_headers(user_id=self.john_user.id, role=Role.STUDENT)

        for offering in (self.math1, self.bio, self.eng):
            self._enroll(self.freddy, offering)
        for offering in (self.math2, self.bio, self.eng):
            self._enroll(self.john, offering)

    # ── builders ────────────────────────────────────────────────────────────
    def _teacher(self, name, *, user_id=None) -> TeacherProfile:
        t = TeacherProfile(
            user_id=user_id, staff_number=f"T-{uuid.uuid4().hex[:8]}",
            full_name=name, status=TeacherStatus.ACTIVE,
        )
        self._db.add(t)
        self._db.flush()
        return t

    def _klass(self, class_name, subject_name, teacher) -> tuple[CourseOffering, CourseOffering]:
        """One offering of a freshly-created course, staffed by `teacher`.

        Returns the SAME object twice. Pre-D31 this built a section and then attached a
        subject to it, and the graph named them separately (`self.math1` the section,
        `cs_math1` the class_subject). An offering is both, so the pair is kept only so
        the call sites below still read the way they did.

        `class_name` is accepted and unused: an offering has no stored name (D31). The
        label a screen shows is derived from the course code, so the course carries the
        identity these tests assert on — see `self.label()`.
        """
        subject = Course(name=subject_name, code=uuid.uuid4().hex[:6])
        self._db.add(subject)
        self._db.flush()
        cs = CourseOffering(
            course_id=subject.id,
            semester_id=self.sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        self._db.add(cs)
        self._db.flush()
        self._db.add(ClassTeacher(offering_id=cs.id, teacher_id=teacher.id, is_lead=True))
        self._db.flush()
        self.courses[cs.id] = subject
        return cs, cs

    def label(self, offering) -> str:  # noqa: ANN001
        """The label the API sends for `offering`.

        Built with the SERVER's `offering_label`, not re-spelled here: the point of
        deriving a label in one place is lost if the test hardcodes a second formula
        that happens to agree today.
        """
        from app.modules.offerings.labels import offering_label

        return offering_label(self.courses[offering.id].code, offering.section_code)

    def _meet(self, cs, day, start, end, room) -> ClassMeeting:
        m = ClassMeeting(
            offering_id=cs.id, day_of_week=day,
            start_time=time.fromisoformat(start), end_time=time.fromisoformat(end),
            room=room,
        )
        self._db.add(m)
        self._db.flush()
        return m

    def _student(self, name) -> tuple[StudentProfile, object]:
        user = self._make_user(role=Role.STUDENT, full_name=name)
        s = StudentProfile(
            user_id=user.id, student_number=f"S-{uuid.uuid4().hex[:8]}", **split_name(name),
            date_of_birth=date(2008, 4, 1), enrollment_date=date(2025, 9, 1),
            status=StudentStatus.ACTIVE, year_of_study="First",
        )
        self._db.add(s)
        self._db.flush()
        return s, user

    def _enroll(self, student, offering) -> ClassEnrollment:
        e = ClassEnrollment(
            offering_id=offering.id, student_id=student.id, semester_id=self.sem.id
        )
        self._db.add(e)
        self._db.flush()
        return e


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year)


def _slots(body: dict) -> dict[int, list[tuple[str, str]]]:
    """{day_of_week: [(offering label, room)]} — the shape assertions read from.

    D31 replaced the entry's flat `class_name` with a nested `offering` ref carrying a
    derived `label`.
    """
    return {
        d["day_of_week"]: [(e["offering"]["label"], e["room"]) for e in d["entries"]]
        for d in body["days"]
    }


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_requires_auth(self, client) -> None:
        assert client.get(ME).status_code == 401

    def test_per_student_forbidden_for_teacher(self, client, graph) -> None:
        r = client.get(f"{FOR_STUDENT}/{graph.freddy.id}", headers=graph.SMITH)
        assert r.status_code == 403

    def test_per_student_forbidden_for_student(self, client, graph) -> None:
        """A student reads their own week via /me, never anyone else's by id."""
        r = client.get(f"{FOR_STUDENT}/{graph.john.id}", headers=graph.FREDDY)
        assert r.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
class TestStudentWeek:
    def test_envelope_always_has_five_weekdays(self, client, graph) -> None:
        """A blank Wednesday must be visibly blank, not missing."""
        body = client.get(ME, headers=graph.FREDDY).json()
        assert [d["day_of_week"] for d in body["days"]] == [1, 2, 3, 4, 5]
        assert [d["day_name"] for d in body["days"]] == [
            "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
        ]
        assert _slots(body)[4] == [] and _slots(body)[5] == []

    def test_freddy_week(self, client, graph) -> None:
        r = client.get(ME, headers=graph.FREDDY)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["student"]["id"] == str(graph.freddy.id)
        slots = _slots(body)
        assert slots[1] == [(graph.label(graph.math1), "Room A")]
        assert slots[2] == [(graph.label(graph.bio), "Lab 1")]
        assert slots[3] == [(graph.label(graph.eng), "Room D")]

    def test_john_week_differs_only_in_maths(self, client, graph) -> None:
        """THE assertion that proves D29: same Biology and English, different Math."""
        freddy = _slots(client.get(ME, headers=graph.FREDDY).json())
        john = _slots(client.get(ME, headers=graph.JOHN).json())

        assert freddy[1] == [(graph.label(graph.math1), "Room A")]
        assert john[1] == [(graph.label(graph.math2), "Room C")]
        assert freddy[1] != john[1], "Freddy and John are not in the same Math class"
        assert freddy[2] == john[2], "they meet together in Biology"
        assert freddy[3] == john[3], "and in English"

    def test_entries_carry_subject_and_teacher(self, client, graph) -> None:
        body = client.get(ME, headers=graph.FREDDY).json()
        monday = next(d for d in body["days"] if d["day_of_week"] == 1)
        entry = monday["entries"][0]
        assert entry["offering"]["course"]["name"].startswith("Math ")
        assert [t["full_name"] for t in entry["teachers"]] == [graph.smith.full_name]
        assert entry["start_time"] == "08:00:00" and entry["end_time"] == "09:30:00"

    def test_entries_are_start_time_ordered(self, client, graph, db_session) -> None:
        """Two Monday classes come back earliest-first regardless of insert order."""
        late, cs_late = graph._klass("Zzz Late", f"Late {uuid.uuid4().hex[:5]}", graph.jones)
        graph._meet(cs_late, 1, "14:00", "15:00", "Room Z")
        early, cs_early = graph._klass("Aaa Early", f"Early {uuid.uuid4().hex[:5]}", graph.jones)
        graph._meet(cs_early, 1, "07:00", "07:45", "Room Y")
        graph._enroll(graph.freddy, late)
        graph._enroll(graph.freddy, early)

        body = client.get(ME, headers=graph.FREDDY).json()
        monday = next(d for d in body["days"] if d["day_of_week"] == 1)
        assert [e["start_time"] for e in monday["entries"]] == [
            "07:00:00", "08:00:00", "14:00:00",
        ]

    def test_unscheduled_class_is_reported_not_dropped(self, client, graph) -> None:
        """A class with no meetings must not silently vanish from the timetable."""
        ghost, _cs = graph._klass("No Times Yet", f"Ghost {uuid.uuid4().hex[:5]}", graph.jones)
        graph._enroll(graph.freddy, ghost)
        body = client.get(ME, headers=graph.FREDDY).json()
        assert [u["offering"]["label"] for u in body["unscheduled"]] == [graph.label(ghost)]

    def test_withdrawn_enrollment_leaves_the_week(self, client, graph, db_session) -> None:
        for enr in db_session.query(ClassEnrollment).filter(
            ClassEnrollment.student_id == graph.freddy.id,
            ClassEnrollment.offering_id == graph.math1.id,
        ):
            enr.unenrolled_at = _now()
        db_session.flush()
        assert _slots(client.get(ME, headers=graph.FREDDY).json())[1] == []

    def test_other_year_is_excluded(self, client, graph, db_session) -> None:
        """An explicit past year must not be interleaved into the live week."""
        old = AcademicYear(
            name=f"Old {uuid.uuid4().hex[:5]}", start_date=date(2023, 9, 1),
            end_date=date(2024, 6, 30), status=AcademicYearStatus.ARCHIVED,
            archived_at=_now(),
        )
        db_session.add(old)
        db_session.flush()
        body = client.get(f"{ME}?academic_year_id={old.id}", headers=graph.FREDDY).json()
        assert all(d["entries"] == [] for d in body["days"])
        assert body["unscheduled"] == []


# ════════════════════════════════════════════════════════════════════════════
class TestTeacherWeek:
    def test_teacher_sees_only_classes_they_teach(self, client, graph) -> None:
        """Mr. Smith teaches Math-1 (Mon) and English-5 (Wed) — not Mrs. Jones's."""
        r = client.get(ME, headers=graph.SMITH)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["student"] is None, "a teacher's week is not about a student"
        slots = _slots(body)
        assert slots[1] == [(graph.label(graph.math1), "Room A")]
        assert slots[3] == [(graph.label(graph.eng), "Room D")]
        assert slots[2] == [], "Biology-10 is Mrs. Jones's class"

    def test_teacher_without_profile_gets_an_empty_week(self, client, make_user, auth_headers) -> None:
        """Owning nothing is an empty week, not a 404."""
        u = make_user(role=Role.TEACHER)
        r = client.get(ME, headers=auth_headers(user_id=u.id, role=Role.TEACHER))
        assert r.status_code == 200, r.text
        assert all(d["entries"] == [] for d in r.json()["days"])


# ════════════════════════════════════════════════════════════════════════════
class TestOfficeView:
    def test_principal_reads_any_students_week(self, client, graph) -> None:
        r = client.get(f"{FOR_STUDENT}/{graph.john.id}", headers=graph.P)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["student"]["id"] == str(graph.john.id)
        assert _slots(body)[1] == [(graph.label(graph.math2), "Room C")]

    def test_unknown_student_404(self, client, graph) -> None:
        r = client.get(f"{FOR_STUDENT}/{uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404

    def test_principal_own_week_is_empty(self, client, graph) -> None:
        """P/S have no personal timetable — an empty week, not an error."""
        r = client.get(ME, headers=graph.P)
        assert r.status_code == 200, r.text
        assert all(d["entries"] == [] for d in r.json()["days"])


# ════════════════════════════════════════════════════════════════════════════
class TestOneTermPerWeek:
    """D31 — a week belongs to ONE TERM, not to a year.

    This class exists because the D31 demo seed broke the old behaviour on contact.
    Under the year-scoped `classes` model a course could only be offered once per year,
    so scoping the timetable to the year happened to select one term's teaching. Once
    `MATH1110-01` could run in Semester 1 AND Semester 2 of the same year, a student
    enrolled in both got **Monday 08:00 rendered twice** — one of the two a class that
    does not start for four months.
    """

    def _second_term_twin(self, graph, db, offering, *, student=None, teacher=None):
        """Offer the SAME course again, in Semester 2 of the same year."""
        sem2 = Semester(
            academic_year_id=graph.year.id, name="Semester 2", sequence=2,
            start_date=date(2026, 2, 2), end_date=date(2026, 6, 30), is_active=False,
        )
        db.add(sem2)
        db.flush()
        course = graph.courses[offering.id]
        twin = CourseOffering(
            course_id=course.id, semester_id=sem2.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db.add(twin)
        db.flush()
        graph.courses[twin.id] = course
        # Same weekday and hour as the Semester-1 offering: that collision is the whole
        # point, and it is what a real continuation of a course looks like.
        db.add(ClassMeeting(
            offering_id=twin.id, day_of_week=1,
            start_time=time(8, 0), end_time=time(9, 30), room="Room A",
        ))
        if teacher is not None:
            db.add(ClassTeacher(offering_id=twin.id, teacher_id=teacher.id, is_lead=True))
        if student is not None:
            db.add(ClassEnrollment(
                offering_id=twin.id, student_id=student.id, semester_id=sem2.id,
            ))
        db.flush()
        return twin, sem2

    def test_student_week_shows_the_active_term_only(self, client, graph, db_session) -> None:
        """Two terms of one course, one Monday slot — the ACTIVE term's."""
        twin, _sem2 = self._second_term_twin(
            graph, db_session, graph.math1, student=graph.freddy
        )
        r = client.get(ME, headers=graph.FREDDY)
        assert r.status_code == 200, r.text
        monday = _slots(r.json())[1]
        assert len(monday) == 1, (
            f"Monday shows {len(monday)} entries; a year-scoped week duplicates the "
            f"course across both of its terms: {monday}"
        )
        assert monday == [(graph.label(graph.math1), "Room A")]
        assert graph.label(twin) != graph.label(graph.math1), (
            "the twin must be a distinguishable offering, or this proves nothing"
        )

    def test_teacher_week_shows_the_active_term_only(self, client, graph, db_session) -> None:
        """The same narrowing applies to a lecturer teaching both terms."""
        self._second_term_twin(graph, db_session, graph.math1, teacher=graph.smith)
        r = client.get(ME, headers=graph.SMITH)
        assert r.status_code == 200, r.text
        monday = _slots(r.json())[1]
        assert monday == [(graph.label(graph.math1), "Room A")], monday

    def test_office_view_of_a_students_week_is_narrowed_too(
        self, client, graph, db_session
    ) -> None:
        """`/timetable/students/{id}` shares the scoping, not just `/me`."""
        self._second_term_twin(graph, db_session, graph.math1, student=graph.freddy)
        r = client.get(f"{FOR_STUDENT}/{graph.freddy.id}", headers=graph.P)
        assert r.status_code == 200, r.text
        assert _slots(r.json())[1] == [(graph.label(graph.math1), "Room A")]

    def test_with_no_active_term_the_latest_one_held_is_used(
        self, client, graph, db_session
    ) -> None:
        """The archived-year path: no active semester, so the highest `sequence` the
        caller actually holds wins — not a blank grid, which reads as a broken filter.
        """
        twin, _sem2 = self._second_term_twin(
            graph, db_session, graph.math1, student=graph.freddy
        )
        graph.sem.is_active = False
        db_session.flush()

        r = client.get(ME, headers=graph.FREDDY)
        assert r.status_code == 200, r.text
        monday = _slots(r.json())[1]
        assert monday == [(graph.label(twin), "Room A")], monday
        # Semester 1's other courses drop out with it: one term, one week.
        assert _slots(r.json())[2] == []

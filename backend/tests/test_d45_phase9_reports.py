"""D45 Phase 9 — the four institutional reports of blueprint §53.

    /reports/new-vs-returning      §53 Enrollment
    /reports/overcapacity          §53 Registration
    /reports/credit-load           §53 Registration
    /reports/programme-attendance  §53 Attendance (the "department" report — C4)

**WHAT THESE TESTS ARE ACTUALLY DEFENDING.** Not that four endpoints answer 200. A
management report is a DEFINITION with a number attached, and the definitions are where
this phase can go quietly wrong:

  * "registered" must mean the same thing here as it does in the over-capacity warning
    the Registrar sees while seating a student — otherwise the report and the warning
    disagree about the same class on the same day (`TestOvercapacity`);
  * "new" must be measured from registrations, not from the admission date somebody typed
    on the student record, and a student's SECOND year must not read as their first
    (`TestNewVsReturning`);
  * the full-time credit rule is BAJC's, off their own application form, and it says
    nothing about exactly 15 credits — so exactly 15 must NOT be flagged, in either
    direction (`TestCreditLoad`);
  * "below the attendance floor" must be the same comparison the alerts screen makes, and
    a programme with no registers taken is UNMARKED, not failing (`TestProgrammeAttendance`);
  * a Head of Department must see their own programmes and nothing else, and the response
    must SAY it was narrowed (`TestHodScoping`).

**Two programmes is the whole experiment**, borrowed from `test_d43_hod_scoping.py`: with
one programme, every scoping assertion here passes with the filter deleted.

Hermetic. `archive_seeded_active_year()` puts the seeded college into the past and the
fixture below builds its own prior year, current year and terms, so the term-scoped
reports see only this fixture's rows. Everything is rolled back.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.common.enums import (
    AcademicYearStatus,
    AttendanceStatus,
    EnrollmentStatus,
    Role,
    TeacherStatus,
)
from app.modules.attendance.models import AttendanceRecord
from app.modules.offerings.models import (
    ClassEnrollment,
    ClassTeacher,
    Course,
    CourseOffering,
)
from app.modules.programs.models import Program, ProgramCourse, ProgramHead
from app.modules.settings.models import AcademicYear, SchoolProfile, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

NEW_VS_RETURNING = "/api/v1/reports/new-vs-returning"
OVERCAPACITY = "/api/v1/reports/overcapacity"
CREDIT_LOAD = "/api/v1/reports/credit-load"
PROG_ATTENDANCE = "/api/v1/reports/programme-attendance"

PATHS = (NEW_VS_RETURNING, OVERCAPACITY, CREDIT_LOAD, PROG_ATTENDANCE)


def _assert_envelope(body: dict, *, code: str) -> None:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]


class _College:
    """One college, two programmes, two years, and a deliberately awkward set of rows.

    Every number a test asserts is planted here, so read this before reading an
    assertion. The awkwardness is the point: a fixture where every student carries the
    same load and every class has the same capacity would pass with most of the
    classification logic deleted.

    PROGRAMMES  "Mine" (headed by `hod_user`) and "Theirs" (headed by nobody).

    TERMS       `prior` (an archived year, one term) and `current` (the active year, two
                terms). The current year having TWO terms is what makes the per-term
                reading of new-versus-returning distinguishable from the per-year one.

    COURSES     Every course carries deliberate credit values — 6, 6, 3 — so a student's
                load can be built to land exactly on 15 as well as either side of it.

    STUDENTS in the CURRENT year, all in term 1 unless said otherwise:
        returner    registered in the PRIOR year too            -> returning
        fresher     current year only                           -> new
        latecomer   current year, term 2 ONLY                   -> new for the year,
                                                                   and new in term 2
        ghost       ONE registration, unenrolled again          -> absent everywhere
        exact       Full Time carrying exactly 15 credits        -> NOT flagged
        light       Full Time carrying 6 credits                 -> flagged
        heavy       Part Time carrying 15 credits                -> NOT flagged
        overloaded  Part Time carrying 18 credits                -> flagged
        auditor_st  6 credits, AUDITING one 3-credit course      -> audit split out
        theirs      the other programme's student                -> the leak canary
        unmarked    the other programme, NO attendance at all    -> unmarked, not failing
    """

    def __init__(self, db, make_user, archive_seeded_active_year):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self.db = db

        # ── years and terms ──────────────────────────────────────────────────
        self.prior_year = AcademicYear(
            name=f"P9 Prior {tag}",
            start_date=date(2024, 9, 1),
            end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        self.year = AcademicYear(
            name=f"P9 Current {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db.add_all([self.prior_year, self.year])
        db.flush()

        self.prior_sem = Semester(
            academic_year_id=self.prior_year.id,
            name="Semester 1",
            sequence=1,
            start_date=date(2024, 9, 1),
            end_date=date(2025, 1, 31),
            is_active=False,
        )
        self.sem1 = Semester(
            academic_year_id=self.year.id,
            name="Semester 1",
            sequence=1,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 1, 31),
            is_active=True,
        )
        self.sem2 = Semester(
            academic_year_id=self.year.id,
            name="Semester 2",
            sequence=2,
            start_date=date(2026, 2, 1),
            end_date=date(2026, 6, 30),
            is_active=False,
        )
        db.add_all([self.prior_sem, self.sem1, self.sem2])
        db.flush()

        # ── programmes ───────────────────────────────────────────────────────
        self.mine = self._programme("Mine")
        self.theirs = self._programme("Theirs")

        # ── courses, with the credit values the load tests need ──────────────
        self.six_a = self._course("SixA", credits=6)
        self.six_b = self._course("SixB", credits=6)
        self.three = self._course("Three", credits=3)
        for course in (self.six_a, self.six_b, self.three):
            db.add(
                ProgramCourse(
                    program_id=self.mine.id,
                    course_id=course.id,
                    term_label="Semester 1",
                    term_order=1,
                )
            )
        # `Theirs` teaches its own course, so an HOD leak is visible.
        self.their_course = self._course("Their", credits=3)
        db.add(
            ProgramCourse(
                program_id=self.theirs.id,
                course_id=self.their_course.id,
                term_label="Semester 1",
                term_order=1,
            )
        )
        db.flush()

        # ── offerings: one of every capacity band ────────────────────────────
        # The capacities are chosen against the registration counts planted below, and
        # the tests assert capacity, registered AND over_by explicitly — so moving an
        # enrolment without moving the capacity fails loudly instead of quietly
        # reclassifying a class.
        #   full      7 registered, capacity 7    -> AT capacity
        #   squeezed  5 registered, capacity 4    -> OVER capacity, by one
        #   roomy     4 registered, capacity 50   -> under: counted, not listed
        #   unlimited 3 registered, capacity NULL -> cannot be over; listed apart
        #   next_term 2 registered, capacity 1    -> over, but in TERM 2
        self.full = self._offering(self.six_a, self.sem1, capacity=7)
        self.squeezed = self._offering(self.six_b, self.sem1, capacity=4)
        self.roomy = self._offering(self.three, self.sem1, capacity=50)
        self.unlimited = self._offering(self.their_course, self.sem1, capacity=None)
        self.next_term = self._offering(self.six_a, self.sem2, capacity=1)
        self.prior_offering = self._offering(self.six_a, self.prior_sem, capacity=None)

        # A lead lecturer on one offering, so the report's `lecturer` column is exercised.
        self.lecturer_user = make_user(role=Role.TEACHER, full_name=f"Lead {tag}")
        self.lecturer = TeacherProfile(
            user_id=self.lecturer_user.id,
            staff_number=f"L-{tag}",
            full_name=f"Lead {tag}",
            status=TeacherStatus.ACTIVE,
        )
        db.add(self.lecturer)
        db.flush()
        db.add(
            ClassTeacher(
                offering_id=self.squeezed.id, teacher_id=self.lecturer.id, is_lead=True
            )
        )

        # ── students ─────────────────────────────────────────────────────────
        self.returner = self._student("Returner", self.mine, load="Full Time")
        self.fresher = self._student("Fresher", self.mine, load="Full Time")
        self.latecomer = self._student("Latecomer", self.mine, load="Part Time")
        self.exact = self._student("Exact", self.mine, load="Full Time")
        self.light = self._student("Light", self.mine, load="Full Time")
        self.heavy = self._student("Heavy", self.mine, load="Part Time")
        self.overloaded = self._student("Overloaded", self.mine, load="Part Time")
        self.auditor_st = self._student("Auditing", self.mine, load="Transient")
        self.theirs_student = self._student("Theirs", self.theirs, load="Full Time")
        self.unmarked = self._student("Unmarked", self.theirs, load="Full Time")
        #: Registered once and unenrolled again. Must count for NOTHING, anywhere.
        self.ghost = self._student("Ghost", self.mine, load="Full Time")

        # The returner was here last year — this is the ONLY thing that makes them
        # returning, and it is a registration, not a date on their record.
        self._enrol(self.returner, self.prior_offering, self.prior_sem)

        # Capacity: `full` gets exactly its two, `squeezed` gets one more than its one.
        self._enrol(self.returner, self.full, self.sem1)
        self._enrol(self.fresher, self.full, self.sem1)
        self._enrol(self.returner, self.squeezed, self.sem1)
        self._enrol(self.fresher, self.squeezed, self.sem1)

        # Credit loads. 6+6+3 = 15 exactly for `exact`; 6 for `light`.
        for offering in (self.full, self.squeezed, self.roomy):
            self._enrol(self.exact, offering, self.sem1)
        self._enrol(self.light, self.full, self.sem1)
        self._enrol(self.heavy, self.full, self.sem1)
        self._enrol(self.heavy, self.squeezed, self.sem1)
        self._enrol(self.heavy, self.roomy, self.sem1)  # 15 exactly, Part Time
        for offering in (self.full, self.squeezed, self.roomy, self.unlimited):
            self._enrol(self.overloaded, offering, self.sem1)  # 6+6+3+3 = 18
        self._enrol(self.overloaded, self.next_term, self.sem2)  # NOT this term's load
        self._enrol(self.auditor_st, self.full, self.sem1)
        self._enrol(
            self.auditor_st, self.roomy, self.sem1, status=EnrollmentStatus.AUDIT
        )
        self._enrol(self.theirs_student, self.unlimited, self.sem1)
        self._enrol(self.unmarked, self.unlimited, self.sem1)
        # Term 2 only — new for the year AND new in term 2.
        self._enrol(self.latecomer, self.next_term, self.sem2)

        # Two unenrolled rows: one on a student who is here anyway (so their LOAD must
        # not include it) and one that is a student's only row (so the student must not
        # appear at all).
        for gone in (self.fresher, self.ghost):
            db.add(
                ClassEnrollment(
                    offering_id=self.roomy.id,
                    student_id=gone.id,
                    semester_id=self.sem1.id,
                    unenrolled_at=date(2025, 10, 1),
                )
            )
        db.flush()

        # ── attendance ───────────────────────────────────────────────────────
        # `Mine`: 8 present, 1 late, 1 absent -> 90.0% with late counting as present.
        # One student (`light`) is driven below the floor on their own.
        self._marks(self.returner, self.full, [AttendanceStatus.PRESENT] * 4)
        self._marks(self.exact, self.full, [AttendanceStatus.PRESENT] * 4)
        self._marks(self.light, self.full, [AttendanceStatus.LATE, AttendanceStatus.ABSENT])
        # `Theirs`: one student marked, one never marked at all.
        self._marks(
            self.theirs_student,
            self.unlimited,
            [AttendanceStatus.ABSENT] * 3 + [AttendanceStatus.PRESENT],
        )
        db.flush()

    # ── builders ─────────────────────────────────────────────────────────────
    def _programme(self, label: str) -> Program:
        program = Program(
            code=f"{label[:4]}{self.tag[:4]}".upper()[:10],
            name=f"{label} Programme {self.tag}",
            award="Associate of Science",
        )
        self.db.add(program)
        self.db.flush()
        return program

    def _course(self, label: str, *, credits: int) -> Course:
        course = Course(
            name=f"{label} Course {self.tag}",
            # Four characters of the label, not two: `SixA` and `SixB` collided on
            # `uq_courses_code` at two, and a fixture that cannot build two six-credit
            # courses cannot build a 15-credit load.
            code=f"{label[:4]}{self.tag}".upper()[:10],
            credits=credits,
        )
        self.db.add(course)
        self.db.flush()
        return course

    def _offering(self, course: Course, semester: Semester, *, capacity) -> CourseOffering:
        offering = CourseOffering(
            course_id=course.id,
            semester_id=semester.id,
            section_code=uuid.uuid4().hex[:6],
            capacity=capacity,
        )
        self.db.add(offering)
        self.db.flush()
        return offering

    def _student(self, label: str, program: Program, *, load: str) -> StudentProfile:
        student = StudentProfile(
            student_number=f"S9-{uuid.uuid4().hex[:8]}",
            **split_name(f"{label} {self.tag}"),
            date_of_birth=date(2005, 1, 1),
            # Deliberately WRONG for the returner's story: the report must ignore it.
            enrollment_date=date(2025, 9, 1),
            status="Active",
            program_id=program.id,
            enrollment_load=load,
        )
        self.db.add(student)
        self.db.flush()
        return student

    def _enrol(self, student, offering, semester, *, status=EnrollmentStatus.REGISTERED):
        self.db.add(
            ClassEnrollment(
                offering_id=offering.id,
                student_id=student.id,
                semester_id=semester.id,
                enrollment_status=status,
            )
        )
        self.db.flush()

    def _marks(self, student, offering, statuses) -> None:
        enrollment_id = self.db.scalar(
            select(ClassEnrollment.id).where(
                ClassEnrollment.student_id == student.id,
                ClassEnrollment.offering_id == offering.id,
            )
        )
        for index, status in enumerate(statuses):
            self.db.add(
                AttendanceRecord(
                    offering_id=offering.id,
                    student_id=student.id,
                    enrollment_id=enrollment_id,
                    semester_id=self.sem1.id,
                    attendance_date=date(2025, 9, 1 + index),
                    status=status,
                )
            )


@pytest.fixture
def college(db_session, make_user, archive_seeded_active_year) -> _College:
    return _College(db_session, make_user, archive_seeded_active_year)


def _row_for(rows: list[dict], student: StudentProfile) -> dict:
    match = [r for r in rows if r["student"]["student_number"] == student.student_number]
    assert len(match) == 1, f"{student.student_number} appears {len(match)} times"
    return match[0]


# ════════════════════════════════════════════════════════════════════════════
class TestAccess:
    """The gate is wider than the transcript's and narrower than the report card's.

    The Lecturer is the interesting exclusion. They pass `_staff` on every older report
    route because printing their own students' report cards is their job; a college-wide
    list of who is carrying how many credits is not, and §48 is explicit that being an
    employee is not by itself a reason to see something.
    """

    @pytest.mark.parametrize("path", PATHS)
    @pytest.mark.parametrize("role", [Role.PRINCIPAL, Role.SECRETARY, Role.AUDITOR])
    def test_dean_registrar_and_auditor_read_the_college(
        self, client, make_user, auth_headers, path, role
    ) -> None:
        user = make_user(role=role)
        res = client.get(path, headers=auth_headers(user_id=user.id, role=role))
        assert res.status_code == 200, res.text
        assert res.json()["scope"]["is_scoped"] is False

    @pytest.mark.parametrize("path", PATHS)
    @pytest.mark.parametrize("role", [Role.TEACHER, Role.STUDENT])
    def test_lecturers_and_students_are_refused(
        self, client, make_user, auth_headers, path, role
    ) -> None:
        user = make_user(role=role)
        res = client.get(path, headers=auth_headers(user_id=user.id, role=role))
        assert res.status_code == 403, res.text

    @pytest.mark.parametrize("path", PATHS)
    def test_the_sysadmin_is_refused_centrally(
        self, client, make_user, auth_headers, path
    ) -> None:
        """Not by this router — by Phase 1's `technical_role_scope`, the same guard that
        correctly refused the audit trail in Phase 7. These reports are academic records
        with student names on them."""
        user = make_user(role=Role.SYSADMIN)
        res = client.get(path, headers=auth_headers(user_id=user.id, role=Role.SYSADMIN))
        assert res.status_code == 403, res.text
        _assert_envelope(res.json(), code="technical_role_scope")

    @pytest.mark.parametrize("path", PATHS)
    def test_every_report_states_its_own_definition(
        self, client, make_user, auth_headers, path, college
    ) -> None:
        """A management report whose definition lives only in a service docstring is a
        report two people read two different ways in the same meeting."""
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(path, headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL))
        assert res.status_code == 200, res.text
        assert len(res.json()["note"]) > 80


# ════════════════════════════════════════════════════════════════════════════
class TestNewVsReturning:
    """§53 Enrollment. The one that is easy to get subtly wrong."""

    def _get(self, client, make_user, auth_headers, **params) -> dict:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            NEW_VS_RETURNING,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params=params,
        )
        assert res.status_code == 200, res.text
        return res.json()

    def test_a_second_year_student_is_returning(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        assert _row_for(body["students"], college.returner)["is_new"] is False

    def test_a_first_year_student_is_new(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        assert _row_for(body["students"], college.fresher)["is_new"] is True

    def test_a_returner_names_the_year_they_actually_started(
        self, client, make_user, auth_headers, college
    ) -> None:
        """The evidence, not just the verdict. A Registrar challenged on this number has
        to be able to point at the year."""
        body = self._get(client, make_user, auth_headers)
        row = _row_for(body["students"], college.returner)
        assert row["first_registered_year"] == college.prior_year.name

    def test_it_ignores_the_admission_date_on_the_record(
        self, client, make_user, auth_headers, college
    ) -> None:
        """Every student in the fixture carries `enrollment_date` 1 Sep 2025 — the
        CURRENT year. If the report read that column, the returner would be new."""
        assert college.returner.enrollment_date == date(2025, 9, 1)
        body = self._get(client, make_user, auth_headers)
        assert _row_for(body["students"], college.returner)["is_new"] is False

    def test_the_totals_add_up_and_match_the_rows(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        assert body["new"] + body["returning"] == body["total"]
        assert len(body["students"]) == body["total"]
        assert sum(r["total"] for r in body["by_programme"]) == body["total"]

    def test_a_student_appears_once_however_many_courses_they_took(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`exact` holds three registrations this term. A headcount that counted
        registrations would report them three times."""
        body = self._get(client, make_user, auth_headers)
        _row_for(body["students"], college.exact)  # asserts exactly one match

    def test_a_student_whose_only_registration_was_unenrolled_is_absent(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`ghost` registered once and was unenrolled again. They are not intake."""
        body = self._get(client, make_user, auth_headers)
        numbers = {r["student"]["student_number"] for r in body["students"]}
        assert college.ghost.student_number not in numbers
        assert college.fresher.student_number in numbers

    def test_the_per_term_reading_is_a_different_question(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`latecomer` registers for the first time in TERM 2, so they are new in term 2
        while everybody who started in term 1 is returning there — inside one year. This
        is the row most likely to be "fixed" into agreeing with the year total by someone
        who has not read `NewVsReturningSemesterRow`."""
        body = self._get(client, make_user, auth_headers)
        terms = {r["semester"]["name"]: r for r in body["by_semester"]}
        # Term 1: everyone starts here except the returner, who started a year earlier.
        assert (
            terms["Semester 1"]["new"],
            terms["Semester 1"]["returning"],
            terms["Semester 1"]["total"],
        ) == (8, 1, 9)
        # Term 2: the latecomer's first term ever; the overloaded student is back.
        assert (terms["Semester 2"]["new"], terms["Semester 2"]["returning"]) == (1, 1)
        # And for the YEAR the latecomer is new as well — the two readings differ, and
        # both are returned rather than one of them being chosen.
        assert (body["new"], body["returning"], body["total"]) == (9, 1, 10)

    def test_the_earliest_year_can_have_no_returning_students(
        self, client, make_user, auth_headers, college
    ) -> None:
        """A floor artefact worth stating on the screen: the first year in the database
        can never show returning students, however long the college has existed."""
        body = self._get(
            client, make_user, auth_headers, academic_year_id=str(college.prior_year.id)
        )
        assert body["returning"] == 0
        assert body["total"] == 1

    def test_the_prior_year_sees_only_its_own_people(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(
            client, make_user, auth_headers, academic_year_id=str(college.prior_year.id)
        )
        numbers = {r["student"]["student_number"] for r in body["students"]}
        assert numbers == {college.returner.student_number}

    def test_an_unknown_year_is_a_404_not_a_silent_fallback(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            NEW_VS_RETURNING,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params={"academic_year_id": str(uuid.uuid4())},
        )
        assert res.status_code == 404, res.text
        _assert_envelope(res.json(), code="academic_year_not_found")


# ════════════════════════════════════════════════════════════════════════════
class TestOvercapacity:
    """§53 Registration. Three lists, and the reason there are three."""

    def _get(self, client, make_user, auth_headers, **params) -> dict:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            OVERCAPACITY,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params=params,
        )
        assert res.status_code == 200, res.text
        return res.json()

    def _labels(self, rows: list[dict]) -> set[str]:
        return {r["offering"]["label"] for r in rows}

    def test_an_over_subscribed_class_is_the_headline(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        over = [r for r in body["over"] if r["offering"]["id"] == str(college.squeezed.id)]
        assert len(over) == 1, body["over"]
        assert over[0]["capacity"] == 4
        assert over[0]["registered"] == 5
        assert over[0]["over_by"] == 1
        assert over[0]["band"] == "over"

    def test_an_exactly_full_class_is_not_over_capacity(
        self, client, make_user, auth_headers, college
    ) -> None:
        """Full is not a fault. It is the state the NEXT registration turns into one, and
        that is a different sentence on the screen."""
        body = self._get(client, make_user, auth_headers)
        row = [r for r in body["at_capacity"] if r["offering"]["id"] == str(college.full.id)]
        assert len(row) == 1, body["at_capacity"]
        assert (row[0]["capacity"], row[0]["registered"], row[0]["over_by"]) == (7, 7, 0)
        assert row[0]["utilisation_pct"] == 100.0
        assert str(college.full.id) not in {r["offering"]["id"] for r in body["over"]}

    def test_a_class_with_no_capacity_recorded_is_listed_apart(
        self, client, make_user, auth_headers, college
    ) -> None:
        """It cannot be over capacity — not because it has room, but because nobody said
        how much room it has. Hiding it would make an empty over-capacity list mean two
        completely different things that look identical."""
        body = self._get(client, make_user, auth_headers)
        row = [
            r for r in body["no_capacity_set"]
            if r["offering"]["id"] == str(college.unlimited.id)
        ]
        assert len(row) == 1, body["no_capacity_set"]
        assert row[0]["capacity"] is None
        assert row[0]["band"] == "unset"
        assert row[0]["over_by"] == 0

    def test_utilisation_is_null_rather_than_zero_without_a_capacity(
        self, client, make_user, auth_headers, college
    ) -> None:
        """A percentage of nothing is unanswerable. Rendering it 0% would sort every
        unlimited class to the bottom of a list ordered by pressure."""
        body = self._get(client, make_user, auth_headers)
        assert all(r["utilisation_pct"] is None for r in body["no_capacity_set"])
        assert all(r["utilisation_pct"] is not None for r in body["over"])

    def test_a_class_with_room_is_counted_and_not_listed(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        listed = {
            r["offering"]["id"]
            for r in body["over"] + body["at_capacity"] + body["no_capacity_set"]
        }
        assert str(college.roomy.id) not in listed
        assert body["under_capacity"] == 1

    def test_no_offering_is_silently_dropped(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        assert (
            len(body["over"])
            + len(body["at_capacity"])
            + len(body["no_capacity_set"])
            + body["under_capacity"]
            == body["offerings_total"]
        )

    def test_registered_means_the_same_thing_as_the_registration_warning(
        self, client, make_user, auth_headers, college, db_session
    ) -> None:
        """THE POINT OF THIS REPORT'S CORRECTNESS. `offerings/service.py::_enrolled_counts`
        counts `unenrolled_at IS NULL` and nothing else, and it is the count behind the
        warning the Registrar sees while seating a student. `roomy` carries one dropped
        row; if this report used a different predicate the two would disagree about the
        same class on the same day."""
        from app.modules.offerings.service import _enrolled_counts

        truth = _enrolled_counts(db_session, [college.roomy.id, college.squeezed.id])
        body = self._get(client, make_user, auth_headers)
        rows = {
            r["offering"]["id"]: r["registered"]
            for r in body["over"] + body["at_capacity"] + body["no_capacity_set"]
        }
        assert rows[str(college.squeezed.id)] == truth[college.squeezed.id]

    def test_it_is_scoped_to_the_term_not_the_year(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`next_term` is over capacity — in TERM 2. A year-shaped scope would report it
        under term 1, which is the year-versus-term slip D31 turned into three wrong
        answers elsewhere in this codebase."""
        term1 = self._get(client, make_user, auth_headers)
        assert str(college.next_term.id) not in {
            r["offering"]["id"] for r in term1["over"]
        }
        term2 = self._get(client, make_user, auth_headers, semester_id=str(college.sem2.id))
        assert str(college.next_term.id) in {r["offering"]["id"] for r in term2["over"]}

    def test_the_lead_lecturer_is_named(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        row = [r for r in body["over"] if r["offering"]["id"] == str(college.squeezed.id)][0]
        assert row["lecturer"] == college.lecturer.full_name

    def test_an_unknown_term_is_a_404(self, client, make_user, auth_headers) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            OVERCAPACITY,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params={"semester_id": str(uuid.uuid4())},
        )
        assert res.status_code == 404, res.text
        _assert_envelope(res.json(), code="semester_not_found")


# ════════════════════════════════════════════════════════════════════════════
class TestCreditLoad:
    """§53 Registration. The mismatch column is the report; the rest is arithmetic."""

    def _get(self, client, make_user, auth_headers, **params) -> dict:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            CREDIT_LOAD,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params=params,
        )
        assert res.status_code == 200, res.text
        return res.json()

    def test_credits_come_from_the_catalog(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        row = _row_for(body["rows"], college.exact)
        assert row["courses"] == 3
        assert row["credits"] == 15  # 6 + 6 + 3

    def test_exactly_fifteen_credits_is_not_flagged_either_way(
        self, client, make_user, auth_headers, college
    ) -> None:
        """BAJC's application form says Part Time is UNDER 15 and Full Time is OVER 15,
        and therefore says nothing about 15. Flagging it in either direction would be this
        report inventing a policy the college never set."""
        body = self._get(client, make_user, auth_headers)
        assert _row_for(body["rows"], college.exact)["declared_load"] == "Full Time"
        assert _row_for(body["rows"], college.exact)["mismatch"] is None
        assert _row_for(body["rows"], college.heavy)["declared_load"] == "Part Time"
        assert _row_for(body["rows"], college.heavy)["credits"] == 15
        assert _row_for(body["rows"], college.heavy)["mismatch"] is None
        assert body["full_time_credits"] == 15

    def test_a_full_time_student_carrying_too_little_is_flagged(
        self, client, make_user, auth_headers, college
    ) -> None:
        row = _row_for(self._get(client, make_user, auth_headers)["rows"], college.light)
        assert row["credits"] == 6
        assert row["mismatch"] is not None
        assert "Full Time" in row["mismatch"] and "6 credits" in row["mismatch"]

    def test_a_part_time_student_carrying_too_much_is_flagged(
        self, client, make_user, auth_headers, college
    ) -> None:
        row = _row_for(
            self._get(client, make_user, auth_headers)["rows"], college.overloaded
        )
        assert row["credits"] == 18
        assert row["mismatch"] is not None
        assert "Part Time" in row["mismatch"]

    def test_a_declaration_with_no_credit_rule_is_never_flagged(
        self, client, make_user, auth_headers, college
    ) -> None:
        """Transient and Summer are not credit statements, so there is nothing to
        contradict."""
        row = _row_for(
            self._get(client, make_user, auth_headers)["rows"], college.auditor_st
        )
        assert row["declared_load"] == "Transient"
        assert row["mismatch"] is None

    def test_audited_credits_are_in_the_load_and_also_reported_apart(
        self, client, make_user, auth_headers, college
    ) -> None:
        """An audit is real attendance and real work, and it earns nothing towards the
        award. Both halves of that have to be visible."""
        row = _row_for(
            self._get(client, make_user, auth_headers)["rows"], college.auditor_st
        )
        assert row["credits"] == 9  # 6 registered + 3 audited
        assert row["audit_credits"] == 3

    def test_a_dropped_registration_carries_no_load(
        self, client, make_user, auth_headers, college
    ) -> None:
        row = _row_for(self._get(client, make_user, auth_headers)["rows"], college.fresher)
        assert row["credits"] == 12  # the 3-credit dropped row is not in it

    def test_next_terms_registrations_are_not_this_terms_load(
        self, client, make_user, auth_headers, college
    ) -> None:
        row = _row_for(
            self._get(client, make_user, auth_headers)["rows"], college.overloaded
        )
        assert row["credits"] == 18  # not 24

    def test_a_student_with_no_registration_this_term_has_no_row(
        self, client, make_user, auth_headers, college
    ) -> None:
        """A student carrying nothing has no load. `latecomer` registers in term 2 only
        and `ghost` was unenrolled. Whether either SHOULD be registered is §53's separate
        students-not-registered report, which is not in this phase."""
        body = self._get(client, make_user, auth_headers)
        numbers = {r["student"]["student_number"] for r in body["rows"]}
        assert college.latecomer.student_number not in numbers
        assert college.ghost.student_number not in numbers

    def test_the_summaries_agree_with_the_rows(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        assert body["students"] == len(body["rows"])
        assert body["credits_total"] == sum(r["credits"] for r in body["rows"])
        assert body["max_credits"] == max(r["credits"] for r in body["rows"])
        assert body["min_credits"] == min(r["credits"] for r in body["rows"])
        assert body["mismatches"] == sum(1 for r in body["rows"] if r["mismatch"])
        assert sum(b["students"] for b in body["distribution"]) == body["students"]
        assert sum(b["students"] for b in body["by_declared_load"]) == body["students"]


# ════════════════════════════════════════════════════════════════════════════
class TestProgrammeAttendance:
    """§53 Attendance — "department" means PROGRAMME (decision C4)."""

    def _get(self, client, make_user, auth_headers, **params) -> dict:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            PROG_ATTENDANCE,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params=params,
        )
        assert res.status_code == 200, res.text
        return res.json()

    def _row(self, body: dict, program: Program) -> dict:
        match = [r for r in body["by_programme"] if r["programme_id"] == str(program.id)]
        assert len(match) == 1, body["by_programme"]
        return match[0]

    def test_late_counts_as_present_exactly_as_everywhere_else(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`Mine` has 8 present, 1 late, 1 absent. A present-only formula would report
        80.0% and put the programme on the wrong side of the floor."""
        row = self._row(self._get(client, make_user, auth_headers), college.mine)
        assert (row["present"], row["late"], row["absent"]) == (8, 1, 1)
        assert row["pct_present"] == 90.0

    def test_the_counts_account_for_every_record(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        for row in body["by_programme"]:
            assert row["present"] + row["absent"] + row["late"] + row["excused"] == row["records"]
        assert sum(r["records"] for r in body["by_programme"]) == body["records_total"]

    def test_a_programme_below_the_floor_is_flagged(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`Theirs` is 1 present + 3 absent = 25%."""
        row = self._row(self._get(client, make_user, auth_headers), college.theirs)
        assert row["pct_present"] == 25.0
        assert row["below_floor"] is True

    def test_a_student_below_the_floor_is_counted_within_their_programme(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`light` is late once and absent once — 50% — inside a programme sitting at
        90%. A programme-level percentage alone would hide them completely."""
        row = self._row(self._get(client, make_user, auth_headers), college.mine)
        assert row["below_floor"] is False
        assert row["students_below_floor"] == 1

    def test_a_student_nobody_marked_is_not_in_the_report(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers, program_id=str(college.theirs.id))
        numbers = {r["student"]["student_number"] for r in body["students"]}
        assert college.unmarked.student_number not in numbers

    def test_the_floor_is_the_configured_one_not_a_constant(
        self, client, make_user, auth_headers, college, db_session
    ) -> None:
        """D45 §23 made it configuration (§57: institutional rules do not belong in
        source). Moving the setting must move this report."""
        profile = db_session.get(SchoolProfile, 1)
        profile.attendance_alert_threshold = 20
        db_session.flush()
        body = self._get(client, make_user, auth_headers)
        assert body["floor_pct"] == 20.0
        assert self._row(body, college.theirs)["below_floor"] is False  # 25% > 20%

    def test_the_comparison_is_strictly_below_matching_the_alerts_screen(
        self, client, make_user, auth_headers, college, db_session
    ) -> None:
        """`attendance_alerts` skips a class when `pct >= threshold`. Two screens
        flagging different sets of students from the same configured number is the one
        outcome this has to avoid."""
        profile = db_session.get(SchoolProfile, 1)
        profile.attendance_alert_threshold = 25
        db_session.flush()
        row = self._row(self._get(client, make_user, auth_headers), college.theirs)
        assert row["pct_present"] == 25.0
        assert row["below_floor"] is False

    def test_drilling_into_one_programme_adds_its_students(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers, program_id=str(college.mine.id))
        assert body["programme"]["programme_id"] == str(college.mine.id)
        assert sum(r["records"] for r in body["students"]) == body["programme"]["records"]
        assert _row_for(body["students"], college.light)["below_floor"] is True

    def test_a_college_wide_request_returns_no_student_rows(
        self, client, make_user, auth_headers, college
    ) -> None:
        body = self._get(client, make_user, auth_headers)
        assert body["programme"] is None
        assert body["students"] == []

    def test_an_unknown_programme_is_a_404(self, client, make_user, auth_headers) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        res = client.get(
            PROG_ATTENDANCE,
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            params={"program_id": str(uuid.uuid4())},
        )
        assert res.status_code == 404, res.text
        _assert_envelope(res.json(), code="program_not_found")


# ════════════════════════════════════════════════════════════════════════════
class TestHodScoping:
    """A Head of Department sees their own programmes — and the response says so.

    Two programmes is what makes these tests real. With one, every assertion here passes
    with the scope filter deleted.
    """

    @pytest.fixture
    def head(self, db_session, make_user, college):
        user = make_user(role=Role.HOD, full_name="Head Of Mine")
        profile = TeacherProfile(
            user_id=user.id,
            staff_number=f"H9-{college.tag}",
            full_name="Head Of Mine",
            status=TeacherStatus.ACTIVE,
        )
        db_session.add(profile)
        db_session.flush()
        db_session.add(
            ProgramHead(program_id=college.mine.id, teacher_id=profile.id)
        )
        db_session.flush()
        return user

    def _get(self, client, auth_headers, head, path, **params) -> dict:
        res = client.get(
            path, headers=auth_headers(user_id=head.id, role=Role.HOD), params=params
        )
        assert res.status_code == 200, res.text
        return res.json()

    @pytest.mark.parametrize("path", PATHS)
    def test_every_report_says_it_was_narrowed(
        self, client, auth_headers, head, college, path
    ) -> None:
        """An HOD reading "3 classes over capacity" must not carry it out of the room as
        the college total."""
        body = self._get(client, auth_headers, head, path)
        assert body["scope"]["is_scoped"] is True
        assert body["scope"]["programmes"] == [college.mine.name]

    def test_the_intake_report_covers_only_their_students(
        self, client, auth_headers, head, college
    ) -> None:
        body = self._get(client, auth_headers, head, NEW_VS_RETURNING)
        assert {r["programme"] for r in body["students"]} == {college.mine.name}

    def test_the_credit_load_covers_only_their_students(
        self, client, auth_headers, head, college
    ) -> None:
        body = self._get(client, auth_headers, head, CREDIT_LOAD)
        numbers = {r["student"]["student_number"] for r in body["rows"]}
        assert college.theirs_student.student_number not in numbers
        assert college.exact.student_number in numbers

    def test_the_attendance_report_covers_only_their_programme(
        self, client, auth_headers, head, college
    ) -> None:
        body = self._get(client, auth_headers, head, PROG_ATTENDANCE)
        assert {r["programme_id"] for r in body["by_programme"]} == {str(college.mine.id)}

    def test_the_capacity_report_covers_their_programmes_courses(
        self, client, auth_headers, head, college
    ) -> None:
        """Scoped through `program_courses`, so a head reaches a class their students are
        required to take even when another programme owns it. `their_course` is in
        neither of the head's programmes and must not appear."""
        body = self._get(client, auth_headers, head, OVERCAPACITY)
        ids = {
            r["offering"]["id"]
            for r in body["over"] + body["at_capacity"] + body["no_capacity_set"]
        }
        assert str(college.squeezed.id) in ids
        assert str(college.unlimited.id) not in ids
        assert body["offerings_total"] < 4

    def test_a_head_cannot_drill_into_someone_elses_programme(
        self, client, auth_headers, head, college
    ) -> None:
        res = client.get(
            PROG_ATTENDANCE,
            headers=auth_headers(user_id=head.id, role=Role.HOD),
            params={"program_id": str(college.theirs.id)},
        )
        assert res.status_code == 403, res.text

    def test_a_head_can_drill_into_their_own(
        self, client, auth_headers, head, college
    ) -> None:
        body = self._get(
            client, auth_headers, head, PROG_ATTENDANCE, program_id=str(college.mine.id)
        )
        assert body["programme"]["programme_id"] == str(college.mine.id)

    def test_a_head_who_heads_nothing_sees_nothing(
        self, client, make_user, auth_headers, college
    ) -> None:
        """`hod_program_ids` returns `[]` for a head with no appointment yet — a real
        state, since appointing the head and provisioning the login are two acts. An empty
        list must narrow to the empty set. Read the other way it would turn an
        unconfigured HOD into a Dean, which is the whole reason that helper documents the
        direction."""
        stranger = make_user(role=Role.HOD, full_name="Head Of Nothing")
        body = self._get(client, auth_headers, stranger, CREDIT_LOAD)
        assert body["scope"]["is_scoped"] is True
        assert body["scope"]["programmes"] == []
        assert body["rows"] == []
        assert body["students"] == 0

"""Cross-module ACADEMIC-YEAR SCOPING — does the year switcher actually work?

WHY THIS FILE EXISTS. The frontend has two year affordances:

  * **Staff** get a per-module year filter (`useYearFilter`, URL `?year=`) which sends
    `academic_year_id` on the module's list call.
  * **Students** get one global top-bar switcher (`YearContext` +
    `GET /students/me/years`) that re-scopes My Grades / My Classes / My Attendance.

Both are only as good as the backend honouring that query parameter — and **FastAPI
silently ignores a query parameter an endpoint does not declare**. That is the failure
mode this file is built around: the UI shows a year picker, the user changes it, the
request carries `academic_year_id`, the server ignores it, and the screen displays the
same rows with no error anywhere. It looks like it works.

The per-module suites did not cover this. The closest existing case
(`test_attendance.py::test_year_filter`) asserts only that an *unrelated* year returns
`[]` — which would also pass if the endpoint returned nothing for the wrong reason. It
never proves the property the switcher actually needs:

    year A returns A's data, AND year B returns B's data, AND they differ.

So every test here seeds TWO years that both hold real, distinguishable data for the
SAME teacher and the SAME student, and asserts the partition in both directions.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.attendance.models import AttendanceRecord
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.grades.models import AssessmentGrade
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

V1 = "/api/v1"


class _Year:
    """One academic year's worth of rows, all tagged so assertions can tell them apart."""

    def __init__(self, year, sem, cs, assessment, category, enrollment):  # noqa: ANN001
        self.year = year
        self.sem = sem
        # D31: one row, not two. `section` and `cs` were a homeroom and the subject
        # attached to it; an offering is both. Kept as two names so the assertions
        # below still read as "the section" or "the class_subject" where that is what
        # they are talking about.
        self.section = cs
        self.cs = cs
        self.assessment = assessment
        self.category = category
        self.enrollment = enrollment

    @property
    def year_id(self) -> str:
        return str(self.year.id)

    @property
    def section_id(self) -> str:
        return str(self.section.id)


class _TwoYears:
    """Two academic years — one ARCHIVED ('prev'), one ACTIVE ('cur') — where the same
    teacher teaches and the same student is enrolled in BOTH.

    Sharing the people across years is the whole point: it means a year filter cannot
    appear to work merely by returning "the things this person is attached to". The
    correct answer differs per year only if the filter is real.
    """

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year):  # noqa: ANN001
        # Free the one-active-year invariant so we can create our own active year.
        archive_seeded_active_year()
        self._db = db_session
        tag = uuid.uuid4().hex[:6]
        self.tag = tag

        self.subject = Course(name=f"YS Subject {tag}", code=f"YS{tag[:4].upper()}")
        db_session.add(self.subject)

        # People first — both years reference them.
        self.teacher_user = make_user(role=Role.TEACHER, full_name=f"YS Teacher {tag}")
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id,
            staff_number=f"YT-{tag}",
            full_name=f"YS Teacher {tag}",
            status=TeacherStatus.ACTIVE,
        )
        self.student_user = make_user(role=Role.STUDENT, full_name=f"YS Student {tag}")
        self.student = StudentProfile(
            user_id=self.student_user.id,
            student_number=f"YS-{tag}",
            **split_name(f"YS Student {tag}"),
            date_of_birth=date(2011, 5, 4),
            enrollment_date=date(2024, 9, 1),
            status="active",
        )
        db_session.add_all([self.teacher, self.student])
        db_session.flush()

        self.prev = self._build_year(
            name=f"YS Prev {tag}",
            start=date(2024, 9, 1),
            end=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
            sem_active=False,
            section_name=f"YS PrevSec {tag}",
            score="60",
            attendance_on=date(2024, 10, 15),
        )
        self.cur = self._build_year(
            name=f"YS Cur {tag}",
            start=date(2025, 9, 1),
            end=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
            sem_active=True,
            section_name=f"YS CurSec {tag}",
            score="90",
            attendance_on=date(2025, 10, 15),
        )
        # A second semester inside the CURRENT year, so semester-level partitioning is
        # testable without leaving the year. Score 40 vs the year's 90, and `absent` vs
        # `present`, so a leak between semesters changes the numbers, not just the ids.
        self._add_second_semester(self.cur, score="40", attendance_on=date(2026, 2, 10))

        # A second student enrolled ONLY in the current year, so the documented
        # past-year narrowing on `GET /students` has something to exclude.
        self.cur_only_student = StudentProfile(
            student_number=f"YSC-{tag}",
            **split_name(f"YS CurOnly {tag}"),
            date_of_birth=date(2011, 7, 8),
            enrollment_date=date(2025, 9, 1),
            status="active",
        )
        db_session.add(self.cur_only_student)
        db_session.flush()
        db_session.add(
            ClassEnrollment(
                offering_id=self.cur.section.id,
                student_id=self.cur_only_student.id,
                semester_id=self.cur.sem.id,
            )
        )
        db_session.flush()

        self.principal_user = make_user(role=Role.PRINCIPAL)
        self.secretary_user = make_user(role=Role.SECRETARY)
        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.STU = auth_headers(user_id=self.student_user.id, role=Role.STUDENT)

    def _build_year(
        self, *, name, start, end, status, sem_active, section_name, score, attendance_on
    ) -> _Year:  # noqa: ANN001
        db = self._db
        year = AcademicYear(name=name, start_date=start, end_date=end, status=status)
        db.add(year)
        db.flush()

        sem = Semester(
            academic_year_id=year.id,
            name="Semester 1",
            sequence=1,
            start_date=start,
            end_date=end,
            is_active=sem_active,
        )
        db.add_all([sem])
        db.flush()

        cs = CourseOffering(
                course_id=self.subject.id,
                semester_id=sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db.add(cs)
        db.flush()

        db.add(ClassTeacher(offering_id=cs.id, teacher_id=self.teacher.id, is_lead=True))
        enrollment = ClassEnrollment(
            offering_id=cs.id, student_id=self.student.id, semester_id=sem.id
        )
        db.add(enrollment)
        db.flush()

        category = AssessmentCategory(
            offering_id=cs.id, name=f"Cat {name}", weight=Decimal("100"), drop_lowest_count=0
        )
        db.add(category)
        db.flush()

        assessment = Assessment(
            offering_id=cs.id,
            semester_id=sem.id,
            category_id=category.id,
            title=f"Test in {name}",
            type="quiz",
            max_score=Decimal("100"),
            weight=Decimal("100"),
            status="graded",
            is_released=True,
            assessment_date=start,
        )
        db.add(assessment)
        db.flush()

        db.add(
            AssessmentGrade(
                assessment_id=assessment.id,
                student_id=self.student.id,
                enrollment_id=enrollment.id,
                status="graded",
                score=Decimal(score),
                is_released=True,
            )
        )
        db.add(
            AttendanceRecord(
                offering_id=cs.id,
                student_id=self.student.id,
                enrollment_id=enrollment.id,
                semester_id=sem.id,
                attendance_date=attendance_on,
                status="present",
            )
        )
        db.flush()
        return _Year(year, sem, cs, assessment, category, enrollment)

    def _add_second_semester(self, target: _Year, *, score: str, attendance_on) -> None:  # noqa: ANN001
        """Give `target` a SECOND semester holding its own distinguishable rows.

        Needed because the year-level fixture above builds exactly one semester per
        year, so it cannot express the property the student's new year·semester
        switcher needs: *within a single year*, Semester 1 returns S1's data, Semester 2
        returns S2's data, and they differ. Same year, same same offering, same
        student — only the semester differs, so a `semester_id` filter cannot appear to
        work merely by returning "things this student is attached to".
        """
        db = self._db
        sem2 = Semester(
            academic_year_id=target.year.id,
            name="Semester 2",
            sequence=2,
            start_date=date(target.year.start_date.year + 1, 1, 20),
            end_date=target.year.end_date,
            is_active=False,
        )
        db.add(sem2)
        db.flush()

        enrollment2 = ClassEnrollment(
            offering_id=target.section.id,
            student_id=self.student.id,
            semester_id=sem2.id,
        )
        db.add(enrollment2)
        db.flush()

        assessment2 = Assessment(
            offering_id=target.cs.id,
            semester_id=sem2.id,
            category_id=target.category.id,
            title=f"Sem2 test in {target.year.name}",
            type="quiz",
            max_score=Decimal("100"),
            weight=Decimal("100"),
            status="graded",
            is_released=True,
            assessment_date=sem2.start_date,
        )
        db.add(assessment2)
        db.flush()
        db.add(
            AssessmentGrade(
                assessment_id=assessment2.id,
                student_id=self.student.id,
                enrollment_id=enrollment2.id,
                status="graded",
                score=Decimal(score),
                is_released=True,
            )
        )
        db.add(
            AttendanceRecord(
                offering_id=target.section.id,
                student_id=self.student.id,
                enrollment_id=enrollment2.id,
                semester_id=sem2.id,
                attendance_date=attendance_on,
                status="absent",
            )
        )
        db.flush()
        target.sem2 = sem2
        target.sem2_assessment = assessment2


@pytest.fixture
def two(db_session, make_user, auth_headers, archive_seeded_active_year) -> _TwoYears:  # noqa: ANN001
    return _TwoYears(db_session, make_user, auth_headers, archive_seeded_active_year)


def _ids(body: dict, key: str = "items") -> set[str]:
    """Ids of the listed rows THEMSELVES — assessment ids from /assessments, and so on."""
    return {str(i["id"]) for i in body[key]}


def _offering_ids(body: dict, key: str = "items") -> set[str]:
    """Ids of the OFFERINGS the listed rows point at.

    Separate from `_ids` on purpose. D31 moved the offering behind a nested `offering`
    ref on the pickers that used to inline it (attendance, grades), and a helper that
    guessed which id a row meant would silently compare assessment ids against offering
    ids on `/assessments`, where BOTH keys are now present.
    """
    return {str(i["offering"]["id"]) for i in body[key]}


# ══════════════════════════════════════════════════════════════════════════════
# The staff per-module year filter (`?academic_year_id=`)
# ══════════════════════════════════════════════════════════════════════════════
class TestClassesYearFilter:
    """`GET /offerings` — backs the offerings list (staff) and the student's own list."""

    @pytest.mark.parametrize("role", ["P", "S", "T"])
    def test_partitions_sections_by_year(self, client, two, role) -> None:
        headers = getattr(two, role)
        prev = client.get(f"{V1}/offerings?academic_year_id={two.prev.year_id}", headers=headers)
        cur = client.get(f"{V1}/offerings?academic_year_id={two.cur.year_id}", headers=headers)
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text

        prev_ids, cur_ids = _ids(prev.json()), _ids(cur.json())
        assert two.prev.section_id in prev_ids
        assert two.cur.section_id not in prev_ids
        assert two.cur.section_id in cur_ids
        assert two.prev.section_id not in cur_ids

    def test_student_sees_only_their_own_section_for_that_year(self, client, two) -> None:
        """The student global switcher drives this call with `academic_year_id`."""
        prev = client.get(
            f"{V1}/offerings?academic_year_id={two.prev.year_id}", headers=two.STU
        )
        cur = client.get(f"{V1}/offerings?academic_year_id={two.cur.year_id}", headers=two.STU)
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        assert two.prev.section_id in _ids(prev.json())
        assert two.cur.section_id not in _ids(prev.json())
        assert two.cur.section_id in _ids(cur.json())


class TestAssessmentsYearFilter:
    """`GET /assessments` — AssessmentsListScreen (staff filter + student switcher)."""

    @pytest.mark.parametrize("role", ["P", "T"])
    def test_partitions_assessments_by_year(self, client, two, role) -> None:
        headers = getattr(two, role)
        prev = client.get(f"{V1}/assessments?academic_year_id={two.prev.year_id}", headers=headers)
        cur = client.get(f"{V1}/assessments?academic_year_id={two.cur.year_id}", headers=headers)
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text

        prev_ids, cur_ids = _ids(prev.json()), _ids(cur.json())
        assert str(two.prev.assessment.id) in prev_ids
        assert str(two.cur.assessment.id) not in prev_ids
        assert str(two.cur.assessment.id) in cur_ids
        assert str(two.prev.assessment.id) not in cur_ids


class TestAttendanceYearFilter:
    """`GET /attendance/offerings` — the register/summary picker."""

    @pytest.mark.parametrize("role", ["P", "S", "T"])
    def test_partitions_sections_by_year(self, client, two, role) -> None:
        headers = getattr(two, role)
        prev = client.get(
            f"{V1}/attendance/offerings?academic_year_id={two.prev.year_id}", headers=headers
        )
        cur = client.get(
            f"{V1}/attendance/offerings?academic_year_id={two.cur.year_id}", headers=headers
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        assert two.prev.section_id in _offering_ids(prev.json())
        assert two.cur.section_id not in _offering_ids(prev.json())
        assert two.cur.section_id in _offering_ids(cur.json())
        assert two.prev.section_id not in _offering_ids(cur.json())


class TestGradesPickerYearFilter:
    """`GET /grades/offerings` — the gradebook picker.

    Note this endpoint deliberately does NOT filter `is_archived`, because
    past-year offerings are inactive and the year switcher must still list them
    (progress-tracker, Module 7.6). That makes a genuine year filter the ONLY thing
    keeping the picker from showing every year at once.
    """

    @pytest.mark.parametrize("role", ["P", "T"])
    def test_partitions_offerings_by_year(self, client, two, role) -> None:
        headers = getattr(two, role)
        prev = client.get(
            f"{V1}/grades/offerings?academic_year_id={two.prev.year_id}", headers=headers
        )
        cur = client.get(
            f"{V1}/grades/offerings?academic_year_id={two.cur.year_id}", headers=headers
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        assert str(two.prev.cs.id) in _offering_ids(prev.json())
        assert str(two.cur.cs.id) not in _offering_ids(prev.json())
        assert str(two.cur.cs.id) in _offering_ids(cur.json())
        assert str(two.prev.cs.id) not in _offering_ids(cur.json())


class TestStudentsListYearFilter:
    """`GET /students` — StudentsListPage's year filter."""

    @pytest.mark.parametrize("role", ["P", "S"])
    def test_past_year_narrows_to_students_enrolled_that_year(self, client, two, role) -> None:
        """Asserts the DOCUMENTED asymmetry, not assumed symmetry.

        `list_students` specifies: `academic_year_id` restricts the directory to
        students enrolled in that year **when it is a past year; the active year lists
        everyone**. So the previous year must exclude the current-year-only student,
        while the active year includes them.

        Scoped with `search` because the shared database already holds 46 students and
        the endpoint is paginated at 25 — without it the seeded demo cohort fills page
        one and the assertion says nothing about the filter.
        """
        headers = getattr(two, role)
        prev = client.get(
            f"{V1}/students?academic_year_id={two.prev.year_id}&search=YS+", headers=headers
        )
        cur = client.get(
            f"{V1}/students?academic_year_id={two.cur.year_id}&search=YS+", headers=headers
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text

        prev_ids, cur_ids = _ids(prev.json()), _ids(cur.json())
        # Enrolled in both years → present under either.
        assert str(two.student.id) in prev_ids
        assert str(two.student.id) in cur_ids
        # Enrolled only in the current year → the PAST year must exclude them.
        assert str(two.cur_only_student.id) not in prev_ids, (
            "A past-year filter returned a student who was not enrolled that year — "
            "the year filter is not narrowing the directory."
        )
        assert str(two.cur_only_student.id) in cur_ids

    def test_classes_resolve_to_that_years_classes(self, client, two) -> None:
        """`current_offerings` must follow the requested year, not the active one.

        This is the assertion that actually proves the parameter reached the query: the
        same student, two years, two different resolved class sets.
        """
        prev = client.get(
            f"{V1}/students/{two.student.id}?academic_year_id={two.prev.year_id}", headers=two.P
        )
        cur = client.get(
            f"{V1}/students/{two.student.id}?academic_year_id={two.cur.year_id}", headers=two.P
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        prev_ids = [c["id"] for c in prev.json()["current_offerings"]]
        cur_ids = [c["id"] for c in cur.json()["current_offerings"]]
        assert prev_ids == [two.prev.section_id], prev.json()["current_offerings"]
        assert cur_ids == [two.cur.section_id], cur.json()["current_offerings"]
        assert prev_ids != cur_ids


class TestStudentAssessmentsYearFilter:
    """`GET /students/{id}/assessments` — the profile page's Grades tab."""

    def test_partitions_by_year(self, client, two) -> None:
        prev = client.get(
            f"{V1}/students/{two.student.id}/assessments?academic_year_id={two.prev.year_id}",
            headers=two.P,
        )
        cur = client.get(
            f"{V1}/students/{two.student.id}/assessments?academic_year_id={two.cur.year_id}",
            headers=two.P,
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        prev_cs = {g["offering_id"] for g in prev.json()["items"]}
        cur_cs = {g["offering_id"] for g in cur.json()["items"]}
        assert str(two.prev.cs.id) in prev_cs
        assert str(two.cur.cs.id) not in prev_cs
        assert str(two.cur.cs.id) in cur_cs


class TestTeachersListYearFilter:
    """`GET /teachers` — TeachersListPage sends `academic_year_id`.

    The teacher directory is not year-partitioned data (a teacher is not "in" a year),
    so the filter must at minimum be ACCEPTED and not corrupt the list. This pins that
    it does not 422 and does not silently empty out — the two ways a wired-up-but-wrong
    filter breaks a screen.
    """

    @pytest.mark.parametrize("role", ["P", "S"])
    def test_year_filter_is_accepted_and_does_not_empty_the_directory(
        self, client, two, role
    ) -> None:
        headers = getattr(two, role)
        for year_id in (two.prev.year_id, two.cur.year_id):
            r = client.get(f"{V1}/teachers?academic_year_id={year_id}", headers=headers)
            assert r.status_code == 200, r.text
            assert str(two.teacher.id) in _ids(r.json())


class TestSemestersYearFilter:
    """`GET /settings/semesters?academic_year_id=` — backs the report-card term picker."""

    def test_unfiltered_list_is_chronological_newest_year_first(self, client, two) -> None:
        """With no `academic_year_id` this returns EVERY year's terms — that is what the
        report-card term picker relies on to reach an archived year.

        It used to be ordered by `academic_year_id`, a UUID, so the order across years
        was arbitrary while looking stable. Terms are named per year ("Semester 1" in
        both), so a mis-ordered list is how someone prints the wrong year's report card.
        """
        r = client.get(f"{V1}/settings/semesters", headers=two.P)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        positions = {str(i["id"]): n for n, i in enumerate(items)}
        assert positions[str(two.cur.sem.id)] < positions[str(two.prev.sem.id)], (
            "The newer year's term did not sort first — the term picker would offer "
            f"years in arbitrary order. Got: {[i['name'] for i in items]}"
        )

    def test_partitions_semesters_by_year(self, client, two) -> None:
        prev = client.get(
            f"{V1}/settings/semesters?academic_year_id={two.prev.year_id}", headers=two.P
        )
        cur = client.get(
            f"{V1}/settings/semesters?academic_year_id={two.cur.year_id}", headers=two.P
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        assert str(two.prev.sem.id) in _ids(prev.json())
        assert str(two.cur.sem.id) not in _ids(prev.json())
        assert str(two.cur.sem.id) in _ids(cur.json())


# ══════════════════════════════════════════════════════════════════════════════
# The student's GLOBAL year switcher
# ══════════════════════════════════════════════════════════════════════════════
class TestStudentYearsList:
    """`GET /students/me/years` + `/students/{id}/years` — populate the switcher itself.

    If these are wrong the switcher is empty and every other year test is moot.
    """

    def test_me_years_lists_every_year_the_student_was_enrolled_in(self, client, two) -> None:
        r = client.get(f"{V1}/students/me/years", headers=two.STU)
        assert r.status_code == 200, r.text
        ids = _ids(r.json())
        assert {two.prev.year_id, two.cur.year_id} <= ids

    def test_me_years_is_newest_first(self, client, two) -> None:
        """The switcher shows the first entry as the default; newest must lead."""
        items = client.get(f"{V1}/students/me/years", headers=two.STU).json()["items"]
        positions = {str(i["id"]): n for n, i in enumerate(items)}
        assert positions[two.cur.year_id] < positions[two.prev.year_id], items

    def test_me_years_carries_status_so_the_active_year_is_labellable(self, client, two) -> None:
        items = client.get(f"{V1}/students/me/years", headers=two.STU).json()["items"]
        by_id = {str(i["id"]): i for i in items}
        assert by_id[two.cur.year_id]["status"] == "active"
        assert by_id[two.prev.year_id]["status"] == "archived"

    def test_staff_can_read_a_students_years(self, client, two) -> None:
        r = client.get(f"{V1}/students/{two.student.id}/years", headers=two.P)
        assert r.status_code == 200, r.text
        assert {two.prev.year_id, two.cur.year_id} <= _ids(r.json())

    def test_me_years_is_student_only(self, client, two) -> None:
        assert client.get(f"{V1}/students/me/years", headers=two.P).status_code == 403


class TestStudentOwnDataFollowsTheSwitcher:
    """The three screens the global switcher re-scopes: My Grades, My Attendance,
    My Classes. Each must return THAT year's data — the student scored 60 in the
    previous year and 90 in the current one, so the numbers are unambiguous."""

    def test_my_grades_follows_the_selected_year(self, client, two) -> None:
        prev = client.get(f"{V1}/grades/me?academic_year_id={two.prev.year_id}", headers=two.STU)
        cur = client.get(f"{V1}/grades/me?academic_year_id={two.cur.year_id}", headers=two.STU)
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        assert prev.json() != cur.json(), (
            "My Grades returned identical payloads for two different years — the "
            "academic_year_id parameter is not reaching the query."
        )

    def test_my_attendance_follows_the_selected_year(self, client, two) -> None:
        prev = client.get(
            f"{V1}/attendance/me?academic_year_id={two.prev.year_id}", headers=two.STU
        )
        cur = client.get(f"{V1}/attendance/me?academic_year_id={two.cur.year_id}", headers=two.STU)
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        assert prev.json() != cur.json(), (
            "My Attendance returned identical payloads for two different years — the "
            "academic_year_id parameter is not reaching the query."
        )

    def test_my_grades_reports_that_years_marks(self, client, two) -> None:
        """The scores differ per year (60 vs 90), so this pins the right year's marks
        rather than merely "a different payload"."""
        prev = client.get(
            f"{V1}/grades/me?academic_year_id={two.prev.year_id}", headers=two.STU
        ).json()
        cur = client.get(
            f"{V1}/grades/me?academic_year_id={two.cur.year_id}", headers=two.STU
        ).json()

        def scores(payload: dict) -> set[str]:
            return {
                str(a["score"])
                for subj in payload["by_subject"]
                for a in subj["assessments"]
                if a.get("score") is not None
            }

        assert "60" in "".join(scores(prev)), prev
        assert "90" in "".join(scores(cur)), cur

    def test_unknown_year_returns_EMPTY_not_another_years_grades(self, client, two) -> None:
        """REGRESSION (defect found 2026-07-29).

        `get_my_grades` fell back to "the student's most recent active enrollment"
        whenever it could not resolve a section for the requested year — so a stale or
        hand-edited `academic_year_id` silently returned the CURRENT year's grades
        under the requested year's heading. Not a cross-user exposure (every query is
        keyed to the caller's own `student.id`); the harm was mislabelling.

        The fallback is now reached only when NO year was requested (the "school has no
        active year configured" path). An explicitly requested year with no enrollment
        must come back empty — which is what `/attendance/me` already did.
        """
        stray = uuid.uuid4()
        r = client.get(f"{V1}/grades/me?academic_year_id={stray}", headers=two.STU)
        assert r.status_code == 200, r.text
        assert r.json()["by_subject"] == [], (
            "An unknown academic_year_id returned grades — a stale or tampered year id "
            "must not resolve to another year's marks."
        )
        # ...and the student identity block is still returned, so the screen renders
        # an empty state rather than erroring.
        assert r.json()["student"]["id"] == str(two.student.id)

    def test_omitting_the_year_still_resolves_the_current_enrollment(
        self, client, two
    ) -> None:
        """The other half of the fix: with no `academic_year_id`, the fallback must
        still work — otherwise a school with no active year configured shows a student
        nothing at all."""
        r = client.get(f"{V1}/grades/me", headers=two.STU)
        assert r.status_code == 200, r.text
        assert r.json()["by_subject"] != [], (
            "Omitting academic_year_id returned nothing — the current-enrollment "
            "fallback was removed along with the year-mislabelling bug."
        )


# ══════════════════════════════════════════════════════════════════════════════
# SEMESTER scoping — the second half of the student's global switcher
# ══════════════════════════════════════════════════════════════════════════════
# Added 2026-07-29 with the year·semester switcher. A year filter alone was not
# enough: a student on "My Assessments" saw every assessment in the year under a
# heading that named one semester. These assert partitioning WITHIN one year
# (`two.cur` has Semester 1 @ score 90 / present, and Semester 2 @ score 40 / absent),
# which is the property a year filter cannot give you.
class TestAssessmentsSemesterFilter:
    """`GET /assessments?semester_id=` — the student's My Assessments list."""

    @pytest.mark.parametrize("role", ["P", "T", "STU"])
    def test_partitions_assessments_by_semester_within_one_year(
        self, client, two, role
    ) -> None:
        headers = getattr(two, role)
        s1 = client.get(f"{V1}/assessments?semester_id={two.cur.sem.id}", headers=headers)
        s2 = client.get(f"{V1}/assessments?semester_id={two.cur.sem2.id}", headers=headers)
        assert s1.status_code == 200, s1.text
        assert s2.status_code == 200, s2.text

        s1_ids, s2_ids = _ids(s1.json()), _ids(s2.json())
        assert str(two.cur.assessment.id) in s1_ids
        assert str(two.cur.sem2_assessment.id) not in s1_ids
        assert str(two.cur.sem2_assessment.id) in s2_ids
        assert str(two.cur.assessment.id) not in s2_ids

    def test_semester_composes_with_year_rather_than_replacing_it(self, client, two) -> None:
        """Both params on one call: the year filters the the semester the
        assessment. Sending them together must narrow, not conflict."""
        r = client.get(
            f"{V1}/assessments"
            f"?academic_year_id={two.cur.year_id}&semester_id={two.cur.sem2.id}",
            headers=two.T,
        )
        assert r.status_code == 200, r.text
        ids = _ids(r.json())
        assert str(two.cur.sem2_assessment.id) in ids
        assert str(two.cur.assessment.id) not in ids
        assert str(two.prev.assessment.id) not in ids

    def test_mismatched_year_and_semester_returns_empty_not_the_wrong_period(
        self, client, two
    ) -> None:
        """A semester from a DIFFERENT year than the one requested must yield nothing.
        Returning that semester's rows under the requested year's heading is the same
        mislabelling class of bug as the `/grades/me` fallback defect."""
        r = client.get(
            f"{V1}/assessments"
            f"?academic_year_id={two.prev.year_id}&semester_id={two.cur.sem2.id}",
            headers=two.T,
        )
        assert r.status_code == 200, r.text
        assert r.json()["items"] == []

    def test_omitting_semester_still_spans_the_whole_year(self, client, two) -> None:
        """The param is additive — staff screens that never send it keep working."""
        r = client.get(
            f"{V1}/assessments?academic_year_id={two.cur.year_id}", headers=two.T
        )
        assert r.status_code == 200, r.text
        ids = _ids(r.json())
        assert {str(two.cur.assessment.id), str(two.cur.sem2_assessment.id)} <= ids


class TestMyGradesSemesterFilter:
    """`GET /grades/me?semester_id=` — My Grades under the year·semester switcher."""

    def _scores(self, payload: dict) -> set[str]:
        return {
            str(a["score"])
            for subj in payload["by_subject"]
            for a in subj["assessments"]
            if a.get("score") is not None
        }

    def test_partitions_marks_by_semester(self, client, two) -> None:
        base = f"{V1}/grades/me?academic_year_id={two.cur.year_id}"
        s1 = client.get(f"{base}&semester_id={two.cur.sem.id}", headers=two.STU)
        s2 = client.get(f"{base}&semester_id={two.cur.sem2.id}", headers=two.STU)
        assert s1.status_code == 200, s1.text
        assert s2.status_code == 200, s2.text

        # 90 in Semester 1, 40 in Semester 2 — the scores, not just "a different payload".
        assert "90.0" in {f"{float(s)}" for s in self._scores(s1.json())}, s1.json()
        assert "40.0" in {f"{float(s)}" for s in self._scores(s2.json())}, s2.json()
        assert self._scores(s1.json()) != self._scores(s2.json())

    def test_term_average_is_computed_from_the_selected_semester_only(
        self, client, two
    ) -> None:
        """The whole point of a per-semester view: the term average must describe the
        rows on screen. Spanning the year would average 90 and 40 to 65."""
        base = f"{V1}/grades/me?academic_year_id={two.cur.year_id}"
        s1 = client.get(f"{base}&semester_id={two.cur.sem.id}", headers=two.STU).json()
        s2 = client.get(f"{base}&semester_id={two.cur.sem2.id}", headers=two.STU).json()
        assert [s["term_numeric"] for s in s1["by_subject"]] == [90.0], s1
        assert [s["term_numeric"] for s in s2["by_subject"]] == [40.0], s2

    def test_semester_from_another_year_returns_empty(self, client, two) -> None:
        r = client.get(
            f"{V1}/grades/me"
            f"?academic_year_id={two.cur.year_id}&semester_id={two.prev.sem.id}",
            headers=two.STU,
        )
        assert r.status_code == 200, r.text
        assert all(s["assessments"] == [] for s in r.json()["by_subject"]), r.json()


class TestMyAttendanceSemesterFilter:
    """`GET /attendance/me?semester_id=` — My Attendance under the switcher."""

    def test_partitions_history_by_semester(self, client, two) -> None:
        base = f"{V1}/attendance/me?academic_year_id={two.cur.year_id}"
        s1 = client.get(f"{base}&semester_id={two.cur.sem.id}", headers=two.STU)
        s2 = client.get(f"{base}&semester_id={two.cur.sem2.id}", headers=two.STU)
        assert s1.status_code == 200, s1.text
        assert s2.status_code == 200, s2.text
        # present in S1, absent in S2 — a leak changes the summary, not just the dates.
        assert [h["status"] for h in s1.json()["history"]] == ["present"], s1.json()
        assert [h["status"] for h in s2.json()["history"]] == ["absent"], s2.json()

    def test_summary_describes_the_selected_semester(self, client, two) -> None:
        base = f"{V1}/attendance/me?academic_year_id={two.cur.year_id}"
        s1 = client.get(f"{base}&semester_id={two.cur.sem.id}", headers=two.STU).json()
        s2 = client.get(f"{base}&semester_id={two.cur.sem2.id}", headers=two.STU).json()
        assert s1["summary"] != s2["summary"], (
            "The attendance summary was identical for two semesters — it is being "
            "computed over a wider record set than the history shown."
        )

    def test_mismatched_year_and_semester_returns_empty(self, client, two) -> None:
        r = client.get(
            f"{V1}/attendance/me"
            f"?academic_year_id={two.prev.year_id}&semester_id={two.cur.sem2.id}",
            headers=two.STU,
        )
        assert r.status_code == 200, r.text
        assert r.json()["history"] == []

    def test_omitting_semester_spans_the_year(self, client, two) -> None:
        r = client.get(
            f"{V1}/attendance/me?academic_year_id={two.cur.year_id}", headers=two.STU
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["history"]) == 2, r.json()


class TestMyProfileFollowsTheSwitcher:
    """`GET /students/me?academic_year_id=` — the student's own "My Profile".

    This page showed the CURRENT classes no matter which year the switcher named,
    because `/students/me` did not declare `academic_year_id` at all while
    `/students/{id}` had accepted it for staff since the year-filter work. The student
    sat in different classes each year, so the header contradicted every other
    screen the switcher re-scoped.
    """

    def test_current_offerings_are_resolved_for_the_selected_year(self, client, two) -> None:
        prev = client.get(
            f"{V1}/students/me?academic_year_id={two.prev.year_id}", headers=two.STU
        )
        cur = client.get(
            f"{V1}/students/me?academic_year_id={two.cur.year_id}", headers=two.STU
        )
        assert prev.status_code == 200, prev.text
        assert cur.status_code == 200, cur.text
        prev_ids = [c["id"] for c in prev.json()["current_offerings"]]
        cur_ids = [c["id"] for c in cur.json()["current_offerings"]]
        assert prev_ids and cur_ids
        assert prev_ids == [two.prev.section_id]
        assert cur_ids == [two.cur.section_id]

    def test_it_is_still_the_callers_own_record(self, client, two) -> None:
        """The param narrows the view of the caller's own record; it can never select
        a different student (that comes from the token alone, §3.2)."""
        r = client.get(
            f"{V1}/students/me?academic_year_id={two.prev.year_id}", headers=two.STU
        )
        assert r.json()["id"] == str(two.student.id)

    def test_omitting_the_year_is_unchanged(self, client, two) -> None:
        r = client.get(f"{V1}/students/me", headers=two.STU)
        assert r.status_code == 200, r.text
        assert r.json()["id"] == str(two.student.id)

    def test_still_student_only(self, client, two) -> None:
        assert client.get(f"{V1}/students/me", headers=two.P).status_code == 403


class TestEveryRoleCanReadThePeriodCalendar:
    """The pickers themselves must be populated for the role using them.

    `GET /settings/academic-years` was gated to P/S while `useYearFilter` ran on
    teacher-reachable screens (Grades, Attendance, Classes) and the student switcher
    needed each year's semesters. Teachers got a 403 → the picker emptied and no
    `academic_year_id` was sent, so every year-scoping guarantee above was unreachable
    from the UI. The MSW mock has no role gate, so demo mode showed none of this.
    """

    @pytest.mark.parametrize("role", ["P", "S", "T", "STU"])
    def test_academic_years_readable_by_every_role(self, client, two, role) -> None:
        r = client.get(f"{V1}/settings/academic-years", headers=getattr(two, role))
        assert r.status_code == 200, r.text
        ids = _ids(r.json())
        assert {two.prev.year_id, two.cur.year_id} <= ids

    @pytest.mark.parametrize("role", ["P", "S", "T", "STU"])
    def test_semesters_readable_by_every_role(self, client, two, role) -> None:
        r = client.get(
            f"{V1}/settings/semesters?academic_year_id={two.cur.year_id}",
            headers=getattr(two, role),
        )
        assert r.status_code == 200, r.text
        assert {str(two.cur.sem.id), str(two.cur.sem2.id)} <= _ids(r.json())

    def test_the_switcher_can_be_built_from_these_two_reads(self, client, two) -> None:
        """End-to-end shape check for the student switcher: the years they were
        enrolled in, joined to each year's semesters, yields the year·semester pairs the
        top-bar menu lists. If this join breaks the switcher has nothing to show."""
        enrolled = {
            str(i["id"])
            for i in client.get(f"{V1}/students/me/years", headers=two.STU).json()["items"]
        }
        calendar = {
            str(y["id"]): y["semesters"]
            for y in client.get(
                f"{V1}/settings/academic-years", headers=two.STU
            ).json()["items"]
        }
        pairs = {
            (year_id, str(s["id"]))
            for year_id in enrolled
            if year_id in calendar
            for s in calendar[year_id]
        }
        assert (two.cur.year_id, str(two.cur.sem.id)) in pairs
        assert (two.cur.year_id, str(two.cur.sem2.id)) in pairs
        assert (two.prev.year_id, str(two.prev.sem.id)) in pairs

    def test_writes_are_still_principal_only(self, client, two) -> None:
        """Widening the reads must not have widened the authority."""
        r = client.patch(
            f"{V1}/settings/semesters/{two.cur.sem2.id}/activate", headers=two.T
        )
        assert r.status_code == 403, r.text

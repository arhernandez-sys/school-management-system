"""Comprehensive pytest suite for Module 7.9b — REPORTS (api-spec §5 Module 10).

Scope: the student picker, report card (staff + `/me`), the multi-year transcript, and
the three aggregate reports.

The load-bearing behaviours pinned here:
  * **Transcript is principal/secretary ONLY** (D26) — a teacher gets 403.
  * **The report-card release rule is per-OFFERING** (AC 5.5): for a student's own
    card, a subject with ANY unreleased graded work shows `status="pending"` with no
    numeric, rather than a partial average. Staff always see the computed value.
  * **Archived years read frozen snapshots** and report `is_frozen=true`, so a later
    grading-scale edit cannot rewrite a document already issued.
  * A **frozen `subject_id`** keeps a transcript line stable across a subject rename
    and a soft-deleted offering.
  * An unknown `semester_id` is a **404**, not a silent fallback to the active term.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.core.timeutil import utcnow
from app.modules.assessments.models import Assessment
from app.modules.attendance.models import AttendanceRecord
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.offerings.labels import offering_label
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

R = "/api/v1/reports"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """Active year + semester + section + two offerings, an owning teacher, and an
    enrolled student with a login."""

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db_session
        self._make_user = make_user
        self._auth_headers = auth_headers
        self._make_grading_scale = make_grading_scale

        self.year = AcademicYear(
            name=f"RepYear {tag}", start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        make_grading_scale(self.year.id)
        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        self.sem2 = Semester(
            academic_year_id=self.year.id, name="Semester 2", sequence=2,
            start_date=date(2026, 2, 1), end_date=date(2026, 8, 31), is_active=False,
        )
        db_session.add_all([self.sem, self.sem2])

        self.subject = Course(name=f"AAA Math {tag}", code=f"MA{tag[:3].upper()}")
        self.subject2 = Course(name=f"BBB Science {tag}", code=f"SC{tag[:3].upper()}")
        db_session.add_all([self.subject, self.subject2])
        db_session.flush()

        # `capacity` moved from `classes` to `course_offerings` (D31) and the enrolment
        # report still prints it.
        self.cs = CourseOffering(
            course_id=self.subject.id,
            semester_id=self.sem.id,
            section_code=uuid.uuid4().hex[:6],
            capacity=30,
        )
        self.cs2 = CourseOffering(
            course_id=self.subject2.id,
            semester_id=self.sem.id,
            section_code=uuid.uuid4().hex[:6],
            capacity=30,
        )
        db_session.add_all([self.cs, self.cs2])
        db_session.flush()
        self.section = self.cs

        self.principal_user = make_user(role=Role.PRINCIPAL, full_name="The Principal")
        self.secretary_user = make_user(role=Role.SECRETARY, full_name="Front Office")
        self.teacher_user = make_user(role=Role.TEACHER, full_name="Maria Reyes")
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id, staff_number=f"T-{tag}",
            full_name="Maria Reyes", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()
        db_session.add(ClassTeacher(offering_id=self.cs.id, teacher_id=self.teacher.id, is_lead=True))
        db_session.flush()

        self.student, self.enrollment = self.add_student(name="Ana Lopez", with_login=True)

        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student.user_id, role=Role.STUDENT)

    def add_student(self, *, name=None, with_login=False, semester=None):
        s = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            **split_name(name or f"Stu {uuid.uuid4().hex[:4]}"),
            date_of_birth=date(2012, 3, 4),
            enrollment_date=date(2025, 9, 1),
            status="Registered",
            # D29: the level lives on the student, not on a homeroom, and the report
            # card header reads it from here.
            year_of_study="First",
        )
        if with_login:
            user = self._make_user(role=Role.STUDENT, full_name=s.full_name)
            s.user_id = user.id
        self._db.add(s)
        self._db.flush()
        # ONE ENROLMENT PER OFFERING (D31). A single row used to point at the homeroom
        # and cover everything it taught, which is why the report-card assertions below
        # expect BOTH subjects to print. An offering teaches one course, so a student
        # sitting two courses needs two rows.
        enrolments = [
            ClassEnrollment(
                offering_id=offering.id,
                student_id=s.id,
                semester_id=(semester or self.sem).id,
            )
            for offering in (self.cs, self.cs2)
        ]
        self._db.add_all(enrolments)
        self._db.flush()
        # The first is returned for the many call sites that thread "the" enrolment
        # through to a grade; grades are per assessment, and every assessment in this
        # graph belongs to one of these two offerings.
        return s, enrolments[0]

    def assessment(self, *, cs=None, status="graded", max_score="100", weight="1",
                   is_released=True, semester=None):
        a = Assessment(
            offering_id=(cs or self.cs).id,
            semester_id=(semester or self.sem).id,
            title=f"A {uuid.uuid4().hex[:5]}",
            type="quiz",
            max_score=Decimal(max_score),
            weight=Decimal(weight),
            status=status,
            is_released=is_released,
        )
        self._db.add(a)
        self._db.flush()
        return a

    def grade(self, assessment, student, enrollment, *, status="graded", score="80"):
        g = AssessmentGrade(
            assessment_id=assessment.id, student_id=student.id, enrollment_id=enrollment.id,
            status=status, score=Decimal(score) if score is not None else None,
        )
        self._db.add(g)
        self._db.flush()
        return g

    def attendance(self, student, enrollment, *, status="present", on=None, semester=None):
        r = AttendanceRecord(
            offering_id=self.section.id, student_id=student.id, enrollment_id=enrollment.id,
            semester_id=(semester or self.sem).id,
            attendance_date=on or date(2025, 10, 15), status=status,
        )
        self._db.add(r)
        self._db.flush()
        return r

    def snapshot(self, *, student=None, cs=None, semester=None, numeric="88.00",
                 letter="B", subject=None):
        snap = TermGradeSnapshot(
            student_id=(student or self.student).id,
            offering_id=(cs or self.cs).id,
            semester_id=(semester or self.sem).id,
            subject_id=(subject or self.subject).id,
            numeric_grade=Decimal(numeric),
            letter_grade=letter,
            weight_base_used=Decimal("3.00"),
            effective_policy={"absent_as_zero": False, "allow_makeup": True, "drop_lowest_count": 0},
        )
        self._db.add(snap)
        self._db.flush()
        return snap

    def archive_year(self) -> None:
        self.year.archived_at = utcnow()
        self.year.status = AcademicYearStatus.ARCHIVED
        self._db.flush()


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


def _card(client, graph, headers=None, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return client.get(f"{R}/report-card?{query}", headers=headers or graph.P)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_all_endpoints_require_auth(self, client, graph) -> None:
        for url in (
            f"{R}/students",
            f"{R}/report-card?student_id={graph.student.id}",
            f"{R}/report-card/me",
            f"{R}/transcript?student_id={graph.student.id}",
            f"{R}/offering-grades?offering_id={graph.cs.id}",
            f"{R}/attendance?section_id={graph.section.id}",
            f"{R}/enrollment",
        ):
            assert client.get(url).status_code == 401, url

    def test_student_forbidden_on_staff_endpoints(self, client, graph) -> None:
        for url in (
            f"{R}/students",
            f"{R}/report-card?student_id={graph.student.id}",
            f"{R}/transcript?student_id={graph.student.id}",
            f"{R}/offering-grades?offering_id={graph.cs.id}",
            f"{R}/attendance?section_id={graph.section.id}",
            f"{R}/enrollment",
        ):
            assert client.get(url, headers=graph.U).status_code == 403, url

    def test_non_student_forbidden_on_me(self, client, graph) -> None:
        assert client.get(f"{R}/report-card/me", headers=graph.P).status_code == 403
        assert client.get(f"{R}/report-card/me", headers=graph.T).status_code == 403

    def test_transcript_is_admin_only_per_d26(self, client, graph) -> None:
        """A teacher may read a report card but NOT a transcript."""
        assert client.get(f"{R}/report-card?student_id={graph.student.id}", headers=graph.T).status_code == 200
        r = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.T)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_enrollment_is_admin_only(self, client, graph) -> None:
        assert client.get(f"{R}/enrollment", headers=graph.T).status_code == 403
        assert client.get(f"{R}/enrollment", headers=graph.P).status_code == 200
        assert client.get(f"{R}/enrollment", headers=graph.S).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestStudentPicker:
    def test_page_envelope_and_item_shape(self, client, graph) -> None:
        body = client.get(f"{R}/students", headers=graph.P).json()
        assert set(body.keys()) == {"items", "total", "page", "page_size", "total_pages"}
        item = next(i for i in body["items"] if i["id"] == str(graph.student.id))
        assert set(item.keys()) == {
            "id", "full_name", "student_number", "date_of_birth", "status",
            "year_of_study",
        }
        assert item["year_of_study"] == "First"
        assert item["date_of_birth"] == "2012-03-04"

    def test_search_by_name(self, client, graph) -> None:
        graph.add_student(name="Zebediah Unique")
        body = client.get(f"{R}/students?search=Zebediah", headers=graph.P).json()
        assert [i["full_name"] for i in body["items"]] == ["Zebediah Unique"]

    def test_search_by_student_number(self, client, graph) -> None:
        body = client.get(
            f"{R}/students?search={graph.student.student_number}", headers=graph.P
        ).json()
        assert any(i["id"] == str(graph.student.id) for i in body["items"])

    def test_status_filter(self, client, graph, db_session) -> None:
        graph.student.status = "graduated"
        db_session.flush()
        body = client.get(f"{R}/students?status=graduated", headers=graph.P).json()
        assert any(i["id"] == str(graph.student.id) for i in body["items"])
        body = client.get(f"{R}/students?status=active", headers=graph.P).json()
        assert not any(i["id"] == str(graph.student.id) for i in body["items"])

    def test_pagination(self, client, graph) -> None:
        for i in range(4):
            graph.add_student(name=f"Bulk {i}")
        body = client.get(f"{R}/students?page=1&page_size=2", headers=graph.P).json()
        assert len(body["items"]) == 2
        assert body["total_pages"] >= 2

    def test_teacher_may_use_the_picker(self, client, graph) -> None:
        assert client.get(f"{R}/students", headers=graph.T).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestReportCard:
    def test_top_level_keys(self, client, graph) -> None:
        body = _card(client, graph, student_id=graph.student.id).json()
        assert set(body.keys()) == {
            "student", "year_of_study", "semester", "school", "subjects",
            "attendance_summary", "term_average", "term_average_letter", "is_frozen",
            # D30 Phase 3 — the BAJC layout's header labels plus the credit-weighted GPA.
            "program_code", "period", "block", "gpa", "total_credits",
            # D32 — which report this is, and when it was frozen (null on a computed one).
            "report_kind", "frozen_at",
        }
        # The default is the pre-D32 behaviour, so every existing caller is unaffected.
        assert body["report_kind"] == "endterm"
        assert body["frozen_at"] is None
        # D29: the header names the student's LEVEL, not a homeroom.
        assert body["year_of_study"] == "First"

    def test_unknown_student_404(self, client, graph) -> None:
        r = _card(client, graph, student_id=uuid.uuid4())
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_unknown_semester_404_not_a_silent_fallback(self, client, graph) -> None:
        r = _card(client, graph, student_id=graph.student.id, semester_id=uuid.uuid4())
        assert r.status_code == 404
        _assert_envelope(r.json(), code="semester_not_found")

    def test_semester_defaults_to_the_active_term(self, client, graph) -> None:
        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["semester"]["id"] == str(graph.sem.id)
        assert body["semester"]["academic_year_name"] == graph.year.name

    def test_school_uses_the_short_field_names(self, client, graph) -> None:
        """Reports-local shape: phone/email, not contact_phone/contact_email."""
        school = _card(client, graph, student_id=graph.student.id).json()["school"]
        assert set(school.keys()) == {"name", "address", "phone", "email", "logo_url"}

    def test_teacher_is_a_plain_display_string(self, client, graph) -> None:
        graph.assessment()
        row = next(
            s for s in _card(client, graph, student_id=graph.student.id).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject.id)
        )
        assert row["teacher"] == "Maria Reyes"  # a string, not {id, full_name}

    def test_unassigned_offering_reports_null_teacher(self, client, graph) -> None:
        row = next(
            s for s in _card(client, graph, student_id=graph.student.id).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject2.id)
        )
        assert row["teacher"] is None

    def test_subjects_sorted_by_name(self, client, graph) -> None:
        names = [s["subject"]["name"] for s in _card(client, graph, student_id=graph.student.id).json()["subjects"]]
        assert names == sorted(names)

    def test_term_average_is_the_mean_of_the_printed_rows(self, client, graph) -> None:
        a1 = graph.assessment(cs=graph.cs, max_score="100")
        a2 = graph.assessment(cs=graph.cs2, max_score="100")
        graph.grade(a1, graph.student, graph.enrollment, score="90")
        graph.grade(a2, graph.student, graph.enrollment, score="70")
        body = _card(client, graph, student_id=graph.student.id).json()
        rows = {s["subject"]["id"]: s["numeric"] for s in body["subjects"]}
        assert rows[str(graph.subject.id)] == 90.0
        assert rows[str(graph.subject2.id)] == 70.0
        # The headline is the mean of the rows beneath it, so the two reconcile.
        assert body["term_average"] == 80.0
        assert body["term_average_letter"] == "B"

    def test_ungraded_subjects_excluded_from_the_average(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="90")
        body = _card(client, graph, student_id=graph.student.id).json()
        # cs2 has no assessments -> numeric None, must not drag the average to 45.
        assert body["term_average"] == 90.0

    def test_no_grades_yields_null_average(self, client, graph) -> None:
        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["term_average"] is None
        assert body["term_average_letter"] is None

    def test_attendance_summary_shape_omits_present(self, client, graph) -> None:
        graph.attendance(graph.student, graph.enrollment, status="present")
        graph.attendance(graph.student, graph.enrollment, status="absent", on=date(2025, 10, 16))
        graph.attendance(graph.student, graph.enrollment, status="late", on=date(2025, 10, 17))
        summary = _card(client, graph, student_id=graph.student.id).json()["attendance_summary"]
        assert set(summary.keys()) == {"pct_present", "absent", "late", "excused"}
        assert summary["absent"] == 1
        assert summary["late"] == 1
        # present + late = 2 of 3 -> 66.7 (late counts as present)
        assert summary["pct_present"] == 66.7

    def test_attendance_is_scoped_to_the_semester(self, client, graph) -> None:
        graph.attendance(graph.student, graph.enrollment, status="absent", semester=graph.sem2)
        summary = _card(client, graph, student_id=graph.student.id).json()["attendance_summary"]
        assert summary["absent"] == 0

    def test_staff_see_unreleased_grades_computed(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100", is_released=False)
        graph.grade(a, graph.student, graph.enrollment, score="90")
        row = next(
            s for s in _card(client, graph, student_id=graph.student.id).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject.id)
        )
        assert row["status"] == "graded"
        assert row["numeric"] == 90.0

    def test_is_frozen_false_for_a_live_year(self, client, graph) -> None:
        assert _card(client, graph, student_id=graph.student.id).json()["is_frozen"] is False


# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.usefixtures("student_grades_visible")
# D32 (brief §4): a student reaches no grade surface unless the Dean has published
# grades. This suite is about WHAT a student sees, not WHETHER they may — the "may
# not" case is `tests/test_student_grade_visibility.py` — so it opts in explicitly.
class TestMyReportCard:
    def test_student_reads_their_own(self, client, graph) -> None:
        body = client.get(f"{R}/report-card/me", headers=graph.U).json()
        assert body["student"]["id"] == str(graph.student.id)
        assert body["student"]["full_name"] == "Ana Lopez"

    def test_fully_released_subject_shows_graded(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100", is_released=True)
        graph.grade(a, graph.student, graph.enrollment, score="90")
        row = next(
            s for s in client.get(f"{R}/report-card/me", headers=graph.U).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject.id)
        )
        assert row["status"] == "graded"
        assert row["numeric"] == 90.0

    def test_any_unreleased_graded_work_makes_the_subject_pending(self, client, graph) -> None:
        """AC 5.5 — the release rule is per-OFFERING, not per-assessment.

        An official document must not print a partial average, so one unreleased
        graded assessment suppresses the whole subject row.
        """
        shown = graph.assessment(cs=graph.cs, max_score="100", is_released=True)
        secret = graph.assessment(cs=graph.cs, max_score="100", is_released=False)
        graph.grade(shown, graph.student, graph.enrollment, score="90")
        graph.grade(secret, graph.student, graph.enrollment, score="10")
        row = next(
            s for s in client.get(f"{R}/report-card/me", headers=graph.U).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject.id)
        )
        assert row["status"] == "pending"
        assert row["numeric"] is None
        assert row["letter"] is None

    def test_pending_subject_excluded_from_the_term_average(self, client, graph) -> None:
        ok = graph.assessment(cs=graph.cs2, max_score="100", is_released=True)
        graph.grade(ok, graph.student, graph.enrollment, score="70")
        secret = graph.assessment(cs=graph.cs, max_score="100", is_released=False)
        graph.grade(secret, graph.student, graph.enrollment, score="10")
        body = client.get(f"{R}/report-card/me", headers=graph.U).json()
        assert body["term_average"] == 70.0

    def test_draft_lifecycle_assessments_do_not_make_a_subject_pending(self, client, graph) -> None:
        """Only `graded`-lifecycle work gates release; a draft is not yet real."""
        graded = graph.assessment(cs=graph.cs, status="graded", is_released=True)
        graph.assessment(cs=graph.cs, status="draft", is_released=False)
        graph.grade(graded, graph.student, graph.enrollment, score="85")
        row = next(
            s for s in client.get(f"{R}/report-card/me", headers=graph.U).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject.id)
        )
        assert row["status"] == "graded"

    def test_student_without_a_profile_404(self, client, graph, make_user, auth_headers) -> None:
        user = make_user(role=Role.STUDENT)
        r = client.get(
            f"{R}/report-card/me", headers=auth_headers(user_id=user.id, role=Role.STUDENT)
        )
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")


# ════════════════════════════════════════════════════════════════════════════
#: The BAJC 8-band scale with its grade points, as `seed_grading_scale` writes it.
#: `(letter, min, max, grade_point, is_passing)`.
_BAJC_BANDS = [
    ("A", "95.00", "100.00", "4.00", True),
    ("A-", "90.00", "94.00", "3.75", True),
    ("B+", "85.00", "89.00", "3.50", True),
    ("B", "80.00", "84.00", "3.00", True),
    ("C+", "75.00", "79.00", "2.50", True),
    ("C", "70.00", "74.00", "2.00", True),
    ("D", "65.00", "69.00", "1.00", False),
    ("F", "0.00", "64.00", "0.00", False),
]


def _reband_to_bajc(db_session, year_id) -> None:
    """Replace the year's bands with the priced BAJC set.

    REPLACES rather than adds: `reports/service._bands` resolves ONE scale per year with
    `db.scalar(...)`, so a second `grading_scales` row would raise MultipleResultsFound
    instead of giving the test a second scale.
    """
    from app.modules.settings.models import GradingScale, GradingScaleBand

    scale = db_session.scalar(
        select(GradingScale).where(GradingScale.academic_year_id == year_id)
    )
    db_session.execute(
        GradingScaleBand.__table__.delete().where(
            GradingScaleBand.grading_scale_id == scale.id
        )
    )
    for order, (letter, low, high, gp, passing) in enumerate(_BAJC_BANDS):
        db_session.add(
            GradingScaleBand(
                grading_scale_id=scale.id,
                letter=letter,
                min_score=Decimal(low),
                max_score=Decimal(high),
                grade_point=Decimal(gp),
                is_passing=passing,
                sort_order=order,
            )
        )
    scale.pass_mark = Decimal("70.00")
    db_session.flush()


@pytest.mark.usefixtures("student_grades_visible")
# D32 (brief §4): a student reaches no grade surface unless the Dean has published
# grades. This suite is about WHAT a student sees, not WHETHER they may — the "may
# not" case is `tests/test_student_grade_visibility.py` — so it opts in explicitly.
class TestReportCardGpa:
    """**The D30 Phase 3 gate, over HTTP.** The BAJC sample report card prints GPA 2.1
    for five 3-credit courses of which only three are graded; `test_gpa_calc.py` proves
    the arithmetic, and this proves the wiring that feeds it — credits reaching the row
    from `courses`, grade points reaching `BandInput` from `grading_scale_bands`, and
    the ungraded rows staying in the denominator all the way to the response body.
    """

    def _five_offerings(self, graph, db_session):
        """Five 3-credit offerings on the student's section (the graph ships two)."""
        extra = []
        for n in range(3):
            subject = Course(
                name=f"GPA Course {n} {graph.tag}",
                code=f"GP{n}{graph.tag[:3].upper()}",
                credits=3,
            )
            db_session.add(subject)
            db_session.flush()
            cs = CourseOffering(
                course_id=subject.id,
                semester_id=graph.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
            db_session.add(cs)
            db_session.flush()
            # D31: enrolment is per OFFERING, so each extra needs its own row. The GPA
            # denominator is ENROLLED credits, and pre-D31 one homeroom enrolment covered
            # everything the homeroom taught — which is why 15 (5 x 3) is the expected
            # total below.
            db_session.add(
                ClassEnrollment(
                    offering_id=cs.id,
                    student_id=graph.student.id,
                    semester_id=graph.sem.id,
                )
            )
            extra.append(cs)
        # The two the graph created default to 3 credits (the schema default), but say so.
        graph.subject.credits = 3
        graph.subject2.credits = 3
        db_session.flush()
        return [graph.cs, graph.cs2, *extra]

    def test_reproduces_the_sample_report_cards_2_1(self, client, graph, db_session) -> None:
        """B + A- + A- over 15 enrolled credits = 31.50 / 15 = 2.10."""
        _reband_to_bajc(db_session, graph.year.id)
        offerings = self._five_offerings(graph, db_session)

        # 82 -> B (3.00); 92, 93 -> A- (3.75). The last two offerings stay ungraded.
        for cs, score in zip(offerings, ["82", "92", "93"]):
            a = graph.assessment(cs=cs, max_score="100")
            graph.grade(a, graph.student, graph.enrollment, score=score)

        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["total_credits"] == 15
        assert body["gpa"] == 2.10
        assert sorted(r["letter"] for r in body["subjects"] if r["letter"]) == [
            "A-", "A-", "B",
        ]
        # The two ungraded courses are PRESENT with a blank letter — they are what makes
        # the denominator 15, and a report card that hid them could not be checked.
        assert sum(1 for r in body["subjects"] if r["letter"] is None) == 2
        assert all(r["credits"] == 3 for r in body["subjects"])

    def test_a_graded_only_denominator_would_have_said_3_50(
        self, client, graph, db_session
    ) -> None:
        """Same three grades with only those three courses enrolled → 3.50.

        Pinned as the contrast: it is the figure the report card must NOT print when
        ungraded courses exist, and the only difference between the two tests is the
        credits in the denominator.
        """
        _reband_to_bajc(db_session, graph.year.id)
        subject3 = Course(
            name=f"GPA Third {graph.tag}", code=f"G3{graph.tag[:3].upper()}", credits=3
        )
        db_session.add(subject3)
        db_session.flush()
        cs3 = CourseOffering(
                course_id=subject3.id,
                semester_id=graph.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db_session.add(cs3)
        db_session.flush()
        # Enrolment is per offering (D31), and the GPA denominator counts ENROLLED
        # credits — so the third course only reaches the card if the student sits it.
        db_session.add(
            ClassEnrollment(
                offering_id=cs3.id,
                student_id=graph.student.id,
                semester_id=graph.sem.id,
            )
        )
        db_session.flush()

        for cs, score in zip([graph.cs, graph.cs2, cs3], ["82", "92", "93"]):
            a = graph.assessment(cs=cs, max_score="100")
            graph.grade(a, graph.student, graph.enrollment, score=score)

        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["total_credits"] == 9
        assert body["gpa"] == 3.50

    def test_credits_weight_the_gpa(self, client, graph, db_session) -> None:
        """A 9-credit A beside a 1-credit F is 3.60, not the 2.00 a course-count mean gives.

        This is the assertion that fails if `_SubjectResult.credits` is ever dropped and
        the GPA quietly becomes an unweighted average of grade points.
        """
        _reband_to_bajc(db_session, graph.year.id)
        graph.subject.credits = 9
        graph.subject2.credits = 1
        db_session.flush()

        a1 = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a1, graph.student, graph.enrollment, score="98")  # A -> 4.00
        a2 = graph.assessment(cs=graph.cs2, max_score="100")
        graph.grade(a2, graph.student, graph.enrollment, score="10")  # F -> 0.00

        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["total_credits"] == 10
        assert body["gpa"] == 3.60

    def test_no_gpa_without_a_scale_that_prices_letters(
        self, client, graph, db_session
    ) -> None:
        """The graph's default scale has NULL grade points (a pre-Phase-3 scale), so the
        GPA is 0.00 rather than a guess: the credits participated, nothing could be
        priced. Asserting this keeps `grade_point_for`'s None from ever being read as an
        arbitrary number."""
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="98")
        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["gpa"] == 0.00
        assert body["total_credits"] > 0

    def test_a_withheld_subject_contributes_credits_but_no_points(
        self, client, graph, db_session
    ) -> None:
        """On the student's OWN card an unreleased subject shows `pending` — and it must
        not leak its mark through the GPA either. It is scored as ungraded rather than
        dropped, because dropping it would shrink the denominator and let the student
        solve for the hidden grade.
        """
        _reband_to_bajc(db_session, graph.year.id)
        graph.subject.credits = 3
        graph.subject2.credits = 3
        db_session.flush()

        released = graph.assessment(cs=graph.cs, max_score="100", is_released=True)
        graph.grade(released, graph.student, graph.enrollment, score="98")  # A -> 4.00
        hidden = graph.assessment(cs=graph.cs2, max_score="100", is_released=False)
        graph.grade(hidden, graph.student, graph.enrollment, score="98")

        body = client.get(f"{R}/report-card/me", headers=graph.U).json()
        statuses = {r["status"] for r in body["subjects"]}
        assert "pending" in statuses
        # 4.00 x 3 / 6 credits = 2.00 — the withheld course still pays its credits.
        assert body["total_credits"] == 6
        assert body["gpa"] == 2.00

    def test_the_header_carries_period_and_a_blank_programme(
        self, client, graph
    ) -> None:
        """§D13's label block. `program_code` is None until Phase 4 assigns programmes,
        and `block` is None because its meaning is unconfirmed (plan §G item 3) — both
        wired rather than omitted, so the printed document gains them without a schema
        change."""
        body = _card(client, graph, student_id=graph.student.id).json()
        assert body["period"] == "Semester 1, September 2025 - January 2026"
        assert body["program_code"] is None
        assert body["block"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestFrozenReads:
    def test_archived_year_reads_the_snapshot(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="20")  # live would say 20
        graph.snapshot(numeric="88.00", letter="B")
        graph.archive_year()

        body = _card(client, graph, student_id=graph.student.id, semester_id=graph.sem.id).json()
        assert body["is_frozen"] is True
        row = next(s for s in body["subjects"] if s["subject"]["id"] == str(graph.subject.id))
        assert row["numeric"] == 88.0  # the snapshot wins over live compute
        assert row["letter"] == "B"

    def test_frozen_card_only_lists_snapshotted_subjects(self, client, graph) -> None:
        graph.snapshot(cs=graph.cs, subject=graph.subject)
        graph.archive_year()
        body = _card(client, graph, student_id=graph.student.id, semester_id=graph.sem.id).json()
        ids = {s["subject"]["id"] for s in body["subjects"]}
        assert ids == {str(graph.subject.id)}

    def test_frozen_line_survives_a_subject_rename(self, client, graph, db_session) -> None:
        """The frozen `subject_id` is the durable grouping key (schema §10.6)."""
        graph.snapshot(numeric="91.00", letter="A")
        graph.archive_year()
        graph.subject.name = "Renamed Subject"
        db_session.flush()
        body = _card(client, graph, student_id=graph.student.id, semester_id=graph.sem.id).json()
        row = next(s for s in body["subjects"] if s["subject"]["id"] == str(graph.subject.id))
        assert row["numeric"] == 91.0  # the figure is unchanged by the rename

    def test_frozen_line_survives_a_soft_deleted_offering(self, client, graph, db_session) -> None:
        graph.snapshot(numeric="77.00", letter="C")
        graph.archive_year()
        graph.cs.deleted_at = utcnow()
        db_session.flush()
        body = _card(client, graph, student_id=graph.student.id, semester_id=graph.sem.id).json()
        # The offering is gone, so the row drops out — but the snapshot itself is intact
        # and the transcript (which is the document of record) still resolves it.
        transcript = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        assert transcript["student"]["id"] == str(graph.student.id)
        assert body["is_frozen"] is True

    def test_a_later_scale_edit_cannot_change_a_frozen_figure(self, client, graph, db_session) -> None:
        from app.modules.settings.models import GradingScaleBand

        graph.snapshot(numeric="88.00", letter="B")
        graph.archive_year()
        # Move every band floor to 0 — a live compute would relabel everything "A".
        db_session.query(GradingScaleBand).update({"min_score": Decimal("0.00")})
        db_session.flush()
        row = next(
            s for s in _card(client, graph, student_id=graph.student.id, semester_id=graph.sem.id).json()["subjects"]
            if s["subject"]["id"] == str(graph.subject.id)
        )
        assert row["letter"] == "B"  # frozen letter, not recomputed


# ════════════════════════════════════════════════════════════════════════════
class TestTranscript:
    def test_top_level_keys(self, client, graph) -> None:
        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        assert set(body.keys()) == {
            "student", "school", "issued_at", "years", "cumulative_average",
            # D30 Phase 3 — the cumulative GPA, recomputed from credits rather than
            # averaged from the per-year figures.
            "cumulative_gpa", "total_credits",
            # D39 (Meeting #2 item 7) — the programme the transcript is issued against.
            # The report card has carried `program_code` since D30; the transcript, the
            # document that actually leaves the school, did not.
            "program_code", "program_name",
        }

    def test_unknown_student_404(self, client, graph) -> None:
        r = client.get(f"{R}/transcript?student_id={uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404

    def test_secretary_may_read(self, client, graph) -> None:
        assert client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.S).status_code == 200

    def test_an_unmarked_term_does_not_dilute_the_cumulative_gpa(
        self, client, graph, db_session
    ) -> None:
        """**Regression — found by the Phase 3 gate walk, not by this suite.**

        The setup is the shape that broke: the graded term is a PAST one and the CURRENT
        term has nothing marked. The transcript keeps a current term even with no rows,
        and `_classes_for` falls back to the student's whole enrolment history for a term
        they hold no enrolment in — so the unmarked current term handed over the student's
        full course load at 0 quality points and HALVED the year and cumulative GPA.

        The walk caught it printing 1.05 over 30 credits where the term itself read 2.10
        over 15. It is not visible from the printed page, which is exactly why it needed a
        test: a cumulative GPA nobody can check by adding up rows must be right.

        Without the fix this reads 1.00 over 12 credits.
        """
        _reband_to_bajc(db_session, graph.year.id)
        graph.subject.credits = 3
        graph.subject2.credits = 3

        # Make the SECOND term the current one, so the graded term is a past term. Set
        # `sem` false BEFORE `sem2` true — the reader resolves the active term with
        # `db.scalar(...)`, which raises if two rows are active at once.
        graph.sem.is_active = False
        db_session.flush()
        graph.sem2.is_active = True
        db_session.flush()

        # 98 -> A (4.00) in ONE course of the PAST term. Nothing in the current term.
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="98")

        body = client.get(
            f"{R}/transcript?student_id={graph.student.id}", headers=graph.P
        ).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(graph.year.id))
        graded_term = next(
            s for s in year["semesters"] if s["semester"]["id"] == str(graph.sem.id)
        )

        # Within the graded term decision #4 still applies: BOTH courses' credits count,
        # the ungraded one earning nothing. 4.00 x 3 / 6 = 2.00.
        assert graded_term["gpa"] == 2.00
        assert graded_term["total_credits"] == 6

        # And the year and cumulative figures equal it — the unmarked term contributed
        # nothing at all rather than another 6 credits of zeros (which would give 1.00).
        assert year["gpa"] == 2.00
        assert year["total_credits"] == 6
        assert body["cumulative_gpa"] == 2.00
        assert body["total_credits"] == 6

        # Any term kept only because it is current reports no GPA, not 0.00.
        for sem in year["semesters"]:
            if sem["semester"]["id"] != str(graph.sem.id):
                assert sem["gpa"] is None
                assert sem["total_credits"] == 0

    def test_year_and_semester_nesting(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="85")
        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(graph.year.id))
        assert set(year.keys()) == {
            "academic_year", "year_average", "semesters", "gpa", "total_credits",
        }
        sem = next(s for s in year["semesters"] if s["semester"]["id"] == str(graph.sem.id))
        assert set(sem.keys()) == {
            "semester", "is_current", "term_average", "subjects", "gpa", "total_credits",
        }
        assert sem["is_current"] is True
        assert sem["term_average"] == 85.0

    def test_only_graded_lines_are_listed(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="85")
        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(graph.year.id))
        sem = next(s for s in year["semesters"] if s["semester"]["id"] == str(graph.sem.id))
        # cs2 has no grades, so it is not printed as a transcript line.
        assert {r["subject"]["id"] for r in sem["subjects"]} == {str(graph.subject.id)}

    def test_letter_is_non_nullable_on_transcript_rows(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="85")
        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(graph.year.id))
        row = year["semesters"][0]["subjects"][0]
        assert isinstance(row["letter"], str) and row["letter"]

    def test_averages_roll_up(self, client, graph) -> None:
        a1 = graph.assessment(cs=graph.cs, max_score="100")
        a2 = graph.assessment(cs=graph.cs2, max_score="100")
        graph.grade(a1, graph.student, graph.enrollment, score="90")
        graph.grade(a2, graph.student, graph.enrollment, score="70")
        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(graph.year.id))
        sem = next(s for s in year["semesters"] if s["semester"]["id"] == str(graph.sem.id))
        assert sem["term_average"] == 80.0
        assert year["year_average"] == 80.0
        assert body["cumulative_average"] == 80.0

    def test_years_newest_first(self, client, graph, db_session) -> None:
        older = AcademicYear(
            name=f"Older {graph.tag}", start_date=date(2024, 9, 1), end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED, archived_at=utcnow(),
        )
        db_session.add(older)
        db_session.flush()
        older_sem = Semester(
            academic_year_id=older.id, name="Semester 1", sequence=1,
            start_date=date(2024, 9, 1), end_date=date(2025, 1, 31), is_active=False,
        )
        db_session.add_all([older_sem])
        db_session.flush()
        old_cs = CourseOffering(
                course_id=graph.subject.id,
                semester_id=graph.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db_session.add(old_cs)
        db_session.flush()
        older_section = old_cs
        db_session.add(ClassEnrollment(
            offering_id=older_section.id, student_id=graph.student.id, semester_id=older_sem.id
        ))
        db_session.flush()
        graph.snapshot(cs=old_cs, semester=older_sem, numeric="75.00", letter="C")

        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="95")

        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        names = [y["academic_year"]["name"] for y in body["years"]]
        assert names.index(graph.year.name) < names.index(older.name)

    def test_archived_and_live_years_combine(self, client, graph, db_session) -> None:
        """The §10.6 union: frozen snapshots for the past, live compute for now."""
        older = AcademicYear(
            name=f"Older {graph.tag}", start_date=date(2024, 9, 1), end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED, archived_at=utcnow(),
        )
        db_session.add(older)
        db_session.flush()
        older_sem = Semester(
            academic_year_id=older.id, name="Semester 1", sequence=1,
            start_date=date(2024, 9, 1), end_date=date(2025, 1, 31), is_active=False,
        )
        db_session.add_all([older_sem])
        db_session.flush()
        # The SAME course, offered again in the older year's term — the thing the
        # year-scoped model could not express, and what makes this transcript test real.
        old_cs = CourseOffering(
            course_id=graph.subject.id,
            semester_id=older_sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db_session.add(old_cs)
        db_session.flush()
        db_session.add(ClassEnrollment(
            offering_id=old_cs.id, student_id=graph.student.id, semester_id=older_sem.id
        ))
        db_session.flush()
        graph.snapshot(cs=old_cs, semester=older_sem, numeric="60.00", letter="D")

        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="80")

        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        by_year = {y["academic_year"]["name"]: y for y in body["years"]}
        assert by_year[older.name]["year_average"] == 60.0  # frozen
        assert by_year[graph.year.name]["year_average"] == 80.0  # live
        assert body["cumulative_average"] == 70.0

    def test_student_with_no_enrollments_gets_an_empty_transcript(self, client, graph, db_session) -> None:
        loner = StudentProfile(
            student_number=f"L-{graph.tag}", **split_name("No Classes"),
            date_of_birth=date(2012, 1, 1), enrollment_date=date(2025, 9, 1), status="Registered",
        )
        db_session.add(loner)
        db_session.flush()
        body = client.get(f"{R}/transcript?student_id={loner.id}", headers=graph.P).json()
        assert body["years"] == []
        assert body["cumulative_average"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestOfferingGrades:
    def test_shape(self, client, graph) -> None:
        body = client.get(f"{R}/offering-grades?offering_id={graph.cs.id}", headers=graph.P).json()
        assert set(body.keys()) == {
            "offering", "semester", "students", "class_average", "distribution"
        }
        assert body["offering"]["id"] == str(graph.cs.id)
        assert body["offering"]["course"]["name"] == graph.subject.name
        # The label is DERIVED (D31) — there is no stored section name to echo.
        assert body["offering"]["label"] == offering_label(
            graph.subject.code, graph.cs.section_code
        )

    def test_unknown_offering_404(self, client, graph) -> None:
        r = client.get(f"{R}/offering-grades?offering_id={uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404

    def test_missing_param_422(self, client, graph) -> None:
        assert client.get(f"{R}/offering-grades", headers=graph.P).status_code == 422

    def test_rows_and_class_average(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        peer, peer_enr = graph.add_student(name="Bob Peer")
        graph.grade(a, graph.student, graph.enrollment, score="90")
        graph.grade(a, peer, peer_enr, score="70")
        body = client.get(f"{R}/offering-grades?offering_id={graph.cs.id}", headers=graph.P).json()
        rows = {r["student"]["full_name"]: r["numeric"] for r in body["students"]}
        assert rows["Ana Lopez"] == 90.0
        assert rows["Bob Peer"] == 70.0
        assert body["class_average"] == 80.0

    def test_students_sorted_by_surname(self, client, graph) -> None:
        """D30 §D10 / brief §11: ascending by SURNAME then given name — never by the
        combined display string.

        The distinction is the whole point of the rule, and these three names are
        chosen so the two orders disagree: by display string it would be
        Aaron First / Ana Lopez / Zed Last; by surname it is First / Last / Lopez.
        """
        graph.add_student(name="Zed Last")
        graph.add_student(name="Aaron First")
        rows = client.get(
            f"{R}/offering-grades?offering_id={graph.cs.id}", headers=graph.P
        ).json()["students"]
        names = [r["student"]["full_name"] for r in rows]

        assert names == ["Aaron First", "Zed Last", "Ana Lopez"]
        assert names != sorted(names)  # the old display-string order, explicitly not this

    def test_distribution_covers_every_band(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="95")
        body = client.get(f"{R}/offering-grades?offering_id={graph.cs.id}", headers=graph.P).json()
        dist = {d["letter"]: d["count"] for d in body["distribution"]}
        assert dist["A"] == 1
        # Zero-count bands are still listed so the chart axis is stable.
        assert dist["F"] == 0

    def test_ungraded_students_have_null_numeric(self, client, graph) -> None:
        body = client.get(f"{R}/offering-grades?offering_id={graph.cs.id}", headers=graph.P).json()
        assert body["students"][0]["numeric"] is None
        assert body["class_average"] is None

    def test_teacher_may_read(self, client, graph) -> None:
        assert client.get(f"{R}/offering-grades?offering_id={graph.cs.id}", headers=graph.T).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestAttendanceReport:
    def test_shape_uses_the_offering_key(self, client, graph) -> None:
        """The section ref is serialized under `class`, matching the mock."""
        body = client.get(f"{R}/attendance?section_id={graph.section.id}", headers=graph.P).json()
        assert set(body.keys()) == {"offering", "semester", "summary"}
        assert body["offering"]["id"] == str(graph.section.id)
        # The homeroom's `grade_level` is gone; an offering identifies itself by its
        # course and derived label.
        assert body["offering"]["label"] == offering_label(
            graph.subject.code, graph.section.section_code
        )

    def test_summary_includes_present_and_counts_late_as_present(self, client, graph) -> None:
        graph.attendance(graph.student, graph.enrollment, status="present")
        graph.attendance(graph.student, graph.enrollment, status="late", on=date(2025, 10, 16))
        graph.attendance(graph.student, graph.enrollment, status="absent", on=date(2025, 10, 17))
        summary = client.get(f"{R}/attendance?section_id={graph.section.id}", headers=graph.P).json()["summary"]
        assert set(summary.keys()) == {"present", "absent", "late", "excused", "pct_present"}
        assert summary["present"] == 1
        assert summary["pct_present"] == 66.7

    def test_unknown_section_404(self, client, graph) -> None:
        r = client.get(f"{R}/attendance?section_id={uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404

    def test_missing_param_422(self, client, graph) -> None:
        assert client.get(f"{R}/attendance", headers=graph.P).status_code == 422

    def test_no_records_yields_zeroes(self, client, graph) -> None:
        summary = client.get(f"{R}/attendance?section_id={graph.section.id}", headers=graph.P).json()["summary"]
        assert summary["pct_present"] == 0.0
        assert summary["present"] == 0


# ════════════════════════════════════════════════════════════════════════════
class TestEnrollmentReport:
    def test_shape(self, client, graph) -> None:
        body = client.get(f"{R}/enrollment", headers=graph.P).json()
        assert set(body.keys()) == {"totals", "by_programme", "by_offering"}
        assert set(body["totals"].keys()) == {"students", "offerings"}

    def test_by_offering_carries_capacity_and_headcount(self, client, graph) -> None:
        graph.add_student()
        row = next(
            c for c in client.get(f"{R}/enrollment", headers=graph.P).json()["by_offering"]
            if c["offering"]["id"] == str(graph.section.id)
        )
        assert set(row.keys()) == {"offering", "enrolled", "capacity"}
        assert row["capacity"] == 30
        assert row["enrolled"] == 2  # Ana + the new one

    def test_by_programme_aggregates(self, client, graph) -> None:
        """D31 replaced the by-FORM breakdown — `classes.grade_level` is gone and a
        junior college has no Form axis. Students with no programme are reported as one
        "Not assigned" row rather than dropped, which is where this graph's students sit
        until the Phase 5 seed lands."""
        graph.add_student()
        rows = {
            g["programme"]: g["count"]
            for g in client.get(f"{R}/enrollment", headers=graph.P).json()["by_programme"]
        }
        assert rows.get("Not assigned", 0) >= 2

    def test_archived_offerings_excluded(self, client, graph, db_session) -> None:
        graph.section.is_archived = True
        db_session.flush()
        ids = {
            c["offering"]["id"]
            for c in client.get(f"{R}/enrollment", headers=graph.P).json()["by_offering"]
        }
        assert str(graph.section.id) not in ids

    def test_by_programme_is_busiest_first(self, client, graph) -> None:
        """Ordered by headcount descending (then code), matching the dashboard tile —
        not alphabetically, which is what the by-Form version asserted."""
        counts = [
            g["count"]
            for g in client.get(f"{R}/enrollment", headers=graph.P).json()["by_programme"]
        ]
        assert counts == sorted(counts, reverse=True)

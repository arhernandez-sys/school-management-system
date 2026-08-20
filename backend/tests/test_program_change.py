"""Suite for PROGRAMME CHANGE and DERIVED ACADEMIC HISTORY (D30 §D12, brief §12/§27).

The load-bearing behaviours pinned here:

  * **A programme change NEVER destroys history.** `student_program_history` keeps every
    registration, and the database allows only one OPEN row per student — `open_flag` is
    generated as `IF(ended_at IS NULL, 1, NULL)` under `uq_student_program_open`. The
    service closes before it opens; the reverse order trips the index, and there is a test
    that goes round the API to prove the index is real.
  * **Dean only** (§D14). The Registrar owns the student record and admits students, but
    moving one between programmes re-derives their degree plan.
  * **Academic history is DERIVED, never stored.** Every figure is recomputed from
    `class_enrollments` + `term_grade_snapshots` + approved `credit_transfer_requests` +
    `program_courses`, so a corrected grade shows immediately.
  * **A change re-derives against the NEW curriculum** and does not assume everything
    carries over: a course the old programme required and the new one does not stops
    counting toward the award, while the grade itself is untouched.
  * **The pass mark is per PROGRAMME** (§D5), so the SAME grade can be `completed` on one
    programme and `failed` on another. That is the sharpest test in the file.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.core.timeutil import school_today
from app.modules.admissions.models import CreditTransferRequest
from app.modules.assessments.models import Assessment
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.grades.models import AssessmentGrade
from app.modules.programs.models import Program, ProgramCourse
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile, StudentProgramHistory
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

S = "/api/v1/students"

#: The BAJC 8-band scale with grade points, so `meets_grade_point` runs its REAL arm
#: rather than the lenient `is_passing` fallback. `(letter, min, max, is_passing, gp)`.
_BAJC_BANDS = [
    ("A", "95.00", "100.00", True, "4.00"),
    ("A-", "90.00", "94.00", True, "3.75"),
    ("B+", "85.00", "89.00", True, "3.50"),
    ("B", "80.00", "84.00", True, "3.00"),
    ("C+", "75.00", "79.00", True, "2.50"),
    ("C", "70.00", "74.00", True, "2.00"),
    ("D", "65.00", "69.00", False, "1.00"),
    ("F", "0.00", "64.00", False, "0.00"),
]


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """A student on programme A, a programme B to move to, and a live year to grade in.

    Two programmes share a course and each has one of its own, which is what makes the
    "does it carry over?" assertions meaningful.
    """

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year,
                 make_grading_scale):
        archive_seeded_active_year()
        self.tag = uuid.uuid4().hex[:8]
        self._db = db_session

        self.dean_user = make_user(role=Role.PRINCIPAL, full_name="The Dean")
        self.registrar_user = make_user(role=Role.SECRETARY, full_name="The Registrar")
        self.lecturer_user = make_user(role=Role.TEACHER, full_name="A Lecturer")
        self.P = auth_headers(user_id=self.dean_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.registrar_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.lecturer_user.id, role=Role.TEACHER)

        self.year = AcademicYear(
            name=f"PCYear {self.tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        make_grading_scale(self.year.id, pass_mark="70.00", bands=_BAJC_BANDS)

        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        db_session.add_all([self.sem])

        # `shared` is required by BOTH programmes; `only_a` by A alone, `only_b` by B alone.
        self.shared = Course(name=f"Shared {self.tag}", code=f"SH{self.tag[:4].upper()}", credits=3)
        self.only_a = Course(name=f"OnlyA {self.tag}", code=f"OA{self.tag[:4].upper()}", credits=4)
        self.only_b = Course(name=f"OnlyB {self.tag}", code=f"OB{self.tag[:4].upper()}", credits=6)
        # Required by Programme B and NEVER OFFERED in this year. That is what makes a
        # curriculum course read as `remaining`: the graph enrols the student in every
        # offering it creates, so a course with no offering is the only one left unsat.
        self.unoffered = Course(
            name=f"Unoffered {self.tag}", code=f"UN{self.tag[:4].upper()}", credits=2
        )
        db_session.add_all([self.shared, self.only_a, self.only_b, self.unoffered])

        # A passes at C+ (2.50) like most BAJC programmes; B at C (2.00) like Primary
        # Education. The difference is what the per-programme pass-mark test turns on.
        self.program_a = Program(
            code=f"PA{self.tag[:4].upper()}", name=f"Programme A {self.tag}",
            total_credits=7, min_passing_grade_point=Decimal("2.50"),
        )
        self.program_b = Program(
            code=f"PB{self.tag[:4].upper()}", name=f"Programme B {self.tag}",
            total_credits=11, min_passing_grade_point=Decimal("2.00"),
        )
        db_session.add_all([self.program_a, self.program_b])
        db_session.flush()

        for program, own in ((self.program_a, self.only_a), (self.program_b, self.only_b)):
            db_session.add_all([
                ProgramCourse(
                    program_id=program.id, course_id=self.shared.id,
                    term_label="Semester 1", term_order=1, is_required=True,
                ),
                ProgramCourse(
                    program_id=program.id, course_id=own.id,
                    term_label="Semester 2", term_order=2, is_required=True,
                ),
            ])
        db_session.add(
            ProgramCourse(
                program_id=self.program_b.id, course_id=self.unoffered.id,
                term_label="Semester 3", term_order=3, is_required=True,
            )
        )

        self.teacher = TeacherProfile(
            user_id=self.lecturer_user.id, staff_number=f"PT-{self.tag}",
            full_name="A Lecturer", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()

        self.offerings: dict[uuid.UUID, CourseOffering] = {}
        for course in (self.shared, self.only_a, self.only_b):
            cs = CourseOffering(
                course_id=course.id,
                semester_id=self.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
            db_session.add(cs)
            db_session.flush()
            db_session.add(
                ClassTeacher(offering_id=cs.id, teacher_id=self.teacher.id, is_lead=True)
            )
            self.offerings[course.id] = cs

        self.student = StudentProfile(
            student_number=f"PC-{self.tag}",
            **split_name("Ana Lopez"),
            date_of_birth=date(2004, 3, 4),
            enrollment_date=date(2025, 9, 1),
            status="active",
            program_id=self.program_a.id,
            year_of_study="First",
        )
        db_session.add(self.student)
        db_session.flush()
        # ONE ENROLMENT PER OFFERING (D31). This used to be a single row pointing at the
        # homeroom, which enrolled the student in everything that homeroom taught at once
        # — which is why the assertions below expect all three courses in progress. An
        # offering teaches one course, so covering the same load takes three rows.
        self.enrollments = {
            course.id: ClassEnrollment(
                offering_id=offering.id,
                student_id=self.student.id,
                semester_id=self.sem.id,
            )
            for course, offering in (
                (c, self.offerings[c.id]) for c in (self.shared, self.only_a, self.only_b)
            )
        }
        db_session.add_all(list(self.enrollments.values()))
        #: The shared course's enrolment — the one both programmes require, so it is the
        #: row that must survive a programme change.
        self.enrollment = self.enrollments[self.shared.id]
        # Registered on A from the start, the way acceptance would have left it.
        db_session.add(
            StudentProgramHistory(
                student_id=self.student.id, program_id=self.program_a.id,
                started_at=date(2025, 9, 1), reason="Admitted",
            )
        )
        db_session.flush()

    def grade(self, course: Course, score: str) -> None:
        """Give the student a released, graded result in `course`."""
        assessment = Assessment(
            offering_id=self.offerings[course.id].id,
            semester_id=self.sem.id,
            title=f"Final {course.code}",
            type="exam",
            max_score=Decimal("100"),
            weight=Decimal("1"),
            status="graded",
            is_released=True,
        )
        self._db.add(assessment)
        self._db.flush()
        self._db.add(
            AssessmentGrade(
                assessment_id=assessment.id,
                student_id=self.student.id,
                enrollment_id=self.enrollment.id,
                status="graded",
                score=Decimal(score),
            )
        )
        self._db.flush()


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale):
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


def _history(client, graph, headers=None):
    r = client.get(f"{S}/{graph.student.id}/academic-history", headers=headers or graph.S)
    assert r.status_code == 200, r.text
    return r.json()


def _by_code(history: dict) -> dict[str, dict]:
    return {row["code"]: row for row in history["courses"]}


# ════════════════════════════════════════════════════════════════════════════
class TestProgrammeChangeAuthz:
    def test_the_dean_may_change_a_programme(self, client, graph) -> None:
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id), "reason": "Student request."},
        )
        assert r.status_code == 200, r.text
        assert r.json()["program"]["code"] == graph.program_b.code

    def test_the_REGISTRAR_may_not(self, client, graph) -> None:
        """**The permission split confirmed with the client.** The Registrar owns the
        student record and admits students — but moving one between programmes re-derives
        their degree plan and rules on what carries over, which is academic authority
        (§D14). Assigning AT admission goes through the Registrar's accept flow instead.
        """
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.S,
            json={"program_id": str(graph.program_b.id)},
        )
        assert r.status_code == 403

    def test_a_lecturer_may_not(self, client, graph) -> None:
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.T,
            json={"program_id": str(graph.program_b.id)},
        )
        assert r.status_code == 403

    def test_an_unknown_programme_is_404(self, client, graph) -> None:
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(uuid.uuid4())},
        )
        assert r.status_code == 404
        _assert_envelope(r.json(), code="program_not_found")

    def test_an_unknown_student_is_404(self, client, graph) -> None:
        r = client.put(
            f"{S}/{uuid.uuid4()}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        assert r.status_code == 404

    def test_the_same_programme_is_409_not_a_silent_noop(self, client, graph) -> None:
        """A Dean who meant to change something wants to know they did not — and another
        history row for the same programme would read as a change that never happened."""
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_a.id)},
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="program_unchanged")


# ════════════════════════════════════════════════════════════════════════════
class TestHistoryIsNeverDestroyed:
    def test_the_old_registration_is_CLOSED_not_deleted(self, client, graph, db_session) -> None:
        """§D12's whole point. Overwriting `program_id` alone would lose the fact that the
        student read Programme A — which a transcript and a credits-earned figure depend
        on."""
        body = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id), "reason": "Changed major."},
        ).json()

        history = body["history"]
        assert len(history) == 2
        old = next(h for h in history if h["program"]["code"] == graph.program_a.code)
        new = next(h for h in history if h["program"]["code"] == graph.program_b.code)
        assert old["ended_at"] is not None and old["is_current"] is False
        assert new["ended_at"] is None and new["is_current"] is True
        assert new["reason"] == "Changed major."

    def test_the_periods_are_contiguous_with_no_overlap(self, client, graph) -> None:
        """The old row is closed the day BEFORE the new one opens, so the two never
        overlap and never leave a gap."""
        effective = date(2026, 3, 1)
        body = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={
                "program_id": str(graph.program_b.id),
                "effective_from": effective.isoformat(),
            },
        ).json()
        old = next(h for h in body["history"] if h["ended_at"] is not None)
        new = next(h for h in body["history"] if h["ended_at"] is None)
        assert new["started_at"] == effective.isoformat()
        assert old["ended_at"] == (effective - timedelta(days=1)).isoformat()

    def test_three_programmes_leave_three_rows_and_one_open(
        self, client, graph, db_session
    ) -> None:
        """The invariant has to survive repeated changes, not just the first."""
        program_c = Program(
            code=f"PC{graph.tag[:4].upper()}", name=f"Programme C {graph.tag}", total_credits=5
        )
        db_session.add(program_c)
        db_session.flush()

        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        body = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(program_c.id)},
        ).json()
        assert len(body["history"]) == 3
        assert sum(1 for h in body["history"] if h["is_current"]) == 1
        assert body["program"]["code"] == program_c.code

    def test_the_database_allows_only_ONE_open_row(self, client, graph, db_session) -> None:
        """`uq_student_program_open (student_id, open_flag)` over the generated
        `open_flag = IF(ended_at IS NULL, 1, NULL)`.

        This is why the service closes BEFORE it opens rather than the other way round. The
        index is asserted by going round the API entirely, because it is what makes the
        ordering a correctness requirement instead of a style preference.
        """
        from sqlalchemy.exc import IntegrityError

        with pytest.raises(IntegrityError):
            db_session.add(
                StudentProgramHistory(
                    student_id=graph.student.id,
                    program_id=graph.program_b.id,
                    started_at=date(2026, 1, 1),
                )
            )
            db_session.flush()
        db_session.rollback()

    def test_closing_before_the_start_is_422(self, client, graph) -> None:
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id), "effective_from": "2025-01-01"},
        )
        assert r.status_code == 422
        assert "effective_from" in r.json()["error"]["fields"]

    def test_a_same_day_change_is_allowed(self, client, graph) -> None:
        """A correction on the day the student started: `ck_student_program_dates` permits
        `ended_at == started_at`, which is what that produces."""
        r = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id), "effective_from": "2025-09-01"},
        )
        assert r.status_code == 200, r.text
        old = next(h for h in r.json()["history"] if h["ended_at"] is not None)
        assert old["ended_at"] == "2025-09-01"

    def test_year_and_load_may_change_with_the_programme(self, client, graph) -> None:
        """A programme change is often a year/load change too, and a second PATCH would
        leave a window where the record disagrees with itself."""
        body = client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={
                "program_id": str(graph.program_b.id),
                "year_of_study": "Second",
                "enrollment_load": "Part Time",
            },
        ).json()
        assert body["year_of_study"] == "Second"
        assert body["enrollment_load"] == "Part Time"


# ════════════════════════════════════════════════════════════════════════════
class TestDerivedAcademicHistory:
    def test_an_untouched_student_owes_the_whole_curriculum(self, client, graph) -> None:
        history = _history(client, graph)
        assert history["program"]["code"] == graph.program_a.code
        # `shared` (3) + `only_a` (4) = 7 required credits; nothing earned.
        assert history["curriculum_required_credits"] == 7
        assert history["credits_earned"] == 0
        assert history["credits_remaining"] == 7
        # 0.00, NOT None — the student is enrolled in three offerings with nothing marked,
        # so credits DID participate and earned no quality points. That is the Phase 3
        # rule (`test_gpa_calc.test_all_ungraded_is_zero_not_none`) surfacing here; `None`
        # is reserved for a student with no enrolled credits at all.
        assert history["gpa"] == 0.0
        assert history["gpa_total_credits"] == 13

    def test_enrolment_is_what_separates_in_progress_from_remaining(
        self, client, graph
    ) -> None:
        """Not "has a grade" — being SAT is the distinction.

        The student is enrolled in the whole section, so every course with an offering
        there is `in_progress` even before anything is marked. `unoffered` is required by
        Programme B, has no offering, and is the only thing that can read `remaining`.
        This is the assertion that caught the author's own wrong expectation.
        """
        history = _history(client, graph)
        rows = _by_code(history)
        assert rows[graph.shared.code]["status"] == "in_progress"
        assert rows[graph.only_a.code]["status"] == "in_progress"
        # Sat but not in Programme A's plan — still in_progress, just not required.
        assert rows[graph.only_b.code]["status"] == "in_progress"
        assert rows[graph.only_b.code]["in_curriculum"] is False
        assert history["counts"]["in_progress"] == 3
        # Programme A does not list `unoffered`, so it does not appear at all.
        assert graph.unoffered.code not in rows
        assert history["counts"]["remaining"] == 0

    def test_a_pass_becomes_completed_and_earns_its_credits(self, client, graph) -> None:
        graph.grade(graph.shared, "82")  # B -> 3.00, clears A's 2.50
        history = _history(client, graph)
        row = _by_code(history)[graph.shared.code]
        assert row["status"] == "completed"
        assert row["letter"] == "B"
        assert row["grade_point"] == 3.0
        assert history["credits_earned"] == 3
        assert history["credits_remaining"] == 4

    def test_a_fail_is_reported_and_still_owes_the_credits(self, client, graph) -> None:
        graph.grade(graph.shared, "50")  # F
        history = _history(client, graph)
        row = _by_code(history)[graph.shared.code]
        assert row["status"] == "failed"
        assert row["letter"] == "F"
        assert history["credits_earned"] == 0
        assert history["credits_remaining"] == 7

    def test_an_enrolled_ungraded_course_is_in_progress(self, client, graph, db_session) -> None:
        """Enrolled with nothing marked: not remaining (they are sitting it) and not
        completed."""
        assessment = Assessment(
            offering_id=graph.offerings[graph.shared.id].id,
            semester_id=graph.sem.id, title="Pending", type="quiz",
            max_score=Decimal("100"), weight=Decimal("1"), status="published",
        )
        db_session.add(assessment)
        db_session.flush()
        history = _history(client, graph)
        assert _by_code(history)[graph.shared.code]["status"] == "in_progress"
        assert history["counts"]["in_progress"] == 3  # all three offerings, none graded

    def test_the_gpa_comes_from_the_ONE_implementation(self, client, graph) -> None:
        """`calc.compute_gpa`, weighted over every ENROLLED credit (decision #4) — the same
        function the report card, transcript and dashboard use.

        A (98 -> 4.00, 3cr) and a fail (50 -> 0.00, 4cr) over the three offerings the
        student sits, the third ungraded (6cr): 12.00 / 13 = 0.92.
        """
        graph.grade(graph.shared, "98")
        graph.grade(graph.only_a, "50")
        history = _history(client, graph)
        assert history["gpa_total_credits"] == 13
        assert history["gpa"] == 0.92

    def test_the_pass_mark_is_PER_PROGRAMME(self, client, graph, client_unused=None) -> None:
        """**The sharpest assertion in the file** (§D5).

        A C is worth 2.00. Programme A passes at 2.50 and Programme B at 2.00 — exactly as
        Primary Education differs from the other seven BAJC programmes. So the SAME grade
        is `failed` on A and `completed` on B, and the only thing that changed is which
        programme the student is on.
        """
        graph.grade(graph.shared, "72")  # C -> 2.00
        before = _by_code(_history(client, graph))[graph.shared.code]
        assert before["letter"] == "C"
        assert before["status"] == "failed"  # 2.00 < A's 2.50

        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        after = _by_code(_history(client, graph))[graph.shared.code]
        assert after["letter"] == "C"
        assert after["status"] == "completed"  # 2.00 >= B's 2.00

    def test_the_curriculum_position_is_reported(self, client, graph) -> None:
        """`term_label` is a PLAN position, never a dated term (§D3)."""
        rows = _by_code(_history(client, graph))
        assert rows[graph.shared.code]["term_label"] == "Semester 1"
        assert rows[graph.shared.code]["term_order"] == 1
        assert rows[graph.only_a.code]["term_label"] == "Semester 2"

    def test_courses_read_in_plan_order(self, client, graph) -> None:
        history = _history(client, graph)
        orders = [r["term_order"] for r in history["courses"] if r["term_order"] is not None]
        assert orders == sorted(orders)

    def test_the_registrar_may_read_it(self, client, graph) -> None:
        assert (
            client.get(
                f"{S}/{graph.student.id}/academic-history", headers=graph.S
            ).status_code
            == 200
        )

    def test_a_lecturer_may_not_read_it(self, client, graph) -> None:
        assert (
            client.get(
                f"{S}/{graph.student.id}/academic-history", headers=graph.T
            ).status_code
            == 403
        )

    def test_an_unknown_student_is_404(self, client, graph) -> None:
        assert (
            client.get(f"{S}/{uuid.uuid4()}/academic-history", headers=graph.S).status_code
            == 404
        )

    def test_a_student_on_no_programme_still_gets_an_answer(
        self, client, graph, db_session
    ) -> None:
        """Their results and GPA are real; the curriculum-derived buckets are simply empty
        rather than the endpoint failing."""
        graph.student.program_id = None
        db_session.flush()
        graph.grade(graph.shared, "98")
        history = _history(client, graph)
        assert history["program"] is None
        assert history["curriculum_required_credits"] == 0
        assert history["credits_remaining"] == 0
        assert history["gpa"] is not None


# ════════════════════════════════════════════════════════════════════════════
class TestChangeReDerivesAgainstTheNewProgramme:
    def test_a_course_the_new_programme_does_not_require_stops_counting(
        self, client, graph
    ) -> None:
        """**§D12: a change does NOT assume every previous course is transferable.**

        `only_a` is required by Programme A and not by B. After the move it still shows the
        grade the student earned — nothing is destroyed — but it is no longer in the
        curriculum and no longer counts toward the award.
        """
        graph.grade(graph.only_a, "98")  # A, 4 credits, required by A
        before = _history(client, graph)
        assert before["credits_earned"] == 4
        assert _by_code(before)[graph.only_a.code]["in_curriculum"] is True
        assert _by_code(before)[graph.only_a.code]["is_required"] is True

        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        after = _history(client, graph)
        row = _by_code(after)[graph.only_a.code]
        # The GRADE survives — this module never writes to enrolments or snapshots.
        assert row["letter"] == "A"
        assert row["status"] == "completed"
        # But it is not part of the new award.
        assert row["in_curriculum"] is False
        assert row["is_required"] is False
        # B requires shared (3) + only_b (6) + unoffered (2) = 11, none of it earned.
        assert after["curriculum_required_credits"] == 11
        assert after["credits_remaining"] == 11

    def test_a_shared_course_DOES_carry_over(self, client, graph) -> None:
        """The other side of the same rule: work the new programme also requires counts."""
        graph.grade(graph.shared, "98")  # A, 3 credits, required by BOTH
        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        after = _history(client, graph)
        assert _by_code(after)[graph.shared.code]["in_curriculum"] is True
        assert after["credits_earned"] == 3
        assert after["credits_remaining"] == 8  # only_b (6) + unoffered (2)

    def test_the_new_programmes_courses_appear(self, client, graph) -> None:
        """`only_b` is offered and sat, so it becomes a required in-progress course.
        `unoffered` is required by B with no offering anywhere — the `remaining` case."""
        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        rows = _by_code(_history(client, graph))
        assert rows[graph.only_b.code]["in_curriculum"] is True
        assert rows[graph.only_b.code]["is_required"] is True
        assert rows[graph.only_b.code]["status"] == "in_progress"
        assert rows[graph.unoffered.code]["status"] == "remaining"
        assert rows[graph.unoffered.code]["in_curriculum"] is True

    def test_the_history_is_returned_with_the_derivation(self, client, graph) -> None:
        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id), "reason": "Moved."},
        )
        history = _history(client, graph)
        assert len(history["program_history"]) == 2
        assert [h["program"]["code"] for h in history["program_history"]] == [
            graph.program_a.code,
            graph.program_b.code,
        ]


# ════════════════════════════════════════════════════════════════════════════
class TestTransferredCredit:
    def _grant(self, client, graph, db_session, course: Course) -> None:
        """Give the student an approved transfer for `course`, through the real endpoints."""
        app_id = client.post(
            "/api/v1/applications",
            headers=graph.S,
            json={
                "first_name": "Ana",
                "last_name": f"Lopez{graph.tag}",
                "date_of_birth": "2004-03-04",
                "email": f"ana.{graph.tag}@example.bz",
                "program_id": str(graph.program_a.id),
                "year_of_study": "First",
                "enrollment_load": "Full Time",
                "applicant_signed_at": "2026-08-01",
                "submit": True,
            },
        ).json()["id"]
        client.put(
            f"/api/v1/applications/{app_id}/education",
            headers=graph.S,
            json={"items": [{"institution": "University of Belize", "education_level": "Tertiary"}]},
        )
        transfer_id = client.post(
            f"/api/v1/applications/{app_id}/credit-transfers",
            headers=graph.S,
            json={
                "external_institution": "University of Belize",
                "external_course_name": "Prior Study",
                "target_course_id": str(course.id),
            },
        ).json()["id"]
        client.post(
            f"/api/v1/credit-transfers/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 90},
        )
        # Link the existing student to that application, which is what acceptance does.
        graph.student.application_id = uuid.UUID(app_id)
        db_session.flush()

    def test_a_transferred_course_earns_credit(self, client, graph, db_session) -> None:
        self._grant(client, graph, db_session, graph.only_a)
        history = _history(client, graph)
        row = _by_code(history)[graph.only_a.code]
        assert row["status"] == "transferred"
        assert history["credits_earned"] == 4
        assert history["credits_remaining"] == 3  # shared still owed

    def test_a_transferred_course_is_EXCLUDED_from_the_gpa(
        self, client, graph, db_session
    ) -> None:
        """A transfer grants CREDIT, not a grade point. Scoring it 0 would punish the
        student for transferring; scoring it 4.00 would invent a grade nobody at BAJC
        awarded. So it counts toward the award and not toward the GPA — which is also
        standard practice."""
        self._grant(client, graph, db_session, graph.only_a)
        graph.grade(graph.shared, "98")  # A, 3 credits
        history = _history(client, graph)
        row = _by_code(history)[graph.only_a.code]
        assert row["grade_point"] is None
        assert row["letter"] is None
        # The denominator is `shared` (3, graded A) + `only_b` (6, sat and unmarked) = 9.
        # `only_a` is transferred, so its 4 credits are excluded from the GPA entirely —
        # while still counting toward the award below.
        assert history["gpa_total_credits"] == 9
        assert history["credits_earned"] == 7  # 3 passed + 4 transferred

    def test_a_transfer_is_not_revoked_by_a_programme_change(
        self, client, graph, db_session
    ) -> None:
        """**Found while walking the Phase 4 gate.** The credits the student HOLDS and the
        credits that count toward THIS award are different numbers, and a programme change
        moves only the second.

        The walk first asserted "credits_remaining changed", which passed by accident: ITEC
        needed 90 with 3 transferred (87 owed) and BMAD needs 87 with the transfer no longer
        counting — the two remainders coincided at 87. The real rule is that the transfer is
        not revoked, it simply stops counting, and that is what this pins.
        """
        self._grant(client, graph, db_session, graph.only_a)  # required by A, not by B
        before = _history(client, graph)
        assert before["credits_earned"] == 4
        assert before["credits_remaining"] == 3  # A needs 7, 4 transferred

        client.put(
            f"{S}/{graph.student.id}/program",
            headers=graph.P,
            json={"program_id": str(graph.program_b.id)},
        )
        after = _history(client, graph)
        # The transfer still stands: the row is there, the credits are still held.
        assert _by_code(after)[graph.only_a.code]["status"] == "transferred"
        assert after["credits_earned"] == 4
        # But nothing is credited toward the NEW award, so what is owed is its full
        # requirement — 11 credits, not 11 minus the 4 that no longer apply.
        assert after["curriculum_required_credits"] == 11
        assert after["credits_remaining"] == 11

    def test_transferred_beats_enrolled_when_both_are_true(
        self, client, graph, db_session
    ) -> None:
        """A student may be enrolled in a course they later transfer in. Transferred wins:
        it is the stronger statement, and reporting both would double-count the credits."""
        self._grant(client, graph, db_session, graph.shared)
        history = _history(client, graph)
        assert _by_code(history)[graph.shared.code]["status"] == "transferred"
        assert history["counts"]["transferred"] == 1

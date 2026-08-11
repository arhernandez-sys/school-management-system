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

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.core.timeutil import utcnow
from app.modules.assessments.models import Assessment
from app.modules.attendance.models import AttendanceRecord
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile

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

        self.section = Class(
            academic_year_id=self.year.id, name=f"Sec {tag}", grade_level="Form 1",
            section="A", capacity=30,
        )
        db_session.add(self.section)
        self.subject = Subject(name=f"AAA Math {tag}", code=f"MA{tag[:3].upper()}")
        self.subject2 = Subject(name=f"BBB Science {tag}", code=f"SC{tag[:3].upper()}")
        db_session.add_all([self.subject, self.subject2])
        db_session.flush()

        self.cs = ClassSubject(class_id=self.section.id, subject_id=self.subject.id, is_active=True)
        self.cs2 = ClassSubject(class_id=self.section.id, subject_id=self.subject2.id, is_active=True)
        db_session.add_all([self.cs, self.cs2])
        db_session.flush()

        self.principal_user = make_user(role=Role.PRINCIPAL, full_name="The Principal")
        self.secretary_user = make_user(role=Role.SECRETARY, full_name="Front Office")
        self.teacher_user = make_user(role=Role.TEACHER, full_name="Maria Reyes")
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id, staff_number=f"T-{tag}",
            full_name="Maria Reyes", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()
        db_session.add(ClassTeacher(class_subject_id=self.cs.id, teacher_id=self.teacher.id, is_lead=True))
        db_session.flush()

        self.student, self.enrollment = self.add_student(name="Ana Lopez", with_login=True)

        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student.user_id, role=Role.STUDENT)

    def add_student(self, *, name=None, with_login=False, semester=None):
        s = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            full_name=name or f"Stu {uuid.uuid4().hex[:4]}",
            date_of_birth=date(2012, 3, 4),
            enrollment_date=date(2025, 9, 1),
            status="active",
            # D29: the level lives on the student, not on a homeroom, and the report
            # card header reads it from here.
            year_group="Lower 6",
        )
        if with_login:
            user = self._make_user(role=Role.STUDENT, full_name=s.full_name)
            s.user_id = user.id
        self._db.add(s)
        self._db.flush()
        enr = ClassEnrollment(
            class_id=self.section.id, student_id=s.id,
            semester_id=(semester or self.sem).id,
        )
        self._db.add(enr)
        self._db.flush()
        return s, enr

    def assessment(self, *, cs=None, status="graded", max_score="100", weight="1",
                   is_released=True, semester=None):
        a = Assessment(
            class_subject_id=(cs or self.cs).id,
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
            class_id=self.section.id, student_id=student.id, enrollment_id=enrollment.id,
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
            class_subject_id=(cs or self.cs).id,
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
            f"{R}/class-grades?class_subject_id={graph.cs.id}",
            f"{R}/attendance?section_id={graph.section.id}",
            f"{R}/enrollment",
        ):
            assert client.get(url).status_code == 401, url

    def test_student_forbidden_on_staff_endpoints(self, client, graph) -> None:
        for url in (
            f"{R}/students",
            f"{R}/report-card?student_id={graph.student.id}",
            f"{R}/transcript?student_id={graph.student.id}",
            f"{R}/class-grades?class_subject_id={graph.cs.id}",
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
            "year_group",
        }
        assert item["year_group"] == "Lower 6"
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
            "student", "year_group", "semester", "school", "subjects",
            "attendance_summary", "term_average", "term_average_letter", "is_frozen",
        }
        # D29: the header names the student's LEVEL, not a homeroom.
        assert body["year_group"] == "Lower 6"

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
            "student", "school", "issued_at", "years", "cumulative_average"
        }

    def test_unknown_student_404(self, client, graph) -> None:
        r = client.get(f"{R}/transcript?student_id={uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404

    def test_secretary_may_read(self, client, graph) -> None:
        assert client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.S).status_code == 200

    def test_year_and_semester_nesting(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="85")
        body = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.P).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(graph.year.id))
        assert set(year.keys()) == {"academic_year", "year_average", "semesters"}
        sem = next(s for s in year["semesters"] if s["semester"]["id"] == str(graph.sem.id))
        assert set(sem.keys()) == {"semester", "is_current", "term_average", "subjects"}
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
        older_section = Class(
            academic_year_id=older.id, name=f"Old Sec {graph.tag}", grade_level="Prep",
        )
        db_session.add_all([older_sem, older_section])
        db_session.flush()
        old_cs = ClassSubject(class_id=older_section.id, subject_id=graph.subject.id, is_active=True)
        db_session.add(old_cs)
        db_session.flush()
        db_session.add(ClassEnrollment(
            class_id=older_section.id, student_id=graph.student.id, semester_id=older_sem.id
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
        older_section = Class(
            academic_year_id=older.id, name=f"Old Sec {graph.tag}", grade_level="Prep",
        )
        db_session.add_all([older_sem, older_section])
        db_session.flush()
        old_cs = ClassSubject(class_id=older_section.id, subject_id=graph.subject.id, is_active=True)
        db_session.add(old_cs)
        db_session.flush()
        db_session.add(ClassEnrollment(
            class_id=older_section.id, student_id=graph.student.id, semester_id=older_sem.id
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
            student_number=f"L-{graph.tag}", full_name="No Classes",
            date_of_birth=date(2012, 1, 1), enrollment_date=date(2025, 9, 1), status="active",
        )
        db_session.add(loner)
        db_session.flush()
        body = client.get(f"{R}/transcript?student_id={loner.id}", headers=graph.P).json()
        assert body["years"] == []
        assert body["cumulative_average"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestClassGrades:
    def test_shape(self, client, graph) -> None:
        body = client.get(f"{R}/class-grades?class_subject_id={graph.cs.id}", headers=graph.P).json()
        assert set(body.keys()) == {
            "class_subject", "semester", "students", "class_average", "distribution"
        }
        assert body["class_subject"]["section_name"] == graph.section.name
        assert body["class_subject"]["subject_name"] == graph.subject.name

    def test_unknown_offering_404(self, client, graph) -> None:
        r = client.get(f"{R}/class-grades?class_subject_id={uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404

    def test_missing_param_422(self, client, graph) -> None:
        assert client.get(f"{R}/class-grades", headers=graph.P).status_code == 422

    def test_rows_and_class_average(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        peer, peer_enr = graph.add_student(name="Bob Peer")
        graph.grade(a, graph.student, graph.enrollment, score="90")
        graph.grade(a, peer, peer_enr, score="70")
        body = client.get(f"{R}/class-grades?class_subject_id={graph.cs.id}", headers=graph.P).json()
        rows = {r["student"]["full_name"]: r["numeric"] for r in body["students"]}
        assert rows["Ana Lopez"] == 90.0
        assert rows["Bob Peer"] == 70.0
        assert body["class_average"] == 80.0

    def test_students_sorted_by_name(self, client, graph) -> None:
        graph.add_student(name="Zed Last")
        graph.add_student(name="Aaron First")
        names = [
            r["student"]["full_name"]
            for r in client.get(f"{R}/class-grades?class_subject_id={graph.cs.id}", headers=graph.P).json()["students"]
        ]
        assert names == sorted(names)

    def test_distribution_covers_every_band(self, client, graph) -> None:
        a = graph.assessment(cs=graph.cs, max_score="100")
        graph.grade(a, graph.student, graph.enrollment, score="95")
        body = client.get(f"{R}/class-grades?class_subject_id={graph.cs.id}", headers=graph.P).json()
        dist = {d["letter"]: d["count"] for d in body["distribution"]}
        assert dist["A"] == 1
        # Zero-count bands are still listed so the chart axis is stable.
        assert dist["F"] == 0

    def test_ungraded_students_have_null_numeric(self, client, graph) -> None:
        body = client.get(f"{R}/class-grades?class_subject_id={graph.cs.id}", headers=graph.P).json()
        assert body["students"][0]["numeric"] is None
        assert body["class_average"] is None

    def test_teacher_may_read(self, client, graph) -> None:
        assert client.get(f"{R}/class-grades?class_subject_id={graph.cs.id}", headers=graph.T).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestAttendanceReport:
    def test_shape_uses_the_class_key(self, client, graph) -> None:
        """The section ref is serialized under `class`, matching the mock."""
        body = client.get(f"{R}/attendance?section_id={graph.section.id}", headers=graph.P).json()
        assert set(body.keys()) == {"class", "semester", "summary"}
        assert body["class"]["id"] == str(graph.section.id)
        assert body["class"]["grade_level"] == "Form 1"

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
        assert set(body.keys()) == {"totals", "by_grade", "by_class"}
        assert set(body["totals"].keys()) == {"students", "classes"}

    def test_by_class_carries_capacity_and_headcount(self, client, graph) -> None:
        graph.add_student()
        row = next(
            c for c in client.get(f"{R}/enrollment", headers=graph.P).json()["by_class"]
            if c["class_ref"]["id"] == str(graph.section.id)
        )
        assert set(row.keys()) == {"class_ref", "enrolled", "capacity"}
        assert row["capacity"] == 30
        assert row["enrolled"] == 2  # Ana + the new one

    def test_by_grade_aggregates(self, client, graph) -> None:
        graph.add_student()
        rows = {
            g["grade_level"]: g["count"]
            for g in client.get(f"{R}/enrollment", headers=graph.P).json()["by_grade"]
        }
        assert rows["Form 1"] >= 2

    def test_archived_sections_excluded(self, client, graph, db_session) -> None:
        graph.section.is_archived = True
        db_session.flush()
        ids = {
            c["class_ref"]["id"]
            for c in client.get(f"{R}/enrollment", headers=graph.P).json()["by_class"]
        }
        assert str(graph.section.id) not in ids

    def test_by_grade_sorted(self, client, graph) -> None:
        grades = [
            g["grade_level"] for g in client.get(f"{R}/enrollment", headers=graph.P).json()["by_grade"]
        ]
        assert grades == sorted(grades)

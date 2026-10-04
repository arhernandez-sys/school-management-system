"""Suite for the ACADEMIC-YEAR ARCHIVAL FREEZE (schema §10.4, FR-SET-07).

This was `TODO(7.6/7.8)` in `settings/service.py` — the archive endpoint returned 202
while writing zero snapshots, the one place in the API that reported success for work
it had not done. Implemented 2026-07-28 in `app/modules/reports/freeze.py`.

Kept in its own file rather than bolted onto `test_settings.py`: the freeze spans
Settings (the trigger), Grades (the computation) and Reports (the payload), so it is
not really a settings concern.

Each test builds its own tiny year so the counts are exact, instead of depending on
how much graded data the shared seed happens to carry.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.assessments.models import Assessment
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.reports.models import ReportCardSnapshot
from app.modules.settings.models import AcademicYear, GradingScaleBand, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db


def _archive_path(year_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/academic-years/{year_id}/archive"


def _card_path(student_id, semester_id) -> str:  # noqa: ANN001
    return (
        f"/api/v1/reports/report-card?student_id={student_id}&semester_id={semester_id}"
    )


class _TinyYear:
    """One active year, one section, one graded+released assessment, one student."""

    def __init__(self, db_session, make_user, make_grading_scale, *, score="90"):
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db_session

        self.year = AcademicYear(
            name=f"FreezeYear {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        make_grading_scale(self.year.id)

        self.semester = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        self.subject = Course(name=f"FSubj {tag}", code=f"FZ{tag[:3].upper()}")
        db_session.add_all([self.semester, self.subject])
        db_session.flush()

        self.cs = CourseOffering(
                course_id=self.subject.id,
                semester_id=self.semester.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db_session.add(self.cs)
        db_session.flush()
        self.section = self.cs

        teacher_user = make_user(role=Role.TEACHER, full_name="Freeze Teacher")
        teacher = TeacherProfile(
            user_id=teacher_user.id, staff_number=f"FT-{tag}",
            full_name="Freeze Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(teacher)
        db_session.flush()
        db_session.add(
            ClassTeacher(offering_id=self.cs.id, teacher_id=teacher.id, is_lead=True)
        )

        self.student = StudentProfile(
            student_number=f"FS-{tag}", **split_name("Freeze Student"),
            date_of_birth=date(2012, 1, 1), enrollment_date=date(2025, 9, 1),
            status="Active",
        )
        db_session.add(self.student)
        db_session.flush()
        self.enrollment = ClassEnrollment(
            offering_id=self.section.id, student_id=self.student.id,
            semester_id=self.semester.id,
        )
        db_session.add(self.enrollment)
        db_session.flush()

        self.assessment = Assessment(
            offering_id=self.cs.id, semester_id=self.semester.id,
            title=f"Final {tag}", type="exam", max_score=Decimal("100"),
            weight=Decimal("1"), status="graded", is_released=True,
        )
        db_session.add(self.assessment)
        db_session.flush()
        db_session.add(AssessmentGrade(
            assessment_id=self.assessment.id, student_id=self.student.id,
            enrollment_id=self.enrollment.id, status="graded", score=Decimal(score),
        ))
        db_session.flush()


@pytest.fixture
def tiny(db_session, make_user, make_grading_scale, archive_seeded_active_year):
    """A writable tiny year. The seeded active year is archived first to free the
    one-active-year invariant."""
    archive_seeded_active_year()

    def _make(*, score="90") -> _TinyYear:
        return _TinyYear(db_session, make_user, make_grading_scale, score=score)

    return _make


@pytest.fixture
def principal_headers(make_user, auth_headers):
    user = make_user(role=Role.PRINCIPAL, full_name="Archiving Principal")
    return auth_headers(user_id=user.id, role=Role.PRINCIPAL)


# ════════════════════════════════════════════════════════════════════════════
class TestFreezeWrites:
    def test_writes_a_term_grade_snapshot(self, client, tiny, principal_headers, db_session) -> None:
        g = tiny(score="90")
        resp = client.post(_archive_path(g.year.id), headers=principal_headers)
        assert resp.status_code == 202, resp.text
        assert resp.json()["snapshots_written"] == 1

        snap = db_session.scalar(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.student_id == g.student.id,
                TermGradeSnapshot.semester_id == g.semester.id,
            )
        )
        assert snap is not None
        assert float(snap.numeric_grade) == 90.0
        assert snap.letter_grade == "A"
        assert snap.frozen_at is not None

    def test_freezes_the_subject_identity(self, client, tiny, principal_headers, db_session) -> None:
        """The frozen `subject_id` is the durable transcript grouping key (§10.6)."""
        g = tiny()
        client.post(_archive_path(g.year.id), headers=principal_headers)
        snap = db_session.scalar(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.semester_id == g.semester.id
            )
        )
        assert snap.subject_id == g.subject.id

    def test_captures_the_resolved_policy(self, client, tiny, principal_headers, db_session) -> None:
        """Stored so "why is this a 78?" is answerable after the live policy moves on."""
        g = tiny()
        client.post(_archive_path(g.year.id), headers=principal_headers)
        snap = db_session.scalar(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.semester_id == g.semester.id
            )
        )
        assert set(snap.effective_policy.keys()) == {
            "absent_as_zero", "allow_makeup", "drop_lowest_count"
        }

    def test_writes_a_report_card_snapshot(self, client, tiny, principal_headers, db_session) -> None:
        g = tiny(score="90")
        client.post(_archive_path(g.year.id), headers=principal_headers)
        card = db_session.scalar(
            select(ReportCardSnapshot).where(
                ReportCardSnapshot.student_id == g.student.id,
                ReportCardSnapshot.semester_id == g.semester.id,
            )
        )
        assert card is not None
        assert card.payload["term_average"] == 90.0
        assert card.payload["student"]["full_name"] == "Freeze Student"

    def test_stored_payload_reads_back_as_frozen(self, client, tiny, principal_headers, db_session) -> None:
        """The payload is computed live, so `is_frozen` is overridden on write."""
        g = tiny()
        client.post(_archive_path(g.year.id), headers=principal_headers)
        card = db_session.scalar(
            select(ReportCardSnapshot).where(
                ReportCardSnapshot.semester_id == g.semester.id
            )
        )
        assert card.payload["is_frozen"] is True

    def test_ungraded_subjects_are_not_frozen(self, client, tiny, principal_headers, db_session) -> None:
        """A subject with no resolvable grade has nothing to freeze."""
        g = tiny()
        empty = Course(name=f"Empty {g.tag}", code=f"EM{g.tag[:3].upper()}")
        db_session.add(empty)
        db_session.flush()
        db_session.add(
            CourseOffering(
                course_id=empty.id,
                semester_id=g.semester.id,
                section_code=uuid.uuid4().hex[:6],
            )
        )
        db_session.flush()

        resp = client.post(_archive_path(g.year.id), headers=principal_headers)
        assert resp.json()["snapshots_written"] == 1
        subject_ids = set(db_session.scalars(
            select(TermGradeSnapshot.subject_id).where(
                TermGradeSnapshot.semester_id == g.semester.id
            )
        ).all())
        assert subject_ids == {g.subject.id}

    def test_unenrolled_students_are_skipped(self, client, tiny, principal_headers, db_session) -> None:
        from app.core.timeutil import utcnow

        g = tiny()
        g.enrollment.unenrolled_at = utcnow()
        db_session.flush()
        resp = client.post(_archive_path(g.year.id), headers=principal_headers)
        assert resp.json()["snapshots_written"] == 0

    def test_year_with_no_semesters_writes_nothing(
        self, client, principal_headers, db_session, archive_seeded_active_year
    ) -> None:
        # Doesn't use the `tiny` fixture, so free the one-active-year invariant here.
        archive_seeded_active_year()
        year = AcademicYear(
            name=f"Empty {uuid.uuid4().hex[:6]}", start_date=date(2020, 9, 1),
            end_date=date(2021, 6, 30), status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(year)
        db_session.flush()
        resp = client.post(_archive_path(year.id), headers=principal_headers)
        assert resp.status_code == 202
        assert resp.json()["snapshots_written"] == 0


# ════════════════════════════════════════════════════════════════════════════
class TestFreezeGpaInputs:
    """D30 §D5 — the freeze captures the grade point and the credit weight, not just
    the letter. A GPA is only reproducible from both, so an issued report card must
    survive a later credit edit or a re-priced band."""

    def _price_the_bands(self, db_session, year_id) -> None:
        """Give the year's bands grade points (the fixture's scale ships NULLs)."""
        from app.modules.settings.models import GradingScale

        scale = db_session.scalar(
            select(GradingScale).where(GradingScale.academic_year_id == year_id)
        )
        points = {"A": "4.00", "B": "3.00", "C": "2.00", "D": "1.00", "F": "0.00"}
        for band in db_session.scalars(
            select(GradingScaleBand).where(GradingScaleBand.grading_scale_id == scale.id)
        ).all():
            band.grade_point = Decimal(points[band.letter])
        db_session.flush()

    def test_grade_point_credits_and_quality_points_are_frozen(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        g = tiny(score="90")  # 90 -> A on the fixture's scale
        self._price_the_bands(db_session, g.year.id)
        g.subject.credits = 4
        db_session.flush()

        assert client.post(_archive_path(g.year.id), headers=principal_headers).json()[
            "snapshots_written"
        ] == 1

        db_session.expire_all()
        snap = db_session.scalar(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.student_id == g.student.id,
                TermGradeSnapshot.semester_id == g.semester.id,
            )
        )
        assert snap.letter_grade == "A"
        assert float(snap.grade_point) == 4.00
        assert snap.credits == 4
        # 4.00 x 4 credits.
        assert float(snap.quality_points) == 16.00

    def test_an_unpriced_scale_freezes_null_not_zero(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        """A scale with no grade points cannot price the letter, and NULL says so.

        Freezing 0.00 instead would record an F the student never earned, and would then
        be indistinguishable from a real F forever — the freeze is the last chance to get
        this right.
        """
        g = tiny(score="90")
        assert client.post(_archive_path(g.year.id), headers=principal_headers).json()[
            "snapshots_written"
        ] == 1

        db_session.expire_all()
        snap = db_session.scalar(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.student_id == g.student.id,
                TermGradeSnapshot.semester_id == g.semester.id,
            )
        )
        assert snap.grade_point is None
        assert snap.quality_points is None
        # Credits are known regardless of whether the letter can be priced.
        assert snap.credits == 3

    def test_a_later_credit_edit_does_not_move_the_frozen_card(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        """The whole reason credits are frozen. Re-crediting a course from 3 to 9 after
        archival must leave the issued document reading 3."""
        g = tiny(score="90")
        self._price_the_bands(db_session, g.year.id)
        client.post(_archive_path(g.year.id), headers=principal_headers)

        g.subject.credits = 9
        db_session.flush()
        db_session.expire_all()

        body = client.get(
            _card_path(g.student.id, g.semester.id), headers=principal_headers
        ).json()
        assert body["is_frozen"] is True
        assert body["total_credits"] == 3
        assert [r["credits"] for r in body["subjects"]] == [3]


# ════════════════════════════════════════════════════════════════════════════
class TestFreezeOrdering:
    def test_freeze_runs_before_archived_at_is_set(self, client, tiny, principal_headers, db_session) -> None:
        """The ordering rule, asserted behaviourally.

        The report-card builder decides live-vs-frozen from `archived_at`. If the flag
        were set first, the freeze would read the snapshots it is meant to create and
        write nothing — so a non-zero count here IS the proof the order is right.
        """
        g = tiny(score="90")
        resp = client.post(_archive_path(g.year.id), headers=principal_headers)
        assert resp.json()["snapshots_written"] == 1

        db_session.expire_all()
        year = db_session.get(AcademicYear, g.year.id)
        assert year.archived_at is not None
        assert year.status == AcademicYearStatus.ARCHIVED

    def test_state_transitions_still_apply(self, client, tiny, principal_headers, db_session) -> None:
        from app.modules.settings.models import GradingScale

        g = tiny()
        client.post(_archive_path(g.year.id), headers=principal_headers)
        db_session.expire_all()

        scale = db_session.scalar(
            select(GradingScale).where(GradingScale.academic_year_id == g.year.id)
        )
        assert scale.is_frozen is True
        section = db_session.get(CourseOffering, g.section.id)
        assert section.is_archived is True
        active_semesters = db_session.scalar(
            select(func.count()).select_from(Semester).where(
                Semester.academic_year_id == g.year.id, Semester.is_active.is_(True)
            )
        )
        assert active_semesters == 0


# ════════════════════════════════════════════════════════════════════════════
class TestFreezeIdempotency:
    def test_a_stale_snapshot_is_corrected_not_duplicated(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        """Upsert on `uq_term_snapshot`, so a retried or partial batch reconciles.

        The endpoint 409s on a second archive, so the retry path is exercised by
        seeding a stale row first.
        """
        g = tiny(score="90")
        db_session.add(TermGradeSnapshot(
            student_id=g.student.id, offering_id=g.cs.id,
            semester_id=g.semester.id, subject_id=g.subject.id,
            numeric_grade=Decimal("11.00"), letter_grade="F", effective_policy={},
        ))
        db_session.flush()

        client.post(_archive_path(g.year.id), headers=principal_headers)
        db_session.expire_all()

        rows = list(db_session.scalars(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.student_id == g.student.id,
                TermGradeSnapshot.offering_id == g.cs.id,
                TermGradeSnapshot.semester_id == g.semester.id,
            )
        ).all())
        assert len(rows) == 1
        assert float(rows[0].numeric_grade) == 90.0
        assert rows[0].letter_grade == "A"

    def test_re_archive_409_and_snapshots_untouched(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        g = tiny()
        assert client.post(_archive_path(g.year.id), headers=principal_headers).status_code == 202
        second = client.post(_archive_path(g.year.id), headers=principal_headers)
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "year_already_archived"

        count = db_session.scalar(
            select(func.count()).select_from(TermGradeSnapshot).where(
                TermGradeSnapshot.semester_id == g.semester.id
            )
        )
        assert count == 1


# ════════════════════════════════════════════════════════════════════════════
class TestFrozenReadsAfterArchival:
    def test_report_card_reads_back_from_the_snapshot(
        self, client, tiny, principal_headers
    ) -> None:
        """The whole point: an archived year still renders after archival."""
        g = tiny(score="75")
        client.post(_archive_path(g.year.id), headers=principal_headers)

        body = client.get(_card_path(g.student.id, g.semester.id), headers=principal_headers).json()
        assert body["is_frozen"] is True
        row = next(s for s in body["subjects"] if s["subject"]["id"] == str(g.subject.id))
        assert row["numeric"] == 75.0
        assert row["letter"] == "C"

    def test_a_later_scale_edit_cannot_relabel_history(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        """The freeze guarantee — §10.4 covers the scale AND the policy."""
        g = tiny(score="75")
        client.post(_archive_path(g.year.id), headers=principal_headers)

        # Collapse every band floor to 0 — a live compute would now say "A".
        db_session.query(GradingScaleBand).update({"min_score": Decimal("0.00")})
        db_session.flush()

        body = client.get(_card_path(g.student.id, g.semester.id), headers=principal_headers).json()
        row = next(s for s in body["subjects"] if s["subject"]["id"] == str(g.subject.id))
        assert row["letter"] == "C"

    def test_a_later_grade_edit_cannot_move_a_frozen_figure(
        self, client, tiny, principal_headers, db_session
    ) -> None:
        g = tiny(score="75")
        client.post(_archive_path(g.year.id), headers=principal_headers)

        grade = db_session.scalar(
            select(AssessmentGrade).where(AssessmentGrade.assessment_id == g.assessment.id)
        )
        grade.score = Decimal("10")
        db_session.flush()

        body = client.get(_card_path(g.student.id, g.semester.id), headers=principal_headers).json()
        row = next(s for s in body["subjects"] if s["subject"]["id"] == str(g.subject.id))
        assert row["numeric"] == 75.0  # unchanged

    def test_transcript_reads_the_frozen_year(self, client, tiny, principal_headers) -> None:
        g = tiny(score="82")
        client.post(_archive_path(g.year.id), headers=principal_headers)

        body = client.get(
            f"/api/v1/reports/transcript?student_id={g.student.id}", headers=principal_headers
        ).json()
        year = next(y for y in body["years"] if y["academic_year"]["id"] == str(g.year.id))
        assert year["academic_year"]["status"] == "archived"
        assert year["year_average"] == 82.0
        row = year["semesters"][0]["subjects"][0]
        assert row["numeric"] == 82.0
        assert row["subject"]["id"] == str(g.subject.id)

    def test_grades_term_endpoint_reports_is_frozen(self, client, tiny, principal_headers) -> None:
        g = tiny(score="82")
        client.post(_archive_path(g.year.id), headers=principal_headers)

        body = client.get(
            f"/api/v1/grades/term?offering_id={g.cs.id}", headers=principal_headers
        ).json()
        item = next(i for i in body["items"] if i["student"]["id"] == str(g.student.id))
        assert item["is_frozen"] is True
        assert item["numeric"] == 82.0
        assert item["effective_policy"] is not None

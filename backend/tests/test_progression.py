"""Year-end progression: First -> Second -> Completed (`students.progression`).

BAJC's rule (11 Nov 2026): pass the year's Summer, Semester 1 and Semester 2 — judged
by the grading scale — to move on. Two years only: a Second-year who passes is
Completed. Anyone who does not pass repeats. It runs inside the year archive and is
undone by reactivating the year.

Each test builds its own three-term year so the outcomes are exact.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.common.enums import (
    AcademicYearStatus,
    EnrollmentStatus,
    ProgressionStanding,
    Role,
    StudentStatus,
    TermType,
    YearOfStudy,
)
from app.modules.assessments.models import Assessment
from app.modules.grades.models import AssessmentGrade
from app.modules.offerings.models import ClassEnrollment, Course, CourseOffering
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile, StudentYearRecord
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db


def _archive(year_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/academic-years/{year_id}/archive"


def _preview(year_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/academic-years/{year_id}/progression"


def _reactivate(year_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/academic-years/{year_id}/reactivate"


def _excuse_student(year_id, student_id) -> str:  # noqa: ANN001
    return (
        f"/api/v1/settings/academic-years/{year_id}/progression/students/{student_id}/excuse"
    )


def _excuse_enrollment(year_id, enrollment_id) -> str:  # noqa: ANN001
    return (
        f"/api/v1/settings/academic-years/{year_id}"
        f"/progression/enrollments/{enrollment_id}/excuse"
    )


class _Year:
    """A year with Summer, Semester 1 and Semester 2, one course offered in each."""

    def __init__(self, db, make_grading_scale) -> None:
        self.db = db
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self.year = AcademicYear(
            name=f"ProgYear {tag}",
            start_date=date(2025, 6, 1),
            end_date=date(2026, 5, 31),
            status=AcademicYearStatus.ACTIVE,
        )
        db.add(self.year)
        db.flush()
        make_grading_scale(self.year.id)

        spec = [
            ("Summer", TermType.SUMMER, date(2025, 6, 1), date(2025, 7, 31)),
            ("Semester 1", TermType.SEMESTER, date(2025, 8, 15), date(2025, 12, 15)),
            ("Semester 2", TermType.SEMESTER, date(2026, 1, 10), date(2026, 5, 31)),
        ]
        self.terms: list[Semester] = []
        self.offerings: list[CourseOffering] = []
        self.courses: list[Course] = []
        for i, (name, kind, start, end) in enumerate(spec, start=1):
            term = Semester(
                academic_year_id=self.year.id, name=name, term_type=kind, sequence=i,
                start_date=start, end_date=end, is_active=(i == 3),
            )
            course = Course(name=f"Prog {name} {tag}", code=f"PG{i}{tag[:3].upper()}")
            db.add_all([term, course])
            db.flush()
            off = CourseOffering(
                course_id=course.id, semester_id=term.id, section_code=uuid.uuid4().hex[:6]
            )
            db.add(off)
            db.flush()
            self.terms.append(term)
            self.courses.append(course)
            self.offerings.append(off)

    def student(
        self,
        *,
        year_of_study: YearOfStudy | None = YearOfStudy.FIRST,
        status: StudentStatus = StudentStatus.ACTIVE,
    ) -> StudentProfile:
        s = StudentProfile(
            student_number=f"PS-{uuid.uuid4().hex[:8]}",
            **split_name("Prog Student"),
            date_of_birth=date(2005, 1, 1),
            enrollment_date=date(2025, 6, 1),
            status=status,
            year_of_study=year_of_study,
        )
        self.db.add(s)
        self.db.flush()
        return s

    def sit(
        self,
        student: StudentProfile,
        term_index: int,
        score: str | None,
        *,
        how: EnrollmentStatus = EnrollmentStatus.REGISTERED,
    ) -> ClassEnrollment:
        """Enrol `student` in the term's offering and (optionally) grade them."""
        off = self.offerings[term_index]
        enr = ClassEnrollment(
            offering_id=off.id, student_id=student.id,
            semester_id=self.terms[term_index].id, enrollment_status=how,
        )
        self.db.add(enr)
        self.db.flush()
        if score is None:
            return enr
        a = Assessment(
            offering_id=off.id, semester_id=self.terms[term_index].id,
            title=f"Final {uuid.uuid4().hex[:4]}", max_score=Decimal("100"),
            weight=Decimal("1"), status="graded", is_released=True,
        )
        self.db.add(a)
        self.db.flush()
        self.db.add(
            AssessmentGrade(
                assessment_id=a.id, student_id=student.id, enrollment_id=enr.id,
                status="graded", score=Decimal(score),
            )
        )
        self.db.flush()
        return enr

    def pass_all(self, student: StudentProfile) -> None:
        for i in range(3):
            self.sit(student, i, "90")


@pytest.fixture
def year(db_session, make_grading_scale, archive_seeded_active_year):
    archive_seeded_active_year()
    return _Year(db_session, make_grading_scale)


@pytest.fixture
def principal(make_user, auth_headers):
    u = make_user(role=Role.PRINCIPAL, full_name="Progression Principal")
    return auth_headers(user_id=u.id, role=Role.PRINCIPAL)


def _record(db, student_id, year_id):  # noqa: ANN001
    return db.scalar(
        select(StudentYearRecord).where(
            StudentYearRecord.student_id == student_id,
            StudentYearRecord.academic_year_id == year_id,
        )
    )


def _outcome(client, headers, year_id, student_id) -> dict:  # noqa: ANN001
    body = client.get(_preview(year_id), headers=headers).json()
    return next(s for s in body["students"] if s["student_id"] == str(student_id))


class TestPreview:
    def test_passing_first_year_is_promoted(self, client, year, principal) -> None:
        s = year.student()
        year.pass_all(s)
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "promote"
        assert row["reasons"] == []

    def test_terms_listed_in_order(self, client, year, principal) -> None:
        body = client.get(_preview(year.year.id), headers=principal).json()
        assert body["terms"] == ["Summer", "Semester 1", "Semester 2"]

    def test_failed_course_repeats(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        year.sit(s, 1, "40")  # F
        year.sit(s, 2, "90")
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "repeat"
        assert any(year.courses[1].code in r for r in row["reasons"])

    def test_missing_summer_repeats(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 1, "90")
        year.sit(s, 2, "90")
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "repeat"
        assert "No courses taken in Summer." in row["reasons"]

    def test_ungraded_course_repeats(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        year.sit(s, 1, "90")
        year.sit(s, 2, None)
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "repeat"
        assert any("No final grade" in r for r in row["reasons"])

    def test_failed_status_outranks_a_passing_mark(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        year.sit(s, 1, "95", how=EnrollmentStatus.FAILED)
        year.sit(s, 2, "90")
        assert _outcome(client, principal, year.year.id, s.id)["outcome"] == "repeat"

    def test_audit_does_not_count_as_sitting_the_term(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 0, None, how=EnrollmentStatus.AUDIT)
        year.sit(s, 1, "90")
        year.sit(s, 2, "90")
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "repeat"
        assert "No courses taken in Summer." in row["reasons"]

    def test_second_year_passing_completes(self, client, year, principal) -> None:
        s = year.student(year_of_study=YearOfStudy.SECOND)
        year.pass_all(s)
        assert _outcome(client, principal, year.year.id, s.id)["outcome"] == "complete"

    def test_inactive_student_is_skipped(self, client, year, principal) -> None:
        s = year.student(status=StudentStatus.INACTIVE)
        year.pass_all(s)
        assert _outcome(client, principal, year.year.id, s.id)["outcome"] == "skip"

    def test_no_year_of_study_is_skipped(self, client, year, principal) -> None:
        s = year.student(year_of_study=None)
        year.pass_all(s)
        assert _outcome(client, principal, year.year.id, s.id)["outcome"] == "skip"

    def test_preview_writes_nothing(self, client, year, principal, db_session) -> None:
        s = year.student()
        year.pass_all(s)
        client.get(_preview(year.year.id), headers=principal)
        db_session.refresh(s)
        assert s.year_of_study == YearOfStudy.FIRST
        assert _record(db_session, s.id, year.year.id) is None

    def test_preview_is_principal_only(self, client, year, make_user, auth_headers) -> None:
        t = make_user(role=Role.TEACHER, full_name="Not Allowed")
        resp = client.get(
            _preview(year.year.id), headers=auth_headers(user_id=t.id, role=Role.TEACHER)
        )
        assert resp.status_code == 403


class TestArchiveApplies:
    def test_archive_promotes_and_stamps_year(self, client, year, principal, db_session) -> None:
        s = year.student()
        year.pass_all(s)
        resp = client.post(_archive(year.year.id), headers=principal)
        assert resp.status_code == 202, resp.text
        assert resp.json()["promoted"] == 1
        db_session.refresh(s)
        assert s.year_of_study == YearOfStudy.SECOND
        rec = _record(db_session, s.id, year.year.id)
        assert rec.year_of_study == YearOfStudy.FIRST  # the level held DURING the year
        assert rec.result == ProgressionStanding.PROMOTED

    def test_archive_completes_second_year(self, client, year, principal, db_session) -> None:
        s = year.student(year_of_study=YearOfStudy.SECOND)
        year.pass_all(s)
        resp = client.post(_archive(year.year.id), headers=principal)
        assert resp.json()["completed"] == 1
        db_session.refresh(s)
        assert s.status == StudentStatus.COMPLETED
        assert s.completion_date == year.year.end_date
        assert _record(db_session, s.id, year.year.id).result == ProgressionStanding.COMPLETED

    def test_archive_keeps_a_repeater_in_first(self, client, year, principal, db_session) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        year.sit(s, 1, "40")
        year.sit(s, 2, "90")
        resp = client.post(_archive(year.year.id), headers=principal)
        assert resp.json()["repeating"] == 1
        db_session.refresh(s)
        assert s.year_of_study == YearOfStudy.FIRST
        assert _record(db_session, s.id, year.year.id).result == ProgressionStanding.REPEATING

    def test_reactivate_undoes_progression(self, client, year, principal, db_session) -> None:
        first = year.student()
        year.pass_all(first)
        second = year.student(year_of_study=YearOfStudy.SECOND)
        year.pass_all(second)
        client.post(_archive(year.year.id), headers=principal)

        resp = client.post(_reactivate(year.year.id), headers=principal)
        assert resp.status_code == 200, resp.text
        db_session.refresh(first)
        db_session.refresh(second)
        assert first.year_of_study == YearOfStudy.FIRST
        assert _record(db_session, first.id, year.year.id) is None
        assert second.status == StudentStatus.ACTIVE
        assert second.completion_date is None

    def test_reactivate_keeps_a_later_manual_change(
        self, client, year, principal, db_session
    ) -> None:
        s = year.student(year_of_study=YearOfStudy.SECOND)
        year.pass_all(s)
        client.post(_archive(year.year.id), headers=principal)
        db_session.refresh(s)
        s.status = StudentStatus.GRADUATED  # the Registrar moved on
        db_session.flush()

        client.post(_reactivate(year.year.id), headers=principal)
        db_session.refresh(s)
        assert s.status == StudentStatus.GRADUATED


class TestDeanExceptions:
    def test_excused_missing_summer_is_promoted(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 1, "90")
        year.sit(s, 2, "90")
        resp = client.put(
            _excuse_student(year.year.id, s.id), headers=principal,
            json={"excused": True, "reason": "Transferred in from another college"},
        )
        assert resp.status_code == 204, resp.text
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "promote"
        assert row["terms_excused"] is True
        missing = [i for i in row["issues"] if i["kind"] == "missing_term"]
        assert missing and all(i["excused"] for i in missing)

    def test_removing_the_excuse_restores_repeat(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 1, "90")
        year.sit(s, 2, "90")
        url = _excuse_student(year.year.id, s.id)
        client.put(url, headers=principal, json={"excused": True, "reason": "Missed summer"})
        client.put(url, headers=principal, json={"excused": False})
        assert _outcome(client, principal, year.year.id, s.id)["outcome"] == "repeat"

    def test_excuse_requires_a_reason(self, client, year, principal) -> None:
        s = year.student()
        resp = client.put(
            _excuse_student(year.year.id, s.id), headers=principal, json={"excused": True}
        )
        assert resp.status_code == 422

    def test_excused_failed_course_is_promoted(self, client, year, principal, db_session) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        bad = year.sit(s, 1, "40")
        year.sit(s, 2, "90")
        resp = client.put(
            _excuse_enrollment(year.year.id, bad.id), headers=principal,
            json={"excused": True, "reason": "Medical, documented"},
        )
        assert resp.status_code == 204, resp.text
        row = _outcome(client, principal, year.year.id, s.id)
        assert row["outcome"] == "promote"
        issue = next(i for i in row["issues"] if i["enrollment_id"] == str(bad.id))
        assert issue["excused"] is True
        assert issue["excuse_reason"] == "Medical, documented"

    def test_excused_withdrawal_is_promoted_and_status_kept(
        self, client, year, principal, db_session
    ) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        w = year.sit(s, 1, None, how=EnrollmentStatus.WITHDRAWN)
        year.sit(s, 2, "90")
        client.put(
            _excuse_enrollment(year.year.id, w.id), headers=principal,
            json={"excused": True, "reason": "Approved withdrawal"},
        )
        assert _outcome(client, principal, year.year.id, s.id)["outcome"] == "promote"
        db_session.refresh(w)
        # The exception does not rewrite the record: still a withdrawal.
        assert w.enrollment_status == EnrollmentStatus.WITHDRAWN

    def test_unknown_enrollment_is_404(self, client, year, principal) -> None:
        resp = client.put(
            _excuse_enrollment(year.year.id, uuid.uuid4()), headers=principal,
            json={"excused": True, "reason": "whatever"},
        )
        assert resp.status_code == 404

    def test_lecturer_cannot_excuse(self, client, year, make_user, auth_headers) -> None:
        s = year.student()
        t = make_user(role=Role.TEACHER, full_name="Not Dean")
        resp = client.put(
            _excuse_student(year.year.id, s.id),
            headers=auth_headers(user_id=t.id, role=Role.TEACHER),
            json={"excused": True, "reason": "nope"},
        )
        assert resp.status_code == 403

    def test_archived_year_refuses_exceptions(self, client, year, principal) -> None:
        s = year.student()
        year.pass_all(s)
        client.post(_archive(year.year.id), headers=principal)
        resp = client.put(
            _excuse_student(year.year.id, s.id), headers=principal,
            json={"excused": True, "reason": "too late"},
        )
        assert resp.status_code == 409


class TestYearSwitcher:
    """The year switcher shows the level the student held THEN, not today's."""

    def test_past_year_shows_the_level_held_then(self, client, year, principal) -> None:
        s = year.student()
        year.pass_all(s)
        client.post(_archive(year.year.id), headers=principal)

        then = client.get(
            f"/api/v1/students/{s.id}?academic_year_id={year.year.id}", headers=principal
        ).json()
        assert then["year_of_study"] == "First"
        assert then["year_result"] == "Promoted"
        assert then["repeating"] is False

        now = client.get(f"/api/v1/students/{s.id}", headers=principal).json()
        assert now["year_of_study"] == "Second"

    def test_repeater_is_flagged_after_the_year(self, client, year, principal) -> None:
        s = year.student()
        year.sit(s, 0, "90")
        year.sit(s, 1, "40")
        year.sit(s, 2, "90")
        client.post(_archive(year.year.id), headers=principal)

        then = client.get(
            f"/api/v1/students/{s.id}?academic_year_id={year.year.id}", headers=principal
        ).json()
        assert then["year_result"] == "Repeating"
        assert then["repeating"] is False  # they were not repeating DURING that year

        now = client.get(f"/api/v1/students/{s.id}", headers=principal).json()
        assert now["year_of_study"] == "First"
        assert now["repeating"] is True

    def test_list_filter_uses_the_level_held_then(self, client, year, principal) -> None:
        s = year.student()
        year.pass_all(s)
        client.post(_archive(year.year.id), headers=principal)

        rows = client.get(
            f"/api/v1/students?academic_year_id={year.year.id}&year_of_study=First"
            f"&search={s.student_number}&page_size=50",
            headers=principal,
        ).json()["items"]
        assert [r["id"] for r in rows] == [str(s.id)]
        assert rows[0]["year_of_study"] == "First"

    def test_excuse_lives_on_the_year_record(self, client, year, principal, db_session) -> None:
        s = year.student()
        client.put(
            _excuse_student(year.year.id, s.id), headers=principal,
            json={"excused": True, "reason": "Entered from another college"},
        )
        rec = _record(db_session, s.id, year.year.id)
        assert rec.missing_terms_excused is True
        assert rec.result is None

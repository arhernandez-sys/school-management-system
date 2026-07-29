"""Comprehensive pytest suite for Module 7.9a — DASHBOARD (api-spec §5 Module 2).

Scope: the single composite `GET /dashboard` and its four role-shaped payloads.

The highest-value assertions here are the **scope leaks**, because a dashboard is the
one place where aggregate data from every module converges:
  * unreleased grades must never reach a student's term average or recent grades;
  * draft assessments must never appear in a student's upcoming list;
  * a teacher's figures must cover only their own sections;
  * role is derived from the token, never from a request parameter.

Also pins the three places this deliberately does NOT copy the mock: `new_students_term`
is derived from enrollment dates rather than a hardcoded grade name, `enrollment_trend`
is real rather than synthetic, and a student's `attendance_rate` is their OWN rather
than their section's.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.core.timeutil import school_today, utcnow
from app.modules.announcements.models import Announcement
from app.modules.assessments.models import Assessment
from app.modules.attendance.models import AttendanceRecord
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.grades.models import AssessmentGrade
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile

pytestmark = pytest.mark.requires_db

DB = "/api/v1/dashboard"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """An active year + active semester + section + offering, an owning teacher, a
    second section the teacher owns nothing in, and an enrolled student with a login."""

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db_session
        self._make_user = make_user
        self._auth_headers = auth_headers

        self.year = AcademicYear(
            name=f"DashYear {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        self.scale = make_grading_scale(self.year.id)
        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 8, 31), is_active=True,
        )
        db_session.add(self.sem)

        self.section = Class(
            academic_year_id=self.year.id, name=f"AAA Sec {tag}", grade_level="Form 1",
            section="A", capacity=30,
        )
        self.other_section = Class(
            academic_year_id=self.year.id, name=f"ZZZ Other {tag}", grade_level="Form 2",
            section="B", capacity=25,
        )
        db_session.add_all([self.section, self.other_section])
        self.subject = Subject(name=f"AAA Subj {tag}", code=tag.upper())
        db_session.add(self.subject)
        db_session.flush()

        self.cs = ClassSubject(class_id=self.section.id, subject_id=self.subject.id, is_active=True)
        self.other_cs = ClassSubject(
            class_id=self.other_section.id, subject_id=self.subject.id, is_active=True
        )
        db_session.add_all([self.cs, self.other_cs])
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

        # Owns the other section only.
        self.other_teacher_user = make_user(role=Role.TEACHER, full_name="Other Teacher")
        self.other_teacher = TeacherProfile(
            user_id=self.other_teacher_user.id, staff_number=f"O-{tag}",
            full_name="Other Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.other_teacher)
        db_session.flush()
        db_session.add(
            ClassTeacher(class_subject_id=self.other_cs.id, teacher_id=self.other_teacher.id, is_lead=True)
        )
        db_session.flush()

        self.student, self.enrollment = self.add_student(name="Ana Lopez", with_login=True)

        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.T2 = auth_headers(user_id=self.other_teacher_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student.user_id, role=Role.STUDENT)

    def add_student(self, *, name=None, with_login=False, enroll=True, section=None,
                    enrollment_date=None):
        s = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            full_name=name or f"Stu {uuid.uuid4().hex[:4]}",
            date_of_birth=date(2012, 1, 1),
            enrollment_date=enrollment_date or date(2025, 9, 15),
            status="active",
        )
        if with_login:
            user = self._make_user(role=Role.STUDENT, full_name=s.full_name)
            s.user_id = user.id
        self._db.add(s)
        self._db.flush()
        enr = None
        if enroll:
            enr = ClassEnrollment(
                class_id=(section or self.section).id, student_id=s.id, semester_id=self.sem.id
            )
            self._db.add(enr)
            self._db.flush()
        return s, enr

    def assessment(self, *, status="graded", max_score="100", weight="1",
                   is_released=False, cs_id=None, assessment_date=None, title=None):
        a = Assessment(
            class_subject_id=cs_id or self.cs.id,
            semester_id=self.sem.id,
            title=title or f"A {uuid.uuid4().hex[:5]}",
            type="quiz",
            max_score=Decimal(max_score),
            weight=Decimal(weight),
            status=status,
            is_released=is_released,
            assessment_date=assessment_date,
        )
        self._db.add(a)
        self._db.flush()
        return a

    def grade(self, assessment, student, enrollment, *, status="graded", score="80",
              is_released=None):
        g = AssessmentGrade(
            assessment_id=assessment.id, student_id=student.id, enrollment_id=enrollment.id,
            status=status, score=Decimal(score) if score is not None else None,
            is_released=is_released,
        )
        self._db.add(g)
        self._db.flush()
        return g

    def attendance(self, student, enrollment, *, status="present", on=None, section=None):
        r = AttendanceRecord(
            class_id=(section or self.section).id, student_id=student.id,
            enrollment_id=enrollment.id, semester_id=self.sem.id,
            attendance_date=on or date(2025, 10, 15), status=status,
        )
        self._db.add(r)
        self._db.flush()
        return r

    def announcement(self, *, audience="all", author=None, title=None):
        row = Announcement(
            author_id=(author or self.principal_user).id,
            title=title or f"Notice {uuid.uuid4().hex[:5]}",
            body="Body text.",
            audience=audience,
            published_at=utcnow() - timedelta(hours=1),
        )
        self._db.add(row)
        self._db.flush()
        return row


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthAndShape:
    def test_requires_auth(self, client) -> None:
        assert client.get(DB).status_code == 401

    def test_role_comes_from_the_token_not_a_param(self, client, graph) -> None:
        """A student asking for the principal's view still gets the student view."""
        body = client.get(f"{DB}?role=principal", headers=graph.U).json()
        assert body["role"] == "student"

    def test_each_role_gets_its_own_variant(self, client, graph) -> None:
        assert client.get(DB, headers=graph.P).json()["role"] == "principal"
        assert client.get(DB, headers=graph.S).json()["role"] == "secretary"
        assert client.get(DB, headers=graph.T).json()["role"] == "teacher"
        assert client.get(DB, headers=graph.U).json()["role"] == "student"

    def test_shared_header_on_every_variant(self, client, graph) -> None:
        for headers, name in (
            (graph.P, "The Principal"),
            (graph.S, "Front Office"),
            (graph.T, "Maria Reyes"),
            (graph.U, "Ana Lopez"),
        ):
            body = client.get(DB, headers=headers).json()
            assert body["user_full_name"] == name
            assert body["academic_year_name"] == graph.year.name
            assert body["semester_name"] == "Semester 1"

    def test_no_active_semester_409(self, client, graph, db_session) -> None:
        graph.sem.is_active = False
        db_session.flush()
        r = client.get(DB, headers=graph.P)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="no_active_semester")


# ════════════════════════════════════════════════════════════════════════════
class TestPrincipalVariant:
    def test_top_level_keys(self, client, graph) -> None:
        body = client.get(DB, headers=graph.P).json()
        assert set(body.keys()) == {
            "role", "user_full_name", "academic_year_name", "semester_name", "stats",
            "enrollment_by_grade", "grade_distribution", "enrollment_trend",
            "recent_teachers", "recent_students", "recent_announcements",
        }

    def test_stats_keys(self, client, graph) -> None:
        stats = client.get(DB, headers=graph.P).json()["stats"]
        assert set(stats.keys()) == {
            "active_students", "active_teachers", "total_sections", "attendance_rate",
            "unread_announcements", "new_students_term", "total_courses", "student_capacity",
        }

    def test_total_sections_and_capacity(self, client, graph) -> None:
        stats = client.get(DB, headers=graph.P).json()["stats"]
        assert stats["total_sections"] >= 2
        # Two sections at 30 + 25; other seeded sections may add more.
        assert stats["student_capacity"] >= 55

    def test_archived_sections_excluded(self, client, graph, db_session) -> None:
        before = client.get(DB, headers=graph.P).json()["stats"]["total_sections"]
        graph.section.is_archived = True
        db_session.flush()
        after = client.get(DB, headers=graph.P).json()["stats"]["total_sections"]
        assert after == before - 1

    def test_new_students_term_uses_enrollment_date_not_a_grade_name(self, client, graph) -> None:
        """Deliberate divergence: the mock hardcodes "the Form 1 cohort"."""
        before = client.get(DB, headers=graph.P).json()["stats"]["new_students_term"]
        # Inside the year window -> counts. Note Form 2, so a grade-name proxy would miss it.
        graph.add_student(section=graph.other_section, enrollment_date=date(2025, 10, 1))
        # Outside the window -> must not count.
        graph.add_student(enrollment_date=date(2019, 1, 1))
        after = client.get(DB, headers=graph.P).json()["stats"]["new_students_term"]
        assert after == before + 1

    def test_enrollment_by_grade_groups_and_counts(self, client, graph) -> None:
        graph.add_student()
        graph.add_student(section=graph.other_section)
        rows = {
            r["grade_level"]: r["count"]
            for r in client.get(DB, headers=graph.P).json()["enrollment_by_grade"]
        }
        assert rows.get("Form 1", 0) >= 2  # Ana + the new one
        assert rows.get("Form 2", 0) >= 1

    def test_enrollment_trend_is_derived_and_ascending(self, client, graph) -> None:
        """Deliberate divergence: the mock fabricates six synthetic points."""
        trend = client.get(DB, headers=graph.P).json()["enrollment_trend"]
        assert trend, "expected at least the active term"
        assert len(trend) <= 6
        mine = [p for p in trend if graph.year.name in p["period"]]
        assert mine, f"active year missing from trend: {trend}"
        assert mine[-1]["count"] >= 1

    def test_attendance_rate_counts_late_as_present(self, client, graph) -> None:
        s1, e1 = graph.add_student()
        s2, e2 = graph.add_student()
        s3, e3 = graph.add_student()
        graph.attendance(s1, e1, status="present")
        graph.attendance(s2, e2, status="late")
        graph.attendance(s3, e3, status="absent")
        rate = client.get(DB, headers=graph.P).json()["stats"]["attendance_rate"]
        assert rate == 66.7

    def test_grade_distribution_tallies_letters(self, client, graph) -> None:
        a = graph.assessment(status="graded", max_score="100")
        s1, e1 = graph.add_student()
        s2, e2 = graph.add_student()
        graph.grade(a, s1, e1, score="95")  # A
        graph.grade(a, s2, e2, score="85")  # B
        dist = {
            r["letter"]: r["count"]
            for r in client.get(DB, headers=graph.P).json()["grade_distribution"]
        }
        assert dist.get("A", 0) >= 1
        assert dist.get("B", 0) >= 1

    def test_grade_distribution_ordered_best_first(self, client, graph) -> None:
        a = graph.assessment(status="graded", max_score="100")
        for score in ("95", "85", "45"):
            s, e = graph.add_student()
            graph.grade(a, s, e, score=score)
        letters = [r["letter"] for r in client.get(DB, headers=graph.P).json()["grade_distribution"]]
        assert letters.index("A") < letters.index("B") < letters.index("F")

    def test_person_cards_are_capped_and_shaped(self, client, graph) -> None:
        for i in range(8):
            graph.add_student(name=f"Bulk Student {i}")
        body = client.get(DB, headers=graph.P).json()
        assert len(body["recent_students"]) <= 6
        assert len(body["recent_teachers"]) <= 6
        person = body["recent_students"][0]
        assert set(person.keys()) == {"id", "name", "secondary", "status"}
        assert person["status"]["kind"] == "success"


# ════════════════════════════════════════════════════════════════════════════
class TestSecretaryVariant:
    def test_top_level_keys(self, client, graph) -> None:
        body = client.get(DB, headers=graph.S).json()
        assert set(body.keys()) == {
            "role", "user_full_name", "academic_year_name", "semester_name", "stats",
            "recent_enrollments", "recent_announcements",
        }

    def test_stats_keys(self, client, graph) -> None:
        stats = client.get(DB, headers=graph.S).json()["stats"]
        assert set(stats.keys()) == {
            "active_students", "active_teachers", "total_sections",
            "unstaffed_subjects", "over_capacity_sections", "unread_announcements",
        }

    def test_unstaffed_subjects_counts_offerings_with_no_teacher(self, client, graph, db_session) -> None:
        before = client.get(DB, headers=graph.S).json()["stats"]["unstaffed_subjects"]
        orphan_subject = Subject(name=f"Orphan {graph.tag}", code=f"OR{graph.tag[:2].upper()}")
        db_session.add(orphan_subject)
        db_session.flush()
        db_session.add(
            ClassSubject(class_id=graph.section.id, subject_id=orphan_subject.id, is_active=True)
        )
        db_session.flush()
        after = client.get(DB, headers=graph.S).json()["stats"]["unstaffed_subjects"]
        assert after == before + 1

    def test_over_capacity_sections(self, client, graph, db_session) -> None:
        graph.section.capacity = 1
        db_session.flush()
        graph.add_student()  # now 2 enrolled against a capacity of 1
        stats = client.get(DB, headers=graph.S).json()["stats"]
        assert stats["over_capacity_sections"] >= 1

    def test_recent_enrollments_shape_and_newest_first(self, client, graph) -> None:
        graph.add_student(name="Later Student")
        rows = client.get(DB, headers=graph.S).json()["recent_enrollments"]
        assert rows
        assert set(rows[0].keys()) == {
            "enrollment_id", "student_name", "section_name", "enrolled_at"
        }
        stamps = [r["enrolled_at"] for r in rows]
        assert stamps == sorted(stamps, reverse=True)

    def test_recent_enrollments_capped(self, client, graph) -> None:
        for i in range(8):
            graph.add_student(name=f"Bulk {i}")
        assert len(client.get(DB, headers=graph.S).json()["recent_enrollments"]) <= 6


# ════════════════════════════════════════════════════════════════════════════
class TestTeacherVariant:
    def test_top_level_keys(self, client, graph) -> None:
        body = client.get(DB, headers=graph.T).json()
        assert set(body.keys()) == {
            "role", "user_full_name", "academic_year_name", "semester_name", "stats",
            "today_classes", "recent_assessments", "awaiting_release",
            "recent_announcements",
        }

    def test_stats_keys(self, client, graph) -> None:
        stats = client.get(DB, headers=graph.T).json()["stats"]
        assert set(stats.keys()) == {
            "my_sections", "my_class_subjects", "attendance_due_today",
            "ungraded_items", "awaiting_release_items",
        }

    def test_scoped_to_own_sections_only(self, client, graph) -> None:
        body = client.get(DB, headers=graph.T).json()
        section_ids = {c["section_id"] for c in body["today_classes"]}
        assert section_ids == {str(graph.section.id)}
        assert str(graph.other_section.id) not in section_ids
        assert body["stats"]["my_sections"] == 1

    def test_teacher_with_no_classes_gets_empty_lists(self, client, graph, make_user, auth_headers, db_session) -> None:
        user = make_user(role=Role.TEACHER, full_name="Idle Teacher")
        db_session.add(TeacherProfile(
            user_id=user.id, staff_number=f"N-{graph.tag}", full_name="Idle Teacher",
            status=TeacherStatus.ACTIVE,
        ))
        db_session.flush()
        body = client.get(DB, headers=auth_headers(user_id=user.id, role=Role.TEACHER)).json()
        assert body["today_classes"] == []
        assert body["stats"]["my_sections"] == 0

    def test_one_row_per_section_not_per_offering(self, client, graph, db_session) -> None:
        """Attendance is per-section-per-day, so teaching two subjects in one homeroom
        must not produce two register rows."""
        second = Subject(name=f"Second {graph.tag}", code=f"SC{graph.tag[:2].upper()}")
        db_session.add(second)
        db_session.flush()
        cs2 = ClassSubject(class_id=graph.section.id, subject_id=second.id, is_active=True)
        db_session.add(cs2)
        db_session.flush()
        db_session.add(ClassTeacher(class_subject_id=cs2.id, teacher_id=graph.teacher.id))
        db_session.flush()
        body = client.get(DB, headers=graph.T).json()
        assert len(body["today_classes"]) == 1
        assert body["stats"]["my_class_subjects"] == 2  # two offerings, one section

    def test_attendance_due_today_reflects_todays_records(self, client, graph) -> None:
        before = client.get(DB, headers=graph.T).json()
        assert before["stats"]["attendance_due_today"] == 1
        assert before["today_classes"][0]["attendance_recorded"] is False

        graph.attendance(graph.student, graph.enrollment, on=school_today())
        after = client.get(DB, headers=graph.T).json()
        assert after["stats"]["attendance_due_today"] == 0
        assert after["today_classes"][0]["attendance_recorded"] is True

    def test_attendance_uses_the_school_local_date(self, client, graph) -> None:
        """A record for the UTC date but not the Belize date must NOT clear the task."""
        graph.attendance(graph.student, graph.enrollment, on=school_today() + timedelta(days=1))
        body = client.get(DB, headers=graph.T).json()
        assert body["today_classes"][0]["attendance_recorded"] is False

    def test_ungraded_items_counts_published_and_grading_only(self, client, graph) -> None:
        graph.assessment(status="published")
        graph.assessment(status="grading")
        graph.assessment(status="draft")
        graph.assessment(status="graded")
        body = client.get(DB, headers=graph.T).json()
        assert body["stats"]["ungraded_items"] == 2

    def test_recent_assessments_shape_and_scope(self, client, graph) -> None:
        mine = graph.assessment(status="published", assessment_date=date(2025, 10, 20))
        theirs = graph.assessment(status="published", cs_id=graph.other_cs.id)
        rows = client.get(DB, headers=graph.T).json()["recent_assessments"]
        ids = {r["id"] for r in rows}
        assert str(mine.id) in ids
        assert str(theirs.id) not in ids
        assert set(rows[0].keys()) == {
            "id", "title", "subject_name", "section_name", "assessment_date", "status"
        }

    def test_recent_assessments_capped_at_six(self, client, graph) -> None:
        for i in range(9):
            graph.assessment(status="published", assessment_date=date(2025, 10, 1 + i))
        assert len(client.get(DB, headers=graph.T).json()["recent_assessments"]) <= 6


# ════════════════════════════════════════════════════════════════════════════
class TestTeacherAwaitingRelease:
    """`stats.awaiting_release_items` + the `awaiting_release` queue.

    The distinction that matters: `ungraded_items` is work the teacher has yet to
    MARK; this is work already marked but still HIDDEN from students. Conflating the
    two would make the tile lie in both directions, so the first two tests pin that
    each figure moves independently of the other.
    """

    def _awaiting(self, client, graph) -> dict:
        return client.get(DB, headers=graph.T).json()

    def test_counts_graded_but_unreleased(self, client, graph) -> None:
        a = graph.assessment(status="graded", is_released=False)
        graph.grade(a, graph.student, graph.enrollment, status="graded", score="80")
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 1
        assert [r["id"] for r in body["awaiting_release"]] == [str(a.id)]

    def test_does_not_count_already_released(self, client, graph) -> None:
        a = graph.assessment(status="graded", is_released=True)
        graph.grade(a, graph.student, graph.enrollment, status="graded", score="80")
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 0
        assert body["awaiting_release"] == []

    def test_does_not_count_ungraded(self, client, graph) -> None:
        """A pending row is unmarked work — it belongs to `ungraded_items`, and
        releasing it would reveal nothing."""
        a = graph.assessment(status="grading", is_released=False)
        graph.grade(a, graph.student, graph.enrollment, status="pending", score=None)
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 0
        assert body["stats"]["ungraded_items"] == 1

    def test_absent_and_excused_do_not_count(self, client, graph) -> None:
        """Neither carries a score to reveal, so neither is awaiting release."""
        absent = graph.assessment(status="graded", is_released=False)
        graph.grade(absent, graph.student, graph.enrollment, status="absent", score=None)
        excused = graph.assessment(status="graded", is_released=False)
        peer, peer_enr = graph.add_student()
        graph.grade(excused, peer, peer_enr, status="excused", score=None)
        assert self._awaiting(client, graph)["stats"]["awaiting_release_items"] == 0

    def test_per_student_unrelease_overrides_a_released_column(self, client, graph) -> None:
        """`grade.is_released ?? assessment.is_released` — a straggler left hidden by
        a per-student unrelease still counts even though the column reads released."""
        a = graph.assessment(status="graded", is_released=True)
        graph.grade(
            a, graph.student, graph.enrollment, status="graded", score="80",
            is_released=False,
        )
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 1
        assert body["awaiting_release"][0]["graded_unreleased_count"] == 1

    def test_per_student_release_overrides_an_unreleased_column(self, client, graph) -> None:
        a = graph.assessment(status="graded", is_released=False)
        graph.grade(
            a, graph.student, graph.enrollment, status="graded", score="80",
            is_released=True,
        )
        assert self._awaiting(client, graph)["stats"]["awaiting_release_items"] == 0

    def test_counts_assessments_not_students(self, client, graph) -> None:
        """One assessment with three waiting students is ONE outstanding action."""
        a = graph.assessment(status="graded", is_released=False)
        graph.grade(a, graph.student, graph.enrollment, status="graded", score="80")
        for _ in range(2):
            peer, peer_enr = graph.add_student()
            graph.grade(a, peer, peer_enr, status="graded", score="70")
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 1
        assert body["awaiting_release"][0]["graded_unreleased_count"] == 3

    def test_scoped_to_own_offerings(self, client, graph) -> None:
        mine = graph.assessment(status="graded", is_released=False)
        graph.grade(mine, graph.student, graph.enrollment, status="graded", score="80")
        theirs = graph.assessment(status="graded", is_released=False, cs_id=graph.other_cs.id)
        peer, peer_enr = graph.add_student(section=graph.other_section)
        graph.grade(theirs, peer, peer_enr, status="graded", score="80")

        ids = {r["id"] for r in self._awaiting(client, graph)["awaiting_release"]}
        assert str(mine.id) in ids
        assert str(theirs.id) not in ids
        # ...and the other teacher sees the mirror image.
        other = client.get(DB, headers=graph.T2).json()
        assert {r["id"] for r in other["awaiting_release"]} == {str(theirs.id)}

    def test_item_shape_carries_the_gradebook_link(self, client, graph) -> None:
        a = graph.assessment(status="graded", is_released=False, assessment_date=date(2025, 10, 9))
        graph.grade(a, graph.student, graph.enrollment, status="graded", score="80")
        row = self._awaiting(client, graph)["awaiting_release"][0]
        assert set(row.keys()) == {
            "id", "title", "subject_name", "section_name", "assessment_date", "status",
            "class_subject_id", "graded_unreleased_count",
        }
        # The tile deep-links by OFFERING, so this id must be present and correct.
        assert row["class_subject_id"] == str(graph.cs.id)
        assert row["section_name"] == graph.section.name

    def test_list_capped_but_count_is_not(self, client, graph) -> None:
        for i in range(8):
            a = graph.assessment(
                status="graded", is_released=False, assessment_date=date(2025, 10, 1 + i)
            )
            graph.grade(a, graph.student, graph.enrollment, status="graded", score="80")
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 8
        assert len(body["awaiting_release"]) == 6

    def test_oldest_first(self, client, graph) -> None:
        for offset in (10, 3, 6):
            a = graph.assessment(
                status="graded", is_released=False,
                assessment_date=date(2025, 10, 1) + timedelta(days=offset),
            )
            graph.grade(a, graph.student, graph.enrollment, status="graded", score="80")
        dates = [r["assessment_date"] for r in self._awaiting(client, graph)["awaiting_release"]]
        assert dates == sorted(dates)

    def test_teacher_with_nothing_hidden_sees_an_empty_queue(self, client, graph) -> None:
        body = self._awaiting(client, graph)
        assert body["stats"]["awaiting_release_items"] == 0
        assert body["awaiting_release"] == []

    def test_only_teachers_get_the_queue(self, client, graph) -> None:
        """It is a teacher-variant field; no other role's payload gains it."""
        for headers in (graph.P, graph.S, graph.U):
            assert "awaiting_release" not in client.get(DB, headers=headers).json()


# ════════════════════════════════════════════════════════════════════════════
class TestStudentVariant:
    def test_top_level_keys(self, client, graph) -> None:
        body = client.get(DB, headers=graph.U).json()
        # NOTE `announcements`, not `recent_announcements` — the frontend type is
        # asymmetric here and this pins it.
        assert set(body.keys()) == {
            "role", "user_full_name", "academic_year_name", "semester_name", "stats",
            "my_classes", "recent_grades", "upcoming_assessments", "announcements",
        }

    def test_stats_keys(self, client, graph) -> None:
        stats = client.get(DB, headers=graph.U).json()["stats"]
        assert set(stats.keys()) == {
            "term_average", "term_letter", "attendance_rate", "upcoming_count"
        }

    def test_my_classes_shape(self, client, graph) -> None:
        rows = client.get(DB, headers=graph.U).json()["my_classes"]
        assert rows
        assert set(rows[0].keys()) == {"class_subject_id", "subject_name", "teacher_name"}
        assert rows[0]["teacher_name"] == "Maria Reyes"

    def test_unassigned_offering_reports_unassigned(self, client, graph, db_session) -> None:
        orphan = Subject(name=f"ZZZ Orphan {graph.tag}", code=f"ZO{graph.tag[:2].upper()}")
        db_session.add(orphan)
        db_session.flush()
        db_session.add(ClassSubject(class_id=graph.section.id, subject_id=orphan.id, is_active=True))
        db_session.flush()
        rows = client.get(DB, headers=graph.U).json()["my_classes"]
        assert any(r["teacher_name"] == "Unassigned" for r in rows)

    def test_unreleased_grades_never_reach_the_student(self, client, graph) -> None:
        """The single most important assertion in this suite."""
        secret = graph.assessment(status="graded", max_score="100", is_released=False)
        graph.grade(secret, graph.student, graph.enrollment, score="10")
        body = client.get(DB, headers=graph.U).json()
        assert body["recent_grades"] == []
        assert body["stats"]["term_average"] is None

    def test_released_grades_do_reach_the_student(self, client, graph) -> None:
        shown = graph.assessment(status="graded", max_score="100", is_released=True)
        graph.grade(shown, graph.student, graph.enrollment, score="90")
        body = client.get(DB, headers=graph.U).json()
        assert len(body["recent_grades"]) == 1
        assert body["recent_grades"][0]["score"] == 90.0
        assert body["recent_grades"][0]["letter"] == "A"
        assert body["stats"]["term_average"] == 90.0
        assert body["stats"]["term_letter"] == "A"

    def test_term_average_excludes_unreleased_from_the_mean(self, client, graph) -> None:
        shown = graph.assessment(status="graded", max_score="100", is_released=True)
        secret = graph.assessment(status="graded", max_score="100", is_released=False)
        graph.grade(shown, graph.student, graph.enrollment, score="90")
        graph.grade(secret, graph.student, graph.enrollment, score="10")
        body = client.get(DB, headers=graph.U).json()
        # A release-agnostic mean would report 50.
        assert body["stats"]["term_average"] == 90.0

    def test_recent_grades_shape(self, client, graph) -> None:
        a = graph.assessment(status="graded", max_score="50", is_released=True)
        graph.grade(a, graph.student, graph.enrollment, score="40")
        row = client.get(DB, headers=graph.U).json()["recent_grades"][0]
        assert set(row.keys()) == {
            "assessment_id", "title", "subject_name", "score", "max_score", "letter"
        }
        assert row["max_score"] == 50.0
        assert row["letter"] == "B"  # 80%

    def test_upcoming_excludes_drafts(self, client, graph) -> None:
        """The mock includes drafts — a real scope leak, not copied."""
        future = school_today() + timedelta(days=7)
        published = graph.assessment(status="published", assessment_date=future)
        draft = graph.assessment(status="draft", assessment_date=future)
        body = client.get(DB, headers=graph.U).json()
        ids = {r["id"] for r in body["upcoming_assessments"]}
        assert str(published.id) in ids
        assert str(draft.id) not in ids

    def test_upcoming_excludes_past_dates(self, client, graph) -> None:
        graph.assessment(status="published", assessment_date=school_today() - timedelta(days=3))
        body = client.get(DB, headers=graph.U).json()
        assert body["upcoming_assessments"] == []
        assert body["stats"]["upcoming_count"] == 0

    def test_upcoming_soonest_first_and_count_matches(self, client, graph) -> None:
        for offset in (10, 3, 6):
            graph.assessment(
                status="published", assessment_date=school_today() + timedelta(days=offset)
            )
        body = client.get(DB, headers=graph.U).json()
        dates = [r["assessment_date"] for r in body["upcoming_assessments"]]
        assert dates == sorted(dates)
        assert body["stats"]["upcoming_count"] == len(body["upcoming_assessments"])

    def test_attendance_rate_is_the_students_own_not_the_sections(self, client, graph) -> None:
        """Deliberate divergence: the mock reports the section average.

        The student is present twice; a classmate is absent twice. "My attendance"
        must read 100, not the section's 50.
        """
        graph.attendance(graph.student, graph.enrollment, status="present", on=date(2025, 10, 15))
        graph.attendance(graph.student, graph.enrollment, status="present", on=date(2025, 10, 16))
        peer, peer_enr = graph.add_student()
        graph.attendance(peer, peer_enr, status="absent", on=date(2025, 10, 15))
        graph.attendance(peer, peer_enr, status="absent", on=date(2025, 10, 16))
        assert client.get(DB, headers=graph.U).json()["stats"]["attendance_rate"] == 100.0

    def test_student_without_a_profile_still_renders(self, client, graph, make_user, auth_headers) -> None:
        user = make_user(role=Role.STUDENT, full_name="Profileless")
        body = client.get(DB, headers=auth_headers(user_id=user.id, role=Role.STUDENT)).json()
        assert body["role"] == "student"
        assert body["my_classes"] == []
        assert body["stats"]["term_average"] is None

    def test_unenrolled_student_renders_with_no_classes(self, client, graph, db_session) -> None:
        graph.enrollment.unenrolled_at = utcnow()
        db_session.flush()
        body = client.get(DB, headers=graph.U).json()
        assert body["my_classes"] == []
        assert body["stats"]["term_average"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestAnnouncementIntegration:
    def test_feed_respects_announcement_targeting(self, client, graph) -> None:
        """Reuses the announcements module's visibility rule, so the stakeholder
        decisions there apply here automatically."""
        students_only = graph.announcement(audience="students")
        titles = {a["id"] for a in client.get(DB, headers=graph.U).json()["announcements"]}
        assert str(students_only.id) in titles
        teacher_feed = {
            a["id"] for a in client.get(DB, headers=graph.T).json()["recent_announcements"]
        }
        assert str(students_only.id) not in teacher_feed

    def test_admins_do_not_see_teacher_authored_notices(self, client, graph) -> None:
        row = graph.announcement(audience="teachers", author=graph.teacher_user)
        ids = {a["id"] for a in client.get(DB, headers=graph.P).json()["recent_announcements"]}
        assert str(row.id) not in ids

    def test_announcement_item_carries_the_full_body(self, client, graph) -> None:
        graph.announcement(audience="all")
        item = client.get(DB, headers=graph.P).json()["recent_announcements"][0]
        assert set(item.keys()) == {"id", "title", "body", "audience", "published_at", "is_read"}
        assert item["body"] == "Body text."

    def test_teacher_feed_capped_at_four(self, client, graph) -> None:
        for _ in range(6):
            graph.announcement(audience="teachers", author=graph.principal_user)
        assert len(client.get(DB, headers=graph.T).json()["recent_announcements"]) <= 4

    def test_unread_count_matches_the_announcements_endpoint(self, client, graph) -> None:
        graph.announcement(audience="students")
        dash = client.get(DB, headers=graph.U).json()
        # The student variant has no unread stat; cross-check the principal's instead.
        graph.announcement(audience="all")
        p_dash = client.get(DB, headers=graph.P).json()["stats"]["unread_announcements"]
        endpoint = client.get(
            "/api/v1/announcements/unread-count", headers=graph.P
        ).json()["unread_count"]
        assert p_dash == endpoint
        assert dash["role"] == "student"

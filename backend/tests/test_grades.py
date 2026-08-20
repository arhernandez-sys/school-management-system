"""Comprehensive pytest suite for Module 7.6 — GRADES (api-spec §7, schema §10).

Scope: the gradebook picker + grid, the single bulk grade write, `/grades/term`,
`/grades/me`, and the release-behaviour changes this module forced onto Assessments.

The arithmetic itself is covered DB-free in `tests/test_grade_calc.py` (59 tests);
this suite covers wiring, scoping and the response contract — plus a reconciliation
test asserting a student's own term average equals the teacher's for the same data,
which is the assertion that catches a wrong release filter.

Hermetic + rolled back via `db_session`: each test builds its own writable year +
section + subject + offering and a teacher that OWNS it.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.assessments.models import Assessment, AssessmentCategory
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
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

G = "/api/v1/grades"
A = "/api/v1/assessments"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """A writable year + section + subject + offering + owning teacher, plus a
    second offering the teacher does NOT own (for scoping assertions)."""

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db_session

        self.year = AcademicYear(
            name=f"GradeYear {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        self.scale = make_grading_scale(self.year.id)

        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        db_session.add(self.sem)
        self.subject = Course(name=f"Subj {tag}", code=tag.upper())
        db_session.add(self.subject)
        db_session.flush()

        self.cs = CourseOffering(
                course_id=self.subject.id,
                semester_id=self.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db_session.add(self.cs)
        db_session.flush()
        self.section = self.cs

        self.teacher_user = make_user(role=Role.TEACHER, full_name="Owner Teacher")
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id, staff_number=f"T-{tag}",
            full_name="Owner Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()
        db_session.add(ClassTeacher(offering_id=self.cs.id, teacher_id=self.teacher.id, is_lead=True))

        # A second offering in the same section, owned by somebody else.
        self.other_subject = Course(name=f"Other {tag}", code=f"O{tag[:3].upper()}")
        db_session.add(self.other_subject)
        db_session.flush()
        self.other_cs = CourseOffering(
                course_id=self.other_subject.id,
                semester_id=self.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db_session.add(self.other_cs)
        db_session.flush()
        self.other_teacher_user = make_user(role=Role.TEACHER, full_name="Other Teacher")
        self.other_teacher = TeacherProfile(
            user_id=self.other_teacher_user.id, staff_number=f"O-{tag}",
            full_name="Other Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.other_teacher)
        db_session.flush()
        db_session.add(
            ClassTeacher(offering_id=self.other_cs.id, teacher_id=self.other_teacher.id, is_lead=True)
        )
        db_session.flush()

        self.principal_user = make_user(role=Role.PRINCIPAL)
        self.secretary_user = make_user(role=Role.SECRETARY)

        self.H = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.OTHER = auth_headers(user_id=self.other_teacher_user.id, role=Role.TEACHER)
        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self._auth_headers = auth_headers
        self._make_user = make_user

    # ── factories ────────────────────────────────────────────────────────────
    def assessment(
        self, *, status="graded", max_score="20", weight="1.00",
        is_released=False, category_id=None, cs_id=None, semester_id=None,
        assessment_date=None, title=None,
    ) -> Assessment:
        a = Assessment(
            offering_id=cs_id or self.cs.id,
            semester_id=semester_id or self.sem.id,
            category_id=category_id,
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

    def category(self, *, weight="100", drop=None, cs_id=None) -> AssessmentCategory:
        c = AssessmentCategory(
            offering_id=cs_id or self.cs.id,
            name=f"Cat {uuid.uuid4().hex[:5]}",
            weight=Decimal(weight),
            drop_lowest_count=drop,
        )
        self._db.add(c)
        self._db.flush()
        return c

    def student(self, *, enroll=True, name=None, with_login=False):
        s = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            **split_name(name or f"Stu {uuid.uuid4().hex[:4]}"),
            date_of_birth=date(2012, 1, 1),
            enrollment_date=date(2025, 9, 1),
            status="active",
        )
        if with_login:
            user = self._make_user(role=Role.STUDENT, full_name=s.full_name)
            s.user_id = user.id
            s._login = user
        self._db.add(s)
        self._db.flush()
        enr = None
        if enroll:
            enr = ClassEnrollment(
                offering_id=self.section.id, student_id=s.id, semester_id=self.sem.id
            )
            self._db.add(enr)
            self._db.flush()
        return s, enr

    def grade(self, assessment, student, enrollment, *, status="graded", score="18",
              makeup=None, is_released=None) -> AssessmentGrade:
        g = AssessmentGrade(
            assessment_id=assessment.id,
            student_id=student.id,
            enrollment_id=enrollment.id,
            status=status,
            score=Decimal(score) if score is not None else None,
            makeup_score=Decimal(makeup) if makeup is not None else None,
            is_released=is_released,
        )
        self._db.add(g)
        self._db.flush()
        return g

    def student_headers(self, student):
        return self._auth_headers(user_id=student._login.id, role=Role.STUDENT)

    def label(self, offering) -> str:  # noqa: ANN001
        """The label the API sends for `offering`, built with the SERVER's
        `offering_label` rather than re-spelled here."""
        from app.modules.offerings.labels import offering_label

        return offering_label(self.subject.code, offering.section_code)


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


def _book(client, graph, cs_id=None, headers=None, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{G}/offering/{cs_id or graph.cs.id}" + (f"?{query}" if query else "")
    return client.get(url, headers=headers or graph.H)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_picker_requires_auth(self, client) -> None:
        assert client.get(f"{G}/offerings").status_code == 401

    def test_gradebook_requires_auth(self, client) -> None:
        assert client.get(f"{G}/offering/{uuid.uuid4()}").status_code == 401

    def test_write_requires_auth(self, client) -> None:
        assert client.put(f"{A}/{uuid.uuid4()}/grades", json={"entries": []}).status_code == 401

    def test_me_requires_auth(self, client) -> None:
        assert client.get(f"{G}/me").status_code == 401

    def test_term_requires_auth(self, client) -> None:
        assert client.get(f"{G}/term").status_code == 401

    def test_student_forbidden_on_picker(self, client, graph) -> None:
        s, _ = graph.student(with_login=True)
        r = client.get(f"{G}/offerings", headers=graph.student_headers(s))
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_student_forbidden_on_gradebook(self, client, graph) -> None:
        s, _ = graph.student(with_login=True)
        assert _book(client, graph, headers=graph.student_headers(s)).status_code == 403

    def test_principal_forbidden_on_write(self, client, graph) -> None:
        """P/S are view-all on grades; entry is the teacher's job (OQ-API-2)."""
        a = graph.assessment()
        r = client.put(f"{A}/{a.id}/grades", json={"entries": []}, headers=graph.P)
        assert r.status_code == 403

    def test_secretary_forbidden_on_write(self, client, graph) -> None:
        a = graph.assessment()
        assert client.put(f"{A}/{a.id}/grades", json={"entries": []}, headers=graph.S).status_code == 403

    def test_non_student_forbidden_on_me(self, client, graph) -> None:
        assert client.get(f"{G}/me", headers=graph.H).status_code == 403
        assert client.get(f"{G}/me", headers=graph.P).status_code == 403


# ════════════════════════════════════════════════════════════════════════════
class TestOfferingPicker:
    def test_teacher_sees_only_owned_offerings(self, client, graph) -> None:
        body = client.get(f"{G}/offerings", headers=graph.H).json()
        ids = {i["offering"]["id"] for i in body["items"]}
        assert str(graph.cs.id) in ids
        assert str(graph.other_cs.id) not in ids

    def test_principal_sees_all_offerings_in_the_year(self, client, graph) -> None:
        ids = {i["offering"]["id"] for i in client.get(f"{G}/offerings", headers=graph.P).json()["items"]}
        assert {str(graph.cs.id), str(graph.other_cs.id)} <= ids

    def test_year_filter_excludes_other_years(self, client, graph, db_session) -> None:
        other_year = AcademicYear(
            name=f"Other {graph.tag}", start_date=date(2024, 9, 1), end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        db_session.add(other_year)
        db_session.flush()
        url = f"{G}/offerings?academic_year_id={other_year.id}"
        assert client.get(url, headers=graph.P).json()["items"] == []

    def test_inactive_offering_is_still_listed(self, client, graph, db_session) -> None:
        """Past-year offerings are inactive; the year switcher must still list them.

        This is the one place Grades deliberately diverges from the Assessments
        picker, which DOES filter `is_active`.
        """
        graph.cs.is_active = False
        db_session.flush()
        ids = {i["offering"]["id"] for i in client.get(f"{G}/offerings", headers=graph.H).json()["items"]}
        assert str(graph.cs.id) in ids

    def test_soft_deleted_offering_is_excluded(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        graph.cs.deleted_at = utcnow()
        db_session.flush()
        ids = {i["offering"]["id"] for i in client.get(f"{G}/offerings", headers=graph.P).json()["items"]}
        assert str(graph.cs.id) not in ids

    def test_assessment_count_counts_live_assessments(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        graph.assessment()
        graph.assessment()
        gone = graph.assessment()
        gone.deleted_at = utcnow()
        db_session.flush()
        item = next(i for i in client.get(f"{G}/offerings", headers=graph.H).json()["items"]
                    if i["offering"]["id"] == str(graph.cs.id))
        assert item["assessment_count"] == 2

    def test_can_edit_true_for_teacher_false_for_principal(self, client, graph) -> None:
        mine = next(i for i in client.get(f"{G}/offerings", headers=graph.H).json()["items"]
                    if i["offering"]["id"] == str(graph.cs.id))
        theirs = next(i for i in client.get(f"{G}/offerings", headers=graph.P).json()["items"]
                      if i["offering"]["id"] == str(graph.cs.id))
        assert mine["can_edit"] is True
        assert theirs["can_edit"] is False

    def test_ref_is_the_SHARED_offering_ref_plus_staffing(self, client, graph) -> None:
        """D31 replaced this file's "Grades keys its ref on `id`, Attendance does not" test.

        Three modules each defining their own offering ref was survivable while the ref
        merely wrapped two rows. The label is DERIVED now, so three private derivations
        would drift — and the screens are where the drift would show. The ref is shared;
        what stays local is the STAFFING the gradebook needs and Attendance shapes
        differently (`full_name` here, `name` there — still deliberately not the same).
        """
        item = next(i for i in client.get(f"{G}/offerings", headers=graph.H).json()["items"]
                    if i["offering"]["id"] == str(graph.cs.id))
        assert item["offering"]["label"] == graph.label(graph.cs)
        assert item["offering"]["course"]["id"] == str(graph.subject.id)
        assert item["lead_teacher_id"] == str(graph.teacher.id)
        assert item["teachers"][0]["full_name"] == "Owner Teacher"
        # The homeroom ref is gone entirely, not renamed.
        assert "section" not in item and "display_name" not in item

    def test_teacher_with_no_offerings_gets_empty_list(self, client, graph, make_user, auth_headers, db_session) -> None:
        user = make_user(role=Role.TEACHER)
        db_session.add(TeacherProfile(
            user_id=user.id, staff_number=f"N-{graph.tag}", full_name="No Classes",
            status=TeacherStatus.ACTIVE,
        ))
        db_session.flush()
        headers = auth_headers(user_id=user.id, role=Role.TEACHER)
        assert client.get(f"{G}/offerings", headers=headers).json()["items"] == []


# ════════════════════════════════════════════════════════════════════════════
class TestGradebookRead:
    def test_unknown_offering_404(self, client, graph) -> None:
        r = _book(client, graph, cs_id=uuid.uuid4())
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_non_owning_teacher_404_not_403(self, client, graph) -> None:
        """No existence leak: a teacher must not learn the offering exists."""
        r = _book(client, graph, cs_id=graph.other_cs.id, headers=graph.H)
        assert r.status_code == 404

    def test_principal_reads_with_can_edit_false(self, client, graph) -> None:
        body = _book(client, graph, headers=graph.P).json()
        assert body["can_edit"] is False
        assert body["viewer_role"] == "principal"

    def test_teacher_reads_with_can_edit_true(self, client, graph) -> None:
        body = _book(client, graph).json()
        assert body["can_edit"] is True
        assert body["viewer_role"] == "teacher"

    def test_every_row_gets_a_cell_per_assessment_defaulting_to_pending(self, client, graph) -> None:
        a1, a2 = graph.assessment(), graph.assessment()
        graph.student()
        body = _book(client, graph).json()
        row = body["rows"][0]
        assert {c["assessment_id"] for c in row["cells"]} == {str(a1.id), str(a2.id)}
        assert all(c["status"] == "pending" and c["score"] is None for c in row["cells"])

    def test_drafts_appear_as_non_editable_columns(self, client, graph) -> None:
        draft = graph.assessment(status="draft")
        live = graph.assessment(status="graded")
        by_id = {a["id"]: a for a in _book(client, graph).json()["assessments"]}
        assert by_id[str(draft.id)]["is_editable"] is False
        assert by_id[str(live.id)]["is_editable"] is True

    def test_graded_and_entered_counts(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s1, e1 = graph.student()
        s2, e2 = graph.student()
        s3, e3 = graph.student()
        graph.grade(a, s1, e1, status="graded", score="15")
        graph.grade(a, s2, e2, status="absent", score=None)
        graph.grade(a, s3, e3, status="pending", score=None)
        item = next(x for x in _book(client, graph).json()["assessments"] if x["id"] == str(a.id))
        assert item["graded_count"] == 1
        assert item["entered_count"] == 2  # graded + absent, not pending

    def test_cell_release_inherits_assessment_when_row_is_null(self, client, graph) -> None:
        a = graph.assessment(is_released=True)
        s, e = graph.student()
        graph.grade(a, s, e, is_released=None)
        cell = _book(client, graph).json()["rows"][0]["cells"][0]
        assert cell["is_released"] is True

    def test_per_row_release_override_wins(self, client, graph) -> None:
        a = graph.assessment(is_released=True)
        s, e = graph.student()
        graph.grade(a, s, e, is_released=False)
        cell = _book(client, graph).json()["rows"][0]["cells"][0]
        assert cell["is_released"] is False

    def test_letter_present_only_for_graded_with_score(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s1, e1 = graph.student(name="AAA Graded")
        s2, e2 = graph.student(name="BBB Absent")
        graph.grade(a, s1, e1, status="graded", score="18")  # 90% -> A
        graph.grade(a, s2, e2, status="absent", score=None)
        rows = {r["student"]["full_name"]: r for r in _book(client, graph).json()["rows"]}
        assert rows["AAA Graded"]["cells"][0]["letter"] == "A"
        # `letter?: string` on the wire — the key is ABSENT, not null.
        assert "letter" not in rows["BBB Absent"]["cells"][0]

    def test_unenrolled_student_with_a_grade_still_gets_a_row(self, client, graph, db_session) -> None:
        """M3 union — dropping a student must not make their marks vanish."""
        a = graph.assessment(max_score="20")
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="12")
        from app.core.timeutil import utcnow

        e.unenrolled_at = utcnow()
        db_session.flush()

        row = next(r for r in _book(client, graph).json()["rows"] if r["student"]["id"] == str(s.id))
        assert row["is_active_member"] is False
        assert row["enrollment_id"] is None
        assert row["cells"][0]["score"] == 12.0

    def test_active_members_sort_before_non_members(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        a = graph.assessment()
        active, _ = graph.student(name="ZZZ Active")
        dropped, dropped_enr = graph.student(name="AAA Dropped")
        graph.grade(a, dropped, dropped_enr, status="graded", score="10")
        dropped_enr.unenrolled_at = utcnow()
        db_session.flush()
        names = [r["student"]["full_name"] for r in _book(client, graph).json()["rows"]]
        # Active first despite sorting later alphabetically.
        assert names.index("ZZZ Active") < names.index("AAA Dropped")

    def test_freshly_enrolled_student_gets_all_pending_cells(self, client, graph) -> None:
        graph.assessment()
        graph.assessment()
        s, _ = graph.student()
        row = next(r for r in _book(client, graph).json()["rows"] if r["student"]["id"] == str(s.id))
        assert row["is_active_member"] is True
        assert all(c["status"] == "pending" for c in row["cells"])

    def test_semester_resolves_to_the_sections_own_year(self, client, graph, db_session) -> None:
        """The load-bearing one.

        A second year holds the globally-active semester. Reading the gradebook of
        a section in the FIRST year must still resolve that year's own semester —
        otherwise the assessment list comes back empty.
        """
        graph.sem.is_active = False
        db_session.flush()
        other_year = AcademicYear(
            name=f"Newer {graph.tag}", start_date=date(2026, 9, 1), end_date=date(2027, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        db_session.add(other_year)
        db_session.flush()
        db_session.add(Semester(
            academic_year_id=other_year.id, name="Semester 1", sequence=1,
            start_date=date(2026, 9, 1), end_date=date(2027, 1, 31), is_active=True,
        ))
        db_session.flush()

        a = graph.assessment()
        body = _book(client, graph).json()
        assert body["semester"]["id"] == str(graph.sem.id)
        assert [x["id"] for x in body["assessments"]] == [str(a.id)]

    def test_explicit_semester_param_is_honoured(self, client, graph, db_session) -> None:
        sem2 = Semester(
            academic_year_id=graph.year.id, name="Semester 2", sequence=2,
            start_date=date(2026, 2, 1), end_date=date(2026, 6, 30), is_active=False,
        )
        db_session.add(sem2)
        db_session.flush()
        in_s1 = graph.assessment()
        in_s2 = graph.assessment(semester_id=sem2.id)
        body = _book(client, graph, semester_id=sem2.id).json()
        ids = [x["id"] for x in body["assessments"]]
        assert ids == [str(in_s2.id)]
        assert str(in_s1.id) not in ids

    def test_assessments_ordered_by_date_with_undated_last(self, client, graph) -> None:
        late = graph.assessment(assessment_date=date(2025, 11, 1), title="late")
        early = graph.assessment(assessment_date=date(2025, 10, 1), title="early")
        undated = graph.assessment(assessment_date=None, title="undated")
        ids = [x["id"] for x in _book(client, graph).json()["assessments"]]
        assert ids == [str(early.id), str(late.id), str(undated.id)]

    def test_term_grade_reconciles_with_a_hand_computed_value(self, client, graph) -> None:
        a1 = graph.assessment(max_score="100", weight="3")
        a2 = graph.assessment(max_score="100", weight="1")
        s, e = graph.student()
        graph.grade(a1, s, e, status="graded", score="90")
        graph.grade(a2, s, e, status="graded", score="50")
        row = _book(client, graph).json()["rows"][0]
        # (90*3 + 50*1) / 4 = 80.00 -> B
        assert row["term_numeric"] == 80.0
        assert row["term_letter"] == "B"

    def test_category_weights_drive_a_two_level_rollup(self, client, graph) -> None:
        """The documented model (schema §10.2c), NOT the demo's flat mean."""
        exams = graph.category(weight="70")
        homework = graph.category(weight="30")
        a1 = graph.assessment(max_score="100", weight="1", category_id=exams.id)
        a2 = graph.assessment(max_score="100", weight="1", category_id=homework.id)
        s, e = graph.student()
        graph.grade(a1, s, e, status="graded", score="60")
        graph.grade(a2, s, e, status="graded", score="100")
        row = _book(client, graph).json()["rows"][0]
        # 60*0.7 + 100*0.3 = 72, not the flat mean of 80.
        assert row["term_numeric"] == 72.0

    def test_drop_lowest_applied_flag_and_effect(self, client, graph) -> None:
        cat = graph.category(weight="100", drop=1)
        for score in ("40", "80", "90"):
            a = graph.assessment(max_score="100", weight="1", category_id=cat.id)
            if not hasattr(graph, "_dl_student"):
                graph._dl_student = graph.student()
            s, e = graph._dl_student
            graph.grade(a, s, e, status="graded", score=score)
        body = _book(client, graph).json()
        assert body["drop_lowest_applied"] is True
        row = next(r for r in body["rows"] if r["student"]["id"] == str(graph._dl_student[0].id))
        assert row["term_numeric"] == 85.0  # 40 dropped

    def test_categories_are_reported_with_resolved_drop_counts(self, client, graph, set_assessment_policy) -> None:
        set_assessment_policy(drop_lowest_count=2)
        cat = graph.category(weight="100", drop=None)  # inherits from school
        body = _book(client, graph).json()
        item = next(c for c in body["categories"] if c["id"] == str(cat.id))
        assert item["drop_lowest_count"] == 2

    def test_empty_gradebook_is_a_valid_response(self, client, graph) -> None:
        body = _book(client, graph).json()
        assert body["assessments"] == []
        assert body["rows"] == []
        assert body["offering"]["offering"]["id"] == str(graph.cs.id)


# ════════════════════════════════════════════════════════════════════════════
class TestGradeEntry:
    def test_happy_path_returns_updated_with_letters(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        body = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 18}]},
            headers=graph.H,
        ).json()
        assert body["updated"][0]["student_id"] == str(s.id)
        assert body["updated"][0]["score"] == 18.0
        assert body["updated"][0]["letter"] == "A"  # 90%

    def test_update_in_place_does_not_duplicate_rows(self, client, graph, db_session) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        payload = {"entries": [{"student_id": str(s.id), "status": "graded", "score": 10}]}
        client.put(f"{A}/{a.id}/grades", json=payload, headers=graph.H)
        payload["entries"][0]["score"] = 15
        client.put(f"{A}/{a.id}/grades", json=payload, headers=graph.H)
        count = db_session.scalar(
            select(func.count()).select_from(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id, AssessmentGrade.student_id == s.id
            )
        )
        row = db_session.scalar(
            select(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id, AssessmentGrade.student_id == s.id
            )
        )
        assert count == 1
        assert row.score == Decimal("15.00")

    def test_unknown_assessment_404(self, client, graph) -> None:
        r = client.put(f"{A}/{uuid.uuid4()}/grades", json={"entries": []}, headers=graph.H)
        assert r.status_code == 404

    def test_non_owning_teacher_404(self, client, graph) -> None:
        a = graph.assessment(cs_id=graph.other_cs.id)
        r = client.put(f"{A}/{a.id}/grades", json={"entries": []}, headers=graph.H)
        assert r.status_code == 404

    def test_archived_year_409(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        a = graph.assessment()
        s, _ = graph.student()
        graph.year.archived_at = utcnow()
        db_session.flush()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 10}]},
            headers=graph.H,
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

    def test_duplicate_student_422(self, client, graph) -> None:
        a = graph.assessment()
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [
                {"student_id": str(s.id), "status": "graded", "score": 10},
                {"student_id": str(s.id), "status": "graded", "score": 12},
            ]},
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="duplicate_entry")
        assert str(s.id) in err["fields"]["student_id"]

    def test_not_enrolled_lists_every_offender(self, client, graph) -> None:
        a = graph.assessment()
        ok, _ = graph.student()
        bad1, _ = graph.student(enroll=False)
        bad2, _ = graph.student(enroll=False)
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [
                {"student_id": str(ok.id), "status": "graded", "score": 10},
                {"student_id": str(bad1.id), "status": "graded", "score": 10},
                {"student_id": str(bad2.id), "status": "graded", "score": 10},
            ]},
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="student_not_enrolled")
        assert set(err["fields"]["student_id"]) == {str(bad1.id), str(bad2.id)}

    def test_score_above_max_422(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 25}]},
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="score_exceeds_max")
        assert "20" in err["message"]

    def test_negative_score_422(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": -1}]},
            headers=graph.H,
        )
        assert r.status_code == 422

    def test_graded_with_null_score_422(self, client, graph) -> None:
        a = graph.assessment()
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": None}]},
            headers=graph.H,
        )
        assert r.status_code == 422
        _assert_envelope(r.json(), code="score_exceeds_max")

    def test_score_on_non_graded_status_422(self, client, graph) -> None:
        a = graph.assessment()
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "excused", "score": 5}]},
            headers=graph.H,
        )
        assert r.status_code == 422
        _assert_envelope(r.json(), code="score_status_conflict")

    def test_makeup_on_non_absent_status_422(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 10, "makeup_score": 5}]},
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="makeup_not_allowed")
        assert "absent" in err["message"].lower()

    def test_makeup_rejected_when_policy_disables_it(self, client, graph, db_session) -> None:
        """Resolved via the full §10.2a chain — set at the ASSESSMENT level here."""
        a = graph.assessment(max_score="20")
        a.allow_makeup = False
        db_session.flush()
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "absent", "makeup_score": 15}]},
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="makeup_not_allowed")
        assert "policy" in err["message"].lower()

    def test_makeup_above_max_422(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "absent", "makeup_score": 99}]},
            headers=graph.H,
        )
        assert r.status_code == 422
        _assert_envelope(r.json(), code="score_exceeds_max")

    def test_valid_makeup_is_accepted(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        body = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "absent", "makeup_score": 15}]},
            headers=graph.H,
        ).json()
        assert body["updated"][0]["makeup_score"] == 15.0
        assert body["updated"][0]["score"] is None

    def test_all_or_nothing_one_bad_entry_writes_nothing(self, client, graph, db_session) -> None:
        a = graph.assessment(max_score="20")
        good = [graph.student() for _ in range(4)]
        bad, _ = graph.student(enroll=False)
        entries = [{"student_id": str(s.id), "status": "graded", "score": 10} for s, _ in good]
        entries.append({"student_id": str(bad.id), "status": "graded", "score": 10})

        r = client.put(f"{A}/{a.id}/grades", json={"entries": entries}, headers=graph.H)
        assert r.status_code == 422
        written = db_session.scalar(
            select(func.count()).select_from(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id
            )
        )
        assert written == 0

    def test_graded_at_and_updated_by_are_stamped(self, client, graph, db_session) -> None:
        a = graph.assessment(max_score="20")
        s, _ = graph.student()
        client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 12}]},
            headers=graph.H,
        )
        row = db_session.scalar(
            select(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id, AssessmentGrade.student_id == s.id
            )
        )
        assert row.graded_at is not None
        assert row.updated_by == graph.teacher_user.id
        assert row.enrollment_id is not None

    def test_switching_to_pending_clears_the_score(self, client, graph, db_session) -> None:
        a = graph.assessment(max_score="20")
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="18")
        client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "pending"}]},
            headers=graph.H,
        )
        db_session.expire_all()
        row = db_session.scalar(
            select(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id, AssessmentGrade.student_id == s.id
            )
        )
        assert row.status.value == "pending"
        assert row.score is None

    def test_release_state_survives_a_grade_edit(self, client, graph, db_session) -> None:
        """Releasing is its own endpoint; entry must not silently unrelease."""
        a = graph.assessment(max_score="20", is_released=True)
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="10", is_released=True)
        client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 12}]},
            headers=graph.H,
        )
        db_session.expire_all()
        row = db_session.scalar(
            select(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id, AssessmentGrade.student_id == s.id
            )
        )
        assert row.is_released is True

    def test_unknown_field_in_entry_rejected(self, client, graph) -> None:
        a = graph.assessment()
        s, _ = graph.student()
        r = client.put(
            f"{A}/{a.id}/grades",
            json={"entries": [{"student_id": str(s.id), "status": "graded", "score": 1, "nope": 1}]},
            headers=graph.H,
        )
        assert r.status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestRelease:
    def test_whole_column_release_resets_per_row_overrides(self, client, graph, db_session) -> None:
        """The latent bug this change fixes.

        The read path is `grade.is_released ?? assessment.is_released`, so a row
        left at False by an earlier per-student unrelease would keep overriding the
        column and stay hidden after a whole-assessment release.
        """
        a = graph.assessment(max_score="20", is_released=False)
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="10", is_released=False)

        r = client.post(f"{A}/{a.id}/release", headers=graph.H)
        assert r.status_code == 200
        db_session.expire_all()
        row = db_session.scalar(select(AssessmentGrade).where(AssessmentGrade.assessment_id == a.id))
        assert row.is_released is None  # reset, so the column now governs
        cell = _book(client, graph).json()["rows"][0]["cells"][0]
        assert cell["is_released"] is True

    def test_released_count_matches_grade_rows(self, client, graph) -> None:
        a = graph.assessment(max_score="20")
        for _ in range(3):
            s, e = graph.student()
            graph.grade(a, s, e, status="graded", score="10")
        body = client.post(f"{A}/{a.id}/release", headers=graph.H).json()
        assert body["released_count"] == 3
        assert body["is_released"] is True

    def test_per_student_release_flips_only_named_rows(self, client, graph, db_session) -> None:
        a = graph.assessment(max_score="20", is_released=False)
        s1, e1 = graph.student()
        s2, e2 = graph.student()
        graph.grade(a, s1, e1, status="graded", score="10")
        graph.grade(a, s2, e2, status="graded", score="12")

        body = client.post(
            f"{A}/{a.id}/release", json={"student_ids": [str(s1.id)]}, headers=graph.H
        ).json()
        assert body["released_count"] == 1
        # The assessment column is deliberately untouched by a per-student call.
        assert body["is_released"] is False
        db_session.expire_all()
        rows = {g.student_id: g for g in db_session.scalars(
            select(AssessmentGrade).where(AssessmentGrade.assessment_id == a.id)
        ).all()}
        assert rows[s1.id].is_released is True
        assert rows[s2.id].is_released is None

    def test_per_student_unrelease_mirrors(self, client, graph, db_session) -> None:
        a = graph.assessment(max_score="20", is_released=True)
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="10")
        client.post(f"{A}/{a.id}/unrelease", json={"student_ids": [str(s.id)]}, headers=graph.H)
        db_session.expire_all()
        row = db_session.scalar(select(AssessmentGrade).where(AssessmentGrade.assessment_id == a.id))
        assert row.is_released is False

    def test_no_body_still_works_backwards_compatible(self, client, graph) -> None:
        """The frontend sends no body; existing callers must not break."""
        a = graph.assessment()
        assert client.post(f"{A}/{a.id}/release", headers=graph.H).status_code == 200
        assert client.post(f"{A}/{a.id}/unrelease", headers=graph.H).status_code == 200

    def test_release_on_archived_year_409(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        a = graph.assessment()
        graph.year.archived_at = utcnow()
        db_session.flush()
        r = client.post(f"{A}/{a.id}/release", headers=graph.H)
        assert r.status_code == 409

    def test_release_by_non_owner_404(self, client, graph) -> None:
        a = graph.assessment(cs_id=graph.other_cs.id)
        assert client.post(f"{A}/{a.id}/release", headers=graph.H).status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestMyGrades:
    def test_only_released_assessments_appear(self, client, graph) -> None:
        shown = graph.assessment(max_score="20", is_released=True)
        hidden = graph.assessment(max_score="20", is_released=False)
        s, e = graph.student(with_login=True)
        graph.grade(shown, s, e, status="graded", score="18")
        graph.grade(hidden, s, e, status="graded", score="4")

        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in body["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        ids = {x["assessment_id"] for x in subject["assessments"]}
        assert str(shown.id) in ids
        assert str(hidden.id) not in ids

    def test_released_but_pending_is_excluded(self, client, graph) -> None:
        a = graph.assessment(is_released=True)
        s, e = graph.student(with_login=True)
        graph.grade(a, s, e, status="pending", score=None)
        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in body["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        assert subject["assessments"] == []

    def test_per_row_release_exposes_an_unreleased_assessment(self, client, graph) -> None:
        a = graph.assessment(max_score="20", is_released=False)
        s, e = graph.student(with_login=True)
        graph.grade(a, s, e, status="graded", score="18", is_released=True)
        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in body["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        assert [x["assessment_id"] for x in subject["assessments"]] == [str(a.id)]

    def test_score_is_null_for_a_non_graded_status(self, client, graph) -> None:
        a = graph.assessment(max_score="20", is_released=True)
        s, e = graph.student(with_login=True)
        graph.grade(a, s, e, status="absent", score=None)
        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in body["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        item = subject["assessments"][0]
        assert item["status"] == "absent"
        assert item["score"] is None
        assert "letter" not in item

    def test_teacher_is_the_lead(self, client, graph) -> None:
        graph.assessment(is_released=True)
        s, _ = graph.student(with_login=True)
        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in body["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        assert subject["teacher"]["full_name"] == "Owner Teacher"

    def test_student_without_a_profile_404(self, client, graph, make_user, auth_headers) -> None:
        user = make_user(role=Role.STUDENT)
        r = client.get(f"{G}/me", headers=auth_headers(user_id=user.id, role=Role.STUDENT))
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_student_ref_shape(self, client, graph) -> None:
        s, _ = graph.student(with_login=True, name="Ana Lopez")
        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        assert body["student"]["full_name"] == "Ana Lopez"
        assert set(body["student"].keys()) == {"id", "full_name", "student_number"}

    def test_term_average_reconciles_with_the_teachers_gradebook(self, client, graph) -> None:
        """Same data, both views: the student's number must equal the teacher's.

        This is the assertion that would catch copying the mock's simplified
        student-side math, which skips the absent/makeup policy.
        """
        a1 = graph.assessment(max_score="100", weight="1", is_released=True)
        a2 = graph.assessment(max_score="100", weight="1", is_released=True)
        s, e = graph.student(with_login=True)
        graph.grade(a1, s, e, status="graded", score="90")
        graph.grade(a2, s, e, status="graded", score="70")

        teacher_row = next(
            r for r in _book(client, graph).json()["rows"] if r["student"]["id"] == str(s.id)
        )
        mine = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in mine["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        assert teacher_row["term_numeric"] == 80.0
        assert subject["term_numeric"] == teacher_row["term_numeric"]
        assert subject["term_letter"] == teacher_row["term_letter"]

    def test_unreleased_work_lowers_only_the_teachers_view(self, client, graph) -> None:
        released = graph.assessment(max_score="100", weight="1", is_released=True)
        secret = graph.assessment(max_score="100", weight="1", is_released=False)
        s, e = graph.student(with_login=True)
        graph.grade(released, s, e, status="graded", score="90")
        graph.grade(secret, s, e, status="graded", score="10")

        teacher_row = next(
            r for r in _book(client, graph).json()["rows"] if r["student"]["id"] == str(s.id)
        )
        mine = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        subject = next(x for x in mine["by_subject"] if x["offering"]["offering"]["id"] == str(graph.cs.id))
        assert teacher_row["term_numeric"] == 50.0
        assert subject["term_numeric"] == 90.0

    def test_inactive_offering_still_listed_for_a_past_year(self, client, graph, db_session) -> None:
        graph.cs.is_active = False
        db_session.flush()
        graph.assessment(is_released=True)
        s, _ = graph.student(with_login=True)
        body = client.get(f"{G}/me", headers=graph.student_headers(s)).json()
        assert str(graph.cs.id) in {x["offering"]["offering"]["id"] for x in body["by_subject"]}


# ════════════════════════════════════════════════════════════════════════════
class TestTermEndpoint:
    def test_student_is_scoped_to_self(self, client, graph) -> None:
        a = graph.assessment(max_score="100", is_released=True)
        me, my_enr = graph.student(with_login=True)
        other, other_enr = graph.student()
        graph.grade(a, me, my_enr, status="graded", score="80")
        graph.grade(a, other, other_enr, status="graded", score="30")

        body = client.get(f"{G}/term", headers=graph.student_headers(me)).json()
        student_ids = {i["student"]["id"] for i in body["items"]}
        assert student_ids == {str(me.id)}

    def test_teacher_can_read_an_owned_offering(self, client, graph) -> None:
        a = graph.assessment(max_score="100")
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="75")
        body = client.get(
            f"{G}/term?offering_id={graph.cs.id}", headers=graph.H
        ).json()
        item = next(i for i in body["items"] if i["student"]["id"] == str(s.id))
        assert item["numeric"] == 75.0
        assert item["letter"] == "C"
        assert item["is_frozen"] is False
        assert item["weight_base_used"] == 1.0

    def test_teacher_reading_an_unowned_offering_404(self, client, graph) -> None:
        r = client.get(f"{G}/term?offering_id={graph.other_cs.id}", headers=graph.H)
        assert r.status_code == 404

    def test_principal_can_read_any_offering(self, client, graph) -> None:
        a = graph.assessment(max_score="100")
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="65")
        body = client.get(f"{G}/term?offering_id={graph.cs.id}", headers=graph.P).json()
        assert any(i["student"]["id"] == str(s.id) for i in body["items"])

    def test_archived_year_reads_the_frozen_snapshot(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        a = graph.assessment(max_score="100")
        s, e = graph.student()
        graph.grade(a, s, e, status="graded", score="20")  # live compute would say 20

        db_session.add(TermGradeSnapshot(
            student_id=s.id, offering_id=graph.cs.id, semester_id=graph.sem.id,
            subject_id=graph.subject.id, numeric_grade=Decimal("88.00"), letter_grade="B",
            weight_base_used=Decimal("3.00"),
            effective_policy={"absent_as_zero": True, "allow_makeup": False, "drop_lowest_count": 1},
        ))
        graph.year.archived_at = utcnow()
        graph.year.status = AcademicYearStatus.ARCHIVED
        db_session.flush()

        body = client.get(f"{G}/term?offering_id={graph.cs.id}", headers=graph.P).json()
        item = next(i for i in body["items"] if i["student"]["id"] == str(s.id))
        assert item["is_frozen"] is True
        assert item["numeric"] == 88.0  # the snapshot wins over live compute
        assert item["letter"] == "B"
        assert item["effective_policy"]["drop_lowest_count"] == 1

    def test_student_without_a_profile_404(self, client, graph, make_user, auth_headers) -> None:
        user = make_user(role=Role.STUDENT)
        r = client.get(f"{G}/term", headers=auth_headers(user_id=user.id, role=Role.STUDENT))
        assert r.status_code == 404

    def test_scope_me_rejects_a_bad_value(self, client, graph) -> None:
        assert client.get(f"{G}/term?scope=everyone", headers=graph.P).status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestGradebookTermIsTheOfferings:
    """D31 — an offering's gradebook shows THE OFFERING'S term, not its year's.

    `_semester_for_section` used to reason from the academic YEAR (that year's active
    semester, else its `sequence=1` term) because `classes` carried no semester and the
    term genuinely had to be guessed. `course_offerings.semester_id` makes the guess both
    unnecessary and wrong, and the D31 demo seed is what exposed it: a Semester-2 offering
    resolved to Semester 1, `_assessments_for` then filtered on that semester, and the
    offering's own assessments and roster BOTH matched nothing — an empty gradebook with no
    error anywhere.
    """

    def _second_term_offering(self, graph, db):
        """An offering of a new course in Semester 2 of the SAME (active) year."""
        sem2 = Semester(
            academic_year_id=graph.year.id, name="Semester 2", sequence=2,
            start_date=date(2026, 2, 2), end_date=date(2026, 6, 30), is_active=False,
        )
        course = Course(name=f"S2 {graph.tag}", code=f"S2{graph.tag[:4].upper()}")
        db.add_all([sem2, course])
        db.flush()
        off = CourseOffering(
            course_id=course.id, semester_id=sem2.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db.add(off)
        db.flush()
        db.add(ClassTeacher(offering_id=off.id, teacher_id=graph.teacher.id, is_lead=True))
        db.flush()
        return off, sem2

    def test_a_second_term_offering_shows_its_own_assessments(
        self, client, graph, db_session
    ) -> None:
        off, sem2 = self._second_term_offering(graph, db_session)
        graph.assessment(cs_id=off.id, semester_id=sem2.id, title="S2 Quiz")

        body = _book(client, graph, cs_id=off.id).json()
        assert body["semester"]["id"] == str(sem2.id), (
            "the gradebook resolved a different term than the offering's own"
        )
        titles = [a["title"] for a in body["assessments"]]
        assert titles == ["S2 Quiz"], titles

    def test_a_second_term_offering_shows_its_own_roster(
        self, client, graph, db_session
    ) -> None:
        """The roster is filtered by the resolved term too, so it vanished with the
        assessments — an offering with 23 enrolments rendered zero rows."""
        off, sem2 = self._second_term_offering(graph, db_session)
        graph.assessment(cs_id=off.id, semester_id=sem2.id)
        student, _enr = graph.student(enroll=False)
        db_session.add(ClassEnrollment(
            offering_id=off.id, student_id=student.id, semester_id=sem2.id,
        ))
        db_session.flush()

        body = _book(client, graph, cs_id=off.id).json()
        assert [r["student"]["id"] for r in body["rows"]] == [str(student.id)]

    def test_an_explicit_semester_id_still_wins(self, client, graph, db_session) -> None:
        """The query parameter is unchanged — only the DEFAULT moved to the offering."""
        off, sem2 = self._second_term_offering(graph, db_session)
        graph.assessment(cs_id=off.id, semester_id=sem2.id)

        body = _book(client, graph, cs_id=off.id, semester_id=graph.sem.id).json()
        assert body["semester"]["id"] == str(graph.sem.id)
        assert body["assessments"] == [], (
            "asking for a term the offering does not run in is a contradictory question; "
            "it answers empty rather than silently substituting another term"
        )

    def test_the_active_terms_gradebook_is_unchanged(self, client, graph) -> None:
        """The common case still resolves to the active term, which is now simply the
        offering's own."""
        graph.assessment(title="S1 Quiz")
        body = _book(client, graph).json()
        assert body["semester"]["id"] == str(graph.sem.id)
        assert [a["title"] for a in body["assessments"]] == ["S1 Quiz"]

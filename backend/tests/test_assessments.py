"""Comprehensive pytest suite for Module 6 — ASSESSMENTS + categories (api-spec §6).

Scope: assessment CRUD + the D47 marking window + picker feed + per-class_subject
categories, with negative / edge / security paths.

Writes are teacher-only (+ ownership); reads are scoped (P/S all, Teacher own,
Student enrolled). Hermetic + rolled-back via the `db_session` fixture:
each test builds its own writable year + section + subject + class_subject and a
teacher that OWNS it (class_teachers row), then exercises the endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.core.timeutil import school_today
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

A = "/api/v1/assessments"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


def _cat_path(offering_id, cat_id=None) -> str:
    # D31: categories hang off the OFFERING. The old path threaded a homeroom id AND a
    # class_subject id to reach one gradebook.
    base = f"/api/v1/offerings/{offering_id}/categories"
    return f"{base}/{cat_id}" if cat_id else base


class _Graph:
    """A writable year + section + subject + class_subject + owning teacher."""

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.year = AcademicYear(
            name=f"AsmtYear {tag}", start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
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
        # owning teacher
        self.teacher_user = make_user(role=Role.TEACHER)
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id, staff_number=f"T-{tag}",
            full_name="Owner Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()
        db_session.add(ClassTeacher(offering_id=self.cs.id, teacher_id=self.teacher.id, is_lead=True))
        db_session.flush()
        self.H = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self._db = db_session

    def assessment(self, *, max_score="20", category_id=None, assessment_date=None) -> Assessment:
        a = Assessment(
            offering_id=self.cs.id, semester_id=self.sem.id, category_id=category_id,
            title=f"A {uuid.uuid4().hex[:5]}", max_score=Decimal(max_score),
            weight=Decimal("1.00"), assessment_date=assessment_date,
        )
        self._db.add(a)
        self._db.flush()
        return a

    def category(self, *, name=None, weight="0.5", drop=0) -> AssessmentCategory:
        c = AssessmentCategory(
            offering_id=self.cs.id, name=name or f"Cat {uuid.uuid4().hex[:5]}",
            weight=Decimal(weight), drop_lowest_count=drop,
        )
        self._db.add(c)
        self._db.flush()
        return c

    def enrolled_student(self):
        s = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}", **split_name(f"Stu {uuid.uuid4().hex[:4]}"),
            date_of_birth=date(2012, 1, 1), enrollment_date=date(2025, 9, 1), status="Active",
        )
        self._db.add(s)
        self._db.flush()
        enr = ClassEnrollment(offering_id=self.section.id, student_id=s.id, semester_id=self.sem.id)
        self._db.add(enr)
        self._db.flush()
        return s, enr

    def grade(self, assessment_id, student_id, enrollment_id, *, status="graded", score="18"):
        from app.modules.grades.models import AssessmentGrade
        g = AssessmentGrade(
            assessment_id=assessment_id, student_id=student_id, enrollment_id=enrollment_id,
            status=status, score=(Decimal(score) if score is not None else None),
        )
        self._db.add(g)
        self._db.flush()
        return g


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_list_requires_auth(self, client) -> None:
        assert client.get(A).status_code == 401

    def test_principal_cannot_create(self, client, graph, make_user, auth_headers) -> None:
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(A, headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL),
                        json={"offering_id": str(graph.cs.id), "title": "X",
                              "max_score": 10})
        assert r.status_code == 403


class TestCreate:
    def test_create_ok_is_live_with_an_open_window(self, client, graph) -> None:
        """D47 — no draft, no release: an assessment is gradable from creation."""
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "Quiz 1", "max_score": 25, "weight": 1})
        assert r.status_code == 201, r.text
        b = r.json()
        assert "status" not in b and "is_released" not in b
        assert b["marking_open"] is True and b["days_left"] == 5
        assert b["marking_closes_at"] is not None and b["reopened_until"] is None
        assert b["offering"]["label"] and b["semester_id"]

    def test_create_unknown_cs_404(self, client, graph) -> None:
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(uuid.uuid4()), "title": "X", "max_score": 10})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="offering_not_found")

    def test_create_non_owner_teacher_404(self, client, graph, make_user, auth_headers, db_session) -> None:
        other_user = make_user(role=Role.TEACHER)
        db_session.add(TeacherProfile(user_id=other_user.id, staff_number=f"T-{uuid.uuid4().hex[:6]}",
                                      full_name="Other", status=TeacherStatus.ACTIVE))
        db_session.flush()
        r = client.post(A, headers=auth_headers(user_id=other_user.id, role=Role.TEACHER),
                        json={"offering_id": str(graph.cs.id), "title": "X",
                              "max_score": 10})
        assert r.status_code == 404

    def test_create_category_mismatch_409(self, client, graph, db_session) -> None:
        # a category on a DIFFERENT class_subject (second subject + offering)
        subj2 = Course(name=f"S {uuid.uuid4().hex[:5]}", code=uuid.uuid4().hex[:5].upper())
        db_session.add(subj2)
        db_session.flush()
        cs2 = CourseOffering(
            course_id=subj2.id,
            semester_id=graph.sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db_session.add(cs2)
        db_session.flush()
        foreign_cat = AssessmentCategory(offering_id=cs2.id, name="Foreign", weight=Decimal("1"))
        db_session.add(foreign_cat)
        db_session.flush()
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "category_id": str(foreign_cat.id),
            "title": "X", "max_score": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="category_subject_mismatch")

    def test_type_is_retired(self, client, graph) -> None:
        # Assessment types were removed on 16 Oct 2026 (column dropped): the API neither
        # returns one nor accepts one — `extra="forbid"` makes a stale client's `type` a 422.
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "No type", "max_score": 10})
        assert r.status_code == 201, r.text
        assert "type" not in r.json()
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "X", "type": "quiz", "max_score": 10})
        assert r.status_code == 422

    def test_create_in_archived_year_409(self, client, graph, db_session) -> None:
        graph.section.is_archived = True
        db_session.flush()
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "X", "max_score": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


class TestReadScope:
    def test_teacher_sees_only_owned(self, client, graph, db_session, make_user, auth_headers) -> None:
        graph.assessment()
        # a second, unowned cs + assessment
        subj2 = Course(name=f"S {uuid.uuid4().hex[:5]}", code=uuid.uuid4().hex[:5].upper())
        db_session.add(subj2); db_session.flush()
        cs2 = CourseOffering(
            course_id=subj2.id,
            semester_id=graph.sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db_session.add(cs2); db_session.flush()
        db_session.add(Assessment(offering_id=cs2.id, semester_id=graph.sem.id,
                                  title="Foreign", max_score=Decimal("10"),
                                  weight=Decimal("1"), status="published"))
        db_session.flush()
        r = client.get(f"{A}?page_size=200", headers=graph.H)
        assert r.status_code == 200
        cs_ids = {i["offering"]["id"] for i in r.json()["items"]}
        assert str(graph.cs.id) in cs_ids and str(cs2.id) not in cs_ids

    def test_student_sees_every_assessment_in_own_section(
        self, client, graph, make_user, auth_headers
    ) -> None:
        """D47 retired drafts, so nothing in the student's own section is hidden."""
        first, second = graph.assessment(), graph.assessment()
        su = make_user(role=Role.STUDENT)
        s, _enr = graph.enrolled_student()
        s.user_id = su.id
        graph._db.flush()
        r = client.get(f"{A}?scope=me&page_size=200", headers=auth_headers(user_id=su.id, role=Role.STUDENT))
        assert r.status_code == 200
        ids = {i["id"] for i in r.json()["items"]}
        assert {str(first.id), str(second.id)} <= ids

    def test_detail_owner_has_stats(self, client, graph) -> None:
        a = graph.assessment()
        r = client.get(f"{A}/{a.id}", headers=graph.H)
        assert r.status_code == 200 and r.json()["stats"] is not None

    def test_detail_non_owner_404(self, client, graph, make_user, auth_headers, db_session) -> None:
        a = graph.assessment()
        ou = make_user(role=Role.TEACHER)
        db_session.add(TeacherProfile(user_id=ou.id, staff_number=f"T-{uuid.uuid4().hex[:6]}",
                                      full_name="Other", status=TeacherStatus.ACTIVE))
        db_session.flush()
        r = client.get(f"{A}/{a.id}", headers=auth_headers(user_id=ou.id, role=Role.TEACHER))
        assert r.status_code == 404

    def test_picker_feed_lists_owned(self, client, graph) -> None:
        r = client.get(f"{A}/offerings", headers=graph.H)
        assert r.status_code == 200
        ids = {i["id"] for i in r.json()["items"]}
        assert str(graph.cs.id) in ids


class TestUpdateDelete:
    def test_patch_ok(self, client, graph) -> None:
        a = graph.assessment()
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"title": "New", "max_score": 40})
        assert r.status_code == 200 and r.json()["title"] == "New" and r.json()["max_score"] == 40

    def test_weight_is_locked_at_1(self, client, graph, db_session) -> None:
        # 17 Oct 2026: a submitted weight is accepted but ignored, on create AND on edit,
        # and any edit brings an older non-1 weight back to 1.
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "W", "max_score": 10, "weight": 5})
        assert r.status_code == 201, r.text
        assert r.json()["weight"] == 1

        a = graph.assessment()
        a.weight = Decimal("3.00")  # a legacy row from before the lock
        db_session.flush()
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"weight": 7})
        assert r.status_code == 200 and r.json()["weight"] == 1
        db_session.refresh(a)
        a.weight = Decimal("3.00")
        db_session.flush()
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"title": "Renamed"})
        assert r.status_code == 200 and r.json()["weight"] == 1

    def test_patch_scores_exceed_new_max_409(self, client, graph) -> None:
        a = graph.assessment(max_score="100")
        s, enr = graph.enrolled_student()
        graph.grade(a.id, s.id, enr.id, status="graded", score="90")
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"max_score": 50})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="scores_exceed_new_max")

    def test_delete_no_grades_204(self, client, graph) -> None:
        a = graph.assessment()
        assert client.delete(f"{A}/{a.id}", headers=graph.H).status_code == 204
        assert client.get(f"{A}/{a.id}", headers=graph.H).status_code == 404

    def test_delete_with_grades_409(self, client, graph) -> None:
        a = graph.assessment()
        s, enr = graph.enrolled_student()
        graph.grade(a.id, s.id, enr.id, status="graded", score="15")
        r = client.delete(f"{A}/{a.id}", headers=graph.H)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="assessment_has_grades")


class TestCategories:
    def test_list_create_dup(self, client, graph) -> None:
        r = client.get(_cat_path(graph.cs.id), headers=graph.H)
        assert r.status_code == 200 and "items" in r.json()
        r = client.post(_cat_path(graph.cs.id), headers=graph.H,
                        json={"name": "Quizzes", "weight": 0.4, "drop_lowest_count": 1})
        assert r.status_code == 201, r.text
        assert r.json()["name"] == "Quizzes" and r.json()["drop_lowest_count"] == 1
        dup = client.post(_cat_path(graph.cs.id), headers=graph.H,
                          json={"name": "quizzes"})
        assert dup.status_code == 409
        _assert_envelope(dup.json(), code="duplicate_category_name")

    def test_patch_category(self, client, graph) -> None:
        c = graph.category(name="Tests")
        r = client.patch(_cat_path(graph.cs.id, c.id), headers=graph.H,
                         json={"weight": 0.7, "drop_lowest_count": 2})
        assert r.status_code == 200 and r.json()["weight"] == 0.7 and r.json()["drop_lowest_count"] == 2

    def test_delete_category_detaches_assessments(self, client, graph) -> None:
        c = graph.category()
        a = graph.assessment(category_id=c.id)
        assert client.delete(_cat_path(graph.cs.id, c.id), headers=graph.H).status_code == 204
        # assessment survives, category detached
        r = client.get(f"{A}/{a.id}", headers=graph.H)
        assert r.status_code == 200 and r.json()["category_id"] is None

    def test_category_write_requires_owner(self, client, graph, make_user, auth_headers, db_session) -> None:
        ou = make_user(role=Role.TEACHER)
        db_session.add(TeacherProfile(user_id=ou.id, staff_number=f"T-{uuid.uuid4().hex[:6]}",
                                      full_name="Other", status=TeacherStatus.ACTIVE))
        db_session.flush()
        r = client.post(_cat_path(graph.cs.id),
                        headers=auth_headers(user_id=ou.id, role=Role.TEACHER),
                        json={"name": "X"})
        assert r.status_code == 404

    def test_dean_manages_categories(self, client, graph, make_user, auth_headers) -> None:
        # The weighting scheme is the course's grading policy, so the Dean may set it on an
        # offering they do not teach — unlike an assessment (`test_principal_cannot_create`).
        p = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        r = client.post(_cat_path(graph.cs.id), headers=H, json={"name": "Final", "weight": 30})
        assert r.status_code == 201, r.text
        cat_id = r.json()["id"]
        r = client.patch(_cat_path(graph.cs.id, cat_id), headers=H, json={"weight": 40})
        assert r.status_code == 200 and r.json()["weight"] == 40
        assert client.delete(_cat_path(graph.cs.id, cat_id), headers=H).status_code == 204

    def test_registrar_cannot_write_categories(self, client, graph, make_user, auth_headers) -> None:
        s = make_user(role=Role.SECRETARY)
        r = client.post(_cat_path(graph.cs.id),
                        headers=auth_headers(user_id=s.id, role=Role.SECRETARY),
                        json={"name": "X"})
        assert r.status_code == 403

    @pytest.mark.parametrize("role", [Role.AUDITOR, Role.HOD, Role.SECRETARY])
    def test_non_teaching_staff_can_read_categories(
        self, client, graph, make_user, auth_headers, role
    ) -> None:
        # The offering page shows these roles the Grading tab; before, Auditor and HOD fell
        # into the student branch and got a 404 for an offering they could open.
        graph.category(name="Quizzes", weight="25")
        u = make_user(role=role)
        r = client.get(_cat_path(graph.cs.id), headers=auth_headers(user_id=u.id, role=role))
        assert r.status_code == 200, r.text
        assert [c["name"] for c in r.json()["items"]] == ["Quizzes"]

    def test_weight_total_verdict(self, client, graph) -> None:
        graph.category(name="Coursework", weight="60")
        body = client.get(_cat_path(graph.cs.id), headers=graph.H).json()
        assert body["weight_total"] == 60 and body["weight_total_ok"] is False
        graph.category(name="Final", weight="40")
        body = client.get(_cat_path(graph.cs.id), headers=graph.H).json()
        assert body["weight_total"] == 100 and body["weight_total_ok"] is True


# ════════════════════════════════════════════════════════════════════════════
# D47 — the marking window, at the assessment level
# ════════════════════════════════════════════════════════════════════════════
def _days_ago(n: int) -> date:
    return school_today() - timedelta(days=n)


class TestMarkingWindow:
    """The window itself is unit-tested in `test_marking_window.py`; these are the
    assessment endpoints that must not become a way around it."""

    def test_status_and_release_routes_are_gone(self, client, graph) -> None:
        a = graph.assessment()
        for path in ("status", "release", "unrelease", "nudge-release"):
            r = client.post(f"{A}/{a.id}/{path}", headers=graph.H, json={"status": "graded"})
            assert r.status_code in (404, 405), (path, r.status_code)

    def test_list_and_detail_report_the_window(self, client, graph) -> None:
        closed = graph.assessment(assessment_date=_days_ago(6))
        open_ = graph.assessment(assessment_date=_days_ago(5))
        items = {
            i["id"]: i
            for i in client.get(f"{A}?offering_id={graph.cs.id}&page_size=200",
                                headers=graph.H).json()["items"]
        }
        assert items[str(closed.id)]["marking_open"] is False
        assert items[str(closed.id)]["days_left"] is None
        assert items[str(open_.id)]["marking_open"] is True
        assert items[str(open_.id)]["days_left"] == 0

    def test_create_with_a_date_whose_window_has_passed_422(self, client, graph) -> None:
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "Late", "max_score": 10,
            "assessment_date": _days_ago(6).isoformat()})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="marking_window_passed")

    def test_create_on_the_last_open_day_is_allowed(self, client, graph) -> None:
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "Edge", "max_score": 10,
            "assessment_date": _days_ago(5).isoformat()})
        assert r.status_code == 201, r.text
        assert r.json()["marking_open"] is True

    def test_moving_the_date_of_a_closed_assessment_409(self, client, graph) -> None:
        """Otherwise re-dating it would quietly reopen the window."""
        a = graph.assessment(assessment_date=_days_ago(10))
        r = client.patch(f"{A}/{a.id}", headers=graph.H,
                         json={"assessment_date": school_today().isoformat()})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="marking_closed")

    def test_a_closed_assessment_still_takes_a_rename(self, client, graph) -> None:
        a = graph.assessment(assessment_date=_days_ago(10))
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"title": "Renamed"})
        assert r.status_code == 200 and r.json()["title"] == "Renamed"

    def test_an_open_assessment_can_be_re_dated(self, client, graph) -> None:
        a = graph.assessment(assessment_date=_days_ago(1))
        new = (school_today() + timedelta(days=3)).isoformat()
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"assessment_date": new})
        assert r.status_code == 200 and r.json()["assessment_date"] == new

    def test_deleting_a_closed_assessment_409(self, client, graph) -> None:
        """Its blanks already count as 0 — deleting it would erase them."""
        a = graph.assessment(assessment_date=_days_ago(10))
        r = client.delete(f"{A}/{a.id}", headers=graph.H)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="marking_closed")

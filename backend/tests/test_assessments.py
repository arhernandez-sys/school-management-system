"""Comprehensive pytest suite for Module 6 — ASSESSMENTS + categories (api-spec §6).

Scope: assessment CRUD + status lifecycle + release/unrelease + picker feed +
per-class_subject categories, with negative / edge / security paths.

Writes are teacher-only (+ ownership); reads are scoped (P/S all, Teacher own,
Student enrolled/non-draft). Hermetic + rolled-back via the `db_session` fixture:
each test builds its own writable year + section + subject + class_subject and a
teacher that OWNS it (class_teachers row), then exercises the endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date
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

    def assessment(self, *, status="draft", max_score="20", is_released=False, category_id=None) -> Assessment:
        a = Assessment(
            offering_id=self.cs.id, semester_id=self.sem.id, category_id=category_id,
            title=f"A {uuid.uuid4().hex[:5]}", type="quiz", max_score=Decimal(max_score),
            weight=Decimal("1.00"), status=status, is_released=is_released,
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
                              "type": "quiz", "max_score": 10})
        assert r.status_code == 403


class TestCreate:
    def test_create_ok_forces_draft(self, client, graph) -> None:
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "Quiz 1", "type": "quiz",
            "max_score": 25, "weight": 1})
        assert r.status_code == 201, r.text
        b = r.json()
        assert b["status"] == "draft" and b["is_released"] is False
        assert b["offering"]["label"] and b["semester_id"]

    def test_create_unknown_cs_404(self, client, graph) -> None:
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(uuid.uuid4()), "title": "X", "type": "quiz", "max_score": 10})
        assert r.status_code == 404
        _assert_envelope(r.json(), code="offering_not_found")

    def test_create_non_owner_teacher_404(self, client, graph, make_user, auth_headers, db_session) -> None:
        other_user = make_user(role=Role.TEACHER)
        db_session.add(TeacherProfile(user_id=other_user.id, staff_number=f"T-{uuid.uuid4().hex[:6]}",
                                      full_name="Other", status=TeacherStatus.ACTIVE))
        db_session.flush()
        r = client.post(A, headers=auth_headers(user_id=other_user.id, role=Role.TEACHER),
                        json={"offering_id": str(graph.cs.id), "title": "X",
                              "type": "quiz", "max_score": 10})
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
            "title": "X", "type": "quiz", "max_score": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="category_subject_mismatch")

    def test_create_bad_type_422(self, client, graph) -> None:
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "X", "type": "essay", "max_score": 10})
        assert r.status_code == 422

    def test_create_in_archived_year_409(self, client, graph, db_session) -> None:
        graph.section.is_archived = True
        db_session.flush()
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "X", "type": "quiz", "max_score": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


class TestReadScope:
    def test_teacher_sees_only_owned(self, client, graph, db_session, make_user, auth_headers) -> None:
        graph.assessment(status="published")
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
                                  title="Foreign", type="quiz", max_score=Decimal("10"),
                                  weight=Decimal("1"), status="published"))
        db_session.flush()
        r = client.get(f"{A}?page_size=200", headers=graph.H)
        assert r.status_code == 200
        cs_ids = {i["offering"]["id"] for i in r.json()["items"]}
        assert str(graph.cs.id) in cs_ids and str(cs2.id) not in cs_ids

    def test_student_sees_nondraft_in_own_section(self, client, graph, make_user, auth_headers) -> None:
        graph.assessment(status="draft")
        pub = graph.assessment(status="published")
        su = make_user(role=Role.STUDENT)
        s, _enr = graph.enrolled_student()
        s.user_id = su.id
        graph._db.flush()
        r = client.get(f"{A}?scope=me&page_size=200", headers=auth_headers(user_id=su.id, role=Role.STUDENT))
        assert r.status_code == 200
        ids = {i["id"] for i in r.json()["items"]}
        statuses = {i["status"] for i in r.json()["items"]}
        assert str(pub.id) in ids and "draft" not in statuses

    def test_detail_owner_has_stats(self, client, graph) -> None:
        a = graph.assessment(status="published")
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


class TestUpdateStatusDelete:
    def test_patch_ok(self, client, graph) -> None:
        a = graph.assessment()
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"title": "New", "max_score": 40})
        assert r.status_code == 200 and r.json()["title"] == "New" and r.json()["max_score"] == 40

    def test_patch_scores_exceed_new_max_409(self, client, graph) -> None:
        a = graph.assessment(max_score="100")
        s, enr = graph.enrolled_student()
        graph.grade(a.id, s.id, enr.id, status="graded", score="90")
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"max_score": 50})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="scores_exceed_new_max")

    def test_status_legal_then_illegal(self, client, graph) -> None:
        a = graph.assessment(status="draft")
        assert client.post(f"{A}/{a.id}/status", headers=graph.H, json={"status": "published"}).status_code == 200
        r = client.post(f"{A}/{a.id}/status", headers=graph.H, json={"status": "graded"})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="invalid_transition")

    def test_status_full_lifecycle(self, client, graph) -> None:
        a = graph.assessment(status="draft")
        for target in ("published", "grading", "graded"):
            r = client.post(f"{A}/{a.id}/status", headers=graph.H, json={"status": target})
            assert r.status_code == 200 and r.json()["status"] == target

    def test_release_unrelease(self, client, graph) -> None:
        a = graph.assessment(status="grading")
        s, enr = graph.enrolled_student()
        graph.grade(a.id, s.id, enr.id, status="graded", score="18")
        r = client.post(f"{A}/{a.id}/release", headers=graph.H)
        assert r.status_code == 200 and r.json()["is_released"] is True and r.json()["released_count"] == 1
        r = client.post(f"{A}/{a.id}/unrelease", headers=graph.H)
        assert r.status_code == 200 and r.json()["is_released"] is False

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


# ════════════════════════════════════════════════════════════════════════════
# POST /assessments/{id}/nudge-release
# ════════════════════════════════════════════════════════════════════════════
def _nudge_path(assessment_id) -> str:
    return f"{A}/{assessment_id}/nudge-release"


def _nudge_rows(db_session, assessment_id) -> list:
    """Every nudge audit row for one assessment, oldest first."""
    from sqlalchemy import select

    from app.modules.assessments.release_nudge import NUDGE_ACTION, NUDGE_ENTITY_TYPE
    from app.modules.settings.models import AuditLog

    return list(
        db_session.scalars(
            select(AuditLog)
            .where(
                AuditLog.action == NUDGE_ACTION,
                AuditLog.entity_type == NUDGE_ENTITY_TYPE,
                AuditLog.entity_id == assessment_id,
            )
            .order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
        ).all()
    )


@pytest.fixture
def awaiting(graph, db_session):
    """An assessment holding one marked-but-hidden grade — the nudgeable state."""

    def _make(*, is_released=False, grade_status="graded", grade_released=None, score="18"):
        a = graph.assessment(status="graded", is_released=is_released)
        student, enr = graph.enrolled_student()
        g = graph.grade(a.id, student.id, enr.id, status=grade_status, score=score)
        if grade_released is not None:
            g.is_released = grade_released
            db_session.flush()
        return a

    return _make


class TestNudgeReleaseRbac:
    """Principal/secretary only. The 404-not-403 rule is an OWNERSHIP discipline;
    it does not apply to this coarse gate, because P/S are view-all and a permitted
    caller learns nothing about a resource by being refused."""

    def test_requires_auth(self, client, awaiting) -> None:
        assert client.post(_nudge_path(awaiting().id)).status_code == 401

    def test_principal_allowed(self, client, awaiting, make_user, auth_headers) -> None:
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(awaiting().id),
            headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL),
        )
        assert r.status_code == 200, r.text

    def test_secretary_allowed(self, client, awaiting, make_user, auth_headers) -> None:
        s = make_user(role=Role.SECRETARY)
        r = client.post(
            _nudge_path(awaiting().id),
            headers=auth_headers(user_id=s.id, role=Role.SECRETARY),
        )
        assert r.status_code == 200, r.text

    def test_teacher_forbidden(self, client, graph, awaiting) -> None:
        """Even the OWNING teacher — a teacher must not be able to nudge themselves,
        and there is no self-service case for this action."""
        r = client.post(_nudge_path(awaiting().id), headers=graph.H)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_student_forbidden(self, client, awaiting, make_user, auth_headers) -> None:
        u = make_user(role=Role.STUDENT)
        r = client.post(
            _nudge_path(awaiting().id),
            headers=auth_headers(user_id=u.id, role=Role.STUDENT),
        )
        assert r.status_code == 403


class TestNudgeReleaseHappyPath:
    def test_response_shape(self, client, graph, awaiting, make_user, auth_headers) -> None:
        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert set(b.keys()) == {
            "assessment_id", "awaiting_release_count", "teachers",
            "last_nudged_at", "next_nudge_allowed_at", "cooldown_seconds",
        }
        assert b["assessment_id"] == str(a.id)
        assert b["awaiting_release_count"] == 1
        assert b["teachers"] == [
            {"id": str(graph.teacher.id), "full_name": "Owner Teacher"}
        ]
        assert b["cooldown_seconds"] == 4 * 60 * 60

    def test_next_allowed_is_last_plus_cooldown(
        self, client, awaiting, make_user, auth_headers
    ) -> None:
        from datetime import datetime, timedelta

        p = make_user(role=Role.PRINCIPAL)
        b = client.post(
            _nudge_path(awaiting().id),
            headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL),
        ).json()
        last = datetime.fromisoformat(b["last_nudged_at"])
        nxt = datetime.fromisoformat(b["next_nudge_allowed_at"])
        assert nxt - last == timedelta(seconds=b["cooldown_seconds"])

    def test_counts_every_waiting_student(
        self, client, graph, make_user, auth_headers
    ) -> None:
        a = graph.assessment(status="graded", is_released=False)
        for _ in range(3):
            student, enr = graph.enrolled_student()
            graph.grade(a.id, student.id, enr.id, status="graded", score="18")
        p = make_user(role=Role.PRINCIPAL)
        b = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        ).json()
        assert b["awaiting_release_count"] == 3

    def test_writes_exactly_one_audit_row(
        self, client, graph, awaiting, make_user, auth_headers, db_session
    ) -> None:
        """The nudge IS the audit row — there is no other storage for it."""
        a = awaiting()
        p = make_user(role=Role.PRINCIPAL, full_name="Head Teacher")
        client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        rows = _nudge_rows(db_session, a.id)
        assert len(rows) == 1
        row = rows[0]
        assert row.actor_user_id == p.id
        assert row.summary["awaiting_release_count"] == 1
        assert row.summary["teacher_ids"] == [str(graph.teacher.id)]
        assert row.summary["teacher_names"] == ["Owner Teacher"]
        assert row.summary["offering_id"] == str(graph.cs.id)

    def test_stored_timestamp_is_utc_and_matches_the_response(
        self, client, awaiting, make_user, auth_headers, db_session
    ) -> None:
        """`created_at` is written explicitly rather than by MariaDB's `now()`,
        which returns session-local time and would skew the cooldown."""
        from datetime import datetime, timedelta

        from app.core.timeutil import ensure_aware, utcnow

        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        b = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        ).json()
        stored = ensure_aware(_nudge_rows(db_session, a.id)[0].created_at)
        assert abs(stored - datetime.fromisoformat(b["last_nudged_at"])) < timedelta(seconds=1)
        assert abs(stored - utcnow()) < timedelta(minutes=5)

    def test_lead_teacher_listed_first(
        self, client, graph, awaiting, make_user, auth_headers, db_session
    ) -> None:
        co = make_user(role=Role.TEACHER)
        co_profile = TeacherProfile(
            user_id=co.id, staff_number=f"T-{uuid.uuid4().hex[:6]}",
            full_name="AAA Co-teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(co_profile)
        db_session.flush()
        db_session.add(
            ClassTeacher(offering_id=graph.cs.id, teacher_id=co_profile.id, is_lead=False)
        )
        db_session.flush()
        p = make_user(role=Role.PRINCIPAL)
        b = client.post(
            _nudge_path(awaiting().id),
            headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL),
        ).json()
        # Co-teachers are reminded too (D-Q9), lead first despite the name order.
        assert [t["full_name"] for t in b["teachers"]] == ["Owner Teacher", "AAA Co-teacher"]


class TestNudgeReleaseRefusals:
    def test_unknown_assessment_404(self, client, make_user, auth_headers) -> None:
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(uuid.uuid4()),
            headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL),
        )
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_soft_deleted_assessment_404(
        self, client, awaiting, make_user, auth_headers, db_session
    ) -> None:
        from app.core.timeutil import utcnow

        a = awaiting()
        a.deleted_at = utcnow()
        db_session.flush()
        p = make_user(role=Role.PRINCIPAL)
        assert client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        ).status_code == 404

    def test_nothing_graded_yet_409(self, client, graph, make_user, auth_headers) -> None:
        """No grade rows at all — nothing to release, so this is a clear refusal
        rather than a silent success."""
        a = graph.assessment(status="grading", is_released=False)
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="nothing_awaiting_release")

    def test_only_pending_grades_409(self, client, awaiting, make_user, auth_headers) -> None:
        a = awaiting(grade_status="pending", score=None)
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="nothing_awaiting_release")

    def test_already_released_409(self, client, awaiting, make_user, auth_headers) -> None:
        a = awaiting(is_released=True)
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="nothing_awaiting_release")

    def test_per_student_unrelease_is_still_nudgeable(
        self, client, awaiting, make_user, auth_headers
    ) -> None:
        """Column released but one student left hidden → still awaiting release."""
        a = awaiting(is_released=True, grade_released=False)
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 200, r.text
        assert r.json()["awaiting_release_count"] == 1

    def test_no_audit_row_written_on_a_409(
        self, client, graph, make_user, auth_headers, db_session
    ) -> None:
        a = graph.assessment(status="grading", is_released=False)
        p = make_user(role=Role.PRINCIPAL)
        client.post(_nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL))
        assert _nudge_rows(db_session, a.id) == []

    def test_unstaffed_offering_409(
        self, client, graph, awaiting, make_user, auth_headers, db_session
    ) -> None:
        """A reminder addressed to nobody must fail loudly, not be recorded."""
        from sqlalchemy import delete

        a = awaiting()
        db_session.execute(
            delete(ClassTeacher).where(ClassTeacher.offering_id == graph.cs.id)
        )
        db_session.flush()
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="no_assigned_teacher")

    def test_archived_year_409(
        self, client, graph, awaiting, make_user, auth_headers, db_session
    ) -> None:
        """If the teacher could not release it, nobody should be nudged to."""
        from app.core.timeutil import utcnow

        a = awaiting()
        graph.year.archived_at = utcnow()
        db_session.flush()
        p = make_user(role=Role.PRINCIPAL)
        r = client.post(
            _nudge_path(a.id), headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")


class TestNudgeReleaseCooldown:
    """Anti-spam. The window is a named constant (`release_nudge.NUDGE_COOLDOWN`);
    these tests read it rather than restating the number, so retuning it does not
    require editing assertions."""

    def _nudge(self, client, auth_headers, user, assessment_id):
        return client.post(
            _nudge_path(assessment_id),
            headers=auth_headers(user_id=user.id, role=user.role),
        )

    def test_second_nudge_inside_the_window_429(
        self, client, awaiting, make_user, auth_headers
    ) -> None:
        from app.modules.assessments.release_nudge import NUDGE_COOLDOWN_SECONDS

        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        assert self._nudge(client, auth_headers, p, a.id).status_code == 200
        r = self._nudge(client, auth_headers, p, a.id)
        assert r.status_code == 429
        err = _assert_envelope(r.json(), code="rate_limited")
        assert 0 < err["retry_after_seconds"] <= NUDGE_COOLDOWN_SECONDS
        assert err["cooldown_seconds"] == NUDGE_COOLDOWN_SECONDS
        assert err["last_nudged_at"]

    def test_cooldown_is_per_assessment_not_global(
        self, client, graph, awaiting, make_user, auth_headers
    ) -> None:
        """Nudging one assessment must not silence a different one."""
        first, second = awaiting(), awaiting()
        p = make_user(role=Role.PRINCIPAL)
        assert self._nudge(client, auth_headers, p, first.id).status_code == 200
        assert self._nudge(client, auth_headers, p, second.id).status_code == 200

    def test_a_different_admin_is_also_rate_limited(
        self, client, awaiting, make_user, auth_headers
    ) -> None:
        """The cooldown protects the TEACHER, so it cannot be reset by switching
        which administrator clicks the button."""
        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        s = make_user(role=Role.SECRETARY)
        assert self._nudge(client, auth_headers, p, a.id).status_code == 200
        assert self._nudge(client, auth_headers, s, a.id).status_code == 429

    def test_a_rejected_retry_appends_no_audit_row(
        self, client, awaiting, make_user, auth_headers, db_session
    ) -> None:
        """A double-submit must not inflate the trail."""
        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        self._nudge(client, auth_headers, p, a.id)
        self._nudge(client, auth_headers, p, a.id)
        assert len(_nudge_rows(db_session, a.id)) == 1

    def test_allowed_again_once_the_window_expires(
        self, client, awaiting, make_user, auth_headers, db_session
    ) -> None:
        from datetime import timedelta

        from app.core.timeutil import utcnow
        from app.modules.assessments.release_nudge import NUDGE_COOLDOWN

        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        assert self._nudge(client, auth_headers, p, a.id).status_code == 200
        # Backdate the recorded nudge past the window — the cooldown is derived from
        # audit_log, so this is the only state there is to age.
        row = _nudge_rows(db_session, a.id)[0]
        row.created_at = utcnow() - NUDGE_COOLDOWN - timedelta(minutes=1)
        db_session.flush()
        assert self._nudge(client, auth_headers, p, a.id).status_code == 200
        assert len(_nudge_rows(db_session, a.id)) == 2

    def test_still_blocked_just_inside_the_window(
        self, client, awaiting, make_user, auth_headers, db_session
    ) -> None:
        from datetime import timedelta

        from app.core.timeutil import utcnow
        from app.modules.assessments.release_nudge import NUDGE_COOLDOWN

        a = awaiting()
        p = make_user(role=Role.PRINCIPAL)
        self._nudge(client, auth_headers, p, a.id)
        row = _nudge_rows(db_session, a.id)[0]
        row.created_at = utcnow() - NUDGE_COOLDOWN + timedelta(minutes=5)
        db_session.flush()
        assert self._nudge(client, auth_headers, p, a.id).status_code == 429


class TestNudgeReadBack:
    """'Last reminded at' is DERIVED by reading the most recent audit row back —
    there is no column and no migration. These pin that round trip."""

    def test_surfaced_on_the_student_assessments_tab(
        self, client, graph, make_user, auth_headers
    ) -> None:
        from datetime import datetime, timedelta

        a = graph.assessment(status="graded", is_released=False)
        student, enr = graph.enrolled_student()
        graph.grade(a.id, student.id, enr.id, status="graded", score="18")

        p = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=p.id, role=Role.PRINCIPAL)

        before = client.get(f"/api/v1/students/{student.id}/assessments", headers=H).json()
        line = next(
            ln for g in before["items"] for ln in g["assessments"] if ln["id"] == str(a.id)
        )
        assert line["last_nudged_at"] is None

        posted = client.post(_nudge_path(a.id), headers=H).json()

        after = client.get(f"/api/v1/students/{student.id}/assessments", headers=H).json()
        line = next(
            ln for g in after["items"] for ln in g["assessments"] if ln["id"] == str(a.id)
        )
        assert line["last_nudged_at"] is not None
        # The read-back must equal what the POST reported, or the UI's cooldown
        # countdown would start from the wrong instant.
        assert abs(
            datetime.fromisoformat(line["last_nudged_at"])
            - datetime.fromisoformat(posted["last_nudged_at"])
        ) < timedelta(seconds=1)

    def test_cooldown_window_is_served_with_the_tab(
        self, client, graph, make_user, auth_headers
    ) -> None:
        """So the SPA never hardcodes its own copy of the window."""
        from app.modules.assessments.release_nudge import NUDGE_COOLDOWN_SECONDS

        student, _ = graph.enrolled_student()
        p = make_user(role=Role.PRINCIPAL)
        body = client.get(
            f"/api/v1/students/{student.id}/assessments",
            headers=auth_headers(user_id=p.id, role=Role.PRINCIPAL),
        ).json()
        assert body["nudge_cooldown_seconds"] == NUDGE_COOLDOWN_SECONDS

    def test_only_the_nudged_assessment_reports_a_timestamp(
        self, client, graph, make_user, auth_headers
    ) -> None:
        nudged = graph.assessment(status="graded", is_released=False)
        other = graph.assessment(status="graded", is_released=False)
        student, enr = graph.enrolled_student()
        graph.grade(nudged.id, student.id, enr.id, status="graded", score="18")
        graph.grade(other.id, student.id, enr.id, status="graded", score="15")

        p = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=p.id, role=Role.PRINCIPAL)
        client.post(_nudge_path(nudged.id), headers=H)

        body = client.get(f"/api/v1/students/{student.id}/assessments", headers=H).json()
        stamps = {
            ln["id"]: ln["last_nudged_at"] for g in body["items"] for ln in g["assessments"]
        }
        assert stamps[str(nudged.id)] is not None
        assert stamps[str(other.id)] is None

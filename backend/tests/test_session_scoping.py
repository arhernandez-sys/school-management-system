"""Session scoping: an offering's own session decides what can change and who is listed.

Regression cover for two defects reported against the lecturer views:

  * A new assessment was stamped with the school's ACTIVE semester while the gradebook
    lists an offering's assessments by the offering's OWN semester, so creating one on an
    offering in another session made it vanish ("Assessment not found").
  * The lecturer's student list only counted enrolments in the active semester, so a
    lecturer whose offering ran in another session saw no students at all.

And the rule that replaced them: an inactive session is read-only. Its assessments,
categories, releases and grades can be browsed but never written (409 `session_inactive`).
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.common.enums import Role
from app.modules.assessments.models import Assessment
from app.modules.offerings.models import ClassEnrollment
from app.modules.settings.models import Semester
from tests.test_assessments import A, _Graph, _assert_envelope, _cat_path

STUDENTS = "/api/v1/students"


def _gradebook(offering_id) -> str:
    return f"/api/v1/grades/offering/{offering_id}"


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year)


@pytest.fixture
def inactive(graph, db_session) -> _Graph:
    """Move the graph's offering into a second, INACTIVE session of the same year."""
    other = Semester(
        academic_year_id=graph.year.id, name="Summer", sequence=2,
        start_date=date(2026, 2, 1), end_date=date(2026, 5, 31), is_active=False,
    )
    db_session.add(other)
    db_session.flush()
    graph.cs.semester_id = other.id
    db_session.flush()
    graph.inactive_sem = other
    return graph


def _assessment_in(graph: _Graph, semester_id) -> Assessment:
    a = graph.assessment()
    a.semester_id = semester_id
    graph._db.flush()
    return a


class TestCreateUsesOfferingSession:
    def test_new_assessment_takes_the_offering_session_and_appears_in_gradebook(
        self, client, graph, db_session
    ) -> None:
        # Offering in a session other than the school's active one, then made active again
        # is not needed: the point is the stamp follows the offering, not the global flag.
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "title": "Quiz", "max_score": 10})
        assert r.status_code == 201, r.text
        assert r.json()["semester_id"] == str(graph.cs.semester_id)

        gb = client.get(_gradebook(graph.cs.id), headers=graph.H)
        assert gb.status_code == 200, gb.text
        assert r.json()["id"] in {a["id"] for a in gb.json()["assessments"]}

    def test_mismatched_semester_id_is_rejected(self, client, graph, db_session) -> None:
        other = Semester(
            academic_year_id=graph.year.id, name="Other", sequence=3,
            start_date=date(2026, 6, 1), end_date=date(2026, 7, 31), is_active=False,
        )
        db_session.add(other)
        db_session.flush()
        r = client.post(A, headers=graph.H, json={
            "offering_id": str(graph.cs.id), "semester_id": str(other.id),
            "title": "Quiz", "max_score": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="semester_mismatch")


class TestInactiveSessionIsReadOnly:
    def test_create_assessment_blocked(self, client, inactive) -> None:
        r = client.post(A, headers=inactive.H, json={
            "offering_id": str(inactive.cs.id), "title": "Quiz", "max_score": 10})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="session_inactive")

    def test_update_delete_blocked(self, client, inactive) -> None:
        a = _assessment_in(inactive, inactive.inactive_sem.id)
        for resp in (
            client.patch(f"{A}/{a.id}", headers=inactive.H, json={"title": "Renamed"}),
            client.delete(f"{A}/{a.id}", headers=inactive.H),
        ):
            assert resp.status_code == 409, resp.text
            _assert_envelope(resp.json(), code="session_inactive")

    def test_grade_entry_blocked(self, client, inactive) -> None:
        a = _assessment_in(inactive, inactive.inactive_sem.id)
        s, enr = inactive.enrolled_student()
        enr.semester_id = inactive.inactive_sem.id
        inactive._db.flush()
        r = client.put(f"{A}/{a.id}/grades", headers=inactive.H, json={
            "entries": [{"student_id": str(s.id), "status": "graded", "score": 8}]})
        assert r.status_code == 409, r.text
        _assert_envelope(r.json(), code="session_inactive")

    def test_category_writes_blocked(self, client, inactive) -> None:
        c = inactive.category()
        for resp in (
            client.post(_cat_path(inactive.cs.id), headers=inactive.H,
                        json={"name": "New", "weight": 10}),
            client.patch(_cat_path(inactive.cs.id, c.id), headers=inactive.H,
                         json={"name": "Renamed"}),
            client.delete(_cat_path(inactive.cs.id, c.id), headers=inactive.H),
        ):
            assert resp.status_code == 409, resp.text
            _assert_envelope(resp.json(), code="session_inactive")

    def test_gradebook_still_readable_but_not_editable(self, client, inactive) -> None:
        a = _assessment_in(inactive, inactive.inactive_sem.id)
        r = client.get(_gradebook(inactive.cs.id), headers=inactive.H)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["can_edit"] is False
        assert str(a.id) in {x["id"] for x in body["assessments"]}

    def test_offering_picker_marks_inactive_session_not_editable(self, client, inactive) -> None:
        r = client.get("/api/v1/grades/offerings", headers=inactive.H)
        assert r.status_code == 200, r.text
        mine = [o for o in r.json()["items"] if o["offering"]["id"] == str(inactive.cs.id)]
        assert mine and mine[0]["can_edit"] is False

    def test_active_session_still_writable(self, client, graph) -> None:
        a = graph.assessment()
        r = client.patch(f"{A}/{a.id}", headers=graph.H, json={"title": "Renamed"})
        assert r.status_code == 200, r.text


class TestPickersCarryTheOfferingSession:
    """The staff Grades grid and Assessments picker filter these feeds by the session
    chosen beside the year. Both shipped `semester: null`, so every offering failed that
    filter and both screens were empty — only a dashboard deep link reached a gradebook."""

    def test_grades_picker_reports_the_offering_semester(self, client, inactive) -> None:
        r = client.get("/api/v1/grades/offerings", headers=inactive.H)
        assert r.status_code == 200, r.text
        mine = [o for o in r.json()["items"] if o["offering"]["id"] == str(inactive.cs.id)]
        assert mine and mine[0]["offering"]["semester"]["id"] == str(inactive.inactive_sem.id)

    def test_assessments_picker_reports_the_offering_semester(self, client, inactive) -> None:
        r = client.get(f"{A}/offerings", headers=inactive.H)
        assert r.status_code == 200, r.text
        mine = [o for o in r.json()["items"] if o["id"] == str(inactive.cs.id)]
        assert mine and mine[0]["semester"]["id"] == str(inactive.inactive_sem.id)


class TestStudentListFollowsChosenSession:
    def test_lecturer_sees_students_of_the_chosen_session(self, client, inactive) -> None:
        s, enr = inactive.enrolled_student()
        enr.semester_id = inactive.inactive_sem.id
        inactive._db.flush()

        # Default (active session): this lecturer teaches nothing there.
        r = client.get(f"{STUDENTS}?page_size=100", headers=inactive.H)
        assert r.status_code == 200, r.text
        assert str(s.id) not in {i["id"] for i in r.json()["items"]}

        # Choosing the offering's session lists its students.
        r = client.get(
            f"{STUDENTS}?page_size=100&semester_id={inactive.inactive_sem.id}",
            headers=inactive.H,
        )
        assert r.status_code == 200, r.text
        assert str(s.id) in {i["id"] for i in r.json()["items"]}

    def test_past_session_includes_ended_enrolments(self, client, inactive) -> None:
        from datetime import datetime, timezone

        s, enr = inactive.enrolled_student()
        enr.semester_id = inactive.inactive_sem.id
        enr.unenrolled_at = datetime.now(timezone.utc)
        inactive._db.flush()
        r = client.get(
            f"{STUDENTS}?page_size=100&semester_id={inactive.inactive_sem.id}",
            headers=inactive.H,
        )
        assert str(s.id) in {i["id"] for i in r.json()["items"]}

    def test_session_filter_does_not_leak_other_lecturers_students(
        self, client, inactive, make_user, auth_headers, db_session
    ) -> None:
        from app.common.enums import TeacherStatus
        from app.modules.teachers.models import TeacherProfile

        s, enr = inactive.enrolled_student()
        enr.semester_id = inactive.inactive_sem.id
        db_session.flush()
        other_user = make_user(role=Role.TEACHER)
        db_session.add(TeacherProfile(
            user_id=other_user.id, staff_number=f"T-{uuid.uuid4().hex[:6]}",
            full_name="Other", status=TeacherStatus.ACTIVE,
        ))
        db_session.flush()
        r = client.get(
            f"{STUDENTS}?page_size=100&semester_id={inactive.inactive_sem.id}",
            headers=auth_headers(user_id=other_user.id, role=Role.TEACHER),
        )
        assert r.status_code == 200
        assert str(s.id) not in {i["id"] for i in r.json()["items"]}

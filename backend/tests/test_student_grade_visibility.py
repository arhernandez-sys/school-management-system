"""Who may see a grade (D32 Phase 3, brief §4).

Two changes, different in kind, and the difference is the point of this suite:

  * **The Registrar lost grades outright.** No flag, no toggle — `Role.SECRETARY` is
    absent from every grade route. The client asked for the Register to lose grade
    visibility, and expressing that as a setting would have implied it is reversible from
    the UI. Everything else the Registrar owns is untouched, and there are tests here for
    that too: a removal that quietly took the student directory with it would be a
    regression dressed up as a feature.
  * **Students are gated by a Dean-controlled switch**, `assessment_policies.students_can_view_grades`,
    default OFF. 403 `grades_hidden` when off, normal service when on.

**And the rule the client was most specific about:** a student must never learn that a
revision happened. They see the resulting score — the revised one after an approval, the
original after a denial — and nothing about the request, the decision or the Dean. That is
the last class here, and it is the one that would be easiest to break by accident.

`PERMISSION_MATRIX` in the frontend hides the nav, but it is UX only (its own header says
so). Everything below goes through the API, because that is the boundary.

Hermetic + rolled back via `db_session`. Reuses `test_grades.py::_Graph`.
"""

from __future__ import annotations

import pytest

from app.common.enums import Role
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on
from tests.test_grade_revision import _request, backdate, open_midterm_window

pytestmark = pytest.mark.requires_db

G = "/api/v1/grades"
R = "/api/v1/grade-revisions"
S = "/api/v1/students"
REPORTS = "/api/v1/reports"


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
) -> _Graph:
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


@pytest.fixture
def enrolled_student(graph):
    """A student with a login and a released, graded result — something to be hidden."""
    assessment = graph.assessment(max_score="100", weight="1", is_released=True)
    student, enrollment = graph.student(with_login=True)
    grade = graph.grade(assessment, student, enrollment, score="60", is_released=True)
    return student, assessment, grade


def _error(body: dict) -> dict:
    assert set(body.keys()) <= {"error"}, body
    return body["error"]


# ════════════════════════════════════════════════════════════════════════════
class TestTheDeanSwitch:
    """`assessment_policies.students_can_view_grades` — read, write, authority."""

    POLICY = "/api/v1/settings/assessment-policy"

    def test_it_defaults_to_hidden(self, client, graph) -> None:
        """The client's decision, not a conservative guess: students see nothing until
        the Dean publishes."""
        body = client.get(self.POLICY, headers=graph.P).json()
        assert body["students_can_view_grades"] is False

    def test_the_dean_can_publish_grades(self, client, graph) -> None:
        resp = client.put(
            self.POLICY,
            headers=graph.P,
            json={
                "absent_as_zero": False,
                "allow_makeup": True,
                "drop_lowest_count": 0,
                "students_can_view_grades": True,
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["students_can_view_grades"] is True

    def test_the_registrar_cannot_publish_grades(self, client, graph) -> None:
        """Setting policy has always been Dean-only (§D14); this field is no exception —
        and it would be perverse for the role that just lost grade access to control it."""
        resp = client.put(
            self.POLICY,
            headers=graph.S,
            json={
                "absent_as_zero": False,
                "allow_makeup": True,
                "drop_lowest_count": 0,
                "students_can_view_grades": True,
            },
        )
        assert resp.status_code == 403, resp.text

    def test_the_flag_is_echoed_on_the_session(
        self, client, graph, enrolled_student, student_grades_visible
    ) -> None:
        """`CurrentUser.students_can_view_grades` is what lets the SPA hide the nav item
        without being handed the staff-only settings endpoint."""
        student, _a, _g = enrolled_student
        body = client.get("/api/v1/auth/me", headers=graph.student_headers(student)).json()
        assert body["students_can_view_grades"] is True

    def test_the_session_reports_it_hidden_by_default(
        self, client, graph, enrolled_student
    ) -> None:
        student, _a, _g = enrolled_student
        body = client.get("/api/v1/auth/me", headers=graph.student_headers(student)).json()
        assert body["students_can_view_grades"] is False


# ════════════════════════════════════════════════════════════════════════════
class TestStudentSurfacesAreGated:
    """Every student-facing grade endpoint, with the switch OFF then ON.

    Enumerated rather than parametrised over a list of paths, because each one has a
    different shape on success and the ON assertion is what proves the gate is the ONLY
    thing that changed.
    """

    def test_my_grades_is_403_when_hidden(self, client, graph, enrolled_student) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(f"{G}/me", headers=graph.student_headers(student))
        assert resp.status_code == 403, resp.text
        assert _error(resp.json())["code"] == "grades_hidden"

    def test_my_grades_works_when_published(
        self, client, graph, enrolled_student, student_grades_visible
    ) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(f"{G}/me", headers=graph.student_headers(student))
        assert resp.status_code == 200, resp.text

    def test_term_grades_is_403_when_hidden(self, client, graph, enrolled_student) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(
            f"{G}/term?scope=me", headers=graph.student_headers(student)
        )
        assert resp.status_code == 403, resp.text
        assert _error(resp.json())["code"] == "grades_hidden"

    def test_term_grades_works_when_published(
        self, client, graph, enrolled_student, student_grades_visible
    ) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(f"{G}/term?scope=me", headers=graph.student_headers(student))
        assert resp.status_code == 200, resp.text

    def test_my_report_card_is_403_when_hidden(
        self, client, graph, enrolled_student
    ) -> None:
        """A report card IS grade information, so it is gated with the rest."""
        student, _a, _g = enrolled_student
        resp = client.get(
            f"{REPORTS}/report-card/me", headers=graph.student_headers(student)
        )
        assert resp.status_code == 403, resp.text
        assert _error(resp.json())["code"] == "grades_hidden"

    def test_my_report_card_works_when_published(
        self, client, graph, enrolled_student, student_grades_visible
    ) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(
            f"{REPORTS}/report-card/me", headers=graph.student_headers(student)
        )
        assert resp.status_code == 200, resp.text

    def test_the_switch_does_not_gate_non_grade_student_routes(
        self, client, graph, enrolled_student
    ) -> None:
        """The narrowness matters. A student with grades hidden still has a timetable, a
        profile and an attendance record — hiding those too would be a bug, not caution."""
        student, _a, _g = enrolled_student
        headers = graph.student_headers(student)
        assert client.get(f"{S}/me", headers=headers).status_code == 200
        assert client.get(f"{S}/me/years", headers=headers).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestStaffAreNotGatedByTheSwitch:
    """The switch governs what a STUDENT sees. A Lecturer needs their gradebook to teach
    and the Dean needs every grade to run the college; neither is affected by it."""

    def test_the_lecturer_reads_their_gradebook_with_grades_hidden(
        self, client, graph
    ) -> None:
        graph.assessment(max_score="100", weight="1")
        resp = client.get(f"{G}/offering/{graph.cs.id}", headers=graph.H)
        assert resp.status_code == 200, resp.text

    def test_the_dean_reads_the_gradebook_with_grades_hidden(self, client, graph) -> None:
        graph.assessment(max_score="100", weight="1")
        resp = client.get(f"{G}/offering/{graph.cs.id}", headers=graph.P)
        assert resp.status_code == 200, resp.text

    def test_the_dean_reads_a_students_report_card(
        self, client, graph, enrolled_student
    ) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(
            f"{REPORTS}/report-card?student_id={student.id}", headers=graph.P
        )
        assert resp.status_code == 200, resp.text


# ════════════════════════════════════════════════════════════════════════════
class TestTheRegistrarLostGradesOutright:
    """No toggle. `Role.SECRETARY` is simply absent from the grade routes."""

    def test_gradebook_is_403(self, client, graph) -> None:
        graph.assessment(max_score="100", weight="1")
        assert client.get(f"{G}/offering/{graph.cs.id}", headers=graph.S).status_code == 403

    def test_the_gradebook_picker_is_403(self, client, graph) -> None:
        assert client.get(f"{G}/offerings", headers=graph.S).status_code == 403

    def test_term_grades_is_403(self, client, graph, enrolled_student) -> None:
        student, _a, _g = enrolled_student
        resp = client.get(f"{G}/term?student_id={student.id}", headers=graph.S)
        assert resp.status_code == 403, resp.text

    def test_student_assessments_is_403(self, client, graph, enrolled_student) -> None:
        """The grade information on the registration screen the client named (brief §4)."""
        student, _a, _g = enrolled_student
        resp = client.get(f"{S}/{student.id}/assessments", headers=graph.S)
        assert resp.status_code == 403, resp.text

    def test_publishing_grades_to_students_does_NOT_restore_the_registrar(
        self, client, graph, student_grades_visible
    ) -> None:
        """The two changes are independent. The Dean's switch is about students; turning
        it on must not hand the Register back the access it was told to lose."""
        graph.assessment(max_score="100", weight="1")
        assert client.get(f"{G}/offering/{graph.cs.id}", headers=graph.S).status_code == 403

    def test_the_registrar_keeps_everything_else(self, client, graph, enrolled_student) -> None:
        """§D14 leaves the Registrar students, enrolment, offerings and admissions. The
        removal was grades, not the job."""
        student, _a, _g = enrolled_student
        assert client.get(S, headers=graph.S).status_code == 200
        assert client.get(f"{S}/{student.id}", headers=graph.S).status_code == 200

    def test_the_registrar_still_reads_a_report_card(
        self, client, graph, enrolled_student
    ) -> None:
        """DELIBERATE, and worth stating. The brief named the Grades section, grade
        navigation and grade information on the registration screens; it did not name the
        Reports module, and issuing report cards is core registry work. Removing it would
        stop the Registrar doing their job. Flagged for BAJC in the plan doc §G."""
        student, _a, _g = enrolled_student
        resp = client.get(f"{REPORTS}/report-card?student_id={student.id}", headers=graph.S)
        assert resp.status_code == 200, resp.text


# ════════════════════════════════════════════════════════════════════════════
class TestAStudentNeverLearnsAboutARevision:
    """The client's most specific instruction (brief §4): "not grade revisions, just
    grades — so if the grade revision was accepted or denied the student should not know,
    they just will see the updated or old value."

    This already held before D32 (`revisions.list_revisions` admits only the Dean and the
    requesting Lecturer), so these are REGRESSION tests. They exist because the property is
    invisible: nothing fails if a future payload starts carrying revision state, and the
    only way to notice would be a student seeing it.
    """

    @pytest.fixture
    def revised(self, graph, db_session):
        """A graded result with an APPROVED revision from 60 to 91."""
        open_midterm_window(graph)
        assessment = graph.assessment(max_score="100", weight="1", is_released=True)
        student, enrollment = graph.student(with_login=True)
        grade = graph.grade(assessment, student, enrollment, score="60", is_released=True)
        backdate(graph, assessment=assessment, grade=grade)
        return assessment, student, grade

    def _approve(self, client, graph, assessment, student) -> str:
        revision_id = _request(client, graph, assessment, student).json()["id"]
        resp = client.post(
            f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"}
        )
        assert resp.status_code == 200, resp.text
        return revision_id

    def test_the_student_sees_the_REVISED_value_after_an_approval(
        self, client, graph, revised, student_grades_visible
    ) -> None:
        assessment, student, _grade = revised
        self._approve(client, graph, assessment, student)
        body = client.get(f"{G}/me", headers=graph.student_headers(student)).json()
        blob = repr(body)
        assert "91" in blob, blob

    def test_the_student_sees_the_ORIGINAL_value_after_a_denial(
        self, client, graph, revised, student_grades_visible
    ) -> None:
        assessment, student, _grade = revised
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "denied"})
        body = client.get(f"{G}/me", headers=graph.student_headers(student)).json()
        blob = repr(body)
        assert "60" in blob, blob

    def test_no_revision_vocabulary_reaches_the_student(
        self, client, graph, revised, student_grades_visible
    ) -> None:
        """A blunt substring sweep over the whole payload, on purpose. A targeted key
        assertion would pass the day someone adds `revision_status` under a new name."""
        assessment, student, _grade = revised
        self._approve(client, graph, assessment, student)
        headers = graph.student_headers(student)
        for path in (f"{G}/me", f"{G}/term?scope=me", f"{REPORTS}/report-card/me"):
            resp = client.get(path, headers=headers)
            assert resp.status_code == 200, (path, resp.text)
            blob = resp.text.lower()
            for token in ("revision", "approved", "denied", "makeup", "original_score"):
                assert token not in blob, f"{path} leaked {token!r}: {blob[:400]}"

    def test_the_student_cannot_read_the_revision_queue(
        self, client, graph, revised, student_grades_visible
    ) -> None:
        assessment, student, _grade = revised
        revision_id = self._approve(client, graph, assessment, student)
        headers = graph.student_headers(student)
        assert client.get(R, headers=headers).status_code == 403
        assert client.get(f"{R}/{revision_id}", headers=headers).status_code == 403

    def test_the_registrar_cannot_read_the_revision_queue_either(
        self, client, graph, revised
    ) -> None:
        """Unchanged by D32 — `list_revisions` already admitted only the Dean and the
        requesting Lecturer — but asserted here so the removal is recorded in one place."""
        assert client.get(R, headers=graph.S).status_code == 403


# ════════════════════════════════════════════════════════════════════════════
class TestTheGateIsTheServer:
    """The frontend `PERMISSION_MATRIX` hides the nav, but it is UX only. A student with a
    valid token and a direct call must still be refused — that is the whole reason the
    check is a dependency and not a screen."""

    def test_a_direct_call_with_a_valid_token_is_still_refused(
        self, client, graph, enrolled_student
    ) -> None:
        student, _a, _g = enrolled_student
        headers = graph.student_headers(student)
        assert client.get(f"{G}/me", headers=headers).status_code == 403

    def test_a_student_cannot_read_another_students_assessments(
        self, client, graph, enrolled_student, student_grades_visible
    ) -> None:
        """Even published, `/students/{id}/assessments` is staff-only — a student reads
        their own marks through `/grades/me`, which is scoped from the token."""
        student, _a, _g = enrolled_student
        resp = client.get(
            f"{S}/{student.id}/assessments", headers=graph.student_headers(student)
        )
        assert resp.status_code == 403, resp.text

    def test_the_role_check_still_runs_when_grades_are_published(
        self, client, graph, student_grades_visible, make_user, auth_headers
    ) -> None:
        """`require_student_grade_visibility` layers the flag ON TOP of the role gate; it
        must not have replaced it."""
        registrar = make_user(role=Role.SECRETARY)
        resp = client.get(
            f"{G}/me", headers=auth_headers(user_id=registrar.id, role=Role.SECRETARY)
        )
        assert resp.status_code == 403, resp.text

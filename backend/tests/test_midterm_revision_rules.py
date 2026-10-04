"""The D32 mid-term revision-eligibility rules (brief §1).

Kept beside `test_grade_revision.py` rather than inside it, for the same reason
`grades/revisions.py` sits beside `grades/service.py`: that suite is about the approval
WORKFLOW — who requests, who decides, that the original score survives — and this is
about WHICH results may enter it at all. Mixing them would bury one behind the other.

**What changed and why.** Before D32 the answer was "any graded cell, at any time",
because the only date the system knew was one end-of-term cutoff. That allowed a Lecturer
to appeal a mark on an assessment created AFTER the grading period it supposedly belonged
to — an edit dressed up as a revision. Each test below removes exactly ONE of the four
conditions from an otherwise-valid request and asserts the specific reason code, so a
later change that collapses two rules into one is caught rather than absorbed.

Every case also checks the GRADEBOOK's `can_request_revision`, because the button and the
endpoint must agree: a live button that answers 422 is worse than no button.

Hermetic + rolled back via `db_session`. Reuses `test_grades.py::_Graph` and
`test_grade_revision.py`'s helpers rather than rebuilding either.
"""

from __future__ import annotations

import pytest

from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on
from tests.test_grade_revision import (
    _assert_envelope,
    _request,
    _utc,
    backdate,
    open_midterm_window,
)

pytestmark = pytest.mark.requires_db

G = "/api/v1/grades"
R = "/api/v1/grade-revisions"


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
) -> _Graph:
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


def _cell(client, graph, assessment, student, *, headers=None):
    """The gradebook cell for one student × assessment, as the Lecturer's screen sees it."""
    body = client.get(
        f"{G}/offering/{graph.cs.id}", headers=headers or graph.H
    ).json()
    row = next(r for r in body["rows"] if r["student"]["id"] == str(student.id))
    return next(c for c in row["cells"] if c["assessment_id"] == str(assessment.id))


def _eligible(graph, **window):
    """A graded result inside a CLOSED mid-term window — the all-rules-pass baseline."""
    open_midterm_window(graph, **window)
    assessment = graph.assessment(max_score="100", weight="1")
    student, enrollment = graph.student()
    grade = graph.grade(assessment, student, enrollment, score="60")
    backdate(graph, assessment=assessment, grade=grade)
    return assessment, student, grade


# ════════════════════════════════════════════════════════════════════════════
class TestTheHappyPath:
    def test_all_four_rules_satisfied_allows_the_request(self, client, graph) -> None:
        assessment, student, _g = _eligible(graph)
        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is True
        assert cell["revision_blocked_reason"] is None

        r = _request(client, graph, assessment, student)
        assert r.status_code == 201, r.text


# ════════════════════════════════════════════════════════════════════════════
class TestRule1TheWindowMustExistAndHaveClosed:
    def test_a_term_with_no_midterm_window_allows_nothing(self, client, graph) -> None:
        """Every semester created before D32 is in this state. It keeps today's behaviour
        of no revisions rather than acquiring an unbounded one."""
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        backdate(graph, assessment=assessment, grade=grade)

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "no_midterm_window"

        r = _request(client, graph, assessment, student)
        assert r.status_code == 422, r.text
        err = _assert_envelope(r.json(), code="revision_not_eligible")
        assert err["fields"]["assessment_id"] == ["no_midterm_window"]

    def test_an_open_window_allows_nothing_yet(self, client, graph) -> None:
        """While the period is open the Lecturer can still just fix the mark. A revision
        is the post-hoc path, so it unlocks only once the window shuts."""
        assessment, student, _g = _eligible(graph, opened=-10, closed=+10)

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "midterm_window_open"

        r = _request(client, graph, assessment, student)
        assert r.status_code == 422, r.text
        _assert_envelope(r.json(), code="revision_not_eligible")

    def test_it_unlocks_the_moment_the_window_closes(self, client, graph, db_session) -> None:
        """The same result, same rows — only the clock moved."""
        assessment, student, _g = _eligible(graph, opened=-10, closed=+10)
        assert _cell(client, graph, assessment, student)["can_request_revision"] is False

        graph.sem.midterm_submission_end = _utc(-1)
        db_session.flush()
        assert _cell(client, graph, assessment, student)["can_request_revision"] is True


# ════════════════════════════════════════════════════════════════════════════
class TestRule2TheAssessmentMustPredateTheWindow:
    def test_an_assessment_created_after_the_window_opened_needs_no_revision(
        self, client, graph
    ) -> None:
        """THE CASE THE CLIENT NAMED. Post-midterm work is graded normally; there is
        nothing to appeal, because it was never part of the mid-term submission."""
        open_midterm_window(graph, opened=-30, closed=-1)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        # Assessment created INSIDE the window; the grade predates it, so rule 2 is the
        # only thing that can fire.
        backdate(graph, assessment=assessment, days=-15)
        backdate(graph, grade=grade, days=-60)

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "assessment_after_window"

        r = _request(client, graph, assessment, student)
        assert r.status_code == 422, r.text
        err = _assert_envelope(r.json(), code="revision_not_eligible")
        assert err["fields"]["assessment_id"] == ["assessment_after_window"]

    def test_an_assessment_created_after_the_window_CLOSED_needs_no_revision(
        self, client, graph
    ) -> None:
        """Naturally post-midterm work: created after the whole period ended."""
        open_midterm_window(graph, opened=-30, closed=-10)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        backdate(graph, assessment=assessment, grade=grade, days=-2)

        cell = _cell(client, graph, assessment, student)
        assert cell["revision_blocked_reason"] == "assessment_after_window"

    def test_an_assessment_created_exactly_at_the_opening_is_not_before_it(
        self, client, graph, db_session
    ) -> None:
        """The boundary is half-open on purpose: "existed BEFORE the start" is strict, so
        a row stamped at the same instant is inside the period, not preceding it."""
        open_midterm_window(graph, opened=-30, closed=-1)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        backdate(graph, grade=grade, days=-60)
        assessment.created_at = graph.sem.midterm_submission_start
        db_session.flush()

        assert (
            _cell(client, graph, assessment, student)["revision_blocked_reason"]
            == "assessment_after_window"
        )


# ════════════════════════════════════════════════════════════════════════════
class TestRule3TheGradeMustPredateTheWindow:
    def test_a_grade_entered_after_the_window_opened_was_not_submitted(
        self, client, graph
    ) -> None:
        """Rule 2 is about the assessment; this is about THIS student's result on it. A
        row first filled in mid-period was not part of the mid-term submission even though
        the assessment itself was."""
        open_midterm_window(graph, opened=-30, closed=-1)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        backdate(graph, assessment=assessment, days=-60)
        backdate(graph, grade=grade, days=-15)

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "grade_after_window"

        r = _request(client, graph, assessment, student)
        assert r.status_code == 422, r.text
        err = _assert_envelope(r.json(), code="revision_not_eligible")
        assert err["fields"]["assessment_id"] == ["grade_after_window"]

    def test_graded_at_wins_over_created_at(self, client, graph, db_session) -> None:
        """`graded_at` is when the mark was actually recorded, so it decides. A row created
        before the window but not graded until after it is post-midterm work."""
        open_midterm_window(graph, opened=-30, closed=-1)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        backdate(graph, assessment=assessment, days=-60)
        grade.created_at = _utc(-60)
        grade.graded_at = _utc(-15)
        db_session.flush()

        assert (
            _cell(client, graph, assessment, student)["revision_blocked_reason"]
            == "grade_after_window"
        )

    def test_created_at_is_the_fallback_when_graded_at_is_null(
        self, client, graph, db_session
    ) -> None:
        """Rows written before `graded_at` was populated must still resolve to an answer
        rather than blocking every revision on them."""
        open_midterm_window(graph, opened=-30, closed=-1)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, score="60")
        backdate(graph, assessment=assessment, days=-60)
        grade.created_at = _utc(-60)
        grade.graded_at = None
        db_session.flush()

        assert _cell(client, graph, assessment, student)["can_request_revision"] is True


# ════════════════════════════════════════════════════════════════════════════
class TestRule4TheCurrentSemester:
    def test_a_non_current_semester_is_settled(self, client, graph, db_session) -> None:
        """A closed term's marks are final — re-opening one through the revision queue
        would move a report card that has already been issued."""
        assessment, student, _g = _eligible(graph)
        graph.sem.is_active = False
        db_session.flush()

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "not_current_semester"

        r = _request(client, graph, assessment, student)
        assert r.status_code == 422, r.text
        err = _assert_envelope(r.json(), code="revision_not_eligible")
        assert err["fields"]["assessment_id"] == ["not_current_semester"]


# ════════════════════════════════════════════════════════════════════════════
class TestTheGradeMustExistAndBeGraded:
    """The pre-D32 rule, now reported through the same channel so the gradebook has one
    answer per cell rather than two half-answers."""

    def test_an_ungraded_result_has_nothing_to_revise(self, client, graph) -> None:
        open_midterm_window(graph)
        assessment = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(assessment, student, enrollment, status="absent", score=None)
        backdate(graph, assessment=assessment, grade=grade)

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "not_graded"

    def test_a_cell_with_no_grade_row_at_all(self, client, graph) -> None:
        """The Lecturer should ENTER the grade, not appeal a mark nobody gave."""
        open_midterm_window(graph)
        assessment = graph.assessment(max_score="100", weight="1")
        student, _enr = graph.student()
        backdate(graph, assessment=assessment)

        cell = _cell(client, graph, assessment, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "not_graded"


# ════════════════════════════════════════════════════════════════════════════
class TestEligibilityIsLecturerOnly:
    """`can_request_revision` answers "may YOU file one", so it is false for everyone who
    cannot. The Dean decides revisions and may not request them (§D7); the Registrar has
    no grade authority at all (§D14)."""

    def test_the_dean_sees_no_eligible_cells(self, client, graph) -> None:
        assessment, _student, _g = _eligible(graph)
        body = client.get(f"{G}/offering/{graph.cs.id}", headers=graph.P).json()
        cells = [c for row in body["rows"] for c in row["cells"]]
        assert cells, "the gradebook should not be empty"
        assert all(c["can_request_revision"] is False for c in cells)
        assert all(c["revision_blocked_reason"] is None for c in cells)
        assert assessment is not None

    def test_the_registrar_cannot_open_the_gradebook_at_all(self, client, graph) -> None:
        """D32 (brief §4) went further than the flag: the Registrar was removed from every
        grade route outright, so there is no gradebook for them to read cells from."""
        _eligible(graph)
        resp = client.get(f"{G}/offering/{graph.cs.id}", headers=graph.S)
        assert resp.status_code == 403, resp.text

    def test_the_dean_still_cannot_file_one(self, client, graph) -> None:
        """Unchanged by D32 — 403 on authority, before eligibility is consulted."""
        assessment, student, _g = _eligible(graph)
        r = _request(client, graph, assessment, student, headers=graph.P)
        assert r.status_code == 403, r.text


# ════════════════════════════════════════════════════════════════════════════
class TestDecidingIsNotDateGated:
    """A filed request must stay decidable. The window may well have moved by the time the
    Dean reaches the queue, and a request the system accepted must not become un-rulable —
    that would strand it as pending forever with no way to clear it."""

    def test_the_dean_can_still_rule_after_the_window_is_cleared(
        self, client, graph, db_session
    ) -> None:
        assessment, student, grade = _eligible(graph)
        revision_id = _request(client, graph, assessment, student).json()["id"]

        graph.sem.midterm_submission_start = None
        graph.sem.midterm_submission_end = None
        db_session.flush()

        r = client.post(
            f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"}
        )
        assert r.status_code == 200, r.text
        db_session.refresh(grade)
        assert grade.makeup_score is not None

    def test_the_requester_can_still_withdraw_after_the_window_moves(
        self, client, graph, db_session
    ) -> None:
        assessment, student, _grade = _eligible(graph)
        revision_id = _request(client, graph, assessment, student).json()["id"]

        graph.sem.midterm_submission_start = _utc(+10)
        graph.sem.midterm_submission_end = _utc(+20)
        db_session.flush()

        assert client.delete(f"{R}/{revision_id}", headers=graph.H).status_code == 204

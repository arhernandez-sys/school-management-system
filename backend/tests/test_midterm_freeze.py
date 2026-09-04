"""The mid-term GRADE-ENTRY FREEZE (D33, client ask 7).

D32 added `semesters.midterm_submission_start` / `_end` and used them for exactly one
thing: deciding whether a result had been part of the mid-term submission, and therefore
whether it could be *revised*. Nothing stopped a mark being typed in while the window was
running — so the snapshot the Dean freezes at the close of it was built from a set that
could still move underneath it. This suite pins the missing half:

    ── before `start` ─────  entry OPEN      (the mid-term submission period)
    ── `[start, end]` ─────  entry FROZEN    409 `midterm_frozen`      ← D33
    ── after `end` ────────  entry OPEN      new marks go in normally
                                             changing a pre-`start` mark needs a revision

The last two lines are why the boundary cases matter more than the middle: they are what
makes the client's "any new grades after end date for mid term will be normal, no revision
button" true, and they are the two the D32 revision rules already depend on.

Reuses `test_grades.py::_Graph` and `test_grade_revision.py`'s helpers rather than
rebuilding a year + offering + owning lecturer. Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.common.enums import Role
from app.modules.grades.models import AssessmentGrade
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on
from tests.test_grade_revision import _request, _utc, backdate

pytestmark = pytest.mark.requires_db

G = "/api/v1/grades"
A = "/api/v1/assessments"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) <= {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
) -> _Graph:
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


def _window(db_session, graph, *, opens: int | None, closes: int | None) -> None:
    """Set the term's mid-term window `opens`/`closes` days from now.

    Written directly. The Dean-only configuration endpoint is covered by
    `test_midterm_window.py`; here the window is a precondition, not the thing under test.
    """
    graph.sem.midterm_submission_start = None if opens is None else _utc(opens)
    graph.sem.midterm_submission_end = None if closes is None else _utc(closes)
    db_session.flush()


def _save(client, graph, assessment, student, *, headers=None, score="15"):
    return client.put(
        f"{A}/{assessment.id}/grades",
        headers=headers or graph.H,
        json={"entries": [{"student_id": str(student.id), "status": "graded", "score": score}]},
    )


def _gradebook(client, graph, *, headers=None) -> dict:
    return client.get(f"{G}/offering/{graph.cs.id}", headers=headers or graph.H).json()


def _cell(client, graph, assessment, student, *, headers=None) -> dict:
    body = _gradebook(client, graph, headers=headers)
    row = next(r for r in body["rows"] if r["student"]["id"] == str(student.id))
    return next(c for c in row["cells"] if c["assessment_id"] == str(assessment.id))


# ════════════════════════════════════════════════════════════════════════════
# The freeze itself, in upsert_grades — the single grade write path
# ════════════════════════════════════════════════════════════════════════════
class TestTheFreeze:
    def test_no_window_never_freezes(self, client, graph) -> None:
        """The state of every semester created before D32. It must stay open — an
        invented window would lock a live term out of grading entirely."""
        assert graph.sem.midterm_submission_start is None
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_inside_the_window_is_409_midterm_frozen(self, client, graph, db_session) -> None:
        _window(db_session, graph, opens=-2, closes=+5)
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_frozen")

    def test_before_the_window_opens_entry_is_open(self, client, graph, db_session) -> None:
        """This is the mid-term submission period itself. Freezing it would leave no time
        in which mid-term marks could be entered at all."""
        _window(db_session, graph, opens=+3, closes=+10)
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_after_the_window_closes_entry_reopens(self, client, graph, db_session) -> None:
        """"Any new grades after end date for mid term will be normal" — the client's
        words. The freeze is a period, not a one-way door."""
        _window(db_session, graph, opens=-30, closes=-1)
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_the_409_names_both_dates(self, client, graph, db_session) -> None:
        """"Frozen" with no reopen date is unactionable. The Lecturer's next question is
        always wait-or-file-a-revision, and the end date is the answer to it."""
        _window(db_session, graph, opens=-1, closes=+4)
        a = graph.assessment()
        student, _enr = graph.student()
        err = _assert_envelope(_save(client, graph, a, student).json(), code="midterm_frozen")
        assert err["midterm_submission_start"] is not None
        assert err["midterm_submission_end"] is not None

    def test_nothing_is_written_while_frozen(self, client, graph, db_session) -> None:
        """The guard runs BEFORE any mutation, so a refused batch leaves the gradebook
        exactly as it was — the same all-or-nothing discipline as the deadline check."""
        _window(db_session, graph, opens=-1, closes=+1)
        a = graph.assessment()
        student, _enr = graph.student()
        _save(client, graph, a, student)
        count = db_session.scalar(
            select(func.count())
            .select_from(AssessmentGrade)
            .where(AssessmentGrade.assessment_id == a.id)
        )
        assert count == 0

    def test_an_existing_grade_cannot_be_edited_while_frozen(
        self, client, graph, db_session
    ) -> None:
        """The freeze is about the MARKS, not about creating rows. A mark entered before
        the window opened is exactly what the mid-term snapshot will contain, so it is the
        one that most needs to stop moving."""
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student, score="15").status_code == 200
        _window(db_session, graph, opens=-1, closes=+1)
        resp = _save(client, graph, a, student, score="19")
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_frozen")

    def test_clearing_the_window_lets_the_same_save_through(
        self, client, graph, db_session
    ) -> None:
        """The Dean's escape hatch, and it must take effect without any other change —
        the guard reads the columns on every write."""
        _window(db_session, graph, opens=-1, closes=+1)
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 409
        _window(db_session, graph, opens=None, closes=None)
        assert _save(client, graph, a, student).status_code == 200

    def test_the_freeze_is_per_TERM_not_per_YEAR(self, client, graph, db_session) -> None:
        """A frozen Semester 1 must not freeze Semester 2. BAJC runs up to eight blocks in
        a plan and their mid-terms fall at different times — the same rule
        `test_grade_deadline.py` pins for the end-term cutoff."""
        from datetime import date

        from app.modules.offerings.models import ClassEnrollment
        from app.modules.settings.models import Semester

        other = Semester(
            academic_year_id=graph.year.id,
            name="Semester 2",
            sequence=2,
            start_date=date(2026, 2, 1),
            end_date=date(2026, 6, 30),
            is_active=False,
        )
        db_session.add(other)
        db_session.flush()
        _window(db_session, graph, opens=-1, closes=+1)

        student, _enr = graph.student()
        assert _save(client, graph, graph.assessment(), student).status_code == 409

        # The student's enrolment is in Semester 1; enrol them into the second term too,
        # or the save would fail on provenance rather than on the window.
        db_session.add(
            ClassEnrollment(
                offering_id=graph.section.id, student_id=student.id, semester_id=other.id
            )
        )
        db_session.flush()
        open_term = graph.assessment(semester_id=other.id)
        assert _save(client, graph, open_term, student).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
# Boundaries — the two instants the whole design turns on
# ════════════════════════════════════════════════════════════════════════════
class TestBoundaries:
    def test_the_start_instant_is_already_frozen(self, client, graph, db_session) -> None:
        """`start <= now`, inclusive. A mark landing exactly as the window opens belongs
        to the frozen side: the alternative leaves one instant in which the snapshot can
        still move."""
        now = datetime.now(tz=timezone.utc).replace(microsecond=0)
        graph.sem.midterm_submission_start = now - timedelta(seconds=1)
        graph.sem.midterm_submission_end = now + timedelta(days=2)
        db_session.flush()
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 409

    def test_the_end_instant_is_still_frozen(self, client, graph, db_session) -> None:
        """`now <= end`, inclusive — the mirror image of
        `midterm_revision_eligible`'s `utcnow() <= end`. If one were exclusive and the
        other inclusive there would be a single second in which a mark could neither be
        entered NOR revised."""
        now = datetime.now(tz=timezone.utc).replace(microsecond=0)
        graph.sem.midterm_submission_start = now - timedelta(days=2)
        graph.sem.midterm_submission_end = now + timedelta(seconds=30)
        db_session.flush()
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 409

    def test_a_naive_stored_window_does_not_500(self, client, graph, db_session) -> None:
        """MariaDB `DATETIME` comes back timezone-NAIVE through pymysql, and comparing
        that with an aware `utcnow()` raises TypeError. `ensure_aware` is what keeps this a
        clean 409 rather than an internal error on the save path — asserted explicitly,
        because the ORM sometimes hands back what was just written."""
        now = datetime.now()  # noqa: DTZ005 — naive on purpose
        graph.sem.midterm_submission_start = now - timedelta(days=1)
        graph.sem.midterm_submission_end = now + timedelta(days=1)
        db_session.flush()
        db_session.expire(graph.sem)
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_frozen")


# ════════════════════════════════════════════════════════════════════════════
# The gradebook read has to say so IN ADVANCE
# ════════════════════════════════════════════════════════════════════════════
class TestTheGradebookReportsIt:
    def test_frozen_is_reported_on_the_gradebook(self, client, graph, db_session) -> None:
        """Otherwise the Lecturer types forty marks into a form the server will 409 —
        the same argument that put `grade_window_closed` on this payload."""
        _window(db_session, graph, opens=-1, closes=+1)
        graph.assessment()
        body = _gradebook(client, graph)
        assert body["midterm_frozen"] is True
        assert body["midterm_submission_start"] is not None
        assert body["midterm_submission_end"] is not None

    def test_not_frozen_outside_the_window(self, client, graph, db_session) -> None:
        _window(db_session, graph, opens=-30, closes=-1)
        graph.assessment()
        body = _gradebook(client, graph)
        assert body["midterm_frozen"] is False
        # The DATES are still reported — the UI names the window that has just closed
        # when it explains why a Revision button has appeared.
        assert body["midterm_submission_end"] is not None

    def test_no_window_reports_false_and_no_dates(self, client, graph) -> None:
        graph.assessment()
        body = _gradebook(client, graph)
        assert body["midterm_frozen"] is False
        assert body["midterm_submission_start"] is None
        assert body["midterm_submission_end"] is None

    def test_the_freeze_is_distinct_from_a_closed_end_term_window(
        self, client, graph, db_session
    ) -> None:
        """Three states, three answers (see `Gradebook.midterm_frozen`). A frozen
        mid-term must not read as an ended term: one says wait, the other says file a
        revision."""
        _window(db_session, graph, opens=-1, closes=+1)
        graph.assessment()
        body = _gradebook(client, graph)
        assert body["midterm_frozen"] is True
        assert body["grade_window_closed"] is False

    def test_the_freeze_is_the_only_window_that_shuts_now(
        self, client, graph, db_session
    ) -> None:
        """Was `test_the_end_term_deadline_wins_when_both_are_shut`, which asserted the
        precedence between two windows. **D42 §5 retired the end-of-session deadline**, so
        there is no precedence left to order — and the question worth asking flipped: does
        a term carrying BOTH a past deadline and a running freeze still answer with the
        freeze's message?

        It must. `midterm_frozen` names a reopen date and `grade_window_closed` named a
        finished term; answering the second for a term that is merely mid-freeze would send
        a Lecturer to file a revision when all they had to do was wait.
        """
        graph.sem.grade_submission_deadline = _utc(-1)  # retired: must not influence this
        _window(db_session, graph, opens=-1, closes=+1)
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_frozen")


# ════════════════════════════════════════════════════════════════════════════
# What the freeze means for the revision workflow (the client's last sentence)
# ════════════════════════════════════════════════════════════════════════════
class TestInteractionWithRevisions:
    def test_a_pre_window_grade_takes_a_revision_after_the_window_closes(
        self, client, graph, db_session
    ) -> None:
        """"Lecturers can send a revision if they are trying to fix a previous grade."" """
        _window(db_session, graph, opens=-30, closes=-1)
        a = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(a, student, enrollment, score="60")
        backdate(graph, assessment=a, grade=grade)  # entered before the window opened

        cell = _cell(client, graph, a, student)
        assert cell["can_request_revision"] is True
        assert _request(client, graph, a, student).status_code == 201

    def test_a_grade_entered_AFTER_the_window_is_normal_with_no_revision(
        self, client, graph, db_session
    ) -> None:
        """"Any new grades after end date for mid term will be normal, no revision
        button." The mark goes in through the ordinary path, and the button stays off
        because the result was never part of the mid-term submission."""
        _window(db_session, graph, opens=-30, closes=-1)
        a = graph.assessment(max_score="100", weight="1")
        student, _enr = graph.student()

        # Entered now — after the window closed. No revision needed to do it.
        assert _save(client, graph, a, student, score="60").status_code == 200

        cell = _cell(client, graph, a, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] in {
            "assessment_after_window",
            "grade_after_window",
        }

    def test_the_freeze_and_the_revision_gate_cannot_both_be_shut(
        self, client, graph, db_session
    ) -> None:
        """The two rules partition time, which is what makes the design coherent: while
        the window runs entry is frozen and revision is refused as `midterm_window_open`;
        the instant it closes, entry reopens and revision becomes available. There is no
        moment in which a pre-window mark can be neither corrected nor appealed."""
        _window(db_session, graph, opens=-30, closes=+1)
        a = graph.assessment(max_score="100", weight="1")
        student, enrollment = graph.student()
        grade = graph.grade(a, student, enrollment, score="60")
        backdate(graph, assessment=a, grade=grade)

        # Frozen: no entry, and no revision either.
        assert _save(client, graph, a, student, score="70").status_code == 409
        cell = _cell(client, graph, a, student)
        assert cell["can_request_revision"] is False
        assert cell["revision_blocked_reason"] == "midterm_window_open"

        # Close it. Revision becomes the path — and it is available immediately.
        _window(db_session, graph, opens=-30, closes=-1)
        cell = _cell(client, graph, a, student)
        assert cell["can_request_revision"] is True


# ════════════════════════════════════════════════════════════════════════════
class TestDeanBypass:
    def test_the_dean_arm_skips_the_freeze(self, graph, db_session) -> None:
        """The Dean is exempt, matching `_assert_grade_window_open` — asserted at the
        SERVICE level because the arm is unreachable over HTTP by design.

        `PUT /assessments/{id}/grades` is `require_role(TEACHER)`, and
        `assert_teacher_owns_offering` would 404 a Dean regardless, so no Dean enters a
        grade at all today. The Dean's sanctioned path through a freeze is approving a
        revision rather than typing the mark; the rule is pinned here so it cannot rot
        before the route changes.
        """
        from app.modules.grades.service import _assert_midterm_not_frozen

        _window(db_session, graph, opens=-1, closes=+1)
        a = graph.assessment()

        with pytest.raises(Exception) as exc:
            _assert_midterm_not_frozen(db_session, a, graph.teacher_user)
        assert getattr(exc.value, "code", None) == "midterm_frozen"

        dean = graph.principal_user
        assert dean.role == Role.PRINCIPAL
        _assert_midterm_not_frozen(db_session, a, dean)  # must not raise

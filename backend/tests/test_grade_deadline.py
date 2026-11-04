"""The grade-submission deadline — **RETIRED by D42 §5**.

D30 §D6 made `semesters.grade_submission_deadline` a hard cutoff: once it passed, the
Lecturer's grade write was refused with 409 `grade_window_closed`. The client asked for the
end-of-session deadline to leave Academic Structure and for the MID-SESSION FREEZE to be
the only thing that stops grade entry, so the enforcement went with the field.

**This file did not become obsolete; it changed sides.** The column still exists and is
still written — historic terms carry real values, and dropping it on live `sims` is a
one-way door — so the thing worth testing is now that a stored deadline has NO EFFECT.
Deleting these tests would have left "a deadline nobody reads" as an untested claim, and
the very failure mode the removal was meant to prevent (a leftover deadline silently
locking a lecturer out, with no Dean control that could clear it) would be invisible.

`TestDeanOnlySetter` at the bottom is unchanged: writing the column is still a Dean-only
operation and still stores UTC correctly. What it no longer does is close anything.

Reuses `test_grades.py::_Graph` rather than rebuilding a year + section + offering +
owning teacher: this suite is about ONE rule layered onto that graph, and a second
copy of the fixture would drift from the first.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

G = "/api/v1/grades"
A = "/api/v1/assessments"
SEMESTERS = "/api/v1/settings/semesters"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) <= {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


def _save(client, graph, assessment, student, *, headers=None, score="15"):
    return client.put(
        f"{A}/{assessment.id}/grades",
        headers=headers or graph.H,
        json={"entries": [{"student_id": str(student.id), "status": "graded", "score": score}]},
    )


def _set_deadline(db_session, graph, when) -> None:
    """Write the deadline directly. The Dean-only endpoint is covered separately;
    here it is a precondition, not the thing under test."""
    graph.sem.grade_submission_deadline = when
    db_session.flush()


# ════════════════════════════════════════════════════════════════════════════
# Enforcement in upsert_grades — the single grade write path
# ════════════════════════════════════════════════════════════════════════════
class TestTheDeadlineNoLongerBlocks:
    """The whole of D30 §D6's enforcement, asserted as its own absence."""

    def test_no_deadline_never_blocks(self, client, graph) -> None:
        """NULL is the state of every term in the school today; it must stay open."""
        assert graph.sem.grade_submission_deadline is None
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_future_deadline_allows_the_save(self, client, graph, db_session) -> None:
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) + timedelta(days=7))
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_a_PAST_deadline_no_longer_blocks(self, client, graph, db_session) -> None:
        """The inversion of `test_past_deadline_is_409_grade_window_closed` (D42 §5).

        This is the test that matters. A term whose deadline passed last month is exactly
        the state that would have locked its lecturers out for good once the Dean's field
        was removed from the form: nothing in the UI could have shown or cleared it.
        """
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 200, resp.text

    def test_a_long_past_deadline_still_writes_the_grade(
        self, client, graph, db_session
    ) -> None:
        """A 200 is not enough on its own — assert the row actually landed, since the
        old guard refused BEFORE any mutation and an all-or-nothing batch that silently
        wrote nothing would also answer 200 if the guard were replaced by a no-op."""
        from sqlalchemy import func, select

        from app.modules.grades.models import AssessmentGrade

        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=400))
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200
        count = db_session.scalar(
            select(func.count())
            .select_from(AssessmentGrade)
            .where(AssessmentGrade.assessment_id == a.id)
        )
        assert count == 1

    def test_a_naive_stored_deadline_does_not_500(self, client, graph, db_session) -> None:
        """MariaDB `DATETIME` comes back timezone-NAIVE through pymysql, and the old guard
        needed `ensure_aware` to avoid a TypeError comparing it with `utcnow()`. Nothing
        compares it any more, so the naive case must be a plain 200 — kept because a
        future reader reinstating any read of this column needs the trap flagged."""
        _set_deadline(db_session, graph, datetime.now() - timedelta(days=1))  # noqa: DTZ005
        db_session.expire(graph.sem)
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 200, resp.text

    def test_the_midterm_freeze_still_blocks(self, client, graph, db_session) -> None:
        """The rule that SURVIVED. Removing one window must not have removed the other —
        `test_midterm_freeze.py` owns this behaviour in full; this is the guard that stops
        D42 being read as "grade entry can no longer be stopped at all"."""
        now = datetime.now(tz=timezone.utc)
        graph.sem.midterm_submission_start = now - timedelta(days=1)
        graph.sem.midterm_submission_end = now + timedelta(days=1)
        db_session.flush()
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_frozen")


# ════════════════════════════════════════════════════════════════════════════
# The gradebook read reports an open window, always
# ════════════════════════════════════════════════════════════════════════════
class TestGradebookAlwaysReportsAnOpenWindow:
    """`grade_window_closed` / `grade_submission_deadline` stay on the wire so a client
    built against the older contract still parses the response — as constants."""

    def _book(self, client, graph, headers=None):
        return client.get(
            f"{G}/offering/{graph.cs.id}", headers=headers or graph.H
        ).json()

    def test_no_deadline_reports_false_and_null(self, client, graph) -> None:
        body = self._book(client, graph)
        assert body["grade_window_closed"] is False
        assert body["grade_submission_deadline"] is None

    def test_a_stored_past_deadline_is_not_reported(
        self, client, graph, db_session
    ) -> None:
        """Was `test_closed_window_reports_true_and_the_date`. The gradebook must not
        surface a cutoff the save path will not honour: a "Grading closed" banner over a
        form that saves fine is worse than no banner."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        body = self._book(client, graph)
        assert body["grade_window_closed"] is False
        assert body["grade_submission_deadline"] is None

    def test_a_stored_future_deadline_is_not_reported_either(
        self, client, graph, db_session
    ) -> None:
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) + timedelta(days=5))
        body = self._book(client, graph)
        assert body["grade_window_closed"] is False
        assert body["grade_submission_deadline"] is None

    def test_can_edit_is_unaffected(self, client, graph, db_session) -> None:
        """`can_edit` keeps meaning 'your role and ownership permit writing here' — the
        one thing about this response D42 did not touch."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        book = self._book(client, graph)
        assert book["can_edit"] is True
        assert book["grade_window_closed"] is False

    def test_the_dean_sees_the_same_open_window(self, client, graph, db_session) -> None:
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        book = self._book(client, graph, headers=graph.P)
        assert book["can_edit"] is False
        assert book["grade_window_closed"] is False

    def test_the_registrar_cannot_read_the_gradebook_at_all(
        self, client, graph, db_session
    ) -> None:
        """D32, brief §4 — unconditional, no toggle. See `grades/router.py`."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        resp = client.get(f"{G}/offering/{graph.cs.id}", headers=graph.S)
        assert resp.status_code == 403, resp.text


# ════════════════════════════════════════════════════════════════════════════
# The Dean-only setter
# ════════════════════════════════════════════════════════════════════════════
class TestDeanOnlySetter:
    """Still Dean-only, still stored as UTC — it just no longer closes anything (D42 §5).

    Kept in full because the column is still written by the API. If a future change drops
    it from the schemas, these are the tests that will say so out loud."""

    def test_dean_sets_the_deadline_via_patch(self, client, graph) -> None:
        when = (datetime.now(tz=timezone.utc) + timedelta(days=10)).replace(microsecond=0)
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.P,
            json={"grade_submission_deadline": when.isoformat()},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["grade_submission_deadline"] is not None

    def test_dean_clears_the_deadline_with_explicit_null(self, client, graph, db_session) -> None:
        """`null` REOPENS the window. This is why the service consults
        `model_fields_set` instead of checking for None — see `SemesterUpdateRequest`."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.P,
            json={"grade_submission_deadline": None},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["grade_submission_deadline"] is None

    def test_a_patch_that_omits_the_field_leaves_it_alone(
        self, client, graph, db_session
    ) -> None:
        """THE REGRESSION THIS FILE EXISTS FOR: renaming a term must not reopen it.

        Every other field on `SemesterUpdateRequest` treats None as 'leave alone', so a
        naive `if payload.x is not None` would have silently cleared the deadline on any
        unrelated edit — reopening a closed term with no audit trail and no intent.
        """
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}", headers=graph.P, json={"name": "Renamed Term"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Renamed Term"
        assert body["grade_submission_deadline"] is not None

    def test_the_registrar_may_not_set_it(self, client, graph) -> None:
        """Grade-submission deadlines are Dean-only academic authority (§D14)."""
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.S,
            json={"grade_submission_deadline": None},
        )
        assert resp.status_code == 403

    def test_a_lecturer_may_not_set_it(self, client, graph) -> None:
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.H,
            json={"grade_submission_deadline": None},
        )
        assert resp.status_code == 403

    def test_post_semesters_accepts_a_deadline_at_creation(self, client, graph) -> None:
        when = (datetime.now(tz=timezone.utc) + timedelta(days=60)).replace(microsecond=0)
        resp = client.post(
            SEMESTERS,
            headers=graph.P,
            json={
                "academic_year_id": str(graph.year.id),
                "name": "Summer 1",
                "term_type": "summer",
                "sequence": 9,
                "start_date": "2026-07-01",
                "end_date": "2026-08-31",
                "grade_submission_deadline": when.isoformat(),
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["grade_submission_deadline"] is not None

    def test_post_semesters_defaults_to_no_deadline(self, client, graph) -> None:
        """A term created without one never closes — the safe default. A guessed cutoff
        would lock lecturers out of a term nobody has finished teaching."""
        resp = client.post(
            SEMESTERS,
            headers=graph.P,
            json={
                "academic_year_id": str(graph.year.id),
                "name": "Spring 1",
                "term_type": "spring",
                "sequence": 8,
                "start_date": "2026-03-01",
                "end_date": "2026-04-30",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["grade_submission_deadline"] is None

    def test_an_offset_deadline_is_stored_as_utc(self, client, graph, db_session) -> None:
        """A Dean in Belize sends `...-06:00`. The column is a naive MariaDB DATETIME,
        so without normalising first the offset is dropped and the real cutoff moves six
        hours earlier — 17:00 Belize stored as 17:00 UTC.

        Asserted through behaviour rather than the stored bytes: a deadline of
        23:00-06:00 today is 05:00 UTC TOMORROW, so the window must still be OPEN even
        though the naive reading (23:00 "UTC") is already in the past by mid-evening.
        """
        from sqlalchemy import select

        from app.core.timeutil import ensure_aware
        from app.modules.settings.models import Semester

        when = datetime.now(tz=timezone.utc) + timedelta(hours=6)
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.P,
            # Same instant, expressed in Belize civil time.
            json={"grade_submission_deadline": when.astimezone(
                timezone(timedelta(hours=-6))
            ).isoformat()},
        )
        assert resp.status_code == 200, resp.text

        db_session.expire_all()
        stored = ensure_aware(
            db_session.scalar(
                select(Semester.grade_submission_deadline).where(
                    Semester.id == graph.sem.id
                )
            )
        )
        # Within a second of the intended instant, not six hours off it.
        assert abs((stored - when).total_seconds()) < 2

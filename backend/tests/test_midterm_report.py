"""Mid-term report cards, frozen from `report_card_snapshots` (D32 Phase 4, brief §5/§6).

**The one behaviour that matters, and the reason the feature exists:** a mid-term report
must show what the student had at mid-term. Everything else in this system computes grades
on read (§10.5), which is right for a live term and wrong for a document already issued —
recomputing a mid-term card in November would fold in October's post-midterm work and
silently move a mark a parent has already seen.

So `test_the_frozen_card_does_NOT_move_when_a_grade_changes` is the load-bearing test here.
The rest exist to stop the ways that could quietly stop being true:

  * the ARCHIVE freeze and the MID-TERM freeze must not overwrite each other — they share
    a student and a semester and were distinguished only by the `kind` column `009` added;
  * the freeze must refuse while the window is open, because capturing a half-entered
    gradebook and calling it final is worse than refusing;
  * it must be idempotent, or the lazy fallback would duplicate under two concurrent
    first-reads and the Dean could never re-freeze after a correction;
  * the END-TERM path must be completely unchanged — this feature is additive, and the
    default `kind` is what every pre-D32 caller already sends.

Hermetic + rolled back via `db_session`. Reuses `test_reports.py::_Graph`.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.common.enums import ReportCardKind
from app.modules.reports.models import ReportCardSnapshot
from tests.test_reports import _Graph, _assert_envelope  # noqa: F401

pytestmark = pytest.mark.requires_db

R = "/api/v1/reports"
SETTINGS = "/api/v1/settings"


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
) -> _Graph:
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


def _utc(days: int) -> datetime:
    return (datetime.now(tz=timezone.utc) + timedelta(days=days)).replace(microsecond=0)


def _window(graph, *, opened: int = -30, closed: int = -1) -> None:
    """A mid-term window on the graph's active term. Closed yesterday by default."""
    graph.sem.midterm_submission_start = _utc(opened)
    graph.sem.midterm_submission_end = _utc(closed)
    graph._db.flush()


def _marked(graph, *, score: str = "80"):
    """The graph's student with one graded assessment worth `score`."""
    assessment = graph.assessment()
    grade = graph.grade(assessment, graph.student, graph.enrollment, score=score)
    return assessment, grade


def _card(
    client, graph, *, kind: str | None = None, headers=None, student_id=None, semester_id=None
):
    params = [f"student_id={student_id or graph.student.id}"]
    if kind:
        params.append(f"kind={kind}")
    if semester_id:
        params.append(f"semester_id={semester_id}")
    return client.get(f"{R}/report-card?{'&'.join(params)}", headers=headers or graph.P)


def _freeze(client, graph, headers=None):
    return client.post(
        f"{SETTINGS}/semesters/{graph.sem.id}/midterm-freeze", headers=headers or graph.P
    )


# ════════════════════════════════════════════════════════════════════════════
class TestTheFreezeIsWhatMakesItHistorical:
    """The whole point of §5/§6, in three tests."""

    def test_the_frozen_card_does_NOT_move_when_a_grade_changes(
        self, client, graph, db_session
    ) -> None:
        """THE LOAD-BEARING TEST. Freeze at 80, change the mark to 30, re-read: still 80.

        If this ever fails, the mid-term report has silently gone back to recalculating
        and the feature is gone — even though every other test here would still pass.
        """
        _window(graph)
        _assessment, grade = _marked(graph, score="80")
        assert _freeze(client, graph).status_code == 200

        before = _card(client, graph, kind="midterm").json()
        assert before["term_average"] == 80.0

        grade.score = Decimal("30")
        db_session.flush()

        after = _card(client, graph, kind="midterm").json()
        assert after["term_average"] == 80.0, "the mid-term card recalculated"
        assert after["subjects"] == before["subjects"]

    def test_the_END_TERM_card_DOES_move_when_a_grade_changes(
        self, client, graph, db_session
    ) -> None:
        """The contrast that proves the previous test is measuring the freeze and not
        some caching accident: the same change, on the same student, through the default
        report kind, moves exactly as it always has."""
        _window(graph)
        _assessment, grade = _marked(graph, score="80")
        assert _card(client, graph).json()["term_average"] == 80.0

        grade.score = Decimal("30")
        db_session.flush()

        assert _card(client, graph).json()["term_average"] == 30.0

    def test_the_frozen_card_survives_a_new_post_midterm_assessment(
        self, client, graph
    ) -> None:
        """Work graded AFTER the mid-term period must not appear on the mid-term card —
        that is the same rule the revision workflow enforces, seen from the report side."""
        _window(graph)
        _marked(graph, score="80")
        assert _freeze(client, graph).status_code == 200
        frozen_subjects = _card(client, graph, kind="midterm").json()["subjects"]

        later = graph.assessment()
        graph.grade(later, graph.student, graph.enrollment, score="10")

        after = _card(client, graph, kind="midterm").json()
        assert after["subjects"] == frozen_subjects
        assert after["term_average"] == 80.0
        # …while the end-term card takes it into account, as it should.
        assert _card(client, graph).json()["term_average"] == 45.0


# ════════════════════════════════════════════════════════════════════════════
class TestTheFreezeEndpoint:
    def test_the_dean_freezes_a_closed_window(self, client, graph) -> None:
        _window(graph)
        _marked(graph)
        resp = _freeze(client, graph)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["snapshots_written"] >= 1
        assert body["semester_id"] == str(graph.sem.id)
        assert body["frozen_at"]

    def test_freezing_an_OPEN_window_is_409(self, client, graph) -> None:
        """Capturing a half-entered gradebook and calling it final is worse than
        refusing, so this is a hard error rather than a partial freeze."""
        _window(graph, opened=-10, closed=+10)
        _marked(graph)
        resp = _freeze(client, graph)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_window_open")

    def test_freezing_a_term_with_no_window_is_422(self, client, graph) -> None:
        """No window means no mid-term period. Guessing a cutoff would be worse than
        refusing, and this is the state of every term created before D32."""
        _marked(graph)
        resp = _freeze(client, graph)
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="no_midterm_window")

    def test_it_is_idempotent(self, client, graph, db_session) -> None:
        """Re-running refreshes in place. This is what lets the Dean re-freeze after
        correcting a mark, and what makes the lazy fallback safe under a race."""
        _window(graph)
        _marked(graph)
        first = _freeze(client, graph).json()
        second = _freeze(client, graph).json()
        assert first["snapshots_written"] == second["snapshots_written"]

        rows = list(
            db_session.scalars(
                select(ReportCardSnapshot).where(
                    ReportCardSnapshot.semester_id == graph.sem.id,
                    ReportCardSnapshot.kind == ReportCardKind.MIDTERM,
                )
            ).all()
        )
        assert len(rows) == first["snapshots_written"], "a re-freeze duplicated rows"

    def test_a_refreeze_PICKS_UP_a_correction(self, client, graph, db_session) -> None:
        """Idempotence must not mean "frozen forever". A Dean who corrects a mark and
        re-freezes should get the corrected document."""
        _window(graph)
        _assessment, grade = _marked(graph, score="80")
        _freeze(client, graph)
        assert _card(client, graph, kind="midterm").json()["term_average"] == 80.0

        grade.score = Decimal("55")
        db_session.flush()
        _freeze(client, graph)
        assert _card(client, graph, kind="midterm").json()["term_average"] == 55.0

    def test_only_the_dean_may_freeze(self, client, graph) -> None:
        _window(graph)
        _marked(graph)
        assert _freeze(client, graph, headers=graph.S).status_code == 403
        assert _freeze(client, graph, headers=graph.T).status_code == 403

    def test_an_unknown_semester_is_404(self, client, graph) -> None:
        resp = client.post(
            f"{SETTINGS}/semesters/{uuid.uuid4()}/midterm-freeze", headers=graph.P
        )
        assert resp.status_code == 404, resp.text

    def test_it_writes_no_term_grade_snapshots(self, client, graph, db_session) -> None:
        """`term_grade_snapshots` is the TRANSCRIPT's source and describes a finished
        term. A mid-term figure written there would surface on a transcript as though the
        term had ended."""
        from app.modules.grades.models import TermGradeSnapshot

        _window(graph)
        _marked(graph)
        _freeze(client, graph)
        rows = list(
            db_session.scalars(
                select(TermGradeSnapshot).where(
                    TermGradeSnapshot.semester_id == graph.sem.id
                )
            ).all()
        )
        assert rows == []


# ════════════════════════════════════════════════════════════════════════════
class TestTheLazyFallback:
    """There is no scheduler in this backend (`app/jobs/purge.py` says so explicitly), so
    a mid-term report requested after the window closes freezes itself rather than being
    simply missing."""

    def test_reading_after_the_window_closes_freezes_on_the_spot(
        self, client, graph, db_session
    ) -> None:
        _window(graph)
        _marked(graph, score="80")
        assert (
            db_session.scalar(
                select(ReportCardSnapshot).where(
                    ReportCardSnapshot.semester_id == graph.sem.id,
                    ReportCardSnapshot.kind == ReportCardKind.MIDTERM,
                )
            )
            is None
        )

        # `semester_id` is explicit here because archiving DEACTIVATES the year's terms,
        # so there is no active term left to fall back to. The UI always sends one.
        resp = _card(client, graph, kind="midterm", semester_id=graph.sem.id)
        assert resp.status_code == 200, resp.text
        assert resp.json()["term_average"] == 80.0
        assert (
            db_session.scalar(
                select(ReportCardSnapshot).where(
                    ReportCardSnapshot.semester_id == graph.sem.id,
                    ReportCardSnapshot.kind == ReportCardKind.MIDTERM,
                )
            )
            is not None
        )

    def test_the_lazily_frozen_card_is_then_stable(
        self, client, graph, db_session
    ) -> None:
        """Freezing on read must produce a real freeze, not a one-off computation."""
        _window(graph)
        _assessment, grade = _marked(graph, score="80")
        assert _card(client, graph, kind="midterm").json()["term_average"] == 80.0

        grade.score = Decimal("20")
        db_session.flush()
        assert _card(client, graph, kind="midterm").json()["term_average"] == 80.0

    def test_reading_BEFORE_the_window_closes_is_409(self, client, graph) -> None:
        _window(graph, opened=-10, closed=+10)
        _marked(graph)
        resp = _card(client, graph, kind="midterm")
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="midterm_window_open")

    def test_reading_with_no_window_configured_is_422(self, client, graph) -> None:
        _marked(graph)
        resp = _card(client, graph, kind="midterm")
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="no_midterm_window")

    def test_a_student_with_no_enrolment_in_the_term_is_404(
        self, client, graph, db_session
    ) -> None:
        """404 rather than an empty card: a blank document reads as "no marks earned",
        which is a different and wrong statement."""
        from app.modules.students.models import StudentProfile
        from tests.conftest import split_name
        from datetime import date

        _window(graph)
        _marked(graph)
        _freeze(client, graph)

        outsider = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            **split_name("No Enrolment"),
            date_of_birth=date(2012, 1, 1),
            enrollment_date=date(2025, 9, 1),
            status="Registered",
            year_of_study="First",
        )
        db_session.add(outsider)
        db_session.flush()

        resp = _card(client, graph, kind="midterm", student_id=outsider.id)
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="no_midterm_snapshot")


# ════════════════════════════════════════════════════════════════════════════
class TestTheTwoKindsDoNotCollide:
    """`009` widened `uq_report_card_snapshot` to include `kind` precisely so these two
    can coexist. Without it the second freeze would overwrite the first and destroy the
    record the client asked to preserve."""

    def test_archiving_the_year_leaves_the_midterm_card_alone(
        self, client, graph, db_session
    ) -> None:
        _window(graph)
        _assessment, grade = _marked(graph, score="80")
        _freeze(client, graph)

        # A post-midterm correction, then archive the year — which runs the END-TERM
        # freeze over the same student and semester.
        grade.score = Decimal("40")
        db_session.flush()
        resp = client.post(
            f"{SETTINGS}/academic-years/{graph.year.id}/archive", headers=graph.P
        )
        assert resp.status_code == 202, resp.text

        rows = {
            r.kind: r
            for r in db_session.scalars(
                select(ReportCardSnapshot).where(
                    ReportCardSnapshot.student_id == graph.student.id,
                    ReportCardSnapshot.semester_id == graph.sem.id,
                )
            ).all()
        }
        assert set(rows) == {ReportCardKind.MIDTERM, ReportCardKind.ENDTERM}
        assert rows[ReportCardKind.MIDTERM].payload["term_average"] == 80.0
        assert rows[ReportCardKind.ENDTERM].payload["term_average"] == 40.0

    def test_the_midterm_card_still_reads_correctly_after_archival(
        self, client, graph, db_session
    ) -> None:
        _window(graph)
        _assessment, grade = _marked(graph, score="80")
        _freeze(client, graph)
        grade.score = Decimal("40")
        db_session.flush()
        client.post(f"{SETTINGS}/academic-years/{graph.year.id}/archive", headers=graph.P)

        # `semester_id` is explicit here because archiving DEACTIVATES the year's terms,
        # so there is no active term left to fall back to. The UI always sends one.
        resp = _card(client, graph, kind="midterm", semester_id=graph.sem.id)
        assert resp.status_code == 200, resp.text
        assert resp.json()["term_average"] == 80.0


# ════════════════════════════════════════════════════════════════════════════
class TestThePayloadShape:
    def test_a_frozen_card_reports_its_kind_and_freeze_time(self, client, graph) -> None:
        _window(graph)
        _marked(graph)
        _freeze(client, graph)
        body = _card(client, graph, kind="midterm").json()
        assert body["report_kind"] == "midterm"
        assert body["is_frozen"] is True
        assert body["frozen_at"] is not None

    def test_a_computed_card_reports_endterm_and_no_freeze_time(
        self, client, graph
    ) -> None:
        _window(graph)
        _marked(graph)
        body = _card(client, graph).json()
        assert body["report_kind"] == "endterm"
        assert body["is_frozen"] is False
        assert body["frozen_at"] is None

    def test_the_frozen_card_carries_the_same_fields_as_a_live_one(
        self, client, graph
    ) -> None:
        """The payload is a whole `ReportCard`, validated on the way back out, so a field
        added to the schema after a freeze takes its default rather than arriving missing."""
        _window(graph)
        _marked(graph)
        _freeze(client, graph)
        frozen = _card(client, graph, kind="midterm").json()
        live = _card(client, graph).json()
        assert set(frozen.keys()) == set(live.keys())

    def test_an_invalid_kind_is_422(self, client, graph) -> None:
        resp = client.get(
            f"{R}/report-card?student_id={graph.student.id}&kind=quarterly",
            headers=graph.P,
        )
        assert resp.status_code == 422, resp.text


# ════════════════════════════════════════════════════════════════════════════
class TestTheStudentPath:
    """`/reports/report-card/me`, which is also gated by the Dean's grade-visibility
    switch (D32 Phase 3) — hence the fixture on the class."""

    @pytest.fixture(autouse=True)
    def _published(self, student_grades_visible):
        return student_grades_visible

    def test_a_student_reads_their_own_frozen_midterm_card(self, client, graph) -> None:
        _window(graph)
        _marked(graph, score="80")
        _freeze(client, graph)
        resp = client.get(f"{R}/report-card/me?kind=midterm", headers=graph.U)
        assert resp.status_code == 200, resp.text
        assert resp.json()["report_kind"] == "midterm"

    def test_the_frozen_card_is_NOT_release_filtered(self, client, graph) -> None:
        """A frozen card is a document already issued. Re-applying "hide subjects with
        unreleased work" to it would blank rows the student has already been shown,
        because release state has moved on since the freeze."""
        _window(graph)
        assessment = graph.assessment(is_released=True)
        graph.grade(assessment, graph.student, graph.enrollment, score="80")
        _freeze(client, graph)

        assessment.is_released = False
        graph._db.flush()

        body = client.get(f"{R}/report-card/me?kind=midterm", headers=graph.U).json()
        assert body["term_average"] == 80.0
        assert all(s["status"] == "graded" for s in body["subjects"] if s["numeric"])

    def test_the_student_default_is_still_the_end_term_card(self, client, graph) -> None:
        _window(graph)
        _marked(graph)
        body = client.get(f"{R}/report-card/me", headers=graph.U).json()
        assert body["report_kind"] == "endterm"

    def test_grades_hidden_blocks_the_midterm_card_too(
        self, client, graph, set_assessment_policy
    ) -> None:
        _window(graph)
        _marked(graph)
        _freeze(client, graph)
        set_assessment_policy(students_can_view_grades=False)
        resp = client.get(f"{R}/report-card/me?kind=midterm", headers=graph.U)
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="grades_hidden")

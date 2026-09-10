"""`coursestatus` — how a student is sitting one offering (D35, client request).

**The column was DEAD.** `class_enrollments.enrollment_status` has existed since
`005_tertiary.sql` §8, which moved it off `courses.coursestatus` in the client's original
schema — an enrolment fact parked on the CATALOG, where marking one student as auditing
would have marked everyone taking the course. But until D35 it was *mapped and nothing
else*: no endpoint set it, no calculation read it, no test touched it, and all 393 live
rows said `enrolled`. The same write-only trap D32 found on
`report_card_snapshots.storage_key`.

This suite is what makes it real. Three claims, in order of how badly they would hurt if
wrong:

  1. **It is settable**, on enrol and afterwards, and a withdrawal is NOT an un-enrolment.
  2. **It changes the arithmetic**, and the values are NOT scored alike. Neither
     `audit`, `withdrawn` nor `dropped` earns credit, and all three leave the GPA
     **entirely** — numerator and denominator. Scoring any of them would be inventing a
     grade. `failed` is the opposite: credits in the denominator, zero quality points.
     Before D35 all of them filed as `in_progress` forever and sat in the denominator with
     no quality points — a silently depressed GPA that no screen could explain.
  3. **The transcript prints the notation** (`AU` / `W`). A permanent record that omits
     the course a student withdrew from is not a transcript.

⚠️ **D45 §19 REPLACED THE VOCABULARY AND ONE RULE DIED WITH IT.**

D35 established with BAJC (2026-08-23) that a withdrawal-PASSING leaves the GPA alone
while a withdrawal-FAILING counts as a fail — *"w/f is a f because its like a student
dropout while failing"*. The revised blueprint's §19 lists a single flat "Withdrawn", and
the client reaffirmed that on 2026-09-08 after being shown this exact consequence.

So `test_W_P_and_W_F_are_scored_DIFFERENTLY` is GONE: it pinned a distinction the record
can no longer make. What replaced it is `test_a_withdrawal_and_a_FAIL_are_scored_
DIFFERENTLY` — the fail treatment survived, under the name `failed`, and the contrast is
still worth a test because it is still the thing most easily got wrong.

The surviving withdrawal treatment is "leaves the GPA", not "counts as a fail", because
the other direction would silently re-score every student who was passing when they left.
⚠️ Blueprint §29 makes withdrawal treatment configurable in Phase 5; until then this suite
pins an assumption, not BAJC policy.

Reuses `test_program_change.py::_Graph` — a student on a programme with three courses in a
live term, which is exactly the shape these assertions need. Hermetic + rolled back.
"""

from __future__ import annotations

import uuid

import pytest

from app.common.enums import EnrollmentStatus
from tests.test_program_change import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

S = "/api/v1/students"
O = "/api/v1/offerings"
R = "/api/v1/reports"


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale):
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) <= {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


def _set_status(client, graph, course, status, *, headers=None, reason=None):
    """PATCH the student's course status on `course`'s offering."""
    enr = graph.enrollments[course.id]
    body = {"enrollment_status": status}
    if reason is not None:
        body["reason"] = reason
    return client.patch(
        f"{O}/{graph.offerings[course.id].id}/enrollments/{enr.id}",
        headers=headers or graph.S,
        json=body,
    )


def _history(client, graph, headers=None) -> dict:
    r = client.get(f"{S}/{graph.student.id}/academic-history", headers=headers or graph.S)
    assert r.status_code == 200, r.text
    return r.json()


def _row(history: dict, course) -> dict:
    return next(c for c in history["courses"] if c["course_id"] == str(course.id))


def _roster(client, graph, course, headers=None) -> list[dict]:
    r = client.get(f"{O}/{graph.offerings[course.id].id}/roster", headers=headers or graph.S)
    assert r.status_code == 200, r.text
    body = r.json()
    return body if isinstance(body, list) else body.get("items", [])


# ════════════════════════════════════════════════════════════════════════════
# 1 · It is settable
# ════════════════════════════════════════════════════════════════════════════
class TestSettingIt:
    def test_the_default_is_registered(self, client, graph) -> None:
        """Every pre-D35 caller is unchanged: omitting it means an ordinary registration.
        D45 renamed the value `enrolled` -> `registered`; the behaviour is identical."""
        entry = next(
            e for e in _roster(client, graph, graph.shared)
            if e["student"]["id"] == str(graph.student.id)
        )
        assert entry["enrollment_status"] == "registered"

    @pytest.mark.parametrize(
        "status",
        [
            "pre_registered", "registered", "added", "dropped",
            "withdrawn", "completed", "failed", "audit",
        ],
    )
    def test_every_value_can_be_set(self, client, graph, status) -> None:
        resp = _set_status(client, graph, graph.shared, status)
        assert resp.status_code == 200, resp.text
        assert resp.json()["enrollment_status"] == status

    def test_it_shows_on_the_roster(self, client, graph) -> None:
        """The roster is where a Registrar sees and changes it, so it has to be there."""
        _set_status(client, graph, graph.shared, "audit")
        entry = next(
            e for e in _roster(client, graph, graph.shared)
            if e["student"]["id"] == str(graph.student.id)
        )
        assert entry["enrollment_status"] == "audit"

    def test_an_unknown_value_is_422(self, client, graph) -> None:
        assert _set_status(client, graph, graph.shared, "Withdrawn").status_code == 422

    def test_a_lecturer_cannot_set_it(self, client, graph) -> None:
        """Dean/Registrar only — it is a registry decision, not a grading one."""
        assert _set_status(client, graph, graph.shared, "audit", headers=graph.T).status_code == 403

    def test_the_dean_can(self, client, graph) -> None:
        assert _set_status(client, graph, graph.shared, "audit", headers=graph.P).status_code == 200

    def test_an_unknown_enrollment_is_404(self, client, graph) -> None:
        resp = client.patch(
            f"{O}/{graph.offerings[graph.shared.id].id}/enrollments/{uuid.uuid4()}",
            headers=graph.S,
            json={"enrollment_status": "audit"},
        )
        assert resp.status_code == 404, resp.text

    def test_the_change_is_audited_with_the_reason(self, client, graph, db_session) -> None:
        """`class_enrollments` has no column for the reason, so the audit row is the only
        place "why" is answerable — which is where every other guarded transition in this
        system keeps it."""
        from sqlalchemy import select

        from app.modules.settings.models import AuditLog

        _set_status(
            client, graph, graph.shared, "withdrawn",
            reason="Stopped attending after the second week.",
        )
        row = db_session.scalar(
            select(AuditLog).where(AuditLog.action == "offering.enrollment_status")
        )
        assert row is not None
        assert row.summary["before"] == "registered"
        assert row.summary["after"] == "withdrawn"
        assert "second week" in row.summary["reason"]


# ════════════════════════════════════════════════════════════════════════════
# 2 · A WITHDRAWAL IS NOT AN UN-ENROLMENT
# ════════════════════════════════════════════════════════════════════════════
class TestItIsNotAnUnenrolment:
    def test_a_withdrawn_student_stays_on_the_roster(self, client, graph) -> None:
        """The distinction the whole design turns on. `DELETE` says the registration was a
        mistake and takes them off; a withdrawal says they sat it and left, and the
        transcript has to print `W/F` against it. Dropping the row would erase exactly the
        fact being recorded."""
        _set_status(client, graph, graph.shared, "withdrawn")
        ids = [e["student"]["id"] for e in _roster(client, graph, graph.shared)]
        assert str(graph.student.id) in ids

    def test_the_row_is_not_closed(self, client, graph, db_session) -> None:
        _set_status(client, graph, graph.shared, "withdrawn")
        db_session.expire(graph.enrollment)
        assert graph.enrollment.unenrolled_at is None
        assert graph.enrollment.enrollment_status is EnrollmentStatus.WITHDRAWN

    def test_setting_it_on_an_UNENROLLED_row_is_409(self, client, graph) -> None:
        """Nothing to describe: they are not sitting the offering at all."""
        offering_id = graph.offerings[graph.shared.id].id
        enr_id = graph.enrollment.id
        assert client.delete(
            f"{O}/{offering_id}/enrollments/{enr_id}", headers=graph.S
        ).status_code == 204
        resp = client.patch(
            f"{O}/{offering_id}/enrollments/{enr_id}",
            headers=graph.S,
            json={"enrollment_status": "audit"},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="enrollment_closed")


# ════════════════════════════════════════════════════════════════════════════
# 3 · It changes the arithmetic — the defect that would have bitten
# ════════════════════════════════════════════════════════════════════════════
class TestAcademicHistory:
    def test_an_ordinary_enrolment_is_in_progress(self, client, graph) -> None:
        """The contrast case, so the assertions below mean something."""
        assert _row(_history(client, graph), graph.shared)["status"] == "in_progress"

    def test_an_audit_is_its_own_bucket(self, client, graph) -> None:
        _set_status(client, graph, graph.shared, "audit")
        assert _row(_history(client, graph), graph.shared)["status"] == "audited"

    # D45 §19 — one withdrawal where D35 had two. `dropped` joins it: both mean "left",
    # and the history bucket does not distinguish when they left.
    @pytest.mark.parametrize("status", ["withdrawn", "dropped"])
    def test_a_withdrawal_is_its_own_bucket(self, client, graph, status) -> None:
        _set_status(client, graph, graph.shared, status)
        assert _row(_history(client, graph), graph.shared)["status"] == "withdrawn"

    def test_an_audit_is_NOT_in_progress(self, client, graph) -> None:
        """THE defect. Before D35 an audited row was indistinguishable from one still being
        taken, so it filed as `in_progress` — forever, since no grade would ever arrive."""
        _set_status(client, graph, graph.shared, "audit")
        history = _history(client, graph)
        assert _row(history, graph.shared)["status"] != "in_progress"

    def test_an_audit_earns_no_credit(self, client, graph) -> None:
        """By definition: the student sat the course without reading it for credit."""
        before = _history(client, graph)["credits_earned"]
        graph.grade(graph.shared, "95")  # a pass, which WOULD have earned credit
        _set_status(client, graph, graph.shared, "audit")
        assert _history(client, graph)["credits_earned"] == before

    @pytest.mark.parametrize("status", ["audit", "withdrawn", "dropped"])
    def test_audit_and_withdrawals_leave_the_GPA_DENOMINATOR(self, client, graph, status) -> None:
        """Out of the GPA on BOTH sides of the fraction — asserted on the denominator,
        which is where it is unambiguous.

        `gpa_total_credits` is what the GPA is divided by. Leaving an audited course in it,
        with no quality points against it, depresses the GPA of a student who did nothing
        wrong — the same argument the `transferred` bucket makes. Grading one course and
        marking the other two isolates it: the denominator must be exactly the graded
        course's credits.

        Asserted this way rather than "the GPA is unchanged", which is FALSE and was the
        first cut of this test: removing dead weight from the denominator legitimately
        RAISES the GPA. `test_withdrawing_RAISES_a_dragged_down_GPA` states that directly.

        **`failed` is deliberately NOT in this list** — it keeps its credits. See the next
        test. Before D45 that role was played by `withdraw_failing`, which §19 removed.
        """
        graph.grade(graph.shared, "95")
        _set_status(client, graph, graph.only_a, status)
        _set_status(client, graph, graph.only_b, status)

        history = _history(client, graph)
        assert history["gpa_total_credits"] == graph.shared.credits, (
            "the audited / withdrew-passing courses are still in the GPA denominator"
        )
        # And with nothing else diluting it, the one graded course's own grade point stands.
        assert history["gpa"] is not None and history["gpa"] > 0

    def test_a_FAIL_keeps_its_credits(self, client, graph) -> None:
        """The rule BAJC gave on 2026-08-23 — *"w/f is a f because its like a student
        dropout while failing"* — survived D45 under a different name.

        §19 removed `withdraw_failing`, but it added `failed`, which is the same treatment
        said plainly: KEEPS its credits in the denominator and scores zero quality points,
        which is precisely what a fail does. The observable difference is the denominator:
        audit and withdrawals shrink it, a fail does not.
        """
        graph.grade(graph.shared, "95")
        _set_status(client, graph, graph.only_a, "failed")
        _set_status(client, graph, graph.only_b, "failed")

        history = _history(client, graph)
        expected = graph.shared.credits + graph.only_a.credits + graph.only_b.credits
        assert history["gpa_total_credits"] == expected, (
            "a fail must keep its credits in the GPA denominator"
        )
        # It still earns nothing, and it still drags: one A across three courses' worth of
        # credits cannot come out at the A's own grade point.
        assert history["credits_earned"] == graph.shared.credits
        assert history["gpa"] is not None and history["gpa"] < 4.0

    def test_a_FAIL_scores_ZERO_even_when_a_mark_exists(self, client, graph) -> None:
        """The status outranks the result here too.

        A student can be marked and THEN recorded as failing — a status set after grades
        went in is ordinary. The status is what counts, so a passing mark left in the
        gradebook must not rescue the GPA.
        """
        graph.grade(graph.only_a, "95")  # a strong pass, on the course about to be failed
        _set_status(client, graph, graph.only_a, "failed")
        # Everything else out of the way, so only_a decides the answer.
        _set_status(client, graph, graph.shared, "audit")
        _set_status(client, graph, graph.only_b, "audit")

        history = _history(client, graph)
        assert history["gpa_total_credits"] == graph.only_a.credits
        assert history["gpa"] == 0.0, "the stale passing mark leaked into the GPA"
        assert history["credits_earned"] == 0

    def test_a_withdrawal_and_a_FAIL_are_scored_DIFFERENTLY(self, client, graph) -> None:
        """The contrast, in one test.

        **This REPLACES `test_W_P_and_W_F_are_scored_DIFFERENTLY`**, which pinned the
        distinction between a withdrawal-passing and a withdrawal-failing. D45 §19 removed
        that pair, so the record can no longer tell them apart and no test can assert it.

        The contrast that survives is between LEAVING and FAILING, and it is still the
        thing most easily got wrong: both earn no credit, and only one of them costs the
        student GPA."""
        graph.grade(graph.shared, "95")

        _set_status(client, graph, graph.only_a, "withdrawn")
        withdrew = _history(client, graph)

        _set_status(client, graph, graph.only_a, "failed")
        failed = _history(client, graph)

        assert failed["gpa_total_credits"] > withdrew["gpa_total_credits"], (
            "a fail should keep its credits in the denominator and a withdrawal should not"
        )
        assert failed["gpa"] is not None and withdrew["gpa"] is not None
        assert failed["gpa"] < withdrew["gpa"], "a fail must cost the student GPA"

    def test_withdrawing_RAISES_a_dragged_down_GPA(self, client, graph) -> None:
        """The same fact stated the way it will actually be noticed.

        Three enrolled-but-ungraded courses put their credits in the denominator for zero
        quality points. Marking two of them withdrawn removes that dead weight, so the GPA
        of the one graded course comes through — which is the correct answer and was
        unreachable before D35.
        """
        graph.grade(graph.shared, "95")
        dragged = _history(client, graph)["gpa"]

        _set_status(client, graph, graph.only_a, "withdrawn")
        _set_status(client, graph, graph.only_b, "withdrawn")
        after = _history(client, graph)["gpa"]

        assert after is not None and dragged is not None
        assert after > dragged, f"{dragged} -> {after}"

    def test_re_enrolling_restores_the_ordinary_treatment(self, client, graph) -> None:
        """The status is not a one-way door — a withdrawal recorded by mistake is
        correctable, and the arithmetic must follow it back."""
        _set_status(client, graph, graph.shared, "withdrawn")
        assert _row(_history(client, graph), graph.shared)["status"] == "withdrawn"
        _set_status(client, graph, graph.shared, "registered")
        assert _row(_history(client, graph), graph.shared)["status"] == "in_progress"


# ════════════════════════════════════════════════════════════════════════════
# 4 · The transcript prints the notation
# ════════════════════════════════════════════════════════════════════════════
class TestTheTranscript:
    def _transcript_rows(self, client, graph) -> list[dict]:
        # The route is `?student_id=`, not a path segment (reports/router.py §D26).
        r = client.get(f"{R}/transcript?student_id={graph.student.id}", headers=graph.S)
        assert r.status_code == 200, r.text
        return [
            row
            for year in r.json()["years"]
            for sem in year["semesters"]
            for row in sem["subjects"]
        ]

    # D45 §19 — `W/P` and `W/F` collapsed into a single `W`. A transcript must not print
    # a distinction the record no longer keeps.
    @pytest.mark.parametrize(
        "status,notation", [("audit", "AU"), ("withdrawn", "W")]
    )
    def test_the_notation_is_printed(self, client, graph, status, notation) -> None:
        """An audit and a withdrawal produce NO grade, so before D35 the transcript's
        `if r.numeric is None: continue` filter dropped them silently. The notation IS the
        information — it is the reason the client wants the column."""
        graph.grade(graph.only_a, "88")  # so the term has a graded row too
        _set_status(client, graph, graph.shared, status)

        rows = self._transcript_rows(client, graph)
        row = next(
            (r for r in rows if r["subject"]["id"] == str(graph.shared.id)), None
        )
        assert row is not None, "the withdrawn/audited course vanished from the transcript"
        assert row["notation"] == notation
        assert row["numeric"] is None
        assert row["letter"] == ""

    def test_a_graded_row_carries_NO_notation(self, client, graph) -> None:
        graph.grade(graph.shared, "88")
        rows = self._transcript_rows(client, graph)
        row = next(r for r in rows if r["subject"]["id"] == str(graph.shared.id))
        assert row["notation"] is None
        assert row["numeric"] is not None

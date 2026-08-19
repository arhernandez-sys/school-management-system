"""Suite for GRADE REVISION / second opportunity (D30 §D7, brief §20).

The load-bearing behaviours pinned here:

  * **THE ORIGINAL SCORE IS NEVER OVERWRITTEN.** On approval the revised mark goes to
    `assessment_grades.makeup_score` and `score` keeps what the student first earned. Three
    places record the pair — the grade row, the request row and `audit_log` — and there is a
    test that reconciles all three.
  * **The Lecturer requests, the DEAN decides**, and neither can do the other's half. A Dean
    who could file one would leave the trail with no independent authority in it.
  * **An approved revision actually moves the grade**, through `calc`'s graded-row makeup
    arm. A workflow that recorded a decision and changed nothing would be theatre.
  * **Approval writes through a CLOSED grade-submission window** (client decision, Phase 5)
    — this is the post-deadline path Phase 3's dormant Dean bypass was pointing at.
  * **One pending request per grade**, enforced by `uq_grade_revision_open` over a generated
    `pending_flag`, with a test that goes round the API to prove the index is real.

Hermetic + rolled back via `db_session`. Reuses `test_grades.py::_Graph` rather than
rebuilding a year + offering + owning teacher: this suite is one workflow layered onto that
graph, and a second copy of the fixture would drift from the first.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.common.enums import Role
from app.modules.grades.models import AssessmentGrade, GradeRevisionRequest
from app.modules.settings.models import AuditLog
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

A = "/api/v1/assessments"
G = "/api/v1/grades"
R = "/api/v1/grade-revisions"
ANN = "/api/v1/announcements"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


@pytest.fixture
def marked(graph):
    """A student with a GRADED result of 60 out of 100, ready to be revised."""
    assessment = graph.assessment(max_score="100", weight="1", is_released=True)
    student, enrollment = graph.student()
    grade = graph.grade(assessment, student, enrollment, score="60")
    return assessment, student, grade


def _request(client, graph, assessment, student, *, headers=None, **overrides):
    body = {
        "student_id": str(student.id),
        "reason": "The essay section was added up wrong.",
        "proposed_score": 91,
    }
    body.update(overrides)
    return client.post(
        f"{A}/{assessment.id}/grade-revisions", headers=headers or graph.H, json=body
    )


# ════════════════════════════════════════════════════════════════════════════
class TestRequesting:
    def test_the_lecturer_files_a_request(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        r = _request(client, graph, assessment, student)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["original_score"] == 60.0
        assert body["proposed_score"] == 91.0
        assert body["reason"].startswith("The essay section")
        assert body["can_withdraw"] is True

    def test_the_row_carries_everything_a_notification_needs(
        self, client, graph, marked
    ) -> None:
        """§D8 lists student, course, assessment, lecturer, request date, reason and status
        as what the notification identifies. All of it comes back on the request itself, so
        the Dean's queue is workable without a fetch per row."""
        assessment, student, _grade = marked
        body = _request(client, graph, assessment, student).json()
        assert body["student"]["full_name"] == student.full_name
        assert body["student"]["student_number"] == student.student_number
        assert body["assessment_title"] == assessment.title
        assert body["max_score"] == 100.0
        assert body["subject_name"] == graph.subject.name
        assert body["section_name"] == graph.section.name
        assert body["requested_by_name"] == "Owner Teacher"
        assert body["created_at"] is not None

    def test_the_DEAN_may_not_file_one(self, client, graph, marked) -> None:
        """The Dean DECIDES revisions. Letting them file one too would put both halves of
        the workflow in one pair of hands and leave the audit trail with no independent
        authority in it (§D7)."""
        assessment, student, _grade = marked
        r = _request(client, graph, assessment, student, headers=graph.P)
        assert r.status_code == 403

    def test_the_registrar_may_not_file_one(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        assert _request(client, graph, assessment, student, headers=graph.S).status_code == 403

    def test_a_lecturer_who_does_not_own_the_offering_gets_404(
        self, client, graph, marked
    ) -> None:
        """404, not 403 — the same existence-leak discipline as the gradebook
        (api-spec §3.3)."""
        assessment, student, _grade = marked
        r = _request(client, graph, assessment, student, headers=graph.OTHER)
        assert r.status_code == 404

    def test_a_reason_is_required(self, client, graph, marked) -> None:
        """Brief §20 asks the Lecturer for a description, and a revision with no stated
        reason gives the Dean nothing to rule on."""
        assessment, student, _grade = marked
        assert _request(client, graph, assessment, student, reason="").status_code == 422

    def test_a_student_with_no_grade_cannot_be_revised(self, client, graph) -> None:
        """A revision revises something. If the result was never entered the Lecturer
        should enter it, not appeal it."""
        assessment = graph.assessment(max_score="100")
        student, _enr = graph.student()
        r = _request(client, graph, assessment, student)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="grade_not_entered")

    def test_an_absent_result_cannot_be_revised(self, client, graph) -> None:
        """An absent result ALREADY has a first-class second attempt through
        `makeup_score` + `allow_makeup`. Routing it through an approval workflow as well
        would give one situation two mechanisms that write the same column."""
        assessment = graph.assessment(max_score="100")
        student, enrollment = graph.student()
        graph.grade(assessment, student, enrollment, status="absent", score=None)
        r = _request(client, graph, assessment, student)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="grade_not_graded")

    def test_a_proposed_score_above_max_is_refused(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        r = _request(client, graph, assessment, student, proposed_score=140)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="score_exceeds_max")

    def test_a_negative_proposed_score_is_refused(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        assert _request(client, graph, assessment, student, proposed_score=-1).status_code == 422

    def test_a_revision_to_the_SAME_score_is_refused(self, client, graph, marked) -> None:
        """A no-op the Dean would have to rule on for nothing."""
        assessment, student, _grade = marked
        r = _request(client, graph, assessment, student, proposed_score=60)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="revision_no_change")

    def test_only_ONE_pending_request_per_grade(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        assert _request(client, graph, assessment, student).status_code == 201
        r = _request(client, graph, assessment, student, proposed_score=75)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="revision_already_pending")

    def test_the_database_enforces_one_pending_too(
        self, client, graph, marked, db_session
    ) -> None:
        """`uq_grade_revision_open (assessment_grade_id, pending_flag)` over the generated
        `pending_flag = IF(status='pending', 1, NULL)`.

        The service check exists to give a clean 409; this one proves the rule is true of
        the DATA even if a future writer bypasses the service. Asserted by going round the
        API entirely.
        """
        from sqlalchemy.exc import IntegrityError

        assessment, student, grade = marked
        _request(client, graph, assessment, student)
        db_session.expire_all()
        with pytest.raises(IntegrityError):
            db_session.add(
                GradeRevisionRequest(
                    assessment_grade_id=grade.id,
                    requested_by_user_id=graph.teacher_user.id,
                    reason="Second one.",
                    proposed_score=Decimal("70"),
                )
            )
            db_session.flush()
        db_session.rollback()

    def test_a_second_request_is_allowed_once_the_first_is_decided(
        self, client, graph, marked
    ) -> None:
        """Decided rows do not collide — NULLs coexist in a unique index — so a fresh
        request is the supported way to change course after a ruling."""
        assessment, student, _grade = marked
        first = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{first}/decision", headers=graph.P, json={"status": "denied"})
        assert _request(client, graph, assessment, student, proposed_score=75).status_code == 201


# ════════════════════════════════════════════════════════════════════════════
class TestTheDeanDecides:
    def _pending(self, client, graph, marked) -> str:
        assessment, student, _grade = marked
        return _request(client, graph, assessment, student).json()["id"]

    def test_the_lecturer_may_not_decide_their_own_request(
        self, client, graph, marked
    ) -> None:
        revision_id = self._pending(client, graph, marked)
        r = client.post(f"{R}/{revision_id}/decision", headers=graph.H, json={"status": "approved"})
        assert r.status_code == 403

    def test_the_registrar_may_not_decide(self, client, graph, marked) -> None:
        """§D14 gives the Registrar no grade authority."""
        revision_id = self._pending(client, graph, marked)
        r = client.post(f"{R}/{revision_id}/decision", headers=graph.S, json={"status": "approved"})
        assert r.status_code == 403

    def test_the_dean_approves(self, client, graph, marked) -> None:
        revision_id = self._pending(client, graph, marked)
        r = client.post(
            f"{R}/{revision_id}/decision",
            headers=graph.P,
            json={"status": "approved", "decision_note": "Re-added; the Lecturer is right."},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"
        assert body["decided_by_user_id"] == str(graph.principal_user.id)
        assert body["decided_at"] is not None
        assert "Re-added" in body["decision_note"]
        assert body["can_withdraw"] is False

    def test_the_dean_denies(self, client, graph, marked) -> None:
        revision_id = self._pending(client, graph, marked)
        r = client.post(
            f"{R}/{revision_id}/decision",
            headers=graph.P,
            json={"status": "denied", "decision_note": "Original marking stands."},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "denied"

    def test_deciding_twice_is_409(self, client, graph, marked) -> None:
        """Re-opening a ruling would leave no record of the reversal."""
        revision_id = self._pending(client, graph, marked)
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "denied"})
        r = client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="revision_decided")

    def test_pending_is_not_a_decision(self, client, graph, marked) -> None:
        revision_id = self._pending(client, graph, marked)
        r = client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "pending"})
        assert r.status_code == 422

    def test_an_unknown_revision_is_404(self, client, graph) -> None:
        r = client.post(f"{R}/{uuid.uuid4()}/decision", headers=graph.P, json={"status": "denied"})
        assert r.status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestTheOriginalIsNeverOverwritten:
    """**The rule the whole design turns on** (§D7)."""

    def test_approval_writes_the_makeup_and_LEAVES_score_alone(
        self, client, graph, marked, db_session
    ) -> None:
        assessment, student, grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})

        db_session.expire_all()
        row = db_session.get(AssessmentGrade, grade.id)
        assert float(row.score) == 60.0  # untouched
        assert float(row.makeup_score) == 91.0  # the revision
        assert row.status.value == "graded"

    def test_all_THREE_records_of_the_pair_reconcile(
        self, client, graph, marked, db_session
    ) -> None:
        """The grade row, the request row and `audit_log` each carry original-and-revised,
        so a reader can reconcile any two of them — and answer "what did this student
        originally get?" years later from the audit alone."""
        assessment, student, grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})

        db_session.expire_all()
        grade_row = db_session.get(AssessmentGrade, grade.id)
        request_row = db_session.get(GradeRevisionRequest, uuid.UUID(revision_id))
        audit = db_session.scalar(
            select(AuditLog).where(
                AuditLog.entity_id == uuid.UUID(revision_id),
                AuditLog.action == "grade_revision.approved",
            )
        )
        assert audit is not None
        assert float(request_row.original_score) == 60.0
        assert float(request_row.proposed_score) == 91.0
        assert audit.summary["original_score"] == 60.0
        assert audit.summary["revised_score"] == 91.0
        assert audit.summary["applied_to"] == "makeup_score"
        # And the grade row agrees with both.
        assert float(grade_row.score) == float(request_row.original_score)
        assert float(grade_row.makeup_score) == float(request_row.proposed_score)

    def test_a_DENIAL_touches_no_grade(self, client, graph, marked, db_session) -> None:
        assessment, student, grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "denied"})

        db_session.expire_all()
        row = db_session.get(AssessmentGrade, grade.id)
        assert float(row.score) == 60.0
        assert row.makeup_score is None

    def test_a_PENDING_request_touches_no_grade(
        self, client, graph, marked, db_session
    ) -> None:
        """Filing is not deciding. Until the Dean rules, the student's mark is what it was."""
        assessment, student, grade = marked
        _request(client, graph, assessment, student)
        db_session.expire_all()
        row = db_session.get(AssessmentGrade, grade.id)
        assert row.makeup_score is None

    def test_the_original_survives_a_SECOND_approved_revision(
        self, client, graph, marked, db_session
    ) -> None:
        """Two revisions in a row: `score` still holds the FIRST mark the student earned,
        and `makeup_score` holds the latest ruling. The intermediate value is not lost —
        it is on the first request row and in the audit trail."""
        assessment, student, grade = marked
        first = _request(client, graph, assessment, student, proposed_score=91).json()["id"]
        client.post(f"{R}/{first}/decision", headers=graph.P, json={"status": "approved"})
        second = _request(client, graph, assessment, student, proposed_score=78).json()["id"]
        client.post(f"{R}/{second}/decision", headers=graph.P, json={"status": "approved"})

        # `created_at` is a MariaDB DATETIME with precision 0, so both rows land in the same
        # SECOND and "which came first" is not answerable from the timestamp alone. Stamped
        # apart here so the assertion below is about the workflow rather than about row
        # order — the queue's own stability is covered in TestTheQueue.
        db_session.execute(
            text("UPDATE grade_revision_requests SET created_at = :t WHERE id = :i"),
            {"t": datetime(2026, 1, 1, 9, 0, 0), "i": first},
        )
        db_session.execute(
            text("UPDATE grade_revision_requests SET created_at = :t WHERE id = :i"),
            {"t": datetime(2026, 1, 1, 9, 5, 0), "i": second},
        )
        db_session.expire_all()
        row = db_session.get(AssessmentGrade, grade.id)
        assert float(row.score) == 60.0  # STILL the original
        assert float(row.makeup_score) == 78.0  # the latest ruling
        rows = db_session.scalars(
            select(GradeRevisionRequest)
            .where(GradeRevisionRequest.assessment_grade_id == grade.id)
            .order_by(GradeRevisionRequest.created_at)
        ).all()
        assert [float(r.proposed_score) for r in rows] == [91.0, 78.0]
        # The SECOND request snapshotted 60 too, because `score` never moved — which is
        # what makes "original" mean the same thing on every row.
        assert [float(r.original_score) for r in rows] == [60.0, 60.0]


# ════════════════════════════════════════════════════════════════════════════
class TestAnApprovedRevisionMovesTheGrade:
    """A workflow that recorded a decision and changed nothing would be theatre."""

    def test_the_term_grade_follows_the_approval(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        before = client.get(f"{G}/class-subject/{graph.cs.id}", headers=graph.H).json()
        row_before = next(r for r in before["rows"] if r["student"]["id"] == str(student.id))
        assert row_before["term_numeric"] == 60.0

        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})

        after = client.get(f"{G}/class-subject/{graph.cs.id}", headers=graph.H).json()
        row_after = next(r for r in after["rows"] if r["student"]["id"] == str(student.id))
        assert row_after["term_numeric"] == 91.0

    def test_a_denial_leaves_the_term_grade_alone(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "denied"})
        after = client.get(f"{G}/class-subject/{graph.cs.id}", headers=graph.H).json()
        row = next(r for r in after["rows"] if r["student"]["id"] == str(student.id))
        assert row["term_numeric"] == 60.0

    def test_a_revision_may_lower_a_grade(self, client, graph, marked) -> None:
        """Not only appeals upward — a transcription error corrected downward is the same
        workflow, and the engine must not quietly keep the higher of the two."""
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student, proposed_score=30).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})
        after = client.get(f"{G}/class-subject/{graph.cs.id}", headers=graph.H).json()
        row = next(r for r in after["rows"] if r["student"]["id"] == str(student.id))
        assert row["term_numeric"] == 30.0


# ════════════════════════════════════════════════════════════════════════════
class TestThePostDeadlinePath:
    """**Phase 3 left the Dean's direct-entry bypass dormant on the note that THIS
    workflow would be the real post-deadline path.** These tests are that promise kept."""

    def _close_the_window(self, db_session, graph) -> None:
        graph.sem.grade_submission_deadline = datetime.now(tz=timezone.utc) - timedelta(days=2)
        db_session.flush()

    def test_a_lecturer_may_still_REQUEST_after_the_deadline(
        self, client, graph, marked, db_session
    ) -> None:
        """Requesting writes no grade. Asking the Dean to look at something is exactly what
        should still be possible once the window has shut."""
        assessment, student, _grade = marked
        self._close_the_window(db_session, graph)
        # The direct write is refused...
        direct = client.put(
            f"{A}/{assessment.id}/grades",
            headers=graph.H,
            json={"entries": [{"student_id": str(student.id), "status": "graded", "score": 91}]},
        )
        assert direct.status_code == 409
        _assert_envelope(direct.json(), code="grade_window_closed")
        # ...and the request is not.
        assert _request(client, graph, assessment, student).status_code == 201

    def test_the_dean_approves_THROUGH_a_closed_window(
        self, client, graph, marked, db_session
    ) -> None:
        """The client decision, and the whole reason the deadline is usable: the cutoff
        stops Lecturers editing freely, and a revision is the sanctioned exception."""
        assessment, student, grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        self._close_the_window(db_session, graph)

        r = client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})
        assert r.status_code == 200, r.text

        db_session.expire_all()
        row = db_session.get(AssessmentGrade, grade.id)
        assert float(row.makeup_score) == 91.0
        assert float(row.score) == 60.0


# ════════════════════════════════════════════════════════════════════════════
class TestTheQueue:
    def test_pending_status_is_the_deans_work_list(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        body = client.get(f"{R}?status=pending", headers=graph.P).json()
        assert revision_id in {row["id"] for row in body["items"]}
        assert all(row["status"] == "pending" for row in body["items"])

    def test_pending_for_me_is_non_zero_only_for_the_DEAN(
        self, client, graph, marked
    ) -> None:
        """§D8 drives a notification badge off this, so it has to mean "this needs YOU".
        A Lecturer's own pending request is waiting on the Dean, not on them."""
        assessment, student, _grade = marked
        _request(client, graph, assessment, student)
        assert client.get(R, headers=graph.P).json()["pending_for_me"] >= 1
        assert client.get(R, headers=graph.H).json()["pending_for_me"] == 0

    def test_a_lecturer_sees_only_their_OWN_requests(self, client, graph, marked) -> None:
        """Another Lecturer's request concerns a student they may have no relationship
        with. Scoped in the QUERY, not filtered after it."""
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        mine = client.get(R, headers=graph.H).json()
        assert revision_id in {row["id"] for row in mine["items"]}
        theirs = client.get(R, headers=graph.OTHER).json()
        assert revision_id not in {row["id"] for row in theirs["items"]}

    def test_a_lecturer_still_sees_the_OUTCOME_of_their_request(
        self, client, graph, marked
    ) -> None:
        """The badge does not nag them, but they must be able to find out what happened."""
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})
        mine = client.get(R, headers=graph.H).json()
        row = next(r for r in mine["items"] if r["id"] == revision_id)
        assert row["status"] == "approved"
        assert row["decided_by_name"] != ""

    def test_the_registrar_sees_none(self, client, graph) -> None:
        assert client.get(R, headers=graph.S).status_code == 403

    def test_reading_another_lecturers_request_is_404(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        assert client.get(f"{R}/{revision_id}", headers=graph.OTHER).status_code == 404
        assert client.get(f"{R}/{revision_id}", headers=graph.H).status_code == 200
        assert client.get(f"{R}/{revision_id}", headers=graph.P).status_code == 200

    def test_filter_by_offering(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        body = client.get(f"{R}?class_subject_id={graph.cs.id}", headers=graph.P).json()
        assert revision_id in {row["id"] for row in body["items"]}
        other = client.get(f"{R}?class_subject_id={graph.other_cs.id}", headers=graph.P).json()
        assert revision_id not in {row["id"] for row in other["items"]}

    def _three_requests(self, client, graph) -> list[str]:
        ids = []
        for score in (91, 92, 93):
            assessment = graph.assessment(max_score="100")
            student, enrollment = graph.student()
            graph.grade(assessment, student, enrollment, score="60")
            ids.append(
                _request(client, graph, assessment, student, proposed_score=score).json()["id"]
            )
        return ids

    def test_oldest_first(self, client, graph, db_session) -> None:
        """A queue is worked in arrival order — the Dean should not have to scroll to find
        the request that has been waiting longest.

        The three are stamped a minute apart because `created_at` has WHOLE-SECOND
        precision: filed in a loop they all land in the same second, so without distinct
        timestamps this would be asserting the tiebreaker rather than the ordering.
        """
        ids = self._three_requests(client, graph)
        for offset, revision_id in enumerate(ids):
            db_session.execute(
                text("UPDATE grade_revision_requests SET created_at = :t WHERE id = :i"),
                {"t": datetime(2026, 1, 1, 9, offset, 0), "i": revision_id},
            )
        db_session.flush()
        body = client.get(f"{R}?status=pending", headers=graph.P).json()
        seen = [row["id"] for row in body["items"] if row["id"] in ids]
        assert seen == ids

    def test_the_order_is_STABLE_within_one_second(self, client, graph) -> None:
        """**The reason `id` is a tiebreaker on the ORDER BY.**

        `created_at` is a MariaDB `DATETIME` with precision 0, so three requests filed in
        the same second are indistinguishable by it and ordering on it alone lets rows
        shuffle between reads — which matters a great deal for a queue somebody pages
        through and decides from: the row they meant to click moves. The uuid is not
        chronological, so the order within a second is arbitrary; it just has to be the
        SAME arbitrary order every time.
        """
        ids = set(self._three_requests(client, graph))
        first = [
            row["id"]
            for row in client.get(f"{R}?status=pending", headers=graph.P).json()["items"]
            if row["id"] in ids
        ]
        second = [
            row["id"]
            for row in client.get(f"{R}?status=pending", headers=graph.P).json()["items"]
            if row["id"] in ids
        ]
        assert len(first) == 3
        assert first == second


# ════════════════════════════════════════════════════════════════════════════
class TestWithdrawal:
    def test_the_requester_withdraws_their_pending_request(
        self, client, graph, marked
    ) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        assert client.delete(f"{R}/{revision_id}", headers=graph.H).status_code == 204
        assert client.get(f"{R}/{revision_id}", headers=graph.P).status_code == 404

    def test_another_lecturer_cannot_withdraw_it(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        assert client.delete(f"{R}/{revision_id}", headers=graph.OTHER).status_code == 404

    def test_the_dean_cannot_withdraw_it_either(self, client, graph, marked) -> None:
        """Withdrawal is the REQUESTER's action. The Dean's tool is a denial, which leaves
        a ruling behind — deleting the request instead would erase the fact it was asked."""
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        assert client.delete(f"{R}/{revision_id}", headers=graph.P).status_code == 404

    def test_a_decided_request_cannot_be_withdrawn(self, client, graph, marked) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "denied"})
        r = client.delete(f"{R}/{revision_id}", headers=graph.H)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="revision_decided")

    def test_withdrawing_frees_the_grade_for_a_new_request(
        self, client, graph, marked
    ) -> None:
        assessment, student, _grade = marked
        revision_id = _request(client, graph, assessment, student).json()["id"]
        client.delete(f"{R}/{revision_id}", headers=graph.H)
        assert _request(client, graph, assessment, student, proposed_score=75).status_code == 201


# ════════════════════════════════════════════════════════════════════════════
class TestTheNotificationCount:
    """§D8 — extend the existing bell count; do NOT add a notifications table."""

    def test_the_deans_count_includes_pending_revisions(
        self, client, graph, marked
    ) -> None:
        before = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        _request(client, graph, marked[0], marked[1])
        after = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        assert after["pending_grade_revisions"] == before["pending_grade_revisions"] + 1
        assert after["unread_count"] == before["unread_count"] + 1

    def test_unread_count_is_the_SUM_of_its_components(self, client, graph, marked) -> None:
        """An existing client reading only `unread_count` keeps working and simply starts
        counting revisions too — which is what "extend, do not duplicate" means here."""
        _request(client, graph, marked[0], marked[1])
        body = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        assert body["unread_count"] == (
            body["unread_announcements"] + body["pending_grade_revisions"]
        )

    def test_a_lecturers_count_does_not_include_their_own_request(
        self, client, graph, marked
    ) -> None:
        _request(client, graph, marked[0], marked[1])
        body = client.get(f"{ANN}/unread-count", headers=graph.H).json()
        assert body["pending_grade_revisions"] == 0

    def test_a_decided_revision_leaves_the_count(self, client, graph, marked) -> None:
        revision_id = _request(client, graph, marked[0], marked[1]).json()["id"]
        with_pending = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        client.post(f"{R}/{revision_id}/decision", headers=graph.P, json={"status": "approved"})
        after = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        assert after["pending_grade_revisions"] == with_pending["pending_grade_revisions"] - 1

    def test_a_student_gets_no_revision_component(self, client, graph, marked) -> None:
        """Nothing about a revision is a student's to act on, and the endpoint must still
        answer for them rather than erroring."""
        _request(client, graph, marked[0], marked[1])
        student, _enr = graph.student(with_login=True)
        body = client.get(f"{ANN}/unread-count", headers=graph.student_headers(student)).json()
        assert body["pending_grade_revisions"] == 0

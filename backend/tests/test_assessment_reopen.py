"""D47 — reopening a closed marking window (`app/modules/assessments/reopen.py`).

The Lecturer asks, the Dean decides; approval sets `assessments.reopened_until` and the
ordinary grade write path opens again until then. Modelled on the grade revision suite
and built on the same graph (`test_grades.py::_Graph`).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select, text

from app.core.timeutil import ensure_aware, school_today, to_school_date
from app.modules.assessments.models import AssessmentReopenRequest
from app.modules.settings.models import AuditLog
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

A = "/api/v1/assessments"
RR = "/api/v1/assessment-reopen-requests"
G = "/api/v1/grades"
ANN = "/api/v1/announcements"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


def _days_ago(n: int) -> date:
    return school_today() - timedelta(days=n)


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


@pytest.fixture
def closed(graph):
    """An assessment whose window closed yesterday, with one student left blank."""
    a = graph.assessment(max_score="20", assessment_date=_days_ago(6))
    student, _enr = graph.student()
    return a, student


def _ask(client, graph, assessment, *, headers=None, reason="Forgot to enter the quiz."):
    return client.post(
        f"{A}/{assessment.id}/reopen-requests", headers=headers or graph.H, json={"reason": reason}
    )


def _decide(client, graph, request_id, **body):
    body.setdefault("status", "approved")
    return client.post(f"{RR}/{request_id}/decision", headers=graph.P, json=body)


def _save(client, graph, assessment, student, score=15):
    return client.put(
        f"{A}/{assessment.id}/grades",
        headers=graph.H,
        json={"entries": [{"student_id": str(student.id), "status": "graded", "score": score}]},
    )


# ════════════════════════════════════════════════════════════════════════════
class TestRequest:
    def test_the_owner_can_ask_once_the_window_is_closed(self, client, graph, closed) -> None:
        a, _s = closed
        r = _ask(client, graph, a)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["assessment_id"] == str(a.id)
        assert body["blank_count"] == 1
        assert body["can_withdraw"] is True
        assert body["offering"]["label"]

    def test_an_open_window_needs_no_request_409(self, client, graph) -> None:
        a = graph.assessment(assessment_date=_days_ago(1))
        r = _ask(client, graph, a)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="marking_open")

    def test_a_reason_is_required_422(self, client, graph, closed) -> None:
        a, _s = closed
        assert _ask(client, graph, a, reason="").status_code == 422

    def test_another_lecturer_gets_404(self, client, graph, closed) -> None:
        a, _s = closed
        assert _ask(client, graph, a, headers=graph.OTHER).status_code == 404

    def test_the_dean_cannot_file_one_403(self, client, graph, closed) -> None:
        """The Dean decides; filing too would put both halves in one pair of hands."""
        a, _s = closed
        assert _ask(client, graph, a, headers=graph.P).status_code == 403

    def test_one_pending_request_per_assessment_409(self, client, graph, closed) -> None:
        a, _s = closed
        assert _ask(client, graph, a).status_code == 201
        r = _ask(client, graph, a)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="reopen_already_pending")

    def test_the_unique_index_is_real(self, graph, closed, db_session) -> None:
        """Round the API: the database itself refuses a second pending row."""
        a, _s = closed
        for _ in range(2):
            db_session.add(AssessmentReopenRequest(
                assessment_id=a.id, requested_by_user_id=graph.teacher_user.id, reason="x",
            ))
        with pytest.raises(Exception):
            db_session.flush()
        db_session.rollback()

    def test_requesting_writes_an_audit_row(self, client, graph, closed, db_session) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        row = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "assessment_reopen.request",
                AuditLog.entity_id == rid,
            )
        )
        assert row is not None and row.summary["assessment_id"] == str(a.id)


# ════════════════════════════════════════════════════════════════════════════
class TestDecision:
    def test_approval_reopens_entry_for_the_granted_days(
        self, client, graph, closed, db_session
    ) -> None:
        a, s = closed
        assert _save(client, graph, a, s).status_code == 409
        rid = _ask(client, graph, a).json()["id"]

        r = _decide(client, graph, rid, granted_days=3, decision_note="OK, this once.")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved" and body["granted_days"] == 3
        db_session.refresh(a)
        assert to_school_date(ensure_aware(a.reopened_until)) == school_today() + timedelta(days=3)

        assert _save(client, graph, a, s).status_code == 200

    def test_granted_days_default_to_two(self, client, graph, closed, db_session) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        assert _decide(client, graph, rid).json()["granted_days"] == 2
        db_session.refresh(a)
        assert to_school_date(ensure_aware(a.reopened_until)) == school_today() + timedelta(days=2)

    def test_granted_days_are_bounded_422(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        assert _decide(client, graph, rid, granted_days=0).status_code == 422
        assert _decide(client, graph, rid, granted_days=15).status_code == 422

    def test_denial_keeps_it_locked(self, client, graph, closed, db_session) -> None:
        a, s = closed
        rid = _ask(client, graph, a).json()["id"]
        r = _decide(client, graph, rid, status="denied", decision_note="Too late.")
        assert r.status_code == 200 and r.json()["granted_days"] is None
        db_session.refresh(a)
        assert a.reopened_until is None
        assert _save(client, graph, a, s).status_code == 409

    def test_only_the_dean_decides(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        for headers in (graph.H, graph.S, graph.OTHER):
            r = client.post(f"{RR}/{rid}/decision", headers=headers, json={"status": "approved"})
            assert r.status_code == 403

    def test_a_decided_request_cannot_be_re_decided_409(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        _decide(client, graph, rid)
        r = _decide(client, graph, rid, status="denied")
        assert r.status_code == 409
        _assert_envelope(r.json(), code="reopen_decided")

    def test_a_second_reopen_after_the_first_lapses(self, client, graph, closed, db_session) -> None:
        """Once a reopen has run out the Lecturer may ask again, and the new approval
        gets its own days counted from today."""
        a, _s = closed
        _decide(client, graph, _ask(client, graph, a).json()["id"], granted_days=10)
        db_session.execute(
            text("UPDATE assessments SET reopened_until = NOW() - INTERVAL 1 DAY WHERE id = :i"),
            {"i": str(a.id)},
        )
        db_session.expire_all()
        rid = _ask(client, graph, a).json()["id"]
        assert _decide(client, graph, rid, granted_days=1).status_code == 200
        db_session.refresh(a)
        assert to_school_date(ensure_aware(a.reopened_until)) == school_today() + timedelta(days=1)

    def test_the_reopen_closes_again_and_blanks_return_to_zero(
        self, client, graph, closed, db_session
    ) -> None:
        a, s = closed
        _decide(client, graph, _ask(client, graph, a).json()["id"])
        row = next(c for c in client.get(f"{G}/offering/{graph.cs.id}", headers=graph.H)
                   .json()["rows"][0]["cells"] if c["assessment_id"] == str(a.id))
        assert row["auto_zero"] is False  # open again: blank does not count yet

        db_session.execute(
            text("UPDATE assessments SET reopened_until = NOW() - INTERVAL 1 DAY WHERE id = :i"),
            {"i": str(a.id)},
        )
        db_session.expire_all()
        row = next(c for c in client.get(f"{G}/offering/{graph.cs.id}", headers=graph.H)
                   .json()["rows"][0]["cells"] if c["assessment_id"] == str(a.id))
        assert row["auto_zero"] is True
        assert _save(client, graph, a, s).status_code == 409


# ════════════════════════════════════════════════════════════════════════════
class TestQueueAndWithdraw:
    def test_the_dean_sees_every_pending_request(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        body = client.get(f"{RR}?status=pending", headers=graph.P).json()
        assert rid in {r["id"] for r in body["items"]}
        assert body["pending_for_me"] >= 1

    def test_a_lecturer_sees_only_their_own(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        mine = client.get(RR, headers=graph.H).json()
        assert rid in {r["id"] for r in mine["items"]} and mine["pending_for_me"] == 0
        theirs = client.get(RR, headers=graph.OTHER).json()
        assert rid not in {r["id"] for r in theirs["items"]}

    def test_the_registrar_cannot_read_the_queue_403(self, client, graph) -> None:
        assert client.get(RR, headers=graph.S).status_code == 403

    def test_the_requester_withdraws_a_pending_request(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        assert client.delete(f"{RR}/{rid}", headers=graph.H).status_code == 204
        assert _ask(client, graph, a).status_code == 201  # free to ask again

    def test_a_decided_request_cannot_be_withdrawn_409(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        _decide(client, graph, rid, status="denied")
        r = client.delete(f"{RR}/{rid}", headers=graph.H)
        assert r.status_code == 409

    def test_someone_elses_request_is_404(self, client, graph, closed) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        assert client.delete(f"{RR}/{rid}", headers=graph.OTHER).status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestGradebookAndBell:
    def _column(self, client, graph, a, headers):
        return next(
            x for x in client.get(f"{G}/offering/{graph.cs.id}", headers=headers)
            .json()["assessments"] if x["id"] == str(a.id)
        )

    def test_the_gradebook_offers_the_request_to_the_owner_only(
        self, client, graph, closed
    ) -> None:
        a, _s = closed
        assert self._column(client, graph, a, graph.H)["can_request_reopen"] is True
        assert self._column(client, graph, a, graph.P)["can_request_reopen"] is False

    def test_a_pending_request_is_shown_instead_of_the_button(
        self, client, graph, closed
    ) -> None:
        a, _s = closed
        rid = _ask(client, graph, a).json()["id"]
        col = self._column(client, graph, a, graph.H)
        assert col["can_request_reopen"] is False
        assert col["pending_reopen_request_id"] == rid

    def test_the_bell_counts_it_for_the_dean_only(self, client, graph, closed) -> None:
        a, _s = closed
        before = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        _ask(client, graph, a)
        after = client.get(f"{ANN}/unread-count", headers=graph.P).json()
        assert after["pending_assessment_reopens"] == before["pending_assessment_reopens"] + 1
        assert after["unread_count"] == before["unread_count"] + 1
        lecturer = client.get(f"{ANN}/unread-count", headers=graph.H).json()
        assert lecturer["pending_assessment_reopens"] == 0



def test_blank_count_includes_absent_without_makeup(client, graph, db_session) -> None:
    """The count the Dean sees is exactly what will be zeroed: an absent row with no
    makeup is auto-zeroed, so it is blank; excused is not."""
    a = graph.assessment(max_score="20", assessment_date=_days_ago(6))
    s1, e1 = graph.student()
    s2, e2 = graph.student()
    graph.student()  # no row at all
    graph.grade(a, s1, e1, status="absent", score=None)
    graph.grade(a, s2, e2, status="excused", score=None)
    body = _ask(client, graph, a).json()
    assert body["blank_count"] == 2

"""D44 — the ten-state application lifecycle and the SSN duplicate guard.

Oracle: `docs/d44-sims10-and-meeting3.md`, `app/common/enums.ApplicationStatus`,
`app/modules/admissions/service.py`.

The client's `sims_10` dump widened `applications.status` from six values to ten and
renamed one. What is pinned here is the STATE MACHINE that vocabulary implies, because the
enum on its own says nothing about which moves are legal — and an admissions record whose
states can be reached in any order is not a record of anything.

  1. THE RENAME. `denied` became `rejected`, in the column and in the route. There is no
     alias for either: two spellings of one decision is how an audit trail ends up with
     both in it.

  2. THE REVERSIBLE STATE. `documents_pending` is the only move that can be undone, and
     `/review` is what undoes it. Everything else goes forward.

  3. ELIGIBLE IS NOT A DECISION. It records that the applicant qualifies; it deliberately
     leaves `decided_by_user_id` and `decided_at` NULL, because the college may have more
     qualified applicants than seats.

  4. DEFERRED IS TERMINAL. The applicant re-applies for the intake they were deferred to.
     This is the hinge the duplicate guard hangs on — see `TestDeferIsTerminal`.

  5. THE DUPLICATE GUARD blocks on an OPEN application, not on any application, which is
     what makes "check the SSN so they can re-register" one rule rather than two
     contradictory ones.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid

import pytest

from app.common.enums import (
    DECIDED_APPLICATION_STATUSES,
    OPEN_APPLICATION_STATUSES,
    ApplicationStatus,
    Role,
)
from app.modules.programs.models import Program
from app.modules.students.models import StudentProfile

pytestmark = pytest.mark.requires_db

A = "/api/v1/applications"


class _Graph:
    def __init__(self, db_session, make_user, auth_headers):
        self.tag = uuid.uuid4().hex[:8]
        self._db = db_session
        self.dean_user = make_user(role=Role.PRINCIPAL, full_name="The Dean")
        self.registrar_user = make_user(role=Role.SECRETARY, full_name="The Registrar")
        self.P = auth_headers(user_id=self.dean_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.registrar_user.id, role=Role.SECRETARY)

        self.program = Program(
            code=f"D4{self.tag[:4].upper()}",
            name=f"D44 Test Programme {self.tag}",
            award="Associate of Science",
            total_credits=60,
        )
        db_session.add(self.program)
        db_session.flush()

    def body(self, **overrides) -> dict:
        body = {
            "first_name": "Presley",
            "last_name": f"Rancharan{self.tag}",
            "date_of_birth": "2004-05-02",
            "email": f"presley.{self.tag}@example.bz",
            "program_id": str(self.program.id),
            "year_of_study": "First",
            "enrollment_load": "Full Time",
            "applicant_signed_at": "2026-08-01",
        }
        body.update(overrides)
        return body


@pytest.fixture
def graph(db_session, make_user, auth_headers) -> _Graph:
    return _Graph(db_session, make_user, auth_headers)


def _file(client, graph, **overrides) -> dict:
    """File a complete application and submit it, returning the created record."""
    resp = client.post(A, headers=graph.S, json=graph.body(submit=True, **overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _ssn() -> str:
    """A 9-char SSN unique to one test. The column is varchar(9) and unvalidated."""
    return uuid.uuid4().hex[:9]


# ════════════════════════════════════════════════════════════════════════════
class TestTheVocabularyItself:
    def test_the_ten_values_are_exactly_the_clients(self) -> None:
        assert [s.value for s in ApplicationStatus] == [
            "draft",
            "submitted",
            "under_review",
            "documents_pending",
            "eligible",
            "accepted",
            "rejected",
            "deferred",
            "withdrawn",
            "enrolled",
        ]

    def test_denied_is_gone_and_is_not_an_alias(self) -> None:
        """An alias would let the retired label keep being written."""
        assert not hasattr(ApplicationStatus, "DENIED")
        with pytest.raises(ValueError):
            ApplicationStatus("denied")

    def test_open_and_decided_partition_the_enum(self) -> None:
        """The two sets are derived from one another in `enums.py` precisely so a status
        cannot be added to the enum and fall outside both — which would silently exempt it
        from the duplicate guard."""
        assert OPEN_APPLICATION_STATUSES & DECIDED_APPLICATION_STATUSES == set()
        assert OPEN_APPLICATION_STATUSES | DECIDED_APPLICATION_STATUSES == set(
            ApplicationStatus
        )


# ════════════════════════════════════════════════════════════════════════════
class TestTheRename:
    def test_reject_records_the_decision(self, client, graph) -> None:
        app_id = _file(client, graph)["id"]
        r = client.post(
            f"{A}/{app_id}/reject", headers=graph.S, json={"reason": "Not enough CSECs."}
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "rejected"
        assert "Not enough CSECs." in body["comments"]
        assert body["decided_by_user_id"] == str(graph.registrar_user.id)
        assert body["decided_at"] is not None

    def test_the_old_deny_route_is_gone(self, client, graph) -> None:
        """Not kept as an alias — this API has one consumer, shipped from this repo."""
        app_id = _file(client, graph)["id"]
        assert client.post(f"{A}/{app_id}/deny", headers=graph.S, json={}).status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestDocumentsPendingIsReversible:
    def test_review_sends_it_back_and_forth(self, client, graph) -> None:
        """The round trip is the whole feature: before D44 an application waiting on the
        applicant was indistinguishable in the queue from one being read."""
        app_id = _file(client, graph)["id"]

        out = client.post(
            f"{A}/{app_id}/request-documents",
            headers=graph.S,
            json={"reason": "Transcript missing."},
        )
        assert out.status_code == 200, out.text
        assert out.json()["status"] == "documents_pending"
        assert "Transcript missing." in out.json()["comments"]
        # Not a decision — nobody has ruled on anything yet.
        assert out.json()["decided_at"] is None

        back = client.post(f"{A}/{app_id}/review", headers=graph.S)
        assert back.status_code == 200, back.text
        assert back.json()["status"] == "under_review"

    def test_it_is_still_editable_while_waiting(self, client, graph) -> None:
        """The point of sending it back is that something changes. An uneditable
        `documents_pending` would be a dead end."""
        app_id = _file(client, graph)["id"]
        client.post(f"{A}/{app_id}/request-documents", headers=graph.S, json={})
        r = client.patch(f"{A}/{app_id}", headers=graph.S, json={"phone": "600-1234"})
        assert r.status_code == 200, r.text
        assert r.json()["phone"] == "600-1234"

    def test_a_decision_cannot_be_taken_while_documents_are_outstanding(
        self, client, graph
    ) -> None:
        """`_DECIDABLE` excludes it deliberately: a decision taken here is taken on a file
        the college knows it has not finished reading."""
        app_id = _file(client, graph)["id"]
        client.post(f"{A}/{app_id}/request-documents", headers=graph.S, json={})
        r = client.post(f"{A}/{app_id}/reject", headers=graph.S, json={})
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "application_not_decidable"


# ════════════════════════════════════════════════════════════════════════════
class TestEligibleIsNotADecision:
    def test_it_leaves_the_decision_fields_empty(self, client, graph) -> None:
        app_id = _file(client, graph)["id"]
        r = client.post(f"{A}/{app_id}/eligible", headers=graph.S)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "eligible"
        assert body["decided_by_user_id"] is None
        assert body["decided_at"] is None

    def test_a_decision_may_still_be_taken_from_it(self, client, graph) -> None:
        """Refusing to decide from `eligible` would make marking someone eligible a step
        backwards, which is why `_DECIDABLE` includes it."""
        app_id = _file(client, graph)["id"]
        client.post(f"{A}/{app_id}/eligible", headers=graph.S)
        r = client.post(f"{A}/{app_id}/reject", headers=graph.S, json={})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"

    def test_eligibility_does_not_require_a_login_email(self, client, graph) -> None:
        """THE DISTINCTION, pinned. `acceptance_issues` demands an email so a login can be
        issued; `submission_issues` does not, because that is a provisioning prerequisite
        and not an academic finding.

        An applicant can plainly meet the requirements while the Registrar is still chasing
        them for an email. Gating eligibility on it would mean the college could not record
        that someone qualifies until it was ready to enrol them.

        Regression: the first implementation reused `acceptance_issues` and refused a
        complete, submitted application for want of an email. Only driving the API found it.
        """
        # `body()` supplies an email by default; this one deliberately has none.
        filed = client.post(
            A, headers=graph.S, json=graph.body(email=None, submit=True)
        )
        assert filed.status_code == 201, filed.text
        app_id = filed.json()["id"]

        eligible = client.post(f"{A}/{app_id}/eligible", headers=graph.S)
        assert eligible.status_code == 200, eligible.text
        assert eligible.json()["status"] == "eligible"

        # Accepting it, though, still needs one — the two checks stay different.
        accepted = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        assert accepted.status_code == 422, accepted.text

    def test_an_incomplete_application_cannot_be_marked_eligible(
        self, client, graph
    ) -> None:
        """Reuses `acceptance_issues`, so "eligible" cannot come to mean something weaker
        than "acceptable"."""
        draft = client.post(
            A, headers=graph.S, json={"first_name": "Ana", "last_name": f"L{graph.tag}"}
        ).json()
        r = client.post(f"{A}/{draft['id']}/eligible", headers=graph.S)
        assert r.status_code == 409  # still a draft, never submitted
        assert r.json()["error"]["code"] == "application_not_reviewable"


# ════════════════════════════════════════════════════════════════════════════
class TestDeferIsTerminal:
    def test_deferring_closes_the_application(self, client, graph) -> None:
        app_id = _file(client, graph)["id"]
        r = client.post(
            f"{A}/{app_id}/defer", headers=graph.S, json={"reason": "Next intake."}
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "deferred"
        assert r.json()["decided_at"] is not None

    def test_a_deferred_application_cannot_be_reopened(self, client, graph) -> None:
        """The alternative was considered and rejected: if `deferred` reopened it would be
        an OPEN status, and the duplicate guard would then block the very re-application
        the deferral was pointing the applicant towards."""
        app_id = _file(client, graph)["id"]
        client.post(f"{A}/{app_id}/defer", headers=graph.S, json={})
        assert client.post(f"{A}/{app_id}/review", headers=graph.S).status_code == 409

    def test_a_deferred_application_cannot_be_edited(self, client, graph) -> None:
        app_id = _file(client, graph)["id"]
        client.post(f"{A}/{app_id}/defer", headers=graph.S, json={})
        r = client.patch(f"{A}/{app_id}", headers=graph.S, json={"phone": "600-9999"})
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "application_decided"


# ════════════════════════════════════════════════════════════════════════════
class TestEnrolled:
    def test_only_an_accepted_application_can_be_marked_enrolled(
        self, client, graph
    ) -> None:
        app_id = _file(client, graph)["id"]
        r = client.post(f"{A}/{app_id}/enrolled", headers=graph.S)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "application_not_accepted"

    def test_accept_then_enrol(self, client, graph) -> None:
        app_id = _file(client, graph)["id"]
        accepted = client.post(
            f"{A}/{app_id}/accept",
            headers=graph.S,
            json={"login_email": f"newstudent.{graph.tag}@example.bz"},
        )
        assert accepted.status_code == 201, accepted.text

        r = client.post(f"{A}/{app_id}/enrolled", headers=graph.S)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "enrolled"
        # The student record is untouched: it has its own lifecycle vocabulary.
        assert r.json()["student_id"] is not None


# ════════════════════════════════════════════════════════════════════════════
class TestSsnDuplicateGuard:
    def test_a_second_application_on_an_open_one_is_refused(self, client, graph) -> None:
        ssno = _ssn()
        first = client.post(A, headers=graph.S, json=graph.body(ssno=ssno, submit=True))
        assert first.status_code == 201, first.text

        second = client.post(
            A, headers=graph.S, json=graph.body(ssno=ssno, first_name="Someone")
        )
        assert second.status_code == 409, second.text
        error = second.json()["error"]
        assert error["code"] == "duplicate_ssn"
        # The message names the open application, so the Registrar can go straight to it.
        assert first.json()["application_number"] in error["message"]

    @pytest.mark.parametrize("closer", ["reject", "defer", "withdraw"])
    def test_re_registration_is_allowed_once_the_first_is_closed(
        self, client, graph, closer
    ) -> None:
        """THE POINT OF THE RULE. "Check the SSN so they can re-register" is one sentence,
        and a blunt one-application-per-SSN guard would honour its first half by breaking
        its second."""
        ssno = _ssn()
        first_id = client.post(
            A, headers=graph.S, json=graph.body(ssno=ssno, submit=True)
        ).json()["id"]
        closed = client.post(f"{A}/{first_id}/{closer}", headers=graph.S, json={})
        assert closed.status_code == 200, closed.text

        again = client.post(A, headers=graph.S, json=graph.body(ssno=ssno))
        assert again.status_code == 201, again.text

    def test_a_blank_ssn_never_collides(self, client, graph) -> None:
        """The column is nullable and the college is explicitly not the authority on its
        format. Treating "" as a value would make every SSN-less draft a duplicate of
        every other one."""
        for _ in range(3):
            resp = client.post(A, headers=graph.S, json=graph.body(ssno=""))
            assert resp.status_code == 201, resp.text

    def test_an_existing_student_is_caught(self, client, graph, db_session) -> None:
        """The likeliest real duplicate is not two applications — it is somebody already
        studying here filling in the form again."""
        from datetime import date

        ssno = _ssn()
        db_session.add(
            StudentProfile(
                student_number=f"D44-{graph.tag}",
                first_name="Already",
                last_name="Enrolled",
                date_of_birth=date(2004, 1, 1),
                enrollment_date=date(2025, 9, 1),
                ssno=ssno,
            )
        )
        db_session.flush()

        resp = client.post(A, headers=graph.S, json=graph.body(ssno=ssno))
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"]["code"] == "duplicate_ssn_student"

    def test_the_check_is_case_insensitive(self, client, graph) -> None:
        """`utf8mb4_uca1400_ai_ci` is doing this, and for once that is the wanted
        behaviour — an SSN typed in a different case is the same SSN."""
        ssno = "ab123456c"
        client.post(A, headers=graph.S, json=graph.body(ssno=ssno, submit=True))
        resp = client.post(A, headers=graph.S, json=graph.body(ssno=ssno.upper()))
        assert resp.status_code == 409, resp.text

    def test_the_pending_form_is_guarded_at_the_FIRST_save(self, client, graph) -> None:
        """Not only at promotion. Telling the Registrar at the END of a seven-step wizard
        that the applicant already has an open file wastes the whole transcription."""
        ssno = _ssn()
        client.post(A, headers=graph.S, json=graph.body(ssno=ssno, submit=True))

        resp = client.post(
            "/api/v1/pending-applications",
            headers=graph.S,
            json={"first_name": "Ana", "last_name": f"L{graph.tag}", "ssno": ssno},
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"]["code"] == "duplicate_ssn"

"""Suite for CREDIT TRANSFER — the CTA rules (D30 §D11, brief §13).

Every clause of the policy is a test here, because the policy is the feature:

  * studied and passed at a recognised **TERTIARY** institution;
  * **≥75% content equivalency**;
  * applied for **at entrance / admission ONLY**;
  * requires a CTA, an original transcript and course outlines;
  * **assessed and decided by the DEAN**.

The 75% floor is enforced twice on purpose — as a 422 that names the rule, and by
`ck_cta_approval_requires_75` in the database. The API check exists so the Dean gets a
sentence instead of a driver error; the CHECK exists so the rule is true of the data even
if a future writer forgets. There is a test for each.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select, text

from app.common.enums import Role
from app.modules.admissions.models import CreditTransferRequest
from app.modules.offerings.models import Course
from app.modules.programs.models import Program
from app.modules.students.models import StudentProfile

pytestmark = pytest.mark.requires_db

A = "/api/v1/applications"
CT = "/api/v1/credit-transfers"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """A submitted application with a tertiary institution on Section B, its documents,
    and a BAJC course to transfer credit INTO."""

    def __init__(self, db_session, make_user, auth_headers, client):
        self.tag = uuid.uuid4().hex[:8]
        self._db = db_session
        self._client = client

        self.dean_user = make_user(role=Role.PRINCIPAL, full_name="The Dean")
        self.registrar_user = make_user(role=Role.SECRETARY, full_name="The Registrar")
        self.lecturer_user = make_user(role=Role.TEACHER, full_name="A Lecturer")
        self.P = auth_headers(user_id=self.dean_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.registrar_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.lecturer_user.id, role=Role.TEACHER)

        self.program = Program(
            code=f"CT{self.tag[:4].upper()}",
            name=f"Transfer Test Programme {self.tag}",
            total_credits=60,
        )
        # A course of its own, so the suite does not depend on the BAJC catalog seed.
        self.course = Course(
            name=f"Transfer Target {self.tag}", code=f"CTT{self.tag[:4].upper()}", credits=3
        )
        self.other_course = Course(
            name=f"Transfer Other {self.tag}", code=f"CTO{self.tag[:4].upper()}", credits=3
        )
        db_session.add_all([self.program, self.course, self.other_course])
        db_session.flush()

        self.application_id = client.post(
            A,
            headers=self.S,
            json={
                "first_name": "Presley",
                "last_name": f"Transfer{self.tag}",
                "date_of_birth": "2004-05-02",
                "email": f"transfer.{self.tag}@example.bz",
                "program_id": str(self.program.id),
                "year_of_study": "First",
                "enrollment_load": "Full Time",
                "applicant_signed_at": "2026-08-01",
                "submit": True,
            },
        ).json()["id"]

        self.docs = self.set_documents()

    def set_documents(self) -> dict[str, str]:
        body = self._client.put(
            f"{A}/{self.application_id}/documents",
            headers=self.S,
            json={
                "items": [
                    {"document_type": "cta", "received": True},
                    {"document_type": "transcript", "received": True},
                    {"document_type": "course_outline", "received": True},
                ]
            },
        ).json()
        return {d["document_type"]: d["id"] for d in body["documents"]}

    def add_tertiary_institution(self) -> None:
        self._client.put(
            f"{A}/{self.application_id}/education",
            headers=self.S,
            json={
                "items": [
                    {
                        "institution": "University of Belize",
                        "education_level": "Tertiary",
                        "graduated": False,
                    }
                ]
            },
        )

    def add_high_school_only(self) -> None:
        self._client.put(
            f"{A}/{self.application_id}/education",
            headers=self.S,
            json={
                "items": [
                    {
                        "institution": "Corozal Community College",
                        "education_level": "High School",
                        "graduated": True,
                        "graduation_date": "2022-06-28",
                    }
                ]
            },
        )

    def file_transfer(self, headers=None, **overrides):
        body = {
            "external_institution": "University of Belize",
            "external_course_name": "Principles of Management",
            "external_course_code": "MGMT101",
            "external_credits": 3,
            "external_grade": "B+",
            "target_course_id": str(self.course.id),
            "cta_document_id": self.docs["cta"],
            "transcript_document_id": self.docs["transcript"],
            "outline_document_id": self.docs["course_outline"],
        }
        body.update(overrides)
        return self._client.post(
            f"{A}/{self.application_id}/credit-transfers",
            headers=headers or self.S,
            json=body,
        )


@pytest.fixture
def graph(db_session, make_user, auth_headers, client) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, client)


# ════════════════════════════════════════════════════════════════════════════
class TestFiling:
    def test_the_registrar_files_a_request(self, client, graph) -> None:
        """The Registrar files what the applicant CLAIMS; the Dean assesses it."""
        r = graph.file_transfer()
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["target_course"]["code"] == graph.course.code
        assert body["meets_equivalency_floor"] is False  # nothing assessed yet

    def test_filing_does_not_require_an_equivalency_yet(self, client, graph) -> None:
        """The floor is checked on APPROVAL, not creation — a request may legitimately be
        filed before anyone has assessed the equivalency."""
        assert graph.file_transfer(content_equivalency_pct=None).status_code == 201

    def test_the_dean_may_also_file(self, client, graph) -> None:
        assert graph.file_transfer(headers=graph.P).status_code == 201

    def test_a_lecturer_may_not_file(self, client, graph) -> None:
        assert graph.file_transfer(headers=graph.T).status_code == 403

    def test_an_unknown_target_course_is_422(self, client, graph) -> None:
        r = graph.file_transfer(target_course_id=str(uuid.uuid4()))
        assert r.status_code == 422
        assert "target_course_id" in r.json()["error"]["fields"]

    def test_two_live_requests_for_one_course_are_refused(self, client, graph) -> None:
        """Otherwise one could be approved and the other left pending for ever, blocking
        acceptance with nothing on screen to explain why."""
        assert graph.file_transfer().status_code == 201
        r = graph.file_transfer()
        assert r.status_code == 409
        _assert_envelope(r.json(), code="duplicate_credit_transfer")

    def test_a_second_request_is_allowed_after_a_denial(self, client, graph) -> None:
        """A denied request is not a live claim — a re-application with better evidence
        must be possible."""
        graph.add_tertiary_institution()
        first = graph.file_transfer().json()["id"]
        client.post(f"{CT}/{first}/decision", headers=graph.P, json={"status": "denied"})
        assert graph.file_transfer().status_code == 201

    def test_documents_must_belong_to_THIS_application(self, client, graph, db_session) -> None:
        """The FK only says the row exists, not whose it is — without this check a transfer
        could cite another applicant's transcript."""
        other_app = client.post(
            A, headers=graph.S, json={"first_name": "Other", "last_name": f"App{graph.tag}"}
        ).json()["id"]
        stolen = client.put(
            f"{A}/{other_app}/documents",
            headers=graph.S,
            json={"items": [{"document_type": "transcript", "received": True}]},
        ).json()["documents"][0]["id"]

        r = graph.file_transfer(transcript_document_id=stolen)
        assert r.status_code == 422
        assert "documents" in r.json()["error"]["fields"]


# ════════════════════════════════════════════════════════════════════════════
class TestAdmissionOnly:
    def test_a_transfer_cannot_be_filed_after_acceptance(self, client, graph) -> None:
        """**THE POLICY'S TIMING CLAUSE** (brief §13): credit transfer is applied for at
        entrance only. Once accepted there is a student, and the moment has passed."""
        client.post(f"{A}/{graph.application_id}/accept", headers=graph.S, json={})
        r = graph.file_transfer()
        assert r.status_code == 409
        _assert_envelope(r.json(), code="application_decided")

    def test_a_transfer_cannot_be_filed_on_a_denied_application(self, client, graph) -> None:
        client.post(f"{A}/{graph.application_id}/reject", headers=graph.S, json={})
        assert graph.file_transfer().status_code == 409

    def test_a_pending_transfer_blocks_acceptance(self, client, graph) -> None:
        """The transfers decide which courses the student arrives already holding, so
        accepting first would enrol them against a plan the Dean has not finished ruling
        on — and afterwards it is too late to ask."""
        graph.file_transfer()
        detail = client.get(f"{A}/{graph.application_id}", headers=graph.S).json()
        assert any("awaiting the Dean" in issue for issue in detail["blocking_issues"])
        r = client.post(f"{A}/{graph.application_id}/accept", headers=graph.S, json={})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="application_incomplete")

    def test_a_decided_transfer_does_not_block_acceptance(self, client, graph) -> None:
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 80},
        )
        detail = client.get(f"{A}/{graph.application_id}", headers=graph.S).json()
        assert detail["blocking_issues"] == []
        assert client.post(f"{A}/{graph.application_id}/accept", headers=graph.S, json={}).status_code == 201


# ════════════════════════════════════════════════════════════════════════════
class TestTheDeanDecides:
    def test_the_registrar_may_not_decide(self, client, graph) -> None:
        """**Dean only** (brief §13, §D14). The Registrar files; the Dean assesses."""
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.S,
            json={"status": "approved", "content_equivalency_pct": 90},
        )
        assert r.status_code == 403

    def test_a_lecturer_may_not_decide(self, client, graph) -> None:
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision", headers=graph.T, json={"status": "denied"}
        )
        assert r.status_code == 403

    def test_the_dean_approves(self, client, graph) -> None:
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 82.5, "note": "Outline matches."},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"
        assert body["content_equivalency_pct"] == 82.5
        assert body["meets_equivalency_floor"] is True
        assert body["decided_by_user_id"] == str(graph.dean_user.id)
        assert body["decided_at"] is not None
        assert "Outline matches." in body["note"]

    def test_the_dean_denies_without_an_equivalency(self, client, graph) -> None:
        """A denial needs no percentage — the Dean can refuse on any ground."""
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "denied", "note": "Not a recognised institution."},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "denied"

    def test_deciding_twice_is_409(self, client, graph) -> None:
        transfer_id = graph.file_transfer().json()["id"]
        client.post(f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "denied"})
        r = client.post(
            f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "approved"}
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="credit_transfer_decided")

    def test_pending_is_not_a_decision(self, client, graph) -> None:
        """Re-opening a ruled request would leave no record of the reversal."""
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "pending"}
        )
        assert r.status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestTheSeventyFivePercentFloor:
    def test_approval_below_the_floor_is_422_naming_the_rule(self, client, graph) -> None:
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 74.99},
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="equivalency_below_floor")
        assert "75" in err["message"]
        assert "74.99" in " ".join(err["fields"]["content_equivalency_pct"])

    def test_exactly_75_is_approved(self, client, graph) -> None:
        """The floor is inclusive — "at least 75%" (brief §13), not "more than"."""
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 75},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"

    def test_approval_with_no_equivalency_assessed_is_422(self, client, graph) -> None:
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "approved"})
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="equivalency_below_floor")
        assert "Not assessed yet." in err["fields"]["content_equivalency_pct"]

    def test_a_denial_below_the_floor_is_allowed(self, client, graph) -> None:
        """The floor gates APPROVAL only. A 40% match is exactly what gets denied."""
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "denied", "content_equivalency_pct": 40},
        )
        assert r.status_code == 200
        assert r.json()["content_equivalency_pct"] == 40.0

    def test_the_database_refuses_a_low_approval_too(self, client, graph, db_session) -> None:
        """`ck_cta_approval_requires_75` is the BACKSTOP, and it has to be real.

        The API check gives the Dean a sentence instead of a driver error; this one makes
        the rule true of the data even if a future writer bypasses the service. Asserted by
        going round the API entirely.
        """
        from sqlalchemy.exc import IntegrityError, OperationalError

        transfer_id = graph.file_transfer().json()["id"]
        with pytest.raises((IntegrityError, OperationalError)):
            db_session.execute(
                text(
                    "UPDATE credit_transfer_requests "
                    "SET status='approved', content_equivalency_pct=50 WHERE id=:i"
                ),
                {"i": transfer_id},
            )
            db_session.flush()
        db_session.rollback()


# ════════════════════════════════════════════════════════════════════════════
class TestTertiaryInstitutionRule:
    def test_approval_needs_a_tertiary_institution_on_section_b(
        self, client, graph
    ) -> None:
        """Passing high-school study off as transfer credit is the exact thing the policy
        exists to prevent, and it is checkable from the form."""
        graph.add_high_school_only()
        transfer_id = graph.file_transfer().json()["id"]
        r = client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 90},
        )
        assert r.status_code == 422
        _assert_envelope(r.json(), code="no_tertiary_institution")

    def test_adding_the_tertiary_row_then_lets_it_through(self, client, graph) -> None:
        graph.add_high_school_only()
        transfer_id = graph.file_transfer().json()["id"]
        assert (
            client.post(
                f"{CT}/{transfer_id}/decision",
                headers=graph.P,
                json={"status": "approved", "content_equivalency_pct": 90},
            ).status_code
            == 422
        )
        graph.add_tertiary_institution()
        assert (
            client.post(
                f"{CT}/{transfer_id}/decision",
                headers=graph.P,
                json={"status": "approved", "content_equivalency_pct": 90},
            ).status_code
            == 200
        )

    def test_a_denial_needs_no_tertiary_institution(self, client, graph) -> None:
        graph.add_high_school_only()
        transfer_id = graph.file_transfer().json()["id"]
        assert (
            client.post(
                f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "denied"}
            ).status_code
            == 200
        )


# ════════════════════════════════════════════════════════════════════════════
class TestEditAndRemove:
    def test_a_pending_request_is_editable(self, client, graph) -> None:
        transfer_id = graph.file_transfer().json()["id"]
        r = client.patch(
            f"{CT}/{transfer_id}",
            headers=graph.S,
            json={"target_course_id": str(graph.other_course.id), "external_credits": 4},
        )
        assert r.status_code == 200, r.text
        assert r.json()["target_course"]["code"] == graph.other_course.code
        assert r.json()["external_credits"] == 4

    def test_a_decided_request_is_not_editable(self, client, graph) -> None:
        """Changing the course under a ruling would make the Dean's decision describe
        something else."""
        transfer_id = graph.file_transfer().json()["id"]
        client.post(f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "denied"})
        r = client.patch(
            f"{CT}/{transfer_id}", headers=graph.S, json={"external_credits": 9}
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="credit_transfer_decided")

    def test_a_pending_request_may_be_removed(self, client, graph) -> None:
        transfer_id = graph.file_transfer().json()["id"]
        assert client.delete(f"{CT}/{transfer_id}", headers=graph.S).status_code == 204

    def test_a_decided_request_is_kept(self, client, graph) -> None:
        """It records what the Dean decided."""
        transfer_id = graph.file_transfer().json()["id"]
        client.post(f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "denied"})
        r = client.delete(f"{CT}/{transfer_id}", headers=graph.S)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="credit_transfer_decided")

    def test_a_cited_document_cannot_be_dropped_from_the_checklist(
        self, client, graph
    ) -> None:
        """The three transfer document FKs are `ON DELETE SET NULL`, so a blanket
        delete-and-reinsert of Section F would silently strip a pending transfer of its
        papers. 409 says so instead."""
        graph.file_transfer()
        r = client.put(
            f"{A}/{graph.application_id}/documents",
            headers=graph.S,
            json={"items": [{"document_type": "passport_photo", "received": True}]},
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="document_in_use")


# ════════════════════════════════════════════════════════════════════════════
class TestTheQueue:
    def test_pending_status_is_the_deans_work_list(self, client, graph) -> None:
        """A queue is a filtered read, not a new table — the same reasoning §D8 applies to
        grade revisions."""
        transfer_id = graph.file_transfer().json()["id"]
        body = client.get(f"{CT}?status=pending", headers=graph.P).json()
        assert transfer_id in {row["id"] for row in body}
        assert all(row["status"] == "pending" for row in body)

    def test_the_list_row_counts_pending_transfers(self, client, graph) -> None:
        """On the row the Dean is looking at, so the admissions list shows where the work
        is without opening each application."""
        graph.file_transfer()
        body = client.get(
            f"{A}?search=Transfer{graph.tag}", headers=graph.P
        ).json()
        row = next(r for r in body["items"] if r["id"] == graph.application_id)
        assert row["pending_credit_transfers"] == 1

    def test_a_decided_transfer_leaves_the_pending_queue(self, client, graph) -> None:
        transfer_id = graph.file_transfer().json()["id"]
        client.post(f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "denied"})
        body = client.get(f"{CT}?status=pending", headers=graph.P).json()
        assert transfer_id not in {row["id"] for row in body}


# ════════════════════════════════════════════════════════════════════════════
class TestApprovedTransfersReachTheStudent:
    def test_acceptance_reports_the_transferred_courses(self, client, graph) -> None:
        """The one part of acceptance that changes what the student still has to study, so
        it is reported rather than left invisible."""
        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 90},
        )
        body = client.post(f"{A}/{graph.application_id}/accept", headers=graph.S, json={}).json()
        assert body["transferred_course_codes"] == [graph.course.code]

    def test_a_denied_transfer_is_not_reported_as_transferred(self, client, graph) -> None:
        transfer_id = graph.file_transfer().json()["id"]
        client.post(f"{CT}/{transfer_id}/decision", headers=graph.P, json={"status": "denied"})
        body = client.post(f"{A}/{graph.application_id}/accept", headers=graph.S, json={}).json()
        assert body["transferred_course_codes"] == []

    def test_the_prerequisite_gate_sees_an_approved_transfer(
        self, client, graph, db_session
    ) -> None:
        """The 2C arm that returned nothing for the whole school now returns real rows.

        It reaches student → `student_profiles.application_id` → application → transfers,
        because policy anchors a transfer on the APPLICATION (brief §13, §D4).
        """
        from app.modules.prerequisites.service import _approved_transfer_course_ids

        graph.add_tertiary_institution()
        transfer_id = graph.file_transfer().json()["id"]
        client.post(
            f"{CT}/{transfer_id}/decision",
            headers=graph.P,
            json={"status": "approved", "content_equivalency_pct": 90},
        )
        body = client.post(f"{A}/{graph.application_id}/accept", headers=graph.S, json={}).json()

        db_session.expire_all()
        granted = _approved_transfer_course_ids(
            db_session, student_id=uuid.UUID(body["student_id"])
        )
        assert granted == {graph.course.id}

    def test_a_pending_transfer_grants_nothing(self, client, graph, db_session) -> None:
        """Asserted at the service level, since a pending transfer blocks acceptance and so
        no student exists to ask through the API."""
        from app.modules.prerequisites.service import _approved_transfer_course_ids

        graph.file_transfer()
        student = StudentProfile(
            student_number=f"CT-{graph.tag}",
            first_name="Pending",
            last_name=f"Case{graph.tag}",
            date_of_birth=date(2004, 1, 1),
            enrollment_date=date(2026, 8, 1),
            status="Active",
            application_id=uuid.UUID(graph.application_id),
        )
        db_session.add(student)
        db_session.flush()
        assert _approved_transfer_course_ids(db_session, student_id=student.id) == set()

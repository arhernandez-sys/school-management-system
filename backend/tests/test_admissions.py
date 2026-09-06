"""Suite for ADMISSIONS — the application lifecycle and the acceptance flow (D30 §D11).

The load-bearing behaviours pinned here:

  * **A draft is filable from the applicant's names alone**, which is what makes the
    Sections A–G wizard interruption-safe. Everything else may arrive later.
  * **Completeness is asserted at the TRANSITIONS**, not by the columns, and a refusal
    lists EVERY missing thing at once rather than one per attempt.
  * **The under-18 guardian-signature rule** (Section G) — enforced against the
    applicant's age at signing, which no column constraint can express.
  * **Acceptance is one transaction** creating the student, the login and the
    `YYYYMM###` (decision #5), opening the programme history, and linking both FK
    directions.
  * **A PATCH applies only the keys PRESENT**, so the wizard's per-section saves cannot
    blank the sections it is not on.
  * A decided application is a RECORD: not editable, not deletable, not re-acceptable.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import re

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.common.enums import Role
from app.core.timeutil import school_today
from app.modules.admissions.models import Application
from app.modules.programs.models import Program
from app.modules.students.models import StudentProfile, StudentProgramHistory
from app.modules.users.models import User

pytestmark = pytest.mark.requires_db

A = "/api/v1/applications"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """A Dean, a Registrar, a Lecturer, a student login, and a programme to apply for."""

    def __init__(self, db_session, make_user, auth_headers):
        self.tag = uuid.uuid4().hex[:8]
        self._db = db_session

        self.dean_user = make_user(role=Role.PRINCIPAL, full_name="The Dean")
        self.registrar_user = make_user(role=Role.SECRETARY, full_name="The Registrar")
        self.lecturer_user = make_user(role=Role.TEACHER, full_name="A Lecturer")
        self.student_user = make_user(role=Role.STUDENT, full_name="A Student")

        self.P = auth_headers(user_id=self.dean_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.registrar_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.lecturer_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student_user.id, role=Role.STUDENT)

        # A programme of its own, so the assertions do not depend on the BAJC seed being
        # loaded — the suite has to pass on a freshly provisioned database too.
        self.program = Program(
            code=f"AD{self.tag[:4].upper()}",
            name=f"Admissions Test Programme {self.tag}",
            award="Associate of Science",
            total_credits=60,
        )
        db_session.add(self.program)
        db_session.flush()

    def complete_body(self, **overrides) -> dict:
        """A body that passes every submission rule. An adult, so Section G needs one
        signature; the under-18 case is tested explicitly."""
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


def _file(client, graph, headers=None, **overrides):
    return client.post(A, headers=headers or graph.S, json=graph.complete_body(**overrides))


def _file_draft(client, graph, **overrides):
    """The wizard's step A: names only."""
    body = {"first_name": "Ana", "last_name": f"Lopez{graph.tag}"}
    body.update(overrides)
    return client.post(A, headers=graph.S, json=body)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_lecturer_cannot_list(self, client, graph) -> None:
        """An application is another person's PII and a Lecturer has no reason to read it."""
        assert client.get(A, headers=graph.T).status_code == 403

    def test_student_cannot_list(self, client, graph) -> None:
        assert client.get(A, headers=graph.U).status_code == 403

    def test_registrar_may_list(self, client, graph) -> None:
        assert client.get(A, headers=graph.S).status_code == 200

    def test_dean_may_list(self, client, graph) -> None:
        assert client.get(A, headers=graph.P).status_code == 200

    def test_lecturer_cannot_file(self, client, graph) -> None:
        assert _file(client, graph, headers=graph.T).status_code == 403

    def test_unauthenticated_is_401(self, client) -> None:
        assert client.get(A).status_code == 401


# ════════════════════════════════════════════════════════════════════════════
class TestFileDraft:
    def test_names_alone_are_enough_to_file(self, client, graph) -> None:
        """THE WIZARD'S PREMISE. Step A must be able to create the record, or a closed tab
        halfway through transcribing a paper form loses everything."""
        r = _file_draft(client, graph)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "draft"
        assert body["full_name"].startswith("Ana Lopez")

    def test_a_draft_reports_what_it_still_needs(self, client, graph) -> None:
        """`blocking_issues` on the READ, so the review screen can explain a disabled
        Accept button instead of the Registrar discovering the reason by pressing it."""
        body = _file_draft(client, graph).json()
        issues = " ".join(body["blocking_issues"])
        assert "Date of birth" in issues
        assert "programme of study" in issues
        assert "submitted before it can be accepted" in issues

    def test_a_missing_last_name_is_422(self, client, graph) -> None:
        r = client.post(A, headers=graph.S, json={"first_name": "Ana"})
        assert r.status_code == 422

    def test_an_unknown_field_is_rejected_not_dropped(self, client, graph) -> None:
        """`extra="forbid"` (api-spec §1.4) — a typo'd field must fail loudly, or a
        wizard step silently saves nothing."""
        r = client.post(
            A, headers=graph.S, json={"first_name": "A", "last_name": "B", "lastname": "C"}
        )
        assert r.status_code == 422

    def test_an_unknown_programme_is_422_not_500(self, client, graph) -> None:
        r = client.post(
            A,
            headers=graph.S,
            json={"first_name": "A", "last_name": "B", "program_id": str(uuid.uuid4())},
        )
        assert r.status_code == 422
        assert "program_id" in r.json()["error"].get("fields", {})

    def test_submit_true_files_and_submits_in_one_call(self, client, graph) -> None:
        """For a complete form typed in one sitting — the wizard is not the only path."""
        r = _file(client, graph, submit=True)
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "submitted"

    def test_submit_true_on_an_incomplete_form_is_422(self, client, graph) -> None:
        r = client.post(A, headers=graph.S, json={"first_name": "A", "last_name": "B", "submit": True})
        assert r.status_code == 422
        _assert_envelope(r.json(), code="application_incomplete")


# ════════════════════════════════════════════════════════════════════════════
class TestPatchIsPerSection:
    def test_a_patch_applies_only_the_keys_present(self, client, graph) -> None:
        """THE WIZARD'S OTHER PREMISE, and the regression that matters most here.

        Step E sends a programme; it must not blank the name and date of birth step A
        saved. A naive `for field in ALL: setattr(row, field, payload.field)` would wipe
        every section the current step does not carry.
        """
        app_id = _file(client, graph).json()["id"]
        r = client.patch(
            f"{A}/{app_id}",
            headers=graph.S,
            json={"program_id": str(graph.program.id), "year_of_study": "Second"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["year_of_study"] == "Second"
        # Untouched by this PATCH:
        assert body["first_name"] == "Presley"
        assert body["date_of_birth"] == "2004-05-02"
        assert body["email"] is not None

    def test_an_explicit_null_clears_a_field(self, client, graph) -> None:
        """`null` still has to mean "clear" — the Registrar mis-typed something."""
        app_id = _file(client, graph, religion="Adventist").json()["id"]
        body = client.patch(f"{A}/{app_id}", headers=graph.S, json={"religion": None}).json()
        assert body["religion"] is None

    def test_the_names_cannot_be_cleared(self, client, graph) -> None:
        """An application with no name on it is not an application."""
        app_id = _file(client, graph).json()["id"]
        r = client.patch(f"{A}/{app_id}", headers=graph.S, json={"last_name": None})
        assert r.status_code == 422

    def test_a_decided_application_cannot_be_edited(self, client, graph) -> None:
        app_id = _file(client, graph, submit=True).json()["id"]
        client.post(f"{A}/{app_id}/reject", headers=graph.S, json={})
        r = client.patch(f"{A}/{app_id}", headers=graph.S, json={"religion": "X"})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="application_decided")


# ════════════════════════════════════════════════════════════════════════════
class TestSubmissionRules:
    def test_submit_lists_every_missing_thing_at_once(self, client, graph) -> None:
        """Not one per attempt: the Registrar should not have to submit six times to
        discover six omissions."""
        app_id = _file_draft(client, graph).json()["id"]
        r = client.post(f"{A}/{app_id}/submit", headers=graph.S)
        assert r.status_code == 422
        issues = _assert_envelope(r.json(), code="application_incomplete")["fields"]["application"]
        assert len(issues) >= 4

    def test_a_complete_form_submits(self, client, graph) -> None:
        app_id = _file(client, graph).json()["id"]
        r = client.post(f"{A}/{app_id}/submit", headers=graph.S)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "submitted"
        assert r.json()["blocking_issues"] == []

    def test_submitting_twice_is_409(self, client, graph) -> None:
        app_id = _file(client, graph, submit=True).json()["id"]
        r = client.post(f"{A}/{app_id}/submit", headers=graph.S)
        assert r.status_code == 409

    def test_a_future_date_of_birth_is_refused(self, client, graph) -> None:
        future = (school_today() + timedelta(days=1)).isoformat()
        app_id = _file(client, graph, date_of_birth=future).json()["id"]
        r = client.post(f"{A}/{app_id}/submit", headers=graph.S)
        assert r.status_code == 422
        assert any(
            "future" in issue
            for issue in r.json()["error"]["fields"]["application"]
        )

    def test_an_under_18_applicant_needs_a_guardian_signature(self, client, graph) -> None:
        """Section G's conditional rule, and the reason it lives in the service.

        "A guardian must sign IF the applicant is under 18" is a statement about their AGE
        AT SIGNING. No column constraint can express it, and the form makes it conditional
        rather than always-required.
        """
        signed = date(2026, 8, 1)
        seventeen = date(signed.year - 17, signed.month, signed.day) + timedelta(days=1)
        app_id = _file(
            client,
            graph,
            date_of_birth=seventeen.isoformat(),
            applicant_signed_at=signed.isoformat(),
        ).json()["id"]

        r = client.post(f"{A}/{app_id}/submit", headers=graph.S)
        assert r.status_code == 422
        assert any(
            "under 18" in issue for issue in r.json()["error"]["fields"]["application"]
        )

        client.patch(
            f"{A}/{app_id}", headers=graph.S, json={"guardian_signed_at": signed.isoformat()}
        )
        assert client.post(f"{A}/{app_id}/submit", headers=graph.S).status_code == 200

    def test_an_adult_needs_no_guardian_signature(self, client, graph) -> None:
        """The other side of the same rule — it must not demand one from everybody."""
        app_id = _file(client, graph).json()["id"]
        assert client.post(f"{A}/{app_id}/submit", headers=graph.S).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestSectionB:
    def test_the_repeating_table_holds_MORE_THAN_ONE_institution(
        self, client, graph
    ) -> None:
        """The defect this table exists to fix (plan §B4).

        `sims_bk.sql` had a single-valued `student_profiles.educationbg_id` pointing at an
        `educational_background` table with NO student reference at all — an applicant who
        attended two institutions could not be recorded either way round.
        """
        app_id = _file(client, graph).json()["id"]
        r = client.put(
            f"{A}/{app_id}/education",
            headers=graph.S,
            json={
                "items": [
                    {
                        "institution": "Corozal Community College",
                        "education_level": "High School",
                        "graduated": True,
                        "graduation_date": "2022-06-28",
                    },
                    {
                        "institution": "University of Belize",
                        "education_level": "Tertiary",
                        "graduated": False,
                    },
                ]
            },
        )
        assert r.status_code == 200, r.text
        rows = r.json()["education"]
        assert len(rows) == 2
        assert {row["education_level"] for row in rows} == {"High School", "Tertiary"}

    def test_sort_order_is_renumbered_server_side(self, client, graph) -> None:
        """So the client never has to keep it consistent while inserting and removing rows."""
        app_id = _file(client, graph).json()["id"]
        r = client.put(
            f"{A}/{app_id}/education",
            headers=graph.S,
            json={
                "items": [
                    {"institution": "Second", "sort_order": 77},
                    {"institution": "Third", "sort_order": 3},
                ]
            },
        )
        assert [row["sort_order"] for row in r.json()["education"]] == [1, 2]
        assert [row["institution"] for row in r.json()["education"]] == ["Second", "Third"]

    def test_replace_is_a_whole_set_replace(self, client, graph) -> None:
        app_id = _file(client, graph).json()["id"]
        client.put(
            f"{A}/{app_id}/education", headers=graph.S, json={"items": [{"institution": "One"}]}
        )
        r = client.put(
            f"{A}/{app_id}/education", headers=graph.S, json={"items": [{"institution": "Two"}]}
        )
        assert [row["institution"] for row in r.json()["education"]] == ["Two"]

    def test_graduated_without_a_date_is_422(self, client, graph) -> None:
        app_id = _file(client, graph).json()["id"]
        r = client.put(
            f"{A}/{app_id}/education",
            headers=graph.S,
            json={"items": [{"institution": "X", "graduated": True}]},
        )
        assert r.status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestSectionF:
    def test_the_checklist_round_trips(self, client, graph) -> None:
        app_id = _file(client, graph).json()["id"]
        r = client.put(
            f"{A}/{app_id}/documents",
            headers=graph.S,
            json={
                "items": [
                    {"document_type": "passport_photo", "received": True},
                    {"document_type": "hs_diploma", "received": False},
                ]
            },
        )
        assert r.status_code == 200, r.text
        got = {d["document_type"]: d["received"] for d in r.json()["documents"]}
        assert got == {"passport_photo": True, "hs_diploma": False}

    def test_rows_are_reconciled_by_id_not_recreated(self, client, graph) -> None:
        """Ids must survive an edit, or a credit transfer citing one loses its paper.

        This is what lets `replace_documents` update in place: a blanket
        delete-and-reinsert would `SET NULL` the three transfer document FKs silently.
        """
        app_id = _file(client, graph).json()["id"]
        first = client.put(
            f"{A}/{app_id}/documents",
            headers=graph.S,
            json={"items": [{"document_type": "transcript", "received": False}]},
        ).json()["documents"][0]

        second = client.put(
            f"{A}/{app_id}/documents",
            headers=graph.S,
            json={
                "items": [
                    {"id": first["id"], "document_type": "transcript", "received": True}
                ]
            },
        ).json()["documents"][0]
        assert second["id"] == first["id"]
        assert second["received"] is True


# ════════════════════════════════════════════════════════════════════════════
class TestAcceptance:
    def _submitted(self, client, graph) -> str:
        return _file(client, graph, submit=True).json()["id"]

    def test_accept_creates_student_login_and_number(self, client, graph, db_session) -> None:
        """Decision #5 — the SINGLE action that admits a student."""
        app_id = self._submitted(client, graph)
        r = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 201, r.text
        body = r.json()

        # The number was issued server-side (§D9). D44 — `YYYY-NNNNN`, was `YYYYMM###`:
        # the MONTH left the format, so the prefix is the year alone.
        assert re.fullmatch(r"\d{4}-\d{5}", body["student_number"]), body
        assert body["student_number"].startswith(school_today().strftime("%Y-"))
        # A generated password comes back exactly ONCE.
        assert body["temporary_password"]
        assert body["application"]["status"] == "accepted"
        assert body["application"]["student_code"] == body["student_number"]

        student = db_session.get(StudentProfile, uuid.UUID(body["student_id"]))
        assert student is not None
        assert student.student_number == body["student_number"]
        # Built FROM the application, so an accept cannot disagree with the form.
        assert student.first_name == "Presley"
        assert student.program_id == graph.program.id
        assert student.application_id == uuid.UUID(app_id)

        login = db_session.get(User, student.user_id)
        assert login is not None
        assert login.role == Role.STUDENT
        assert login.must_change_password is True

    def test_accept_opens_the_programme_history_on_day_one(
        self, client, graph, db_session
    ) -> None:
        """History starts at admission, not at the first change — otherwise a student who
        never changes programme has no record of when they started it."""
        app_id = self._submitted(client, graph)
        body = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={}).json()
        rows = db_session.scalars(
            select(StudentProgramHistory).where(
                StudentProgramHistory.student_id == uuid.UUID(body["student_id"])
            )
        ).all()
        assert len(rows) == 1
        assert rows[0].program_id == graph.program.id
        assert rows[0].ended_at is None  # the OPEN row

    def test_both_fk_directions_are_linked(self, client, graph, db_session) -> None:
        """The pair is circular in the schema and only one transaction makes it safe:
        `student_profiles.user_id` needs the user first, and `applications.student_id`
        needs the student."""
        app_id = self._submitted(client, graph)
        body = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={}).json()
        db_session.expire_all()
        app_row = db_session.get(Application, uuid.UUID(app_id))
        student = db_session.get(StudentProfile, uuid.UUID(body["student_id"]))
        assert app_row.student_id == student.id
        assert student.application_id == app_row.id

    def test_a_supplied_password_is_never_echoed(self, client, graph) -> None:
        """Same discipline as `POST /settings/users`: only a SERVER-generated secret is
        returned, and only once."""
        app_id = self._submitted(client, graph)
        body = client.post(
            f"{A}/{app_id}/accept",
            headers=graph.S,
            json={"temporary_password": "Kn0wnPassw0rd!"},
        ).json()
        assert body["temporary_password"] is None

    def test_a_draft_cannot_be_accepted(self, client, graph) -> None:
        app_id = _file_draft(client, graph).json()["id"]
        r = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="application_not_decidable")

    def test_accepting_twice_is_409(self, client, graph) -> None:
        app_id = self._submitted(client, graph)
        assert client.post(f"{A}/{app_id}/accept", headers=graph.S, json={}).status_code == 201
        r = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="application_accepted")

    def test_a_duplicate_login_email_is_409_and_writes_nothing(
        self, client, graph, db_session, make_user
    ) -> None:
        """The whole accept is one transaction: a clash on the LAST step must not leave a
        student, a burnt student number or a half-linked application behind."""
        taken = make_user(role=Role.STUDENT, full_name="Already Here")
        app_id = _file(client, graph, submit=True, email=taken.email).json()["id"]

        before = db_session.scalar(
            select(Application.student_id).where(Application.id == uuid.UUID(app_id))
        )
        r = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="duplicate_email")

        db_session.expire_all()
        app_row = db_session.get(Application, uuid.UUID(app_id))
        assert before is None and app_row.student_id is None
        assert app_row.status.value == "submitted"  # not left half-decided

    def test_a_login_email_may_be_supplied_when_the_form_had_none(
        self, client, graph
    ) -> None:
        """An applicant who gave no email still needs a login, so `login_email` satisfies
        the same blocking issue rather than forcing a PATCH first."""
        app_id = _file(client, graph, email=None).json()["id"]
        client.post(f"{A}/{app_id}/submit", headers=graph.S)
        r = client.post(
            f"{A}/{app_id}/accept",
            headers=graph.S,
            json={"login_email": f"issued.{graph.tag}@bajc.edu.bz"},
        )
        assert r.status_code == 201, r.text
        assert r.json()["login_email"] == f"issued.{graph.tag}@bajc.edu.bz"

    def test_no_email_anywhere_is_a_blocking_issue(self, client, graph) -> None:
        app_id = _file(client, graph, email=None).json()["id"]
        client.post(f"{A}/{app_id}/submit", headers=graph.S)
        r = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 422
        assert any(
            "email address is required" in issue
            for issue in r.json()["error"]["fields"]["application"]
        )

    def test_the_dean_may_also_accept(self, client, graph) -> None:
        """Registrar + Dean, per §D14 — the Dean is not locked out of administration."""
        app_id = self._submitted(client, graph)
        assert client.post(f"{A}/{app_id}/accept", headers=graph.P, json={}).status_code == 201

    def test_a_lecturer_may_not_accept(self, client, graph) -> None:
        app_id = self._submitted(client, graph)
        assert client.post(f"{A}/{app_id}/accept", headers=graph.T, json={}).status_code == 403

    def test_the_year_of_study_becomes_the_students_level(self, client, graph, db_session) -> None:
        """So the report-card header and the student list have something to print from day
        one rather than a blank `year_of_study`."""
        app_id = self._submitted(client, graph)
        body = client.post(f"{A}/{app_id}/accept", headers=graph.S, json={}).json()
        student = db_session.get(StudentProfile, uuid.UUID(body["student_id"]))
        assert student.year_of_study == "First"


# ════════════════════════════════════════════════════════════════════════════
class TestDenyWithdrawDelete:
    def test_deny_records_the_reason_and_the_decider(self, client, graph) -> None:
        app_id = _file(client, graph, submit=True).json()["id"]
        r = client.post(
            f"{A}/{app_id}/reject", headers=graph.S, json={"reason": "Insufficient CSEC passes."}
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "rejected"  # D44 renamed `denied`
        assert "Insufficient CSEC" in body["comments"]
        assert body["decided_by_user_id"] == str(graph.registrar_user.id)
        assert body["decided_at"] is not None

    def test_deny_appends_rather_than_overwriting_comments(self, client, graph) -> None:
        """A Registrar's earlier notes are part of the record."""
        app_id = _file(client, graph, submit=True, comments="Chased transcript twice.").json()["id"]
        body = client.post(f"{A}/{app_id}/reject", headers=graph.S, json={"reason": "No."}).json()
        assert "Chased transcript twice." in body["comments"]
        assert "No." in body["comments"]

    def test_a_draft_cannot_be_denied(self, client, graph) -> None:
        """A draft is not a decision waiting to be made — it is a form nobody finished."""
        app_id = _file_draft(client, graph).json()["id"]
        r = client.post(f"{A}/{app_id}/reject", headers=graph.S, json={})
        assert r.status_code == 409
        _assert_envelope(r.json(), code="application_not_decidable")

    def test_withdraw_is_distinct_from_deny(self, client, graph) -> None:
        """One is the applicant's choice, the other the college's, and the difference
        matters to anyone reading the record later."""
        app_id = _file(client, graph, submit=True).json()["id"]
        assert (
            client.post(f"{A}/{app_id}/withdraw", headers=graph.S).json()["status"]
            == "withdrawn"
        )

    def test_a_draft_may_be_withdrawn(self, client, graph) -> None:
        """Unlike deny: an applicant can pull out before finishing the form."""
        app_id = _file_draft(client, graph).json()["id"]
        assert client.post(f"{A}/{app_id}/withdraw", headers=graph.S).status_code == 200

    def test_delete_is_soft(self, client, graph, db_session) -> None:
        app_id = _file_draft(client, graph).json()["id"]
        assert client.delete(f"{A}/{app_id}", headers=graph.S).status_code == 204
        db_session.expire_all()
        row = db_session.get(Application, uuid.UUID(app_id))
        assert row is not None and row.deleted_at is not None
        assert client.get(f"{A}/{app_id}", headers=graph.S).status_code == 404

    def test_an_accepted_application_cannot_be_deleted(self, client, graph) -> None:
        """A student and a login hang off it; hiding it would leave them untraceable."""
        app_id = _file(client, graph, submit=True).json()["id"]
        client.post(f"{A}/{app_id}/accept", headers=graph.S, json={})
        r = client.delete(f"{A}/{app_id}", headers=graph.S)
        assert r.status_code == 409
        _assert_envelope(r.json(), code="application_accepted")


# ════════════════════════════════════════════════════════════════════════════
class TestListing:
    def test_filters_by_status(self, client, graph) -> None:
        _file_draft(client, graph)
        submitted_id = _file(client, graph, submit=True).json()["id"]
        body = client.get(f"{A}?status=submitted&page_size=100", headers=graph.S).json()
        ids = {item["id"] for item in body["items"]}
        assert submitted_id in ids
        assert all(item["status"] == "submitted" for item in body["items"])

    def test_search_matches_the_surname(self, client, graph) -> None:
        _file(client, graph)
        body = client.get(
            f"{A}?search=Rancharan{graph.tag}", headers=graph.S
        ).json()
        assert body["total"] >= 1

    def test_ordered_by_surname_not_by_display_string(self, client, graph) -> None:
        """§D10 — the same rule as students. Names chosen so the two orders DISAGREE:
        by surname it is Adams, Baker, Carter; by display string Yolanda, Xavier, Wendy.
        """
        for first, last in (("Yolanda", "Adams"), ("Xavier", "Baker"), ("Wendy", "Carter")):
            client.post(
                A,
                headers=graph.S,
                json={"first_name": first, "last_name": f"{last}{graph.tag}"},
            )
        body = client.get(f"{A}?search={graph.tag}&page_size=100", headers=graph.S).json()
        surnames = [item["last_name"] for item in body["items"]]
        assert surnames == sorted(surnames)
        display = [item["full_name"] for item in body["items"]]
        assert display != sorted(display)

    def test_a_soft_deleted_application_is_not_listed(self, client, graph) -> None:
        app_id = _file_draft(client, graph).json()["id"]
        client.delete(f"{A}/{app_id}", headers=graph.S)
        body = client.get(f"{A}?search={graph.tag}&page_size=100", headers=graph.S).json()
        assert app_id not in {item["id"] for item in body["items"]}

    def test_unknown_application_is_404(self, client, graph) -> None:
        assert client.get(f"{A}/{uuid.uuid4()}", headers=graph.S).status_code == 404

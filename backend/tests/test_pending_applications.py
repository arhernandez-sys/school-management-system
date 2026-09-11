"""Suite for D38 — the PENDING form (`application_temp`).

The load-bearing behaviours pinned here:

  * **`created_by` is the SCOPE, not just audit.** A Registrar reaches only the pending
    forms they filed; the Dean reaches all of them. Someone else's row answers **404**,
    not 403 — a 403 would confirm the row exists and whose it is.
  * **The whole form saves in one body**, Sections B and F included, because D38 removed
    per-step saving and the browser now holds all seven sections until it is asked to save.
  * **Promotion is one transaction**: the temp row becomes an `applications` row, the two
    JSON arrays become the real child rows, and the temp row is gone afterwards.
  * **A refused submit costs the Registrar nothing.** An incomplete form comes back with
    every reason at once AND is still sitting in the pending list — that is the whole point
    of a save-only-when-asked model, and the defect it would be worst to ship.
  * `blocking_issues` on the READ agrees with what the submit would refuse, so the list can
    say "ready" without anyone opening the wizard to find out.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.common.enums import Role
from app.modules.admissions.models import (
    Application,
    ApplicationDocument,
    ApplicationEducation,
    ApplicationTemp,
)
from app.modules.programs.models import Program

pytestmark = pytest.mark.requires_db

P = "/api/v1/pending-applications"
A = "/api/v1/applications"


class _Graph:
    """A Dean, two DIFFERENT Registrars, a Lecturer, and a programme to apply for.

    Two Registrars rather than one: the scope rule is "own rows", and a single Registrar
    cannot distinguish "scoped correctly" from "not scoped at all".
    """

    def __init__(self, db_session, make_user, auth_headers):
        self.tag = uuid.uuid4().hex[:8]
        self._db = db_session

        self.dean_user = make_user(role=Role.PRINCIPAL, full_name="The Dean")
        self.registrar_user = make_user(role=Role.SECRETARY, full_name="Registrar One")
        self.other_registrar_user = make_user(role=Role.SECRETARY, full_name="Registrar Two")
        self.lecturer_user = make_user(role=Role.TEACHER, full_name="A Lecturer")
        self.student_user = make_user(role=Role.STUDENT, full_name="A Student")

        self.P = auth_headers(user_id=self.dean_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.registrar_user.id, role=Role.SECRETARY)
        self.S2 = auth_headers(user_id=self.other_registrar_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.lecturer_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student_user.id, role=Role.STUDENT)

        self.program = Program(
            code=f"PD{self.tag[:4].upper()}",
            name=f"Pending Test Programme {self.tag}",
            award="Associate of Science",
            total_credits=60,
        )
        db_session.add(self.program)
        db_session.flush()

    def complete_body(self, **overrides) -> dict:
        """A form that passes every submission rule. An adult, so Section G needs one
        signature."""
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

    def minimal_body(self, **overrides) -> dict:
        """Names only — everything the table demands and nothing the submit does."""
        body = {"first_name": "Ana", "last_name": f"Lopez{self.tag}"}
        body.update(overrides)
        return body


@pytest.fixture
def graph(db_session, make_user, auth_headers) -> _Graph:
    return _Graph(db_session, make_user, auth_headers)


def _save(client, graph, headers=None, **overrides):
    return client.post(P, headers=headers or graph.S, json=graph.complete_body(**overrides))


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_lecturer_cannot_list(self, client, graph) -> None:
        """A pending form is another person's PII in progress."""
        assert client.get(P, headers=graph.T).status_code == 403

    def test_student_cannot_list(self, client, graph) -> None:
        assert client.get(P, headers=graph.U).status_code == 403

    def test_lecturer_cannot_save(self, client, graph) -> None:
        assert _save(client, graph, headers=graph.T).status_code == 403

    def test_unauthenticated_is_401(self, client) -> None:
        assert client.get(P).status_code == 401

    def test_registrar_may_list(self, client, graph) -> None:
        assert client.get(P, headers=graph.S).status_code == 200

    def test_dean_may_list(self, client, graph) -> None:
        assert client.get(P, headers=graph.P).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestSaveTheWholeForm:
    def test_names_alone_are_enough_to_save(self, client, graph) -> None:
        """Save and close must never refuse a half-typed form — that is what it is for."""
        r = client.post(P, headers=graph.S, json=graph.minimal_body())
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["full_name"].startswith("Ana Lopez")

    def test_a_blank_name_is_refused(self, client, graph) -> None:
        r = client.post(P, headers=graph.S, json={"first_name": "   ", "last_name": "X"})
        assert r.status_code == 422, r.text

    def test_sections_b_and_f_round_trip_through_json(self, client, graph) -> None:
        """The two repeating tables ride as JSON. They must come back in the SAME shape
        the real child tables read in, or the wizard needs two rendering paths."""
        r = _save(
            client,
            graph,
            education=[
                {
                    "institution": "Belize High",
                    "education_level": "High School",
                    "graduated": True,
                    "graduation_date": "2022-06-30",
                    "sort_order": 1,
                },
                {
                    "institution": "UB",
                    "education_level": "Tertiary",
                    "graduated": False,
                    "graduation_date": None,
                    "sort_order": 2,
                },
            ],
            documents=[
                {"document_type": "transcript", "received": True},
                {"document_type": "hs_diploma", "received": False},
            ],
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert [e["institution"] for e in body["education"]] == ["Belize High", "UB"]
        # A date survived the JSON round trip as a date, not a string of one.
        assert body["education"][0]["graduation_date"] == "2022-06-30"
        assert body["education"][1]["education_level"] == "Tertiary"
        assert {d["document_type"]: d["received"] for d in body["documents"]} == {
            "transcript": True,
            "hs_diploma": False,
        }

    def test_sort_order_is_renumbered_on_read(self, client, graph) -> None:
        """The client should not have to keep `sort_order` consistent while inserting and
        removing rows, exactly as `PUT .../education` renumbers server-side."""
        r = _save(
            client,
            graph,
            education=[
                {"institution": "Second", "sort_order": 40},
                {"institution": "First", "sort_order": 9},
            ],
        )
        assert [e["sort_order"] for e in r.json()["education"]] == [1, 2]

    def test_gender_is_normalised_on_write(self, client, graph) -> None:
        """D37 — the write path is where the vocabulary is enforced."""
        assert _save(client, graph, gender="FEMALE").json()["gender"] == "female"

    def test_resaving_replaces_the_whole_form(self, client, graph) -> None:
        """A PATCH here is whole-form, NOT per-section: the browser holds every section, so
        there is nothing on the server a full body could clobber."""
        temp_id = _save(client, graph, religion="Catholic").json()["id"]
        r = client.patch(
            f"{P}/{temp_id}",
            headers=graph.S,
            json=graph.complete_body(religion="Anglican", phone="601-0000"),
        )
        assert r.status_code == 200, r.text
        assert r.json()["religion"] == "Anglican"
        assert r.json()["phone"] == "601-0000"

    def test_an_unknown_programme_is_422(self, client, graph) -> None:
        r = _save(client, graph, program_id=str(uuid.uuid4()))
        assert r.status_code == 422, r.text


# ════════════════════════════════════════════════════════════════════════════
class TestScopeIsCreatedBy:
    """THE RULE THE CLIENT ASKED FOR: a Registrar sees only their own; the Dean sees all."""

    def test_a_registrar_sees_only_their_own_rows(self, client, graph) -> None:
        mine = _save(client, graph, headers=graph.S).json()["id"]
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body(first_name="Other")
        ).json()["id"]

        ids = {row["id"] for row in client.get(P, headers=graph.S).json()["items"]}
        assert mine in ids
        assert theirs not in ids

    def test_the_dean_sees_everyones_rows(self, client, graph) -> None:
        mine = _save(client, graph, headers=graph.S).json()["id"]
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body(first_name="Other")
        ).json()["id"]

        ids = {row["id"] for row in client.get(P, headers=graph.P).json()["items"]}
        assert {mine, theirs} <= ids

    def test_reading_someone_elses_row_is_404_not_403(self, client, graph) -> None:
        """404, deliberately. A 403 would confirm a form with that id exists and that it
        belongs to someone else — the fact the scope is meant to withhold."""
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body()
        ).json()["id"]
        assert client.get(f"{P}/{theirs}", headers=graph.S).status_code == 404

    def test_the_dean_can_read_someone_elses_row(self, client, graph) -> None:
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body()
        ).json()["id"]
        assert client.get(f"{P}/{theirs}", headers=graph.P).status_code == 200

    def test_overwriting_someone_elses_row_is_404(self, client, graph) -> None:
        """The scope has to hold on the WRITE paths too. Scoping only the list would be a
        real hole, not a theoretical one — ids travel in URLs."""
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body()
        ).json()["id"]
        r = client.patch(f"{P}/{theirs}", headers=graph.S, json=graph.complete_body())
        assert r.status_code == 404

    def test_deleting_someone_elses_row_is_404(self, client, graph) -> None:
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body()
        ).json()["id"]
        assert client.delete(f"{P}/{theirs}", headers=graph.S).status_code == 404

    def test_submitting_someone_elses_row_is_404(self, client, graph) -> None:
        theirs = client.post(
            P, headers=graph.S2, json=graph.complete_body()
        ).json()["id"]
        assert client.post(f"{P}/{theirs}/submit", headers=graph.S).status_code == 404

    def test_a_deans_edit_does_not_steal_the_row(self, client, graph, db_session) -> None:
        """`created_by` is the scope, so reassigning it on a Dean's edit would silently
        take the form away from the Registrar who filed it."""
        temp_id = _save(client, graph, headers=graph.S).json()["id"]
        assert (
            client.patch(
                f"{P}/{temp_id}", headers=graph.P, json=graph.complete_body(phone="1")
            ).status_code
            == 200
        )
        db_session.expire_all()
        row = db_session.get(ApplicationTemp, uuid.UUID(temp_id))
        assert row.created_by == graph.registrar_user.id
        assert row.updated_by == graph.dean_user.id
        # And it is still in the Registrar's own list.
        ids = {r["id"] for r in client.get(P, headers=graph.S).json()["items"]}
        assert temp_id in ids

    def test_the_dean_sees_who_filed_each_row(self, client, graph) -> None:
        """A shared queue's first question is "whose form is this?"."""
        _save(client, graph, headers=graph.S)
        rows = client.get(P, headers=graph.P).json()["items"]
        names = {r["created_by_name"] for r in rows}
        assert "Registrar One" in names


# ════════════════════════════════════════════════════════════════════════════
class TestDiscard:
    def test_delete_is_hard(self, client, graph, db_session) -> None:
        """No `deleted_at`: the row either became an application or was abandoned."""
        temp_id = _save(client, graph).json()["id"]
        assert client.delete(f"{P}/{temp_id}", headers=graph.S).status_code == 204
        db_session.expire_all()
        assert db_session.get(ApplicationTemp, uuid.UUID(temp_id)) is None
        assert client.get(f"{P}/{temp_id}", headers=graph.S).status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestBlockingIssues:
    def test_a_complete_form_reports_nothing_missing(self, client, graph) -> None:
        assert _save(client, graph).json()["blocking_issues"] == []

    def test_an_incomplete_form_lists_every_reason_at_once(self, client, graph) -> None:
        """One reason per attempt would make the Registrar save six times to find them."""
        issues = client.post(P, headers=graph.S, json=graph.minimal_body()).json()[
            "blocking_issues"
        ]
        assert len(issues) >= 4
        joined = " ".join(issues)
        assert "Date of birth" in joined
        assert "programme" in joined.lower()

    def test_the_under_18_guardian_rule_is_reported(self, client, graph) -> None:
        """Section G's rule about the FORM, not about a column."""
        issues = _save(
            client, graph, date_of_birth="2012-05-02", applicant_signed_at="2026-08-01"
        ).json()["blocking_issues"]
        assert any("under 18" in i for i in issues)

    def test_the_list_row_carries_the_same_issues(self, client, graph) -> None:
        """So the list can say "ready to submit" without anyone opening the wizard."""
        client.post(P, headers=graph.S, json=graph.minimal_body())
        row = next(
            r
            for r in client.get(P, headers=graph.S).json()["items"]
            if r["last_name"] == f"Lopez{graph.tag}"
        )
        assert row["blocking_issues"]


# ════════════════════════════════════════════════════════════════════════════
class TestPromotion:
    def test_submit_moves_the_row_into_applications(
        self, client, graph, db_session
    ) -> None:
        temp_id = _save(client, graph).json()["id"]
        r = client.post(f"{P}/{temp_id}/submit", headers=graph.S)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "submitted"
        assert body["last_name"] == f"Rancharan{graph.tag}"
        # It is a REAL application id now, not the temp id.
        assert body["id"] != temp_id

        db_session.expire_all()
        assert db_session.get(Application, uuid.UUID(body["id"])) is not None

    def test_the_temp_row_is_gone_afterwards(self, client, graph, db_session) -> None:
        """The same form in both tables is the one state nothing downstream copes with."""
        temp_id = _save(client, graph).json()["id"]
        assert client.post(f"{P}/{temp_id}/submit", headers=graph.S).status_code == 201
        db_session.expire_all()
        assert db_session.get(ApplicationTemp, uuid.UUID(temp_id)) is None
        assert client.get(f"{P}/{temp_id}", headers=graph.S).status_code == 404
        ids = {r["id"] for r in client.get(P, headers=graph.S).json()["items"]}
        assert temp_id not in ids

    def test_the_json_arrays_become_real_child_rows(
        self, client, graph, db_session
    ) -> None:
        """The point of the JSON columns: they are a holding shape, not the final one."""
        temp_id = _save(
            client,
            graph,
            education=[
                {
                    "institution": "Belize High",
                    "education_level": "High School",
                    "graduated": True,
                    "graduation_date": "2022-06-30",
                },
                {"institution": "UB", "education_level": "Tertiary"},
            ],
            documents=[
                {"document_type": "transcript", "received": True},
                {"document_type": "hs_diploma", "received": False},
            ],
        ).json()["id"]

        app_id = uuid.UUID(client.post(f"{P}/{temp_id}/submit", headers=graph.S).json()["id"])
        db_session.expire_all()

        edu = list(
            db_session.scalars(
                select(ApplicationEducation)
                .where(ApplicationEducation.application_id == app_id)
                .order_by(ApplicationEducation.sort_order)
            ).all()
        )
        assert [e.institution for e in edu] == ["Belize High", "UB"]
        assert [e.sort_order for e in edu] == [1, 2]
        assert edu[0].graduated is True
        assert str(edu[0].graduation_date) == "2022-06-30"

        docs = list(
            db_session.scalars(
                select(ApplicationDocument).where(
                    ApplicationDocument.application_id == app_id
                )
            ).all()
        )
        assert {d.document_type.value: d.received for d in docs} == {
            "transcript": True,
            "hs_diploma": False,
        }

    def test_the_promoted_row_reads_back_through_the_applications_api(
        self, client, graph
    ) -> None:
        """It is an ordinary application afterwards — the decision queue must see it."""
        temp_id = _save(client, graph).json()["id"]
        app_id = client.post(f"{P}/{temp_id}/submit", headers=graph.S).json()["id"]

        detail = client.get(f"{A}/{app_id}", headers=graph.S)
        assert detail.status_code == 200, detail.text
        assert detail.json()["status"] == "submitted"

        listed = client.get(A, headers=graph.S, params={"status": "submitted"}).json()
        assert app_id in {row["id"] for row in listed["items"]}

    def test_the_author_is_carried_across_not_reassigned(
        self, client, graph, db_session
    ) -> None:
        """The Dean submitting a Registrar's form does not make it the Dean's application."""
        temp_id = _save(client, graph, headers=graph.S).json()["id"]
        app_id = client.post(f"{P}/{temp_id}/submit", headers=graph.P).json()["id"]
        db_session.expire_all()
        row = db_session.get(Application, uuid.UUID(app_id))
        assert row.created_by == graph.registrar_user.id
        assert row.updated_by == graph.dean_user.id


# ════════════════════════════════════════════════════════════════════════════
class TestARefusedSubmitCostsNothing:
    """THE DEFECT IT WOULD BE WORST TO SHIP.

    D38 exists so nothing is written until the Registrar asks. A submit that consumed the
    temp row and *then* discovered the form was incomplete would destroy exactly the work
    the new model is supposed to protect.
    """

    def test_an_incomplete_submit_is_422_with_every_reason(self, client, graph) -> None:
        temp_id = client.post(P, headers=graph.S, json=graph.minimal_body()).json()["id"]
        r = client.post(f"{P}/{temp_id}/submit", headers=graph.S)
        assert r.status_code == 422, r.text
        err = r.json()["error"]
        assert err["code"] == "application_incomplete"
        assert len(err["fields"]["application"]) >= 4

    def test_the_temp_row_SURVIVES_a_refused_submit(
        self, client, graph, db_session
    ) -> None:
        temp_id = client.post(P, headers=graph.S, json=graph.minimal_body()).json()["id"]
        assert client.post(f"{P}/{temp_id}/submit", headers=graph.S).status_code == 422

        db_session.expire_all()
        assert db_session.get(ApplicationTemp, uuid.UUID(temp_id)) is not None
        assert client.get(f"{P}/{temp_id}", headers=graph.S).status_code == 200
        ids = {r["id"] for r in client.get(P, headers=graph.S).json()["items"]}
        assert temp_id in ids

    def test_no_application_is_created_by_a_refused_submit(
        self, client, graph, db_session
    ) -> None:
        """A half-promotion would leave an orphan draft in the admissions record."""
        before = db_session.scalar(
            select(Application).where(Application.last_name == f"Lopez{graph.tag}")
        )
        assert before is None

        temp_id = client.post(P, headers=graph.S, json=graph.minimal_body()).json()["id"]
        assert client.post(f"{P}/{temp_id}/submit", headers=graph.S).status_code == 422

        db_session.expire_all()
        after = db_session.scalar(
            select(Application).where(Application.last_name == f"Lopez{graph.tag}")
        )
        assert after is None

    def test_a_graduated_institution_without_a_date_is_refused(
        self, client, graph, db_session
    ) -> None:
        """Saving it is allowed — it is a form in progress. SUBMITTING it is not."""
        temp_id = _save(
            client,
            graph,
            education=[
                {
                    "institution": "Belize High",
                    "graduated": True,
                    "graduation_date": None,
                }
            ],
        ).json()["id"]

        r = client.post(f"{P}/{temp_id}/submit", headers=graph.S)
        assert r.status_code == 422, r.text
        db_session.expire_all()
        assert db_session.get(ApplicationTemp, uuid.UUID(temp_id)) is not None


# ════════════════════════════════════════════════════════════════════════════
class TestTheProgrammeIsReadBack:
    """⚠️ REGRESSION (reported by the client, Sep 2026: *"why is programme not being
    saved in the admission temp"*).

    It **was** being saved. `application_temp.program_id` held the right value the
    whole time — the column, the schema field and `_TEMP_WRITABLE` were all correct — and
    `_pending_list_item` hardcoded `program=None` on the way out. Every read returned
    null.

    **That is worse than a blank column, and this is the part the tests must pin.** The
    wizard seeds its draft with `detail.program?.id ?? ''` and sends
    `program_id: draft.program_id === '' ? null : draft.program_id`. So a read returning
    null made the Programme select reopen empty, and the next *Save and close* wrote that
    emptiness back — **a read defect that destroyed data on the following write.**

    Checked against the defect: with `program=None` put back, **5 of these 7 fail**.
    `complete_body` had always sent `program_id`; nothing had ever asserted it came back.
    """

    def test_the_create_response_carries_the_programme(self, client, graph) -> None:
        r = _save(client, graph)
        assert r.status_code == 201, r.text
        program = r.json()["program"]
        assert program is not None, "the create response dropped the programme"
        assert program["id"] == str(graph.program.id)

    def test_it_carries_the_code_and_name_so_a_screen_can_label_it(
        self, client, graph
    ) -> None:
        """An id alone forces every caller to go and look the programme up."""
        program = _save(client, graph).json()["program"]
        assert program["code"] == graph.program.code
        assert program["name"] == graph.program.name

    def test_the_detail_read_carries_it(self, client, graph) -> None:
        """This is the read the wizard reopens with. It is the one that mattered."""
        temp_id = _save(client, graph).json()["id"]
        r = client.get(f"{P}/{temp_id}", headers=graph.S)
        assert r.status_code == 200, r.text
        assert (r.json()["program"] or {}).get("id") == str(graph.program.id)

    def test_the_list_row_carries_it(self, client, graph) -> None:
        """The blank Programme column on the Pending forms list."""
        temp_id = _save(client, graph).json()["id"]
        rows = client.get(f"{P}?page_size=100", headers=graph.S).json()["items"]
        row = next(r for r in rows if r["id"] == temp_id)
        assert (row["program"] or {}).get("id") == str(graph.program.id)

    def test_reopening_and_saving_again_does_not_erase_it(self, client, graph) -> None:
        """**The data-loss path.** Walks exactly what the wizard does: read the form,
        seed the draft from `program.id` the way the screen does, send the whole body
        back. Under the defect the draft seeded to empty and this wrote null."""
        temp_id = _save(client, graph).json()["id"]

        reopened = client.get(f"{P}/{temp_id}", headers=graph.S).json()
        draft_program_id = (reopened.get("program") or {}).get("id") or ""

        body = graph.complete_body()
        body["program_id"] = draft_program_id or None
        r = client.patch(f"{P}/{temp_id}", headers=graph.S, json=body)
        assert r.status_code == 200, r.text

        assert (r.json()["program"] or {}).get("id") == str(graph.program.id), (
            "the programme was erased by a reopen-and-save cycle"
        )

    def test_an_explicit_null_still_clears_it(self, client, graph) -> None:
        """The fix must not make the field impossible to unset — a Registrar who picked
        the wrong programme has to be able to take it back off."""
        temp_id = _save(client, graph).json()["id"]
        body = graph.complete_body()
        body["program_id"] = None
        r = client.patch(f"{P}/{temp_id}", headers=graph.S, json=body)
        assert r.status_code == 200, r.text
        assert r.json()["program"] is None

    def test_a_form_with_no_programme_reports_none_not_an_error(
        self, client, graph
    ) -> None:
        """Saving a half-typed form is what this table is for."""
        r = client.post(P, headers=graph.S, json=graph.minimal_body())
        assert r.status_code == 201, r.text
        assert r.json()["program"] is None

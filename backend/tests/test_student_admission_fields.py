"""The admission-form fields on the STUDENT record (D33, client asks 3 + 4).

`student_profiles` has carried Sections A–E of the BAJC application since
`005_tertiary.sql`, and `admissions/service.py` has been copying them onto the student at
acceptance all along. What did not exist was any way to READ or WRITE them outside
admissions: `StudentDetail` exposed only `district`, and `POST`/`PATCH /students` exposed
none of them.

That produced a two-tier register. A student admitted THROUGH admissions had a next of
kin, a financier and a religion; one registered directly — the paper-form path, or a
college that predates this system — had permanently blank ones and no screen anywhere to
fill them in. D32's Religion filter made it visible, because it selected on a column the
Registrar could not see.

This suite pins the closure: every field round-trips through create, read and patch; the
partial-update semantics are right for the two booleans and for clearing a value; and
`program_id` keeps its create-only rule so `student_program_history` cannot be left behind.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.modules.students.models import StudentProfile, StudentProgramHistory
from app.modules.students.service import ADMISSION_PROFILE_FIELDS

pytestmark = pytest.mark.requires_db

S = "/api/v1/students"

#: One value per writable field, all distinguishable, so a mis-assignment between two
#: same-typed columns (there are eight plain strings) shows up as a wrong value rather
#: than passing by coincidence.
FULL_FORM: dict = {
    "ssno": "123456789",
    "civil_status": "Single",
    "religion": "Anglican",
    "street": "14 Mahogany Street",
    "city_town_village": "Belmopan",
    "district": "Cayo",
    "mother_name": "Ana Perez",
    "father_name": "Luis Perez",
    "nok_name": "Marta Perez",
    "nok_relationship": "Aunt",
    "nok_phone": "+501-6001111",
    "has_health_condition": True,
    "health_condition_note": "Asthma — inhaler with the school nurse.",
    "atlib_exam": True,
    "num_csec": 7,
    "finance_name": "Rosa Perez",
    "finance_phone": "+501-6002222",
    "finance_email": "rosa.perez@example.bz",
    "enrollment_load": "Full Time",
    # ── D34 · reconciled from the client's own schema (migration 011) ──────────
    "student_id_original": 20777,
    # The student's OWN email. D33 asserted this field was NOT writable, because
    # `student_profiles` had no email column and `StudentDetail.email` was derived from
    # the linked `users` row. D34 gave the student a real one and renamed the derived
    # field to `login_email`; `TestRead` below pins that the two stay distinct.
    "email": "ana.perez@student.bajc.edu.bz",
    "transferred_from": "Corozal Community College",
    "graduation_date": "2026-06-19",
    # NAIVE on purpose: the column is a MariaDB DATETIME, so a trailing `Z` is
    # accepted on the way in and simply absent on the way back out.
    "dropout_date": "2026-03-02T00:00:00",
    "dropout_reason": "Relocated abroad.",
    "comments": "Fee plan agreed with the bursar.",
    "origin": "import-2026",
}


def _minimal() -> dict:
    """The four fields a create actually requires (D30 §D9 — the ID is issued)."""
    return {
        "first_name": "Ana",
        "last_name": "Perez",
        "date_of_birth": "2008-04-11",
        "enrollment_date": "2026-01-12",
    }


def _create(client, headers, **extra):
    return client.post(S, headers=headers, json={**_minimal(), **extra})


@pytest.fixture
def H(make_user, auth_headers):
    from app.common.enums import Role

    return auth_headers(user_id=make_user(role=Role.SECRETARY).id, role=Role.SECRETARY)


@pytest.fixture
def make_program(db_session):
    """Reuses `test_programs.py`'s factory rather than a second copy of it."""
    from tests.test_programs import _make_program

    def _factory(**over):
        return _make_program(db_session, **over)

    return _factory


# ════════════════════════════════════════════════════════════════════════════
class TestTheListIsComplete:
    def test_every_writable_field_is_in_the_iterated_list(self) -> None:
        """`ADMISSION_PROFILE_FIELDS` is what create and update loop over. A field added
        to the schema but forgotten here would be silently dropped on write — the exact
        failure the constant exists to prevent — and a `model_config` typo would not catch
        it, because `extra="forbid"` only rejects fields the schema does NOT know."""
        assert set(ADMISSION_PROFILE_FIELDS) == set(FULL_FORM)

    def test_every_field_is_a_real_column(self) -> None:
        for field in ADMISSION_PROFILE_FIELDS:
            assert hasattr(StudentProfile, field), field


# ════════════════════════════════════════════════════════════════════════════
class TestCreate:
    def test_the_whole_form_round_trips(self, client, H) -> None:
        resp = _create(client, H, **FULL_FORM)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        for field, expected in FULL_FORM.items():
            assert body[field] == expected, field

    def test_omitting_everything_still_creates(self, client, H) -> None:
        """The paper form leaves most of itself blank, and so must this. Only the two
        booleans have a value, because their columns are NOT NULL."""
        resp = _create(client, H)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["has_health_condition"] is False
        assert body["atlib_exam"] is False
        assert body["religion"] is None
        assert body["nok_name"] is None

    def test_the_values_reach_the_COLUMNS(self, client, H, db_session) -> None:
        """Read back off the row, not off the response: a field the response echoes from
        the request but never persists would pass every assertion above."""
        student_id = _create(client, H, **FULL_FORM).json()["id"]
        db_session.expire_all()
        row = db_session.scalar(select(StudentProfile).where(StudentProfile.id == student_id))
        assert row is not None
        assert row.nok_relationship == "Aunt"
        assert row.finance_email == "rosa.perez@example.bz"
        assert row.num_csec == 7
        assert row.has_health_condition is True

    def test_a_bad_district_is_rejected_not_stored(self, client, H) -> None:
        """It is an enum server-side. A free-text district is how one gets spelled two
        ways in one database."""
        assert _create(client, H, district="Petén").status_code == 422

    def test_num_csec_is_bounded(self, client, H) -> None:
        assert _create(client, H, num_csec=-1).status_code == 422
        assert _create(client, H, num_csec=99).status_code == 422

    def test_an_unknown_field_still_422s(self, client, H) -> None:
        """`extra="forbid"` has to survive the mixin: a subclass's `model_config` REPLACES
        rather than merges, so re-stating it on the write models is load-bearing."""
        assert _create(client, H, nickname="Nan").status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestRead:
    def test_the_detail_carries_every_field(self, client, H) -> None:
        student_id = _create(client, H, **FULL_FORM).json()["id"]
        body = client.get(f"{S}/{student_id}", headers=H).json()
        for field, expected in FULL_FORM.items():
            assert body[field] == expected, field

    def test_the_LOGIN_email_is_read_only_and_null_without_an_account(
        self, client, H
    ) -> None:
        """`login_email` is the address on the linked `users` row, and a paper
        registration has no account until someone issues one.

        D34 renamed this from `email` because the student gained a real contact-email
        column; the next test is why the rename mattered.
        """
        student_id = _create(client, H).json()["id"]
        assert client.get(f"{S}/{student_id}", headers=H).json()["login_email"] is None

    def test_the_LOGIN_email_is_NOT_writable(self, client, H) -> None:
        """Changing a login is a Users-module action with its own uniqueness rules, so it
        is not a student field however it is spelled."""
        assert _create(client, H, login_email="ana@example.bz").status_code == 422

    def test_the_contact_email_and_the_LOGIN_are_different_fields(
        self, client, H, db_session
    ) -> None:
        """The whole point of D34's rename. Before it there was ONE field called `email`
        and it was the login, so a student registered on paper — no account — showed no
        email at all even when the office held one on the form. Conflating them is also
        how an address correction would silently move a login."""
        student_id = _create(client, H, email="ana.contact@example.bz").json()["id"]
        body = client.get(f"{S}/{student_id}", headers=H).json()
        assert body["email"] == "ana.contact@example.bz"
        assert body["login_email"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestPatch:
    def test_each_field_can_be_set_later(self, client, H) -> None:
        """The whole point: a student registered on paper must be completable afterwards."""
        student_id = _create(client, H).json()["id"]
        resp = client.patch(f"{S}/{student_id}", headers=H, json=FULL_FORM)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        for field, expected in FULL_FORM.items():
            assert body[field] == expected, field

    def test_an_omitted_field_is_left_alone(self, client, H) -> None:
        student_id = _create(client, H, **FULL_FORM).json()["id"]
        body = client.patch(f"{S}/{student_id}", headers=H, json={"religion": "Catholic"}).json()
        assert body["religion"] == "Catholic"
        # Everything else survived — a partial update that blanked the rest of the form
        # would be a data-loss bug, not a validation one, and nothing would report it.
        assert body["nok_name"] == "Marta Perez"
        assert body["finance_email"] == "rosa.perez@example.bz"
        assert body["has_health_condition"] is True

    def test_a_value_can_be_CLEARED_with_null(self, client, H) -> None:
        """A religion entered by mistake has to be removable, and NULL is the right stored
        value for "not recorded" — not an empty string."""
        student_id = _create(client, H, **FULL_FORM).json()["id"]
        body = client.patch(f"{S}/{student_id}", headers=H, json={"religion": None}).json()
        assert body["religion"] is None

    def test_a_boolean_can_be_turned_OFF(self, client, H) -> None:
        """The case `if payload.x is not None` cannot express, and the reason
        `update_student` reads `model_fields_set` instead. A health condition ticked by
        mistake must be un-tickable; under a truthiness check it would be permanent."""
        student_id = _create(client, H, **FULL_FORM).json()["id"]
        body = client.patch(
            f"{S}/{student_id}", headers=H, json={"has_health_condition": False}
        ).json()
        assert body["has_health_condition"] is False

    def test_an_explicit_null_boolean_reads_as_false_not_a_500(self, client, H) -> None:
        """The column is NOT NULL. A client sending `null` for a tick-box is asking for
        "no", and writing NULL would violate the constraint at flush time."""
        student_id = _create(client, H, **FULL_FORM).json()["id"]
        resp = client.patch(f"{S}/{student_id}", headers=H, json={"atlib_exam": None})
        assert resp.status_code == 200, resp.text
        assert resp.json()["atlib_exam"] is False


# ════════════════════════════════════════════════════════════════════════════
class TestProgramme:
    def test_a_programme_assigned_at_registration_opens_its_history(
        self, client, H, db_session, make_program
    ) -> None:
        """The Academic-history panel reads `student_program_history`, not the column. A
        create that set one without the other would show a student on no programme at all."""
        program = make_program()
        student_id = _create(client, H, program_id=str(program.id)).json()["id"]

        detail = client.get(f"{S}/{student_id}", headers=H).json()
        assert detail["program"]["code"] == program.code

        rows = db_session.scalars(
            select(StudentProgramHistory).where(StudentProgramHistory.student_id == student_id)
        ).all()
        assert len(rows) == 1
        assert rows[0].program_id == program.id
        assert rows[0].ended_at is None  # the OPEN row
        assert rows[0].started_at.isoformat() == _minimal()["enrollment_date"]

    def test_an_unknown_programme_is_404_and_creates_nothing(
        self, client, H, db_session
    ) -> None:
        import uuid

        before = db_session.scalar(select(StudentProfile.id).order_by(StudentProfile.id))
        resp = _create(client, H, program_id=str(uuid.uuid4()))
        assert resp.status_code == 404, resp.text
        assert resp.json()["error"]["code"] == "program_not_found"
        # The whole create rolled back with it — not a student on no programme.
        assert db_session.scalar(select(StudentProfile.id).order_by(StudentProfile.id)) == before

    def test_program_id_is_REJECTED_on_patch(self, client, H, make_program) -> None:
        """Not an oversight. A change has to close the open history row and open a new one
        in the same transaction, which is `PUT /students/{id}/program` (Dean only, §D12). A
        PATCH field here would write the column and leave the history behind — and nothing
        downstream would notice, because every list query reads the column."""
        student_id = _create(client, H).json()["id"]
        resp = client.patch(
            f"{S}/{student_id}", headers=H, json={"program_id": str(make_program().id)}
        )
        assert resp.status_code == 422, resp.text

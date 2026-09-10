"""D40 — the civil-status vocabulary, its directory filter, and the full lecturer create.

Three changes land together and each has a way of looking correct while being wrong:

  * **`civil_status` is now written from a dropdown**, and folded server-side by
    `normalise_civil_status`. The fold is the part worth pinning: MariaDB's collation is
    case-insensitive, so a stored `'single'` beside a stored `'Single'` is invisible to
    `GROUP BY` and to `<>` — and the BROWSER is not, which is where it turns into a blank
    `<select>` that clears the field on the next save. This is the same defect D37 found on
    `gender`, on the column beside it.
  * **The directory filters on it**, exact-match. The trap here is the same one the
    religion filter's tests record: an attribute filter must select the STUDENT, not their
    enrolment, so a graduated student still matches.
  * **`POST /teachers` accepts the whole profile.** `gender`, `bio` and `expertise` were
    absent from `TeacherCreateRequest`, and the model sets `extra="forbid"` — so a create
    body carrying them was a 422, not a silent drop. The one-screen lecturer form sends
    them on every create, so this is the test that says the screen can work at all.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.common.enums import Role, StudentStatus, normalise_civil_status
from app.modules.students.models import StudentProfile
from tests.conftest import split_name
from tests.test_admissions import _file, graph  # noqa: F401 - fixture re-export

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"
TEACHERS = "/api/v1/teachers"


@pytest.fixture
def staff_headers(make_user, auth_headers):
    user = make_user(role=Role.PRINCIPAL)
    return auth_headers(user_id=user.id, role=Role.PRINCIPAL)


def _student(db_session, *, name: str, civil_status: str | None, status=StudentStatus.ACTIVE):
    s = StudentProfile(
        student_number=f"S{uuid.uuid4().hex[:10]}",
        **split_name(name),
        date_of_birth=date(2004, 1, 1),
        enrollment_date=date(2025, 9, 1),
        status=status,
        civil_status=civil_status,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _ids(client, headers, **params) -> set[str]:
    query = "&".join(f"{k}={v}" for k, v in {"page_size": 100, **params}.items())
    resp = client.get(f"{STUDENTS}?{query}", headers=headers)
    assert resp.status_code == 200, resp.text
    return {i["id"] for i in resp.json()["items"]}


# ════════════════════════════════════════════════════════════════════════════
class TestNormaliser:
    """The fold itself. Everything below depends on it, so it is pinned first."""

    @pytest.mark.parametrize(
        ("submitted", "stored"),
        [
            ("Single", "Single"),
            ("single", "Single"),
            ("  MARRIED  ", "Married"),
            ("divorced", "Divorced"),
            ("Widow(er)", "Widow(er)"),
            ("widower", "Widow(er)"),
            ("widowed", "Widow(er)"),
            ("W", "Widow(er)"),
        ],
    )
    def test_recognised_spellings_fold(self, submitted: str, stored: str) -> None:
        assert normalise_civil_status(submitted) == stored

    def test_unrecognised_value_passes_through(self) -> None:
        """NOT rejected. This runs on the admissions transcription path, and a 422 here
        would stop a Registrar recording a real student over a word we did not predict."""
        assert normalise_civil_status("Common law") == "Common law"

    @pytest.mark.parametrize("blank", [None, "", "   "])
    def test_blank_is_none(self, blank) -> None:
        assert normalise_civil_status(blank) is None

    def test_returns_plain_str_not_the_enum_member(self) -> None:
        """`CivilStatus` subclasses `str`, but `str(CivilStatus.SINGLE)` is
        `'CivilStatus.SINGLE'` from 3.11 — handing the member to a `varchar` column risks
        storing that literal the moment anything stringifies it."""
        assert type(normalise_civil_status("single")) is str


class TestWritePathFolds:
    def test_create_student_folds_civil_status(self, client, staff_headers, db_session) -> None:
        resp = client.post(
            STUDENTS,
            headers=staff_headers,
            json={
                "first_name": "Nia",
                "last_name": "Norm",
                "date_of_birth": "2004-05-05",
                "enrollment_date": "2025-09-01",
                "civil_status": "  married ",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["civil_status"] == "Married"

    def test_update_student_folds_civil_status(self, client, staff_headers, db_session) -> None:
        student = _student(db_session, name="Ola Old", civil_status=None)
        resp = client.patch(
            f"{STUDENTS}/{student.id}",
            headers=staff_headers,
            json={"civil_status": "widower"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["civil_status"] == "Widow(er)"

    def test_update_can_still_clear_it(self, client, staff_headers, db_session) -> None:
        """An empty string CLEARS, matching every other optional text field — a civil
        status entered by mistake has to be removable."""
        student = _student(db_session, name="Cleo Clear", civil_status="Single")
        resp = client.patch(
            f"{STUDENTS}/{student.id}", headers=staff_headers, json={"civil_status": ""}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["civil_status"] is None

    def test_a_legacy_value_survives_an_unrelated_edit(
        self, client, staff_headers, db_session
    ) -> None:
        """The whole reason the column stays free text. Editing a phone number must not
        touch a civil status this system did not write."""
        student = _student(db_session, name="Lex Legacy", civil_status="Common law")
        resp = client.patch(
            f"{STUDENTS}/{student.id}", headers=staff_headers, json={"phone": "555-0100"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["civil_status"] == "Common law"


class TestDirectoryFilter:
    @pytest.fixture
    def cohort(self, db_session):
        return {
            "single": _student(db_session, name="Sam Single", civil_status="Single"),
            "married": _student(db_session, name="Mia Married", civil_status="Married"),
            "legacy": _student(db_session, name="Lee Legacy", civil_status="Common law"),
            "none": _student(db_session, name="Nil None", civil_status=None),
            "gone": _student(
                db_session,
                name="Gil Graduate",
                civil_status="Single",
                status=StudentStatus.GRADUATED,
            ),
        }

    def test_filters_exactly(self, client, staff_headers, cohort) -> None:
        got = _ids(client, staff_headers, civil_status="Single")
        assert str(cohort["single"].id) in got
        assert str(cohort["married"].id) not in got
        assert str(cohort["legacy"].id) not in got
        assert str(cohort["none"].id) not in got

    def test_matches_the_student_not_their_enrolment(self, client, staff_headers, cohort) -> None:
        """A graduated student holds no active enrolment. Filtering through one would
        quietly empty this view — the trap `academic_year_id` and `religion` both record."""
        got = _ids(client, staff_headers, civil_status="Single")
        assert str(cohort["gone"].id) in got

    def test_a_legacy_value_is_still_selectable(self, client, staff_headers, cohort) -> None:
        """The directory PRINTS `civil_status` in a column. A value it can show and cannot
        filter to is a student nobody can find by what the table says about them."""
        got = _ids(client, staff_headers, civil_status="Common law")
        assert got == {str(cohort["legacy"].id)}

    def test_combines_with_another_filter(self, client, staff_headers, cohort) -> None:
        got = _ids(client, staff_headers, civil_status="Single", status="Graduated")
        assert str(cohort["gone"].id) in got
        assert str(cohort["single"].id) not in got

    def test_row_carries_civil_status(self, client, staff_headers, cohort) -> None:
        resp = client.get(f"{STUDENTS}?page_size=100", headers=staff_headers)
        assert resp.status_code == 200, resp.text
        rows = {i["id"]: i for i in resp.json()["items"]}
        assert rows[str(cohort["married"].id)]["civil_status"] == "Married"

    def test_filter_options_reports_present_values(self, client, staff_headers, cohort) -> None:
        resp = client.get(f"{STUDENTS}/filter-options", headers=staff_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "civil_statuses" in body
        # The residue is what the dropdown needs: 'Common law' is not in `CivilStatus`,
        # so without this list the filter could not offer it.
        assert "Common law" in body["civil_statuses"]
        assert None not in body["civil_statuses"]
        assert "" not in body["civil_statuses"]


class TestLecturerCreateTakesTheWholeProfile:
    """D40 — `POST /teachers` with every field the one-screen form shows.

    `TeacherCreateRequest` sets `extra="forbid"`, so before D40 each of `gender`, `bio` and
    `expertise` made this body a 422 rather than being dropped. A create that 422s is the
    form not working at all, which is why this is one request carrying all of them.
    """

    def test_create_persists_every_field(self, client, staff_headers) -> None:
        tag = uuid.uuid4().hex[:6].upper()
        resp = client.post(
            TEACHERS,
            headers=staff_headers,
            json={
                "staff_number": f"STF{tag}",
                "full_name": "Dr. Adaeze Full",
                "email": f"adaeze.{tag.lower()}@example.bz",
                "phone": "501-555-0142",
                "subject_specializations": ["Mathematics", "Physics"],
                "first_name": "Adaeze",
                "last_name": "Full",
                "gender": "female",
                "bio": "Twelve years teaching secondary mathematics.",
                "academic_qualification": "M.Ed. Mathematics",
                "designation": "Senior Lecturer",
                "address": "12 Mahogany Street, Belmopan",
                "ssno": "123456789",
                "licensenum": "OWD-2019-00035",
                "hire_date": "2019-08-15",
                "end_date": None,
                "comments": "Prefers morning sections.",
                "expertise": [
                    {"area": "Algebra", "level": 90},
                    {"area": "Statistics", "level": 75},
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        teacher = resp.json()["teacher"]

        assert teacher["gender"] == "female"
        assert teacher["bio"] == "Twelve years teaching secondary mathematics."
        assert teacher["expertise"] == [
            {"area": "Algebra", "level": 90},
            {"area": "Statistics", "level": 75},
        ]
        assert teacher["first_name"] == "Adaeze"
        assert teacher["ssno"] == "123456789"
        assert teacher["licensenum"] == "OWD-2019-00035"
        assert teacher["hire_date"] == "2019-08-15"
        assert teacher["designation"] == "Senior Lecturer"
        assert teacher["academic_qualification"] == "M.Ed. Mathematics"
        assert teacher["comments"] == "Prefers morning sections."
        # Derived from `status`, never accepted from the request — the two copies of one
        # fact that D39 refused to let a caller set independently.
        assert teacher["is_employed"] is True

    def test_created_profile_reads_back_identically(self, client, staff_headers) -> None:
        """The create RESPONSE and a subsequent GET must agree. A field set on the object
        but never flushed would pass the assertion above and fail here."""
        tag = uuid.uuid4().hex[:6].upper()
        created = client.post(
            TEACHERS,
            headers=staff_headers,
            json={
                "staff_number": f"STF{tag}",
                "full_name": "Roundtrip Rae",
                "gender": "other",
                "bio": "  padded  ",
                "expertise": [{"area": "  Chemistry  ", "level": 60}],
            },
        )
        assert created.status_code == 201, created.text
        teacher_id = created.json()["teacher"]["id"]

        fetched = client.get(f"{TEACHERS}/{teacher_id}", headers=staff_headers)
        assert fetched.status_code == 200, fetched.text
        body = fetched.json()
        assert body["gender"] == "other"
        # Stripped on the way in, like every other free-text field on this model.
        assert body["bio"] == "padded"
        assert body["expertise"] == [{"area": "Chemistry", "level": 60}]

    def test_blank_expertise_rows_are_dropped(self, client, staff_headers) -> None:
        """The form's "Add expertise area" seeds an empty row. Saving with one still open
        must not store a nameless bar on the profile."""
        tag = uuid.uuid4().hex[:6].upper()
        resp = client.post(
            TEACHERS,
            headers=staff_headers,
            json={
                "staff_number": f"STF{tag}",
                "full_name": "Empty Row Eddie",
                "expertise": [{"area": "Biology", "level": 50}, {"area": "   ", "level": 70}],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["teacher"]["expertise"] == [{"area": "Biology", "level": 50}]

    def test_minimal_create_still_works(self, client, staff_headers) -> None:
        """Everything D40 added is OPTIONAL. `gender` especially: the column is nullable
        and every lecturer created before D39 holds NULL, so demanding it on the wire would
        be stricter than the records already on file."""
        tag = uuid.uuid4().hex[:6].upper()
        resp = client.post(
            TEACHERS,
            headers=staff_headers,
            json={"staff_number": f"STF{tag}", "full_name": "Minimal Mo"},
        )
        assert resp.status_code == 201, resp.text
        teacher = resp.json()["teacher"]
        assert teacher["gender"] is None
        assert teacher["expertise"] == []

    def test_bad_licence_is_still_rejected_on_create(self, client, staff_headers) -> None:
        """`LICENSE_PATTERN` applied to the create body, not only the update one."""
        tag = uuid.uuid4().hex[:6].upper()
        resp = client.post(
            TEACHERS,
            headers=staff_headers,
            json={
                "staff_number": f"STF{tag}",
                "full_name": "Bad Licence Bo",
                "licensenum": "OWD/2019/00035",
            },
        )
        assert resp.status_code == 422, resp.text


# ════════════════════════════════════════════════════════════════════════════
class TestAdmissionsPathFolds:
    """The application form writes the same two columns, and acceptance COPIES them.

    This is the half that matters most. `gender` needed the fold in two places for exactly
    this reason (see `accept_application`): an application written before the dropdown
    shipped still holds whatever was typed, and copying it verbatim is what spreads the
    drift into the register — where it becomes a blank `<select>` on the student form.
    """

    def test_create_application_folds_civil_status(self, client, graph) -> None:
        r = client.post(
            "/api/v1/applications",
            headers=graph.S,
            json={"first_name": "Ada", "last_name": f"Fold{graph.tag}", "civil_status": "single"},
        )
        assert r.status_code == 201, r.text
        assert r.json()["civil_status"] == "Single"

    def test_patch_application_folds_civil_status(self, client, graph) -> None:
        app_id = client.post(
            "/api/v1/applications",
            headers=graph.S,
            json={"first_name": "Bea", "last_name": f"Fold{graph.tag}"},
        ).json()["id"]
        r = client.patch(
            f"/api/v1/applications/{app_id}",
            headers=graph.S,
            json={"civil_status": "  WIDOWED "},
        )
        assert r.status_code == 200, r.text
        assert r.json()["civil_status"] == "Widow(er)"

    def test_acceptance_folds_a_legacy_value_onto_the_student(
        self, client, graph, db_session
    ) -> None:
        """The application row is written round the API, the way a pre-D40 row exists.

        Going through PATCH would fold it on the way in and the copy would never be
        tested — the assertion would pass for the wrong reason.
        """
        from app.modules.admissions.models import Application

        app_id = _file(client, graph, submit=True).json()["id"]
        row = db_session.get(Application, uuid.UUID(app_id))
        row.civil_status = "married"  # pre-D40 spelling, straight into the column
        db_session.flush()

        r = client.post(f"/api/v1/applications/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 201, r.text

        student = client.get(
            f"{STUDENTS}/{r.json()['student_id']}", headers=graph.S
        ).json()
        assert student["civil_status"] == "Married"

    def test_acceptance_keeps_a_value_the_vocabulary_does_not_carry(
        self, client, graph, db_session
    ) -> None:
        from app.modules.admissions.models import Application

        app_id = _file(client, graph, submit=True).json()["id"]
        row = db_session.get(Application, uuid.UUID(app_id))
        row.civil_status = "Common law"
        db_session.flush()

        r = client.post(f"/api/v1/applications/{app_id}/accept", headers=graph.S, json={})
        assert r.status_code == 201, r.text
        student = client.get(
            f"{STUDENTS}/{r.json()['student_id']}", headers=graph.S
        ).json()
        assert student["civil_status"] == "Common law"

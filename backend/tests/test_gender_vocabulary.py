"""One canonical gender vocabulary (D37).

The client asked for gender to be a dropdown. Auditing the live database first turned up
why it mattered: **both** `student_profiles` and `applications` held a capitalised `'Male'`
beside 45 lowercase rows, and `admissions.accept` copied the application's value onto the
student **verbatim**.

Nothing had reported it, and the reason is worth remembering: under
`utf8mb4_uca1400_ai_ci` the collation is case-insensitive, so

  * `WHERE gender = 'male'` MATCHES `'Male'` — the directory filter kept working;
  * `GROUP BY gender` COLLAPSES the two into one group and reports whichever it saw
    first — so the obvious diagnostic query actively hid the drift. It took
    `GROUP BY HEX(gender)` to see it.

The breakage was in the browser, where comparisons are case-sensitive: a `<select>` whose
value is not among its options renders BLANK (and a save then clears the field), and
`gender === 'female' ? 'Female' : 'Male'` labels a stored `'Female'` as "Male".

So the columns stay free text — they must, for rows this system did not write — and the
WRITE PATH is what is constrained. This suite pins that.
"""

from __future__ import annotations

import pytest

from tests.conftest import issued_login_email

from app.common.enums import Gender, normalise_gender
from tests.test_admissions import A, _file, graph  # noqa: F401 — reuse the admissions graph

pytestmark = pytest.mark.requires_db

S = "/api/v1/students"


# ════════════════════════════════════════════════════════════════════════════
class TestTheNormaliser:
    """Pure function — no database, no app."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("female", "female"),
            ("male", "male"),
            # The exact drift found in live data.
            ("Male", "male"),
            ("Female", "female"),
            ("MALE", "male"),
            ("FEMALE", "female"),
            # Whitespace, because a transcribed paper form carries it.
            ("  male  ", "male"),
            ("\tFemale\n", "female"),
            # Single letters and words a Registrar might type.
            ("F", "female"),
            ("m", "male"),
            ("Woman", "female"),
            ("boy", "male"),
        ],
    )
    def test_it_folds_onto_the_canonical_pair(self, raw, expected) -> None:
        assert normalise_gender(raw) == expected

    @pytest.mark.parametrize("blank", [None, "", "   ", "\t\n"])
    def test_blank_becomes_none(self, blank) -> None:
        """Gender is optional on both forms, and an empty string is not a value —
        storing `''` would make "not recorded" and "recorded as nothing" indistinguishable."""
        assert normalise_gender(blank) is None

    def test_an_unrecognised_value_passes_THROUGH_unchanged(self) -> None:
        """Deliberately permissive, not a 422.

        This runs on every write, including the admissions transcription path. Rejecting an
        unexpected spelling would stop a Registrar recording a real student over something
        cosmetic — and there is no safe way to guess what an unknown value meant. The
        dropdowns keep new data clean; this is the net under them.
        """
        assert normalise_gender("Non-binary") == "Non-binary"
        assert normalise_gender("Prefer not to say") == "Prefer not to say"

    def test_it_returns_a_PLAIN_STR_not_the_enum_member(self) -> None:
        """`Gender` subclasses `str`, but from Python 3.11 `str(Gender.MALE)` is
        `'Gender.MALE'`. These are plain `varchar` columns, not `enum_col`, so handing the
        member to one risks storing that literal the moment anything stringifies it.
        """
        result = normalise_gender("Male")
        assert type(result) is str, f"got {type(result).__name__}"
        assert result == "male"
        # The trap this guards, stated explicitly so it cannot be "simplified" back.
        assert str(Gender.MALE) == "Gender.MALE"

    def test_the_canonical_values_are_lowercase(self) -> None:
        assert [g.value for g in Gender] == ["female", "male"]


# ════════════════════════════════════════════════════════════════════════════
class TestTheStudentWritePath:
    @pytest.fixture
    def H(self, make_user, auth_headers):
        from app.common.enums import Role

        return auth_headers(user_id=make_user(role=Role.SECRETARY).id, role=Role.SECRETARY)

    def _create(self, client, H, **extra):
        return client.post(
            S,
            headers=H,
            json={
                "first_name": "Ana",
                "last_name": "Perez",
                "date_of_birth": "2008-04-11",
                "enrollment_date": "2026-01-12",
                **extra,
            },
        )

    @pytest.mark.parametrize("raw", ["Male", "MALE", " male "])
    def test_create_stores_the_canonical_value(self, client, H, raw) -> None:
        resp = self._create(client, H, gender=raw)
        assert resp.status_code == 201, resp.text
        assert resp.json()["gender"] == "male"

    def test_the_canonical_value_reaches_the_COLUMN(self, client, H, db_session) -> None:
        """Read off the row, not the response: a value the response echoes from the
        request but never persists would pass the assertion above."""
        from sqlalchemy import select

        from app.modules.students.models import StudentProfile

        student_id = self._create(client, H, gender="FEMALE").json()["id"]
        db_session.expire_all()
        row = db_session.scalar(
            select(StudentProfile).where(StudentProfile.id == student_id)
        )
        assert row is not None
        assert row.gender == "female"

    def test_patch_normalises_too(self, client, H) -> None:
        student_id = self._create(client, H, gender="female").json()["id"]
        body = client.patch(f"{S}/{student_id}", headers=H, json={"gender": "Male"}).json()
        assert body["gender"] == "male"

    def test_an_omitted_gender_stays_null(self, client, H) -> None:
        assert self._create(client, H).json()["gender"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestTheAcceptanceCopy:
    """The path that actually spread the drift.

    `admissions.accept` copies the application's gender onto the new student. Applications
    written before D37 still hold whatever was typed, so normalising only on the write
    would leave the register exposed the next time one of those is accepted. Driven
    END-TO-END through the real endpoints rather than by calling the normaliser again.
    """

    def test_a_legacy_application_value_lands_CANONICAL_on_the_student(
        self, client, graph, db_session
    ) -> None:
        import uuid as _uuid

        from sqlalchemy import select

        from app.modules.admissions.models import Application
        from app.modules.students.models import StudentProfile

        app_id = _file(client, graph, submit=True).json()["id"]

        # Force the pre-D37 state: a capitalised value written straight to the row, which
        # is exactly how the two live rows looked. Going through PATCH would normalise it
        # and the test would prove nothing.
        row = db_session.scalar(
            select(Application).where(Application.id == _uuid.UUID(app_id))
        )
        assert row is not None
        row.gender = "Male"
        db_session.flush()

        accepted = client.post(
            f"{A}/{app_id}/accept",
            headers=graph.S,
            json={"login_email": issued_login_email()},
        )
        assert accepted.status_code == 201, accepted.text

        student = db_session.get(
            StudentProfile, _uuid.UUID(accepted.json()["student_id"])
        )
        assert student is not None
        assert student.gender == "male", (
            "acceptance copied the application's capitalisation into the register"
        )

    def test_an_ordinary_application_is_unaffected(self, client, graph, db_session) -> None:
        """The contrast case, so the assertion above is about normalisation and not about
        acceptance overwriting gender with a constant."""
        import uuid as _uuid

        from app.modules.students.models import StudentProfile

        app_id = _file(client, graph, submit=True, gender="female").json()["id"]
        accepted = client.post(
            f"{A}/{app_id}/accept",
            headers=graph.S,
            json={"login_email": issued_login_email()},
        )
        assert accepted.status_code == 201, accepted.text
        student = db_session.get(
            StudentProfile, _uuid.UUID(accepted.json()["student_id"])
        )
        assert student is not None
        assert student.gender == "female"

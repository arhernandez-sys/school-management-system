"""Human-ID allocation — `YYYYMM###` and `APP-YYYY-NNNNN` (D46 / D44; was D30 §D9).

⚠️ D46 (client, Oct 2026): the STUDENT ID is `YYYYMM###` — no dash, year + month + three
digits, the month being the ENROLLMENT month. That reverses the D44 student half described
below; applications keep D44's `APP-YYYY-NNNNN`.

Oracle: `app/common/numbering.py` and `docs/d44-sims10-and-meeting3.md`.

D44 changed both halves of what this file used to assert. The student format went from
`YYYYMM###` to `YYYY-NNNNN` — the month left the key and the sequence grew to five digits
— and applications gained a generated reference of their own, `APP-YYYY-NNNNN`, where
before they had only a uuid. The counter table went with them: `student_number_sequences`
(`year_month char(6)` PK) became `number_sequences(scope, seq_key, last_seq)`, so ONE
allocator serves both.

The three properties that have to hold are unchanged, because they were never about the
format:

  1. FORMAT — the SCHOOL-LOCAL year plus a zero-padded 5-digit sequence. Using UTC would
     open next year's sequence a day early every 31 December, because Belize is UTC-6 and
     18:00 local is already tomorrow in UTC.

  2. MONOTONICITY — consecutive allocations in one year never repeat, a new year restarts
     at 00001 without disturbing the old one, and the two SCOPES do not interfere.

  3. CONCURRENCY — two simultaneous registrations cannot be handed the same number. This
     is the one a `SELECT MAX(...) + 1` implementation always fails, and it is the reason
     allocation is an `INSERT … ON DUPLICATE KEY UPDATE`.

Hermetic: every test runs inside the rolled-back `db_session`, so no sequence row
survives. The concurrency test opens a SECOND connection deliberately — see its docstring
for why that still commits nothing.
"""

from __future__ import annotations

import re
from datetime import date

import pytest
from sqlalchemy import text

from app.common.enums import StudentStatus
from app.common.numbering import (
    SCOPE_APPLICATION,
    SCOPE_STUDENT,
    allocate_application_number,
    allocate_student_number,
    month_key,
    year_key,
)
from app.core.errors import Conflict
from app.modules.admissions.models import Application
from app.modules.students.models import StudentProfile

# SQLAlchemy resolves string FK references at flush time against whatever is registered
# in the metadata. The tests below that insert a StudentProfile or an Application use only
# `db_session` — no `client`/`app` fixture to import the whole model graph for them — so
# the graph has to be imported here or the flush fails with NoReferencedTableError.
#
# D44 widened this from a bare `users` import: `Application` reaches `programs` and
# `academic_years` as well, and chasing FK targets one import at a time is how the list
# ends up incomplete again next time.
import app.db.models  # noqa: F401

pytestmark = pytest.mark.requires_db

#: A year no real record uses, so a test asserting "the first number of the year is
#: 00001" is not competing with the 46 students and the backfilled applications that live
#: on the CURRENT year. Allocation deliberately steps over taken numbers (see
#: `test_it_skips_a_number_already_taken_by_a_legacy_id`), which is correct behaviour and
#: exactly what makes an exact-value assertion on a populated year meaningless.
ISOLATED = date(2099, 6, 1)
ISOLATED_KEY = "2099"
#: The student counter's bucket for `ISOLATED` — students are keyed by MONTH (D46).
ISOLATED_MONTH = "209906"

#: `YYYYMM###` — six digits of year and month, then exactly three. No dash.
STUDENT_RE = re.compile(r"^\d{6}\d{3}$")
#: `APP-YYYY-NNNNN`.
APPLICATION_RE = re.compile(r"^APP-\d{4}-\d{5}$")


def _clear(db_session, scope: str, key: str) -> None:
    """Drop the counter row so a test starts from a known 0.

    Rolled back with everything else; this only isolates tests from each other and
    from whatever the demo database happens to hold.
    """
    db_session.execute(
        text("DELETE FROM number_sequences WHERE scope = :s AND seq_key = :k"),
        {"s": scope, "k": key},
    )


def _occupy(db_session, number: str) -> None:
    """Park a live student on `number`, so allocation has to step over it."""
    student = StudentProfile(
        student_number=number,
        first_name="Legacy",
        last_name="Holder",
        date_of_birth=date(2007, 1, 1),
        enrollment_date=date(2025, 9, 1),
        status=StudentStatus.ACTIVE,
    )
    db_session.add(student)
    db_session.flush()


def _occupy_application(db_session, number: str) -> None:
    """Park an application on `number`."""
    db_session.add(
        Application(application_number=number, first_name="Taken", last_name="Already")
    )
    db_session.flush()


class TestFormat:
    def test_year_key_uses_the_school_calendar_not_utc(self) -> None:
        """`year_key()` reads `school_today()`.

        Asserted through an explicit date rather than by freezing the clock: the
        contract is "the year of the date you give it", and the caller supplying no
        date is what routes it through the school timezone.
        """
        assert year_key(date(2026, 8, 16)) == "2026"
        assert year_key(date(2026, 1, 1)) == "2026"
        assert year_key(date(2026, 12, 31)) == "2026"
        assert year_key(date(2027, 1, 1)) == "2027"

    def test_year_key_defaults_to_today(self) -> None:
        assert re.fullmatch(r"\d{4}", year_key())

    def test_month_key_is_year_and_month(self) -> None:
        assert month_key(date(2026, 8, 16)) == "202608"
        assert month_key(date(2026, 1, 1)) == "202601"
        assert month_key(date(2026, 12, 31)) == "202612"

    def test_student_number_matches_the_documented_shape(self, db_session) -> None:
        _clear(db_session, SCOPE_STUDENT, ISOLATED_MONTH)
        number = allocate_student_number(db_session, on=ISOLATED)
        assert STUDENT_RE.match(number), number
        assert number == f"{ISOLATED_MONTH}001"
        assert "-" not in number

    def test_application_number_matches_the_documented_shape(self, db_session) -> None:
        """⚠️ Uses `ISOLATED`, not the current year, and that is load-bearing.

        It used to clear the counter for the LIVE year and allocate against it. That
        works only while the live year holds fewer applications than `_MAX_ATTEMPTS`:
        resetting the counter to 0 makes the allocator retry `00001`, `00002`, … over
        numbers that already exist, and it gives up after five. The register reached five
        applications for 2026 on 10 Sep 2026 and this test began failing on data alone,
        having never been about the live year in the first place.

        The module already keeps `ISOLATED` for exactly this — see its note."""
        _clear(db_session, SCOPE_APPLICATION, ISOLATED_KEY)
        number = allocate_application_number(db_session, on=ISOLATED)
        assert APPLICATION_RE.match(number), number
        assert number.startswith(f"APP-{ISOLATED_KEY}-")

    def test_the_clients_worked_examples(self, db_session) -> None:
        """`202603012` is the twelfth student enrolled in March 2026 (D46);
        `APP-2026-00125` the hundred-and-twenty-fifth application of 2026 (D44).

        Asserted literally, because a format is exactly the kind of thing where everyone
        agrees in prose and disagrees by one zero — or one dash.
        """
        on = date(2026, 3, 1)
        _clear(db_session, SCOPE_STUDENT, "202603")
        _clear(db_session, SCOPE_APPLICATION, "2026")

        db_session.execute(
            text(
                "INSERT INTO number_sequences (scope, seq_key, last_seq) "
                "VALUES (:s, '202603', 11)"
            ),
            {"s": SCOPE_STUDENT},
        )
        assert allocate_student_number(db_session, on=on) == "202603012"

        db_session.execute(
            text(
                "INSERT INTO number_sequences (scope, seq_key, last_seq) "
                "VALUES (:s, '2026', 124)"
            ),
            {"s": SCOPE_APPLICATION},
        )
        assert allocate_application_number(db_session, on=on) == "APP-2026-00125"


class TestMonotonicity:
    def test_consecutive_allocations_increment(self, db_session) -> None:
        key = ISOLATED_MONTH
        _clear(db_session, SCOPE_STUDENT, key)
        issued = [
            allocate_student_number(db_session, on=ISOLATED) for _ in range(5)
        ]
        assert issued == [f"{key}{n:03d}" for n in range(1, 6)]
        assert len(set(issued)) == 5

    def test_sequence_is_zero_padded_to_three_digits(self, db_session) -> None:
        """`###`, not `#`. A run of 9 then 10 must not sort as "10" before "9"."""
        key = ISOLATED_MONTH
        _clear(db_session, SCOPE_STUDENT, key)
        db_session.execute(
            text(
                "INSERT INTO number_sequences (scope, seq_key, last_seq) "
                "VALUES (:s, :k, 8)"
            ),
            {"s": SCOPE_STUDENT, "k": key},
        )
        assert allocate_student_number(db_session, on=ISOLATED) == f"{key}009"
        assert allocate_student_number(db_session, on=ISOLATED) == f"{key}010"

    def test_a_new_month_restarts_at_001_and_leaves_the_old_one_alone(
        self, db_session
    ) -> None:
        """D46 — the month IS part of the key again. Under D44's `YYYY-NNNNN` these
        were consecutive; now each enrollment month has its own `###`."""
        aug, sep = date(2099, 8, 5), date(2099, 9, 5)
        _clear(db_session, SCOPE_STUDENT, "209908")
        _clear(db_session, SCOPE_STUDENT, "209909")

        assert allocate_student_number(db_session, on=aug) == "209908001"
        assert allocate_student_number(db_session, on=aug) == "209908002"
        assert allocate_student_number(db_session, on=sep) == "209909001"
        # August's counter is untouched by September's traffic.
        assert allocate_student_number(db_session, on=aug) == "209908003"

    def test_the_month_bucket_holds_999_and_then_refuses(self, db_session) -> None:
        """`###` is three digits. A 1000th enrolment in one month is refused rather than
        silently widening the format to ten characters."""
        key = ISOLATED_MONTH
        _clear(db_session, SCOPE_STUDENT, key)
        db_session.execute(
            text(
                "INSERT INTO number_sequences (scope, seq_key, last_seq) "
                "VALUES (:s, :k, 998)"
            ),
            {"s": SCOPE_STUDENT, "k": key},
        )
        assert allocate_student_number(db_session, on=ISOLATED) == f"{key}999"
        with pytest.raises(Conflict) as exc:
            allocate_student_number(db_session, on=ISOLATED)
        assert exc.value.code == "student_number_exhausted"

    def test_the_two_scopes_do_not_share_a_counter(self, db_session) -> None:
        """One table, independent sequences. Sharing a row would make the first
        application of the year `APP-2026-00047` because 46 students were registered."""
        _clear(db_session, SCOPE_STUDENT, ISOLATED_MONTH)
        _clear(db_session, SCOPE_APPLICATION, ISOLATED_KEY)

        s1 = allocate_student_number(db_session, on=ISOLATED)
        s2 = allocate_student_number(db_session, on=ISOLATED)
        assert [s1, s2] == [f"{ISOLATED_MONTH}001", f"{ISOLATED_MONTH}002"]
        # The application counter has seen no traffic and starts at 1 regardless.
        assert (
            allocate_application_number(db_session, on=ISOLATED)
            == f"APP-{ISOLATED_KEY}-00001"
        )
        assert allocate_student_number(db_session, on=ISOLATED) == f"{ISOLATED_MONTH}003"

    def test_it_skips_a_number_already_taken_by_a_legacy_id(self, db_session) -> None:
        """The live database carries hand-entered `S-25001`-style numbers and pre-D44
        `YYYYMM###` ones, either of which could collide with the generated range. The
        unique index would reject the insert; allocation moves on instead of failing the
        registration."""
        key = ISOLATED_MONTH
        _clear(db_session, SCOPE_STUDENT, key)
        _occupy(db_session, f"{key}001")

        assert allocate_student_number(db_session, on=ISOLATED) == f"{key}002"

    def test_application_allocation_also_steps_over_a_taken_number(
        self, db_session
    ) -> None:
        key = ISOLATED_KEY
        _clear(db_session, SCOPE_APPLICATION, key)
        _occupy_application(db_session, f"APP-{key}-00001")

        assert (
            allocate_application_number(db_session, on=ISOLATED)
            == f"APP-{key}-00002"
        )

    def test_it_gives_up_rather_than_looping_forever(self, db_session) -> None:
        """Five collisions in a row is not a retry situation, it is a broken
        assumption — so it surfaces as a 409 instead of spinning."""
        key = ISOLATED_MONTH
        _clear(db_session, SCOPE_STUDENT, key)
        for i in range(1, 6):
            _occupy(db_session, f"{key}{i:03d}")

        with pytest.raises(Conflict) as exc:
            allocate_student_number(db_session, on=ISOLATED)
        assert exc.value.code == "student_number_exhausted"

    def test_application_allocation_gives_up_too(self, db_session) -> None:
        key = ISOLATED_KEY
        _clear(db_session, SCOPE_APPLICATION, key)
        for i in range(1, 6):
            _occupy_application(db_session, f"APP-{key}-{i:05d}")

        with pytest.raises(Conflict) as exc:
            allocate_application_number(db_session, on=ISOLATED)
        assert exc.value.code == "application_number_exhausted"


class TestConcurrency:
    def test_a_second_transaction_cannot_allocate_while_the_first_holds_the_row(
        self, _engine, db_session
    ) -> None:
        """The heart of D9, unchanged by D44: the `INSERT … ON DUPLICATE KEY UPDATE`
        row lock.

        Two REAL connections are needed — a lock is invisible from inside the
        transaction that holds it, so this cannot be shown with `db_session` alone.
        Nothing is committed: the first session is the suite's rolled-back one, and
        the second is rolled back explicitly in the `finally`.

        `innodb_lock_wait_timeout = 1` turns "blocks forever" into a fast, assertable
        error. A lock-wait timeout here is the PASS condition — it is the proof that
        the second registration was made to wait rather than being handed the same
        number.
        """
        from sqlalchemy.exc import OperationalError
        from sqlalchemy.orm import Session

        key = ISOLATED_MONTH
        _clear(db_session, SCOPE_STUDENT, key)

        # takes and holds the row lock
        first = allocate_student_number(db_session, on=ISOLATED)
        assert first == f"{key}001"

        other = Session(bind=_engine)
        try:
            other.execute(text("SET SESSION innodb_lock_wait_timeout = 1"))
            with pytest.raises(OperationalError) as exc:
                allocate_student_number(other, on=ISOLATED)
            # 1205 = ER_LOCK_WAIT_TIMEOUT.
            assert "1205" in str(exc.value) or "Lock wait timeout" in str(exc.value)
        finally:
            other.rollback()
            other.close()


class TestCreateStudentIntegration:
    def test_omitting_the_number_issues_one(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        from app.common.enums import Role

        # D46 — the number takes the ENROLLMENT month, not today's.
        key = "209911"
        _clear(db_session, SCOPE_STUDENT, key)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            "/api/v1/students",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "first_name": "Presley",
                "last_name": "Rancharan",
                "date_of_birth": "2007-05-05",
                "enrollment_date": "2099-11-24",
            },
        )
        assert resp.status_code == 201, resp.text
        assert STUDENT_RE.match(resp.json()["student_number"]), resp.json()
        assert resp.json()["student_number"] == f"{key}001"

    def test_a_supplied_number_is_still_honoured(
        self, client, make_user, auth_headers
    ) -> None:
        """Importing a student who already carries a number must stay possible —
        generation is a default, not a policy that overwrites history. This is also what
        keeps the 45 legacy `S-25xxx` students valid after D44."""
        import uuid

        from app.common.enums import Role

        principal = make_user(role=Role.PRINCIPAL)
        supplied = f"LEGACY-{uuid.uuid4().hex[:8]}"
        resp = client.post(
            "/api/v1/students",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "student_number": supplied,
                "first_name": "Legacy",
                "last_name": "Student",
                "date_of_birth": "2007-05-05",
                "enrollment_date": "2026-08-24",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["student_number"] == supplied


class TestCreateApplicationIntegration:
    def test_filing_an_application_issues_a_number(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Every application gets its reference at CREATE — a draft included. The number
        is what the Registrar quotes on the phone, and that call happens long before
        anybody decides anything."""
        from app.common.enums import Role

        # ⚠️ The counter is deliberately NOT cleared. This test files through the real
        # endpoint, so the allocator runs on TODAY and cannot be pointed at `ISOLATED`.
        # Resetting the counter to 0 made it retry numbers the register already holds and
        # exhaust after `_MAX_ATTEMPTS`; letting the real counter continue is both
        # realistic and the only thing that works on a populated database. Nothing here
        # asserts an exact number — only the shape and the year prefix.
        key = year_key()
        registrar = make_user(role=Role.SECRETARY)
        resp = client.post(
            "/api/v1/applications",
            headers=auth_headers(user_id=registrar.id, role=Role.SECRETARY),
            json={"first_name": "Ana", "last_name": "Choc"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "draft"
        assert APPLICATION_RE.match(body["application_number"]), body
        assert body["application_number"].startswith(f"APP-{key}-")

"""Student-ID allocation — `YYYYMM###` (D30 §D9, brief §10).

Oracle: `docs/tertiary-refactor-plan.md` §D9 and `app/modules/students/numbering.py`.

Before D30 there was no generation logic at all: `student_number` came from the
client and was only checked for uniqueness. Three properties have to hold now, and
each of them is a thing that has gone wrong in real systems:

  1. FORMAT — `YYYYMM` of the SCHOOL-LOCAL month plus a zero-padded 3-digit sequence.
     Using UTC would open next month's sequence a day early every month, because
     Belize is UTC-6 and 18:00 local is already tomorrow in UTC.

  2. MONOTONICITY — consecutive allocations in one month never repeat, and a new
     month restarts at 001 without disturbing the old one.

  3. CONCURRENCY — two simultaneous registrations cannot be handed the same number.
     This is the one a `SELECT MAX(...) + 1` implementation always fails, and it is
     the reason allocation is an `INSERT … ON DUPLICATE KEY UPDATE`.

Hermetic: every test runs inside the rolled-back `db_session`, so no sequence row
survives. The concurrency test opens a SECOND connection deliberately — see its
docstring for why that still commits nothing.
"""

from __future__ import annotations

import re
from datetime import date

import pytest
from sqlalchemy import text

from app.common.enums import StudentStatus
from app.core.errors import Conflict
from app.modules.students.models import StudentProfile
from app.modules.students.numbering import (
    allocate_student_number,
    year_month,
)

# `student_profiles.created_by` FKs to `users`, and SQLAlchemy resolves that string
# reference at flush time against whatever is registered in the metadata. The tests
# below that insert a StudentProfile use only `db_session` — no `client`/`app`
# fixture to import the whole model graph for them — so `users` has to be imported
# here or the flush fails with NoReferencedTableError.
from app.modules.users.models import User  # noqa: F401

pytestmark = pytest.mark.requires_db

#: `YYYYMM###` — exactly 9 digits, month in 01–12.
NUMBER_RE = re.compile(r"^\d{4}(0[1-9]|1[0-2])\d{3}$")


def _clear(db_session, ym: str) -> None:
    """Drop the counter row so a test starts from a known 000.

    Rolled back with everything else; this only isolates tests from each other and
    from whatever the demo database happens to hold.
    """
    db_session.execute(
        text("DELETE FROM student_number_sequences WHERE `year_month` = :ym"), {"ym": ym}
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


class TestFormat:
    def test_year_month_uses_the_school_calendar_not_utc(self) -> None:
        """`year_month()` reads `school_today()`.

        Asserted through an explicit date rather than by freezing the clock: the
        contract is "the month of the date you give it", and the caller supplying
        no date is what routes it through the school timezone.
        """
        assert year_month(date(2026, 8, 16)) == "202608"
        assert year_month(date(2026, 1, 1)) == "202601"
        assert year_month(date(2026, 12, 31)) == "202612"

    def test_year_month_defaults_to_today(self) -> None:
        assert re.fullmatch(r"\d{6}", year_month())

    def test_allocated_number_matches_the_documented_shape(self, db_session) -> None:
        ym = year_month()
        _clear(db_session, ym)
        number = allocate_student_number(db_session)
        assert NUMBER_RE.match(number), number
        assert number.startswith(ym)
        assert len(number) == 9


class TestMonotonicity:
    def test_consecutive_allocations_increment(self, db_session) -> None:
        ym = year_month()
        _clear(db_session, ym)
        issued = [allocate_student_number(db_session) for _ in range(5)]
        assert issued == [f"{ym}001", f"{ym}002", f"{ym}003", f"{ym}004", f"{ym}005"]
        assert len(set(issued)) == 5

    def test_sequence_is_zero_padded_to_three_digits(self, db_session) -> None:
        """`###`, not `#`. A run of 9 then 10 must not sort as "10" before "9"."""
        ym = year_month()
        _clear(db_session, ym)
        db_session.execute(
            text(
                "INSERT INTO student_number_sequences (`year_month`, last_seq) "
                "VALUES (:ym, 8)"
            ),
            {"ym": ym},
        )
        assert allocate_student_number(db_session) == f"{ym}009"
        assert allocate_student_number(db_session) == f"{ym}010"

    def test_a_new_month_restarts_at_001_and_leaves_the_old_one_alone(
        self, db_session
    ) -> None:
        august, september = date(2026, 8, 5), date(2026, 9, 5)
        _clear(db_session, year_month(august))
        _clear(db_session, year_month(september))

        assert allocate_student_number(db_session, on=august) == "202608001"
        assert allocate_student_number(db_session, on=august) == "202608002"
        assert allocate_student_number(db_session, on=september) == "202609001"
        # August's counter is untouched by September's traffic.
        assert allocate_student_number(db_session, on=august) == "202608003"

    def test_it_skips_a_number_already_taken_by_a_legacy_id(self, db_session) -> None:
        """The demo database carries hand-entered `S-25001`-style numbers, and a
        migrated school could easily hold one that collides with the generated range.
        The partial-unique index would reject the insert; allocation moves on instead
        of failing the registration."""
        ym = year_month()
        _clear(db_session, ym)
        _occupy(db_session, f"{ym}001")

        assert allocate_student_number(db_session) == f"{ym}002"

    def test_it_gives_up_rather_than_looping_forever(self, db_session) -> None:
        """Five collisions in a row is not a retry situation, it is a broken
        assumption — so it surfaces as a 409 instead of spinning."""
        ym = year_month()
        _clear(db_session, ym)
        for i in range(1, 6):
            _occupy(db_session, f"{ym}{i:03d}")

        with pytest.raises(Conflict) as exc:
            allocate_student_number(db_session)
        assert exc.value.code == "student_number_exhausted"


class TestConcurrency:
    def test_a_second_transaction_cannot_allocate_while_the_first_holds_the_row(
        self, _engine, db_session
    ) -> None:
        """The heart of D9: the `INSERT … ON DUPLICATE KEY UPDATE` row lock.

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

        ym = year_month()
        _clear(db_session, ym)

        first = allocate_student_number(db_session)  # takes and holds the row lock
        assert first == f"{ym}001"

        other = Session(bind=_engine)
        try:
            other.execute(text("SET SESSION innodb_lock_wait_timeout = 1"))
            with pytest.raises(OperationalError) as exc:
                allocate_student_number(other)
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

        ym = year_month()
        _clear(db_session, ym)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            "/api/v1/students",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "first_name": "Presley",
                "last_name": "Rancharan",
                "date_of_birth": "2007-05-05",
                "enrollment_date": "2026-08-24",
            },
        )
        assert resp.status_code == 201, resp.text
        assert NUMBER_RE.match(resp.json()["student_number"]), resp.json()
        assert resp.json()["student_number"].startswith(ym)

    def test_a_supplied_number_is_still_honoured(
        self, client, make_user, auth_headers
    ) -> None:
        """Importing a student who already carries a number must stay possible —
        generation is a default, not a policy that overwrites history."""
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

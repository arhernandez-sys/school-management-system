"""Server-side `YYYYMM###` student-ID allocation (D30 §D9, brief §10).

WHY THIS EXISTS

    Before D30 there was no generation logic anywhere: `student_number` arrived from
    the client and the service only checked it for uniqueness. BAJC issues IDs in the
    form `YYYYMM###` — year and month of admission, then a three-digit sequence within
    that month (the sample report card's `2506842` is the older six-digit form; the
    brief specifies the new one).

HOW IT IS MADE SAFE

    One statement:

        INSERT INTO student_number_sequences (year_month, last_seq) VALUES (:ym, 1)
        ON DUPLICATE KEY UPDATE last_seq = last_seq + 1

    It runs inside the CALLER's transaction and does not commit. InnoDB holds the row
    lock on `year_month` until that transaction ends, so a second registration racing
    the first blocks on the lock and then reads the incremented value — it cannot
    observe the same number. `SELECT MAX(student_number) + 1` would have had exactly
    the race this avoids.

    `LAST_INSERT_ID()` is deliberately NOT used to read the value back. It is
    connection-scoped and only meaningful for AUTO_INCREMENT columns; this table has a
    natural `char(6)` primary key. The value is read back with a plain SELECT, which
    is safe precisely because the write above still holds the row lock.

    The partial-unique index on `student_number` remains the backstop. If a number is
    somehow taken anyway — a hand-entered ID that collided with the generated range,
    which is entirely possible on a database with legacy `S-25001`-style numbers — the
    allocation retries against the next sequence value rather than failing the
    registration.

    The month comes from `school_today()`, not UTC: after 18:00 Belize time on the last
    day of a month, `utcnow()` is already in the next month and would open the next
    month's sequence a day early.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.core.timeutil import school_today
from app.modules.students.models import StudentNumberSequence, StudentProfile

#: How many sequence values to burn through before giving up. A collision means the
#: number was already taken by a hand-entered legacy ID; more than a handful in a row
#: means something is wrong that a retry loop should not paper over.
_MAX_ATTEMPTS = 5


def year_month(on: date | None = None) -> str:
    """`YYYYMM` for the school-local month, e.g. `202608`."""
    day = on or school_today()
    return f"{day.year:04d}{day.month:02d}"


def _next_sequence(db: Session, ym: str) -> int:
    """Bump and return this month's counter. Takes the row lock; does not commit.

    Built with the MySQL dialect's `insert(...).on_duplicate_key_update(...)` rather
    than a `text()` string for one specific reason: **`YEAR_MONTH` is a RESERVED WORD
    in MariaDB** (it is an INTERVAL unit), so an unquoted `year_month` in raw SQL is a
    1064 syntax error. Letting the dialect render the identifier means the quoting is
    correct by construction instead of by remembering.
    """
    stmt = mysql_insert(StudentNumberSequence).values(year_month=ym, last_seq=1)
    db.execute(
        stmt.on_duplicate_key_update(
            last_seq=StudentNumberSequence.__table__.c.last_seq + 1
        )
    )
    seq = db.scalar(
        select(StudentNumberSequence.last_seq).where(
            StudentNumberSequence.year_month == ym
        )
    )
    return int(seq)


def allocate_student_number(db: Session, *, on: date | None = None) -> str:
    """Issue the next `YYYYMM###` for the school-local month.

    Call inside the transaction that creates the student, BEFORE the flush that
    inserts it — the sequence row and the student row then commit together, so a
    failed registration does not leave a number burnt.

    Raises `Conflict('student_number_exhausted')` if every one of `_MAX_ATTEMPTS`
    candidates is already taken.
    """
    ym = year_month(on)

    for _ in range(_MAX_ATTEMPTS):
        seq = _next_sequence(db, ym)
        candidate = f"{ym}{seq:03d}"

        taken = db.scalar(
            select(StudentProfile.id).where(
                StudentProfile.student_number == candidate,
                StudentProfile.deleted_at.is_(None),
            )
        )
        if taken is None:
            return candidate

    raise Conflict(
        "Could not allocate a student number for this month; the sequence collided "
        "with existing numbers repeatedly.",
        code="student_number_exhausted",
    )

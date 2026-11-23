"""Server-side allocation of the two human-readable IDs this system issues (D44).

    student_profiles.student_number   `YYYYMM###`       e.g. 202610012   (D46: back from YYYY-NNNNN)
    applications.application_number   `APP-YYYY-NNNNN`  e.g. APP-2026-00125

WHY THIS MODULE IS SHARED

    Both formats are a year and a zero-padded counter, and both need the counter to be
    safe against two people registering at the same instant. That safety argument is
    subtle enough (see below) that it should exist once. Before D44 it lived in
    `students/numbering.py` and served one caller; adding a second near-identical copy for
    applications is how the two would have drifted, and only one of them would have been
    the one that was reasoned about.

    So the counter table is `number_sequences(scope, seq_key, last_seq)` and the two
    public functions below are thin format-specific wrappers over one `_next_sequence`.

WHY BOTH FORMATS CHANGED (D44)

    Students were `YYYYMM###` — year, month, and three digits within that month. The
    client asked for a year-scoped five-digit number instead, so the month left the format
    and the sequence key went from `char(6)` to the year. The pre-D44 counters are kept
    under scope `student_ym` for provenance and are never allocated from again; the 46
    students who already have numbers keep them, legacy `S-25001` forms included.

    Applications had no human-readable ID at all — they were addressed by uuid, which is
    unusable over a telephone.

⚠️ STUDENTS WENT BACK TO `YYYYMM###` (D46, client, Oct 2026)

    The client confirmed the student ID is `YYYYMM###` — no dash, year + month + three
    digits — and that the month is the ENROLLMENT month. So the student scope allocates from
    `student_ym` again, the pre-D44 YYYYMM counters, which resumes them where they stopped
    rather than reissuing a number one of the 46 pre-D44 students already holds. The
    year-keyed `student` scope is now the retired one; nothing allocates from it, and the
    handful of `YYYY-NNNNN` numbers it issued are kept by the students who hold them.
    The month bucket holds 999; a 1000th enrolment in one month is refused rather than
    widening the format silently.

HOW IT IS MADE SAFE

    One statement:

        INSERT INTO number_sequences (scope, seq_key, last_seq) VALUES (:scope, :key, 1)
        ON DUPLICATE KEY UPDATE last_seq = last_seq + 1

    It runs inside the CALLER's transaction and does not commit. InnoDB holds the row
    lock on `(scope, seq_key)` until that transaction ends, so a second registration
    racing the first blocks on the lock and then reads the incremented value — it cannot
    observe the same number. `SELECT MAX(...) + 1` would have had exactly the race this
    avoids.

    `LAST_INSERT_ID()` is deliberately NOT used to read the value back. It is
    connection-scoped and only meaningful for AUTO_INCREMENT columns; this table has a
    natural composite primary key. The value is read back with a plain SELECT, which is
    safe precisely because the write above still holds the row lock.

    The unique index on each target column remains the backstop. If a number is somehow
    taken anyway — a hand-entered ID that collided with the generated range, which is
    entirely possible on a database carrying legacy `S-25001`-style numbers — the
    allocation retries against the next sequence value rather than failing the write.

    The year comes from `school_today()`, not UTC: after 18:00 Belize time on 31 December,
    `utcnow()` is already in the next year and would open the next year's sequence a day
    early.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.orm import Session

from app.common.models import NumberSequence
from app.core.errors import Conflict
from app.core.timeutil import school_today

#: How many sequence values to burn through before giving up. A collision means the
#: number was already taken by a hand-entered legacy ID; more than a handful in a row
#: means something is wrong that a retry loop should not paper over.
_MAX_ATTEMPTS = 5

#: `scope` values. D46 — students allocate from `student_ym` (keys `YYYYMM`) again, the
#: pre-D44 namespace `017_sims10_reconcile.sql` §1 carried across. The D44 year-keyed
#: `student` scope stays on disk for provenance and is never allocated from again.
SCOPE_STUDENT = "student_ym"
SCOPE_APPLICATION = "application"

#: `###` — the per-month counter is three digits wide.
_STUDENT_MONTH_CAPACITY = 999


def year_key(on: date | None = None) -> str:
    """`YYYY` for the school-local year, e.g. `2026`.

    School-local, not UTC — see the module docstring's last paragraph.
    """
    day = on or school_today()
    return f"{day.year:04d}"


def month_key(on: date | None = None) -> str:
    """`YYYYMM` for the school-local month, e.g. `202610`. School-local, not UTC."""
    day = on or school_today()
    return f"{day.year:04d}{day.month:02d}"


def _next_sequence(db: Session, scope: str, key: str) -> int:
    """Bump and return the counter for one `(scope, key)`. Takes the row lock; no commit.

    Built with the MySQL dialect's `insert(...).on_duplicate_key_update(...)` rather than
    a `text()` string so the identifiers are quoted by construction. That mattered
    literally before D44, when this table's key column was named `year_month` — a
    RESERVED WORD in MariaDB (it is an INTERVAL unit), so an unquoted reference was a 1064
    syntax error. The current names are unreserved; the reasoning is kept because the next
    column name might not be.
    """
    stmt = mysql_insert(NumberSequence).values(scope=scope, seq_key=key, last_seq=1)
    db.execute(
        stmt.on_duplicate_key_update(last_seq=NumberSequence.__table__.c.last_seq + 1)
    )
    seq = db.scalar(
        select(NumberSequence.last_seq).where(
            NumberSequence.scope == scope, NumberSequence.seq_key == key
        )
    )
    return int(seq)


def _allocate(
    db: Session,
    *,
    scope: str,
    on: date | None,
    fmt,
    taken,
    exhausted_code: str,
    exhausted_message: str,
    key_fn=year_key,
    capacity: int | None = None,
) -> str:
    """Shared allocate-and-retry loop. `fmt(key, seq)` builds the candidate; `taken(x)`
    says whether it is already in use; `key_fn(on)` picks the bucket the counter resets
    in; `capacity` is the largest sequence the format can hold."""
    key = key_fn(on)

    for _ in range(_MAX_ATTEMPTS):
        seq = _next_sequence(db, scope, key)
        if capacity is not None and seq > capacity:
            break
        candidate = fmt(key, seq)
        if not taken(candidate):
            return candidate

    raise Conflict(exhausted_message, code=exhausted_code)


def allocate_student_number(db: Session, *, on: date | None = None) -> str:
    """Issue the next `YYYYMM###` for the school-local month of `on` (D46).

    `on` is the ENROLLMENT date — the client's rule is that the student ID carries the
    month the student enrolled, not the month they were accepted.

    Call inside the transaction that creates the student, BEFORE the flush that inserts
    it — the sequence row and the student row then commit together, so a failed
    registration does not leave a number burnt.

    Raises `Conflict('student_number_exhausted')` if every one of `_MAX_ATTEMPTS`
    candidates is already taken.
    """
    # Imported here, not at module scope: `students.models` imports nothing from this
    # module, but `admissions.models` is in the same cycle and a top-level import of
    # either would make the registry order in `app/db/models.py` load-bearing.
    from app.modules.students.models import StudentProfile

    def _taken(candidate: str) -> bool:
        return (
            db.scalar(
                select(StudentProfile.id).where(
                    StudentProfile.student_number == candidate,
                    StudentProfile.deleted_at.is_(None),
                )
            )
            is not None
        )

    return _allocate(
        db,
        scope=SCOPE_STUDENT,
        on=on,
        fmt=lambda key, seq: f"{key}{seq:03d}",
        taken=_taken,
        exhausted_code="student_number_exhausted",
        exhausted_message=(
            "Could not allocate a student number for this month: either 999 have been "
            "issued already, or the sequence collided with existing numbers repeatedly."
        ),
        key_fn=month_key,
        capacity=_STUDENT_MONTH_CAPACITY,
    )


def allocate_application_number(db: Session, *, on: date | None = None) -> str:
    """Issue the next `APP-YYYY-NNNNN` for the school-local year.

    Call inside the transaction that creates the application, BEFORE the flush. Every
    application gets one at CREATE, drafts included: the number is what the Registrar
    reads back to an applicant on the phone, and that conversation happens long before
    anybody decides anything.

    A number is therefore burnt by an abandoned draft. That is the intended trade — a
    reference that only exists once the form is finished is not a reference you can quote
    while filling the form in.

    Unlike the student check this one does NOT exclude soft-deleted rows: a deleted
    application keeps its number, so reissuing it would let two applicants quote the same
    reference. Matches the plain UNIQUE index on the column.

    Raises `Conflict('application_number_exhausted')` if every one of `_MAX_ATTEMPTS`
    candidates is already taken.
    """
    from app.modules.admissions.models import Application

    def _taken(candidate: str) -> bool:
        return (
            db.scalar(
                select(Application.id).where(Application.application_number == candidate)
            )
            is not None
        )

    return _allocate(
        db,
        scope=SCOPE_APPLICATION,
        on=on,
        fmt=lambda key, seq: f"APP-{key}-{seq:05d}",
        taken=_taken,
        exhausted_code="application_number_exhausted",
        exhausted_message=(
            "Could not allocate an application number for this year; the sequence "
            "collided with existing numbers repeatedly."
        ),
    )

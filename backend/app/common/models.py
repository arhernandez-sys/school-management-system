"""Tables that belong to no single module.

Only one so far. A table lands here when two modules both need it and neither owns it —
putting `number_sequences` under `students/` would have made `admissions` import from a
module it has no other business in, and the reverse is just as arbitrary.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NumberSequence(Base):
    """Row-locked counters behind the generated human IDs (D44).

    One row per `(scope, seq_key)` — `('student', '2026')`, `('application', '2026')`.
    Allocation is a single `INSERT … ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`
    inside the caller's transaction: the row lock that statement takes is what makes two
    simultaneous registrations safe, which a `SELECT MAX(...) + 1` never would be. The
    full argument is in `app/common/numbering.py`.

    Replaces `student_number_sequences`, whose `year_month char(6)` primary key encoded
    the retired `YYYYMM###` format in the schema itself and could not express either a
    year-scoped counter or a second kind of number. That table is KEPT on disk (the 006
    convention) holding the provenance of every number issued before D44; its rows were
    copied here under scope `student_ym` and are never allocated from again.

    Created by `017_sims10_reconcile.sql` §1.

    `seq_key` is `varchar`, not an int year: the retired scope's keys are `YYYYMM`, and a
    future counter may not be year-shaped at all.
    """

    __tablename__ = "number_sequences"

    scope: Mapped[str] = mapped_column(String(20), primary_key=True)
    seq_key: Mapped[str] = mapped_column(String(10), primary_key=True)
    last_seq: Mapped[int] = mapped_column(
        Integer(), nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint("last_seq >= 0", name="ck_number_sequences_nonneg"),
    )

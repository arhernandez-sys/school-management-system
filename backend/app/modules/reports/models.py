"""Reports model (database-schema.md §3.G).

`report_card_snapshots` — a frozen, fully-rendered report-card payload.

**Two kinds since D32** (`kind`):

  * `endterm` — written when a YEAR ARCHIVES (`reports/freeze.freeze_academic_year`).
    This is the original behaviour and remains the default.
  * `midterm` — written when a TERM's mid-term grading window closes
    (`reports/freeze.freeze_midterm`), by the Dean's action or the lazy fallback on first
    read. This is what makes a mid-term report card historical rather than recalculated.

**The unique key had to widen for that.** It was `(student_id, semester_id)`, which assumes
one frozen card per student per term; the mid-term freeze and the year-archive freeze would
then have collided on upsert and the second would have silently overwritten the first —
destroying exactly the record the client asked to preserve. It is now
`(student_id, semester_id, kind)` (`009_midterm_windows.sql` §3).

**Until D32 nothing READ this table.** `freeze_academic_year` wrote it and
`reports/service` rebuilt archived cards from `term_grade_snapshots` instead, so the
payload — the one genuinely frozen artefact — was discarded on every read. The mid-term
report path is its first reader.

Live-year END-TERM report cards are still generated on read, not stored.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import ReportCardKind
from app.db.base import Base, TimestampMixin, uuid_pk
from app.db.types import GUID, JSONType, enum_col


class ReportCardSnapshot(Base, TimestampMixin):
    __tablename__ = "report_card_snapshots"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "student_profiles.id", ondelete="RESTRICT", name="fk_report_card_student"
        ),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_report_card_semester"),
        nullable=False,
    )
    #: D32 — which report this payload is. `endterm` is the DEFAULT because every row
    #: written before D32 came from the year-archive freeze, so it is the correct backfill
    #: as well as the correct default.
    kind: Mapped[ReportCardKind] = mapped_column(
        enum_col(ReportCardKind), nullable=False, server_default=text("'endterm'")
    )
    payload: Mapped[dict] = mapped_column(JSONType(), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(Text(), nullable=True)
    frozen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        # D32 widened this from (student_id, semester_id) — see the module docstring for
        # the collision it was allowing.
        Index(
            "uq_report_card_snapshot", "student_id", "semester_id", "kind", unique=True
        ),
    )

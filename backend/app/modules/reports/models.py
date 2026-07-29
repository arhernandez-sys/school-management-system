"""Reports model (database-schema.md §3.G).

`report_card_snapshots` — frozen, generated report-card payload (jsonb) written
when a year archives. Live-year report cards are generated on read (not stored).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk
from app.db.types import GUID, JSONType


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
    payload: Mapped[dict] = mapped_column(JSONType(), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(Text(), nullable=True)
    frozen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        Index("uq_report_card_snapshot", "student_id", "semester_id", unique=True),
    )

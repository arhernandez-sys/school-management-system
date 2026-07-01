"""Teacher domain models (database-schema.md §3.B).

`teacher_profiles` (staff record + linkage). `class_teachers` (the ownership
relation) lives in classes/ with the rest of the section/subject graph.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import TeacherStatus
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import pg_enum


class TeacherProfile(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "teacher_profiles"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_teacher_profiles_user"),
        nullable=True,
    )
    staff_number: Mapped[str] = mapped_column(Text(), nullable=False)
    full_name: Mapped[str] = mapped_column(Text(), nullable=False)
    email: Mapped[str | None] = mapped_column(CITEXT(), nullable=True)
    phone: Mapped[str | None] = mapped_column(Text(), nullable=True)
    status: Mapped[TeacherStatus] = mapped_column(
        pg_enum(TeacherStatus), nullable=False, server_default=text("'active'")
    )
    subject_specializations: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text()), nullable=True, server_default=text("'{}'")
    )

    __table_args__ = (
        Index(
            "uq_teacher_profiles_user",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "uq_teacher_profiles_number",
            "staff_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_teacher_subject_specializations",
            "subject_specializations",
            postgresql_using="gin",
        ),
    )

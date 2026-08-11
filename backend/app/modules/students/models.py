"""Student domain models (database-schema.md §3.B, §3.G).

`student_profiles` (PII + linkage), `student_documents` (metadata + storage key).
Enrollment lives in classes/ (class_enrollments) to keep the class roster with the
academic-structure module — and under D29 a student has MANY active enrollments, one
per subject class they take.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import StudentStatus
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class StudentProfile(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "student_profiles"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_student_profiles_user"),
        nullable=True,
    )
    student_number: Mapped[str] = mapped_column(Text(), nullable=False)
    full_name: Mapped[str] = mapped_column(Text(), nullable=False)
    date_of_birth: Mapped[date] = mapped_column(Date(), nullable=False)
    gender: Mapped[str | None] = mapped_column(Text(), nullable=True)
    #: The student's own level — "Lower 6" / "Upper 6" (D29). Free text, not an enum,
    #: because the school names its levels and a v1 enum would force a migration to
    #: rename them. Pre-D29 this was read off the student's homeroom
    #: (`classes.grade_level`); with no homeroom to read, the report-card header and
    #: the student-list level column come from here. Nullable so existing rows load.
    year_group: Mapped[str | None] = mapped_column(Text(), nullable=True)
    enrollment_date: Mapped[date] = mapped_column(Date(), nullable=False)
    status: Mapped[StudentStatus] = mapped_column(
        enum_col(StudentStatus), nullable=False, server_default=text("'active'")
    )
    guardian_name: Mapped[str | None] = mapped_column(Text(), nullable=True)
    guardian_phone: Mapped[str | None] = mapped_column(Text(), nullable=True)
    guardian_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    address: Mapped[str | None] = mapped_column(Text(), nullable=True)
    phone: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        Index(
            "uq_student_profiles_user",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "uq_student_profiles_number",
            "student_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class StudentDocument(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "student_documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "student_profiles.id", ondelete="RESTRICT", name="fk_student_documents_student"
        ),
        nullable=False,
    )
    file_name: Mapped[str] = mapped_column(Text(), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text(), nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text(), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    document_type: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        Index("uq_student_documents_key", "storage_key", unique=True),
    )

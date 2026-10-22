"""Teacher domain models (database-schema.md §3.B).

`teacher_profiles` (staff record + linkage). `class_teachers` (the ownership
relation) lives in classes/ with the rest of the section/subject graph.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import TeacherStatus
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID, JSONType, enum_col


class TeacherProfile(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "teacher_profiles"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_teacher_profiles_user"),
        nullable=True,
    )
    staff_number: Mapped[str] = mapped_column(Text(), nullable=False)
    full_name: Mapped[str] = mapped_column(Text(), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    phone: Mapped[str | None] = mapped_column(Text(), nullable=True)
    status: Mapped[TeacherStatus] = mapped_column(
        enum_col(TeacherStatus), nullable=False, server_default=text("'active'")
    )
    subject_specializations: Mapped[list[str] | None] = mapped_column(
        JSONType(), nullable=True, default=list
    )

    #: Extended profile (D39). These SEVEN columns have existed on `teacher_profiles`
    #: since the tertiary reconcile — they are in `sims_final.sql` and in the live `sims`
    #: database — but the ORM never mapped them, so `TeacherUpdateRequest` (which sets
    #: `extra="forbid"`) rejected the very fields the edit dialog sends. Every profile
    #: save 422'd. Mapping them here is the whole fix; no migration is required.
    #:
    #: `gender` is an `enum('male','female','other')` in MariaDB and stays a plain `str`
    #: in Python: the constraint is the column's, and Pydantic re-checks it on the way in.
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text(), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: Renamed from `education` by 013 (Meeting #2 item 10, "change column
    #: Degree/Education to Academic Qualification"). Width stays 255: four live rows hold
    #: 31-character values and the client's dump proposed varchar(30), which had already
    #: truncated them in their own copy.
    academic_qualification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str | None] = mapped_column(Text(), nullable=True)
    #: JSON array of `{area, level}` — the profile's subject-expertise bars.
    expertise: Mapped[list[dict] | None] = mapped_column(JSONType(), nullable=True)

    #: Employment record (D39, Meeting #2 item 10), added by `013_meeting2_schema.sql`.
    #:
    #: `first_name` / `last_name` are ADDITIVE — `full_name` remains the authoritative
    #: display value and is what every existing query reads. 013 backfilled these by
    #: splitting on the last space, which gets 'Maria Reyes' right and 'Maria de la Cruz'
    #: wrong, so nothing is derived from them that `full_name` can answer instead.
    first_name: Mapped[str | None] = mapped_column(String(250), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(250), nullable=True)
    #: Belize social security number. Same width as `student_profiles.ssno`.
    ssno: Mapped[str | None] = mapped_column(String(9), nullable=True)
    #: Teacher licence number. ALPHANUMERIC — the client's sample is `OWD-2019-00035`,
    #: so this is never parsed or stored as an integer.
    licensenum: Mapped[str | None] = mapped_column(String(15), nullable=True)
    #: The client's `IsEmployed` (their rename of `IsPresent`). `status` remains what the
    #: application filters on and what the ORM enum guards; this MIRRORS it so the
    #: client's own reporting reads the field it expects. `service.py` keeps the two in
    #: step — they must never be set independently.
    is_employed: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    hire_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    comments: Mapped[str | None] = mapped_column(String(500), nullable=True)

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

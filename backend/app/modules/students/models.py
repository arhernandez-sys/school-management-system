"""Student domain models (database-schema.md §3.B, §3.G).

`student_profiles` (PII + linkage), `student_documents` (metadata + storage key).
Enrollment lives in classes/ (class_enrollments) to keep the class roster with the
academic-structure module — and under D29 a student has MANY active enrollments, one
per subject class they take.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import District, EnrollmentLoad, StudentStatus, YearOfStudy
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
    #: Split names (D30 §D10, brief §11). The DB columns keep the unprefixed spelling
    #: `firstname`/`middlename`/`lastname` they were created with in `005_tertiary.sql`
    #: — decision #3 preserves technical identifiers — while the Python and wire names
    #: follow house snake_case.
    #:
    #: `first_name` is nullable ONLY for legacy single-token names, which `005` §9
    #: deliberately parked in `lastname` with a NULL given name because listings sort
    #: on the surname. `StudentCreateRequest` requires both, so nothing new can be
    #: created that way. See `007_student_names.sql`.
    first_name: Mapped[str | None] = mapped_column(
        "firstname", String(50), nullable=True
    )
    middle_name: Mapped[str | None] = mapped_column(
        "middlename", String(50), nullable=True
    )
    last_name: Mapped[str] = mapped_column("lastname", String(50), nullable=False)
    date_of_birth: Mapped[date] = mapped_column(Date(), nullable=False)
    gender: Mapped[str | None] = mapped_column(Text(), nullable=True)
    enrollment_date: Mapped[date] = mapped_column(Date(), nullable=False)
    status: Mapped[StudentStatus] = mapped_column(
        enum_col(StudentStatus), nullable=False, server_default=text("'active'")
    )
    guardian_name: Mapped[str | None] = mapped_column(Text(), nullable=True)
    guardian_phone: Mapped[str | None] = mapped_column(Text(), nullable=True)
    guardian_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    address: Mapped[str | None] = mapped_column(Text(), nullable=True)
    phone: Mapped[str | None] = mapped_column(Text(), nullable=True)
    #: The study the student is registered on (D30 §D12). A proper uuid FK — the
    #: column in `sims_bk.sql` was `programid varchar(8)` against `programs.programid
    #: uuid`, a type mismatch with no FK that could never have been joined at all.
    #:
    #: Mapped in Phase 2B so `DELETE /programs/{id}` could honestly refuse to remove a
    #: programme students are on; **SET from Phase 4** — by acceptance (§D11) and by the
    #: Dean-only programme change (§D12).
    #:
    #: This column is the CURRENT programme only. The history is
    #: `student_program_history`, and the two are maintained together: a change closes
    #: the open history row and opens a new one in the same transaction. Reading a
    #: student's programme from history rather than from here would work, but this is the
    #: column every list query and FK guard already joins on.
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="SET NULL", name="fk_student_profiles_program"),
        nullable=True,
    )
    #: Year and load, as declared on the application (§D11). Two fields, because
    #: `sims_bk.sql` had ONE conflating them — see `YearOfStudy` for why that could not
    #: answer either question.
    year_of_study: Mapped[YearOfStudy | None] = mapped_column(
        enum_col(YearOfStudy), nullable=True
    )
    enrollment_load: Mapped[EnrollmentLoad | None] = mapped_column(
        enum_col(EnrollmentLoad), nullable=True
    )
    #: The application this student was admitted from (§D11). NULL for anyone created
    #: directly through `POST /students`, which stays supported: a college that has been
    #: running before this system existed has students with no application on file.
    #:
    #: The prerequisite gate reads student → here → `credit_transfer_requests`, because a
    #: transfer is anchored on the application by policy (§D4, brief §13).
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "applications.id", ondelete="SET NULL", name="fk_student_profiles_application"
        ),
        nullable=True,
    )
    # ── Admission-form fields carried onto the student record (§D11, Section A/B/C) ──
    # Copied at acceptance rather than read through `application_id` on every request:
    # the student record is the live truth about a person and must stay editable after
    # admission, while the application is a frozen record of what they declared.
    ssno: Mapped[str | None] = mapped_column(String(9), nullable=True)
    religion: Mapped[str | None] = mapped_column(String(100), nullable=True)
    civil_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city_town_village: Mapped[str | None] = mapped_column(String(200), nullable=True)
    district: Mapped[District | None] = mapped_column(enum_col(District), nullable=True)
    mother_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    father_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nok_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nok_relationship: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nok_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    has_health_condition: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    health_condition_note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    atlib_exam: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    num_csec: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    finance_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    finance_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    finance_email: Mapped[str | None] = mapped_column(String(254), nullable=True)

    @hybrid_property
    def full_name(self) -> str:
        """The student's display name, computed from the parts (D30 §D10).

        `student_profiles.full_name` was a stored NOT NULL column until
        `007_student_names.sql` dropped it. It survives as this property because it is
        the display string the whole API emits — `StudentListItem.full_name`, roster
        entries, gradebook rows, the report card and the transcript — and keeping the
        NAME meant the split did not have to churn every consumer.

        It is a `hybrid_property`, not a plain one, so the same attribute also works in
        a query: `StudentProfile.full_name.ilike("%perez%")` compiles to a `concat_ws`
        the database can filter on, which is what keeps free-text search matching a
        name the user types in full.

        ⚠️ NEVER ORDER BY THIS. Listings sort ascending by surname then given name —
        use `STUDENT_NAME_ORDER` below. Sorting on the combined string puts "Ana Perez"
        before "Andre Rivera" under the given name, which is not what a register is.
        """
        return " ".join(
            part
            for part in (self.first_name, self.middle_name, self.last_name)
            if part
        )

    @full_name.inplace.expression
    @classmethod
    def _full_name_expression(cls):
        # CONCAT_WS skips NULLs, so a student with no middle name yields
        # "Ana Perez" rather than "Ana  Perez".
        return func.concat_ws(" ", cls.first_name, cls.middle_name, cls.last_name)

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


#: THE ordering for every student listing (D30 §D10, brief §11) — ascending by
#: surname, then given name. `id` breaks the tie so pagination is stable when two
#: students share a name.
#:
#: Defined once and imported by students, classes, grades, reports, dashboard and
#: attendance. Before D30 each of those wrote `.order_by(StudentProfile.full_name)`
#: independently, which is exactly the "combined display string" the brief rules out.
STUDENT_NAME_ORDER = (
    StudentProfile.last_name.asc(),
    StudentProfile.first_name.asc(),
    StudentProfile.id.asc(),
)


class StudentNumberSequence(Base):
    """Per-month counter behind the `YYYYMM###` student ID (D30 §D9, brief §10).

    One row per calendar month. Allocation is a single
    `INSERT … ON DUPLICATE KEY UPDATE last_seq = last_seq + 1` inside the caller's
    transaction: the row lock that statement takes is what makes two simultaneous
    registrations safe, which a `SELECT MAX(...) + 1` never would be.

    Created by `005_tertiary.sql` §10. See `app/modules/students/numbering.py`.
    """

    __tablename__ = "student_number_sequences"

    year_month: Mapped[str] = mapped_column(String(6), primary_key=True)
    last_seq: Mapped[int] = mapped_column(
        Integer(), nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
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


class StudentProgramHistory(Base, TimestampMixin, AuditMixin):
    """Every programme a student has been registered on (D30 §D12, brief §12).

    **A programme change must never destroy history.** Overwriting
    `student_profiles.program_id` alone would lose the fact that the student read
    Business Management for a year, which is exactly what a transcript, a credits-earned
    figure and a "which of your courses carry over?" answer all depend on.

    **At most ONE open row per student, enforced by the database.** `open_flag` is a
    STORED generated column, `IF(ended_at IS NULL, 1, NULL)`, and
    `uq_student_program_open (student_id, open_flag)` is unique over it. NULLs do not
    collide in a unique index, so any number of CLOSED rows coexist while a second OPEN
    one is refused outright. That is the invariant, and it is why the service closes the
    old row before opening the new one rather than the other way round — the reverse
    order would trip the index.

    `open_flag` is deliberately NOT mapped as a writable attribute: it is generated, and
    an ORM that thought it could set it would produce a MariaDB 3105 on every insert.
    """

    __tablename__ = "student_program_history"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "student_profiles.id", ondelete="CASCADE", name="fk_student_program_student"
        ),
        nullable=False,
    )
    program_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="RESTRICT", name="fk_student_program_program"),
        nullable=False,
    )
    started_at: Mapped[date] = mapped_column(Date(), nullable=False)
    #: NULL means CURRENT. The generated `open_flag` derives from exactly this.
    ended_at: Mapped[date | None] = mapped_column(Date(), nullable=True)
    #: Why the student moved. Free text and optional: the Dean records a reason when
    #: there is one to record, and an empty one must not block a correction.
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at",
            name="ck_student_program_dates",
        ),
        Index("ix_student_program_student", "student_id"),
    )

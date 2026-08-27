"""Admissions models (D30 §D11; DDL in `005_tertiary.sql` §11–§14).

**Why an applicant entity exists at all.** The database audit (plan §B4) found there was
none: the paper form's "FOR OFFICIAL USE ONLY" block — date accepted, academic year,
programme, enrolment status, student code — had nowhere to live, and
`student_profiles.status` was being asked to double as an admission status when it is a
student LIFECYCLE enum. An applicant is not a student; decision #5 makes acceptance the
single action that turns one into the other.

**Sections A–G of the form map onto ONE row.** `applications` is wide rather than
normalised into per-section tables because the sections are one document filled in one
sitting, and splitting them would mean six joins to render one form and six inserts to
save it. The two genuinely repeating parts are separate tables: `application_education`
(Section B's institution table, whose handwritten note on the form literally says "Add
New Tab") and `application_documents` (Section F's checklist).

**The FK pair is circular on purpose.** `applications.student_id` points at the student
acceptance created, and `student_profiles.application_id` points back. Both directions
are used: the admissions screens need "did this become a student?", and the prerequisite
gate needs student → application → approved transfers (§D4). Neither is nullable-free, so
the insert order at acceptance matters — see `service.accept_application`.
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
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import (
    ApplicationDocumentType,
    ApplicationStatus,
    CreditTransferStatus,
    District,
    EducationLevel,
    EnrollmentLoad,
    YearOfStudy,
)
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID, JSONType, enum_col


class Application(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """One admission application — Sections A–G plus the official-use block.

    Almost everything is NULLABLE, and that is deliberate rather than lax. A `draft`
    exists precisely so the Registrar can stop half way through transcribing a paper
    form, so the schema cannot demand a complete record; completeness is asserted at the
    SUBMIT and ACCEPT transitions instead, where it is actually knowable. Only the names
    are NOT NULL — an application with no name on it is not an application.

    Soft-deleted, never hard-deleted: an admissions record is kept even when it was filed
    in error.
    """

    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = uuid_pk()
    status: Mapped[ApplicationStatus] = mapped_column(
        enum_col(ApplicationStatus), nullable=False, server_default=text("'draft'")
    )
    #: The school year the applicant is applying FOR, as written at the head of the form
    #: ("2026-2027"). Free text, not a FK: an applicant may apply before the year exists
    #: in `academic_years`, and the official-use block carries the real
    #: `academic_year_id` once the college accepts them.
    school_year: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # ── Section A · Personal information ──────────────────────────────────────
    # Column names keep the unprefixed spelling `005` §11 created them with (decision
    # #3 renames display labels, not technical identifiers); the Python attributes use
    # the readable form, exactly as `StudentProfile` does.
    first_name: Mapped[str] = mapped_column("firstname", String(50), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(
        "middlename", String(50), nullable=True
    )
    last_name: Mapped[str] = mapped_column("lastname", String(50), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date(), nullable=True)
    #: Social Security number. `varchar(9)`, unvalidated beyond length — the form asks
    #: for it but the college is not the authority on its format.
    ssno: Mapped[str | None] = mapped_column(String(9), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(25), nullable=True)
    civil_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    religion: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    #: "Do you suffer any health or learning condition?" — the form pairs Yes with
    #: "attach a medical certificate", which is why the note is free text rather than a
    #: second boolean.
    has_health_condition: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    health_condition_note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city_town_village: Mapped[str | None] = mapped_column(String(200), nullable=True)
    district: Mapped[District | None] = mapped_column(enum_col(District), nullable=True)
    mother_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    father_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    #: Next of kin for emergencies — a THIRD contact, distinct from the parents and from
    #: whoever finances the study. The form asks for all three separately because they
    #: are routinely different people.
    nok_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nok_relationship: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nok_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # ── Section B · Educational background (examinations half) ────────────────
    # The repeating institution table is `ApplicationEducation`; these two are the
    # single-valued questions that follow it.
    atlib_exam: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    num_csec: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)

    # ── Section C · Financial information ─────────────────────────────────────
    finance_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    finance_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    finance_email: Mapped[str | None] = mapped_column(String(254), nullable=True)

    # ── Section D · Recommendation ────────────────────────────────────────────
    #: The BAJC Character and Academic Recommendation Form, completed by a high-school
    #: teacher. A boolean, not a document row, because the question the Registrar
    #: answers is "has it arrived?" — the paper itself is tracked in Section F.
    recommendation_received: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    # ── Section E · Programme of study ────────────────────────────────────────
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="SET NULL", name="fk_applications_program"),
        nullable=True,
    )
    #: Year and load are SEPARATE fields. `sims_bk.sql` had one column conflating them
    #: (plan §B4); the form asks two independent questions and `005` §9 split them.
    year_of_study: Mapped[YearOfStudy | None] = mapped_column(
        enum_col(YearOfStudy), nullable=True
    )
    enrollment_load: Mapped[EnrollmentLoad | None] = mapped_column(
        enum_col(EnrollmentLoad), nullable=True
    )

    # ── Section G · Agreement ─────────────────────────────────────────────────
    applicant_signed_at: Mapped[date | None] = mapped_column(Date(), nullable=True)
    #: Required by the form only when the applicant is under 18 — a rule about the FORM,
    #: enforced at submit time where the date of birth is known, not by the column.
    guardian_signed_at: Mapped[date | None] = mapped_column(Date(), nullable=True)

    # ── FOR OFFICIAL USE ONLY ─────────────────────────────────────────────────
    date_accepted: Mapped[date | None] = mapped_column(Date(), nullable=True)
    academic_year_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("academic_years.id", ondelete="SET NULL", name="fk_applications_year"),
        nullable=True,
    )
    enrolment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    #: The issued `YYYYMM###`, copied here when acceptance allocates it. Denormalised on
    #: purpose: this block is a record of what the college wrote on the form, and it must
    #: still read correctly if the student is later soft-deleted.
    student_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    comments: Mapped[str | None] = mapped_column(Text(), nullable=True)

    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_applications_decided_by"),
        nullable=True,
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The student this application became. NULL until accepted — and the presence of
    #: this value is what makes acceptance detectably idempotent.
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "student_profiles.id", ondelete="SET NULL", name="fk_applications_student"
        ),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(
            "num_csec IS NULL OR num_csec BETWEEN 0 AND 20",
            name="ck_applications_num_csec",
        ),
        # Listings sort surname-first (§D10), the same rule as students.
        Index("ix_applications_lastname", "lastname", "firstname"),
        Index("ix_applications_status", "status"),
    )

    @property
    def full_name(self) -> str:
        """Display name, first-name-first. Ordering still uses the parts (§D10)."""
        return " ".join(
            part for part in (self.first_name, self.middle_name, self.last_name) if part
        )

    @property
    def is_decided(self) -> bool:
        """Whether a decision has been recorded and the form is closed to edits."""
        return self.status in (
            ApplicationStatus.ACCEPTED,
            ApplicationStatus.DENIED,
            ApplicationStatus.WITHDRAWN,
        )


class ApplicationEducation(Base, TimestampMixin):
    """One prior institution — Section B's repeating table.

    **This is the table that fixes a real defect.** `sims_bk.sql` had
    `student_profiles.educationbg_id`, single-valued, pointing at an
    `educational_background` table that carried no student reference at all (plan §B4).
    An applicant who attended two institutions could not be recorded either way round.

    Rows are owned by the application and replaced as a whole set, so there is no audit
    mixin and no soft delete: an education row has no history of its own, and what the
    college decided lives on `applications`.
    """

    __tablename__ = "application_education"

    id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "applications.id",
            ondelete="CASCADE",
            name="fk_application_education_application",
        ),
        nullable=False,
    )
    institution: Mapped[str] = mapped_column(String(250), nullable=False)
    education_level: Mapped[EducationLevel] = mapped_column(
        enum_col(EducationLevel), nullable=False, server_default=text("'High School'")
    )
    graduated: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    graduation_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    #: Display order as written on the form. Rows are otherwise unordered, and a
    #: graduation date cannot stand in for it — the form's first row is often the most
    #: recent institution, and `graduation_date` is blank for anyone still studying.
    sort_order: Mapped[int] = mapped_column(
        SmallInteger(), nullable=False, server_default=text("1")
    )

    __table_args__ = (
        Index("ix_application_education_application", "application_id"),
    )


class ApplicationDocument(Base, TimestampMixin):
    """One row of Section F's document checklist, or a credit-transfer paper.

    **A checklist row, not a file.** Object storage is not provisioned in this repo
    (TODO(OQ-DB5) — the same reason `POST /settings/school/logo` validates and then
    stubs the byte write), and Section F on the paper form is literally a tick-list. So
    `received` is the load-bearing column and the file metadata is optional, filled in by
    hand today and by a real upload later. Adding bytes is additive; pretending they
    exist would not be.

    `credit_transfer_requests` FKs its `cta_document_id`, `transcript_document_id` and
    `outline_document_id` here, which is why `TRANSCRIPT` and `CTA` are document types
    even though they are not on Section F.
    """

    __tablename__ = "application_documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "applications.id",
            ondelete="CASCADE",
            name="fk_application_documents_application",
        ),
        nullable=False,
    )
    document_type: Mapped[ApplicationDocumentType] = mapped_column(
        enum_col(ApplicationDocumentType), nullable=False
    )
    file_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)
    received: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    __table_args__ = (
        Index("ix_application_documents_application", "application_id"),
    )


class CreditTransferRequest(Base, TimestampMixin, AuditMixin):
    """A request to carry credit in from another institution (brief §13, §D11).

    **Anchored on the APPLICATION, not the student, and that is the policy.** Transfer
    may be applied for only at entrance, when no student record exists yet — so the
    application is the only thing available to hang it on. The prerequisite gate reaches
    it the long way round (student → `student_profiles.application_id` → application →
    transfers) precisely because of that.

    Every clause of the policy has a home:

    * *studied and passed at a recognised tertiary institution* — `external_institution`
      plus `external_grade`; the tertiary half is what `EducationLevel` distinguishes on
      the Section B rows.
    * *≥75% content equivalency* — `content_equivalency_pct`, with
      `ck_cta_approval_requires_75` refusing an `approved` row below it **at the database
      level**. Checked on APPROVAL, not creation: a request may legitimately be filed
      before anyone has assessed the equivalency.
    * *requires CTA + original transcript + course outlines* — the three document FKs.
    * *assessed and decided by the Dean* — `status` + `decided_by_user_id`, gated to
      `Role.PRINCIPAL` in the router (§D14).

    An approved row grants the TARGET course, which is why `target_course_id` is NOT NULL
    even though the external course details are mostly optional: without knowing which
    BAJC course the credit satisfies, an approval means nothing to the curriculum or to
    the prerequisite gate.
    """

    __tablename__ = "credit_transfer_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("applications.id", ondelete="CASCADE", name="fk_cta_application"),
        nullable=False,
    )
    external_institution: Mapped[str] = mapped_column(String(250), nullable=False)
    external_course_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    external_course_name: Mapped[str] = mapped_column(String(200), nullable=False)
    external_credits: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    #: The grade earned elsewhere, as the transcript writes it. Free text: another
    #: institution's scale is not BAJC's, and mapping it onto the 8-band scale would be
    #: inventing an equivalence the Dean is the one to judge.
    external_grade: Mapped[str | None] = mapped_column(String(15), nullable=True)
    target_course_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("courses.id", ondelete="RESTRICT", name="fk_cta_target_course"),
        nullable=False,
    )
    content_equivalency_pct: Mapped[float | None] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    cta_document_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("application_documents.id", ondelete="SET NULL", name="fk_cta_cta_doc"),
        nullable=True,
    )
    transcript_document_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "application_documents.id", ondelete="SET NULL", name="fk_cta_transcript_doc"
        ),
        nullable=True,
    )
    outline_document_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "application_documents.id", ondelete="SET NULL", name="fk_cta_outline_doc"
        ),
        nullable=True,
    )
    status: Mapped[CreditTransferStatus] = mapped_column(
        enum_col(CreditTransferStatus), nullable=False, server_default=text("'pending'")
    )
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_cta_decided_by"),
        nullable=True,
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "content_equivalency_pct IS NULL OR content_equivalency_pct BETWEEN 0 AND 100",
            name="ck_cta_equivalency_range",
        ),
        CheckConstraint(
            "status <> 'approved' OR (content_equivalency_pct IS NOT NULL "
            "AND content_equivalency_pct >= 75.00)",
            name="ck_cta_approval_requires_75",
        ),
        Index("ix_cta_application", "application_id"),
        Index("ix_cta_status", "status"),
    )


class ApplicationTemp(Base, TimestampMixin, AuditMixin):
    """A form the Registrar has saved but NOT submitted — D38's holding table.

    **Why a second table rather than `applications.status = 'draft'`.** The wizard used to
    PATCH `applications` on every step, so a half-typed form was already an admissions
    record: it appeared in the directory, it was counted, and the Dean saw it. The client
    wanted the opposite — nothing enters the admissions record until it is deliberately
    saved, and an unsubmitted form belongs to whoever is typing it. That is a different
    ownership rule from `applications`, which is a shared record, so it is a different
    table. `applications.draft` survives for rows filed before D38.

    **`created_by` is load-bearing here, not just audit.** It is the scope: the Registrar
    who filed a pending form is the only person who can see it, apart from the Dean, who
    sees all of them. On `applications` the same column is provenance and nothing more.

    **Sections B and F ride as JSON.** On `applications` they are `application_education`
    and `application_documents`, keyed by an application id that a pending form has not
    got. Duplicating both child tables to hold rows nobody may query by institution or
    document type would be three tables to express one saved form, so they are stored as
    the arrays they are and expanded into the real child tables at promotion
    (`service.submit_pending_application`).

    **What is deliberately NOT mirrored.** `date_accepted`, `student_code`,
    `decided_by_user_id`, `decided_at` and `student_id` are written by the ACCEPT
    transition. A pending form has no decision and no student, so mirroring them would add
    an FK to `student_profiles` that can never be satisfied. Every column a client may
    WRITE is here; the columns the system writes about a decision are not.

    Hard-deleted, unlike `applications`. There is no record to keep: the row either became
    an application or the Registrar abandoned it.
    """

    __tablename__ = "student_profile_temp"

    id: Mapped[uuid.UUID] = uuid_pk()
    #: Always `pending`. A plain string, NOT `ApplicationStatus`: adding a `pending` member
    #: to that enum would widen the vocabulary of the real `applications.status` column,
    #: where `draft`/`submitted`/… are the states the decision queue is built on.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'pending'")
    )
    school_year: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # ── Section A · Personal information ──────────────────────────────────────
    # Same unprefixed column spellings as `applications`, so the promotion INSERT is a
    # straight attribute-for-attribute copy rather than a mapping table.
    first_name: Mapped[str] = mapped_column("firstname", String(50), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(
        "middlename", String(50), nullable=True
    )
    last_name: Mapped[str] = mapped_column("lastname", String(50), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date(), nullable=True)
    ssno: Mapped[str | None] = mapped_column(String(9), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(25), nullable=True)
    civil_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    religion: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    has_health_condition: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    health_condition_note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city_town_village: Mapped[str | None] = mapped_column(String(200), nullable=True)
    district: Mapped[District | None] = mapped_column(enum_col(District), nullable=True)
    mother_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    father_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nok_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nok_relationship: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nok_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # ── Section B · Educational background ────────────────────────────────────
    atlib_exam: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    num_csec: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    #: Section B's institution table, as the array the form shows. Shaped like
    #: `schemas.EducationRow` minus `id` — a pending row has no identity to preserve.
    education_json: Mapped[list | None] = mapped_column(JSONType(), nullable=True)

    # ── Section C · Financial information ─────────────────────────────────────
    finance_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    finance_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    finance_email: Mapped[str | None] = mapped_column(String(254), nullable=True)

    # ── Section D · Recommendation ────────────────────────────────────────────
    recommendation_received: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    # ── Section E · Programme of study ────────────────────────────────────────
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="SET NULL", name="fk_apptemp_program"),
        nullable=True,
    )
    year_of_study: Mapped[YearOfStudy | None] = mapped_column(
        enum_col(YearOfStudy), nullable=True
    )
    enrollment_load: Mapped[EnrollmentLoad | None] = mapped_column(
        enum_col(EnrollmentLoad), nullable=True
    )

    # ── Section F · Documents to submit ───────────────────────────────────────
    #: Shaped like `schemas.DocumentRow` minus `id`.
    documents_json: Mapped[list | None] = mapped_column(JSONType(), nullable=True)

    # ── Section G · Agreement ─────────────────────────────────────────────────
    applicant_signed_at: Mapped[date | None] = mapped_column(Date(), nullable=True)
    guardian_signed_at: Mapped[date | None] = mapped_column(Date(), nullable=True)

    # ── FOR OFFICIAL USE ONLY — the client-writable half only ─────────────────
    academic_year_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("academic_years.id", ondelete="SET NULL", name="fk_apptemp_year"),
        nullable=True,
    )
    enrolment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    comments: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "num_csec IS NULL OR num_csec BETWEEN 0 AND 20",
            name="ck_apptemp_num_csec",
        ),
        # The list is "my pending forms, surname first" for a Registrar and "everyone's"
        # for the Dean, so `created_by` leads the index and the name pair follows it.
        Index("ix_apptemp_created_by", "created_by", "lastname", "firstname"),
    )

    @property
    def full_name(self) -> str:
        return " ".join(
            part for part in (self.first_name, self.middle_name, self.last_name) if part
        )

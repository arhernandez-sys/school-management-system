"""Admissions request/response schemas (D30 §D11, form Sections A–G).

Write models set `extra="forbid"` (api-spec §1.4) so a typo'd field fails loudly rather
than being silently dropped; the wire is snake_case (§1.2).

**Almost every field is optional on write, including on create.** That is not laxity — it
is what a `draft` means. The Registrar transcribes a paper form section by section, so the
schema cannot demand a complete record; completeness is asserted at the SUBMIT and ACCEPT
transitions, where it is knowable and where refusing is useful. Only the applicant's names
are required to file at all.

`ApplicationUpdateRequest` uses the PRESENCE of a key rather than its None-ness for every
field, via `model_fields_set` in the service. A PATCH that sends one section must not blank
the other six, and `null` has to stay usable for genuinely clearing a field the Registrar
mis-typed.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import (
    ApplicationDocumentType,
    ApplicationStatus,
    CreditTransferStatus,
    District,
    EducationLevel,
    EnrollmentLoad,
    YearOfStudy,
)


# ──────────────────────────────────────────────────────────────────────────────
# Section B · the repeating institution table
# ──────────────────────────────────────────────────────────────────────────────
class EducationRow(BaseModel):
    """One prior institution. Read + write share this shape.

    `id` is read-only and absent on write: these rows are replaced as a whole set (see
    `PUT /applications/{id}/education`), so a client never addresses one individually.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")
    id: UUID | None = None
    institution: str = Field(min_length=1, max_length=250)
    education_level: EducationLevel = EducationLevel.HIGH_SCHOOL
    graduated: bool = False
    graduation_date: date | None = None
    sort_order: int = Field(default=1, ge=0, le=99)


class EducationReplaceRequest(BaseModel):
    """PUT /applications/{id}/education — replaces the whole set.

    Replace rather than per-row CRUD because this is a form fragment, not an entity with
    a life of its own: the Registrar edits the table as a block and saves it, and
    "delete row 2, renumber the rest" is three round trips to express one edit.
    """

    model_config = ConfigDict(extra="forbid")
    items: list[EducationRow] = Field(default_factory=list, max_length=20)


# ──────────────────────────────────────────────────────────────────────────────
# Section F · the document checklist
# ──────────────────────────────────────────────────────────────────────────────
class DocumentRow(BaseModel):
    """One checklist row. **No file bytes** — see `ApplicationDocument` for why.

    `received` is the field that carries meaning; the rest is metadata a real upload
    would fill in, hand-entered today.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")
    id: UUID | None = None
    document_type: ApplicationDocumentType
    file_name: str | None = Field(default=None, max_length=150)
    content_type: str | None = Field(default=None, max_length=100)
    size_bytes: int | None = Field(default=None, ge=0)
    received: bool = False


class DocumentReplaceRequest(BaseModel):
    """PUT /applications/{id}/documents — replaces the whole checklist.

    **Rows referenced by a credit-transfer request are preserved, not replaced.** A
    blanket delete-and-reinsert would either violate the three document FKs or, with
    `ON DELETE SET NULL`, silently strip a pending transfer of its CTA and transcript.
    The service reconciles by id for exactly that reason.
    """

    model_config = ConfigDict(extra="forbid")
    items: list[DocumentRow] = Field(default_factory=list, max_length=40)


# ──────────────────────────────────────────────────────────────────────────────
# Credit transfer (brief §13)
# ──────────────────────────────────────────────────────────────────────────────
class CreditTransferCreateRequest(BaseModel):
    """POST /applications/{id}/credit-transfers (Registrar + Dean).

    `content_equivalency_pct` is optional here and REQUIRED to approve: the Registrar
    files what the applicant claims, and assessing the equivalency is the Dean's job
    (brief §13). `ck_cta_approval_requires_75` is the database's own backstop for that.
    """

    model_config = ConfigDict(extra="forbid")
    external_institution: str = Field(min_length=1, max_length=250)
    external_course_code: str | None = Field(default=None, max_length=50)
    external_course_name: str = Field(min_length=1, max_length=200)
    external_credits: int | None = Field(default=None, ge=0, le=99)
    external_grade: str | None = Field(default=None, max_length=15)
    #: The BAJC course the credit would satisfy. Required — an approval that does not name
    #: one means nothing to the curriculum or to the prerequisite gate.
    target_course_id: UUID
    content_equivalency_pct: float | None = Field(default=None, ge=0, le=100)
    cta_document_id: UUID | None = None
    transcript_document_id: UUID | None = None
    outline_document_id: UUID | None = None
    note: str | None = None


class CreditTransferUpdateRequest(BaseModel):
    """PATCH /credit-transfers/{id} — editable only while PENDING.

    A decided transfer is a record of a Dean's decision; changing the course or the
    equivalency underneath it would make that decision describe something else.
    """

    model_config = ConfigDict(extra="forbid")
    external_institution: str | None = Field(default=None, min_length=1, max_length=250)
    external_course_code: str | None = Field(default=None, max_length=50)
    external_course_name: str | None = Field(default=None, min_length=1, max_length=200)
    external_credits: int | None = Field(default=None, ge=0, le=99)
    external_grade: str | None = Field(default=None, max_length=15)
    target_course_id: UUID | None = None
    content_equivalency_pct: float | None = Field(default=None, ge=0, le=100)
    cta_document_id: UUID | None = None
    transcript_document_id: UUID | None = None
    outline_document_id: UUID | None = None
    note: str | None = None


class CreditTransferDecisionRequest(BaseModel):
    """POST /credit-transfers/{id}/decision — **Dean only** (§D14, brief §13).

    `content_equivalency_pct` may be supplied with the decision, which is the normal
    path: the Dean assesses and decides in one action rather than saving a percentage and
    then approving it as a second step.
    """

    model_config = ConfigDict(extra="forbid")
    #: `pending` is not accepted — a decision endpoint that can un-decide would leave no
    #: record of the reversal. Re-opening is not a supported operation.
    status: CreditTransferStatus = Field(description="approved or denied")
    content_equivalency_pct: float | None = Field(default=None, ge=0, le=100)
    note: str | None = None


class CourseRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str = ""
    name: str = ""
    credits: int | None = None


class CreditTransferRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    application_id: UUID
    external_institution: str
    external_course_code: str | None = None
    external_course_name: str
    external_credits: int | None = None
    external_grade: str | None = None
    target_course: CourseRef | None = None
    content_equivalency_pct: float | None = None
    cta_document_id: UUID | None = None
    transcript_document_id: UUID | None = None
    outline_document_id: UUID | None = None
    status: CreditTransferStatus
    decided_by_user_id: UUID | None = None
    decided_at: datetime | None = None
    note: str | None = None
    #: Whether the ≥75% content-equivalency floor is currently satisfiable. Surfaced so
    #: the Dean's screen can disable Approve with a reason rather than posting into a 422.
    meets_equivalency_floor: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# The application itself
# ──────────────────────────────────────────────────────────────────────────────
class _ApplicationFields(BaseModel):
    """Sections A–G, shared by create and update.

    Every field optional so a draft can be filed from any starting point; `firstname` /
    `lastname` are re-declared as required on `ApplicationCreateRequest` alone.
    """

    model_config = ConfigDict(extra="forbid")

    school_year: str | None = Field(default=None, max_length=20)

    # Section A
    first_name: str | None = Field(default=None, min_length=1, max_length=50)
    middle_name: str | None = Field(default=None, max_length=50)
    last_name: str | None = Field(default=None, min_length=1, max_length=50)
    date_of_birth: date | None = None
    ssno: str | None = Field(default=None, max_length=9)
    gender: str | None = Field(default=None, max_length=25)
    civil_status: str | None = Field(default=None, max_length=50)
    religion: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=254)
    has_health_condition: bool | None = None
    health_condition_note: str | None = None
    street: str | None = Field(default=None, max_length=200)
    city_town_village: str | None = Field(default=None, max_length=200)
    district: District | None = None
    mother_name: str | None = Field(default=None, max_length=200)
    father_name: str | None = Field(default=None, max_length=200)
    nok_name: str | None = Field(default=None, max_length=200)
    nok_relationship: str | None = Field(default=None, max_length=100)
    nok_phone: str | None = Field(default=None, max_length=50)

    # Section B (the examinations half; institutions are their own endpoint)
    atlib_exam: bool | None = None
    num_csec: int | None = Field(default=None, ge=0, le=20)

    # Section C
    finance_name: str | None = Field(default=None, max_length=200)
    finance_phone: str | None = Field(default=None, max_length=50)
    finance_email: str | None = Field(default=None, max_length=254)

    # Section D
    recommendation_received: bool | None = None

    # Section E
    program_id: UUID | None = None
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None

    # Section G
    applicant_signed_at: date | None = None
    guardian_signed_at: date | None = None

    # FOR OFFICIAL USE ONLY — the parts a Registrar fills in before a decision.
    # `date_accepted`, `student_code` and `decided_*` are written by the ACCEPT
    # transition and are deliberately not client-writable: they are a record of what the
    # system did, not fields to type into.
    academic_year_id: UUID | None = None
    enrolment_status: str | None = Field(default=None, max_length=50)
    comments: str | None = None


class ApplicationCreateRequest(_ApplicationFields):
    """POST /applications — files a DRAFT (or a submitted one, with `submit=true`).

    The names are the only hard requirement. Everything else may arrive later, which is
    what makes the seven-step wizard interruption-safe: step A creates the draft and each
    later step patches it, so a closed tab loses nothing.
    """

    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    #: Skip the draft state and submit immediately. For a complete form typed in one go.
    submit: bool = False


class ApplicationUpdateRequest(_ApplicationFields):
    """PATCH /applications/{id}. Only the keys PRESENT in the body are applied."""


class ApplicationDenyRequest(BaseModel):
    """POST /applications/{id}/deny."""

    model_config = ConfigDict(extra="forbid")
    #: Recorded in `comments`. Optional, because a college may decline without stating a
    #: reason, but prompted for in the UI because the applicant usually asks.
    reason: str | None = None


class ApplicationAcceptRequest(BaseModel):
    """POST /applications/{id}/accept — creates the student, the login and the ID.

    Decision #5: acceptance is the SINGLE action that does all three. Nothing here is a
    student field; the student is built from Sections A–E, so an accept cannot quietly
    disagree with the application it came from.
    """

    model_config = ConfigDict(extra="forbid")
    #: Which year the student is admitted INTO. Defaults to the active academic year;
    #: named explicitly when admitting into a year that is not the current one.
    academic_year_id: UUID | None = None
    #: Defaults to `school_today()`. Overridable because a form is often keyed in days
    #: after the decision was actually made, and the record should say when it was made.
    date_accepted: date | None = None
    #: The login email. Defaults to the applicant's own `email`; required when they gave
    #: none, since a student with no login cannot use the portal.
    login_email: str | None = Field(default=None, max_length=254)
    #: Supply to set a known password; omit and the server generates one and returns it
    #: ONCE, the same contract as `POST /settings/users`.
    temporary_password: str | None = Field(default=None, max_length=256)
    comments: str | None = None


# ── Read models ───────────────────────────────────────────────────────────────
class ProgramRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str = ""
    name: str = ""


class ApplicationListItem(BaseModel):
    """A row in the admissions list. Deliberately thin — the full form is one fetch away."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: ApplicationStatus
    full_name: str
    first_name: str
    #: Readable as well as writable. Without it the wizard could SET a middle name and
    #: never read it back, silently clearing it on the next Section A save.
    middle_name: str | None = None
    last_name: str
    school_year: str | None = None
    program: ProgramRef | None = None
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None
    email: str | None = None
    phone: str | None = None
    date_accepted: date | None = None
    student_code: str | None = None
    #: Set once accepted. The admissions list uses it to link straight to the student.
    student_id: UUID | None = None
    created_at: datetime
    #: How many of the credit transfers filed with this application are still undecided —
    #: the Dean's queue count, on the row the Dean is looking at.
    pending_credit_transfers: int = 0


class ApplicationPage(BaseModel):
    items: list[ApplicationListItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 25
    total_pages: int = 0


class ApplicationDetail(ApplicationListItem):
    """The whole form, plus its repeating tables and its transfers."""

    date_of_birth: date | None = None
    ssno: str | None = None
    gender: str | None = None
    civil_status: str | None = None
    religion: str | None = None
    has_health_condition: bool = False
    health_condition_note: str | None = None
    street: str | None = None
    city_town_village: str | None = None
    district: District | None = None
    mother_name: str | None = None
    father_name: str | None = None
    nok_name: str | None = None
    nok_relationship: str | None = None
    nok_phone: str | None = None
    atlib_exam: bool = False
    num_csec: int | None = None
    finance_name: str | None = None
    finance_phone: str | None = None
    finance_email: str | None = None
    recommendation_received: bool = False
    applicant_signed_at: date | None = None
    guardian_signed_at: date | None = None
    academic_year_id: UUID | None = None
    enrolment_status: str | None = None
    comments: str | None = None
    decided_by_user_id: UUID | None = None
    decided_at: datetime | None = None
    updated_at: datetime

    education: list[EducationRow] = Field(default_factory=list)
    documents: list[DocumentRow] = Field(default_factory=list)
    credit_transfers: list[CreditTransferRead] = Field(default_factory=list)

    #: What still stands between this application and acceptance, as a list of
    #: human-readable reasons. Empty means acceptable.
    #:
    #: Returned on the READ rather than only raised on the write so the review screen can
    #: show the Registrar what is missing BEFORE they press Accept — and so that
    #: "why is this button disabled?" is answerable on the page.
    blocking_issues: list[str] = Field(default_factory=list)


class ApplicationAcceptResponse(BaseModel):
    """201 body of the accept transition."""

    application: ApplicationDetail
    student_id: UUID
    student_number: str
    #: Returned ONCE, and only when the server generated it — never echoed back when the
    #: Registrar supplied one. Same discipline as `POST /settings/users`.
    temporary_password: str | None = None
    login_email: str | None = None
    #: Approved credit transfers that were carried onto the new student record, by course
    #: code. Reported because it is the one part of acceptance that changes what the
    #: student still has to study, and it is otherwise invisible.
    transferred_course_codes: list[str] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# D38 · the PENDING form (`student_profile_temp`)
# ──────────────────────────────────────────────────────────────────────────────
class PendingApplicationWrite(_ApplicationFields):
    """POST / PATCH `/pending-applications` — the WHOLE form in one body.

    Unlike `ApplicationUpdateRequest` this is not a per-section patch, because D38 removed
    per-section saving: the wizard holds all seven sections in the browser and writes them
    once, when the Registrar presses *Save and close* or *Save and submit*. Sending the
    whole form is therefore correct rather than wasteful — there are no other sections
    sitting on the server that a full body could clobber.

    The names stay required. A pending form with no name on it cannot be found again in a
    list, which is the only thing the table is for.
    """

    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    #: Section B's institution table. Whole-set, like `PUT .../education`.
    education: list[EducationRow] = Field(default_factory=list, max_length=20)
    #: Section F's checklist. Whole-set, like `PUT .../documents`.
    documents: list[DocumentRow] = Field(default_factory=list, max_length=40)


class PendingApplicationListItem(BaseModel):
    """A row in the Pending forms list.

    `created_by_name` is here because the Dean sees everyone's rows and "whose form is
    this?" is the first question a shared queue raises. A Registrar sees only their own,
    so for them the column is constant and the frontend hides it.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: str = "pending"
    full_name: str
    first_name: str
    middle_name: str | None = None
    last_name: str
    school_year: str | None = None
    program: ProgramRef | None = None
    year_of_study: YearOfStudy | None = None
    enrollment_load: EnrollmentLoad | None = None
    email: str | None = None
    phone: str | None = None
    gender: str | None = None
    created_by: UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    #: What would stop this form being submitted, so the list can say "ready" or "3 things
    #: missing" without opening the wizard. Same function as `ApplicationDetail`'s.
    blocking_issues: list[str] = Field(default_factory=list)


class PendingApplicationDetail(PendingApplicationListItem):
    """The whole pending form, as the wizard re-opens it."""

    date_of_birth: date | None = None
    ssno: str | None = None
    civil_status: str | None = None
    religion: str | None = None
    has_health_condition: bool = False
    health_condition_note: str | None = None
    street: str | None = None
    city_town_village: str | None = None
    district: District | None = None
    mother_name: str | None = None
    father_name: str | None = None
    nok_name: str | None = None
    nok_relationship: str | None = None
    nok_phone: str | None = None
    atlib_exam: bool = False
    num_csec: int | None = None
    finance_name: str | None = None
    finance_phone: str | None = None
    finance_email: str | None = None
    recommendation_received: bool = False
    applicant_signed_at: date | None = None
    guardian_signed_at: date | None = None
    academic_year_id: UUID | None = None
    enrolment_status: str | None = None
    comments: str | None = None

    #: Read back from `education_json` / `documents_json`, in the same shape the real
    #: child tables are read in, so the wizard has one rendering path for both sources.
    education: list[EducationRow] = Field(default_factory=list)
    documents: list[DocumentRow] = Field(default_factory=list)


class PendingApplicationPage(BaseModel):
    items: list[PendingApplicationListItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 25
    total_pages: int = 0

"""Settings request/response schemas (api-spec §5 Module 11, §4.4).

Write models set `extra="forbid"` (api-spec §1.4) so a typo'd field fails loudly
(422) rather than being silently dropped. Wire format is snake_case (§1.2). Read
models mostly reuse the shared refs in `app/common/schemas.py`; the few defined
here are Settings-specific payloads (grading scale, academic-year tree, user
admin, account).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import AcademicYearStatus, Role, TermType
from app.common.schemas import (
    AcademicYearRef,
    SchoolIdentity,
    SemesterRef,
)

# ──────────────────────────────────────────────────────────────────────────────
# School profile / branding (§5.11 — School profile)
# ──────────────────────────────────────────────────────────────────────────────
class SchoolProfileRead(SchoolIdentity):
    """GET /settings/school — SchoolIdentity plus nothing extra (identity is the
    public read shape). `logo_url` is resolved from `logo_storage_key` + the
    Supabase public base when a key is present (TODO(OQ-DB5), see service)."""


class SchoolUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    contact_email: str | None = Field(default=None, max_length=255)
    contact_phone: str | None = Field(default=None, max_length=50)


class LogoUploadResponse(BaseModel):
    """200 body of POST /settings/school/logo."""

    logo_url: str | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Active term (§5.11 — GET /settings/active-term)
# ──────────────────────────────────────────────────────────────────────────────
class ActiveTerm(BaseModel):
    """The global semester switcher payload. 409 no_active_semester when absent."""

    academic_year: AcademicYearRef
    semester: SemesterRef


# ──────────────────────────────────────────────────────────────────────────────
# Academic years + semesters (§5.11 — Academic structure)
# ──────────────────────────────────────────────────────────────────────────────
class SemesterDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    academic_year_id: UUID
    name: str
    #: D30 §D3 — the KIND of calendar term. BAJC runs Summer and Spring blocks, not
    #: just two symmetrical semesters.
    term_type: TermType
    sequence: int
    start_date: date
    end_date: date
    #: Brief §18 / D30 §D6 — the **END-TERM** grade-entry cutoff (D32-1). Set by the
    #: Dean-only `POST`/`PATCH /settings/semesters`; enforced in
    #: `grades/service.upsert_grades`, the single grade write path, as a 409
    #: `grade_window_closed`. `None` means the term never closes.
    grade_submission_deadline: datetime | None = None
    #: D32 — the mid-term grading window. Both `None` means the term has no mid-term
    #: period, which disables mid-term revision gating and mid-term report cards for it.
    midterm_submission_start: datetime | None = None
    midterm_submission_end: datetime | None = None
    is_active: bool


class AcademicYearDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    start_date: date
    end_date: date
    status: AcademicYearStatus
    archived_at: datetime | None = None
    semesters: list[SemesterDetail]


class AcademicYearList(BaseModel):
    """GET /settings/academic-years — not paginated; a school has few years."""

    items: list[AcademicYearDetail]


class SemesterList(BaseModel):
    """GET /settings/semesters?academic_year_id?"""

    items: list[SemesterDetail]


class SemesterCreateRequest(BaseModel):
    """One term, as supplied nested inside `POST /settings/academic-years`.

    D30: `sequence` is no longer capped at 2 — `005` §6 dropped
    `ck_semesters_sequence`, because BAJC runs Summer and Spring blocks alongside the
    numbered semesters. It is still 1-based and still unique within the year.
    """

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    term_type: TermType = TermType.SEMESTER
    sequence: int = Field(ge=1, le=99)
    start_date: date
    end_date: date


class StandaloneSemesterCreateRequest(SemesterCreateRequest):
    """POST /settings/semesters (Dean only) — add ONE term to an existing year.

    Before D30 there was deliberately no such endpoint: `POST /settings/academic-years`
    hard-created exactly two terms and that was the whole of the school's calendar.
    Adding a Summer or Spring block therefore had no route at all (§D3).
    """

    academic_year_id: UUID
    #: Brief §18 / §D6. Optional at creation — a term with no deadline never closes,
    #: which is the safe default: a wrongly-guessed deadline would lock lecturers out
    #: of a term nobody has finished teaching.
    grade_submission_deadline: datetime | None = None
    #: D32 — the mid-term grading window. Optional, and for the same reason as the
    #: deadline above: a term created without one simply has no mid-term period. Supply
    #: BOTH or NEITHER; the service rejects a half-configured window with a 422.
    midterm_submission_start: datetime | None = None
    midterm_submission_end: datetime | None = None


class SemesterUpdateRequest(BaseModel):
    """PATCH /settings/semesters/{id} (Dean only). All fields optional.

    `academic_year_id` is deliberately absent: moving a term between years would
    silently re-file every enrolment, assessment and snapshot that keys off it.
    `is_active` is absent too — that goes through `/activate`, which maintains the
    one-active invariant.

    **The three datetime fields are the ones where omitted and `null` differ** (§D6,
    D32). Every other field here treats `None` as "leave alone", but reopening a closed
    grade window — or clearing a mid-term period — is a real Dean action and it is
    spelled `null`. The service therefore consults `model_fields_set` for these fields
    rather than checking for `None`, so a PATCH that only renames a term cannot
    silently reopen or erase anything.

    The two mid-term fields must be cleared TOGETHER: sending `null` for one while the
    other keeps a value is a 422, not a silent half-clear. See `update_semester`.
    """

    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    term_type: TermType | None = None
    sequence: int | None = Field(default=None, ge=1, le=99)
    start_date: date | None = None
    end_date: date | None = None
    grade_submission_deadline: datetime | None = None
    midterm_submission_start: datetime | None = None
    midterm_submission_end: datetime | None = None


class AcademicYearCreateRequest(BaseModel):
    """POST /settings/academic-years — creates the year and its terms.

    D30: **at least one** term, no longer exactly two (§D3). The old rule required
    sequences to be precisely `[1, 2]`, which is why a Summer block could not be
    recorded. Sequences must still be DISTINCT (the per-year unique index), and the
    lowest one is the term made active.
    """

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    semesters: list[SemesterCreateRequest] = Field(min_length=1, max_length=12)


class ArchiveYearResponse(BaseModel):
    """202 body of POST /settings/academic-years/{id}/archive."""

    snapshots_written: int
    no_active_year_remaining: bool


class MidtermFreezeResponse(BaseModel):
    """200 body of POST /settings/semesters/{id}/midterm-freeze (D32, brief §6)."""

    #: Report cards captured or refreshed — one per student with a live enrolment in the
    #: term. 0 means nobody was enrolled, not that the freeze failed.
    snapshots_written: int
    semester_id: UUID
    frozen_at: datetime


# ──────────────────────────────────────────────────────────────────────────────
# Grading scale (§5.11 — Grading scale; D11)
# ──────────────────────────────────────────────────────────────────────────────
class GradingBand(BaseModel):
    """A single contiguous band. Read + write share this shape; on write the
    service validates contiguity over 0..100 (no gaps/overlaps, schema §5).

    `grade_point` is the band's value on the 4.00 scale (D30 §D5) and is what makes
    a credit-weighted GPA possible. It is OPTIONAL because a scale predating Phase 3
    carries NULLs — notably the frozen scales of archived years, which must keep the
    bands that were in force then (schema §10.4). It is nonetheless part of the WRITE
    shape: without it the Dean editing a seeded scale would post the bands back
    without their points and silently un-seed them.
    """

    model_config = ConfigDict(from_attributes=True)
    letter: str = Field(min_length=1, max_length=8)
    min_score: float = Field(ge=0, le=100)
    max_score: float = Field(ge=0, le=100)
    grade_point: float | None = Field(default=None, ge=0, le=4)
    is_passing: bool = True
    sort_order: int = Field(ge=0)


class GradingScaleRead(BaseModel):
    academic_year_id: UUID
    pass_mark: float
    is_frozen: bool
    bands: list[GradingBand]


class GradingScaleUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pass_mark: float = Field(ge=0, le=100)
    bands: list[GradingBand] = Field(min_length=1)
    # Optional explicit target; defaults to the active year's scale.
    academic_year_id: UUID | None = None


class GradingScaleUpdateResponse(GradingScaleRead):
    """200 body of PUT /settings/grading-scale. `affects_displayed_grades` warns
    the SPA that derive-on-read letters change going forward (FR-SET-06)."""

    affects_displayed_grades: bool = True


# ──────────────────────────────────────────────────────────────────────────────
# Assessment policy (§5.11 — DB-14 school defaults)
# ──────────────────────────────────────────────────────────────────────────────
class AssessmentPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    absent_as_zero: bool
    allow_makeup: bool
    drop_lowest_count: int
    #: D32 (brief §4). Dean-controlled; default false. Grouped with the grading policy
    #: because it is the same singleton and the same Dean-only screen — see the model.
    students_can_view_grades: bool = False


class AssessmentPolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    absent_as_zero: bool
    allow_makeup: bool
    drop_lowest_count: int = Field(ge=0)
    #: Defaulted rather than required, so a client that predates D32 can still PUT this
    #: object without silently re-enabling student visibility it never meant to touch.
    #: The screen always sends it.
    students_can_view_grades: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# User & role management (§5.11 — FR-SET-04)
# ──────────────────────────────────────────────────────────────────────────────
class UserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    username: str | None = None
    full_name: str
    role: Role
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None = None


class UserCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=255)
    username: str | None = Field(default=None, max_length=255)
    full_name: str = Field(min_length=1, max_length=200)
    role: Role
    # When omitted, the service generates a strong temporary password and returns
    # it ONCE in the response (admin-provisioned, D5).
    temporary_password: str | None = Field(default=None, max_length=256)


class UserCreateResponse(BaseModel):
    """201 body of POST /settings/users. `temporary_password` is returned ONCE,
    only when the server generated it (never echoed if the admin supplied one)."""

    user: UserListItem
    temporary_password: str | None = None


class UserUpdateRequest(BaseModel):
    """PATCH /settings/users/{id}. All fields optional; only role/is_active are
    privileged (principal-only). Benign profile edits (full_name) are P/S."""

    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    username: str | None = Field(default=None, max_length=255)
    role: Role | None = None
    is_active: bool | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Per-user account & preferences (§5.11 — FR-SET-05)
# ──────────────────────────────────────────────────────────────────────────────
class PreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: str | None = Field(default=None, max_length=16)
    theme: str | None = Field(default=None, max_length=16)
    date_format: str | None = Field(default=None, max_length=32)
    default_page_size: int | None = Field(default=None, ge=5, le=200)


class AccountUpdateRequest(BaseModel):
    """PATCH /settings/account (self). Contact info on the user + preferences."""

    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    preferences: PreferencesUpdate | None = None

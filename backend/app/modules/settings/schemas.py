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

from app.common.enums import AcademicYearStatus, Role
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
    name: str
    sequence: int
    start_date: date
    end_date: date
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
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    sequence: int = Field(ge=1, le=2)
    start_date: date
    end_date: date


class AcademicYearCreateRequest(BaseModel):
    """POST /settings/academic-years — service creates EXACTLY 2 semesters (D10).

    The two provided semesters must carry sequence 1 and 2 (schema enforces
    `sequence IN (1,2)` + the per-year uniqueness on sequence)."""

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    semesters: list[SemesterCreateRequest] = Field(min_length=2, max_length=2)


class ArchiveYearResponse(BaseModel):
    """202 body of POST /settings/academic-years/{id}/archive."""

    snapshots_written: int
    no_active_year_remaining: bool


# ──────────────────────────────────────────────────────────────────────────────
# Grading scale (§5.11 — Grading scale; D11)
# ──────────────────────────────────────────────────────────────────────────────
class GradingBand(BaseModel):
    """A single contiguous band. Read + write share this shape; on write the
    service validates contiguity over 0..100 (no gaps/overlaps, schema §5)."""

    model_config = ConfigDict(from_attributes=True)
    letter: str = Field(min_length=1, max_length=8)
    min_score: float = Field(ge=0, le=100)
    max_score: float = Field(ge=0, le=100)
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


class AssessmentPolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    absent_as_zero: bool
    allow_makeup: bool
    drop_lowest_count: int = Field(ge=0)


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

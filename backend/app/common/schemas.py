"""Shared Pydantic models (api-specification.md §4) — the reusable wire envelopes
and refs. Defined once here, flow into OpenAPI as reusable components.

Wire format is snake_case (api-spec §1.2) — field names are the wire names.
Write models elsewhere set `extra="forbid"`; these read/envelope models do not
need it.
"""

from __future__ import annotations

from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.common.enums import AcademicYearStatus, Role

T = TypeVar("T")


# ── Pagination (api-spec §4.1) ─────────────────────────────────────────────────
class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


# ── Error envelope (api-spec §4.2) ─────────────────────────────────────────────
class ErrorBody(BaseModel):
    code: str
    message: str
    fields: dict[str, list[str]] | None = None
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


# ── Common reusable types (api-spec §4.4) ──────────────────────────────────────
class UserPreferences(BaseModel):
    # from_attributes so `model_validate(orm_row)` works (the auth/settings
    # services validate the `user_preferences` ORM row directly).
    model_config = ConfigDict(from_attributes=True)
    locale: str
    theme: str
    date_format: str | None = None
    default_page_size: int


class CurrentUser(BaseModel):
    """GET /auth/me + login/refresh `user`. Byte-for-byte matches the frontend's
    `CurrentUser` (shared/types/api.ts)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    username: str | None = None
    full_name: str
    role: Role
    must_change_password: bool
    is_active: bool
    student_profile_id: UUID | None = None
    teacher_profile_id: UUID | None = None
    preferences: UserPreferences
    #: D32 (brief §4) — the Dean's `assessment_policies.students_can_view_grades`.
    #:
    #: Echoed on the session so the SPA can hide the Grades nav item without being handed
    #: `/settings/assessment-policy`, which is staff-only. It is a UX signal, NOT the
    #: boundary: `core.deps.require_student_grade_visibility` re-checks it on every
    #: student-facing grade endpoint (NFR-SEC-01).
    #:
    #: Reported for EVERY role, not just students, and always the raw setting. A staff
    #: member needs to see the same value to answer "why can't my students see marks?",
    #: and making it mean different things per role would make that impossible.
    students_can_view_grades: bool = False


class UserRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    full_name: str
    role: Role


class AuditStamp(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    created_at: object
    updated_at: object
    created_by: UserRef | None = None
    updated_by: UserRef | None = None


class StudentRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    student_number: str
    full_name: str


class TeacherRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    staff_number: str
    full_name: str


class CourseRef(BaseModel):
    """A catalog entry — what is taught. Renamed from `SubjectRef` by D31.

    `credits` is included because almost every screen that names a course also shows
    what it is worth, and credits live ONLY here: an offering never carries them (D31,
    and the reason the credit-weighted GPA is trustworthy).
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    code: str | None = None
    credits: int | None = None


class SemesterRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    sequence: int
    is_active: bool


class OfferingRef(BaseModel):
    """A course scheduled in a term — replaces both `ClassRef` and `ClassSubjectRef`.

    D31 merged those two. `ClassRef` described a HOMEROOM (`name` "Form 1A",
    `grade_level` "Form 1", `section` "A") and `ClassSubjectRef` wrapped it together with
    the subject it taught, because a homeroom taught many. An offering teaches exactly one
    course, so one ref covers it.

    `label` is the display string (`offering_label`: "MATH1110-01") and is sent rather
    than assembled client-side, so the backend and the demo handlers cannot disagree about
    how an offering is named — the same reasoning that put the GPA in one function.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course: CourseRef
    semester: SemesterRef | None = None
    section_code: str | None = None
    label: str


class AcademicYearRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    status: AcademicYearStatus


class SchoolIdentity(BaseModel):
    name: str
    logo_url: str | None = None
    address: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None

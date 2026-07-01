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


class ClassRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    grade_level: str
    section: str | None = None


class SubjectRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    code: str | None = None


class ClassSubjectRef(BaseModel):
    class_subject_id: UUID
    class_ref: ClassRef
    subject: SubjectRef


class SemesterRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    sequence: int
    is_active: bool


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

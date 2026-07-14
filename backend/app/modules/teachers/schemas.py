"""Teachers request/response schemas (api-spec §5 Module 4, FR-TCH-01..07).

Write models set `extra="forbid"` (api-spec §1.4). Wire format snake_case (§1.2).
Read models reuse the shared refs in `app/common/schemas.py`.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import Role, TeacherStatus
from app.common.schemas import AuditStamp, ClassRef, SubjectRef


# ──────────────────────────────────────────────────────────────────────────────
# Read models (api-spec §5.4)
# ──────────────────────────────────────────────────────────────────────────────
class TeacherListItem(BaseModel):
    """GET /teachers item (api-spec §5.4)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    staff_number: str
    full_name: str
    email: str | None = None
    status: TeacherStatus
    subject_specializations: list[str] = Field(default_factory=list)


class ClassTaught(BaseModel):
    """One (section, subject) offering this teacher is assigned to (D23)."""

    class_subject_id: UUID
    class_ref: ClassRef
    subject: SubjectRef
    is_lead: bool


class TeacherDetail(BaseModel):
    """GET /teachers/{id} + POST/PATCH/status responses (api-spec §5.4)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    staff_number: str
    full_name: str
    email: str | None = None
    phone: str | None = None
    status: TeacherStatus
    subject_specializations: list[str] = Field(default_factory=list)
    classes_taught: list[ClassTaught] = Field(default_factory=list)
    audit: AuditStamp | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Write models (api-spec §5.4)
# ──────────────────────────────────────────────────────────────────────────────
class TeacherLoginProvision(BaseModel):
    """Optional linked-account provisioning on teacher create (D5, admin-provisioned).

    Role is fixed to `teacher` (a teacher profile links to a teacher login only).
    The generated temporary password is returned ONCE on the create response.
    """

    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=255)
    role: Role = Role.TEACHER


class TeacherCreateRequest(BaseModel):
    """POST /teachers (api-spec §5.4, FR-TCH-01)."""

    model_config = ConfigDict(extra="forbid")
    staff_number: str = Field(min_length=1, max_length=32)
    full_name: str = Field(min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    status: TeacherStatus = TeacherStatus.ACTIVE
    subject_specializations: list[str] | None = None
    create_login: TeacherLoginProvision | None = None


class TeacherUpdateRequest(BaseModel):
    """PATCH /teachers/{id} (api-spec §5.4, FR-TCH-03).

    Benign profile edits only. `status` (deactivation) goes through
    POST /teachers/{id}/status (Principal-only); role change is a Settings action.
    """

    model_config = ConfigDict(extra="forbid")
    staff_number: str | None = Field(default=None, min_length=1, max_length=32)
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    subject_specializations: list[str] | None = None


class TeacherStatusRequest(BaseModel):
    """POST /teachers/{id}/status (api-spec §5.4, FR-TCH-03; Principal-only)."""

    model_config = ConfigDict(extra="forbid")
    status: TeacherStatus


class TeacherCreateResponse(BaseModel):
    """201 body of POST /teachers. `temporary_password` is returned ONCE, only when
    a linked login was provisioned and the server generated its password."""

    teacher: TeacherDetail
    temporary_password: str | None = None

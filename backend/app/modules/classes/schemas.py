"""Classes (sections) request/response schemas (api-spec §5 Module 5, FR-CLS-*).

The section is the `Class` ORM row (D23 subject-agnostic homeroom). Write models
set `extra="forbid"` (api-spec §1.4); wire format is snake_case (§1.2). Read models
reuse the shared refs in `app/common/schemas.py`.

Contract reconciled against the finished frontend MSW handler
(`frontend/src/shared/api/mocks/handlers/classes.ts`) which WINS over api-spec on
divergence: `ClassSubjectItem` carries `lead_teacher_id`; there is an extra
`GET /classes/{id}/enrollable-students` returning `{items: StudentRef[]}`.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.schemas import (
    AcademicYearRef,
    AuditStamp,
    StudentRef,
    SubjectRef,
    TeacherRef,
)


# ──────────────────────────────────────────────────────────────────────────────
# Read models
# ──────────────────────────────────────────────────────────────────────────────
class ClassListItem(BaseModel):
    """GET /classes item. `enrolled_count`/`subject_count` are derived and attached
    post-query (defaults let `model_validate` shape the ORM row directly)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    grade_level: str
    section: str | None = None
    capacity: int | None = None
    enrolled_count: int = 0
    subject_count: int = 0
    is_archived: bool


class ClassDetail(BaseModel):
    """GET /classes/{id} + POST/PATCH responses."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    grade_level: str
    section: str | None = None
    capacity: int | None = None
    academic_year: AcademicYearRef
    enrolled_count: int = 0
    over_capacity: bool = False
    is_archived: bool
    audit: AuditStamp | None = None


class ClassSubjectItem(BaseModel):
    """GET/POST /classes/{id}/subjects item + PUT teachers response.

    `lead_teacher_id` and `actionable_by_caller` follow the frontend contract."""

    class_subject_id: UUID
    subject: SubjectRef
    teachers: list[TeacherRef] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None
    assessment_count: int = 0
    is_active: bool
    actionable_by_caller: bool = False


class RosterEntry(BaseModel):
    """GET /classes/{id}/roster item + POST enrollments `enrolled` item."""

    enrollment_id: UUID
    student: StudentRef
    enrolled_at: datetime
    unenrolled_at: datetime | None = None


class TransferItem(BaseModel):
    student_id: UUID
    from_class_id: UUID


class EnrollmentResult(BaseModel):
    """POST /classes/{id}/enrollments response."""

    enrolled: list[RosterEntry] = Field(default_factory=list)
    transferred: list[TransferItem] = Field(default_factory=list)
    over_capacity_warning: bool = False


class EnrollableStudents(BaseModel):
    """GET /classes/{id}/enrollable-students response (frontend enroll-dialog picker)."""

    items: list[StudentRef] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Write models
# ──────────────────────────────────────────────────────────────────────────────
class ClassCreateRequest(BaseModel):
    """POST /classes (P/S). `academic_year_id` defaults to the active year."""

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=150)
    grade_level: str = Field(min_length=1, max_length=50)
    section: str | None = Field(default=None, max_length=2)
    capacity: int | None = Field(default=None, gt=0)
    academic_year_id: UUID | None = None


class ClassUpdateRequest(BaseModel):
    """PATCH /classes/{id} (P/S). Partial. Year is not re-assignable here."""

    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=150)
    grade_level: str | None = Field(default=None, min_length=1, max_length=50)
    section: str | None = Field(default=None, max_length=2)
    capacity: int | None = Field(default=None, gt=0)


class ClassSubjectCreateRequest(BaseModel):
    """POST /classes/{id}/subjects (P/S) — attach a subject to the section."""

    model_config = ConfigDict(extra="forbid")
    subject_id: UUID


class TeacherAssignRequest(BaseModel):
    """PUT /classes/{class_id}/subjects/{cs_id}/teachers (P/S).

    Replaces the teacher set. Empty list is allowed (removes all). `lead_teacher_id`
    must be a member of `teacher_ids`; defaults to `teacher_ids[0]` when omitted."""

    model_config = ConfigDict(extra="forbid")
    teacher_ids: list[UUID] = Field(default_factory=list)
    lead_teacher_id: UUID | None = None


class EnrollRequest(BaseModel):
    """POST /classes/{id}/enrollments (P/S). `semester_id` defaults to active."""

    model_config = ConfigDict(extra="forbid")
    student_ids: list[UUID] = Field(min_length=1)
    semester_id: UUID | None = None

"""Students request/response schemas (api-spec §5 Module 3, FR-STU-01..10).

Write models set `extra="forbid"` (api-spec §1.4) so a typo'd field fails loudly
(422) rather than being silently dropped. Wire format is snake_case (§1.2). Read
models reuse the shared refs in `app/common/schemas.py` (ClassRef, AuditStamp,
SubjectRef) where possible; the few here are Students-specific payloads.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import AssessmentType, StudentStatus
from app.common.schemas import AuditStamp, ClassRef, SubjectRef


# ──────────────────────────────────────────────────────────────────────────────
# Read models (api-spec §5.3)
# ──────────────────────────────────────────────────────────────────────────────
class StudentListItem(BaseModel):
    """GET /students item (api-spec §5.3)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    student_number: str
    full_name: str
    status: StudentStatus
    current_section: ClassRef | None = None
    guardian_name: str | None = None


class StudentDetail(BaseModel):
    """GET /students/{id}, /students/me + POST/PATCH/status responses.

    Mirrors `student_profiles` (schema §3.B) plus the derived `current_section`
    (the student's active section for the active semester) and the audit stamp.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    student_number: str
    full_name: str
    date_of_birth: date
    gender: str | None = None
    enrollment_date: date
    status: StudentStatus
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian_email: str | None = None
    address: str | None = None
    phone: str | None = None
    current_section: ClassRef | None = None
    audit: AuditStamp | None = None


class StudentAssessmentItem(BaseModel):
    """GET /students/{id}/assessments item (api-spec §5.3, FR-ASMT-06).

    A student-detail-scoped assessment summary carrying exactly the fields the
    api-spec `AssessmentSummary` enumerates. Defined locally (not imported from an
    Assessments-module schema) because that module is not built yet; the Students
    endpoint reads assessments for the subjects in the student's section directly.
    """

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    type: AssessmentType
    assessment_date: date | None = None
    max_score: float
    class_subject_id: UUID
    class_ref: ClassRef
    subject: SubjectRef
    status: str


# ──────────────────────────────────────────────────────────────────────────────
# Write models (api-spec §5.3)
# ──────────────────────────────────────────────────────────────────────────────
class StudentCreateRequest(BaseModel):
    """POST /students (api-spec §5.3, FR-STU-01/02/05).

    `status` is accepted here (defaults active). Lifecycle CHANGES after creation
    go through POST /students/{id}/status — not PATCH. `section_id`, if present,
    enrolls the student into that section for the active semester in the same
    transaction.
    """

    model_config = ConfigDict(extra="forbid")
    student_number: str = Field(min_length=1, max_length=32)
    full_name: str = Field(min_length=1, max_length=160)
    date_of_birth: date
    gender: str | None = Field(default=None, max_length=40)
    enrollment_date: date
    status: StudentStatus = StudentStatus.ACTIVE
    guardian_name: str | None = Field(default=None, max_length=160)
    guardian_phone: str | None = Field(default=None, max_length=40)
    guardian_email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=40)
    section_id: UUID | None = None


class StudentUpdateRequest(BaseModel):
    """PATCH /students/{id} (api-spec §5.3, FR-STU-03).

    All fields optional (partial update). `status` is intentionally ABSENT — it is
    NOT editable here; lifecycle goes through the dedicated status endpoint
    (auditable, guarded). `section_id` is likewise not a PATCH field — enrollment/
    transfer is a Classes-module action.
    """

    model_config = ConfigDict(extra="forbid")
    student_number: str | None = Field(default=None, min_length=1, max_length=32)
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=40)
    enrollment_date: date | None = None
    guardian_name: str | None = Field(default=None, max_length=160)
    guardian_phone: str | None = Field(default=None, max_length=40)
    guardian_email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=40)


class StudentStatusRequest(BaseModel):
    """POST /students/{id}/status (api-spec §5.3, FR-STU-04)."""

    model_config = ConfigDict(extra="forbid")
    status: StudentStatus
    reason: str | None = Field(default=None, max_length=500)

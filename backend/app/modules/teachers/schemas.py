"""Teachers request/response schemas (api-spec §5 Module 4, FR-TCH-01..07).

Write models set `extra="forbid"` (api-spec §1.4). Wire format snake_case (§1.2).
Read models reuse the shared refs in `app/common/schemas.py`.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.enums import Role, TeacherStatus
from app.common.schemas import AuditStamp, OfferingRef, CourseRef

#: `teacher_profiles.gender` is a real MariaDB `enum('male','female','other')` — unlike
#: `student_profiles.gender`, which D37 deliberately left free text because it held
#: historical rows nobody could safely re-interpret. This column was created by the
#: tertiary reconcile with no legacy data behind it, so the DB itself is the constraint
#: and this Literal simply restates it. `other` is kept: the column accepts it and the
#: lecturer form has always offered it.
TeacherGender = Literal["male", "female", "other"]

#: Teacher licence number (D39, Meeting #2 item 10: "TeacherLicense# (AlphaNumeric)").
#: The client's sample is `OWD-2019-00035`, so letters, digits and hyphens are all
#: required — this is emphatically not an integer, and validating it as one would reject
#: every real licence. Deliberately permissive beyond that: the Ministry's format is not
#: documented to us, and a stricter pattern guessed here would reject valid licences the
#: Registrar is holding in their hand. An empty string is allowed so the field can be
#: cleared, matching how the other optional text fields behave.
LICENSE_PATTERN = r"^$|^[A-Za-z0-9-]{1,15}$"


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
    """One offering this lecturer is assigned to.

    D31 collapsed `(class_ref, subject)` into a single `offering`: an offering carries its
    own course, so sending both was sending the same fact twice and inviting them to
    disagree.
    """

    offering_id: UUID
    offering: OfferingRef
    is_lead: bool


class TeacherExpertise(BaseModel):
    """One rated area of subject expertise — the profile's labelled progress bars.

    `level` is a percentage the UI renders as a bar, so it is clamped at the contract
    rather than trusted: a 140 would draw off the end of its track.
    """

    model_config = ConfigDict(extra="forbid")
    area: str = Field(min_length=1, max_length=120)
    level: int = Field(ge=0, le=100)


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
    #: Extended profile (D39). Mapped on the model since the tertiary reconcile; these
    #: were simply never surfaced. All optional — a lecturer created before the profile
    #: section existed has none of them.
    avatar_url: str | None = None
    bio: str | None = None
    gender: TeacherGender | None = None
    academic_qualification: str | None = None
    designation: str | None = None
    address: str | None = None
    expertise: list[TeacherExpertise] = Field(default_factory=list)
    #: Employment record (D39, Meeting #2 item 10). `is_employed` is DERIVED from
    #: `status` and is read-only on the wire — see `TeacherUpdateRequest`.
    first_name: str | None = None
    last_name: str | None = None
    ssno: str | None = None
    licensenum: str | None = None
    is_employed: bool | None = None
    hire_date: date | None = None
    end_date: date | None = None
    comments: str | None = None

    @field_validator("expertise", mode="before")
    @classmethod
    def _null_expertise_is_empty(cls, value: object) -> object:
        """The JSON column is NULL for every lecturer whose profile was never filled in.

        `default_factory` does not cover it: a default fires when the key is ABSENT, and
        `from_attributes` always finds the attribute — holding `None`. Without this, every
        GET /teachers/{id} for an untouched profile 500s on a read model.
        """
        return [] if value is None else value


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
    #: Employment record (D39, Meeting #2 item 10). All optional so the existing
    #: minimal-create path (staff number + name) keeps working unchanged.
    #:
    #: `is_employed` is absent DELIBERATELY, on create and on update alike: it mirrors
    #: `status`, and letting a caller set both invites an inactive lecturer flagged as
    #: employed. The service derives it.
    first_name: str | None = Field(default=None, max_length=250)
    last_name: str | None = Field(default=None, max_length=250)
    ssno: str | None = Field(default=None, max_length=9)
    licensenum: str | None = Field(default=None, max_length=15, pattern=LICENSE_PATTERN)
    hire_date: date | None = None
    end_date: date | None = None
    academic_qualification: str | None = Field(default=None, max_length=255)
    designation: str | None = Field(default=None, max_length=150)
    address: str | None = None
    comments: str | None = Field(default=None, max_length=500)


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
    #: Extended profile (D39). `extra="forbid"` meant every one of these was a 422 —
    #: the edit dialog has sent `expertise` on EVERY save since it shipped, so profile
    #: editing was broken outright rather than partially. Absent still means "leave
    #: alone"; an empty string clears the field, matching how `email` already behaves.
    avatar_url: str | None = Field(default=None, max_length=500)
    bio: str | None = None
    gender: TeacherGender | None = None
    academic_qualification: str | None = Field(default=None, max_length=255)
    designation: str | None = Field(default=None, max_length=150)
    address: str | None = None
    expertise: list[TeacherExpertise] | None = None
    #: Employment record (D39, Meeting #2 item 10). `is_employed` is NOT here — it
    #: mirrors `status`, which is changed through POST /teachers/{id}/status so that
    #: deactivating a lecturer stays a single audited action.
    first_name: str | None = Field(default=None, max_length=250)
    last_name: str | None = Field(default=None, max_length=250)
    ssno: str | None = Field(default=None, max_length=9)
    licensenum: str | None = Field(default=None, max_length=15, pattern=LICENSE_PATTERN)
    hire_date: date | None = None
    end_date: date | None = None
    comments: str | None = Field(default=None, max_length=500)


class TeacherStatusRequest(BaseModel):
    """POST /teachers/{id}/status (api-spec §5.4, FR-TCH-03; Principal-only)."""

    model_config = ConfigDict(extra="forbid")
    status: TeacherStatus


class TeacherCreateResponse(BaseModel):
    """201 body of POST /teachers. `temporary_password` is returned ONCE, only when
    a linked login was provisioned and the server generated its password."""

    teacher: TeacherDetail
    temporary_password: str | None = None

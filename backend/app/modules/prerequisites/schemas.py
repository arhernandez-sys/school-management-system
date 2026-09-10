"""Prerequisite schemas (D30 §D4).

Write models set `extra="forbid"` (api-spec §1.4). Wire format snake_case.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import PrerequisiteType


class PrerequisiteCourseRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str


class ProgramRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    name: str


class PrerequisiteItem(BaseModel):
    """One requirement standing in front of a course."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    requirement_type: PrerequisiteType
    #: The required course. NULL for `all_program_courses`, where the gate is the
    #: whole programme rather than a named course.
    prerequisite_course: PrerequisiteCourseRef | None = None
    #: NULL = the requirement applies wherever this course is taken.
    program: ProgramRef | None = None


class PrerequisiteList(BaseModel):
    """GET /courses/{id}/prerequisites."""

    items: list[PrerequisiteItem]
    #: The raw string from the course-sequence PDF, for comparison. DOCUMENTATION
    #: ONLY — validation reads `items`, never this. Surfaced so a Dean entering the
    #: relation can check it against what the PDF actually said.
    #:
    #: D45 §3b P1: it is CLEARED when the last structured requirement is removed.
    #: Leaving it behind made a successful delete look like it had failed — the dialog
    #: went on printing "Prerequisites: MATH1110" after the rule was gone, which is the
    #: defect the client reported as "I removed the prerequisite but it didn't help".
    prerequisites_text: str | None = None
    #: D45 §3b P3 — the REVERSE relation: courses that require THIS one.
    #:
    #: Read-only, and the whole point of it. Without it the only question the screen
    #: could answer was "what does this course require", so a Dean trying to open
    #: MATH1206 for enrolment would naturally open MATH1210 — the previous class, the
    #: one the 409 names — and remove ITS requirement, which changes nothing. The rule
    #: that blocks enrolment into a course is always stored ON that course.
    required_by: list[PrerequisiteCourseRef] = Field(default_factory=list)


class PrerequisiteCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requirement_type: PrerequisiteType = PrerequisiteType.COURSE
    #: Required for `course`, and must be absent for `all_program_courses` — the
    #: service rejects the mismatch rather than letting `ck_course_prereq_shape`
    #: surface as a driver error.
    prerequisite_course_id: UUID | None = None
    #: Optional for `course`. REQUIRED for `all_program_courses`: "every course in
    #: the programme" is meaningless without saying which programme.
    program_id: UUID | None = None


class EligibilityIssue(BaseModel):
    """One unmet requirement, in the shape the 409 reports it."""

    course_code: str
    course_name: str
    requirement_type: PrerequisiteType
    #: What the student actually earned, or null if they never sat it. This is the
    #: half a bare "prerequisite not met" leaves out, and it is the half the
    #: Registrar needs to decide what to do next.
    earned_letter: str | None = None
    earned_numeric: float | None = None
    reason: str = Field(
        description="Human-readable: not taken, or taken and not passed."
    )

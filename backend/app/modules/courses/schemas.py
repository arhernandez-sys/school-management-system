"""Course-catalog schemas (api-spec §5 Module 5b; D30 §D2).

Write models set `extra="forbid"` (api-spec §1.4). Wire format snake_case.

D31 finished the rename D30 started. The ORM model became `Course`, the table is
`courses`, the UI calls them Courses — and the route was the last place still saying
`/subjects`. Keeping one noun in the URL while every other layer used the other was the
kind of split that makes a codebase hard to search.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import CourseComponent

#: `courses.code` is `varchar(70)`. The old `subjects.code` cap of 40 was arbitrary;
#: 70 is the real column width, and BAJC codes like `BIOL1204L` are nowhere near it.
CODE_MAX = 70
NAME_MAX = 200


class CourseListItem(BaseModel):
    """GET /courses item (api-spec §5b)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    #: NOT NULL since D30 — `courses.code` is NOT NULL and a BAJC course is identified
    #: by its code on every programme sequence and on the report card.
    code: str
    credits: int
    component: CourseComponent | None = None
    is_active: bool


class CourseDetail(CourseListItem):
    """POST/PATCH /courses response (api-spec §5b)."""

    description: str | None = None
    #: The raw prerequisite string from the course-sequence PDF. Documentation only —
    #: enrolment validation reads `course_prerequisites` (D30 §D4, Phase 2C).
    prerequisites_text: str | None = None


class CourseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=NAME_MAX)
    #: REQUIRED since D30. It was optional against `subjects.code`, which was
    #: nullable; `courses.code` is NOT NULL, so a code-less create would fail at the
    #: database with a 500 instead of a 422 naming the field.
    code: str = Field(min_length=1, max_length=CODE_MAX)
    #: BAJC uses 1, 2, 3, 4, 6 and 9. Defaults to 3, the overwhelmingly common value
    #: and the same default `005_tertiary.sql` gave the rows carried over.
    credits: int = Field(default=3, gt=0, le=99)
    component: CourseComponent | None = None
    description: str | None = Field(default=None, max_length=2000)
    prerequisites_text: str | None = Field(default=None, max_length=255)


class CourseUpdateRequest(BaseModel):
    """PATCH /courses/{id}. All fields optional (partial update).

    `code` is `str | None` in the Python sense of "omit to leave alone", NOT "send
    null to clear" — the service rejects an empty code rather than writing one, since
    the column is NOT NULL.
    """

    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    code: str | None = Field(default=None, min_length=1, max_length=CODE_MAX)
    credits: int | None = Field(default=None, gt=0, le=99)
    component: CourseComponent | None = None
    description: str | None = Field(default=None, max_length=2000)
    prerequisites_text: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None

"""Assessments request/response schemas (api-spec Module 6, FR-ASMT-*).

Write models set `extra="forbid"` (§1.4); wire is snake_case (§1.2). Read shapes
are reconciled to the finished frontend MSW handler (which wins on divergence):
  * offering ref     = the SHARED `common.schemas.OfferingRef`
      {id, course:{id,name,code,credits}, semester?, section_code, label} (D31 — was a
      module-local `{offering_id, section:{id,name}, subject:{...}, label}`)
  * list item carries category_id; detail adds semester_id + stats
  * list item / detail carry the D47 marking window (assessments/marking.py)
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.schemas import OfferingRef


# ── Refs (frontend shape) ──────────────────────────────────────────────────────
# The offering ref is the SHARED `common.schemas.OfferingRef` (D31). This module used to
# define its own — keyed `offering_id` where Grades keyed `id`, with a `_SectionRef` that
# carried the homeroom's stored `name`. Both are gone: the label is derived now, and five
# private derivations of one string is exactly the drift `offerings/labels.py` exists to
# prevent.
class AssessmentStats(BaseModel):
    grade_count: int = 0
    graded_count: int = 0
    pending_count: int = 0


# ── Read models ────────────────────────────────────────────────────────────────
class AssessmentListItem(BaseModel):
    id: UUID
    title: str
    offering: OfferingRef | None = None
    category_id: UUID | None = None
    max_score: float
    weight: float
    assessment_date: date | None = None
    #: D47 — see `grades.schemas.GradebookAssessment` for the meaning of each.
    marking_open: bool = True
    marking_closes_at: datetime | None = None
    reopened_until: datetime | None = None
    effective_closes_at: datetime | None = None
    days_left: int | None = None


class AssessmentDetail(AssessmentListItem):
    semester_id: UUID
    stats: AssessmentStats | None = None


class CategoryDetail(BaseModel):
    id: UUID
    offering_id: UUID
    name: str
    weight: float
    drop_lowest_count: int


class CategoryList(BaseModel):
    """The offering's categories, plus the D45 §24 weighting verdict.

    Blueprint §24 shows the intended shape — Assignments 20, Quizzes 15, Midterm 25,
    Final 30, Participation 10 — and asks: "The system should verify that assessment
    weighting totals 100%."

    **This VERIFIES; it does not enforce.** `create_category` and `update_category` still
    accept any weight, because a gradebook is built one category at a time and the total
    is wrong at every step until the last one. Refusing the save would make the screen
    unusable and teach lecturers to enter fake weights to get past it. The verdict is
    reported so the screen can say so.

    **The maths is unchanged either way.** `grades/calc` divides by the weight that
    actually participated and never renormalises to 100, so categories summing to 90
    already produce a correct 0-100 result. This flags a data-entry mistake, not an
    arithmetic one.
    """

    items: list[CategoryDetail] = Field(default_factory=list)
    #: Sum of the category weights, to two places.
    weight_total: float = 0.0
    #: Whether `weight_total` is exactly 100 AND nothing is sitting outside a category.
    weight_total_ok: bool = False
    #: Assessments on this offering with no `category_id` (D45 §24).
    #:
    #: Load-bearing, not decoration. `calc` weights the synthetic uncategorised bucket by
    #: the SUM OF ITS OWN ASSESSMENT WEIGHTS so that it competes on equal footing with the
    #: explicit categories — which means that while any assessment is uncategorised, the
    #: categories do NOT account for 100% of the grade even when their weights add to 100.
    #: Reporting the total without this number would be reporting a reassuring lie.
    uncategorized_assessment_count: int = 0


class OfferingPickerList(BaseModel):
    """GET /assessments/offerings — picker feed for assessment authoring."""

    items: list[OfferingRef] = Field(default_factory=list)


# ── Write models ───────────────────────────────────────────────────────────────
class AssessmentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offering_id: UUID
    semester_id: UUID | None = None  # defaults to the active semester
    category_id: UUID | None = None
    title: str = Field(min_length=1, max_length=160)
    max_score: float = Field(gt=0)
    # Ignored: the service locks every assessment's weight at 1 (17 Oct 2026). Still
    # accepted so older clients don't 422 under extra="forbid".
    weight: float = Field(default=1.0, ge=0, le=999.99)
    assessment_date: date | None = None
    absent_as_zero: bool | None = None
    allow_makeup: bool | None = None
    drop_lowest_count: int | None = Field(default=None, ge=0)


class AssessmentUpdateRequest(BaseModel):
    """Partial. Once the marking window has closed `assessment_date` is frozen —
    moving it would move the window (D47)."""

    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=160)
    category_id: UUID | None = None
    max_score: float | None = Field(default=None, gt=0)
    weight: float | None = Field(default=None, ge=0, le=999.99)  # ignored; locked at 1
    assessment_date: date | None = None
    absent_as_zero: bool | None = None
    allow_makeup: bool | None = None
    drop_lowest_count: int | None = Field(default=None, ge=0)


class CategoryCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    weight: float = Field(default=1.0, ge=0)
    drop_lowest_count: int = Field(default=0, ge=0)


class CategoryUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=100)
    weight: float | None = Field(default=None, ge=0)
    drop_lowest_count: int | None = Field(default=None, ge=0)

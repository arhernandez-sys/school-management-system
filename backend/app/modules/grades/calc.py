"""Grade computation engine (database-schema.md §10).

The single implementation of "assessment grades -> term grade -> letter" for the
whole backend. Grades, Reports, Dashboard and the Settings archival freeze all
call in here; nothing recomputes this math locally.

Deliberately **pure**: no `Session`, no ORM, no I/O. Callers load rows and hand
over plain dataclasses, which keeps the arithmetic unit-testable without a
database (see `tests/test_grade_calc.py`, which carries no `requires_db` marker).

Four conventions are worth calling out because they are easy to get wrong:

* **The weight base is the weight that actually participated** (§10.2c). It is
  never renormalised to 100 and never assumed to sum to 100. Weights summing to
  250 still yield a 0-100 result, and a category whose assessments are all
  pending drops out of the denominator instead of dragging the average to zero.
* **Letters resolve half-open on `min_score`** (OQ-DB2, resolved 2026-07-27) --
  see `letter_for`.
* **The GPA denominator is ALL enrolled credits** (D30 decision #4), not just the
  graded ones -- an ungraded course contributes 0 quality points and keeps its
  credits. That single choice is the difference between the sample report card's
  printed 2.1 and the 3.50 a graded-only mean gives. See `compute_gpa`.
* **A makeup on a GRADED row is an approved grade revision and wins** (D30 §D7).
  `upsert_grades` refuses a makeup on a graded result, so nothing else can put one
  there; the original `score` is left untouched because §D7 requires it. See
  `_contribution_for`.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.common.enums import AssessmentStatus, GradeStatus

__all__ = [
    "BandInput",
    "CategoryInput",
    "EffectivePolicy",
    "GpaEntry",
    "GpaResult",
    "GradeInput",
    "TermGrade",
    "TermGradeRequest",
    "compute_gpa",
    "compute_term_grade",
    "compute_term_grades_bulk",
    "grade_point_for",
    "is_passing",
    "letter_for",
    "meets_grade_point",
    "percentage_for",
    "quality_points",
    "resolve_policy",
]


_ZERO = Decimal("0")
_HUNDRED = Decimal("100")
_CENTS = Decimal("0.01")

#: Terminal fallback for §10.2a when even the `assessment_policies` singleton is
#: missing. The chain is supposed to always terminate in that row, so this is a
#: belt-and-braces default rather than an expected path -- but a missing config
#: row must not take down every gradebook read.
_LAST_RESORT_POLICY_FIELDS: dict[str, bool | int] = {
    "absent_as_zero": False,
    "allow_makeup": True,
    "drop_lowest_count": 0,
}


def _dec(value: object) -> Decimal | None:
    """Coerce a DB/JSON numeric to `Decimal`, or `None` if it isn't a number.

    SQLAlchemy hands back `Decimal` for `Numeric` columns, but snapshot payloads
    and request bodies arrive as `float`/`int`/`str`, so normalise at the door.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _quantize(value: Decimal) -> Decimal:
    """Round to 2dp, HALF_UP.

    HALF_UP rather than Python's default banker's rounding: a student sitting on
    89.995 should read as 90.00, and "round half away from zero" is what a
    school actually means by rounding.
    """
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


# ── Policy resolution (§10.2a) ──────────────────────────────────────────────────


@dataclass(frozen=True)
class EffectivePolicy:
    """A fully resolved grading policy for one assessment."""

    absent_as_zero: bool
    allow_makeup: bool
    drop_lowest_count: int

    def as_dict(self) -> dict[str, bool | int]:
        """Shape written to `term_grade_snapshots.effective_policy` (§10.4)."""
        return {
            "absent_as_zero": self.absent_as_zero,
            "allow_makeup": self.allow_makeup,
            "drop_lowest_count": self.drop_lowest_count,
        }


def resolve_policy(*levels: object) -> EffectivePolicy:
    """Most-specific-wins COALESCE down the §10.2a precedence chain.

    Pass levels **most specific first**; the documented chain is::

        resolve_policy(assessment, category, academic_year, assessment_policies)

    Any level may be `None` (no category on the assessment, no config row yet)
    and is skipped. Levels are duck-typed on the three policy attribute names,
    so ORM rows can be handed over directly.

    Each field resolves **independently** (§10.2a): an assessment may override
    `drop_lowest_count` while still inheriting `absent_as_zero` from the year.

    There is deliberately no `class_subjects` level. The documented chain is the
    four above, and no screen sets an offering-level override.
    """
    resolved: dict[str, bool | int] = {}
    for field_name, fallback in _LAST_RESORT_POLICY_FIELDS.items():
        value: bool | int | None = None
        for level in levels:
            if level is None:
                continue
            candidate = getattr(level, field_name, None)
            if candidate is not None:
                value = candidate
                break
        resolved[field_name] = fallback if value is None else value

    return EffectivePolicy(
        absent_as_zero=bool(resolved["absent_as_zero"]),
        allow_makeup=bool(resolved["allow_makeup"]),
        drop_lowest_count=max(0, int(resolved["drop_lowest_count"])),
    )


# ── Inputs ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GradeInput:
    """One (assessment, grade-row-or-absence) pair feeding a term grade.

    `grade_status is None` means the student has **no** `assessment_grades` row
    at all, which §10.2b treats identically to `pending`.
    """

    assessment_id: uuid.UUID
    max_score: Decimal
    weight: Decimal
    assessment_status: AssessmentStatus
    policy: EffectivePolicy
    category_id: uuid.UUID | None = None
    grade_status: GradeStatus | None = None
    score: Decimal | None = None
    makeup_score: Decimal | None = None
    #: Effective release flag, i.e. `grade.is_released ?? assessment.is_released`.
    #: Only consulted when `compute_term_grade(..., released_only=True)`.
    is_released: bool = False


@dataclass(frozen=True)
class CategoryInput:
    """A weighted assessment category for the two-level rollup (§10.2c).

    `drop_lowest_count` must arrive **already resolved** by the caller down the
    category -> year -> school chain. Drop-lowest is a property of the group, so
    per-assessment overrides are intentionally not consulted for grouping -- the
    documented use case is a category rule ("drop the lowest 2 quizzes").
    """

    id: uuid.UUID
    weight: Decimal
    drop_lowest_count: int = 0


@dataclass(frozen=True)
class BandInput:
    """One grading-scale band.

    `max_score` is deliberately absent: `letter_for` resolves half-open on
    `min_score` alone, so a band's stored ceiling is authoring/display metadata
    and cannot introduce an unreachable gap. See `letter_for`.

    `grade_point` is the band's value on the 4.00 scale (D30 §D5). It is OPTIONAL
    and defaults to None because the column (`grading_scale_bands.grade_point`,
    added by `005_tertiary.sql` §7) is not seeded until Phase 3 — every existing
    scale carries NULL today. `meets_grade_point` degrades to `is_passing` when it
    is absent, so nothing depends on the seed having happened.
    """

    letter: str
    min_score: Decimal
    is_passing: bool = True
    grade_point: Decimal | None = None


@dataclass(frozen=True)
class TermGrade:
    """Result of a term-grade computation.

    `numeric` and `letter` are `None` when no assessment participated (all
    pending, all excused, or every weight zero) -- the frontend renders that as
    an em dash rather than a zero.
    """

    numeric: Decimal | None
    letter: str | None
    weight_base_used: Decimal


@dataclass(frozen=True)
class TermGradeRequest:
    """One unit of work for `compute_term_grades_bulk`."""

    grades: Sequence[GradeInput]
    categories: Sequence[CategoryInput] = ()
    uncategorized_drop_lowest: int = 0
    bands: Sequence[BandInput] = ()
    released_only: bool = False


@dataclass(frozen=True)
class _Contribution:
    """An assessment that survived §10.2b and now carries weight."""

    group_key: uuid.UUID | None
    value: Decimal  # 0..100 percentage, unrounded
    weight: Decimal


# ── Letters (§10.3) ────────────────────────────────────────────────────────────


def letter_for(value: object, bands: Sequence[BandInput]) -> str | None:
    """Resolve a 0-100 numeric to a letter grade. `None` if there are no bands.

    **Half-open on `min_score`** (OQ-DB2, resolved 2026-07-27): the answer is the
    highest band whose `min_score <= value`, and the band's stored `max_score` is
    never consulted.

    The bands this system ships store `.99` ceilings (A 90-100, B 80-89.99, ...).
    A strict `min <= v <= max` test against those leaves holes: 89.995 matches no
    band at all, and the frontend renders the miss as blank text where a letter
    should be. Ignoring the ceiling closes every hole, and because the bands are
    contiguous it returns exactly the same letter as a strict test for every
    value that a strict test *could* answer. It is also convention-agnostic --
    if a principal later re-enters clean `[80,90)` bands, nothing here changes.

    The value is clamped to [0, 100] and rounded HALF_UP to 2dp before lookup, so
    the result is stable against float noise and extra credit can't fall off the
    top band.
    """
    if not bands:
        return None

    numeric = _dec(value)
    if numeric is None:
        return None

    numeric = _quantize(min(max(numeric, _ZERO), _HUNDRED))
    ordered = sorted(bands, key=lambda band: _dec(band.min_score) or _ZERO, reverse=True)
    for band in ordered:
        floor = _dec(band.min_score) or _ZERO
        if numeric >= floor:
            return band.letter
    # Below every floor -- only reachable if the lowest band starts above 0.
    return ordered[-1].letter


def is_passing(value: object, bands: Sequence[BandInput], pass_mark: object) -> bool:
    """Whether a numeric is a pass: its band says so **and** it clears `pass_mark`.

    Both conditions are required (§10.3). The band carries the school's letter
    semantics; `pass_mark` is the numeric threshold Reports compares against, and
    they can be configured inconsistently.
    """
    numeric = _dec(value)
    if numeric is None:
        return False

    threshold = _dec(pass_mark)
    if threshold is not None and numeric < threshold:
        return False

    letter = letter_for(numeric, bands)
    if letter is None:
        # No scale configured: fall back to the numeric threshold alone.
        return threshold is not None and numeric >= threshold
    return any(band.letter == letter and band.is_passing for band in bands)


def grade_point_for(letter: str | None, bands: Sequence[BandInput]) -> Decimal | None:
    """The 4.00-scale value of a letter (D30 §D5). `None` if unknown.

    Returns None both when the letter matches no band AND when the matching band
    has no `grade_point` — the two are indistinguishable to a caller and both mean
    "this scale cannot answer the question". `grading_scale_bands.grade_point` is
    seeded in Phase 3; until then every band answers None, which is why
    `meets_grade_point` has a fallback rather than treating None as a failure.

    Letter comparison is case-insensitive and whitespace-trimmed: letters are
    free text on the band, and "A-" typed with a trailing space would otherwise
    silently score zero quality points.
    """
    if letter is None:
        return None
    wanted = letter.strip().casefold()
    for band in bands:
        if band.letter.strip().casefold() == wanted:
            return _dec(band.grade_point)
    return None


def meets_grade_point(
    letter: str | None,
    bands: Sequence[BandInput],
    minimum_grade_point: object,
) -> bool:
    """Did this letter clear a PROGRAMME's pass mark (D30 §D4, §D5)?

    The pass mark is per PROGRAMME — Primary Education passes at C (2.00), every
    other BAJC programme at C+ (2.50). It cannot come from
    `grading_scales.pass_mark`, which is one number per ACADEMIC YEAR and so
    cannot say two different things about two programmes running inside it.

    TWO ARMS, and the second is the one that will disappear:

      * `grade_point` known  → compare it against `minimum_grade_point`. This is
        the real rule, and it is what runs the moment Phase 3 seeds the BAJC
        8-band scale.
      * `grade_point` absent → fall back to the band's `is_passing`. Every scale
        in the database today has NULL grade points, and the alternative — treating
        unknown as a failure — would block every prerequisite-gated enrolment in
        the school on data that has not been entered yet.

    The fallback is deliberately LENIENT rather than strict for that reason, and
    it is narrower than it looks: a course with no prerequisites never reaches
    here at all.
    """
    if letter is None:
        return False

    point = grade_point_for(letter, bands)
    if point is not None:
        threshold = _dec(minimum_grade_point)
        return threshold is None or point >= threshold

    return any(
        band.letter.strip().casefold() == letter.strip().casefold() and band.is_passing
        for band in bands
    )


# ── Quality points and GPA (D30 §D5) ──────────────────────────────────────────


@dataclass(frozen=True)
class GpaEntry:
    """One course a student is ENROLLED in, as it counts toward a GPA.

    `grade_point is None` means the course carries no resolvable grade yet — the
    letter is blank, or the scale cannot answer for it. Such a row contributes **0
    quality points but its full credits** to the denominator (decision #4), which
    is what reproduces the sample report card's 2.1 rather than the 3.50 a
    graded-only mean would print.
    """

    credits: Decimal
    grade_point: Decimal | None = None


@dataclass(frozen=True)
class GpaResult:
    """A computed GPA plus the two totals it was derived from.

    Both totals are returned because a report card prints the credits alongside the
    GPA, and because "why is this 2.10?" is only answerable with the numerator and
    denominator in hand.

    `gpa` is `None` when no credits participated at all — the documents render that
    as an em dash. A 0.00 would claim the student failed everything.
    """

    gpa: Decimal | None
    total_credits: Decimal
    total_quality_points: Decimal


def quality_points(grade_point: object, credits: object) -> Decimal:
    """**Quality Points = Grade Point × Course Credits** (D30 §D5).

    An unknown grade point yields `0` rather than propagating `None`: an ungraded
    course genuinely earns no quality points, and the credits are accounted for on
    the other side of the division by `compute_gpa`.
    """
    point = _dec(grade_point)
    weight = _dec(credits)
    if point is None or weight is None:
        return _ZERO
    return point * weight


def compute_gpa(entries: Sequence[GpaEntry]) -> GpaResult:
    """**GPA = Total Quality Points ÷ Total Credits**, over ALL enrolled credits.

    Decision #4, confirmed arithmetically against the sample report card: five
    3-credit courses with three graded (B 3.00, A- 3.75, A- 3.75) and two blank
    print **2.1**, i.e. `31.50 / 15`. Restricting the denominator to graded credits
    would print 3.50, so "ungraded contributes 0 quality points but keeps its
    credits" is not a rounding detail — it is the rule.

    Negative or zero-credit rows are skipped on BOTH sides: a 0-credit course
    (there are none at BAJC, but the column permits it) must not silently give a
    letter grade a vote it did not pay credits for.

    Rounded HALF_UP to 2dp like every other figure in this module.
    """
    total_credits = _ZERO
    total_quality = _ZERO
    for entry in entries:
        credits = _dec(entry.credits)
        if credits is None or credits <= _ZERO:
            continue
        total_credits += credits
        total_quality += quality_points(entry.grade_point, credits)

    if total_credits <= _ZERO:
        return GpaResult(gpa=None, total_credits=_ZERO, total_quality_points=_ZERO)

    return GpaResult(
        gpa=_quantize(total_quality / total_credits),
        total_credits=total_credits,
        total_quality_points=_quantize(total_quality),
    )


def percentage_for(score: object, max_score: object) -> Decimal | None:
    """`score / max_score` as a 0-100 value rounded HALF_UP to 2dp.

    Used for per-cell letters in the gradebook. Rounding *before* the band lookup
    is what keeps a cell letter deterministic -- it is the other half of the
    OQ-DB2 fix described in `letter_for`.
    """
    numerator = _dec(score)
    denominator = _dec(max_score)
    if numerator is None or denominator is None or denominator <= _ZERO:
        return None
    return _quantize(numerator / denominator * _HUNDRED)


# ── Term grade (§10.2b, §10.2c) ────────────────────────────────────────────────


def _contribution_for(grade: GradeInput) -> _Contribution | None:
    """Apply §10.2b to one grade row. `None` means "excluded from both sides".

    Excluded is not the same as zero: an excused assessment leaves the weight
    base untouched, whereas an absent one under `absent_as_zero` keeps its weight
    and contributes 0. Conflating the two is the classic bug here.
    """
    max_score = _dec(grade.max_score)
    weight = _dec(grade.weight)
    if max_score is None or max_score <= _ZERO or weight is None:
        # `max_score > 0` is enforced by a CHECK constraint; defend anyway rather
        # than raising ZeroDivisionError from inside a gradebook read.
        return None

    status = grade.grade_status
    effective: Decimal | None = None

    if status == GradeStatus.GRADED:
        # ── An APPROVED GRADE REVISION (D30 §D7, Phase 5) ─────────────────────
        # A makeup on a GRADED row can only have come from a revision the Dean
        # approved, because `upsert_grades` refuses one outright (422
        # `makeup_not_allowed` — a makeup applies only to an absent result). So its
        # mere presence here IS the approval, and it wins over the original score.
        #
        # `score` is deliberately left holding what the student first earned: §D7
        # requires the original never to be overwritten, and `assessment_grades`
        # is where a reader looks for it. `grade_revision_requests` and `audit_log`
        # carry the same pair.
        #
        # **`allow_makeup` is NOT consulted on this arm**, unlike the absent one
        # below. That policy governs second SITTINGS for an absence; a Dean's
        # approved revision is an authority decision and a category that happens
        # to disable makeups must not silently discard it.
        revised = _dec(grade.makeup_score)
        if revised is not None:
            effective = revised
        else:
            effective = _dec(grade.score)
        if effective is None:
            # Barred by ck_grades_score_when_graded and by the write path's
            # 422 score_exceeds_max; excluded rather than treated as zero.
            return None
    elif status == GradeStatus.ABSENT:
        makeup = _dec(grade.makeup_score)
        if grade.policy.allow_makeup and makeup is not None:
            effective = makeup
        elif grade.policy.absent_as_zero:
            effective = _ZERO
        else:
            return None
    else:
        # pending / excused / exempt / no grade row -> excluded from numerator
        # AND weight base (§10.2b).
        return None

    return _Contribution(
        group_key=grade.category_id,
        value=effective / max_score * _HUNDRED,
        weight=weight,
    )


def _drop_lowest(items: list[_Contribution], count: int) -> list[_Contribution]:
    """Drop the `count` lowest-scoring contributions (§10.2c).

    Dropping every member is allowed and yields an empty group, which then falls
    out of the rollup denominator entirely -- rather than producing a zero or an
    empty-denominator error.
    """
    if count <= 0 or not items:
        return items
    ordered = sorted(items, key=lambda item: item.value)
    return ordered[min(count, len(ordered)) :]


def compute_term_grade(
    grades: Sequence[GradeInput],
    *,
    categories: Sequence[CategoryInput] = (),
    uncategorized_drop_lowest: int = 0,
    bands: Sequence[BandInput] = (),
    released_only: bool = False,
) -> TermGrade:
    """Weighted term grade for one (student, class_subject, semester) (§10.2).

    Only assessments whose **lifecycle** status is `graded` contribute. That is
    the safety valve for in-flight marking: an assessment still in `grading`
    shows as a gradebook column but must not swing anyone's average.

    With `released_only=True` (the student-facing path) a grade is additionally
    skipped unless its effective release flag is set, so a student's average only
    ever reflects what they can actually see.

    Aggregation is two-level when any supplied category carries weight > 0
    (grades -> category %, categories -> by `category.weight`), otherwise a flat
    weighted mean over assessment weights. Either way the denominator is the
    weight that actually participated.
    """
    contributions: list[_Contribution] = []
    for grade in grades:
        if grade.assessment_status != AssessmentStatus.GRADED:
            continue
        if released_only and not grade.is_released:
            continue
        contribution = _contribution_for(grade)
        if contribution is not None:
            contributions.append(contribution)

    if not contributions:
        return TermGrade(numeric=None, letter=None, weight_base_used=_ZERO)

    by_id = {category.id: category for category in categories}
    # A contribution pointing at an unknown category (deleted, or from another
    # offering) degrades into the uncategorized bucket rather than vanishing.
    grouped: dict[uuid.UUID | None, list[_Contribution]] = {}
    for contribution in contributions:
        key = contribution.group_key if contribution.group_key in by_id else None
        grouped.setdefault(key, []).append(contribution)

    kept: dict[uuid.UUID | None, list[_Contribution]] = {}
    for key, items in grouped.items():
        drop = by_id[key].drop_lowest_count if key in by_id else uncategorized_drop_lowest
        survivors = _drop_lowest(items, max(0, drop))
        if survivors:
            kept[key] = survivors

    if not kept:
        # Everything was dropped by drop-lowest.
        return TermGrade(numeric=None, letter=None, weight_base_used=_ZERO)

    # `weight_base_used` is reported as the participating *assessment* weight in
    # both modes -- it exists for explainability in the snapshot, and assessment
    # weight is the quantity a teacher recognises.
    weight_base = sum(
        (item.weight for items in kept.values() for item in items), start=_ZERO
    )

    two_level = any((_dec(category.weight) or _ZERO) > _ZERO for category in categories)

    if two_level:
        weighted_total = _ZERO
        group_weight_total = _ZERO
        for key, items in kept.items():
            inner_base = sum((item.weight for item in items), start=_ZERO)
            if inner_base <= _ZERO:
                # Group participated but carries no weight -> no signal to add.
                continue
            group_value = (
                sum((item.value * item.weight for item in items), start=_ZERO) / inner_base
            )
            if key in by_id:
                group_weight = _dec(by_id[key].weight) or _ZERO
            else:
                # The synthetic uncategorized bucket is weighted by the sum of
                # its own assessment weights, so it competes on equal footing
                # with the explicitly weighted categories.
                group_weight = inner_base
            if group_weight <= _ZERO:
                continue
            weighted_total += group_value * group_weight
            group_weight_total += group_weight

        if group_weight_total <= _ZERO:
            return TermGrade(numeric=None, letter=None, weight_base_used=_ZERO)
        numeric = _quantize(weighted_total / group_weight_total)
        return TermGrade(
            numeric=numeric,
            letter=letter_for(numeric, bands),
            weight_base_used=weight_base,
        )

    if weight_base <= _ZERO:
        # Every participating assessment has weight 0 -- no defensible average.
        return TermGrade(numeric=None, letter=None, weight_base_used=_ZERO)

    weighted_sum = sum(
        (item.value * item.weight for items in kept.values() for item in items),
        start=_ZERO,
    )
    numeric = _quantize(weighted_sum / weight_base)
    return TermGrade(
        numeric=numeric,
        letter=letter_for(numeric, bands),
        weight_base_used=weight_base,
    )


def compute_term_grades_bulk(
    requests: Mapping[object, TermGradeRequest],
) -> dict[object, TermGrade]:
    """Compute many term grades in one call, keyed however the caller likes.

    The point is the call *shape*, not vectorised arithmetic: Reports, the
    principal dashboard's grade distribution and the archival freeze all need
    hundreds of term grades at once, and routing them through one entry point
    keeps the loading strategy (one query set, then pure compute) honest instead
    of degenerating into per-student round trips.
    """
    return {
        key: compute_term_grade(
            request.grades,
            categories=request.categories,
            uncategorized_drop_lowest=request.uncategorized_drop_lowest,
            bands=request.bands,
            released_only=request.released_only,
        )
        for key, request in requests.items()
    }

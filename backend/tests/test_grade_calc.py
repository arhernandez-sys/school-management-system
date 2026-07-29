"""Unit suite for the grade computation engine (`app.modules.grades.calc`, schema §10).

Deliberately **DB-free** — no `requires_db` marker, no fixtures, no `Session`.
The arithmetic is where all the real risk in Grades lives, so it is locked down
here where it runs in milliseconds and cannot be masked by a skipped suite.
Run standalone with `DATABASE_URL` unset to prove the engine has no I/O.

Covers §10.2a (policy precedence), §10.2b (per-status treatment), §10.2c
(drop-lowest + weighted aggregate) and §10.3 (letters), including the OQ-DB2
band-boundary regression.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.common.enums import AssessmentStatus, GradeStatus
from app.modules.grades.calc import (
    BandInput,
    CategoryInput,
    EffectivePolicy,
    GradeInput,
    TermGradeRequest,
    compute_term_grade,
    compute_term_grades_bulk,
    is_passing,
    letter_for,
    percentage_for,
    resolve_policy,
)

D = Decimal

# The bands this system actually ships (settings/service.py `_DEFAULT_BANDS`),
# with the `.99` ceilings that motivated the OQ-DB2 decision.
SHIPPED_BANDS = [
    BandInput("A", D("90.00")),
    BandInput("B", D("80.00")),
    BandInput("C", D("70.00")),
    BandInput("D", D("60.00")),
    BandInput("F", D("0.00"), is_passing=False),
]

LENIENT = EffectivePolicy(absent_as_zero=False, allow_makeup=True, drop_lowest_count=0)
STRICT = EffectivePolicy(absent_as_zero=True, allow_makeup=False, drop_lowest_count=0)


class _Level:
    """A stand-in for one ORM row in the §10.2a chain; `None` fields inherit."""

    def __init__(self, absent_as_zero=None, allow_makeup=None, drop_lowest_count=None):
        self.absent_as_zero = absent_as_zero
        self.allow_makeup = allow_makeup
        self.drop_lowest_count = drop_lowest_count


def _grade(
    *,
    score=None,
    max_score="100",
    weight="1",
    status=GradeStatus.GRADED,
    policy=LENIENT,
    category_id=None,
    makeup_score=None,
    assessment_status=AssessmentStatus.GRADED,
    is_released=True,
):
    return GradeInput(
        assessment_id=uuid.uuid4(),
        max_score=D(max_score),
        weight=D(weight),
        assessment_status=assessment_status,
        policy=policy,
        category_id=category_id,
        grade_status=status,
        score=None if score is None else D(score),
        makeup_score=None if makeup_score is None else D(makeup_score),
        is_released=is_released,
    )


# ── §10.2a Policy resolution ───────────────────────────────────────────────────


class TestPolicyResolution:
    def test_most_specific_level_wins(self):
        policy = resolve_policy(
            _Level(absent_as_zero=True),
            _Level(absent_as_zero=False),
            _Level(absent_as_zero=False),
            _Level(absent_as_zero=False),
        )
        assert policy.absent_as_zero is True

    def test_falls_through_null_levels_in_order(self):
        # assessment silent, category silent, year says True -> year wins.
        policy = resolve_policy(_Level(), _Level(), _Level(absent_as_zero=True), _Level(absent_as_zero=False))
        assert policy.absent_as_zero is True

    def test_school_default_is_the_terminal_level(self):
        policy = resolve_policy(_Level(), _Level(), _Level(), _Level(drop_lowest_count=3))
        assert policy.drop_lowest_count == 3

    def test_none_levels_are_skipped(self):
        # An assessment with no category passes None for that level.
        policy = resolve_policy(_Level(), None, _Level(allow_makeup=False), _Level(allow_makeup=True))
        assert policy.allow_makeup is False

    def test_fields_resolve_independently(self):
        """The subtle one: overriding one field must not pin the others."""
        policy = resolve_policy(
            _Level(drop_lowest_count=2),  # assessment overrides ONLY drop-lowest
            None,
            _Level(absent_as_zero=True),  # year still supplies absent_as_zero
            _Level(absent_as_zero=False, allow_makeup=True, drop_lowest_count=0),
        )
        assert (policy.drop_lowest_count, policy.absent_as_zero, policy.allow_makeup) == (2, True, True)

    def test_empty_chain_falls_back_without_raising(self):
        """A missing `assessment_policies` row must not break a gradebook read."""
        policy = resolve_policy()
        assert policy == EffectivePolicy(absent_as_zero=False, allow_makeup=True, drop_lowest_count=0)

    def test_negative_drop_count_is_clamped(self):
        assert resolve_policy(_Level(drop_lowest_count=-5)).drop_lowest_count == 0

    def test_as_dict_is_the_snapshot_shape(self):
        assert LENIENT.as_dict() == {
            "absent_as_zero": False,
            "allow_makeup": True,
            "drop_lowest_count": 0,
        }


# ── §10.2b Per-grade treatment ─────────────────────────────────────────────────


class TestPerGradeTreatment:
    def test_graded_contributes_its_percentage(self):
        result = compute_term_grade([_grade(score="80")], bands=SHIPPED_BANDS)
        assert (result.numeric, result.letter, result.weight_base_used) == (D("80.00"), "B", D("1"))

    def test_pending_excluded_from_numerator_and_base(self):
        result = compute_term_grade(
            [_grade(score="100"), _grade(status=GradeStatus.PENDING)], bands=SHIPPED_BANDS
        )
        # If pending were a zero the average would be 50.
        assert (result.numeric, result.weight_base_used) == (D("100.00"), D("1"))

    def test_missing_grade_row_behaves_like_pending(self):
        result = compute_term_grade(
            [_grade(score="100"), _grade(status=None)], bands=SHIPPED_BANDS
        )
        assert (result.numeric, result.weight_base_used) == (D("100.00"), D("1"))

    def test_exempt_excluded(self):
        result = compute_term_grade(
            [_grade(score="90"), _grade(status=GradeStatus.EXEMPT)], bands=SHIPPED_BANDS
        )
        assert (result.numeric, result.weight_base_used) == (D("90.00"), D("1"))

    def test_excused_is_excluded_not_zero(self):
        """The classic bug: an administratively excused item must not score 0."""
        result = compute_term_grade(
            [_grade(score="90"), _grade(status=GradeStatus.EXCUSED)], bands=SHIPPED_BANDS
        )
        assert result.numeric == D("90.00")
        assert result.weight_base_used == D("1")

    def test_absent_with_makeup_substitutes_the_makeup_score(self):
        result = compute_term_grade(
            [_grade(status=GradeStatus.ABSENT, makeup_score="70", policy=LENIENT)],
            bands=SHIPPED_BANDS,
        )
        assert (result.numeric, result.letter) == (D("70.00"), "C")

    def test_absent_makeup_ignored_when_policy_disallows_it(self):
        policy = EffectivePolicy(absent_as_zero=True, allow_makeup=False, drop_lowest_count=0)
        result = compute_term_grade(
            [_grade(status=GradeStatus.ABSENT, makeup_score="70", policy=policy)],
            bands=SHIPPED_BANDS,
        )
        # Makeup disallowed, absent_as_zero on -> 0, not 70.
        assert result.numeric == D("0.00")

    def test_absent_as_zero_keeps_its_weight_in_the_base(self):
        result = compute_term_grade(
            [_grade(score="100"), _grade(status=GradeStatus.ABSENT, policy=STRICT)],
            bands=SHIPPED_BANDS,
        )
        assert (result.numeric, result.weight_base_used) == (D("50.00"), D("2"))

    def test_absent_without_makeup_or_zero_policy_is_excluded(self):
        result = compute_term_grade(
            [_grade(score="100"), _grade(status=GradeStatus.ABSENT, policy=LENIENT)],
            bands=SHIPPED_BANDS,
        )
        assert (result.numeric, result.weight_base_used) == (D("100.00"), D("1"))

    def test_graded_with_null_score_is_excluded_not_zero(self):
        result = compute_term_grade(
            [_grade(score="88"), _grade(score=None, status=GradeStatus.GRADED)],
            bands=SHIPPED_BANDS,
        )
        assert result.numeric == D("88.00")

    def test_zero_max_score_is_skipped_instead_of_dividing_by_zero(self):
        result = compute_term_grade(
            [_grade(score="10", max_score="0"), _grade(score="75")], bands=SHIPPED_BANDS
        )
        assert result.numeric == D("75.00")

    def test_only_graded_lifecycle_assessments_contribute(self):
        """An assessment still being marked must not swing the average."""
        result = compute_term_grade(
            [
                _grade(score="100"),
                _grade(score="0", assessment_status=AssessmentStatus.GRADING),
                _grade(score="0", assessment_status=AssessmentStatus.DRAFT),
                _grade(score="0", assessment_status=AssessmentStatus.PUBLISHED),
            ],
            bands=SHIPPED_BANDS,
        )
        assert (result.numeric, result.weight_base_used) == (D("100.00"), D("1"))

    def test_released_only_filters_unreleased_grades(self):
        grades = [
            _grade(score="100", is_released=True),
            _grade(score="0", is_released=False),
        ]
        teacher_view = compute_term_grade(grades, bands=SHIPPED_BANDS)
        student_view = compute_term_grade(grades, bands=SHIPPED_BANDS, released_only=True)
        assert teacher_view.numeric == D("50.00")
        assert student_view.numeric == D("100.00")

    def test_release_state_ignored_for_staff_view(self):
        result = compute_term_grade([_grade(score="90", is_released=False)], bands=SHIPPED_BANDS)
        assert result.numeric == D("90.00")


# ── §10.2c Drop-lowest ─────────────────────────────────────────────────────────


class TestDropLowest:
    def test_drops_the_n_lowest_within_a_category(self):
        cat = uuid.uuid4()
        grades = [_grade(score=s, category_id=cat) for s in ("40", "80", "90")]
        categories = [CategoryInput(id=cat, weight=D("100"), drop_lowest_count=1)]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        assert result.numeric == D("85.00")  # 40 dropped

    def test_dropped_results_leave_the_weight_base(self):
        cat = uuid.uuid4()
        grades = [_grade(score=s, category_id=cat) for s in ("40", "80", "90")]
        categories = [CategoryInput(id=cat, weight=D("100"), drop_lowest_count=1)]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        assert result.weight_base_used == D("2")

    def test_dropping_the_whole_group_yields_no_grade_not_a_crash(self):
        cat = uuid.uuid4()
        grades = [_grade(score="50", category_id=cat)]
        categories = [CategoryInput(id=cat, weight=D("100"), drop_lowest_count=5)]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        assert (result.numeric, result.letter, result.weight_base_used) == (None, None, D("0"))

    def test_uncategorized_bucket_uses_its_own_drop_count(self):
        grades = [_grade(score=s) for s in ("10", "70", "90")]
        result = compute_term_grade(grades, uncategorized_drop_lowest=1, bands=SHIPPED_BANDS)
        assert result.numeric == D("80.00")  # 10 dropped

    def test_drop_is_independent_per_category(self):
        low, high = uuid.uuid4(), uuid.uuid4()
        grades = [
            _grade(score="0", category_id=low),
            _grade(score="100", category_id=low),
            _grade(score="0", category_id=high),
            _grade(score="100", category_id=high),
        ]
        categories = [
            CategoryInput(id=low, weight=D("50"), drop_lowest_count=1),
            CategoryInput(id=high, weight=D("50"), drop_lowest_count=0),
        ]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        # low -> 100 (0 dropped); high -> 50; equal weights -> 75.
        assert result.numeric == D("75.00")

    def test_unknown_category_degrades_into_the_uncategorized_bucket(self):
        """A deleted category must not silently discard its grades."""
        orphan = uuid.uuid4()
        result = compute_term_grade([_grade(score="64", category_id=orphan)], bands=SHIPPED_BANDS)
        assert (result.numeric, result.letter) == (D("64.00"), "D")


# ── §10.2c Aggregation ─────────────────────────────────────────────────────────


class TestAggregate:
    def test_flat_weighted_mean_when_no_categories(self):
        grades = [_grade(score="90", weight="3"), _grade(score="50", weight="1")]
        result = compute_term_grade(grades, bands=SHIPPED_BANDS)
        assert (result.numeric, result.weight_base_used) == (D("80.00"), D("4"))

    def test_two_level_rollup_uses_category_weights(self):
        exams, homework = uuid.uuid4(), uuid.uuid4()
        grades = [
            _grade(score="60", category_id=exams),
            _grade(score="100", category_id=homework),
        ]
        categories = [
            CategoryInput(id=exams, weight=D("70")),
            CategoryInput(id=homework, weight=D("30")),
        ]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        # 60*0.7 + 100*0.3 = 72 -- NOT the flat 80 an unweighted mean would give.
        assert (result.numeric, result.letter) == (D("72.00"), "C")

    def test_empty_category_drops_out_of_the_denominator(self):
        graded, empty = uuid.uuid4(), uuid.uuid4()
        grades = [_grade(score="90", category_id=graded)]
        categories = [
            CategoryInput(id=graded, weight=D("50")),
            CategoryInput(id=empty, weight=D("50")),  # nothing graded here yet
        ]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        # An empty category must not drag this to 45.
        assert (result.numeric, result.letter) == (D("90.00"), "A")

    def test_weights_need_not_sum_to_one_hundred(self):
        first, second = uuid.uuid4(), uuid.uuid4()
        grades = [
            _grade(score="80", category_id=first),
            _grade(score="60", category_id=second),
        ]
        categories = [
            CategoryInput(id=first, weight=D("150")),
            CategoryInput(id=second, weight=D("100")),
        ]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        # (80*150 + 60*100) / 250 = 72 -- never renormalised to 100.
        assert result.numeric == D("72.00")

    def test_uncategorized_bucket_competes_with_weighted_categories(self):
        exams = uuid.uuid4()
        grades = [
            _grade(score="100", category_id=exams, weight="1"),
            _grade(score="0", weight="1"),  # uncategorized
        ]
        categories = [CategoryInput(id=exams, weight=D("1"))]
        result = compute_term_grade(grades, categories=categories, bands=SHIPPED_BANDS)
        assert result.numeric == D("50.00")

    def test_all_pending_yields_none(self):
        grades = [_grade(status=GradeStatus.PENDING) for _ in range(3)]
        result = compute_term_grade(grades, bands=SHIPPED_BANDS)
        assert (result.numeric, result.letter, result.weight_base_used) == (None, None, D("0"))

    def test_no_grades_at_all_yields_none(self):
        result = compute_term_grade([], bands=SHIPPED_BANDS)
        assert (result.numeric, result.letter, result.weight_base_used) == (None, None, D("0"))

    def test_all_zero_weights_yields_none_rather_than_dividing_by_zero(self):
        grades = [_grade(score="90", weight="0"), _grade(score="50", weight="0")]
        result = compute_term_grade(grades, bands=SHIPPED_BANDS)
        assert (result.numeric, result.weight_base_used) == (None, D("0"))

    def test_result_rounds_half_up_to_two_places(self):
        grades = [_grade(score="89.995", max_score="100")]
        result = compute_term_grade(grades, bands=SHIPPED_BANDS)
        assert (result.numeric, result.letter) == (D("90.00"), "A")

    def test_numeric_is_none_without_bands_but_still_computes(self):
        result = compute_term_grade([_grade(score="77")], bands=[])
        assert (result.numeric, result.letter) == (D("77.00"), None)


# ── §10.3 Letters ──────────────────────────────────────────────────────────────


class TestLetterFor:
    def test_shipped_band_floors_resolve_exactly(self):
        expected = {"90.00": "A", "89.99": "B", "80.00": "B", "70.00": "C", "60.00": "D", "59.99": "F"}
        assert {v: letter_for(D(v), SHIPPED_BANDS) for v in expected} == expected

    def test_closes_the_oq_db2_hole(self):
        """179.99/200 = 89.995 matched no band under the old strict lookup."""
        assert letter_for(percentage_for("179.99", "200"), SHIPPED_BANDS) == "A"
        assert letter_for(D("79.999"), SHIPPED_BANDS) == "B"

    def test_agrees_with_clean_half_open_bands(self):
        """Convention-agnostic: re-entered clean bands give identical answers."""
        clean = [
            BandInput("A", D("90")),
            BandInput("B", D("80")),
            BandInput("C", D("70")),
            BandInput("D", D("60")),
            BandInput("F", D("0"), is_passing=False),
        ]
        probes = [D(v) for v in ("100", "90", "89.99", "85", "80", "75", "60", "59.99", "0")]
        assert [letter_for(p, clean) for p in probes] == [letter_for(p, SHIPPED_BANDS) for p in probes]

    def test_bounds(self):
        assert letter_for(D("100"), SHIPPED_BANDS) == "A"
        assert letter_for(D("0"), SHIPPED_BANDS) == "F"

    def test_clamps_out_of_range_values(self):
        assert letter_for(D("140"), SHIPPED_BANDS) == "A"
        assert letter_for(D("-10"), SHIPPED_BANDS) == "F"

    def test_no_bands_returns_none(self):
        assert letter_for(D("85"), []) is None

    def test_value_below_every_floor_falls_to_the_lowest_band(self):
        gapped = [BandInput("A", D("90")), BandInput("B", D("50"))]
        assert letter_for(D("10"), gapped) == "B"

    def test_band_order_does_not_matter(self):
        shuffled = list(reversed(SHIPPED_BANDS))
        assert letter_for(D("85"), shuffled) == "B"

    def test_accepts_floats_and_strings(self):
        assert letter_for(85.5, SHIPPED_BANDS) == "B"
        assert letter_for("72", SHIPPED_BANDS) == "C"

    def test_non_numeric_returns_none(self):
        assert letter_for(None, SHIPPED_BANDS) is None
        assert letter_for("not-a-number", SHIPPED_BANDS) is None


class TestPercentageFor:
    def test_rounds_half_up_to_two_places(self):
        assert percentage_for("179.99", "200") == D("90.00")

    def test_plain_division(self):
        assert percentage_for("45", "50") == D("90.00")

    def test_guards_zero_and_missing_denominators(self):
        assert percentage_for("10", "0") is None
        assert percentage_for("10", None) is None
        assert percentage_for(None, "10") is None


class TestIsPassing:
    def test_passes_when_band_and_pass_mark_agree(self):
        assert is_passing(D("75"), SHIPPED_BANDS, D("60")) is True

    def test_fails_on_a_failing_band(self):
        assert is_passing(D("40"), SHIPPED_BANDS, D("60")) is False

    def test_fails_below_pass_mark_even_on_a_passing_band(self):
        """Band says D is passing, but the school's pass mark is stricter."""
        assert is_passing(D("62"), SHIPPED_BANDS, D("70")) is False

    def test_falls_back_to_pass_mark_without_bands(self):
        assert is_passing(D("75"), [], D("60")) is True
        assert is_passing(D("55"), [], D("60")) is False

    def test_none_value_is_not_a_pass(self):
        assert is_passing(None, SHIPPED_BANDS, D("60")) is False


# ── Bulk entry point ───────────────────────────────────────────────────────────


class TestSchoolClock:
    """The school-local date rule (OQ-TZ1, resolved: America/Belize).

    Lives in this DB-free suite because it is pure clock arithmetic and is the one
    thing that would silently break the attendance `future_date_not_allowed` guard.
    """

    def test_school_timezone_is_belize(self):
        from app.core.timeutil import SCHOOL_TIMEZONE

        assert str(SCHOOL_TIMEZONE) == "America/Belize"

    def test_belize_is_six_hours_behind_utc_year_round(self):
        """No DST, so the offset is stable — date arithmetic has no shift edges."""
        from datetime import datetime, timezone

        from app.core.timeutil import SCHOOL_TIMEZONE

        for month in (1, 4, 7, 10):
            probe = datetime(2026, month, 15, 12, 0, tzinfo=timezone.utc)
            offset = probe.astimezone(SCHOOL_TIMEZONE).utcoffset()
            assert offset.total_seconds() == -6 * 3600, month

    def test_school_today_matches_the_belize_calendar_not_utc(self):
        from datetime import datetime, timezone

        from app.core.timeutil import SCHOOL_TIMEZONE, school_today

        expected = datetime.now(tz=timezone.utc).astimezone(SCHOOL_TIMEZONE).date()
        assert school_today() == expected

    def test_late_evening_utc_rollover_does_not_advance_the_school_date(self):
        """The actual bug this guards.

        22:00 Belize on the 27th is 04:00 UTC on the 28th. Validating an attendance
        date against the UTC date would accept the 28th — locally tomorrow.
        """
        from datetime import datetime, timezone

        from app.core.timeutil import SCHOOL_TIMEZONE, to_school_date

        instant = datetime(2026, 7, 28, 4, 0, tzinfo=timezone.utc)
        assert instant.date().isoformat() == "2026-07-28"
        assert to_school_date(instant).isoformat() == "2026-07-27"
        assert instant.astimezone(SCHOOL_TIMEZONE).hour == 22

    def test_to_school_date_treats_naive_values_as_utc(self):
        """MariaDB hands back naive datetimes; they are UTC by convention."""
        from datetime import datetime

        from app.core.timeutil import to_school_date

        assert to_school_date(datetime(2026, 7, 28, 4, 0)).isoformat() == "2026-07-27"

    def test_to_school_date_passes_none_through(self):
        from app.core.timeutil import to_school_date

        assert to_school_date(None) is None


class TestComputeTermGradesBulk:
    def test_keys_map_to_independent_results(self):
        results = compute_term_grades_bulk(
            {
                "alice": TermGradeRequest(grades=[_grade(score="95")], bands=SHIPPED_BANDS),
                "bob": TermGradeRequest(grades=[_grade(score="65")], bands=SHIPPED_BANDS),
                "carol": TermGradeRequest(grades=[], bands=SHIPPED_BANDS),
            }
        )
        assert results["alice"].letter == "A"
        assert results["bob"].letter == "D"
        assert results["carol"].numeric is None

    def test_per_request_flags_are_honoured(self):
        grades = [_grade(score="100", is_released=True), _grade(score="0", is_released=False)]
        results = compute_term_grades_bulk(
            {
                "staff": TermGradeRequest(grades=grades, bands=SHIPPED_BANDS),
                "student": TermGradeRequest(grades=grades, bands=SHIPPED_BANDS, released_only=True),
            }
        )
        assert results["staff"].numeric == D("50.00")
        assert results["student"].numeric == D("100.00")

    def test_empty_input(self):
        assert compute_term_grades_bulk({}) == {}

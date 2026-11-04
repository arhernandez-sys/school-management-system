"""Unit suite for quality points and credit-weighted GPA (D30 §D5).

Deliberately **DB-free** — no `requires_db` marker, no fixtures, no `Session` —
mirroring `test_grade_calc.py`. The GPA is what a BAJC report card and transcript
actually print, so its arithmetic is locked down here where it runs in milliseconds
and cannot be masked by a skipped suite. Run standalone with `DATABASE_URL` unset to
prove the functions have no I/O.

**The gate case is `test_reproduces_the_sample_report_card`.** The BAJC sample report
card prints GPA 2.1 for five 3-credit courses of which only three are graded, and that
one number is the whole justification for D30 decision #4: the denominator is ALL
enrolled credits. A graded-only mean prints 3.50 for the same data, so the test asserts
both — the right answer and the wrong one it must not be.
"""

from __future__ import annotations

from decimal import Decimal

from app.modules.grades.calc import (
    BandInput,
    GpaEntry,
    compute_gpa,
    grade_point_for,
    meets_grade_point,
    quality_points,
)

D = Decimal

#: The BAJC 8-band scale, as `settings/grading_defaults.py` seeds it. `max_score` is
#: absent because `letter_for` never consults it (OQ-DB2).
BAJC_BANDS = [
    BandInput("A", D("95.00"), True, D("4.00")),
    BandInput("A-", D("90.00"), True, D("3.75")),
    BandInput("B+", D("85.00"), True, D("3.50")),
    BandInput("B", D("80.00"), True, D("3.00")),
    BandInput("C+", D("75.00"), True, D("2.50")),
    BandInput("C", D("70.00"), True, D("2.00")),
    BandInput("D", D("65.00"), False, D("1.00")),
    BandInput("F", D("0.00"), False, D("0.00")),
]

#: A scale predating Phase 3: real bands, no grade points. Still the state of every
#: archived year's frozen scale, so it is not a hypothetical.
UNPRICED_BANDS = [
    BandInput("A", D("90.00"), True),
    BandInput("B", D("80.00"), True),
    BandInput("F", D("0.00"), False),
]


# ════════════════════════════════════════════════════════════════════════════
# The gate
# ════════════════════════════════════════════════════════════════════════════
class TestSampleReportCard:
    def test_reproduces_the_sample_report_card(self) -> None:
        """`BAJC MID SEMESTER REPORT TEMPLATE.pdf`: 5 x 3cr, three graded, GPA 2.1.

        Grades B (3.00), A- (3.75), A- (3.75); two courses blank. The printed figure is
        `(3.00 + 3.75 + 3.75) x 3 / 15` = `31.50 / 15` = **2.10**.
        """
        entries = [
            GpaEntry(credits=D(3), grade_point=D("3.00")),
            GpaEntry(credits=D(3), grade_point=D("3.75")),
            GpaEntry(credits=D(3), grade_point=D("3.75")),
            GpaEntry(credits=D(3)),  # blank
            GpaEntry(credits=D(3)),  # blank
        ]
        result = compute_gpa(entries)
        assert result.gpa == D("2.10")
        assert result.total_credits == D(15)
        assert result.total_quality_points == D("31.50")

    def test_graded_only_would_have_printed_3_50(self) -> None:
        """The number decision #4 rules OUT, asserted so nobody 'fixes' the denominator.

        Dropping the two ungraded courses gives `31.50 / 9` = 3.50 — a defensible-looking
        figure that is not what BAJC prints. This test fails the moment the ungraded
        credits stop counting.
        """
        graded_only = [
            GpaEntry(credits=D(3), grade_point=D("3.00")),
            GpaEntry(credits=D(3), grade_point=D("3.75")),
            GpaEntry(credits=D(3), grade_point=D("3.75")),
        ]
        assert compute_gpa(graded_only).gpa == D("3.50")

    def test_letters_resolve_to_the_sample_grade_points(self) -> None:
        """The same figure reached through the scale rather than hand-fed points."""
        letters = ["B", "A-", "A-", None, None]
        entries = [
            GpaEntry(credits=D(3), grade_point=grade_point_for(letter, BAJC_BANDS))
            for letter in letters
        ]
        assert compute_gpa(entries).gpa == D("2.10")


# ════════════════════════════════════════════════════════════════════════════
# quality_points
# ════════════════════════════════════════════════════════════════════════════
class TestQualityPoints:
    def test_multiplies_grade_point_by_credits(self) -> None:
        assert quality_points(D("3.75"), D(3)) == D("11.25")

    def test_unknown_grade_point_is_zero_not_none(self) -> None:
        """An ungraded course earns nothing; the credits are accounted for by compute_gpa.

        Propagating None would force every caller to decide what an ungraded course
        means, which is exactly the decision that must live in one place.
        """
        assert quality_points(None, D(3)) == D(0)

    def test_unknown_credits_is_zero(self) -> None:
        assert quality_points(D("4.00"), None) == D(0)

    def test_coerces_floats_and_strings(self) -> None:
        """Snapshot payloads and request bodies arrive as float/int/str, not Decimal."""
        assert quality_points(3.5, 4) == D("14.0")
        assert quality_points("2.50", "3") == D("7.50")

    def test_zero_grade_point_still_multiplies(self) -> None:
        """An F is priced at 0.00 — genuinely zero quality points, not 'unknown'."""
        assert quality_points(D("0.00"), D(6)) == D("0.00")


# ════════════════════════════════════════════════════════════════════════════
# compute_gpa
# ════════════════════════════════════════════════════════════════════════════
class TestComputeGpa:
    def test_no_entries_is_none_not_zero(self) -> None:
        """A student with no enrolments has no GPA. 0.00 would read as total failure."""
        result = compute_gpa([])
        assert result.gpa is None
        assert result.total_credits == D(0)
        assert result.total_quality_points == D(0)

    def test_all_ungraded_is_zero_not_none(self) -> None:
        """Enrolled but nothing graded yet: credits DID participate, so the answer is
        0.00 rather than None. This is the honest reading of decision #4 — an unstarted
        term genuinely stands at zero quality points — and it is the difference the
        report card renders as `0.00` versus an em dash."""
        result = compute_gpa([GpaEntry(credits=D(3)), GpaEntry(credits=D(4))])
        assert result.gpa == D("0.00")
        assert result.total_credits == D(7)

    def test_single_course(self) -> None:
        assert compute_gpa([GpaEntry(credits=D(3), grade_point=D("4.00"))]).gpa == D("4.00")

    def test_weights_by_credits_not_by_course_count(self) -> None:
        """A 9-credit A and a 1-credit F are not a 2.00 average.

        `(4.00 x 9 + 0.00 x 1) / 10` = 3.60. An unweighted mean of the grade points
        would give 2.00, and the two only ever agree when every course has the same
        credit value — which at BAJC they do not (credits run 1, 2, 3, 4, 6, 9).
        """
        result = compute_gpa(
            [
                GpaEntry(credits=D(9), grade_point=D("4.00")),
                GpaEntry(credits=D(1), grade_point=D("0.00")),
            ]
        )
        assert result.gpa == D("3.60")
        assert result.total_credits == D(10)

    def test_zero_credit_rows_are_skipped_on_both_sides(self) -> None:
        """A 0-credit course must not get a vote it did not pay credits for.

        Counting it in the numerator via `grade_point x 0` is harmless, but counting it
        as a participant would be wrong if it ever gained a nonzero weight elsewhere;
        skipping it on both sides keeps the two sides consistent.
        """
        result = compute_gpa(
            [
                GpaEntry(credits=D(3), grade_point=D("4.00")),
                GpaEntry(credits=D(0), grade_point=D("0.00")),
            ]
        )
        assert result.gpa == D("4.00")
        assert result.total_credits == D(3)

    def test_negative_credits_are_skipped(self) -> None:
        result = compute_gpa(
            [
                GpaEntry(credits=D(3), grade_point=D("2.00")),
                GpaEntry(credits=D(-3), grade_point=D("4.00")),
            ]
        )
        assert result.gpa == D("2.00")
        assert result.total_credits == D(3)

    def test_only_zero_credit_rows_is_none(self) -> None:
        assert compute_gpa([GpaEntry(credits=D(0), grade_point=D("4.00"))]).gpa is None

    def test_rounds_half_up_to_2dp(self) -> None:
        """HALF_UP, matching every other figure in `calc` — never banker's rounding.

        `(2.00 x 1 + 2.01 x 1) / 2` = 2.005, which HALF_UP renders 2.01 and Python's
        default `round()` would render 2.00.
        """
        result = compute_gpa(
            [
                GpaEntry(credits=D(1), grade_point=D("2.00")),
                GpaEntry(credits=D(1), grade_point=D("2.01")),
            ]
        )
        assert result.gpa == D("2.01")

    def test_repeating_decimal_is_quantized(self) -> None:
        """`(4.00 + 3.00 + 2.00) / 3` divides cleanly; 10/3 credits does not."""
        result = compute_gpa(
            [
                GpaEntry(credits=D(3), grade_point=D("4.00")),
                GpaEntry(credits=D(3), grade_point=D("3.75")),
                GpaEntry(credits=D(4), grade_point=D("2.00")),
            ]
        )
        # (12.00 + 11.25 + 8.00) / 10 = 3.125 -> 3.13 HALF_UP
        assert result.gpa == D("3.13")

    def test_accepts_non_decimal_inputs(self) -> None:
        """Credits arrive from a smallint column as `int`, not Decimal."""
        result = compute_gpa([GpaEntry(credits=3, grade_point=4.0)])
        assert result.gpa == D("4.00")


# ════════════════════════════════════════════════════════════════════════════
# grade_point_for / meets_grade_point against the SEEDED scale
# ════════════════════════════════════════════════════════════════════════════
class TestGradePointForSeededScale:
    def test_every_bajc_letter_prices(self) -> None:
        got = {b.letter: grade_point_for(b.letter, BAJC_BANDS) for b in BAJC_BANDS}
        assert got == {
            "A": D("4.00"), "A-": D("3.75"), "B+": D("3.50"), "B": D("3.00"),
            "C+": D("2.50"), "C": D("2.00"), "D": D("1.00"), "F": D("0.00"),
        }

    def test_letter_matching_ignores_case_and_whitespace(self) -> None:
        """Letters are free text on the band, so `"A- "` must not score zero."""
        assert grade_point_for("a-", BAJC_BANDS) == D("3.75")
        assert grade_point_for(" A- ", BAJC_BANDS) == D("3.75")

    def test_unknown_letter_is_none(self) -> None:
        assert grade_point_for("Z", BAJC_BANDS) is None

    def test_none_letter_is_none(self) -> None:
        assert grade_point_for(None, BAJC_BANDS) is None

    def test_unpriced_band_is_none_not_zero(self) -> None:
        """A band with no grade point cannot answer — and NULL is not an F.

        This is why `compute_gpa` treats None as 0 quality points but keeps the credits,
        rather than `grade_point_for` inventing a 0.00 that would look like a fail.
        """
        assert grade_point_for("A", UNPRICED_BANDS) is None


class TestMeetsGradePointOnTheSeededScale:
    """Phase 2C wrote `meets_grade_point` with a lenient fallback because no scale had
    grade points yet. Now that the BAJC scale seeds them, the REAL arm runs — and these
    tests are what prove the fallback stopped being load-bearing."""

    def test_c_passes_primary_education_at_2_00(self) -> None:
        assert meets_grade_point("C", BAJC_BANDS, D("2.00")) is True

    def test_c_fails_every_other_programme_at_2_50(self) -> None:
        """The same grade, two answers — the whole reason the pass mark is
        per-programme rather than per-academic-year (§D5)."""
        assert meets_grade_point("C", BAJC_BANDS, D("2.50")) is False

    def test_c_plus_passes_both(self) -> None:
        assert meets_grade_point("C+", BAJC_BANDS, D("2.00")) is True
        assert meets_grade_point("C+", BAJC_BANDS, D("2.50")) is True

    def test_d_fails_both_programmes(self) -> None:
        """D is priced 1.00. It clears no programme, which is why the seeded scale
        also marks it `is_passing=False` — the two rules must not disagree."""
        assert meets_grade_point("D", BAJC_BANDS, D("2.00")) is False
        assert meets_grade_point("D", BAJC_BANDS, D("2.50")) is False

    def test_f_fails(self) -> None:
        assert meets_grade_point("F", BAJC_BANDS, D("2.00")) is False

    def test_none_letter_fails(self) -> None:
        assert meets_grade_point(None, BAJC_BANDS, D("2.00")) is False

    def test_unpriced_scale_falls_back_to_is_passing(self) -> None:
        """An archived year's frozen scale keeps NULL points, so the lenient arm has to
        survive: it is what stops a pre-Phase-3 result from blocking an enrolment."""
        assert meets_grade_point("B", UNPRICED_BANDS, D("2.50")) is True
        assert meets_grade_point("F", UNPRICED_BANDS, D("2.50")) is False

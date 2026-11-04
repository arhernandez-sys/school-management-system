"""The grading scale this system ships — **one definition** (D30 §D5).

Before Phase 3 the default band set was written out twice, in
`app/db/seed.py` and `app/modules/settings/service.py`, and the two were kept in
step by hand. This project has already paid twice for a rule living in two places
(see the demo-mode/backend divergences recorded in the D30 plan's change log), so
the bands now live here and both callers import them.

**The BAJC 8-band scale** replaces the generic `A/B/C/D/F` one the repo shipped as a
sixth-form SIMS. Two things about it are easy to get wrong:

* **Ceilings are the integers BAJC prints** (A- is 90-94, not 90-94.99). That is safe
  because `grades.calc.letter_for` is half-open on `min_score` and never consults
  `max_score` (OQ-DB2), and because `settings.service._validate_band_contiguity`
  flags a gap only when it exceeds 1.0 — so the 1-point steps between bands pass
  validation as written rather than needing the old `.99` dressing.
* **D is NOT a pass, and `pass_mark` is 70 to match.** D carries a grade point of
  1.00, which fails every BAJC programme's `min_passing_grade_point` (2.00 for
  Primary Education, 2.50 everywhere else). Leaving `is_passing` true on D while the
  programme rule rejected it would have made `calc.is_passing` and
  `calc.meets_grade_point` disagree about the same result — C (2.00) is the lowest
  pass in the system, and the numeric threshold now says so too.

`grade_point` is what Phase 3 exists for: with it seeded,
`calc.meets_grade_point` stops using its lenient `is_passing` fallback and starts
comparing real grade points, and `calc.compute_gpa` has something to weight.
"""

from __future__ import annotations

#: Numeric pass threshold stored on `grading_scales.pass_mark` for a new year.
#: 70 = C's floor, the lowest passing band below.
DEFAULT_PASS_MARK = "70.00"

#: `(letter, min_score, max_score, grade_point, is_passing, sort_order)`.
#: Ordered highest band first, which is also `sort_order` order.
BAJC_GRADING_BANDS: tuple[tuple[str, str, str, str, bool, int], ...] = (
    ("A",  "95.00", "100.00", "4.00", True,  1),
    ("A-", "90.00", "94.00",  "3.75", True,  2),
    ("B+", "85.00", "89.00",  "3.50", True,  3),
    ("B",  "80.00", "84.00",  "3.00", True,  4),
    ("C+", "75.00", "79.00",  "2.50", True,  5),
    ("C",  "70.00", "74.00",  "2.00", True,  6),
    ("D",  "65.00", "69.00",  "1.00", False, 7),
    ("F",  "0.00",  "64.00",  "0.00", False, 8),
)

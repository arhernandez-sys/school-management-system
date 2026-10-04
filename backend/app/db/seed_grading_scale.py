"""Re-band existing grading scales onto the BAJC 8-band scale — D30 Phase 3 §D5.

    Run:  python -m app.db.seed_grading_scale            (from backend/, venv active)
          python -m app.db.seed_grading_scale --dry-run  (report only, write nothing)

`app/db/seed.py` and `POST /settings/academic-years` now create the BAJC scale from
`settings/grading_defaults.py`, but that only helps a year created FROM NOW ON. Every
year already in the database carries the generic 5-band `A/B/C/D/F` scale with
`grade_point` NULL on every row, which is precisely the state that makes
`calc.meets_grade_point` fall back to `is_passing` and `calc.compute_gpa` weightless.
This script closes that gap.

**FROZEN SCALES ARE SKIPPED, and that is the point, not a limitation.** A scale is
frozen when its academic year is archived, and schema §10.4 guarantees an archived
year keeps the rules that were in force when it ran: re-lettering 2024-2025 would
change report cards parents already received. Those years keep their 5-band scale and
their NULL grade points, so a prerequisite judged on one of their results still
travels `meets_grade_point`'s lenient `is_passing` arm — by design.

IDEMPOTENT by natural key (scale + band letter), like `seed_bajc.py`: a second run
reports every band unchanged. Bands not in the BAJC set (the old `A`/`B`/`C`/`D`
rows, whose letters overlap, plus nothing else) are DELETED from the scales being
re-banded, because a scale must tile 0..100 exactly once — leaving the old `A 90-100`
next to the new `A 95-100` would be a duplicate letter and an overlap at the same time.
"""

from __future__ import annotations

import argparse
import sys
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.settings.grading_defaults import (
    BAJC_GRADING_BANDS,
    DEFAULT_PASS_MARK,
)
from app.modules.settings.models import (
    AcademicYear,
    GradingScale,
    GradingScaleBand,
)

# AuditMixin's `created_by`/`updated_by` FKs are declared as the string "users.id" and
# resolved against the metadata at flush time; without this import the first flush dies
# with NoReferencedTableError. Same reason as in seed_bajc.py.
from app.modules.users.models import User  # noqa: F401


class Report:
    """What changed, printed at the end. A seed that says nothing is a seed nobody checks."""

    def __init__(self) -> None:
        self.scales_updated = 0
        self.scales_skipped_frozen = 0
        self.bands_created = 0
        self.bands_updated = 0
        self.bands_unchanged = 0
        self.bands_deleted = 0
        self.notes: list[str] = []


def _reband(db: Session, scale: GradingScale, year_name: str, report: Report) -> None:
    existing = {
        b.letter.strip(): b
        for b in db.scalars(
            select(GradingScaleBand).where(
                GradingScaleBand.grading_scale_id == scale.id
            )
        ).all()
    }

    wanted_letters = {letter for (letter, *_rest) in BAJC_GRADING_BANDS}

    for letter, low, high, gp, passing, order in BAJC_GRADING_BANDS:
        target = (
            Decimal(low),
            Decimal(high),
            Decimal(gp),
            passing,
            order,
        )
        band = existing.get(letter)
        if band is None:
            db.add(
                GradingScaleBand(
                    grading_scale_id=scale.id,
                    letter=letter,
                    min_score=target[0],
                    max_score=target[1],
                    grade_point=target[2],
                    is_passing=target[3],
                    sort_order=target[4],
                )
            )
            report.bands_created += 1
            continue

        current = (
            Decimal(band.min_score),
            Decimal(band.max_score),
            None if band.grade_point is None else Decimal(band.grade_point),
            bool(band.is_passing),
            int(band.sort_order),
        )
        if current == target:
            report.bands_unchanged += 1
            continue
        band.min_score, band.max_score, band.grade_point = target[0], target[1], target[2]
        band.is_passing, band.sort_order = target[3], target[4]
        report.bands_updated += 1

    # Letters the BAJC scale does not have (the legacy `D` is reused, so in practice
    # this is nothing on a repo-provisioned database) must go: the validator requires
    # the bands to tile 0..100 exactly once, and a leftover `A 90-100` beside the new
    # `A- 90-94` is both a gap-free overlap and a live mis-lettering.
    for letter, band in existing.items():
        if letter in wanted_letters:
            continue
        db.delete(band)
        report.bands_deleted += 1
        report.notes.append(f"{year_name}: removed legacy band '{letter}'.")

    if Decimal(scale.pass_mark) != Decimal(DEFAULT_PASS_MARK):
        report.notes.append(
            f"{year_name}: pass_mark {scale.pass_mark} -> {DEFAULT_PASS_MARK} "
            "(C's floor, the lowest passing BAJC band)."
        )
        scale.pass_mark = Decimal(DEFAULT_PASS_MARK)

    report.scales_updated += 1


def run_seed(*, dry_run: bool = False) -> Report:
    report = Report()
    with SessionLocal() as db:
        rows = db.execute(
            select(GradingScale, AcademicYear)
            .join(AcademicYear, GradingScale.academic_year_id == AcademicYear.id)
            .order_by(AcademicYear.start_date)
        ).all()

        for scale, year in rows:
            if scale.is_frozen:
                report.scales_skipped_frozen += 1
                report.notes.append(
                    f"{year.name}: SKIPPED - scale frozen (year archived). It keeps "
                    "the bands that were in force then (schema 10.4)."
                )
                continue
            _reband(db, scale, year.name, report)

        db.flush()
        if dry_run:
            db.rollback()
        else:
            db.commit()
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change and roll back",
    )
    args = parser.parse_args()

    print("Re-banding grading scales onto the BAJC 8-band scale (D30 D5)...")
    if args.dry_run:
        print("DRY RUN - nothing will be committed.\n")
    report = run_seed(dry_run=args.dry_run)

    print()
    print(f"  scales re-banded    : {report.scales_updated}")
    print(f"  scales skipped      : {report.scales_skipped_frozen} (frozen)")
    print(f"  bands created       : {report.bands_created}")
    print(f"  bands updated       : {report.bands_updated}")
    print(f"  bands unchanged     : {report.bands_unchanged}")
    print(f"  bands deleted       : {report.bands_deleted}")
    if report.notes:
        print("\nNotes:")
        for note in report.notes:
            print(f"  * {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

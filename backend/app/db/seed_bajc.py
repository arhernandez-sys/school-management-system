"""Seed the real BAJC catalog, programmes, curriculum and prerequisites — D30 Phase 2D.

Loads `app/db/bajc_catalog.py` (generated from the 2026/27 course-sequence PDF and
hand-corrected — read its docstring for every correction and open question) into
`courses`, `programs`, `program_courses` and `course_prerequisites`.

    Run:  python -m app.db.seed_bajc            (from backend/, venv active)
          python -m app.db.seed_bajc --dry-run  (report only, write nothing)

THIS IS REFERENCE DATA, NOT DEMO DATA. It is what the college actually offers, so it
belongs with the bootstrap seed rather than `db/mariadb/seed_demo.py`. It creates no
students, no offerings and no grades.

IDEMPOTENT, and by natural key rather than by generated id: courses by `code`,
programmes by `code`, curriculum rows by (programme, course), prerequisites by
(course, required course, programme). A second run makes no duplicates, and a course
that already exists is UPDATED to the source's name/credits/component rather than
skipped — that is what makes this file the way a corrected sequence gets applied.

WHAT IT DELIBERATELY DOES NOT TOUCH:

  * Courses in the catalog that are NOT in the PDF. The pre-D30 demo subjects
    (Mathematics, English, …) are carried-over rows with live `class_subjects` and
    grades behind them; deleting them would orphan history. They are reported and
    left alone.
  * `courses.is_active`. Retiring a course is the Dean's decision, not a seed's.
"""

from __future__ import annotations

import argparse
import sys
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import CourseComponent, PrerequisiteType
from app.db.bajc_catalog import (
    ALL_PROGRAM_COURSE_GATES,
    COURSE_PREREQUISITES,
    COURSES,
    CURRICULUM,
    PROGRAMS,
)
from app.db.session import SessionLocal
from app.modules.offerings.models import Course
from app.modules.prerequisites.models import CoursePrerequisite
from app.modules.programs.models import Program, ProgramCourse

# Every table here carries AuditMixin, whose `created_by`/`updated_by` FKs are declared
# as the STRING "users.id" and resolved against the metadata at flush time. Without
# this import the first flush dies with NoReferencedTableError.
from app.modules.users.models import User  # noqa: F401


class Report:
    """Counts, printed at the end. A seed that says nothing is a seed nobody checks."""

    def __init__(self) -> None:
        self.created: dict[str, int] = {}
        self.updated: dict[str, int] = {}
        self.unchanged: dict[str, int] = {}
        self.notes: list[str] = []

    def bump(self, bucket: dict[str, int], kind: str) -> None:
        bucket[kind] = bucket.get(kind, 0) + 1

    def line(self, kind: str) -> str:
        return (
            f"  {kind:<22} "
            f"created {self.created.get(kind, 0):>4}   "
            f"updated {self.updated.get(kind, 0):>4}   "
            f"unchanged {self.unchanged.get(kind, 0):>4}"
        )


def _seed_courses(db: Session, report: Report) -> dict[str, Course]:
    by_code: dict[str, Course] = {
        c.code.upper(): c
        for c in db.scalars(select(Course).where(Course.deleted_at.is_(None))).all()
    }

    for code, name, credits, component, prereq_text in COURSES:
        existing = by_code.get(code.upper())
        component_enum = CourseComponent(component)
        if existing is None:
            course = Course(
                code=code,
                name=name,
                credits=credits,
                component=component_enum,
                prerequisites_text=prereq_text,
                is_active=True,
            )
            db.add(course)
            db.flush()
            by_code[code.upper()] = course
            report.bump(report.created, "courses")
            continue

        changed = False
        for attr, value in (
            ("name", name),
            ("credits", credits),
            ("component", component_enum),
            ("prerequisites_text", prereq_text),
        ):
            if getattr(existing, attr) != value:
                setattr(existing, attr, value)
                changed = True
        report.bump(report.updated if changed else report.unchanged, "courses")

    seeded = {code.upper() for code, *_ in COURSES}
    extra = sorted(c.code for k, c in by_code.items() if k not in seeded)
    if extra:
        report.notes.append(
            f"{len(extra)} catalog course(s) are NOT in the 26/27 sequences and were left "
            f"untouched (they may carry live offerings and grades): {', '.join(extra)}"
        )
    return by_code


def _seed_programs(db: Session, report: Report) -> dict[str, Program]:
    by_code: dict[str, Program] = {
        p.code.upper(): p
        for p in db.scalars(select(Program).where(Program.deleted_at.is_(None))).all()
    }

    for code, name, award, total_credits, min_gp in PROGRAMS:
        existing = by_code.get(code.upper())
        gp = Decimal(min_gp)
        if existing is None:
            program = Program(
                code=code,
                name=name,
                award=award,
                total_credits=total_credits,
                min_passing_grade_point=gp,
                is_active=True,
            )
            db.add(program)
            db.flush()
            by_code[code.upper()] = program
            report.bump(report.created, "programmes")
            continue

        changed = False
        for attr, value in (
            ("name", name),
            ("award", award),
            ("total_credits", total_credits),
            ("min_passing_grade_point", gp),
        ):
            current = getattr(existing, attr)
            if attr == "min_passing_grade_point":
                if Decimal(str(current)) == value:
                    continue
            elif current == value:
                continue
            setattr(existing, attr, value)
            changed = True
        report.bump(report.updated if changed else report.unchanged, "programmes")

    return by_code


def _seed_curriculum(
    db: Session,
    report: Report,
    courses: dict[str, Course],
    programs: dict[str, Program],
) -> None:
    for program_code, blocks in CURRICULUM.items():
        program = programs[program_code.upper()]
        existing = {
            row.course_id: row
            for row in db.scalars(
                select(ProgramCourse).where(ProgramCourse.program_id == program.id)
            ).all()
        }
        for term_label, term_order, course_codes in blocks:
            for course_code in course_codes:
                course = courses[course_code.upper()]
                row = existing.get(course.id)
                if row is None:
                    db.add(
                        ProgramCourse(
                            program_id=program.id,
                            course_id=course.id,
                            term_label=term_label,
                            term_order=term_order,
                            # Every course printed on a sequence is part of the award.
                            # The PDF marks no electives; the `*` footnote on four
                            # Mathematics courses has no legend, so it is NOT read as
                            # one (see the catalog docstring).
                            is_required=True,
                        )
                    )
                    report.bump(report.created, "curriculum rows")
                    continue
                changed = row.term_label != term_label or row.term_order != term_order
                if changed:
                    row.term_label = term_label
                    row.term_order = term_order
                report.bump(
                    report.updated if changed else report.unchanged, "curriculum rows"
                )


def _seed_prerequisites(
    db: Session,
    report: Report,
    courses: dict[str, Course],
    programs: dict[str, Program],
) -> None:
    def exists(course_id, prereq_id, program_id) -> bool:  # noqa: ANN001
        return (
            db.scalar(
                select(CoursePrerequisite.id).where(
                    CoursePrerequisite.course_id == course_id,
                    CoursePrerequisite.prerequisite_course_id == prereq_id,
                    CoursePrerequisite.program_id == program_id,
                )
            )
            is not None
        )

    for course_code, required_code in COURSE_PREREQUISITES:
        course = courses.get(course_code.upper())
        required = courses.get(required_code.upper())
        if course is None or required is None:
            report.notes.append(
                f"prerequisite skipped — unknown course: {course_code} <- {required_code}"
            )
            continue
        if exists(course.id, required.id, None):
            report.bump(report.unchanged, "prerequisites")
            continue
        db.add(
            CoursePrerequisite(
                course_id=course.id,
                prerequisite_course_id=required.id,
                program_id=None,
                requirement_type=PrerequisiteType.COURSE,
            )
        )
        report.bump(report.created, "prerequisites")

    for course_code, program_code in ALL_PROGRAM_COURSE_GATES:
        course = courses[course_code.upper()]
        program = programs[program_code.upper()]
        if exists(course.id, None, program.id):
            report.bump(report.unchanged, "ALL-COURSES gates")
            continue
        db.add(
            CoursePrerequisite(
                course_id=course.id,
                prerequisite_course_id=None,
                program_id=program.id,
                requirement_type=PrerequisiteType.ALL_PROGRAM_COURSES,
            )
        )
        report.bump(report.created, "ALL-COURSES gates")


def run_seed(*, dry_run: bool = False) -> Report:
    report = Report()
    with SessionLocal() as db:
        courses = _seed_courses(db, report)
        programs = _seed_programs(db, report)
        db.flush()
        _seed_curriculum(db, report, courses, programs)
        _seed_prerequisites(db, report, courses, programs)
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

    print("Seeding the BAJC catalog (2026/27 course sequences)...")
    if args.dry_run:
        print("DRY RUN — nothing will be committed.\n")
    report = run_seed(dry_run=args.dry_run)

    print()
    for kind in ("courses", "programmes", "curriculum rows", "prerequisites",
                 "ALL-COURSES gates"):
        print(report.line(kind))
    if report.notes:
        print("\nNotes:")
        for note in report.notes:
            print(f"  * {note}")
    print(
        "\nSource corrections and open questions are documented in "
        "`app/db/bajc_catalog.py` and plan §G."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Verify that every hand-written MariaDB migration is actually applied - read-only.

WHY THIS EXISTS
    There is no `schema_migrations` table and Alembic cannot run here, so nothing in this
    repo could answer "is the database at the revision the code expects?".
    `apply_sql.py --check` lists tables and row counts, which is not the same question.

    That gap hid a real defect (D31, 2026-08-18). `005_tertiary.sql` dropped the two
    constraints `006_courses_cutover.sql` creates and re-added the ones pointing at
    `subjects`. Both files applied "successfully"; because `005` is idempotent and
    replaying it is encouraged, `005` silently reverted `006`, leaving the catalog FKs on
    `subjects` while the ORM wrote to `courses`. The visible symptom was 114 of 125
    `courses` rows being impossible to attach to an offering - three layers from the
    cause. Nothing failed, nothing logged. That is the class of bug this script exists to
    make loud.

WHAT IT CHECKS
    Each migration is fingerprinted by the schema facts only IT can have produced:
    tables, columns, constraint targets, generated columns, dropped columns. A migration
    is APPLIED when every probe holds, MISSING when none do, and PARTIAL when some do.
    PARTIAL is the interesting verdict - `apply_sql.py` continues past a failing
    statement, so a half-applied file is a normal outcome and was previously invisible.

USAGE (from the `backend` directory - .env is loaded by a RELATIVE path)

    .\\.venv\\Scripts\\python.exe db\\mariadb\\verify_schema.py
    .\\.venv\\Scripts\\python.exe db\\mariadb\\verify_schema.py --verbose
    .\\.venv\\Scripts\\python.exe db\\mariadb\\verify_schema.py --expect 007

    Exit 0 when every migration up to --expect (default: the highest known) is APPLIED,
    1 otherwise. Suitable for CI or a pre-deploy gate.

MAINTAINING IT
    Adding a migration means adding a MIGRATIONS entry. Pick probes that ONLY that file
    can satisfy - a table it creates, a column it drops, a constraint whose target it
    moves. Do not probe something an earlier file already guaranteed, or the new
    migration reads APPLIED before it has ever run.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_sql import connection_kwargs  # noqa: E402  (same-dir helper, one DSN source)


# --------------------------------------------------------------------------------------
# Probe primitives. Each returns (ok, detail) and reads only information_schema.
# --------------------------------------------------------------------------------------
def _scalar(cur, sql: str, args: tuple = ()) -> object:
    cur.execute(sql, args)
    row = cur.fetchone()
    return None if row is None else row[0]


def _count_table(cur, name: str) -> int:
    return int(
        _scalar(
            cur,
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = %s",
            (name,),
        )
        or 0
    )


def _column_field(cur, table: str, column: str, field: str):
    return _scalar(
        cur,
        f"SELECT {field} FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = %s AND column_name = %s",
        (table, column),
    )


def _count_column(cur, table: str, column: str) -> int:
    return int(
        _scalar(
            cur,
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = %s AND column_name = %s",
            (table, column),
        )
        or 0
    )


def table_exists(name: str):
    def probe(cur):
        n = _count_table(cur, name)
        return bool(n), f"table `{name}`" + ("" if n else " MISSING")

    return probe


def table_absent(name: str):
    def probe(cur):
        n = _count_table(cur, name)
        return not n, f"table `{name}` absent" + (" (STILL PRESENT)" if n else "")

    return probe


def column_exists(table: str, column: str):
    def probe(cur):
        n = _count_column(cur, table, column)
        return bool(n), f"`{table}`.`{column}`" + ("" if n else " MISSING")

    return probe


def column_absent(table: str, column: str):
    def probe(cur):
        n = _count_column(cur, table, column)
        return not n, f"`{table}`.`{column}` dropped" + (" (STILL PRESENT)" if n else "")

    return probe


def column_not_null(table: str, column: str):
    def probe(cur):
        v = _column_field(cur, table, column, "is_nullable")
        return v == "NO", f"`{table}`.`{column}` NOT NULL (is_nullable={v})"

    return probe


def has_default(table: str, column: str):
    def probe(cur):
        v = _column_field(cur, table, column, "column_default")
        return v is not None, f"`{table}`.`{column}` has a default ({v!r})"

    return probe


def is_generated(table: str, column: str):
    def probe(cur):
        v = _column_field(cur, table, column, "extra")
        ok = bool(v) and "GENERATED" in str(v).upper()
        return ok, f"`{table}`.`{column}` is generated (extra={v!r})"

    return probe


def not_generated(table: str, column: str):
    def probe(cur):
        v = _column_field(cur, table, column, "extra")
        ok = not (v and "GENERATED" in str(v).upper())
        return ok, f"`{table}`.`{column}` is a plain column (extra={v!r})"

    return probe


def is_auto_increment(table: str, column: str):
    def probe(cur):
        v = _column_field(cur, table, column, "extra")
        ok = bool(v) and "auto_increment" in str(v).lower()
        return ok, f"`{table}`.`{column}` AUTO_INCREMENT (extra={v!r})"

    return probe


def fk_targets(table: str, column: str, expected: str):
    """The probe the D31 incident was actually about: WHERE does this FK point?"""

    def probe(cur):
        cur.execute(
            "SELECT referenced_table_name FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND table_name = %s AND column_name = %s "
            "  AND referenced_table_name IS NOT NULL",
            (table, column),
        )
        targets = sorted({r[0] for r in cur.fetchall()})
        ok = targets == [expected]
        return ok, f"`{table}`.`{column}` FK -> {expected} (found: {targets or 'none'})"

    return probe


def fk_targets_on_first_existing(tables: list[str], column: str, expected: str):
    """`fk_targets`, but for a table a LATER migration renames or quarantines.

    A fingerprint has to assert a migration's LASTING effect. `006` moved the catalog FK
    onto `courses`; `008` then quarantined `class_subjects` to
    `class_subjects_legacy_pre_d31`. A rename carries the constraint with it, so the fact
    `006` established is still true - it just lives under a different table name. Probing
    the original name alone would report `006` PARTIAL forever on any post-`008` database.
    """

    def probe(cur):
        for t in tables:
            if _count_table(cur, t):
                cur.execute(
                    "SELECT referenced_table_name FROM information_schema.key_column_usage "
                    "WHERE table_schema = DATABASE() AND table_name = %s "
                    "  AND column_name = %s AND referenced_table_name IS NOT NULL",
                    (t, column),
                )
                targets = sorted({r[0] for r in cur.fetchall()})
                ok = targets == [expected]
                return ok, f"`{t}`.`{column}` FK -> {expected} (found: {targets or 'none'})"
        return False, f"none of {tables} exist, so `{column}` FK is unverifiable"

    return probe


def pk_columns(table: str, expected: list[str]):
    def probe(cur):
        cur.execute(
            "SELECT column_name FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND table_name = %s "
            "  AND constraint_name = 'PRIMARY' ORDER BY ordinal_position",
            (table,),
        )
        cols = [r[0] for r in cur.fetchall()]
        return cols == expected, f"`{table}` PK = {cols} (want {expected})"

    return probe


def constraint_absent(table: str, name: str):
    def probe(cur):
        n = _scalar(
            cur,
            "SELECT COUNT(*) FROM information_schema.table_constraints "
            "WHERE table_schema = DATABASE() AND table_name = %s "
            "  AND constraint_name = %s",
            (table, name),
        )
        n = int(n or 0)
        return not n, (
            f"constraint `{name}` on `{table}` dropped" + (" (STILL PRESENT)" if n else "")
        )

    return probe


# --------------------------------------------------------------------------------------
# The fingerprints.
# --------------------------------------------------------------------------------------
MIGRATIONS: list[tuple[str, str, list]] = [
    (
        "001_missing_fields.sql",
        "ORM reconciliation - mixin columns, renames, the audit_log PK",
        [
            is_auto_increment("audit_log", "id"),
            # NOT `classes`.`name`: 008 quarantines `classes` entirely. A fingerprint
            # must assert a LASTING effect, so probe the mixin columns on tables that
            # survive the D31 collapse instead.
            column_exists("class_teachers", "created_at"),
            column_exists("student_profiles", "created_at"),
            pk_columns("announcement_reads", ["announcement_id", "user_id"]),
        ],
    ),
    (
        "002_column_defaults.sql",
        "CURRENT_TIMESTAMP defaults - without these every login fails (MariaDB 1364)",
        [
            has_default("login_attempts", "attempted_at"),
        ],
    ),
    (
        "003_subjects_is_active.sql",
        "`subjects.is_active` demoted from GENERATED (else 1906 on every write)",
        [
            not_generated("subjects", "is_active"),
        ],
    ),
    (
        "004_subject_class_model.sql",
        "D29 subject-class model - the weekly timetable",
        [
            table_exists("class_meetings"),
            # NOT `student_profiles`.`year_group`: 008 drops it (D30 superseded it with
            # `year_of_study` + `enrollment_load`). `class_meetings` and its shape are
            # what 004 leaves behind permanently.
            column_exists("class_meetings", "day_of_week"),
            column_exists("class_meetings", "start_time"),
        ],
    ),
    (
        "005_tertiary.sql",
        "D30 BAJC tertiary model - catalog, programmes, admissions, revisions",
        [
            table_exists("courses"),
            table_exists("programs"),
            table_exists("program_courses"),
            table_exists("course_prerequisites"),
            table_exists("applications"),
            table_exists("application_education"),
            table_exists("application_documents"),
            table_exists("credit_transfer_requests"),
            table_exists("student_program_history"),
            table_exists("student_number_sequences"),
            table_exists("grade_revision_requests"),
            column_exists("grading_scale_bands", "grade_point"),
            column_exists("programs", "min_passing_grade_point"),
            column_exists("semesters", "term_type"),
            column_exists("semesters", "grade_submission_deadline"),
            column_exists("class_enrollments", "enrollment_status"),
            column_exists("term_grade_snapshots", "quality_points"),
            column_exists("student_profiles", "program_id"),
            column_exists("student_profiles", "lastname"),
            # 005 dropped the two-terms-per-year cap so Summer and Spring blocks fit.
            constraint_absent("semesters", "ck_semesters_sequence"),
        ],
    ),
    (
        "006_courses_cutover.sql",
        "Catalog cutover - the graded chain finally reaches a credit value",
        [
            # THE probes. Both read `subjects` when 005 has reverted 006, which is
            # exactly the regression that went unnoticed. See 005 §2b.
            # `class_subjects` -> `courses` used to be probed here via
            # `fk_targets_on_first_existing`, which already tolerated the table being
            # renamed to `*_legacy_pre_d31` by 008. What it could not survive is 010
            # DROPPING the legacy copy, which leaves neither name in existence and the
            # probe permanently unverifiable - reporting 006 PARTIAL and failing the run.
            #
            # `term_grade_snapshots` is the surviving witness that 006 re-pointed the
            # subject foreign keys at `courses`, and it is not going anywhere.
            fk_targets("term_grade_snapshots", "subject_id", "courses"),
        ],
    ),
    (
        "007_student_names.sql",
        "Split names are the only stored truth - `full_name` is gone",
        [
            column_absent("student_profiles", "full_name"),
            column_not_null("student_profiles", "lastname"),
        ],
    ),
    (
        "008_course_offerings.sql",
        "D31 offering model - course_offerings replaces classes + class_subjects",
        [
            table_exists("course_offerings"),
            column_exists("course_offerings", "semester_id"),
            is_generated("course_offerings", "active_section"),
            # The collapse: every child hangs off `offering_id` now.
            fk_targets("assessments", "offering_id", "course_offerings"),
            fk_targets("assessment_categories", "offering_id", "course_offerings"),
            fk_targets("class_teachers", "offering_id", "course_offerings"),
            fk_targets("class_meetings", "offering_id", "course_offerings"),
            fk_targets("term_grade_snapshots", "offering_id", "course_offerings"),
            fk_targets("class_enrollments", "offering_id", "course_offerings"),
            fk_targets("attendance_records", "offering_id", "course_offerings"),
            fk_targets("announcements", "offering_id", "course_offerings"),
            column_absent("assessments", "class_subject_id"),
            column_absent("class_enrollments", "class_id"),
            # The stakeholder audience rule, re-created against the new column.
            constraint_absent("announcements", "ck_announcements_class_audience"),
            # K-12 residue gone.
            table_absent("classes"),
            table_absent("class_subjects"),
            table_absent("subjects"),
            column_absent("student_profiles", "year_group"),
            # The two `*_legacy_pre_d31` quarantine tables used to be probed here as
            # `table_exists`. That went stale the moment 010_drop_legacy_pre_d31.sql ran:
            # 010's whole job is to drop them once the D31 cut-over is confirmed, so on
            # any database that is actually up to date this fingerprint reported 008 as
            # PARTIAL and the script exited FAIL no matter what else was true.
            #
            # A fingerprint has to assert a LASTING effect of its own migration. The
            # quarantine tables were always transitional, so they are not one; everything
            # above this line is. Removed rather than inverted to `table_absent` - that
            # would make 008 fail on a database sitting correctly between 008 and 010.
        ],
    ),
    # NOTE THE GAP: 009 through 012 have no entry here. They were applied to live but
    # never fingerprinted, so this script cannot report on them and `--expect 013` does
    # not imply they ran. Worth backfilling; not done here because guessing a probe for
    # a migration you did not write is how a fingerprint comes to assert the wrong thing.
    (
        "013_meeting2_schema.sql",
        "D39 - lecturer fields, education -> academic_qualification, religions lookup",
        [
            # The four Meeting #2 item 10 columns.
            column_exists("teacher_profiles", "ssno"),
            column_exists("teacher_profiles", "licensenum"),
            column_exists("teacher_profiles", "is_employed"),
            column_exists("teacher_profiles", "academic_qualification"),
            # A RENAME, not an add - if `education` is still here the rename was skipped
            # and the two columns have been drifting apart since.
            column_absent("teacher_profiles", "education"),
            column_exists("teacher_profiles", "first_name"),
            column_exists("teacher_profiles", "comments"),
            table_exists("religions"),
            # Deliberately NOT added - see header note (a) in the .sql. Probed as an
            # ABSENCE so that if someone later applies the client's dump wholesale, this
            # reports PARTIAL instead of quietly accepting a second, conflicting home for
            # a fact `class_enrollments.enrollment_status` already owns.
            column_absent("courses", "course_status"),
        ],
    ),
]


def run(verbose: bool, expect: str | None) -> int:
    kwargs = connection_kwargs()
    known = [m[0] for m in MIGRATIONS]
    if expect:
        matches = [m for m in known if m.startswith(expect)]
        if not matches:
            raise SystemExit(f"--expect {expect!r} matches none of: {', '.join(known)}")
        ceiling = known.index(matches[0])
    else:
        ceiling = len(MIGRATIONS) - 1

    print(f"database : {kwargs['database']}")
    print(f"required : through {known[ceiling]}\n")

    failed = 0
    conn = pymysql.connect(**kwargs)  # type: ignore[arg-type]
    try:
        with conn.cursor() as cur:
            for idx, (name, blurb, probes) in enumerate(MIGRATIONS):
                results = [p(cur) for p in probes]
                passed = sum(1 for ok, _ in results if ok)
                total = len(results)
                if passed == total:
                    verdict, mark = "APPLIED", "ok  "
                elif passed == 0:
                    verdict, mark = "MISSING", "MISS"
                else:
                    verdict, mark = "PARTIAL", "PART"

                required = idx <= ceiling
                if required and verdict != "APPLIED":
                    failed = 1

                flag = "" if required else "   (beyond --expect)"
                print(f"[{mark}] {name:<32} {verdict}  {passed}/{total}{flag}")
                print(f"       {blurb}")
                for ok, detail in results:
                    if verbose or not ok:
                        print(f"         {'.' if ok else 'X'} {detail}")
                print()
    finally:
        conn.close()

    if failed:
        print("RESULT: FAIL - at least one required migration is not fully applied.")
        print("        A PARTIAL verdict usually means apply_sql.py continued past a")
        print("        failing statement. Re-run that file and read the per-statement log.")
    else:
        print("RESULT: PASS - every required migration is fully applied.")
    return failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--verbose", action="store_true", help="print passing probes too")
    parser.add_argument(
        "--expect",
        metavar="PREFIX",
        help="highest migration that must be applied, e.g. 007 (default: all known)",
    )
    args = parser.parse_args()
    return run(args.verbose, args.expect)


if __name__ == "__main__":
    raise SystemExit(main())

"""Tertiary demo-dataset seed for the self-hosted MariaDB `sims` database — D31 Phase 5.

Reproduces the coherent Belize Adventist Junior College dataset that the frontend MSW
demo uses (`frontend/src/shared/api/mocks/demo/data.ts`) and loads it into the live
MariaDB through the ORM's configured engine, so the REAL backend is populated with the
same college the client has already seen.

────────────────────────────────────────────────────────────────────────────────────
WHAT D31 CHANGED HERE, AND WHY THE OLD VERSION HAD TO GO
────────────────────────────────────────────────────────────────────────────────────
The previous file seeded **eight homerooms** (`Form 1A` … `Form 4 Business`), each with
~7 rows in `class_subjects`, and put every student in exactly one of them. Three of its
load-bearing assumptions no longer exist:

  * `classes` and `class_subjects` are gone (quarantined by `008` as
    `*_legacy_pre_d31`). The unit is now **one `course_offerings` row = one catalog
    course, in one SEMESTER, with an optional section code**.
  * `class_enrollments.class_id` pointed at a HOMEROOM, so "enrolled in Form 1A"
    implicitly meant taking all seven of its courses. It is `offering_id` now: a
    student holds one row per course they actually registered for.
  * `grade_level` ("Form 1") was NOT NULL on every offering. A junior college has no
    Forms; it has years of study and programmes.

So this is a rewrite rather than a rename, and it seeds the two scenarios that PROVE
the new model — the same pair the MSW dataset hard-codes:

  1. **Parallel sections.** `MATH1110` runs as `-01`, `-02` and `-03` in one term.
     Freddy Lopez (`stu-1`) and John Garcia (`stu-2`) share Biology and English but sit
     DIFFERENT Algebra sections, so their timetables differ in exactly one slot. The
     homeroom model could not express that at all.
  2. **The same course in two terms.** `MATH1110-01` and `BIOL1102-01` run again in
     Semester 2 as separate offerings with their own rosters and assessments. A
     year-scoped `classes` row could only ever say "Algebra, sometime in 2025-2026".

────────────────────────────────────────────────────────────────────────────────────
DESIGN
────────────────────────────────────────────────────────────────────────────────────
  * Deterministic — demo string ids ('teach-1', 'off-3', 'stu-12', …) map to stable
    UUIDv5 values, so cross-references resolve and re-runs are idempotent. Stochastic
    fields (scores, attendance marks, DOBs, guardians) use seeded RNGs, so a re-run
    yields the same rows. **Passwords are the one deliberate exception** — see below.
  * Idempotent — clears the seeded tables (FK checks off) then re-inserts.
  * REFERENCE DATA IS NEVER TOUCHED. `courses`, `programs`, `program_courses` and
    `course_prerequisites` belong to `app/db/seed_bajc.py` (the real BAJC catalog and
    its eight programme sequences). This file resolves them BY CODE and fails loudly if
    they are missing, because a demo seed that silently invents a course or a programme
    is how the two datasets drift apart.
  * Honours the live CHECK/UNIQUE constraints: score non-null IFF status='graded';
    `announcements.offering_id` set IFF audience='class'; one active year and one
    active semester; `max_score > 0`; `capacity IS NULL OR > 0`; meetings inside
    Mon-Fri with `end_time > start_time`; one OPEN `student_program_history` row per
    student; JSON validity.
  * Generated columns (`active_email`, `active_section`, `enroll_active_flag`,
    `open_flag`, …) are never written — MariaDB computes them.

PASSWORDS (D31 Phase 5). Every account gets its OWN randomly generated password via
`app.core.security.generate_temp_password`, and `must_change_password = 1`. The old
version hardcoded one `SimsDemo2025!` across 19 accounts with the flag FALSE and wrote
the shared Argon2 hash into a **tracked** `010_seed_demo.sql`, so rotating the constant
did not fix the file — the hash was in git either way. Both generated artifacts now
land in the untracked `generated/` directory beside this script:

    generated/010_seed_demo.sql      the INSERTs, for re-loading from HeidiSQL
    generated/demo-credentials.txt   the plaintext logins, written once per run

Run:  cd backend && .venv/Scripts/python -m db.mariadb.seed_demo
      (or:  python backend/db/mariadb/seed_demo.py)

Prerequisites: `008_course_offerings.sql` applied, and the catalog seeded
(`python -m app.db.seed_bajc`). Both are checked before anything is written.
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

# Make `app...` importable whether run as a module or a script.
_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from pymysql.converters import escape_string  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core.security import generate_temp_password, hash_password  # noqa: E402
from app.db.bajc_catalog import PROGRAMS  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.modules.settings.grading_defaults import (  # noqa: E402
    BAJC_GRADING_BANDS,
    DEFAULT_PASS_MARK,
)

# ── Config ───────────────────────────────────────────────────────────────────────
#: The demo "now" — a weekday inside the ACTIVE Semester 1, matching `DEMO_TODAY` in
#: the MSW dataset so both halves of the demo describe the same day.
DEMO_TODAY = date(2025, 10, 15)
#: A weekday inside Semester 1 of the ARCHIVED year, anchoring the historical mirror.
HIST_ANCHOR = date(2025, 1, 10)
_NS = uuid.UUID("11111111-2222-3333-4444-555555555555")

#: Generated artifacts live OUTSIDE version control (see `backend/.gitignore`): one
#: holds per-account Argon2 hashes, the other the plaintext passwords.
OUT_DIR = Path(__file__).with_name("generated")
SQL_OUT = OUT_DIR / "010_seed_demo.sql"
CRED_OUT = OUT_DIR / "demo-credentials.txt"


def uid(key: str) -> str:
    """Stable UUIDv5 for a demo string id."""
    return str(uuid.uuid5(_NS, key))


def add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def is_weekday(d: date) -> bool:
    return d.weekday() < 5  # Mon-Fri


def dt(d: date, hhmmss: str) -> str:
    return f"{d.isoformat()} {hhmmss}"


# ── SQL literal emitter ────────────────────────────────────────────────────────────
def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, Decimal)):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, (date,)):
        return "'" + v.isoformat() + "'"
    return "'" + escape_string(str(v)) + "'"


# Ordered rows: table -> (columns, [row-dicts])
TABLES: "dict[str, tuple[list[str], list[dict]]]" = {}

#: Tables this file OWNS: cleared in reverse, then re-inserted in this order.
ORDER = [
    "users", "user_preferences", "school_profile", "assessment_policies",
    "academic_years", "semesters", "grading_scales", "grading_scale_bands",
    "course_offerings", "teacher_profiles", "student_profiles",
    "student_program_history", "class_teachers", "class_meetings",
    "class_enrollments", "assessment_categories", "assessments",
    "assessment_grades", "attendance_records", "announcements",
    "announcement_reads", "events",
]

#: Tables CLEARED but not written. Every one of them has an FK into `users`,
#: `student_profiles` or `course_offerings`, so leaving them behind after the sweep
#: would strand rows pointing at ids that no longer exist. `refresh_sessions` is the
#: one that matters for more than tidiness: user ids are deterministic uuid5, so a
#: session issued BEFORE a re-seed would still authenticate against the freshly created
#: account and its brand-new password — the rotation would not actually revoke
#: anything. `courses` / `programs` / `program_courses` / `course_prerequisites` are
#: deliberately ABSENT: they are reference data, and their audit columns hold no user
#: references (verified on the live database, 0 rows with either set).
SWEEP_ONLY = [
    "refresh_sessions", "password_reset_tokens", "login_attempts",
    "grade_revision_requests", "term_grade_snapshots", "report_card_snapshots",
    "student_documents", "credit_transfer_requests", "application_documents",
    "application_education", "applications", "audit_log",
]


def add(table: str, **cols) -> None:
    if table not in TABLES:
        TABLES[table] = (list(cols.keys()), [])
    TABLES[table][1].append(cols)


# ═══════════════════════════════════════════════════════════════════════════════════
# Reference data: resolved from the live DB, never created here
# ═══════════════════════════════════════════════════════════════════════════════════
_COURSES: "dict[str, tuple[str, str]]" = {}   # CODE -> (id, name)
_PROGRAMS: "dict[str, str]" = {}              # CODE -> id


def _load_reference_data() -> None:
    """Load the catalog + programmes, and prove `008` has been applied.

    The `course_offerings` probe is not paranoia: this file writes `offering_id` on
    seven child tables, and against a pre-`008` database every one of those inserts
    would fail on an unknown column — halfway through a sweep that had already emptied
    the tables. Failing before the first DELETE instead is the difference between "run
    the migration" and "restore the backup".
    """
    from sqlalchemy import text as _text

    with engine.connect() as conn:
        exists = conn.execute(
            _text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name = 'course_offerings'"
            )
        ).scalar()
        if not exists:
            raise SystemExit(
                "REFUSING TO SEED — `course_offerings` does not exist, so this "
                "database is pre-D31.\nApply the migration first:\n"
                "    python db/mariadb/apply_sql.py db/mariadb/008_course_offerings.sql"
            )
        for code, cid, name in conn.execute(
            _text(
                "SELECT code, CAST(id AS char), name FROM courses "
                "WHERE deleted_at IS NULL"
            )
        ):
            _COURSES[str(code).upper()] = (str(cid), str(name))
        for code, pid in conn.execute(
            _text(
                "SELECT code, CAST(id AS char) FROM programs WHERE deleted_at IS NULL"
            )
        ):
            _PROGRAMS[str(code).upper()] = str(pid)


_load_reference_data()


def course_id(code: str) -> str:
    """The seeded BAJC course id for `code`, or fail loudly.

    A demo seed that silently invents a missing course is how the two datasets drift
    apart, so this refuses instead — run `python -m app.db.seed_bajc` first.
    """
    row = _COURSES.get(code.upper())
    if row is None:
        raise SystemExit(
            f"Course {code!r} is not in the catalog. Run the BAJC catalog seed first:\n"
            f"    python -m app.db.seed_bajc"
        )
    return row[0]


def course_name(code: str) -> str:
    row = _COURSES.get(code.upper())
    if row is None:
        raise SystemExit(f"Course {code!r} is not in the catalog (run seed_bajc).")
    return row[1]


def program_id(code: str) -> str:
    pid = _PROGRAMS.get(code.upper())
    if pid is None:
        raise SystemExit(
            f"Programme {code!r} is not seeded. Run the BAJC catalog seed first:\n"
            f"    python -m app.db.seed_bajc"
        )
    return pid


#: The eight BAJC programme codes, in the catalog's own order, so students rotate
#: through the real award list. Primary Education (`EDUC`) is deliberately in the
#: rotation: it is the one programme that passes at C (2.00) rather than C+ (2.50), so
#: the per-programme pass mark is exercised rather than merely stored.
PROGRAM_CODES = [row[0] for row in PROGRAMS]

# ═══════════════════════════════════════════════════════════════════════════════════
# Calendar
# ═══════════════════════════════════════════════════════════════════════════════════
YEAR_ARCHIVED, YEAR_ACTIVE = "ay-2024", "ay-2025"
SEM_2024_1, SEM_2024_2 = "sem-2024-1", "sem-2024-2"
SEM_ACTIVE, SEM_2025_2 = "sem-2025-1", "sem-2025-2"

# ── school_profile + assessment_policies (singletons) ──────────────────────────────
add("school_profile", id=1, name="Belize Adventist Junior College",
    logo_storage_key="/logo.jpeg", address="Corozal Town, Corozal District, Belize",
    contact_email="office@bajc.edu.bz", contact_phone="+501-422-2015",
    color_primary="#1E3A6E", color_secondary="#C21F30")
add("assessment_policies", id=1, absent_as_zero=True, allow_makeup=True,
    drop_lowest_count=0)

# ── academic_years ────────────────────────────────────────────────────────────────
add("academic_years", id=uid(YEAR_ARCHIVED), name="2024-2025",
    start_date=date(2024, 9, 2), end_date=date(2025, 6, 27), status="archived",
    archived_at="2025-07-15 12:00:00")
add("academic_years", id=uid(YEAR_ACTIVE), name="2025-2026",
    start_date=date(2025, 9, 1), end_date=date(2026, 6, 26), status="active",
    archived_at=None)

# ── semesters ─────────────────────────────────────────────────────────────────────
# `grade_submission_deadline` on the ACTIVE term sits in the FUTURE relative to
# DEMO_TODAY, deliberately (D30 §D6): it makes the feature visible without turning the
# marquee gradebook read-only for the whole demo. Move it behind DEMO_TODAY from
# Settings to see the closed state.
SEMESTER_SEED = [
    (SEM_2024_1, YEAR_ARCHIVED, "Semester 1", 1,
     date(2024, 9, 2), date(2025, 1, 17), False, None),
    (SEM_2024_2, YEAR_ARCHIVED, "Semester 2", 2,
     date(2025, 1, 20), date(2025, 6, 27), False, None),
    (SEM_ACTIVE, YEAR_ACTIVE, "Semester 1", 1,
     date(2025, 9, 1), date(2026, 1, 16), True, "2026-01-23 23:59:00"),
    (SEM_2025_2, YEAR_ACTIVE, "Semester 2", 2,
     date(2026, 1, 19), date(2026, 6, 26), False, "2026-07-03 23:59:00"),
]
for sid, yr, name, seq, sd, ed, active, deadline in SEMESTER_SEED:
    add("semesters", id=uid(sid), academic_year_id=uid(yr), name=name,
        term_type="semester", sequence=seq, start_date=sd, end_date=ed,
        grade_submission_deadline=deadline, is_active=active)

# ── grading scales + bands ─────────────────────────────────────────────────────────
# ACTIVE year: the BAJC 8-band scale WITH grade points, imported from
# `settings/grading_defaults.py` so the demo and a year created through the API cannot
# disagree. Without grade points `calc.compute_gpa` is weightless and
# `calc.meets_grade_point` falls back to `is_passing` (D30 §D5).
#
# ARCHIVED year: the pre-D30 5-band scale with NULL grade points, FROZEN. Not laziness
# — schema §10.4 says an archived year keeps the rules that were in force then, and
# `seed_grading_scale.py` skips frozen scales for exactly that reason. It is also the
# state that exercises the lenient fallback.
ARCHIVED_BANDS = [
    ("A", "90.00", "100.00", None, True, 1),
    ("B", "80.00", "89.99", None, True, 2),
    ("C", "70.00", "79.99", None, True, 3),
    ("D", "60.00", "69.99", None, True, 4),
    ("F", "0.00", "59.99", None, False, 5),
]
for yr, frozen, pass_mark, bands in [
    (YEAR_ACTIVE, False, DEFAULT_PASS_MARK, BAJC_GRADING_BANDS),
    (YEAR_ARCHIVED, True, "60.00", ARCHIVED_BANDS),
]:
    gs = uid(f"gs-{yr}")
    add("grading_scales", id=gs, academic_year_id=uid(yr),
        pass_mark=Decimal(pass_mark), is_frozen=frozen)
    for letter, lo, hi, gp, passing, order in bands:
        add("grading_scale_bands", id=uid(f"band-{yr}-{letter}"), grading_scale_id=gs,
            letter=letter, min_score=Decimal(lo), max_score=Decimal(hi),
            grade_point=(Decimal(gp) if gp is not None else None),
            is_passing=passing, sort_order=order)

# ═══════════════════════════════════════════════════════════════════════════════════
# Users — one generated password per account, must_change_password = true
# ═══════════════════════════════════════════════════════════════════════════════════
#: (role, email, plaintext) in creation order → `generated/demo-credentials.txt`.
CREDENTIALS: "list[tuple[str, str, str]]" = []


def add_user(key, email, username, full_name, role, is_active, last_login=None):
    """Create a login with its OWN generated password and the forced-change flag.

    Two changes from the pre-D31 version, and the second is why the first matters: the
    password is per-account rather than one constant shared by 19 accounts, and
    `must_change_password` is TRUE, which `core/deps.get_current_user` now ENFORCES
    server-side (403 `password_change_required` on everything except reading your own
    identity, changing your password, and logging out). Before Phase 5 the flag was a
    single client-side redirect, so setting it here would have been decoration.
    """
    uu = uid(key)
    plaintext = generate_temp_password()
    CREDENTIALS.append((role, email, plaintext))
    add("users", id=uu, email=email, username=username,
        password_hash=hash_password(plaintext), role=role, full_name=full_name,
        is_active=is_active, must_change_password=True, failed_login_count=0,
        last_login_at=last_login)
    add("user_preferences", user_id=uu, locale="en", theme="light",
        date_format=None, default_page_size=25)
    return uu


USER_PRINCIPAL = add_user(
    "user-principal", "principal@belmopancomp.edu.bz", "principal",
    "Alicia Mendez", "principal", True, dt(DEMO_TODAY, "09:00:00"),
)
USER_SECRETARY = add_user(
    "user-secretary", "secretary@belmopancomp.edu.bz", "secretary",
    "Sofia Castillo", "secretary", True, dt(add_days(DEMO_TODAY, -1), "07:45:00"),
)

# ═══════════════════════════════════════════════════════════════════════════════════
# Lecturers
# ═══════════════════════════════════════════════════════════════════════════════════
# Specialisations are stored as course NAMES (that is what the directory shows),
# resolved from the REAL catalog rather than an invented subject list. Trevor Neal is
# inactive and holds no login, so the "staff row with no user" path stays populated.
TEACHER_SEED = [
    ("Maria Reyes", ["MATH1110", "MATH1210"], "active", "female"),
    ("Carlos Mendez", ["ENGL1102", "HIST2102"], "active", "male"),
    ("Alicia Cano", ["BIOL1102", "CHEM1100"], "active", "female"),
    ("Devon Flowers", ["MATH1210", "MATH1110"], "active", "male"),
    ("Sonia Choc", ["SPAN2112", "ENGL1102"], "active", "female"),
    ("Rodwell Bailey", ["SOCI1212", "HIST2102"], "active", "male"),
    ("Yolanda Cruz", ["CHEM1100", "BIOL1102"], "active", "female"),
    ("Egbert Grinage", ["THEO2201"], "active", "male"),
    ("Nadia Rhaburn", ["ITEC1104"], "active", "female"),
    ("Marlon Pou", ["MGMT1106", "MATH1110"], "active", "male"),
    ("Kayla Waight", ["ENGL1102", "ITEC1104"], "active", "female"),
    ("Trevor Neal", ["SOCI1212", "THEO2201"], "inactive", "male"),
]
# "Lecturer", not "Teacher": D30 renamed the display vocabulary for a junior college.
DESIGNATIONS = ["Head of Department", "Senior Lecturer", "Senior Lecturer", "Lecturer"]
DEGREES = {
    "Head of Department": "M.Ed.", "Senior Lecturer": "M.Sc.", "Lecturer": "B.Ed.",
}
STREETS = ["Constitution Drive", "Forest Drive", "Melhado Parade", "Bliss Parade",
           "Hummingbird Avenue", "Ring Road"]

teacher_ids: dict[int, str] = {}          # index -> teacher_profiles.id
teacher_user: dict[int, str | None] = {}  # index -> users.id or None
for i, (full_name, specs, status, gender) in enumerate(TEACHER_SEED):
    rng = random.Random(900 + i)
    tid = uid(f"teach-{i + 1}")
    teacher_ids[i] = tid
    spec_names = [course_name(c) for c in specs]
    designation = DESIGNATIONS[i % len(DESIGNATIONS)]
    years = rng.randint(5, 22)
    email = full_name.lower().replace(" ", ".") + "@belmopancomp.edu.bz"
    user_id = None
    if status == "active":
        user_id = add_user(
            f"user-teach-{i + 1}", email, email.split("@")[0], full_name, "teacher",
            True, dt(add_days(DEMO_TODAY, -rng.randint(0, 5)), "07:50:00"),
        )
    teacher_user[i] = user_id
    expertise = [
        {"area": a, "level": (rng.randint(82, 95) if idx == 0 else rng.randint(60, 85))}
        for idx, a in enumerate(spec_names)
    ]
    add("teacher_profiles", id=tid, user_id=user_id, staff_number=f"T-{1001 + i}",
        full_name=full_name, email=email, phone=f"+501-6{rng.randint(100000, 999999)}",
        status=status, subject_specializations=json.dumps(spec_names), gender=gender,
        designation=designation,
        # D39 (Meeting #2 item 10) — `education` was renamed by 013_meeting2_schema.sql.
        academic_qualification=f"{DEGREES[designation]} {spec_names[0]}",
        bio=(f"{designation} with {years} years of lecture-room experience teaching "
             f"{spec_names[0]}. Committed to student-centred learning and measurable "
             f"outcomes."),
        address=f"{rng.randint(1, 120)} {rng.choice(STREETS)}, Belmopan, Cayo",
        expertise=json.dumps(expertise), avatar_url=None,
        # The split names mirror what 013 backfilled; `full_name` stays authoritative.
        first_name=full_name.split(" ")[0], last_name=full_name.split(" ")[-1],
        # Derived from status, exactly as `teachers/service._sync_is_employed` does it.
        is_employed=1 if status == "active" else 0,
        # Only the lead lecturer gets these, so the demo shows both the populated and the
        # empty rendering rather than making every row look uniformly filled in.
        ssno="000256398" if i == 0 else None,
        licensenum="OWD-2019-00035" if i == 0 else None)


def teacher_for(code: str) -> int:
    """First ACTIVE lecturer index whose specialisations include this course code."""
    for i, (_n, specs, status, _g) in enumerate(TEACHER_SEED):
        if status == "active" and code in specs:
            return i
    raise KeyError(f"no active lecturer specialises in {code}")


def teacher_named(name: str) -> int:
    """A NAMED active lecturer, for offerings that must not take the default.

    `teacher_for` returns the FIRST active specialist, which is right for most rows and
    wrong for a parallel section: `MATH1110-02` exists to be `-01`'s twin with a
    different lecturer, and both resolve to Maria Reyes by specialisation, so the seed
    used to claim a difference it did not create. Naming the lecturer is the only way to
    say "somebody else teaches this one".
    """
    for i, (full_name, _specs, status, _g) in enumerate(TEACHER_SEED):
        if full_name == name:
            if status != "active":
                raise KeyError(f"{name} is not an active lecturer")
            return i
    raise KeyError(f"no lecturer named {name}")


# ═══════════════════════════════════════════════════════════════════════════════════
# Course offerings — the D31 unit
# ═══════════════════════════════════════════════════════════════════════════════════
# Each row is one offering: a catalog course, a TERM, an optional section code, the
# lecturer who leads it, a room, a capacity and the weekly slots it meets in.
#
# `key` is a BUILD-TIME HANDLE spelled like the label the API derives ("MATH1110-01").
# It is never stored: `course_offerings` has no `name` column, because an offering's
# label is a function of its course code, section and term.
#
# `room` is applied to every meeting of an offering for brevity here, but it is stored
# PER MEETING — one course legitimately meets in a lecture room and a lab.
#
# MATH1210 (Pre-Calculus) is in the set on purpose: it genuinely requires MATH1110
# (Intermediate Algebra) in the 26/27 sequences, so the prerequisite gate fires on a
# real rule rather than an invented one.
#
#   key, code, section, semester, lecturer NAMES (lead first) or None for the course's
#   default specialist, room, capacity, meetings as (ISO weekday 1=Mon, start, end)
OFFERING_SEED = [
    # ── Semester 1 of the active year ──
    ("MATH1110-01", "MATH1110", "01", SEM_ACTIVE, None, "Room A", 20,
     [(1, "08:00", "09:30"), (3, "08:00", "09:30")]),
    # -02 is -01's PARALLEL SECTION: same course, same term, different lecturer, room
    # and time. This is the row the year-scoped model could not hold. The lecturer is
    # NAMED rather than derived: the default specialist for either MATH code is Maria
    # Reyes, who already leads -01, so deriving it produced a "parallel section" taught
    # by the same person at a different hour.
    ("MATH1110-02", "MATH1110", "02", SEM_ACTIVE, ["Marlon Pou"], "Room C", 20,
     [(1, "10:00", "11:30"), (3, "10:00", "11:30")]),
    # Capacity 26, not 24: every first-year load includes Biology, and the archived
    # year's fallback load adds the graduated/withdrawn students on top, so 24 seated a
    # roster of 25. Over-capacity enrolment is warn-only (D-Q6) rather than refused, so
    # the old number did not fail — it just quietly seeded a college that breaks its own
    # rule on the screen where the warning shows.
    ("BIOL1102-01", "BIOL1102", "01", SEM_ACTIVE, None, "Lab 1", 26,
     [(2, "09:00", "10:30"), (4, "09:00", "10:30")]),
    # Wednesday sits at 13:00, NOT 11:00: MATH1110-02 runs Wed 10:00-11:30 and every
    # student on that load also takes English, so an 11:00 English would put 15 of them
    # in two rooms at once. The seeded week must be one a real student could walk.
    #
    # Capacity 32 for the same reason as Biology, only larger: EVERY one of the 30
    # first-years takes English, so any capacity below the intake is over-subscribed by
    # construction.
    ("ENGL1102-01", "ENGL1102", "01", SEM_ACTIVE, None, "Room D", 32,
     [(3, "13:00", "14:00"), (5, "11:00", "12:00")]),
    ("CHEM1100-01", "CHEM1100", "01", SEM_ACTIVE, None, "Lab 2", 18,
     [(2, "11:00", "12:30")]),
    ("ITEC1104-01", "ITEC1104", "01", SEM_ACTIVE, None, "Computer Lab", 22,
     [(5, "08:00", "09:30")]),
    # A third section of the same course, for the second-year cohort.
    ("MATH1110-03", "MATH1110", "03", SEM_ACTIVE, None, "Room A", 18,
     [(2, "08:00", "09:30"), (4, "11:00", "12:30")]),
    # Gated on Algebra: enrolling a student who has not passed MATH1110 is a 409.
    ("MATH1210-01", "MATH1210", "01", SEM_ACTIVE, None, "Room F", 16,
     [(1, "13:00", "14:30")]),
    ("MGMT1106-01", "MGMT1106", "01", SEM_ACTIVE, None, "Room B", 20,
     [(4, "13:00", "14:30")]),
    ("SPAN2112-01", "SPAN2112", "01", SEM_ACTIVE, None, "Room E", 20,
     [(5, "13:00", "14:00")]),

    # ── Semester 2 of the active year — THE D31 PROOF ──
    # The same course, the same section code, a DIFFERENT term. Under the old model
    # these collided with the rows above (one class row per course per YEAR); here they
    # are distinct offerings with their own rosters, assessments and gradebooks.
    # Capacity is NULL on both, which exercises the "no limit" branch.
    ("MATH1110-01@S2", "MATH1110", "01", SEM_2025_2, None, "Room A", None,
     [(1, "08:00", "09:30"), (3, "08:00", "09:30")]),
    ("BIOL1102-01@S2", "BIOL1102", "01", SEM_2025_2, None, "Lab 1", None,
     [(2, "09:00", "10:30"), (4, "09:00", "10:30")]),
]

offering_id_by_key: dict[str, str] = {}
offering_course: dict[str, str] = {}     # key -> course code
offering_section: dict[str, str | None] = {}
offering_capacity: dict[str, int | None] = {}
offering_semester: dict[str, str] = {}   # key -> semester demo id
SEM1_KEYS = [row[0] for row in OFFERING_SEED if row[3] == SEM_ACTIVE]
SEM2_KEYS = [row[0] for row in OFFERING_SEED if row[3] == SEM_2025_2]

meeting_counter = 0
for idx, (key, code, section, sem, tcodes, room, cap, meetings) in enumerate(
    OFFERING_SEED
):
    off = f"off-{idx + 1}"
    offering_id_by_key[key] = uid(off)
    offering_course[key] = code
    offering_section[key] = section
    offering_capacity[key] = cap
    offering_semester[key] = sem
    add("course_offerings", id=uid(off), course_id=course_id(code),
        semester_id=uid(sem), section_code=section, capacity=cap, is_archived=False)

    lead = teacher_named(tcodes[0]) if tcodes else teacher_for(code)
    extra = [teacher_named(n) for n in (tcodes or [])[1:]]
    # One CO-TAUGHT offering, so the "many lecturers on one offering" path is exercised.
    if key == "MATH1110-01" and lead != 3:
        extra.append(3)
    for t in dict.fromkeys([lead, *extra]):
        add("class_teachers", id=uid(f"ct-{off}-{t}"), offering_id=uid(off),
            teacher_id=teacher_ids[t], is_lead=(t == lead))

    for day, start, end in meetings:
        meeting_counter += 1
        add("class_meetings", id=uid(f"mtg-{meeting_counter}"), offering_id=uid(off),
            day_of_week=day, start_time=f"{start}:00", end_time=f"{end}:00", room=room)

# ═══════════════════════════════════════════════════════════════════════════════════
# Students
# ═══════════════════════════════════════════════════════════════════════════════════
FIRST_NAMES = [
    "Ana", "Luis", "Keisha", "Jamal", "Sofia", "Marco", "Tanya", "Elvin", "Rina",
    "Kester", "Denise", "Andre", "Shanice", "Oscar", "Mila", "Trevaughn", "Paola",
    "Dwayne", "Nayeli", "Colin", "Britney", "Hector", "Jaylen", "Marisol", "Rueben",
    "Alysha", "Damian", "Cindy", "Kevaughn", "Leah", "Ramon", "Whitney", "Isaias",
    "Deja", "Fernando", "Kaylee", "Osmond", "Yuritzi", "Bryce", "Amara", "Delroy",
    "Selena", "Tyrique", "Estela", "Garrett",
]
LAST_NAMES = [
    "Lopez", "Garcia", "Williams", "Coye", "Martinez", "Gongora", "Middleton",
    "Requena", "Tzul", "Flowers", "Cacho", "Vasquez", "Rivera", "Perez", "Cattouse",
    "Ake", "Chan", "Ical", "Nunez", "Palacio",
]

# The course load a student takes, by year of study. A college student picks a handful
# of courses rather than receiving a fixed set, so the generator rotates students
# through these combinations — INCLUDING the parallel Algebra sections, which is what
# makes any two students' timetables genuinely different. Values are offering keys, so
# a typo fails at build rather than silently enrolling nobody.
FIRST_YEAR_LOADS = [
    ["MATH1110-01", "BIOL1102-01", "ENGL1102-01", "CHEM1100-01"],
    ["MATH1110-02", "BIOL1102-01", "ENGL1102-01", "ITEC1104-01"],
    ["MATH1110-01", "BIOL1102-01", "ENGL1102-01", "ITEC1104-01"],
    ["MATH1110-02", "CHEM1100-01", "ENGL1102-01", "ITEC1104-01"],
]
SECOND_YEAR_LOADS = [
    ["MATH1110-03", "MATH1210-01", "SPAN2112-01"],
    ["MGMT1106-01", "SPAN2112-01", "MATH1110-03"],
    ["MATH1110-03", "MATH1210-01", "MGMT1106-01"],
]

# The two named students the whole demo turns on. Hard-coded rather than generated so
# the scenario cannot drift: same Biology, same English, DIFFERENT Algebra section.
# `stu-1` is the seeded student login, so the demo lands on Freddy.
SCENARIO = {
    0: ("Freddy Lopez", "First",
        ["MATH1110-01", "BIOL1102-01", "ENGL1102-01", "CHEM1100-01"]),
    1: ("John Garcia", "First",
        ["MATH1110-02", "BIOL1102-01", "ENGL1102-01", "ITEC1104-01"]),
}

rng_stu = random.Random(4242)
student_ids: dict[int, str] = {}
student_load: dict[int, list[str]] = {}
student_program: dict[int, str] = {}   # index -> programme CODE

#: Rotation position WITHIN each cohort, not the raw student index.
#:
#: `i % len(loads)` is degenerate here and the seeded data is what proved it: second-year
#: students are exactly the indices where `i % 3 == 2`, so `i % 3` picked
#: `SECOND_YEAR_LOADS[2]` for all 15 of them — two of the three second-year combinations
#: were unreachable and `SPAN2112-01` ended up an offering with an EMPTY roster. (The MSW
#: dataset carries the same expression; recorded as a follow-on.) Counting within the
#: cohort is what makes the rotation actually rotate.
cohort_seen = {"First": 0, "Second": 0}

for i in range(45):
    sid = uid(f"stu-{i + 1}")
    student_ids[i] = sid
    scenario = SCENARIO.get(i)
    year_of_study = scenario[1] if scenario else ("Second" if i % 3 == 2 else "First")
    rotation = cohort_seen[year_of_study]
    cohort_seen[year_of_study] += 1

    first = FIRST_NAMES[i]
    last = rng_stu.choice(LAST_NAMES)
    if scenario:
        parts = scenario[0].split()
        firstname, lastname = parts[0], parts[-1]
        middlename = " ".join(parts[1:-1]) or None
    else:
        firstname, middlename, lastname = first, None, last

    # Junior-college entrants are ~16-18: first-year born ~2008, second-year ~2007.
    birth_year = 2007 if year_of_study == "Second" else 2008
    dob = date(birth_year, rng_stu.randint(1, 12), rng_stu.randint(1, 28))

    # Mostly active; a few inactive/graduated/withdrawn/transferred for realism. The
    # two scenario students are always active — the demo depends on their timetables
    # rendering.
    status = "active"
    if not scenario:
        if i == 7:
            status = "inactive"
        elif i == 20:
            status = "withdrawn"
        elif i == 33:
            status = "transferred"
        elif i == 41:
            status = "graduated"

    # Graduated / withdrawn students hold no active enrolment.
    if status in ("graduated", "withdrawn"):
        load: list[str] = []
    elif scenario:
        load = list(scenario[2])
    elif year_of_study == "Second":
        load = list(SECOND_YEAR_LOADS[rotation % len(SECOND_YEAR_LOADS)])
    else:
        load = list(FIRST_YEAR_LOADS[rotation % len(FIRST_YEAR_LOADS)])
    student_load[i] = load

    prog_code = PROGRAM_CODES[i % len(PROGRAM_CODES)]
    student_program[i] = prog_code

    # `enrollment_load` is a D30 column the pre-D31 seed left NULL on all 45 rows, so
    # `StudentDetail.enrollment_load` was an empty field on every profile the API
    # served. Rotated here so all three enum values appear in the data.
    if i == 29:
        enrollment_load = "Transient"
    elif i % 7 == 3:
        enrollment_load = "Part Time"
    else:
        enrollment_load = "Full Time"

    student_number = f"S-{25001 + i}"
    user_id = None
    if i < 6:
        user_id = add_user(
            f"user-stu-{i + 1}",
            f"{student_number.lower()}@student.belmopancomp.edu.bz",
            student_number.lower(), f"{firstname} {lastname}", "student",
            status == "active",
            dt(add_days(DEMO_TODAY, -rng_stu.randint(0, 7)), "15:00:00"),
        )

    # D30 §D10: names are stored SPLIT; `full_name` was dropped in `007` and is a
    # hybrid property on the ORM model.
    add("student_profiles", id=sid, user_id=user_id, student_number=student_number,
        firstname=firstname, middlename=middlename, lastname=lastname,
        date_of_birth=dob,
        gender=("female" if i % 2 == 0 else "male"), enrollment_date=date(2025, 9, 1),
        status=status, program_id=program_id(prog_code), year_of_study=year_of_study,
        enrollment_load=enrollment_load,
        guardian_name=f"{rng_stu.choice(FIRST_NAMES)} {lastname}",
        guardian_phone=f"+501-6{rng_stu.randint(100000, 999999)}",
        guardian_email=f"{lastname.lower()}.guardian@example.bz",
        address=(f"{rng_stu.randint(1, 99)} "
                 f"{rng_stu.choice(['Cedar', 'Mahogany', 'Bougainvillea', 'Hibiscus'])} "
                 f"Street, Belmopan"),
        phone=f"+501-6{rng_stu.randint(100000, 999999)}")

# ── student_program_history ────────────────────────────────────────────────────────
# Every student gets the OPEN row for the programme they are on. This table was EMPTY in
# the live database (and all 45 students carried `program_id` NULL), so the
# programme-change screens had nothing to render and `uq_student_program_open` was never
# exercised by any data.
#
# One student (`stu-3`) additionally carries a CLOSED earlier row, so the table is a
# genuine history rather than a second copy of `student_profiles.program_id`: it is the
# only shape that shows a transfer, and it proves the "exactly one OPEN row per student"
# unique index does what it claims.
SWITCHER = 2                       # 0-based -> `stu-3`
SWITCHER_FROM = "GNST"             # General Studies -> their current programme
sph = 0
for i in range(45):
    if i == SWITCHER and student_program[i] != SWITCHER_FROM:
        sph += 1
        add("student_program_history", id=uid(f"sph-{sph}"), student_id=student_ids[i],
            program_id=program_id(SWITCHER_FROM), started_at=date(2025, 9, 1),
            ended_at=date(2025, 9, 26), reason="Admitted")
        sph += 1
        add("student_program_history", id=uid(f"sph-{sph}"), student_id=student_ids[i],
            program_id=program_id(student_program[i]), started_at=date(2025, 9, 26),
            ended_at=None, reason="Programme change approved by the Dean")
        continue
    sph += 1
    add("student_program_history", id=uid(f"sph-{sph}"), student_id=student_ids[i],
        program_id=program_id(student_program[i]), started_at=date(2025, 9, 1),
        ended_at=None, reason="Admitted")

# ═══════════════════════════════════════════════════════════════════════════════════
# Enrolments — MANY per student, one row per offering they take
# ═══════════════════════════════════════════════════════════════════════════════════
# An enrolment's `semester_id` MUST agree with its offering's: an offering belongs to
# one term, so a Semester-1 offering cannot hold a Semester-2 enrolment. It is READ OFF
# the offering rather than passed in, which makes that impossible to get wrong here.
enr_counter = 0
#: (student idx, offering key) -> class_enrollments.id, for the ACTIVE row only.
active_enr: dict[tuple[int, str], str] = {}
ENROLLED_AT = {SEM_ACTIVE: "2025-09-01 08:00:00", SEM_2025_2: "2026-01-19 08:00:00",
               SEM_2024_1: "2024-09-02 08:00:00"}


def add_enrollment(stu_idx: int, key: str, unenrolled=None) -> str:
    global enr_counter
    enr_counter += 1
    sem = offering_semester[key]
    eid = uid(f"enr-{enr_counter}")
    add("class_enrollments", id=eid, offering_id=offering_id_by_key[key],
        student_id=student_ids[stu_idx], semester_id=uid(sem),
        enrollment_status="enrolled", enrolled_at=ENROLLED_AT[sem],
        unenrolled_at=unenrolled)
    if unenrolled is None:
        active_enr[(stu_idx, key)] = eid
    return eid


for i in range(45):
    for key in student_load[i]:
        add_enrollment(i, key)

# Semester-2 continuation. Every student carrying a Semester-1 offering of a course also
# enrols in that course's Semester-2 offering, so the year·semester switcher shows a
# real, DIFFERENT term rather than an empty table — which was indistinguishable from the
# filter being broken. Matching is by COURSE, not by section: a student in MATH1110-02
# continues into the single Semester-2 section, which is how a real registration works.
for i in range(45):
    sem1_courses = {offering_course[k] for k in student_load[i]}
    for key in SEM2_KEYS:
        if offering_course[key] in sem1_courses:
            add_enrollment(i, key)
            student_load[i].append(key)

# One student SWITCHED Algebra sections mid-term: a closed row on -01 alongside their
# active row on -02. `enroll_active_flag` is NULL on the closed row, so the unique index
# permits both — and this exercises the "grade rows ∪ active roster" path. It is a switch
# of ONE offering, not the old whole-student homeroom "transfer".
SWITCH_IDX = 33
add_enrollment(SWITCH_IDX, "MATH1110-01", unenrolled="2025-09-25 08:00:00")


def roster(key: str) -> list[int]:
    """Students holding an ACTIVE enrolment in this offering."""
    return [i for i in range(45) if (i, key) in active_enr]


# ═══════════════════════════════════════════════════════════════════════════════════
# Assessment categories + assessments
# ═══════════════════════════════════════════════════════════════════════════════════
for key in list(offering_id_by_key):
    off = offering_id_by_key[key]
    # Drop-lowest on the Algebra offerings, so the category-level setting is exercised
    # by something rather than sitting at 0 everywhere.
    drop = 1 if offering_course[key] == "MATH1110" else 0
    add("assessment_categories", id=uid(f"cat-{key}-q"), offering_id=off,
        name="Quizzes", weight=Decimal("0.40"), drop_lowest_count=drop)
    add("assessment_categories", id=uid(f"cat-{key}-t"), offering_id=off,
        name="Tests", weight=Decimal("0.60"), drop_lowest_count=0)

# **D31 changed where an assessment's term comes from.** Under the year-scoped model an
# assessment carried its own `semester_id` independently of its class_subject, so one
# gradebook held both terms' work and the seed picked a term per TEMPLATE. An offering
# belongs to ONE term now, so the term is read off the offering — a Semester-1 offering
# cannot hold a Semester-2 assessment, and this seed cannot express one.
#
# Semester-1 rows are anchored to DEMO_TODAY. Semester-2 rows carry absolute dates
# inside that term's window (2026-01-19 → 2026-06-26), which is AFTER DEMO_TODAY — so
# they are published and unreleased: an upcoming term, which is what a student expects
# to see there.
#
#   title, type, category suffix, max, weight, offset from DEMO_TODAY, absolute date,
#   status, is_released
SEM1_ASMT = [
    ("Quiz 1", "quiz", "q", 20, "1.00", -30, None, "graded", True),
    ("Quiz 2", "quiz", "q", 20, "1.00", -16, None, "graded", True),
    ("Unit Test 1", "test", "t", 50, "1.00", -9, None, "graded", False),
    ("Project", "assignment", None, 100, "1.00", 7, None, "published", False),
]
SEM2_ASMT = [
    ("Quiz 1", "quiz", "q", 20, "1.00", 0, date(2026, 2, 10), "published", False),
    ("Midterm Exam", "exam", "t", 100, "2.00", 0, date(2026, 3, 18), "published", False),
]
#: The archived year is complete, so every historical assessment is graded + released.
HIST_ASMT = [
    ("Quiz 1", "quiz", "q", 20, "1.00", -90),
    ("Quiz 2", "quiz", "q", 20, "1.00", -60),
    ("Midterm Test", "test", "t", 50, "1.00", -30),
    ("Final Project", "assignment", None, 100, "1.00", -10),
]

asmt_counter = 0
#: assessment demo id -> (offering key, max score, status)
asmt_meta: dict[str, tuple[str, int, str]] = {}
for key in list(offering_id_by_key):
    templates = SEM1_ASMT if offering_semester[key] == SEM_ACTIVE else SEM2_ASMT
    for title, typ, cat, mx, weight, off_days, abs_date, status, released in templates:
        asmt_counter += 1
        aid = f"asmt-{asmt_counter}"
        asmt_meta[aid] = (key, mx, status)
        add("assessments", id=uid(aid), offering_id=offering_id_by_key[key],
            semester_id=uid(offering_semester[key]),
            category_id=(uid(f"cat-{key}-{cat}") if cat else None), title=title,
            type=typ, max_score=Decimal(mx), weight=Decimal(weight),
            assessment_date=(abs_date or add_days(DEMO_TODAY, off_days)),
            status=status, is_released=released, released_at=None)

# ── assessment grades ──────────────────────────────────────────────────────────────
rng_grade = random.Random(31337)
grade_counter = 0
for aid, (key, mx, status) in asmt_meta.items():
    for i in roster(key):
        grade_counter += 1
        gstatus, score = "pending", None
        if status == "graded":
            # Mostly graded; sprinkle absent/excused/pending to exercise every state.
            roll = rng_grade.random()
            if roll < 0.06:
                gstatus = "absent"
            elif roll < 0.10:
                gstatus = "excused"
            elif roll < 0.12:
                gstatus = "pending"
            else:
                gstatus = "graded"
                # Centred on 84%, not 75%. The old centre was written against the
                # pre-D30 5-band scale where 60 passed and 90 was an A; D30 moved BAJC's
                # pass mark to **70** and put A at 95 without re-centring this line, and
                # the result was a demo college with a **37% failure rate** — 36 F's in
                # 159 term grades, and Freddy Lopez, the student the demo LANDS ON,
                # holding a D. The scale change made the same numbers mean something
                # different, which no test could notice because nothing asserts on a
                # believable distribution.
                pct = min(1.0, max(0.45, 0.84 + (rng_grade.random() - 0.5) * 0.30))
                score = Decimal(round(pct * mx))
        add("assessment_grades", id=uid(f"grd-{grade_counter}"), assessment_id=uid(aid),
            student_id=student_ids[i], enrollment_id=active_enr[(i, key)],
            status=gstatus, score=score, makeup_score=None, is_released=None)

# ═══════════════════════════════════════════════════════════════════════════════════
# Attendance — the ACTIVE term only
# ═══════════════════════════════════════════════════════════════════════════════════
# Attendance is taken in the term a course actually runs, and DEMO_TODAY sits in
# Semester 1. Seeding the Semester-2 offerings would claim a register was taken four
# months before the term opened.
recorder = teacher_user[teacher_for("MATH1110")]


def weekday_window(anchor: date) -> list[date]:
    return [
        add_days(anchor, d) for d in range(-13, 1) if is_weekday(add_days(anchor, d))
    ]


rng_att = random.Random(55555)
att_counter = 0
for key in SEM1_KEYS:
    members = roster(key)
    for d in weekday_window(DEMO_TODAY):
        for i in members:
            att_counter += 1
            roll = rng_att.random()
            st = ("present" if roll < 0.9 else "absent" if roll < 0.95
                  else "late" if roll < 0.98 else "excused")
            add("attendance_records", id=uid(f"att-{att_counter}"),
                offering_id=offering_id_by_key[key], student_id=student_ids[i],
                enrollment_id=active_enr[(i, key)], semester_id=uid(SEM_ACTIVE),
                attendance_date=d, status=st, created_by=recorder)

# ═══════════════════════════════════════════════════════════════════════════════════
# Announcements + read state
# ═══════════════════════════════════════════════════════════════════════════════════
# `ann-4` is targeted at ONE OFFERING. The `audience` enum keeps its `'class'` member —
# it is a wire value the ORM, the API and the MSW handlers all share — but what it points
# at is an offering now, and `ck_announcements_offering_audience` enforces
# "audience='class' iff a target is set" in both directions.
ANN = [
    ("ann-1", "Welcome back to the 2025-2026 school year",
     "Classes resume Monday. Please collect timetables from the front office and "
     "review the updated code of conduct posted on the notice board.",
     "all", None, USER_PRINCIPAL, dt(add_days(DEMO_TODAY, -20), "08:00:00"), None,
     ["user-teach-1", "user-stu-1"]),
    ("ann-2", "Staff meeting — Thursday 3:30 PM",
     "All teaching staff should attend the term-planning meeting in the staff room. "
     "Department heads, please bring your assessment calendars.",
     "teachers", None, USER_PRINCIPAL, dt(add_days(DEMO_TODAY, -6), "14:00:00"),
     dt(add_days(DEMO_TODAY, 2), "00:00:00"), ["user-teach-1"]),
    ("ann-3", "Midterm exam schedule released",
     "The midterm timetable is now available. Review your courses and prepare "
     "accordingly. Speak to your lecturers about any clashes.",
     "students", None, USER_SECRETARY, dt(add_days(DEMO_TODAY, -4), "10:00:00"), None,
     []),
    ("ann-4", "BIOL1102-01 — bring lab coats Friday",
     "For our first Biology practical this Friday, everyone in BIOL1102-01 must bring "
     "a lab coat and closed-toe shoes.",
     "class", "BIOL1102-01", uid("user-teach-3"),
     dt(add_days(DEMO_TODAY, -2), "11:30:00"),
     dt(add_days(DEMO_TODAY, 3), "00:00:00"), []),
    ("ann-5", "Sports Day — save the date",
     "Annual Sports Day is scheduled for next month. House captains will be announced "
     "shortly. Get your teams ready!",
     "all", None, uid("user-teach-8"), dt(add_days(DEMO_TODAY, -1), "09:00:00"), None,
     []),
    ("ann-6", "Library closed for stocktake (expired)",
     "The library was closed last week for the annual stocktake. It has since reopened "
     "for normal hours.",
     "all", None, USER_SECRETARY, dt(add_days(DEMO_TODAY, -12), "08:00:00"),
     dt(add_days(DEMO_TODAY, -8), "00:00:00"), ["user-teach-1", "user-stu-1"]),
]
for aid, title, body, audience, off_key, author, pub, exp, reads in ANN:
    add("announcements", id=uid(aid), author_id=author, title=title, body=body,
        audience=audience,
        offering_id=(offering_id_by_key[off_key] if off_key else None),
        published_at=pub, expires_at=exp)
    for u in reads:
        add("announcement_reads", announcement_id=uid(aid), user_id=uid(u), read_at=pub)

# ═══════════════════════════════════════════════════════════════════════════════════
# Calendar events
# ═══════════════════════════════════════════════════════════════════════════════════
# Spread around DEMO_TODAY so the calendar opens onto a lively month, with a couple of
# next-month entries to make month navigation meaningful. Belize public holidays are
# used where they fall in-window.
EVENTS = [
    ("evt-1", "Staff Development Day",
     "No classes for students. All teaching staff attend professional-development "
     "workshops.", "meeting", "internal", -6, None, True, None, None, "Main Hall",
     USER_PRINCIPAL),
    ("evt-2", "Pan American Day", "Public holiday — school closed.", "holiday",
     "global", -3, None, True, None, None, None, USER_SECRETARY),
    ("evt-3", "School Photo Day",
     "Class and individual photographs. Students must be in full uniform.", "activity",
     "global", 0, None, False, "09:00", "12:00", "Gymnasium", USER_SECRETARY),
    ("evt-4", "Term Planning — Staff Meeting",
     "All teaching staff meet to review the mid-term timetable and assessment "
     "calendar.", "meeting", "internal", 1, None, False, "17:00", "18:30",
     "Auditorium", USER_PRINCIPAL),
    ("evt-5", "Midterm Examinations",
     "Midterm exams across all programmes. Refer to the posted timetable for your "
     "courses.", "exam", "global", 5, 9, True, None, None, None, USER_PRINCIPAL),
    ("evt-6", "Inter-House Sports Day",
     "Annual athletics competition between houses. Family and friends welcome to "
     "attend.", "activity", "global", 12, None, False, "08:00", "14:00",
     "Sports Field", USER_SECRETARY),
    ("evt-7", "First-Term Report Cards Issued",
     "Report cards for the first term are released to students and guardians.",
     "other", "global", 16, None, True, None, None, None, USER_SECRETARY),
    ("evt-8", "Garifuna Settlement Day", "National public holiday — school closed.",
     "holiday", "global", 35, None, True, None, None, None, USER_PRINCIPAL),
]
for eid, title, desc, cat, vis, so, eo, allday, st, et, loc, author in EVENTS:
    add("events", id=uid(eid), title=title, description=desc, category=cat,
        visibility=vis, start_date=add_days(DEMO_TODAY, so),
        end_date=(add_days(DEMO_TODAY, eo) if eo is not None else None),
        all_day=allday, start_time=st, end_time=et, location=loc,
        created_by_user_id=author)

# ═══════════════════════════════════════════════════════════════════════════════════
# The archived year (2024-2025) — a full parallel dataset
# ═══════════════════════════════════════════════════════════════════════════════════
# So the per-module year switcher shows populated, DISTINCT data when a past year is
# selected. Same students, lecturers and courses (those entities persist across years);
# separate offerings, enrolments, assessments, grades and attendance, all tagged to the
# archived year's Semester 1.
#
# **D31 makes the mirror both simpler and more correct.** It used to build two parallel
# tables (`sec-2024-N` + `cs-2024-N`) scoped by `academic_year_id`, which meant the
# archived year's teaching could not say WHICH term it belonged to; `semester_id` says it
# directly now. Only the SEMESTER-1 offerings are mirrored: the Semester-2 rows are this
# year's continuation and have no last-year twin.
#
# They get NO `class_meetings`: a timetable is about where to be now, and reconstructing
# an archived week would imply the schedule is historical data, which it is not.
hist_key_by_key: dict[str, str] = {}
for idx, key in enumerate(SEM1_KEYS):
    hist_key = f"{key}@2024"
    hist_key_by_key[key] = hist_key
    off = f"off-2024-{idx + 1}"
    code = offering_course[key]
    offering_id_by_key[hist_key] = uid(off)
    offering_course[hist_key] = code
    offering_section[hist_key] = offering_section[key]
    offering_capacity[hist_key] = offering_capacity[key]
    offering_semester[hist_key] = SEM_2024_1
    # `is_archived=True` so every existing "active" filter keeps excluding them by
    # default; the year switcher reaches them through their semester.
    add("course_offerings", id=uid(off), course_id=course_id(code),
        semester_id=uid(SEM_2024_1), section_code=offering_section[key],
        capacity=offering_capacity[key], is_archived=True)
    lead = teacher_for(code)
    add("class_teachers", id=uid(f"ct-{off}-{lead}"), offering_id=uid(off),
        teacher_id=teacher_ids[lead], is_lead=True)
    add("assessment_categories", id=uid(f"cat-{hist_key}-q"), offering_id=uid(off),
        name="Quizzes", weight=Decimal("0.40"),
        drop_lowest_count=(1 if code == "MATH1110" else 0))
    add("assessment_categories", id=uid(f"cat-{hist_key}-t"), offering_id=uid(off),
        name="Tests", weight=Decimal("0.60"), drop_lowest_count=0)

# Historical enrolments: give each student the SAME course load they carry this year,
# against last year's twin of each offering. Graduated / withdrawn students hold no
# CURRENT load but did sit last year, so they fall back to the first-year default set —
# otherwise the archived year would show them enrolled in nothing, which is exactly the
# record a transcript needs.
for i in range(45):
    current = [k for k in student_load[i] if k in hist_key_by_key]
    keys = current if current else list(FIRST_YEAR_LOADS[0])
    for key in keys:
        add_enrollment(i, hist_key_by_key[key])

hist_asmt_counter = 0
hist_meta: dict[str, tuple[str, int]] = {}
for key in SEM1_KEYS:
    hist_key = hist_key_by_key[key]
    for title, typ, cat, mx, weight, off_days in HIST_ASMT:
        hist_asmt_counter += 1
        aid = f"asmt-2024-{hist_asmt_counter}"
        hist_meta[aid] = (hist_key, mx)
        add("assessments", id=uid(aid), offering_id=offering_id_by_key[hist_key],
            semester_id=uid(SEM_2024_1),
            category_id=(uid(f"cat-{hist_key}-{cat}") if cat else None), title=title,
            type=typ, max_score=Decimal(mx), weight=Decimal(weight),
            assessment_date=add_days(HIST_ANCHOR, off_days), status="graded",
            is_released=True, released_at=None)

rng_hist_grade = random.Random(24680)
hist_grade_counter = 0
for aid, (hist_key, mx) in hist_meta.items():
    for i in roster(hist_key):
        hist_grade_counter += 1
        roll = rng_hist_grade.random()
        gstatus, score = "graded", None
        if roll < 0.05:
            gstatus = "absent"
        elif roll < 0.08:
            gstatus = "excused"
        else:
            gstatus = "graded"
            pct = min(1.0, max(0.4, 0.78 + (rng_hist_grade.random() - 0.5) * 0.4))
            score = Decimal(round(pct * mx))
        add("assessment_grades", id=uid(f"grd-2024-{hist_grade_counter}"),
            assessment_id=uid(aid), student_id=student_ids[i],
            enrollment_id=active_enr[(i, hist_key)], status=gstatus, score=score,
            makeup_score=None, is_released=True)

rng_hist_att = random.Random(99999)
hist_att_counter = 0
for key in SEM1_KEYS:
    hist_key = hist_key_by_key[key]
    members = roster(hist_key)
    for d in weekday_window(HIST_ANCHOR):
        for i in members:
            hist_att_counter += 1
            roll = rng_hist_att.random()
            st = ("present" if roll < 0.9 else "absent" if roll < 0.95
                  else "late" if roll < 0.98 else "excused")
            add("attendance_records", id=uid(f"att-2024-{hist_att_counter}"),
                offering_id=offering_id_by_key[hist_key], student_id=student_ids[i],
                enrollment_id=active_enr[(i, hist_key)], semester_id=uid(SEM_2024_1),
                attendance_date=d, status=st, created_by=recorder)


# ═══════════════════════════════════════════════════════════════════════════════════
# Emit SQL + load into the live DB
# ═══════════════════════════════════════════════════════════════════════════════════
def build_sql() -> str:
    parts = [
        "-- Full TERTIARY demo dataset for the MariaDB `sims` DB (Belize Adventist",
        "-- Junior College). GENERATED by backend/db/mariadb/seed_demo.py.",
        "--",
        "-- NOT TRACKED IN GIT, deliberately: the `users` INSERT carries a per-account",
        "-- Argon2 hash of a password generated on the run that produced this file. The",
        "-- pre-D31 version WAS tracked and shared ONE hardcoded password across 19",
        "-- accounts, so rotating the constant never fixed the checked-in file.",
        "-- Re-generate rather than copy, and read the plaintexts from",
        "-- demo-credentials.txt beside it.",
        "--",
        "-- Requires `008_course_offerings.sql` applied and the BAJC catalog seeded",
        "-- (`python -m app.db.seed_bajc`): the courses and programmes referenced below",
        "-- are resolved BY CODE and are NOT created here.",
        "SET @OLD_FK = @@FOREIGN_KEY_CHECKS; SET FOREIGN_KEY_CHECKS = 0;",
        "SET @OLD_MODE = @@SESSION.sql_mode; SET SESSION sql_mode = '';",
        "",
        "-- Cleared but NOT repopulated: every one of these has an FK into users /",
        "-- student_profiles / course_offerings, so leaving them behind would strand rows",
        "-- pointing at ids that no longer exist. refresh_sessions matters most: user ids",
        "-- are deterministic, so a session issued before a re-seed would otherwise still",
        "-- authenticate against the new account and its new password.",
    ]
    for t in SWEEP_ONLY:
        parts.append(f"DELETE FROM `{t}`;")
    parts += [
        "",
        "-- `courses`, `programs`, `program_courses` and `course_prerequisites` are",
        "-- REFERENCE DATA owned by app/db/seed_bajc.py and are never cleared: FK checks",
        "-- are off during this sweep, so a DELETE here would silently destroy the real",
        "-- BAJC catalog and every programme curriculum hanging off it.",
    ]
    for t in reversed(ORDER):
        parts.append(f"DELETE FROM `{t}`;")
    parts.append("")
    for t in ORDER:
        if t not in TABLES:
            continue
        cols, rows = TABLES[t]
        collist = ", ".join(f"`{c}`" for c in cols)
        parts.append(f"-- {t} ({len(rows)} rows)")
        for chunk_start in range(0, len(rows), 200):
            chunk = rows[chunk_start:chunk_start + 200]
            values = ",\n".join(
                "(" + ", ".join(lit(r[c]) for c in cols) + ")" for r in chunk
            )
            parts.append(f"INSERT INTO `{t}` ({collist}) VALUES\n{values};")
        parts.append("")
    parts.append("SET SESSION sql_mode = @OLD_MODE; SET FOREIGN_KEY_CHECKS = @OLD_FK;")
    return "\n".join(parts) + "\n"


def build_credentials() -> str:
    lines = [
        "SIS DEMO LOGINS - Belize Adventist Junior College",
        "",
        "GENERATED, NOT TRACKED IN GIT. One password per account, freshly generated on",
        "every run of `python -m db.mariadb.seed_demo`. Every account has",
        "must_change_password = true, which the SERVER enforces: until the password is",
        "changed the API answers 403 `password_change_required` on everything except",
        "GET /auth/me, PATCH /auth/me/password and POST /auth/logout.",
        "",
        "Re-seeding replaces these. Delete this file when you are done with it.",
        "",
    ]
    width = max(len(email) for _r, email, _p in CREDENTIALS)
    for role, email, plaintext in CREDENTIALS:
        lines.append(f"{role:<10} {email:<{width}}  {plaintext}")
    return "\n".join(lines) + "\n"


def _assert_safe_to_seed() -> None:
    """Refuse to run unless this is explicitly a local/demo environment.

    ⚠️ THIS SCRIPT IS THE MOST DESTRUCTIVE THING IN THE REPOSITORY. It `DELETE`s every
    row from ~34 tables and re-creates the whole college. Run against a live database it
    destroys the real records.

    Nothing stopped that before: the script imported the app's engine and wrote to
    whatever `DATABASE_URL` happened to be configured. On a server where the production
    `.env` sits next to it — the normal layout — one command run in the wrong directory
    was enough.

    Two independent conditions must both hold, so a single mistake is not sufficient:
      1. `ENVIRONMENT` must be `local` (the app's own notion of a dev box), and
      2. `SIS_ALLOW_DEMO_SEED=yes-destroy-my-data` must be exported.

    The second is deliberately awkward. This is not a prompt, because prompts get piped
    `yes` — it has to be typed on purpose.
    """
    settings = get_settings()
    consent = os.environ.get("SIS_ALLOW_DEMO_SEED", "")
    problems: list[str] = []
    if not settings.is_local:
        problems.append(f"ENVIRONMENT is {settings.environment!r}, not 'local'")
    if consent != "yes-destroy-my-data":
        problems.append("SIS_ALLOW_DEMO_SEED is not set to 'yes-destroy-my-data'")
    if not problems:
        return

    # Show WHICH database was about to be wiped, with the password redacted — the
    # operator needs to recognise the target, not be handed a credential.
    target = re.sub(r"//[^@/]*@", "//<redacted>@", settings.database_url)
    raise SystemExit(
        "REFUSING TO SEED — this script deletes every row in ~34 tables and re-creates "
        "the whole demo college.\n"
        f"  Target database : {target}\n"
        + "".join(f"  Blocked because : {p}\n" for p in problems)
        + "\nIf this really is a throwaway local database:\n"
        '  $env:ENVIRONMENT="local"; $env:SIS_ALLOW_DEMO_SEED="yes-destroy-my-data"\n'
        "and run again. Never do this on a database holding real student records."
    )


def main() -> None:
    _assert_safe_to_seed()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sql = build_sql()
    SQL_OUT.write_text(sql, encoding="utf-8")
    CRED_OUT.write_text(build_credentials(), encoding="utf-8")

    counts = {t: len(TABLES[t][1]) for t in ORDER if t in TABLES}
    with engine.begin() as conn:
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
        conn.exec_driver_sql("SET SESSION sql_mode = ''")
        for t in SWEEP_ONLY:
            conn.exec_driver_sql(f"DELETE FROM `{t}`")
        for t in reversed(ORDER):
            conn.exec_driver_sql(f"DELETE FROM `{t}`")
        for t in ORDER:
            if t not in TABLES:
                continue
            cols, rows = TABLES[t]
            collist = ", ".join(f"`{c}`" for c in cols)
            for cs in range(0, len(rows), 200):
                chunk = rows[cs:cs + 200]
                values = ",".join(
                    "(" + ", ".join(lit(r[c]) for c in cols) + ")" for r in chunk
                )
                conn.exec_driver_sql(f"INSERT INTO `{t}` ({collist}) VALUES {values}")
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")

    print(f"Wrote {SQL_OUT} ({len(sql):,} bytes)")
    print(f"Wrote {CRED_OUT} ({len(CREDENTIALS)} accounts, one password each)")
    print("\nSeeded live DB. Row counts:")
    total = 0
    for t, n in counts.items():
        total += n
        print(f"  {t:26} {n}")
    print(f"  {'TOTAL':26} {total}")
    print(
        f"\nLogins: {CRED_OUT}\n"
        "Every account has must_change_password=true — the API answers 403 "
        "password_change_required\nuntil the password is changed (GET /auth/me, "
        "PATCH /auth/me/password and POST /auth/logout excepted)."
    )


if __name__ == "__main__":
    main()

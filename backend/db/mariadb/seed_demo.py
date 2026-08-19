"""Full demo-dataset seed for the self-hosted MariaDB `sims` database.

Reproduces the coherent Belize Adventist Junior College dataset that the frontend
MSW demo uses (`frontend/src/shared/api/mocks/demo/data.ts`) and loads it into the
live MariaDB through the ORM's configured engine, so the REAL backend is populated
with the same school the client has already seen.

Design:
  * Deterministic — demo string ids ('teach-1', 'sec-3', 'cs-12', …) are mapped to
    stable UUIDv5 values, so cross-references resolve and re-runs are idempotent.
    Stochastic fields (scores, attendance marks, DOBs, guardians) use seeded RNGs,
    so a re-run yields the same rows.
  * Idempotent — clears the 22 seeded tables (FK checks off) then re-inserts. The
    4 dormant legacy tables (staff, students, grades, cat_assessment) and unused
    ORM tables (audit_log, *_snapshots, login_attempts, …) are never touched.
  * Honors the live CHECK/UNIQUE constraints: score non-null IFF status='graded';
    announcements.class_id set IFF audience='class'; single active year + single
    active semester; assessments.max_score>0; JSON validity; sequence in (1,2).
  * Generated columns (active_email, active_class_name, enroll_active_flag, …) are
    never written — MariaDB computes them.

It ALSO writes a static `010_seed_demo.sql` (same INSERTs) so the dataset can be
re-loaded from HeidiSQL without Python.

Run:  cd backend && .venv/Scripts/python -m db.mariadb.seed_demo
      (or:  python backend/db/mariadb/seed_demo.py)

Login (all 19 seeded accounts share one password, must_change_password=false):
      email: principal@belmopancomp.edu.bz   password: SimsDemo2025!
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
from app.core.security import hash_password  # noqa: E402
from app.db.session import engine  # noqa: E402

# ── Config ───────────────────────────────────────────────────────────────────────
DEMO_PASSWORD = "SimsDemo2025!"
DEMO_TODAY = date(2025, 10, 15)
HIST_ANCHOR = date(2025, 1, 10)
_NS = uuid.UUID("11111111-2222-3333-4444-555555555555")
SQL_OUT = Path(__file__).with_name("010_seed_demo.sql")


def uid(key: str) -> str:
    """Stable UUIDv5 for a demo string id."""
    return str(uuid.uuid5(_NS, key))


def add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def is_weekday(d: date) -> bool:
    return d.weekday() < 5  # Mon-Fri


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
ORDER = [
    "users", "user_preferences", "school_profile", "assessment_policies",
    "academic_years", "semesters", "grading_scales", "grading_scale_bands",
    "classes", "teacher_profiles", "student_profiles",
    "class_subjects", "class_teachers", "class_enrollments",
    "assessment_categories", "assessments", "assessment_grades",
    "attendance_records", "announcements", "announcement_reads", "events",
]


def add(table: str, **cols) -> None:
    if table not in TABLES:
        TABLES[table] = (list(cols.keys()), [])
    TABLES[table][1].append(cols)


# ═══════════════════════════════════════════════════════════════════════════════════
# Build the dataset (mirrors data.ts, adapted to the live schema)
# ═══════════════════════════════════════════════════════════════════════════════════
PW_HASH = hash_password(DEMO_PASSWORD)

YEAR_ARCHIVED, YEAR_ACTIVE = "ay-2024", "ay-2025"
SEM_ACTIVE, SEM_2024_1 = "sem-2025-1", "sem-2024-1"

# The eleven REAL BAJC courses this demo school teaches, by catalog code (D30 Phase
# 2D). They are not created here — see the `courses` note below.
#
# MATH1210 (Pre-Calculus) is in the set on purpose: it genuinely requires MATH1110
# (Intermediate Algebra) in the 26/27 sequences, so the prerequisite gate fires on a
# real rule.
SUBJECT_SEED = [
    ("Intermediate Algebra", "MATH1110"),
    ("Pre-Calculus", "MATH1210"),
    ("College English 1", "ENGL1102"),
    ("Foundations of Biology", "BIOL1102"),
    ("Fundamentals of Chemistry", "CHEM1100"),
    ("Belizean History", "HIST2102"),
    ("Introduction to Sociology", "SOCI1212"),
    ("Intermediate Spanish", "SPAN2112"),
    ("Health Principles", "THEO2201"),
    ("Introduction to Computers", "ITEC1104"),
    ("Business Management", "MGMT1106"),
]
SUBJ_NAME = {code: name for name, code in SUBJECT_SEED}

#: code -> the id `seed_bajc` gave it. Filled from the live DB at import time, because
#: the catalog uses server-generated uuids rather than this file's deterministic uuid5.
_COURSE_IDS: "dict[str, str]" = {}


def _load_course_ids() -> None:
    from sqlalchemy import text as _text

    with engine.connect() as conn:
        for code, cid in conn.execute(
            _text("SELECT code, CAST(id AS char) FROM courses WHERE deleted_at IS NULL")
        ):
            _COURSE_IDS[str(code).upper()] = str(cid)


_load_course_ids()


def subj_id(code: str) -> str:
    return course_id_by_code(code)


SECTION_SEED = [
    ("Form 1A", "Form 1", "A", 30), ("Form 1B", "Form 1", "B", 30),
    ("Form 2A", "Form 2", "A", 28), ("Form 2B", "Form 2", "B", 28),
    ("Form 3A", "Form 3", "A", 26), ("Form 3B", "Form 3", "B", 26),
    ("Form 4 Science", "Form 4", "Science", 24),
    ("Form 4 Business", "Form 4", "Business", 24),
]

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
DESIGNATIONS = ["Head of Department", "Senior Teacher", "Senior Teacher", "Teacher"]
DEGREES = {"Head of Department": "M.Ed.", "Senior Teacher": "M.Sc.", "Teacher": "B.Ed."}
STREETS = ["Constitution Drive", "Forest Drive", "Melhado Parade", "Bliss Parade",
           "Hummingbird Avenue", "Ring Road"]

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
SEMESTER_SEED = [
    ("sem-2024-1", YEAR_ARCHIVED, "Semester 1", 1, date(2024, 9, 2), date(2025, 1, 17), False),
    ("sem-2024-2", YEAR_ARCHIVED, "Semester 2", 2, date(2025, 1, 20), date(2025, 6, 27), False),
    (SEM_ACTIVE, YEAR_ACTIVE, "Semester 1", 1, date(2025, 9, 1), date(2026, 1, 16), True),
    ("sem-2025-2", YEAR_ACTIVE, "Semester 2", 2, date(2026, 1, 19), date(2026, 6, 26), False),
]
for sid, yr, name, seq, sd, ed, active in SEMESTER_SEED:
    add("semesters", id=uid(sid), academic_year_id=uid(yr), name=name, sequence=seq,
        start_date=sd, end_date=ed, is_active=active)

# ── grading scales + bands ─────────────────────────────────────────────────────────
BANDS = [("A", "90.00", "100.00", True, 1), ("B", "80.00", "89.99", True, 2),
         ("C", "70.00", "79.99", True, 3), ("D", "60.00", "69.99", True, 4),
         ("F", "0.00", "59.99", False, 5)]
for yr, frozen in [(YEAR_ACTIVE, False), (YEAR_ARCHIVED, True)]:
    gs = uid(f"gs-{yr}")
    add("grading_scales", id=gs, academic_year_id=uid(yr), pass_mark=Decimal("60.00"),
        is_frozen=frozen)
    for letter, lo, hi, passing, order in BANDS:
        add("grading_scale_bands", id=uid(f"band-{yr}-{letter}"), grading_scale_id=gs,
            letter=letter, min_score=Decimal(lo), max_score=Decimal(hi),
            is_passing=passing, sort_order=order)

# ── courses: REFERENCED, never created here (D30 Phase 2D) ─────────────────────────
#
# The catalog is REFERENCE DATA and belongs to `app/db/seed_bajc.py`, which loads the
# real 114 BAJC courses from the 26/27 sequences. This file used to create eleven
# invented subjects of its own, and after the 2A cutover pointed the catalog at
# `courses` that became actively dangerous: `ORDER` drives a `DELETE FROM` sweep with
# FK checks off, so re-seeding the demo would have silently destroyed the real catalog
# and every programme curriculum hanging off it.
#
# `courses` is therefore OUT of `ORDER` (nothing here clears it) and the demo classes
# resolve their course ids by CODE from what `seed_bajc` already loaded.
def course_id_by_code(code: str) -> str:
    """The seeded BAJC course id for `code`, or fail loudly.

    A demo seed that silently invents a missing course is how the two datasets drift
    apart, so this refuses instead — run `python -m app.db.seed_bajc` first.
    """
    row = _COURSE_IDS.get(code.upper())
    if row is None:
        raise SystemExit(
            f"Course {code!r} is not in the catalog. Run the BAJC catalog seed first:\n"
            f"    python -m app.db.seed_bajc"
        )
    return row

# ── users (principal + secretary + teacher/student logins) ─────────────────────────
def add_user(key, email, username, full_name, role, is_active):
    uu = uid(key)
    add("users", id=uu, email=email, username=username, password_hash=PW_HASH,
        role=role, full_name=full_name, is_active=is_active,
        must_change_password=False, failed_login_count=0)
    add("user_preferences", user_id=uu, locale="en", theme="light",
        date_format=None, default_page_size=25)
    return uu


add_user("user-principal", "principal@belmopancomp.edu.bz", "principal",
         "Alicia Mendez", "principal", True)
add_user("user-secretary", "secretary@belmopancomp.edu.bz", "secretary",
         "Sofia Castillo", "secretary", True)

# ── teachers ────────────────────────────────────────────────────────────────────────
teacher_ids: dict[int, str] = {}       # index -> teacher_profiles.id
teacher_user: dict[int, str | None] = {}
teacher_active_by_code: dict[str, int] = {}  # code -> first active teacher index
for i, (full_name, specs, status, gender) in enumerate(TEACHER_SEED):
    rng = random.Random(900 + i)
    tid = uid(f"teach-{i + 1}")
    teacher_ids[i] = tid
    spec_names = [SUBJ_NAME[c] for c in specs]
    designation = DESIGNATIONS[i % len(DESIGNATIONS)]
    years = rng.randint(5, 22)
    email = full_name.lower().replace(" ", ".") + "@belmopancomp.edu.bz"
    user_id = None
    if status == "active":
        user_id = add_user(f"user-teach-{i + 1}", email, email.split("@")[0],
                           full_name, "teacher", True)
    teacher_user[i] = user_id
    expertise = [{"area": a, "level": (rng.randint(82, 95) if idx == 0 else rng.randint(60, 85))}
                 for idx, a in enumerate(spec_names)]
    add("teacher_profiles", id=tid, user_id=user_id, staff_number=f"T-{1001 + i}",
        full_name=full_name, email=email, phone=f"+501-6{rng.randint(100000, 999999)}",
        status=status, subject_specializations=json.dumps(spec_names), gender=gender,
        designation=designation, education=f"{DEGREES[designation]} {spec_names[0]}",
        bio=(f"{designation} with {years} years of classroom experience teaching "
             f"{spec_names[0]}. Committed to student-centred learning and measurable outcomes."),
        address=f"{rng.randint(1, 120)} {rng.choice(STREETS)}, Belmopan, Cayo",
        expertise=json.dumps(expertise), avatar_url=None)
    for code in specs:
        teacher_active_by_code.setdefault(code, i) if status == "active" else None


def teacher_for(code: str) -> int:
    """First ACTIVE teacher index whose specializations include this code."""
    for i, (_n, specs, status, _g) in enumerate(TEACHER_SEED):
        if status == "active" and code in specs:
            return i
    raise KeyError(code)


# ── sections (classes) : active + archived mirror ──────────────────────────────────
def section_col(value: str) -> str | None:
    return value if len(value) <= 2 else None  # classes.section is varchar(2)


active_sections: list[str] = []   # demo ids 'sec-1'..'sec-8'
for i, (name, grade, section, cap) in enumerate(SECTION_SEED):
    sec = f"sec-{i + 1}"
    active_sections.append(sec)
    add("classes", id=uid(sec), academic_year_id=uid(YEAR_ACTIVE), name=name,
        grade_level=grade, section=section_col(section), capacity=cap,
        is_archived=False, homeroom_label=f"{name} Homeroom")
hist_sections: list[str] = []     # 'sec-2024-1'..
for i, (name, grade, section, cap) in enumerate(SECTION_SEED):
    sec = f"sec-2024-{i + 1}"
    hist_sections.append(sec)
    add("classes", id=uid(sec), academic_year_id=uid(YEAR_ARCHIVED), name=name,
        grade_level=grade, section=section_col(section), capacity=cap,
        is_archived=True, homeroom_label=f"{name} Homeroom")

# ── class_subjects + class_teachers ────────────────────────────────────────────────
# Course loads, by real BAJC catalog code (D30 Phase 2D).
#
# NOTE: this file's homeroom shape (Form 1A-4B) is PRE-D29 and is a known, separate
# gap — see plan §F. Phase 2D swapped the invented subjects for real courses so it can
# no longer contradict the catalog; reshaping it into D29 subject classes is not part
# of D30. `npm run demo` / the MSW dataset is the D29+D30-shaped demo.
CORE = ["MATH1110", "ENGL1102", "BIOL1102", "HIST2102", "SPAN2112", "THEO2201", "ITEC1104"]
FORM3 = ["MATH1110", "ENGL1102", "BIOL1102", "CHEM1100", "SOCI1212", "SPAN2112", "ITEC1104"]
FORM4_SCI = ["MATH1110", "ENGL1102", "BIOL1102", "CHEM1100", "MATH1210", "ITEC1104"]
FORM4_BUS = ["MATH1110", "ENGL1102", "MGMT1106", "SOCI1212", "ITEC1104", "SPAN2112"]


def subjects_for(name: str, grade: str) -> list[str]:
    if name == "Form 4 Science":
        return FORM4_SCI
    if name == "Form 4 Business":
        return FORM4_BUS
    if grade == "Form 3":
        return FORM3
    return CORE


# active class_subjects
cs_counter = 0
cs_section: dict[str, str] = {}   # cs demo id -> section demo id
for idx, sec in enumerate(active_sections):
    name, grade, _s, _c = SECTION_SEED[idx]
    for code in subjects_for(name, grade):
        cs_counter += 1
        cs = f"cs-{cs_counter}"
        cs_section[cs] = sec
        lead = teacher_for(code)
        add("class_subjects", id=uid(cs), class_id=uid(sec), subject_id=subj_id(code),
            is_active=True)
        # teachers: lead + MATH co-teacher (teach-4) on the first 12 offerings
        team = [lead]
        if code == "MATH1110" and cs_counter <= 12 and lead != 3:
            team.append(3)
        for t in team:
            add("class_teachers", id=uid(f"ct-{cs}-{t}"), class_subject_id=uid(cs),
                teacher_id=teacher_ids[t], is_lead=(t == lead))

# historical class_subjects (is_active=false); Trevor Neal (idx 11) on hist Geography
hist_cs_counter = 0
hist_cs_section: dict[str, str] = {}
first_hist_geo = None
for idx, sec in enumerate(hist_sections):
    name, grade, _s, _c = SECTION_SEED[idx]
    for code in subjects_for(name, grade):
        hist_cs_counter += 1
        cs = f"cs-2024-{hist_cs_counter}"
        hist_cs_section[cs] = sec
        lead = teacher_for(code)
        add("class_subjects", id=uid(cs), class_id=uid(sec), subject_id=subj_id(code),
            is_active=False)
        team = [lead]
        if code == "SOCI1212" and first_hist_geo is None:
            first_hist_geo = cs
            if 11 != lead:
                team.append(11)
        for t in team:
            add("class_teachers", id=uid(f"ct-{cs}-{t}"), class_subject_id=uid(cs),
                teacher_id=teacher_ids[t], is_lead=(t == lead))

# ── students ────────────────────────────────────────────────────────────────────────
rng_stu = random.Random(4242)
student_ids: dict[int, str] = {}
student_section: dict[int, str | None] = {}   # index -> final active section demo id
student_user: dict[int, str | None] = {}
for i in range(45):
    first = FIRST_NAMES[i]
    last = rng_stu.choice(LAST_NAMES)
    sec_idx = i % len(active_sections)
    sec = active_sections[sec_idx]
    name_sec = SECTION_SEED[sec_idx]
    form_num = int(name_sec[1].replace("Form ", ""))
    birth_year = 2013 - (form_num - 1)
    dob = date(birth_year, rng_stu.randint(1, 12), rng_stu.randint(1, 28))
    status = "active"
    if i == 7:
        status = "inactive"
    elif i == 20:
        status = "withdrawn"
    elif i == 33:
        status = "transferred"
    elif i == 41:
        status = "graduated"
    sid = uid(f"stu-{i + 1}")
    student_ids[i] = sid
    user_id = None
    student_number = f"S-{25001 + i}"
    if i < 6:
        user_id = add_user(f"user-stu-{i + 1}",
                           f"{student_number.lower()}@student.belmopancomp.edu.bz",
                           student_number.lower(), f"{first} {last}", "student",
                           status == "active")
    student_user[i] = user_id
    final_section = None if status in ("graduated", "withdrawn") else sec
    if i == 33:  # transferred -> Form 2A (sec-3)
        final_section = active_sections[2]
    student_section[i] = final_section
    # D30 §D10: names are stored split; `full_name` was dropped in 007.
    add("student_profiles", id=sid, user_id=user_id, student_number=student_number,
        firstname=first, middlename=None, lastname=last, date_of_birth=dob,
        gender=("female" if i % 2 == 0 else "male"), enrollment_date=date(2025, 9, 1),
        status=status, guardian_name=f"{rng_stu.choice(FIRST_NAMES)} {last}",
        guardian_phone=f"+501-6{rng_stu.randint(100000, 999999)}",
        guardian_email=f"{last.lower()}.guardian@example.bz",
        address=(f"{rng_stu.randint(1, 99)} "
                 f"{rng_stu.choice(['Cedar', 'Mahogany', 'Bougainvillea', 'Hibiscus'])} "
                 f"Street, Belmopan"),
        phone=f"+501-6{rng_stu.randint(100000, 999999)}")

# ── enrollments (active) ────────────────────────────────────────────────────────────
enr_counter = 0
active_enr: dict[tuple[int, str], str] = {}   # (student idx, section demo id) -> enr id


def add_enrollment(demo_id, stu_idx, section, semester, enrolled, unenrolled):
    add("class_enrollments", id=uid(demo_id), class_id=uid(section),
        student_id=student_ids[stu_idx], semester_id=uid(semester),
        enrolled_at=enrolled, unenrolled_at=unenrolled)


for i in range(45):
    sec = student_section[i]
    if sec is None:
        continue
    enr_counter += 1
    demo_id = f"enr-{enr_counter}"
    add_enrollment(demo_id, i, sec, SEM_ACTIVE, "2025-09-01 08:00:00", None)
    active_enr[(i, sec)] = uid(demo_id)
# transfer student (idx 33): historical unenrolled row on old section (sec-1)
enr_counter += 1
add_enrollment(f"enr-{enr_counter}", 33, active_sections[0], SEM_ACTIVE,
               "2025-09-01 08:00:00", "2025-09-25 08:00:00")

# historical enrollments: every student into hist section at same index
hist_enr: dict[tuple[int, str], str] = {}
for i in range(45):
    sec = hist_sections[i % len(hist_sections)]
    demo_id = f"enr-2024-{i + 1}"
    add_enrollment(demo_id, i, sec, SEM_2024_1, "2024-09-02 08:00:00", None)
    hist_enr[(i, sec)] = uid(demo_id)


def active_roster(section: str) -> list[int]:
    return [i for i in range(45) if student_section[i] == section]


def hist_roster(section: str) -> list[int]:
    return [i for i in range(45) if hist_sections[i % len(hist_sections)] == section]


# ── assessment categories ──────────────────────────────────────────────────────────
for cs in list(cs_section) + list(hist_cs_section):
    add("assessment_categories", id=uid(f"cat-{cs}-q"), class_subject_id=uid(cs),
        name="Quizzes", weight=Decimal("0.40"), drop_lowest_count=1)
    add("assessment_categories", id=uid(f"cat-{cs}-t"), class_subject_id=uid(cs),
        name="Tests", weight=Decimal("0.60"), drop_lowest_count=0)

# ── assessments (active) ────────────────────────────────────────────────────────────
ASMT_TMPL = [
    ("Quiz 1", "quiz", "q", 20, -30, "graded", True),
    ("Quiz 2", "quiz", "q", 20, -16, "graded", True),
    ("Unit Test 1", "test", "t", 50, -9, "graded", False),
    ("Project", "assignment", None, 100, 7, "published", False),
]
asmt_counter = 0
asmt_meta: dict[str, tuple[str, int, str]] = {}   # asmt demo id -> (cs demo id, max, status)
for cs in cs_section:
    for title, typ, cat, mx, off, status, released in ASMT_TMPL:
        asmt_counter += 1
        aid = f"asmt-{asmt_counter}"
        asmt_meta[aid] = (cs, mx, status)
        add("assessments", id=uid(aid), class_subject_id=uid(cs),
            semester_id=uid(SEM_ACTIVE),
            category_id=(uid(f"cat-{cs}-{cat}") if cat else None), title=title,
            type=typ, max_score=Decimal(mx), weight=Decimal("1.00"),
            assessment_date=add_days(DEMO_TODAY, off), status=status,
            is_released=released, released_at=None)

# ── assessments (historical, all graded+released) ──────────────────────────────────
HIST_TMPL = [
    ("Quiz 1", "quiz", "q", 20, -90), ("Quiz 2", "quiz", "q", 20, -60),
    ("Midterm Test", "test", "t", 50, -30), ("Final Project", "assignment", None, 100, -10),
]
hist_asmt_counter = 0
hist_asmt_meta: dict[str, tuple[str, int]] = {}
for cs in hist_cs_section:
    for title, typ, cat, mx, off in HIST_TMPL:
        hist_asmt_counter += 1
        aid = f"asmt-2024-{hist_asmt_counter}"
        hist_asmt_meta[aid] = (cs, mx)
        add("assessments", id=uid(aid), class_subject_id=uid(cs),
            semester_id=uid(SEM_2024_1),
            category_id=(uid(f"cat-{cs}-{cat}") if cat else None), title=title,
            type=typ, max_score=Decimal(mx), weight=Decimal("1.00"),
            assessment_date=add_days(HIST_ANCHOR, off), status="graded",
            is_released=True, released_at=None)

# ── assessment grades ───────────────────────────────────────────────────────────────
rng_grade = random.Random(31337)
grade_counter = 0
for aid, (cs, mx, status) in asmt_meta.items():
    sec = cs_section[cs]
    for i in active_roster(sec):
        enr = active_enr.get((i, sec))
        if not enr:
            continue
        grade_counter += 1
        gstatus, score = "pending", None
        if status == "graded":
            roll = rng_grade.random()
            if roll < 0.06:
                gstatus = "absent"
            elif roll < 0.10:
                gstatus = "excused"
            elif roll < 0.12:
                gstatus = "pending"
            else:
                gstatus = "graded"
                pct = min(1.0, max(0.35, 0.75 + (rng_grade.random() - 0.5) * 0.5))
                score = Decimal(round(pct * mx))
        add("assessment_grades", id=uid(f"grd-{grade_counter}"), assessment_id=uid(aid),
            student_id=student_ids[i], enrollment_id=enr, status=gstatus, score=score,
            makeup_score=None, is_released=None)

rng_hist_grade = random.Random(24680)
hist_grade_counter = 0
for aid, (cs, mx) in hist_asmt_meta.items():
    sec = hist_cs_section[cs]
    for i in hist_roster(sec):
        enr = hist_enr.get((i, sec))
        if not enr:
            continue
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
            assessment_id=uid(aid), student_id=student_ids[i], enrollment_id=enr,
            status=gstatus, score=score, makeup_score=None, is_released=True)

# ── attendance (recorded_by = MATH teacher's user) ─────────────────────────────────
math_user = teacher_user[teacher_for("MATH1110")]


def weekday_window(anchor: date) -> list[date]:
    return [add_days(anchor, d) for d in range(-13, 1) if is_weekday(add_days(anchor, d))]


rng_att = random.Random(55555)
att_counter = 0
for sec in active_sections:
    roster = active_roster(sec)
    for d in weekday_window(DEMO_TODAY):
        for i in roster:
            enr = active_enr.get((i, sec))
            if not enr:
                continue
            att_counter += 1
            roll = rng_att.random()
            st = "present" if roll < 0.9 else "absent" if roll < 0.95 else "late" if roll < 0.98 else "excused"
            add("attendance_records", id=uid(f"att-{att_counter}"), class_id=uid(sec),
                student_id=student_ids[i], enrollment_id=enr, semester_id=uid(SEM_ACTIVE),
                attendance_date=d, status=st, created_by=math_user)

rng_hist_att = random.Random(99999)
hist_att_counter = 0
for sec in hist_sections:
    roster = hist_roster(sec)
    for d in weekday_window(HIST_ANCHOR):
        for i in roster:
            enr = hist_enr.get((i, sec))
            if not enr:
                continue
            hist_att_counter += 1
            roll = rng_hist_att.random()
            st = "present" if roll < 0.9 else "absent" if roll < 0.95 else "late" if roll < 0.98 else "excused"
            add("attendance_records", id=uid(f"att-2024-{hist_att_counter}"),
                class_id=uid(sec), student_id=student_ids[i], enrollment_id=enr,
                semester_id=uid(SEM_2024_1), attendance_date=d, status=st,
                created_by=math_user)

# ── announcements + reads ───────────────────────────────────────────────────────────
def dt(d: date, hhmmss: str) -> str:
    return f"{d.isoformat()} {hhmmss}"


ANN = [
    ("ann-1", "Welcome back to the 2025-2026 school year",
     "Classes resume Monday. Please collect timetables from the front office and review the updated code of conduct posted on the notice board.",
     "all", None, "user-principal", dt(add_days(DEMO_TODAY, -20), "08:00:00"), None,
     ["user-teach-1", "user-stu-1"]),
    ("ann-2", "Staff meeting — Thursday 3:30 PM",
     "All teaching staff should attend the term-planning meeting in the staff room. Department heads, please bring your assessment calendars.",
     "teachers", None, "user-principal", dt(add_days(DEMO_TODAY, -6), "14:00:00"),
     dt(add_days(DEMO_TODAY, 2), "00:00:00"), ["user-teach-1"]),
    ("ann-3", "Midterm exam schedule released",
     "The midterm timetable is now available. Review your subjects and prepare accordingly. Speak to your teachers about any clashes.",
     "students", None, "user-secretary", dt(add_days(DEMO_TODAY, -4), "10:00:00"), None, []),
    ("ann-4", "Form 1A — bring lab coats Friday",
     "For our first Biology practical this Friday, all Form 1A students must bring a lab coat and closed-toe shoes.",
     "class", "sec-1", "user-teach-3", dt(add_days(DEMO_TODAY, -2), "11:30:00"),
     dt(add_days(DEMO_TODAY, 3), "00:00:00"), []),
    ("ann-5", "Sports Day — save the date",
     "Annual Sports Day is scheduled for next month. House captains will be announced shortly. Get your teams ready!",
     "all", None, "user-teach-8", dt(add_days(DEMO_TODAY, -1), "09:00:00"), None, []),
    ("ann-6", "Library closed for stocktake (expired)",
     "The library was closed last week for the annual stocktake. It has since reopened for normal hours.",
     "all", None, "user-secretary", dt(add_days(DEMO_TODAY, -12), "08:00:00"),
     dt(add_days(DEMO_TODAY, -8), "00:00:00"), ["user-teach-1", "user-stu-1"]),
]
for aid, title, body, audience, sec, author, pub, exp, reads in ANN:
    add("announcements", id=uid(aid), author_id=uid(author), title=title, body=body,
        audience=audience, class_id=(uid(sec) if sec else None), published_at=pub,
        expires_at=exp)
    for u in reads:
        add("announcement_reads", announcement_id=uid(aid), user_id=uid(u),
            read_at=pub)

# ── events ────────────────────────────────────────────────────────────────────────
EVENT_CREATED = dt(add_days(DEMO_TODAY, -25), "08:00:00")
EVENTS = [
    ("evt-1", "Staff Development Day", "No classes for students. All teaching staff attend professional-development workshops.", "meeting", "internal", -6, None, True, None, None, "Main Hall", "user-principal"),
    ("evt-2", "Pan American Day", "Public holiday — school closed.", "holiday", "global", -3, None, True, None, None, None, "user-secretary"),
    ("evt-3", "School Photo Day", "Class and individual photographs. Students must be in full uniform.", "activity", "global", 0, None, False, "09:00", "12:00", "Gymnasium", "user-secretary"),
    ("evt-4", "Term Planning — Staff Meeting", "All teaching staff meet to review the mid-term timetable and assessment calendar.", "meeting", "internal", 1, None, False, "17:00", "18:30", "Auditorium", "user-principal"),
    ("evt-5", "Midterm Examinations", "Midterm exams across all forms. Refer to the posted timetable for your subjects.", "exam", "global", 5, 9, True, None, None, None, "user-principal"),
    ("evt-6", "Inter-House Sports Day", "Annual athletics competition between houses. Family and friends welcome to attend.", "activity", "global", 12, None, False, "08:00", "14:00", "Sports Field", "user-secretary"),
    ("evt-7", "First-Term Report Cards Issued", "Report cards for the first term are released to students and guardians.", "other", "global", 16, None, True, None, None, None, "user-secretary"),
    ("evt-8", "Garifuna Settlement Day", "National public holiday — school closed.", "holiday", "global", 35, None, True, None, None, None, "user-principal"),
]
for eid, title, desc, cat, vis, so, eo, allday, st, et, loc, author in EVENTS:
    add("events", id=uid(eid), title=title, description=desc, category=cat,
        visibility=vis, start_date=add_days(DEMO_TODAY, so),
        end_date=(add_days(DEMO_TODAY, eo) if eo is not None else None),
        all_day=allday, start_time=st, end_time=et, location=loc,
        created_by_user_id=uid(author))


# ═══════════════════════════════════════════════════════════════════════════════════
# Emit SQL + load into the live DB
# ═══════════════════════════════════════════════════════════════════════════════════
def build_sql() -> str:
    parts = [
        "-- Full demo dataset for the MariaDB `sims` DB (Belize Adventist Junior College).",
        "-- Generated by backend/db/mariadb/seed_demo.py — re-runnable (clears then inserts).",
        "SET @OLD_FK = @@FOREIGN_KEY_CHECKS; SET FOREIGN_KEY_CHECKS = 0;",
        "SET @OLD_MODE = @@SESSION.sql_mode; SET SESSION sql_mode = '';",
        "",
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
            values = ",\n".join("(" + ", ".join(lit(r[c]) for c in cols) + ")" for r in chunk)
            parts.append(f"INSERT INTO `{t}` ({collist}) VALUES\n{values};")
        parts.append("")
    parts.append("SET SESSION sql_mode = @OLD_MODE; SET FOREIGN_KEY_CHECKS = @OLD_FK;")
    return "\n".join(parts) + "\n"


def _assert_safe_to_seed() -> None:
    """Refuse to run unless this is explicitly a local/demo environment.

    ⚠️ THIS SCRIPT IS THE MOST DESTRUCTIVE THING IN THE REPOSITORY. It `DELETE`s
    every row from 22 tables and then inserts 19 user accounts that all share the
    hardcoded password `SimsDemo2025!` with `must_change_password=False`. Run
    against a live school it destroys the real records AND leaves the replacement
    accounts publicly guessable.

    Nothing stopped that before: the script imported the app's engine and wrote to
    whatever `DATABASE_URL` happened to be configured. On a server where the
    production `.env` sits next to it — the normal layout — one command run in the
    wrong directory was enough.

    Two independent conditions must both hold, so a single mistake is not sufficient:
      1. `ENVIRONMENT` must be `local` (the app's own notion of a dev box), and
      2. `SIS_ALLOW_DEMO_SEED=yes-destroy-my-data` must be exported.

    The second is deliberately awkward. This is not a prompt, because prompts get
    piped `yes` — it has to be typed on purpose.
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
        "REFUSING TO SEED — this script deletes every row in 22 tables and creates "
        "19 accounts sharing a hardcoded password.\n"
        f"  Target database : {target}\n"
        + "".join(f"  Blocked because : {p}\n" for p in problems)
        + "\nIf this really is a throwaway local database:\n"
        '  $env:ENVIRONMENT="local"; $env:SIS_ALLOW_DEMO_SEED="yes-destroy-my-data"\n'
        "and run again. Never do this on a database holding real student records."
    )


def main() -> None:
    _assert_safe_to_seed()

    sql = build_sql()
    SQL_OUT.write_text(sql, encoding="utf-8")
    print(f"Wrote {SQL_OUT} ({len(sql):,} bytes)")

    counts = {t: len(TABLES[t][1]) for t in ORDER if t in TABLES}
    with engine.begin() as conn:
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
        conn.exec_driver_sql("SET SESSION sql_mode = ''")
        for t in reversed(ORDER):
            conn.exec_driver_sql(f"DELETE FROM `{t}`")
        for t in ORDER:
            if t not in TABLES:
                continue
            cols, rows = TABLES[t]
            collist = ", ".join(f"`{c}`" for c in cols)
            for cs in range(0, len(rows), 200):
                chunk = rows[cs:cs + 200]
                values = ",".join("(" + ", ".join(lit(r[c]) for c in cols) + ")" for r in chunk)
                conn.exec_driver_sql(f"INSERT INTO `{t}` ({collist}) VALUES {values}")
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")

    print("Seeded live DB. Row counts:")
    total = 0
    for t, n in counts.items():
        total += n
        print(f"  {t:24} {n}")
    print(f"  {'TOTAL':24} {total}")
    print(f"\nLogin: principal@belmopancomp.edu.bz / {DEMO_PASSWORD}  (any seeded account, same password)")


if __name__ == "__main__":
    main()

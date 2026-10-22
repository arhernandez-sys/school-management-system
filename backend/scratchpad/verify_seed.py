"""Post-seed integrity + D31 invariant probe — D31 Phase 5.

    cd backend
    $env:DATABASE_URL="mysql+pymysql://user:pw@127.0.0.1:3306/sims_d31"   # or rely on .env
    \.venv\Scripts\python.exe scratchpad\verify_seed.py

READ-ONLY. Exit 1 if any check fails, so it works as a gate.

**Run it directly after `seed_demo`.** Three checks assert a PRISTINE seed — `refresh_sessions`
and `login_attempts` empty, and no account exempt from the forced change — so merely logging in
once makes them fail. That is the intended sensitivity, not a flaw: those three are how you find
out that a session or a cleared flag survived a re-seed, which is exactly the leak the sweep
exists to prevent. Re-seed before re-running.

WHY IT EXISTS. `seed_demo.py` inserts with `FOREIGN_KEY_CHECKS = 0` — it has to, because it
clears and refills 22 tables in one pass — which means **the database validates nothing it
writes**. A dangling `offering_id` or a grade pointing at another offering's enrolment inserts
happily and only surfaces later as an empty screen. So the 32 FK columns are re-checked here for
orphans, and then the invariants no constraint can express: that an enrolment's, assessment's and
attendance record's term all equal their offering's term; that a grade's enrolment, student and
assessment agree; that exactly one year and one semester are active; that every student has
exactly one OPEN programme-history row matching `student_profiles.program_id`; that `score` is
non-null IFF `status='graded'` and never above the assessment ceiling; that no meeting falls
outside Mon-Fri; that no offering lacks a lead lecturer or exceeds its capacity; and that the 19
accounts hold 19 DISTINCT password hashes with none of them exempt from the forced change.

It also asserts the two D31 capabilities are actually present in the data — parallel sections in
one term, and one course running in two terms of one year — because a seed that stopped
exercising them would still pass every other check here.
"""
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

def _dsn() -> str:
    """The DSN to probe: argv[1], else `DATABASE_URL`, else the one in `backend/.env`.

    Reading `.env` last rather than first is deliberate — the whole point of the argument is to
    aim this at `sims_d31` without editing the file the app runs on.
    """
    if len(sys.argv) > 1:
        return sys.argv[1]
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = Path(__file__).resolve().parents[1] / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no DSN: pass one as argv[1] or set DATABASE_URL")


e = create_engine(_dsn())
fails = []


def chk(label, sql, expect=0, cmp="eq"):
    with e.connect() as c:
        got = c.execute(text(sql)).scalar()
    ok = (got == expect) if cmp == "eq" else (got >= expect)
    print(f"  {'OK  ' if ok else 'FAIL'} {label:<60} {got}")
    if not ok:
        fails.append(label)


print("== orphan FK check (inserts ran with FK checks OFF) ==")
FKS = [
    ("user_preferences.user_id", "user_preferences", "user_id", "users"),
    ("student_profiles.user_id", "student_profiles", "user_id", "users"),
    ("student_profiles.program_id", "student_profiles", "program_id", "programs"),
    ("teacher_profiles.user_id", "teacher_profiles", "user_id", "users"),
    ("semesters.academic_year_id", "semesters", "academic_year_id", "academic_years"),
    ("grading_scales.academic_year_id", "grading_scales", "academic_year_id", "academic_years"),
    ("grading_scale_bands.grading_scale_id", "grading_scale_bands", "grading_scale_id", "grading_scales"),
    ("course_offerings.course_id", "course_offerings", "course_id", "courses"),
    ("course_offerings.semester_id", "course_offerings", "semester_id", "semesters"),
    ("student_program_history.student_id", "student_program_history", "student_id", "student_profiles"),
    ("student_program_history.program_id", "student_program_history", "program_id", "programs"),
    ("class_teachers.offering_id", "class_teachers", "offering_id", "course_offerings"),
    ("class_teachers.teacher_id", "class_teachers", "teacher_id", "teacher_profiles"),
    ("class_meetings.offering_id", "class_meetings", "offering_id", "course_offerings"),
    ("class_enrollments.offering_id", "class_enrollments", "offering_id", "course_offerings"),
    ("class_enrollments.student_id", "class_enrollments", "student_id", "student_profiles"),
    ("class_enrollments.semester_id", "class_enrollments", "semester_id", "semesters"),
    ("assessment_categories.offering_id", "assessment_categories", "offering_id", "course_offerings"),
    ("assessments.offering_id", "assessments", "offering_id", "course_offerings"),
    ("assessments.semester_id", "assessments", "semester_id", "semesters"),
    ("assessments.category_id", "assessments", "category_id", "assessment_categories"),
    ("assessment_grades.assessment_id", "assessment_grades", "assessment_id", "assessments"),
    ("assessment_grades.student_id", "assessment_grades", "student_id", "student_profiles"),
    ("assessment_grades.enrollment_id", "assessment_grades", "enrollment_id", "class_enrollments"),
    ("attendance_records.offering_id", "attendance_records", "offering_id", "course_offerings"),
    ("attendance_records.enrollment_id", "attendance_records", "enrollment_id", "class_enrollments"),
    ("attendance_records.created_by", "attendance_records", "created_by", "users"),
    ("announcements.author_id", "announcements", "author_id", "users"),
    ("announcements.offering_id", "announcements", "offering_id", "course_offerings"),
    ("announcement_reads.user_id", "announcement_reads", "user_id", "users"),
    ("announcement_reads.announcement_id", "announcement_reads", "announcement_id", "announcements"),
    ("events.created_by_user_id", "events", "created_by_user_id", "users"),
]
for label, tbl, col, ref in FKS:
    chk(
        f"orphans in {label}",
        f"SELECT COUNT(*) FROM `{tbl}` t LEFT JOIN `{ref}` r ON t.`{col}` = r.id "
        f"WHERE t.`{col}` IS NOT NULL AND r.id IS NULL",
    )

print("\n== swept tables really are empty ==")
for t in ("refresh_sessions", "login_attempts", "term_grade_snapshots",
          "report_card_snapshots", "grade_revision_requests", "applications"):
    chk(f"{t} empty", f"SELECT COUNT(*) FROM `{t}`")

print("\n== reference data untouched ==")
chk("courses still seeded", "SELECT COUNT(*) FROM courses", 114, "ge")
chk("programmes still seeded", "SELECT COUNT(*) FROM programs", 8, "ge")
chk("curriculum rows still seeded", "SELECT COUNT(*) FROM program_courses", 243, "ge")
chk("prerequisites still seeded", "SELECT COUNT(*) FROM course_prerequisites", 60, "ge")

print("\n== D31 invariants ==")
chk("enrolment term disagrees with its offering",
    "SELECT COUNT(*) FROM class_enrollments e JOIN course_offerings o ON o.id=e.offering_id "
    "WHERE e.semester_id <> o.semester_id")
chk("assessment term disagrees with its offering",
    "SELECT COUNT(*) FROM assessments a JOIN course_offerings o ON o.id=a.offering_id "
    "WHERE a.semester_id <> o.semester_id")
chk("attendance term disagrees with its offering",
    "SELECT COUNT(*) FROM attendance_records r JOIN course_offerings o ON o.id=r.offering_id "
    "WHERE r.semester_id <> o.semester_id")
chk("category on a different offering than its assessment",
    "SELECT COUNT(*) FROM assessments a JOIN assessment_categories c ON c.id=a.category_id "
    "WHERE c.offering_id <> a.offering_id")
chk("grade enrolment on a different offering than its assessment",
    "SELECT COUNT(*) FROM assessment_grades g JOIN assessments a ON a.id=g.assessment_id "
    "JOIN class_enrollments e ON e.id=g.enrollment_id WHERE e.offering_id <> a.offering_id")
chk("grade student disagrees with its enrolment student",
    "SELECT COUNT(*) FROM assessment_grades g JOIN class_enrollments e ON e.id=g.enrollment_id "
    "WHERE g.student_id <> e.student_id")
chk("PARALLEL SECTIONS of MATH1110 in the active term",
    "SELECT COUNT(*) FROM course_offerings o JOIN courses c ON c.id=o.course_id "
    "JOIN semesters s ON s.id=o.semester_id WHERE c.code='MATH1110' AND s.is_active=1",
    3, "ge")
chk("SAME COURSE TWO TERMS: distinct active-year terms of MATH1110",
    "SELECT COUNT(DISTINCT o.semester_id) FROM course_offerings o "
    "JOIN courses c ON c.id=o.course_id JOIN semesters s ON s.id=o.semester_id "
    "JOIN academic_years y ON y.id=s.academic_year_id "
    "WHERE c.code='MATH1110' AND y.status='active'", 2, "ge")
chk("students holding >1 active offering this term",
    "SELECT COUNT(*) FROM (SELECT e.student_id FROM class_enrollments e "
    "JOIN semesters s ON s.id=e.semester_id WHERE s.is_active=1 AND e.unenrolled_at IS NULL "
    "GROUP BY e.student_id HAVING COUNT(*) > 1) x", 40, "ge")
chk("the mid-term SECTION SWITCH row (closed MATH1110-01)",
    "SELECT COUNT(*) FROM class_enrollments e JOIN course_offerings o ON o.id=e.offering_id "
    "JOIN courses c ON c.id=o.course_id WHERE e.unenrolled_at IS NOT NULL "
    "AND c.code='MATH1110' AND o.section_code='01'", 1)
chk("Freddy and John share BIOL1102-01",
    "SELECT COUNT(DISTINCT e.student_id) FROM class_enrollments e "
    "JOIN course_offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id "
    "JOIN student_profiles sp ON sp.id=e.student_id JOIN semesters s ON s.id=o.semester_id "
    "WHERE c.code='BIOL1102' AND o.section_code='01' AND s.is_active=1 "
    "AND sp.student_number IN ('S-25001','S-25002')", 2)
chk("Freddy and John sit DIFFERENT MATH1110 sections",
    "SELECT COUNT(DISTINCT o.section_code) FROM class_enrollments e "
    "JOIN course_offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id "
    "JOIN student_profiles sp ON sp.id=e.student_id JOIN semesters s ON s.id=o.semester_id "
    "WHERE c.code='MATH1110' AND s.is_active=1 AND e.unenrolled_at IS NULL "
    "AND sp.student_number IN ('S-25001','S-25002')", 2)
chk("announcement audience/target rule violated",
    "SELECT COUNT(*) FROM announcements WHERE (audience='class') <> (offering_id IS NOT NULL)")
chk("students with no OPEN programme-history row",
    "SELECT COUNT(*) FROM student_profiles sp WHERE NOT EXISTS (SELECT 1 FROM "
    "student_program_history h WHERE h.student_id=sp.id AND h.ended_at IS NULL)")
chk("students with MORE THAN ONE open programme-history row",
    "SELECT COUNT(*) FROM (SELECT student_id FROM student_program_history "
    "WHERE ended_at IS NULL GROUP BY student_id HAVING COUNT(*)>1) x")
chk("open history programme disagrees with student_profiles.program_id",
    "SELECT COUNT(*) FROM student_program_history h JOIN student_profiles sp ON sp.id=h.student_id "
    "WHERE h.ended_at IS NULL AND h.program_id <> sp.program_id")
chk("CLOSED programme-history rows (the transfer story)",
    "SELECT COUNT(*) FROM student_program_history WHERE ended_at IS NOT NULL", 1)
chk("students with program_id NULL (was 45 before this seed)",
    "SELECT COUNT(*) FROM student_profiles WHERE program_id IS NULL")
chk("students with enrollment_load NULL (was 45 before)",
    "SELECT COUNT(*) FROM student_profiles WHERE enrollment_load IS NULL")
chk("score set but status<>graded, or graded with no score",
    "SELECT COUNT(*) FROM assessment_grades WHERE (status='graded') <> (score IS NOT NULL)")
chk("score above its assessment max",
    "SELECT COUNT(*) FROM assessment_grades g JOIN assessments a ON a.id=g.assessment_id "
    "WHERE g.score > a.max_score")
chk("graduated/withdrawn students with an ACTIVE current-term enrolment",
    "SELECT COUNT(*) FROM class_enrollments e JOIN student_profiles sp ON sp.id=e.student_id "
    "JOIN semesters s ON s.id=e.semester_id JOIN academic_years y ON y.id=s.academic_year_id "
    "WHERE y.status='active' AND e.unenrolled_at IS NULL "
    "AND sp.status IN ('graduated','withdrawn')")
chk("meetings outside Mon-Fri or with end<=start",
    "SELECT COUNT(*) FROM class_meetings WHERE day_of_week NOT BETWEEN 1 AND 5 "
    "OR end_time <= start_time")
chk("archived-year offerings carrying meetings (deliberately none)",
    "SELECT COUNT(*) FROM class_meetings m JOIN course_offerings o ON o.id=m.offering_id "
    "JOIN semesters s ON s.id=o.semester_id JOIN academic_years y ON y.id=s.academic_year_id "
    "WHERE y.status='archived'")
chk("archived-year offerings NOT flagged is_archived",
    "SELECT COUNT(*) FROM course_offerings o JOIN semesters s ON s.id=o.semester_id "
    "JOIN academic_years y ON y.id=s.academic_year_id "
    "WHERE y.status='archived' AND o.is_archived=0")
chk("active academic years", "SELECT COUNT(*) FROM academic_years WHERE status='active'", 1)
chk("active semesters", "SELECT COUNT(*) FROM semesters WHERE is_active=1", 1)
chk("offerings with no lecturer assigned",
    "SELECT COUNT(*) FROM course_offerings o WHERE NOT EXISTS "
    "(SELECT 1 FROM class_teachers t WHERE t.offering_id=o.id)")
chk("offerings with no LEAD lecturer",
    "SELECT COUNT(*) FROM course_offerings o WHERE NOT EXISTS "
    "(SELECT 1 FROM class_teachers t WHERE t.offering_id=o.id AND t.is_lead=1)")
chk("over-capacity offerings",
    "SELECT COUNT(*) FROM (SELECT o.id FROM course_offerings o JOIN class_enrollments e "
    "ON e.offering_id=o.id AND e.unenrolled_at IS NULL WHERE o.capacity IS NOT NULL "
    "GROUP BY o.id, o.capacity HAVING COUNT(*) > o.capacity) x")
chk("accounts NOT forced to change password",
    "SELECT COUNT(*) FROM users WHERE must_change_password=0")
chk("distinct password hashes (no sharing across 19 accounts)",
    "SELECT COUNT(DISTINCT password_hash) FROM users", 19)
chk("active-year bands carrying a grade_point",
    "SELECT COUNT(*) FROM grading_scale_bands b JOIN grading_scales g ON g.id=b.grading_scale_id "
    "JOIN academic_years y ON y.id=g.academic_year_id "
    "WHERE y.status='active' AND b.grade_point IS NOT NULL", 8)
chk("archived-year scale is frozen",
    "SELECT COUNT(*) FROM grading_scales g JOIN academic_years y ON y.id=g.academic_year_id "
    "WHERE y.status='archived' AND g.is_frozen=1", 1)

print()
if fails:
    print(f"{len(fails)} CHECK(S) FAILED:")
    for f in fails:
        print("   -", f)
    sys.exit(1)
print("ALL CHECKS PASSED")

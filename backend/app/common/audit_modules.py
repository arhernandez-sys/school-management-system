"""Action -> MODULE, and action -> plain-English label (D45 §46, §53).

§46 asks the log to record the **module**, and is explicit that it is a different thing
from the entity type. The distinction is the whole point of the auditor's screen:
`entity_type` names a TABLE (`assessment_grades`, `class_enrollments`), and an auditor
does not ask "what happened to the class_enrollments row" — they ask "what happened in
Registration this term". One is where the data lives; the other is what the institution
was doing.

`ACTION_LABELS` is the second half of the same idea. An auditor should never be shown
`grade.update` or `course_prerequisite.remove`. They should be shown "Grade changed" and
"Prerequisite removed" — the same event named the way the college names it.

⚠️ The module rule is duplicated, once here and once as a `CASE` in
`020_d45_audit_trail.sql`. That is deliberate and is the only sane option: the migration
has to backfill rows that were written before this file existed, and it cannot call
Python. If a new action prefix is added, add it in both places — the fallback below is
"System settings", so a miss is quiet, not fatal.
"""

from __future__ import annotations

#: `entity_type` -> WHAT KIND OF RECORD it was, in the registrar's words.
#:
#: Added when the two audit screens were merged (Sep 2026). The old
#: `GET /settings/audit-log` showed `entity_type` raw — `assessment_grades`,
#: `class_enrollments`, `student_profiles` — and that column was the one piece of
#: information the narrative screen did not carry. It is real information: two rows can
#: read as the same sentence and be about different kinds of record. So it survives the
#: merge, translated, because a table name is not something an auditor should ever be
#: shown (§46, and the client's own "no technical stuff, just academics").
#:
#: ⚠️ An UNMAPPED type falls back to a flat "Record", NOT to a prettified version of
#: itself. Humanising it looked tidier and was wrong: `class_enrollments` came out as
#: "Class enrollments", which is a table name with a capital letter on it. The whole rule
#: of this screen is that an auditor never sees the database, so the fallback fails
#: closed — a new entity type reads as "Record" until somebody adds it here, and a vague
#: label is a far smaller cost than a leaked table name.
RECORD_LABELS: dict[str, str] = {
    "grade": "Grade",
    "assessment_grade": "Grade",
    "grade_revision": "Grade revision request",
    "report_card": "Report card",
    "assessment": "Assessment",
    "assessment_category": "Assessment group",
    "assessment_policy": "Grading policy",
    "attendance": "Attendance register",
    "student": "Student record",
    "student_profile": "Student record",
    "class_enrollment": "Registration",
    "enrollment": "Registration",
    "course": "Course",
    "course_offering": "Class",
    "course_prerequisite": "Course prerequisite",
    "program": "Programme",
    "program_course": "Programme curriculum",
    "program_head": "Head of programme",
    "teacher": "Lecturer record",
    "teacher_profile": "Lecturer record",
    "user": "User account",
    "academic_year": "Academic year",
    "semester": "Session",
    "grading_scale": "Grading scale",
    "event": "Calendar event",
    "announcement": "Announcement",
    "application": "Application",
    # A saved-but-unsubmitted admissions form (D38). It was missing, so every
    # `application.pending.*` row read "Record" — found when those rows turned up as the
    # newest entries in a scratch database and a test that expected "Grade" got "Record".
    "application_temp": "Pending application",
    "credit_transfer": "Credit transfer",
    "classroom": "Classroom",
    "school": "College settings",
    "school_profile": "College settings",
}


def record_label_for(entity_type: str | None) -> str | None:
    """The registrar's word for a record type. `None` only for a row without one.

    See the warning on `RECORD_LABELS`: an unmapped type is "Record", never itself.
    """
    if not entity_type:
        return None
    return RECORD_LABELS.get(entity_type, "Record")


#: Ordered longest-prefix-first; the first match wins.
_MODULE_RULES: tuple[tuple[str, str], ...] = (
    ("grade_revision.", "Grades"),
    ("report_card.", "Grades"),
    ("grade.", "Grades"),
    ("assessment_policy.", "Assessments"),
    ("assessment.", "Assessments"),
    ("category.", "Assessments"),
    ("attendance.", "Attendance"),
    ("credit_transfer.", "Admissions"),
    ("application.", "Admissions"),
    ("student.", "Students"),
    ("enrollment.", "Registration"),
    ("course_prerequisite.", "Courses"),
    ("course.", "Courses"),
    ("program.", "Programmes"),
    ("teacher.", "Staff"),
    ("user.", "Users and access"),
    ("academic_year.", "Academic calendar"),
    ("semester.", "Academic calendar"),
    ("event.", "Academic calendar"),
    ("grading_scale.", "Academic calendar"),
    ("announcement.", "Announcements"),
    ("school.", "System settings"),
)

#: Three `offering.*` actions are REGISTRATION, not course administration. Scheduling an
#: offering and seating a student in it are different institutional acts with different
#: auditors, and grouping them by table prefix would bury every enrolment in among the
#: timetable edits.
_REGISTRATION_OFFERING_ACTIONS = frozenset(
    {"offering.enroll", "offering.unenroll", "offering.enrollment_status"}
)

MODULES: tuple[str, ...] = (
    "Admissions",
    "Students",
    "Registration",
    "Grades",
    "Assessments",
    "Attendance",
    "Courses",
    "Programmes",
    "Course offerings",
    "Academic calendar",
    "Staff",
    "Users and access",
    "Announcements",
    "System settings",
)


def module_for(action: str) -> str:
    """The functional area an action belongs to. Never raises; defaults sensibly."""
    if action in _REGISTRATION_OFFERING_ACTIONS:
        return "Registration"
    if action.startswith("offering."):
        return "Course offerings"
    for prefix, module in _MODULE_RULES:
        if action.startswith(prefix):
            return module
    return "System settings"


#: What the college calls the event. Anything absent falls back to a de-jargonised form
#: of the action itself (see `label_for`), so a new action is readable before anyone
#: remembers to add it here.
ACTION_LABELS: dict[str, str] = {
    # ── Grades ────────────────────────────────────────────────────────────────
    "grade.update": "Grade changed",
    "grade.release": "Results released to students",
    "grade_revision.request": "Grade revision requested",
    "grade_revision.withdraw": "Grade revision withdrawn",
    "report_card.freeze_midterm": "Mid-session report cards captured",
    # ── Assessments ───────────────────────────────────────────────────────────
    "assessment.create": "Assessment created",
    "assessment.update": "Assessment changed",
    "assessment.delete": "Assessment removed",
    "assessment.status_change": "Assessment status changed",
    "assessment_policy.update": "Grading policy changed",
    "category.create": "Assessment category created",
    "category.update": "Assessment category changed",
    "category.delete": "Assessment category removed",
    # ── Attendance ────────────────────────────────────────────────────────────
    "attendance.upsert": "Attendance recorded",
    # ── Admissions ────────────────────────────────────────────────────────────
    "application.create": "Application started",
    "application.update": "Application changed",
    "application.submit": "Application submitted",
    "application.review": "Application moved to review",
    "application.eligible": "Applicant found eligible",
    "application.accept": "Applicant accepted",
    "application.reject": "Application rejected",
    "application.defer": "Application deferred",
    "application.withdraw": "Application withdrawn",
    "application.enrolled": "Applicant enrolled as a student",
    "application.request_documents": "Documents requested from applicant",
    "application.documents.replace": "Applicant documents updated",
    "application.education.replace": "Applicant education history updated",
    "application.delete": "Application removed",
    "application.pending.create": "Draft application started",
    "application.pending.update": "Draft application changed",
    "application.pending.submit": "Draft application submitted",
    "application.pending.delete": "Draft application discarded",
    "credit_transfer.create": "Credit transfer requested",
    "credit_transfer.update": "Credit transfer decision changed",
    "credit_transfer.delete": "Credit transfer request removed",
    # ── Students ──────────────────────────────────────────────────────────────
    "student.create": "Student record created",
    "student.update": "Student record changed",
    "student.delete": "Student record removed",
    "student.status_change": "Student status changed",
    "student.program_change": "Student programme changed",
    # ── Registration ──────────────────────────────────────────────────────────
    "offering.enroll": "Student registered in a course",
    "offering.unenroll": "Student removed from a course",
    "offering.enrollment_status": "Registration status changed",
    "enrollment.override": "Registration restriction overridden",
    # ── Courses, programmes, offerings ────────────────────────────────────────
    "course.create": "Course created",
    "course.update": "Course changed",
    "course.delete": "Course removed",
    "course_prerequisite.add": "Prerequisite added",
    "course_prerequisite.remove": "Prerequisite removed",
    "program.create": "Programme created",
    "program.update": "Programme changed",
    "program.delete": "Programme removed",
    "program.course_add": "Course added to a programme",
    "program.course_update": "Programme course changed",
    "program.course_remove": "Course removed from a programme",
    "program.heads.set": "Head of programme assigned",
    "offering.create": "Course offering scheduled",
    "offering.update": "Course offering changed",
    "offering.delete": "Course offering removed",
    "offering.assign_teachers": "Lecturer assigned",
    "offering.replace_meetings": "Class times changed",
    # ── Calendar ──────────────────────────────────────────────────────────────
    "academic_year.create": "Academic year created",
    "academic_year.archive": "Academic year archived",
    "semester.create": "Session created",
    "semester.update": "Session changed",
    "semester.activate": "Session made current",
    "grading_scale.update": "Grading scale changed",
    "event.create": "Calendar event created",
    "event.update": "Calendar event changed",
    "event.delete": "Calendar event removed",
    # ── Staff, users, the rest ────────────────────────────────────────────────
    "teacher.create": "Lecturer record created",
    "teacher.update": "Lecturer record changed",
    "teacher.delete": "Lecturer record removed",
    "teacher.status_change": "Lecturer status changed",
    "user.create": "Account created",
    "user.update": "Account changed",
    "user.role_change": "Account role changed",
    "user.reset_password": "Password reset",
    "announcement.create": "Announcement posted",
    "announcement.update": "Announcement changed",
    "announcement.delete": "Announcement removed",
    "school.update": "School details changed",
    "school.logo_upload_stubbed": "School logo upload attempted",
}


def label_for(action: str) -> str:
    """What the college calls this event.

    The fallback turns `some_thing.did_it` into "Some thing did it" rather than showing
    the raw action, because the auditor's screen must never print an identifier — an
    action nobody has labelled yet is still not a reason to show them a dotted key.
    """
    known = ACTION_LABELS.get(action)
    if known:
        return known
    words = action.replace(".", " ").replace("_", " ").strip()
    return words[:1].upper() + words[1:] if words else "Action recorded"

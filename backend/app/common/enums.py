"""Shared enums (api-specification.md §4.5 / database-schema.md §1.5).

These are str-valued Python enums whose VALUES are the exact lowercase wire labels
AND the exact Postgres native enum labels. `PG_ENUM_NAMES` maps each enum to its
Postgres native type name (schema §1.5), used by the SQLAlchemy column + the
migration's explicit `create_type`.

Letter grades are intentionally NOT an enum — they derive on read from the
configurable grading_scale_bands (D11) and travel the wire as plain strings.
"""

from __future__ import annotations

import enum


class Role(str, enum.Enum):
    PRINCIPAL = "principal"
    SECRETARY = "secretary"
    TEACHER = "teacher"
    STUDENT = "student"


class StudentStatus(str, enum.Enum):
    """Student lifecycle, in the CLIENT'S vocabulary (D34).

    Adopted verbatim from the client's own `student_profiles` dump, including its comment
    on what each state means:

      REGISTERED    "instead of active" - enrolled and attending.
      UNREGISTERED  "when student do not continue further semesters, but has successfully
                    completed the last semester". NOT a failure state, which is why
                    "inactive" was the wrong word for it.
      DROPOUT       left mid-programme. Pairs with `dropout_date` / `dropout_reason`.
      GRADUATED     "Dean/Registrar are the only ones with access to change to this
                    status" - already true, since POST /students/{id}/status is
                    require_role(PRINCIPAL, SECRETARY).
      TRANSFERRED / WITHDRAWN  unchanged.

    **The mixed case is deliberate.** Three values are TitleCase and three are lowercase
    because that is exactly how the client's enum reads, and their dump is the authority
    for this column - normalising it would put the database out of step with their own
    tooling for a cosmetic gain. MariaDB's `utf8mb4_uca1400_ai_ci` is case-insensitive, so
    comparison is unaffected; the case matters only for what is stored and echoed.

    The MEMBER names track the values (`REGISTERED`, not `ACTIVE`) so a reader of
    `StudentStatus.REGISTERED` sees the word the registry actually uses. That rename is
    why D34 touches ~20 call sites it otherwise would not have.
    """

    REGISTERED = "Registered"
    UNREGISTERED = "Unregistered"
    DROPOUT = "DropOut"
    TRANSFERRED = "transferred"
    GRADUATED = "graduated"
    WITHDRAWN = "withdrawn"


class TeacherStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class AcademicYearStatus(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class TermType(str, enum.Enum):
    """The KIND of calendar term (D30 §D3, `semesters.term_type`).

    BAJC does not run two symmetrical semesters a year: its programme sequences move
    through Summer and Spring blocks as well as numbered semesters. Before D30,
    `semesters.sequence` carried `CHECK (sequence IN (1,2))` and the school could not
    record more than two terms in a year at all.

    This is the CALENDAR term's kind. A course's position in a programme PLAN is a
    different fact and lives on `program_courses.term_label` — "Semester 1" there means
    "the first semester of this plan", not any particular dated term (§D3).
    """

    SUMMER = "summer"
    SEMESTER = "semester"
    SPRING = "spring"


class CourseComponent(str, enum.Enum):
    """BAJC's classification of a catalog course (D30 §D2, plan §A1).

    Upper-case values because that is how they are written on the programme course
    sequences and on `courses.component enum('GEC','SEC','CEC')` — the one place in
    this file where the wire value is not lower-case, and it is the source documents
    that decide that, not a style preference.
    """

    GEC = "GEC"  # General Education Core
    SEC = "SEC"  # Supporting Education Core
    CEC = "CEC"  # Concentration Education Core


class PrerequisiteType(str, enum.Enum):
    """What kind of requirement a `course_prerequisites` row expresses (D30 §D4).

    `ALL_PROGRAM_COURSES` exists for one real case in the source material, and it is
    not an edge case — it is `EDUC3201` (Internship), whose prerequisite is written
    on the Primary Education sequence as literally **"ALL COURSES"**. A list of
    course ids cannot say that: the gate has to keep meaning "everything in the
    programme" as the programme's curriculum changes.
    """

    COURSE = "course"
    ALL_PROGRAM_COURSES = "all_program_courses"


class EnrollmentStatus(str, enum.Enum):
    """How a student is sitting one course offering (D30 §D2 step 4).

    `sims_bk.sql` carried this as `courses.coursestatus` — an ENROLMENT fact parked
    on the CATALOG, where it would have applied to every student taking the course at
    once. `005_tertiary.sql` §8 moved it to `class_enrollments` and added `enrolled`,
    which the original enum lacked entirely despite being the normal case.
    """

    ENROLLED = "enrolled"
    AUDIT = "audit"
    WITHDRAW_PASSING = "withdraw_passing"
    WITHDRAW_FAILING = "withdraw_failing"


class AssessmentType(str, enum.Enum):
    QUIZ = "quiz"
    TEST = "test"
    EXAM = "exam"
    ASSIGNMENT = "assignment"


class AssessmentStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    GRADING = "grading"
    GRADED = "graded"


class GradeStatus(str, enum.Enum):
    PENDING = "pending"
    GRADED = "graded"
    ABSENT = "absent"
    EXCUSED = "excused"
    EXEMPT = "exempt"


class AttendanceStatus(str, enum.Enum):
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    EXCUSED = "excused"


class AnnouncementAudience(str, enum.Enum):
    ALL = "all"
    STUDENTS = "students"
    TEACHERS = "teachers"
    CLASS = "class"


class DayOfWeek(int, enum.Enum):
    """ISO weekday of a class meeting (D29 timetable).

    Deliberately NOT in `PG_ENUM_NAMES`: this one is stored as a plain SmallInteger
    rather than a native enum so `ORDER BY day_of_week, start_time` yields Mon→Fri
    order for the timetable grid (a native enum would sort by label text). The DB
    CHECK is `BETWEEN 1 AND 5` — sixth-form timetables are weekday-only, so there is
    no SATURDAY/SUNDAY member; ISO numbering leaves room to relax that later without
    renumbering the weekdays.
    """

    MONDAY = 1
    TUESDAY = 2
    WEDNESDAY = 3
    THURSDAY = 4
    FRIDAY = 5


# ── Admissions (D30 §D11, Phase 4; DDL in `005_tertiary.sql` §11–§14) ──────────
class ApplicationStatus(str, enum.Enum):
    """Where an admission application has got to (`applications.status`).

    This is NOT `student_profiles.status`, and conflating the two is the mistake the
    audit found in `sims_bk.sql`: that dump had no applicant entity at all, so the
    official-use block of the paper form had nowhere to go and the student lifecycle
    enum was being asked to double as an admission decision (plan §B4).

    `DRAFT` is a real state, not a convenience. The Registrar transcribes a paper form
    section by section, so a half-entered application has to survive being interrupted
    — and only a `SUBMITTED` one is a decision waiting to be made.

    `WITHDRAWN` is the applicant pulling out, as distinct from `DENIED`, the college
    saying no. Both are terminal and neither is a delete: an admissions record is kept.
    """

    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    ACCEPTED = "accepted"
    DENIED = "denied"
    WITHDRAWN = "withdrawn"


class District(str, enum.Enum):
    """Belize's six districts (`applications.district`, `student_profiles.district`).

    Title case because that is how they are written on the application form and in the
    column — the same reasoning as `CourseComponent`: the source document decides the
    wire value, not a style preference.
    """

    COROZAL = "Corozal"
    ORANGE_WALK = "Orange Walk"
    BELIZE = "Belize"
    CAYO = "Cayo"
    STANN_CREEK = "Stann Creek"
    TOLEDO = "Toledo"


class YearOfStudy(str, enum.Enum):
    """First or Second year (`applications.year_of_study`).

    **Half of a field the source dump conflated.** `sims_bk.sql` carried
    `yearofstudy enum('Summer','First','Second','Part Time','Full Time','Transient')`,
    which mixed the applicant's YEAR with their study LOAD — two independent questions
    that Section E of the form asks separately, and which a single column cannot answer
    both of. `005` §9 split them; this is the year half and `EnrollmentLoad` is the
    other.
    """

    FIRST = "First"
    SECOND = "Second"


class EnrollmentLoad(str, enum.Enum):
    """Study load (`applications.enrollment_load`) — the other half of the split above.

    The form defines the first two by credits: Part Time is under 15 credits a term,
    Full Time is over 15. `TRANSIENT` is a visiting student taking courses without
    reading for a BAJC award. The thresholds are NOT enforced here — a load is what the
    applicant declares at admission, while their actual credits are a consequence of
    enrolment that changes term by term.
    """

    PART_TIME = "Part Time"
    FULL_TIME = "Full Time"
    TRANSIENT = "Transient"
    #: D34 — from the client's `yearofstudy` enum, which conflated the year with the load.
    #: 'Summer' names a TERM rather than a load, but it answers the same question this
    #: column does ("how is this student attending") and it goes here rather than on
    #: `YearOfStudy` because a summer student still has a first or second year — putting it
    #: there would make that unanswerable, which is the exact defect the D30 split fixed.
    SUMMER = "Summer"


class EducationLevel(str, enum.Enum):
    """The level of a prior institution (`application_education.education_level`).

    Section B of the form offers exactly these two. The distinction is load-bearing for
    credit transfer: policy allows transfer only from a recognised TERTIARY institution
    (brief §13), so a high-school row can never support one.
    """

    HIGH_SCHOOL = "High School"
    TERTIARY = "Tertiary"


class ApplicationDocumentType(str, enum.Enum):
    """The admission document checklist (`application_documents.document_type`).

    The first five are Section F of the form verbatim. The last three exist for credit
    transfer, whose policy requires a CTA, an original transcript and course outlines
    (brief §13) — `credit_transfer_requests` FKs its three document columns here.

    There is deliberately no file upload behind these rows: object storage is not
    provisioned in this repo (TODO(OQ-DB5), the same reason the school-logo upload is
    still a stub), and Section F on paper IS a tick-list. `received` is the field that
    matters; `file_name` / `content_type` / `size_bytes` are metadata for when storage
    lands, and adding real bytes later is additive.
    """

    PASSPORT_PHOTO = "passport_photo"
    HS_DIPLOMA = "hs_diploma"
    RECOMMENDATION_FORM = "recommendation_form"
    SOCIAL_SECURITY_CARD = "social_security_card"
    COURSE_OUTLINE = "course_outline"
    TRANSCRIPT = "transcript"
    CTA = "cta"
    OTHER = "other"


class GradeRevisionStatus(str, enum.Enum):
    """A grade-revision request's decision state (D30 §D7, brief §20).

    **The workflow, not the score.** `assessment_grades.makeup_score` plus the
    `allow_makeup` policy chain already carried the second-attempt SCORE before D30; what
    was missing was the request, the reason, the approval and the history (plan §B2). This
    enum is the approval half.

    A `PENDING` row is what makes the Dean's queue a filtered read rather than a new
    notifications table (§D8), and `grade_revision_requests.pending_flag` — generated as
    `IF(status = 'pending', 1, NULL)` under a unique index — is what limits a grade to ONE
    open request at a time.

    There is no `withdrawn`: a Lecturer who changes their mind deletes the pending request,
    because an un-ruled request carries no decision worth keeping. A DECIDED one is never
    deleted and never re-opened — the ruling is the record.
    """

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


class CreditTransferStatus(str, enum.Enum):
    """A credit-transfer request's decision state (`credit_transfer_requests.status`).

    **The Dean decides** (brief §13, plan §D14), and approval is the only transition the
    database itself polices: `ck_cta_approval_requires_75` refuses an `approved` row
    whose `content_equivalency_pct` is null or below 75. The floor is checked on
    APPROVAL rather than on creation on purpose — a request may legitimately be filed
    before anyone has assessed the equivalency.
    """

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


class ReportCardKind(str, enum.Enum):
    """Which report card a `report_card_snapshots` row holds (D32, brief §5).

    **The two are produced by different mechanisms, not just at different times**, and
    that is why they need distinguishing rather than a date range:

      * `MIDTERM` is a FROZEN document. It is captured once when the term's mid-term
        window closes and is served back verbatim thereafter — the client's requirement
        that a mid-term report must not recalculate from current grades.
      * `ENDTERM` is COMPUTED ON READ while the year is live, and only becomes a frozen
        row when the year archives. Its figures are supposed to keep moving until then.

    A term therefore holds at most one of each per student, which is what
    `uq_report_card_snapshot (student_id, semester_id, kind)` enforces.
    """

    MIDTERM = "midterm"
    ENDTERM = "endterm"


# Maps each Python enum to its Postgres native enum type name (schema §1.5).
# The migration creates these types explicitly (create_type) before any table
# uses them; the model columns reference the same names with create_type=False.
PG_ENUM_NAMES: dict[type[enum.Enum], str] = {
    Role: "user_role",
    StudentStatus: "student_status",
    TeacherStatus: "teacher_status",
    AcademicYearStatus: "academic_year_status",
    AssessmentType: "assessment_type",
    AssessmentStatus: "assessment_status",
    GradeStatus: "grade_status",
    AttendanceStatus: "attendance_status",
    AnnouncementAudience: "announcement_audience",
}

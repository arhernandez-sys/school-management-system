"""Dashboard schemas (api-spec §5 Module 2, FR-DASH-*).

ONE composite endpoint returns a **role-discriminated** payload: the same
`DashboardPage` component renders whichever variant arrives, narrowing on `role`.
Shapes mirror `frontend/src/features/dashboard/types.ts` exactly — that file marks
several principal fields optional, but we populate all of them, and a superset of a
`?` field is safe.

Wire is snake_case. These are read-only projections, so there are no write models.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.common.enums import AnnouncementAudience, AssessmentStatus
from app.common.schemas import OfferingRef


class DashboardAnnouncement(BaseModel):
    """Feed teaser. Note this carries the FULL `body`, unlike the announcements
    module's `body_preview` — the dashboard card renders the whole notice."""

    id: UUID
    title: str
    body: str
    #: Typed as the enum so Pydantic accepts either an ORM enum or a raw string and
    #: serializes the lowercase wire value either way (the frontend type is `string`).
    audience: AnnouncementAudience
    published_at: datetime
    is_read: bool = False


class EnrollmentByProgrammeItem(BaseModel):
    """One programme and how many students are on it (D31).

    Replaces `EnrollmentByGradeItem`, which grouped by `classes.grade_level` — the
    homeroom's Form level ("Form 1".."Form 4"). A junior college has no Forms; the
    equivalent question is "how many students on each Associate degree?".

    `programme_code` is the short BAJC code the Dean recognises (BMAD); `programme_name`
    is the full title. Students with no programme are reported under a single
    `programme_id = None` row rather than dropped, so the tile cannot quietly under-count
    the roll.
    """

    programme_id: UUID | None = None
    programme_code: str | None = None
    programme_name: str
    count: int


class GradeDistributionItem(BaseModel):
    letter: str
    count: int


class EnrollmentTrendItem(BaseModel):
    period: str
    count: int


class PersonStatus(BaseModel):
    label: str
    kind: str


class DashboardPerson(BaseModel):
    """Compact row for the principal's Teachers / Students cards."""

    id: UUID
    name: str
    secondary: str | None = None
    status: PersonStatus | None = None


class _Base(BaseModel):
    user_full_name: str
    academic_year_name: str | None = None
    semester_name: str | None = None


# ── Principal ──────────────────────────────────────────────────────────────────
class AdminStats(BaseModel):
    active_students: int = 0
    active_teachers: int = 0
    total_sections: int = 0
    attendance_rate: float = 0.0
    unread_announcements: int = 0
    new_students_term: int = 0
    total_courses: int = 0
    student_capacity: int = 0


class AdminDashboard(_Base):
    role: Literal["principal"] = "principal"
    stats: AdminStats
    enrollment_by_programme: list[EnrollmentByProgrammeItem] = Field(default_factory=list)
    grade_distribution: list[GradeDistributionItem] = Field(default_factory=list)
    enrollment_trend: list[EnrollmentTrendItem] = Field(default_factory=list)
    recent_teachers: list[DashboardPerson] = Field(default_factory=list)
    recent_students: list[DashboardPerson] = Field(default_factory=list)
    recent_announcements: list[DashboardAnnouncement] = Field(default_factory=list)


# ── Secretary ──────────────────────────────────────────────────────────────────
class SecretaryStats(BaseModel):
    active_students: int = 0
    active_teachers: int = 0
    total_sections: int = 0
    #: Active offerings with no teacher assigned — a setup task for the clerk.
    unstaffed_subjects: int = 0
    #: Sections whose roster exceeds capacity (warn-only, D-Q6).
    over_capacity_sections: int = 0
    unread_announcements: int = 0


class SecretaryEnrollmentItem(BaseModel):
    enrollment_id: UUID
    student_name: str
    #: The offering's derived label, e.g. "MATH1110-01" (D31; was `section_name`, a
    #: homeroom's stored name).
    offering_label: str
    enrolled_at: datetime


class SecretaryDashboard(_Base):
    role: Literal["secretary"] = "secretary"
    stats: SecretaryStats
    recent_enrollments: list[SecretaryEnrollmentItem] = Field(default_factory=list)
    recent_announcements: list[DashboardAnnouncement] = Field(default_factory=list)


# ── Teacher ────────────────────────────────────────────────────────────────────
class TeacherStats(BaseModel):
    #: How many offerings this lecturer teaches. D31 collapsed `my_sections` and
    #: `my_class_subjects` into one figure: they counted homerooms and the subjects
    #: taught within them, and with one course per offering they are now the same
    #: number. Two tiles showing the same value would imply a distinction that the
    #: tertiary model does not have.
    my_offerings: int = 0
    attendance_due_today: int = 0
    #: Assessments still being MARKED — lifecycle status `published` or `grading`.
    #: The teacher's remaining marking workload.
    ungraded_items: int = 0
    #: Assessments already MARKED but still HIDDEN from students — at least one
    #: grade row is `graded` while its effective release flag is false.
    #:
    #: Deliberately NOT the same figure as `ungraded_items`, and the two never
    #: overlap in meaning: `ungraded_items` is work the teacher has yet to do,
    #: this is work the teacher has finished but not yet published. An assessment
    #: can appear in both (partially marked, nothing released) — that is correct,
    #: it has two outstanding actions. See `assessments/release_nudge.py`.
    awaiting_release_items: int = 0


class TeacherTodayOffering(BaseModel):
    offering: OfferingRef
    attendance_recorded: bool = False


class TeacherAssessmentItem(BaseModel):
    id: UUID
    title: str
    offering: OfferingRef | None = None
    assessment_date: date | None = None
    #: Enum-typed for the same reason as `DashboardAnnouncement.audience`.
    status: AssessmentStatus


class TeacherAwaitingReleaseItem(TeacherAssessmentItem):
    """An assessment holding marked-but-hidden work — the awaiting-release tile's rows.

    Extends `TeacherAssessmentItem` (same id/title/offering/date/status) and
    adds the two things the row needs to be ACTIONABLE rather than merely informative:

    * `offering_id` — the gradebook is addressed by offering, not by assessment
      (`/grades?offering_id=…`), and the base item deliberately does not carry
      one. Without it the tile could only link to the gradebook picker.
    * `graded_unreleased_count` — how many students are still waiting, so the teacher
      can tell a whole unreleased column from one straggler left hidden by an earlier
      per-student unrelease.

    `status` here is inherited and remains the ASSESSMENT lifecycle status, not a
    grade status.
    """

    offering_id: UUID
    graded_unreleased_count: int = 0


class TeacherDashboard(_Base):
    role: Literal["teacher"] = "teacher"
    stats: TeacherStats
    today_classes: list[TeacherTodayOffering] = Field(default_factory=list)
    recent_assessments: list[TeacherAssessmentItem] = Field(default_factory=list)
    #: Standing "what have I marked but not published?" queue. Capped like the other
    #: cards; `stats.awaiting_release_items` counts the full set.
    awaiting_release: list[TeacherAwaitingReleaseItem] = Field(default_factory=list)
    recent_announcements: list[DashboardAnnouncement] = Field(default_factory=list)


# ── Student ────────────────────────────────────────────────────────────────────
class StudentStats(BaseModel):
    term_average: float | None = None
    term_letter: str | None = None
    #: Credit-weighted term GPA on the 4.00 scale (D30 §D5), computed by the single
    #: `calc.compute_gpa`. It sits BESIDE `term_average` rather than replacing it: the
    #: average is a 0-100 percentage and answers "how am I scoring?", the GPA is what
    #: the college and the report card actually report.
    #:
    #: Like `term_average` this is the RELEASED view — an unreleased course contributes
    #: 0 quality points and keeps its credits, so the figure can never be used to back
    #: out a mark the student is not meant to see yet.
    gpa: float | None = None
    total_credits: int = 0
    attendance_rate: float = 0.0
    upcoming_count: int = 0


class StudentOfferingItem(BaseModel):
    offering: OfferingRef
    teacher_name: str = "Unassigned"


class StudentGradeItem(BaseModel):
    assessment_id: UUID
    title: str
    offering: OfferingRef | None = None
    score: float
    max_score: float
    letter: str = ""


class StudentUpcomingItem(BaseModel):
    id: UUID
    title: str
    offering: OfferingRef | None = None
    assessment_date: date | None = None


class StudentDashboard(_Base):
    role: Literal["student"] = "student"
    stats: StudentStats
    my_classes: list[StudentOfferingItem] = Field(default_factory=list)
    recent_grades: list[StudentGradeItem] = Field(default_factory=list)
    upcoming_assessments: list[StudentUpcomingItem] = Field(default_factory=list)
    #: NOTE the key is `announcements` here, not `recent_announcements` as on every
    #: other variant. That asymmetry is in the frontend type; do not "fix" it.
    announcements: list[DashboardAnnouncement] = Field(default_factory=list)


DashboardResponse = (
    AdminDashboard | SecretaryDashboard | TeacherDashboard | StudentDashboard
)

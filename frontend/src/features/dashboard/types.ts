/**
 * Dashboard module types.
 *
 * The wire contract for the composite `GET /api/v1/dashboard` endpoint (api-spec
 * Module 2). One request returns a role-discriminated payload — the SAME DashboardPage
 * renders whichever variant the server sends, keyed on `role`. Fields are snake_case to
 * match the wire format; the MSW handler in handlers/dashboard.ts shapes these from the
 * demo dataset selectors so every figure reconciles with the list/detail screens.
 *
 * Hand-authored, and it has to be: `GET /dashboard` is a role-discriminated `oneOf` with a
 * hand-written schema whose models live in internal `$defs`, so orval cannot generate it
 * (see the note in `orval.config.ts`). These types are the contract; `backend/app/modules/
 * dashboard/schemas.py` is the authority behind them.
 *
 * **D31 changed three things across every variant.**
 *
 *  1. **`OfferingRef` replaces the flat name pairs.** Rows carried `subject_name` +
 *     `section_name` — two strings describing one row, assembled by the server for these
 *     cards alone. They are one `offering` now, carrying the derived `label`.
 *  2. **The Dean's enrolment chart buckets by PROGRAMME**, not by Form.
 *     `enrollment_by_grade` grouped on `classes.grade_level` (`Form 1`..`Form 4`) — a
 *     homeroom column and a K-12 axis a junior college does not have.
 *  3. **The Lecturer's two "how many" stats became one.** `my_sections` (distinct
 *     homerooms) and `my_class_subjects` (offerings) were the same number the moment a
 *     class taught one subject, so the card showed one figure twice under two names.
 */
import type { OfferingRef } from '@shared/types/api';
import type { Role } from '@shared/types/enums';
import type { StatusKind } from '@shared/components/StatusBadge';

export type { OfferingRef };

// ── Shared fragments ────────────────────────────────────────────────────────────
export interface DashboardAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  published_at: string;
  is_read: boolean;
}

/** One bar of the Dean's enrolment chart — a PROGRAMME, not a Form (D31). */
export interface EnrollmentByProgrammeItem {
  programme_id: string;
  programme_code: string;
  programme_name: string;
  count: number;
}

export interface GradeDistributionItem {
  letter: string;
  count: number;
}

/** A point in the enrollment-over-time series (Dean analytics, line chart). */
export interface EnrollmentTrendItem {
  /** Human label for the x-axis (e.g. a term like "S1 2025–26"). */
  period: string;
  count: number;
}

/**
 * A compact person row for the Dean's Lecturers / Students list cards. Kept
 * self-contained (name + a little meta + a status) so it never couples to the full
 * students/teachers list endpoints.
 */
export interface DashboardPerson {
  id: string;
  name: string;
  /** Secondary meta line (e.g. course specializations, or the student's year of study). */
  secondary?: string;
  status?: { label: string; kind: StatusKind };
}

/** Common header fields present on every role's payload. */
interface DashboardBase {
  user_full_name: string;
  academic_year_name: string | null;
  semester_name: string | null;
}

// ── Dean / principal (school-wide analytics) ─────────────────────────────────────
export interface AdminDashboard extends DashboardBase {
  role: 'principal';
  stats: {
    active_students: number;
    active_teachers: number;
    total_sections: number;
    attendance_rate: number;
    unread_announcements: number;
    /** New intake for the current term (first-year cohort). Optional: backend may omit. */
    new_students_term?: number;
    /** Total live course offerings. Optional. */
    total_courses?: number;
    /**
     * Sum of offering capacities — the denominator for the "seats filled" progress bar.
     * An offering with a NULL capacity contributes nothing, so the bar describes only the
     * offerings that actually declare a limit.
     */
    student_capacity?: number;
  };
  enrollment_by_programme: EnrollmentByProgrammeItem[];
  grade_distribution: GradeDistributionItem[];
  /** Enrollment-over-time series for the trend line chart. Optional (guard with `?? []`). */
  enrollment_trend?: EnrollmentTrendItem[];
  /** A short list of teaching staff for the Lecturers card. Optional (guard with `?? []`). */
  recent_teachers?: DashboardPerson[];
  /** A short list of students for the Students card. Optional (guard with `?? []`). */
  recent_students?: DashboardPerson[];
  recent_announcements: DashboardAnnouncement[];
}

// ── Registrar / secretary (records clerk — task-forward, FR-DASH-03) ─────────────
export interface SecretaryEnrollmentItem {
  enrollment_id: string;
  student_name: string;
  /** The offering's derived label. Was `section_name`, a homeroom's own column. */
  offering_label: string;
  enrolled_at: string;
}

export interface SecretaryDashboard extends DashboardBase {
  role: 'secretary';
  stats: {
    active_students: number;
    active_teachers: number;
    total_sections: number;
    /** Live offerings with no lecturer assigned — a setup task. */
    unstaffed_subjects: number;
    /** Offerings whose roster exceeds capacity (warn-only, D-Q6). */
    over_capacity_sections: number;
    unread_announcements: number;
  };
  recent_enrollments: SecretaryEnrollmentItem[];
  recent_announcements: DashboardAnnouncement[];
}

// ── Lecturer / teacher (own offerings) ───────────────────────────────────────────
export interface TeacherTodayOffering {
  offering: OfferingRef;
  attendance_recorded: boolean;
}

export interface TeacherAssessmentItem {
  id: string;
  title: string;
  offering: OfferingRef | null;
  assessment_date: string | null;
  status: string;
}

/**
 * An assessment the lecturer has MARKED but not yet RELEASED to students.
 *
 * Extends the plain assessment item with the two fields that make the row actionable:
 * `offering_id` (the gradebook is addressed by offering, not by assessment) and how many
 * students are still waiting.
 */
export interface TeacherAwaitingReleaseItem extends TeacherAssessmentItem {
  offering_id: string;
  graded_unreleased_count: number;
}

export interface TeacherDashboard extends DashboardBase {
  role: 'teacher';
  stats: {
    /** ONE count, not two — see the D31 note at the top of this file. */
    my_offerings: number;
    attendance_due_today: number;
    /** Assessments still being MARKED (published / grading). */
    ungraded_items: number;
    /**
     * Assessments already marked but still HIDDEN from students. Distinct from
     * `ungraded_items`: that is work still to do, this is finished work not yet
     * published. The two are counted separately and must not be summed.
     */
    awaiting_release_items: number;
  };
  today_classes: TeacherTodayOffering[];
  recent_assessments: TeacherAssessmentItem[];
  awaiting_release: TeacherAwaitingReleaseItem[];
  recent_announcements: DashboardAnnouncement[];
}

// ── Student (own data) ────────────────────────────────────────────────────────────
export interface StudentOfferingItem {
  offering: OfferingRef;
  teacher_name: string;
}

export interface StudentGradeItem {
  assessment_id: string;
  title: string;
  offering: OfferingRef | null;
  score: number;
  max_score: number;
  letter: string;
}

export interface StudentUpcomingItem {
  id: string;
  title: string;
  offering: OfferingRef | null;
  assessment_date: string | null;
}

export interface StudentDashboard extends DashboardBase {
  role: 'student';
  stats: {
    term_average: number | null;
    term_letter: string | null;
    /**
     * Credit-weighted term GPA (D30 §D5). The RELEASED view, like `term_average`: an
     * unreleased course contributes 0 quality points and keeps its credits, so the
     * figure can never be used to back out a mark not yet shown.
     */
    gpa: number | null;
    total_credits: number;
    attendance_rate: number;
    upcoming_count: number;
  };
  my_classes: StudentOfferingItem[];
  recent_grades: StudentGradeItem[];
  upcoming_assessments: StudentUpcomingItem[];
  announcements: DashboardAnnouncement[];
}

/** Role-discriminated composite response. Narrow on `.role`. */
export type DashboardResponse =
  | AdminDashboard
  | SecretaryDashboard
  | TeacherDashboard
  | StudentDashboard;

/** Type guard: the school-wide admin (Dean) variant. */
export function isAdminDashboard(d: DashboardResponse): d is AdminDashboard {
  return d.role === 'principal';
}

export type { Role };

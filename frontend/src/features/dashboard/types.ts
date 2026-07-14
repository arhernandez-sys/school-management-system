/**
 * Dashboard module types (Phase 7 · DEMO).
 *
 * The wire contract for the composite `GET /api/v1/dashboard` endpoint (api-spec
 * Module 2). One request returns a role-discriminated payload — the SAME DashboardPage
 * renders whichever variant the server sends, keyed on `role`. Fields are snake_case to
 * match the wire format; the MSW handler in handlers/dashboard.ts shapes these from the
 * demo dataset selectors so every figure reconciles with the list/detail screens.
 */
import type { Role } from '@shared/types/enums';
import type { StatusKind } from '@shared/components/StatusBadge';

// ── Shared fragments ────────────────────────────────────────────────────────────
export interface DashboardAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  published_at: string;
  is_read: boolean;
}

export interface EnrollmentByGradeItem {
  grade_level: string;
  count: number;
}

export interface GradeDistributionItem {
  letter: string;
  count: number;
}

/** A point in the enrollment-over-time series (Principal analytics, line chart). */
export interface EnrollmentTrendItem {
  /** Human label for the x-axis (e.g. a term like "S1 2025–26"). */
  period: string;
  count: number;
}

/**
 * A compact person row for the Principal's Teachers / Students list cards. Kept
 * self-contained (name + a little meta + a status) so it never couples to the full
 * students/teachers list endpoints.
 */
export interface DashboardPerson {
  id: string;
  name: string;
  /** Secondary meta line (e.g. subject specializations, or the student's section). */
  secondary?: string;
  status?: { label: string; kind: StatusKind };
}

/** Common header fields present on every role's payload. */
interface DashboardBase {
  user_full_name: string;
  academic_year_name: string | null;
  semester_name: string | null;
}

// ── Principal (school-wide analytics) ───────────────────────────────────────────
export interface AdminDashboard extends DashboardBase {
  role: 'principal';
  stats: {
    active_students: number;
    active_teachers: number;
    total_sections: number;
    attendance_rate: number;
    unread_announcements: number;
    /** New intake for the current term (entry-grade cohort). Optional: real backend may omit. */
    new_students_term?: number;
    /** Total active subject offerings (class_subjects). Optional. */
    total_courses?: number;
    /** Sum of section capacities — the denominator for the "seats filled" progress bar. Optional. */
    student_capacity?: number;
  };
  enrollment_by_grade: EnrollmentByGradeItem[];
  grade_distribution: GradeDistributionItem[];
  /** Enrollment-over-time series for the trend line chart. Optional (guard with `?? []`). */
  enrollment_trend?: EnrollmentTrendItem[];
  /** A short list of teaching staff for the Teachers card. Optional (guard with `?? []`). */
  recent_teachers?: DashboardPerson[];
  /** A short list of students for the Students card. Optional (guard with `?? []`). */
  recent_students?: DashboardPerson[];
  recent_announcements: DashboardAnnouncement[];
}

// ── Secretary (records clerk — task & quick-action forward, FR-DASH-03) ──────────
export interface SecretaryEnrollmentItem {
  enrollment_id: string;
  student_name: string;
  section_name: string;
  enrolled_at: string;
}

export interface SecretaryDashboard extends DashboardBase {
  role: 'secretary';
  stats: {
    active_students: number;
    active_teachers: number;
    total_sections: number;
    /** Active offerings with no teacher assigned — a setup task. */
    unstaffed_subjects: number;
    /** Sections whose roster exceeds capacity (warn-only, D-Q6). */
    over_capacity_sections: number;
    unread_announcements: number;
  };
  recent_enrollments: SecretaryEnrollmentItem[];
  recent_announcements: DashboardAnnouncement[];
}

// ── Teacher (own classes) ────────────────────────────────────────────────────────
export interface TeacherTodayClass {
  class_subject_id: string;
  section_id: string;
  section_name: string;
  subject_name: string;
  attendance_recorded: boolean;
}

export interface TeacherAssessmentItem {
  id: string;
  title: string;
  subject_name: string;
  section_name: string;
  assessment_date: string | null;
  status: string;
}

export interface TeacherDashboard extends DashboardBase {
  role: 'teacher';
  stats: {
    my_sections: number;
    my_class_subjects: number;
    attendance_due_today: number;
    ungraded_items: number;
  };
  today_classes: TeacherTodayClass[];
  recent_assessments: TeacherAssessmentItem[];
  recent_announcements: DashboardAnnouncement[];
}

// ── Student (own data) ────────────────────────────────────────────────────────────
export interface StudentClassItem {
  class_subject_id: string;
  subject_name: string;
  teacher_name: string;
}

export interface StudentGradeItem {
  assessment_id: string;
  title: string;
  subject_name: string;
  score: number;
  max_score: number;
  letter: string;
}

export interface StudentUpcomingItem {
  id: string;
  title: string;
  subject_name: string;
  assessment_date: string | null;
}

export interface StudentDashboard extends DashboardBase {
  role: 'student';
  stats: {
    term_average: number | null;
    term_letter: string | null;
    attendance_rate: number;
    upcoming_count: number;
  };
  my_classes: StudentClassItem[];
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

/** Type guard: the school-wide admin (principal) variant. */
export function isAdminDashboard(d: DashboardResponse): d is AdminDashboard {
  return d.role === 'principal';
}

export type { Role };

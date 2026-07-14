/**
 * DEMO DATASET — TypeScript types (frontend-only client demo).
 *
 * These describe the shape of the single in-memory fake dataset that ALL MSW
 * handlers and dashboards read from, so numbers reconcile across every screen
 * (a dashboard "total students" == the students list length; a gradebook's grades
 * == the student's report-card lines).
 *
 * Wire format is snake_case (api-specification.md §1.2) — these entity types are the
 * internal store rows; handlers map/pick from them into the api-spec response shapes.
 * Enums are re-used from `@shared/types/enums` so the demo can never drift from the
 * role/status vocabularies the real backend uses.
 *
 * ⚠️ Downstream module agents: import these (and the selectors) — do NOT redefine.
 */
import type {
  Role,
  StudentStatus,
  TeacherStatus,
  AcademicYearStatus,
  AssessmentType,
  AssessmentStatus,
  GradeStatus,
  AttendanceStatus,
  AnnouncementAudience,
} from '@shared/types/enums';

// ── School identity / branding (api-spec §5.11) ─────────────────────────────────
export interface DemoSchoolProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string | null;
  /** Brand colors (mirror the D19 theme primary/secondary). */
  colors: { primary: string; secondary: string };
}

// ── Academic structure ──────────────────────────────────────────────────────────
export interface DemoAcademicYear {
  id: string;
  name: string; // e.g. "2025-2026"
  start_date: string; // YYYY-MM-DD
  end_date: string;
  status: AcademicYearStatus;
  archived_at: string | null; // RFC3339 instant when archived, else null
}

export interface DemoSemester {
  id: string;
  academic_year_id: string;
  name: string; // e.g. "Semester 1"
  sequence: 1 | 2;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

// ── Subject catalog (api-spec §5b) ──────────────────────────────────────────────
export interface DemoSubject {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

// ── Sections / classes (D23 homerooms) ──────────────────────────────────────────
export interface DemoSection {
  id: string;
  academic_year_id: string;
  name: string; // e.g. "Form 1A"
  grade_level: string; // e.g. "Form 1"
  section: string; // e.g. "A"
  homeroom_label: string; // display label for the homeroom
  capacity: number;
  is_archived: boolean;
}

// ── Teachers ────────────────────────────────────────────────────────────────────
export interface DemoTeacher {
  id: string;
  user_id: string | null; // linked login (null = no account)
  staff_number: string;
  full_name: string;
  email: string;
  phone: string;
  subject_specializations: string[];
  status: TeacherStatus;
  // Extended profile (optional — created teachers omit them; the PATCH handler persists edits).
  avatar_url?: string;
  bio?: string;
  gender?: 'male' | 'female' | 'other';
  education?: string;
  designation?: string;
  address?: string;
  expertise?: { area: string; level: number }[];
}

// ── Students ────────────────────────────────────────────────────────────────────
export interface DemoStudent {
  id: string;
  user_id: string | null;
  student_number: string;
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  gender: 'male' | 'female';
  enrollment_date: string;
  status: StudentStatus;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  address: string;
  phone: string;
  /** Convenience denormalization: the student's ONE current section (active semester). */
  section_id: string | null;
}

// ── class_subjects: a subject taught within a section, with its teacher(s) ────────
export interface DemoClassSubject {
  id: string; // class_subject_id
  section_id: string;
  subject_id: string;
  teacher_ids: string[]; // assigned teacher(s); first = lead
  lead_teacher_id: string | null;
  is_active: boolean;
  /** Teacher-set stored drop-lowest fallback (D25); 0 = none. */
  drop_lowest_count: number;
}

// ── Enrollment: student ↔ section for a semester ────────────────────────────────
export interface DemoEnrollment {
  id: string; // enrollment_id
  student_id: string;
  section_id: string;
  semester_id: string;
  enrolled_at: string; // RFC3339
  unenrolled_at: string | null; // null = active member
}

// ── Assessment categories (optional weighting groups) ───────────────────────────
export interface DemoAssessmentCategory {
  id: string;
  class_subject_id: string;
  name: string; // e.g. "Quizzes"
  weight: number; // 0..1 relative weight
  drop_lowest_count: number;
}

// ── Assessments (assessment-first) ──────────────────────────────────────────────
export interface DemoAssessment {
  id: string;
  class_subject_id: string;
  semester_id: string;
  category_id: string | null;
  title: string;
  type: AssessmentType;
  max_score: number;
  weight: number;
  assessment_date: string | null; // YYYY-MM-DD
  status: AssessmentStatus;
  is_released: boolean;
}

// ── Assessment grades (per assessment × enrolled student) ───────────────────────
export interface DemoAssessmentGrade {
  id: string;
  assessment_id: string;
  student_id: string;
  enrollment_id: string;
  status: GradeStatus;
  score: number | null; // present only when status=graded
  makeup_score: number | null;
  is_released: boolean | null; // null => inherit assessment.is_released
}

// ── Attendance (per-section, per-day) ───────────────────────────────────────────
export interface DemoAttendanceRecord {
  id: string;
  section_id: string;
  student_id: string;
  enrollment_id: string;
  semester_id: string;
  attendance_date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  recorded_by_user_id: string;
  recorded_at: string; // RFC3339
}

// ── Announcements ───────────────────────────────────────────────────────────────
export interface DemoAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  section_id: string | null; // required iff audience=class
  author_user_id: string;
  published_at: string; // RFC3339
  expires_at: string | null;
  /** user_ids that have read this announcement (drives is_read + unread-count). */
  read_by_user_ids: string[];
}

// ── Calendar events (P/S authored) ──────────────────────────────────────────────
export type EventCategory = 'holiday' | 'exam' | 'meeting' | 'activity' | 'other';

/** Who an event reaches: `global` = everyone; `internal` = staff only (no students). */
export type EventVisibility = 'global' | 'internal';

export interface DemoEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  visibility: EventVisibility;
  /** Inclusive date range, YYYY-MM-DD. `end_date === null` means a single-day event. */
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  /** HH:mm (24h). Only meaningful when `all_day` is false. */
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  created_by_user_id: string;
  created_at: string;
}

// ── Grading scale + bands (per active year) ─────────────────────────────────────
export interface DemoGradingBand {
  letter: string;
  min_score: number;
  max_score: number; // inclusive ceiling (.99 convention tolerated per OQ-DB2)
  is_passing: boolean;
  sort_order: number;
}

export interface DemoGradingScale {
  academic_year_id: string;
  pass_mark: number;
  is_frozen: boolean;
  bands: DemoGradingBand[];
}

export interface DemoAssessmentPolicy {
  absent_as_zero: boolean;
  allow_makeup: boolean;
  drop_lowest_count: number;
}

// ── Users (login accounts, backs Settings › Users) ──────────────────────────────
export interface DemoUser {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  /** demo-only: preferences returned by /settings/account + /auth/me. */
  locale: string;
  theme: string;
  date_format: string | null;
  default_page_size: number;
}

// ── The whole dataset (one object) ──────────────────────────────────────────────
export interface DemoDataset {
  school_profile: DemoSchoolProfile;
  academic_years: DemoAcademicYear[];
  semesters: DemoSemester[];
  subjects: DemoSubject[];
  sections: DemoSection[];
  teachers: DemoTeacher[];
  students: DemoStudent[];
  class_subjects: DemoClassSubject[];
  enrollments: DemoEnrollment[];
  assessment_categories: DemoAssessmentCategory[];
  assessments: DemoAssessment[];
  assessment_grades: DemoAssessmentGrade[];
  attendance_records: DemoAttendanceRecord[];
  announcements: DemoAnnouncement[];
  events: DemoEvent[];
  grading_scales: DemoGradingScale[];
  assessment_policy: DemoAssessmentPolicy;
  users: DemoUser[];
}

/** Generic pagination result the `paginate` helper returns (api-spec §4.1). */
export interface DemoPage<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Common list query params the selectors accept (api-spec §6). */
export interface DemoListParams {
  page?: number;
  page_size?: number;
  sort?: string | null; // "field" asc, "-field" desc
  search?: string | null;
  [key: string]: unknown;
}

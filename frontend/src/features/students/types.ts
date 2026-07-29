/**
 * Students module wire types (api-spec §5 Module 3).
 *
 * These mirror the exact snake_case shapes the demo MSW handler returns
 * (handlers/students.ts), which in turn match the api-spec §5.3 response models. The
 * enums are re-used from the shared vocabulary so the feature can never drift from the
 * role/status sets the real backend uses.
 */
import type { Page } from '@shared/types/api';
import type { StudentStatus, AssessmentType, GradeStatus } from '@shared/types/enums';

/** Lightweight ref to the student's current (active-semester) section. */
export interface StudentSectionRef {
  id: string;
  name: string;
  grade_level: string;
  section: string;
}

/** Row in GET /students. */
export interface StudentListItem {
  id: string;
  student_number: string;
  full_name: string;
  status: StudentStatus;
  current_section: StudentSectionRef | null;
  guardian_name: string | null;
}

/** GET /students/{id}, /me, POST, PATCH, POST /status. */
export interface StudentDetail {
  id: string;
  student_number: string;
  full_name: string;
  date_of_birth: string;
  gender: 'male' | 'female';
  enrollment_date: string;
  status: StudentStatus;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  address: string;
  phone: string;
  current_section: StudentSectionRef | null;
}

/** One assessment line under a subject group (GET /students/{id}/assessments). */
export interface StudentAssessmentLine {
  id: string;
  title: string;
  type: AssessmentType;
  max_score: number;
  weight: number;
  assessment_date: string | null;
  status: GradeStatus;
  /** Only present once released + graded, else null. */
  score: number | null;
  is_released: boolean;
  /**
   * When a principal/secretary last reminded the teacher to release this
   * assessment (ISO, UTC), or null if never. Drives the "Reminded 2h ago"
   * disabled state on the Remind-teacher action.
   */
  last_nudged_at: string | null;
}

/** Assessments grouped by the student's class-subject offerings. */
export interface StudentAssessmentGroup {
  class_subject_id: string;
  subject: { id: string; name: string; code: string } | null;
  term_grade: { numeric: number | null; letter: string | null };
  assessments: StudentAssessmentLine[];
}

/** GET /students/{id}/assessments — the full envelope. */
export interface StudentAssessmentsResponse {
  items: StudentAssessmentGroup[];
  /**
   * The nudge cooldown, served by the API so the SPA never keeps its own copy of
   * the window (which would drift the moment the server value is retuned).
   */
  nudge_cooldown_seconds: number;
}

/** POST /assessments/{id}/nudge-release response. */
export interface NudgeReleaseResult {
  assessment_id: string;
  awaiting_release_count: number;
  teachers: { id: string; full_name: string }[];
  last_nudged_at: string;
  next_nudge_allowed_at: string;
  cooldown_seconds: number;
}

/** Create/update payload (StudentCreate; all optional on PATCH). */
export interface StudentWritePayload {
  student_number: string;
  full_name: string;
  date_of_birth: string;
  gender?: 'male' | 'female';
  enrollment_date: string;
  status?: StudentStatus;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  address?: string;
  phone?: string;
  section_id?: string | null;
}

/** One academic year the student was enrolled in (GET /students/{id}/years). */
export interface StudentYear {
  id: string;
  name: string;
  status: string;
}

/** GET /students query params (api-spec §5.3 + §6 list params). */
export interface StudentsListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  search?: string;
  status?: StudentStatus;
  class_id?: string;
  grade_level?: string;
  /** Per-module year switcher: restrict to students enrolled in this academic year. */
  academic_year_id?: string;
}

export type StudentsPage = Page<StudentListItem>;

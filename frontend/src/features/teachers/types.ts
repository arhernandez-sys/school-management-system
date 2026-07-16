import type { TeacherStatus } from '@shared/types/enums';

/**
 * Teachers feature wire types (api-spec §5 Module 4). The Teachers endpoints are not
 * in the served OpenAPI yet, so — unlike Subjects/Settings which use the orval-generated
 * models — this module hand-declares the response contracts it consumes. They match the
 * exact shapes the demo MSW handler (`handlers/teachers.ts`) returns, and the eventual
 * backend `TeacherListItem` / `TeacherDetail` shapes.
 */

/** Row in the searchable directory (GET /teachers → Page[TeacherListItem]). */
export interface TeacherListItem {
  id: string;
  staff_number: string;
  full_name: string;
  email: string;
  status: TeacherStatus;
  subject_specializations: string[];
  /** Number of class_subjects this teacher is assigned to (directory convenience). */
  assignment_count: number;
}

/** A section reference on a teacher's assignment. */
export interface TeacherClassRef {
  id: string;
  name: string;
  grade_level: string;
}

/** A subject reference on a teacher's assignment. */
export interface TeacherSubjectRef {
  id: string;
  name: string;
  code: string;
}

/** One class_subject a teacher is assigned to (Assignments tab). */
export interface TeacherClassTaught {
  class_subject_id: string;
  class_ref: TeacherClassRef | null;
  subject: TeacherSubjectRef | null;
  is_lead: boolean;
  is_active: boolean;
}

/** A rated area of subject expertise (0–100), rendered as a labelled progress bar. */
export interface TeacherExpertise {
  area: string;
  /** Proficiency 0–100. */
  level: number;
}

/**
 * GET /teachers/{id} + the profile portion of create/patch responses.
 *
 * The extended profile fields (`avatar_url` … `expertise`, `student_count`) are OPTIONAL:
 * the demo MSW handler seeds/persists them, but a real backend that has not shipped them
 * yet simply omits them — every consumer must treat them as possibly-undefined.
 */
export interface TeacherDetail {
  id: string;
  user_id: string | null;
  staff_number: string;
  full_name: string;
  email: string;
  phone: string;
  status: TeacherStatus;
  subject_specializations: string[];
  has_login: boolean;
  classes_taught: TeacherClassTaught[];
  audit: { created_at: string; updated_at: string };
  /** Optional profile portrait; falls back to initials when absent. */
  avatar_url?: string;
  /** Short professional "About me" blurb. */
  bio?: string;
  gender?: 'male' | 'female' | 'other';
  /** Highest relevant qualification, e.g. "M.Ed. Mathematics". */
  education?: string;
  /** Role title, e.g. "Head of Department". */
  designation?: string;
  address?: string;
  /** Rated subject-expertise areas (profile "Subject Expertise" bars). */
  expertise?: TeacherExpertise[];
  /** Distinct students across this teacher's classes (directory convenience). */
  student_count?: number;
}

/** POST /teachers request body. */
export interface TeacherCreateBody {
  staff_number: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  status?: TeacherStatus;
  subject_specializations?: string[];
  /** When present, provisions a linked login and returns a one-time temp password. */
  create_login?: { email: string; role: 'teacher' } | null;
}

/** POST /teachers response envelope (temp password surfaced ONCE on create-with-login). */
export interface TeacherCreateResult {
  teacher: TeacherDetail;
  temporary_password: string | null;
}

/** PATCH /teachers/{id} request body (benign profile edits only). */
export interface TeacherUpdateBody {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  subject_specializations?: string[];
  bio?: string;
  gender?: 'male' | 'female' | 'other';
  education?: string;
  designation?: string;
  address?: string;
  expertise?: TeacherExpertise[];
}

/** GET /teachers query params. */
export interface TeachersListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  search?: string;
  status?: TeacherStatus;
  specialization?: string;
  /** Per-module year switcher: restrict to teachers assigned in this academic year. */
  academic_year_id?: string;
}

/** The Page[T] envelope (api-spec §4.1). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

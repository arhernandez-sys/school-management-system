import type { OfferingRef } from '@shared/types/api';
import type { TeacherStatus } from '@shared/types/enums';

export type { OfferingRef };

/**
 * Teachers feature wire types (api-spec §5 Module 4). The Teachers endpoints are not in the
 * orval-covered surface (`orval.config.ts` generates auth / health / settings / courses), so
 * this module hand-declares the response contracts it consumes. They match both the demo MSW
 * handler (`handlers/teachers.ts`) and the backend `TeacherListItem` / `TeacherDetail`.
 */

/** Row in the searchable directory (GET /teachers → Page[TeacherListItem]). */
export interface TeacherListItem {
  id: string;
  staff_number: string;
  full_name: string;
  email: string;
  status: TeacherStatus;
  subject_specializations: string[];
  /** Number of offerings this lecturer is assigned to (directory convenience). */
  assignment_count: number;
}

/**
 * One OFFERING a lecturer is assigned to (Assignments tab).
 *
 * **D31** — three fields collapsed into the shared `OfferingRef`. This carried
 * `class_ref` (id + name + `grade_level`) beside a separate `subject` ref, because a
 * homeroom and the subject taught in it were two rows; they are one row now, so a second
 * ref could only ever restate the first. `is_active` went with `class_subjects.is_active`.
 *
 * The flat `offering_id` rides along beside the ref because the row LINKS to the gradebook,
 * which is addressed by offering id — a link target should not have to reach into a nested
 * object.
 */
export interface TeacherClassTaught {
  offering_id: string;
  offering: OfferingRef;
  is_lead: boolean;
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
  /** `updated_at` is null until the record is actually edited (D39 `015`). */
  audit: { created_at: string; updated_at: string | null };
  /** Optional profile portrait; falls back to initials when absent. */
  avatar_url?: string;
  /** Short professional "About me" blurb. */
  bio?: string;
  gender?: 'male' | 'female' | 'other';
  /**
   * Highest relevant qualification, e.g. "M.Ed. Mathematics".
   * Renamed from `education` by D39 (Meeting #2 item 10).
   */
  academic_qualification?: string;
  /** Role title, e.g. "Head of Department". */
  designation?: string;
  address?: string;
  /** Rated subject-expertise areas (profile "Subject Expertise" bars). */
  expertise?: TeacherExpertise[];
  /**
   * Employment record (D39, Meeting #2 item 10).
   *
   * `first_name` / `last_name` are additive — `full_name` stays the display value.
   * `is_employed` is READ-ONLY: the server derives it from `status`, and it is absent
   * from both write bodies so the two can never disagree.
   */
  first_name?: string;
  last_name?: string;
  ssno?: string;
  /** Alphanumeric, e.g. "OWD-2019-00035". Never a number. */
  licensenum?: string;
  is_employed?: boolean;
  hire_date?: string | null;
  end_date?: string | null;
  comments?: string;
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
  /** Employment record (D39). `is_employed` is absent by design — derived from status. */
  first_name?: string;
  last_name?: string;
  ssno?: string;
  licensenum?: string;
  hire_date?: string | null;
  end_date?: string | null;
  academic_qualification?: string;
  designation?: string;
  address?: string;
  comments?: string;
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
  academic_qualification?: string;
  designation?: string;
  address?: string;
  expertise?: TeacherExpertise[];
  /** Employment record (D39). `is_employed` is absent by design — derived from status. */
  first_name?: string;
  last_name?: string;
  ssno?: string;
  licensenum?: string;
  hire_date?: string | null;
  end_date?: string | null;
  comments?: string;
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

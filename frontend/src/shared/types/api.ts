/**
 * Shared API contract types.
 *
 * ── AUTH / ENVELOPE TYPES ARE NOW GENERATED (7.0e / OQ-FE-B) ──
 * `CurrentUser`, `AuthTokenResponse`, `UserPreferences`, `ErrorResponse` (and its
 * `ErrorBody`) are RE-EXPORTED from the orval-generated client
 * (`shared/api/generated/model`, derived from the backend FastAPI OpenAPI). The
 * former FE-3 hand-authored copies are deleted so the contract cannot drift — the
 * generated types are the single source of truth. Existing imports of these names
 * from `@shared/types/api` keep working unchanged (this barrel preserves the names).
 *
 * Still hand-authored here: `Page<T>`, `SemesterRef`, `SchoolIdentity` — these are
 * NOT yet present in the auth-only OpenAPI surface (the backend currently serves only
 * the 6 auth endpoints + /health). They will be replaced by generated types as the
 * later modules (Settings, Dashboard, …) add their endpoints to the schema. Keep the
 * envelope name `Page<T>` stable — it is imported widely.
 *
 * Wire format is snake_case (api-specification.md §1.2).
 */

// Generated auth + envelope types (single source of truth — do not re-declare).
export type {
  CurrentUser,
  AuthTokenResponse,
  UserPreferences,
  ErrorResponse,
  ErrorBody,
} from '@shared/api/generated/model';

/** Pagination envelope (api-specification.md §4.1). The DataTable binds to this. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * ── LIGHTWEIGHT REFS (api-specification.md §4.4) ──
 *
 * These mirror `backend/app/common/schemas.py` and are declared ONCE here, for the same
 * reason the backend consolidated them in D31: five modules had each defined their own
 * offering ref and they disagreed about the key, the label field, and how much of the
 * homeroom came along. `features/grades/types.ts` alone carried `SectionRef` +
 * `SubjectRef` + `ClassSubjectRef`, while `features/announcements` had `ClassRef` and
 * `features/assessments` had yet another shape keyed `class_subject_id`.
 *
 * That was survivable while a ref wrapped two rows. It is not now that **the label is
 * derived server-side** — five client derivations of one string drift, and the screens
 * are where the drift shows. A feature adds a field to its own local type only when the
 * field is genuinely local to that endpoint (attendance's `teachers[].name`, grades'
 * `lead_teacher_id`).
 */

export interface SemesterRef {
  id: string;
  name: string;
  sequence: number;
  is_active: boolean;
}

export interface AcademicYearRef {
  id: string;
  name: string;
  status: 'active' | 'archived';
}

/** The CATALOG entry — code, name, credits. Credits live here and nowhere else. */
export interface CourseRef {
  id: string;
  name: string;
  code: string | null;
  credits: number | null;
}

export interface TeacherRef {
  id: string;
  staff_number: string;
  full_name: string;
}

export interface StudentRef {
  id: string;
  student_number: string;
  full_name: string;
}

/**
 * A scheduled OFFERING of a course — one course, one semester, one optional section.
 *
 * **D31** — this replaced `ClassRef` (a homeroom scoped to an academic YEAR) and
 * `ClassSubjectRef` (the join that existed only because one homeroom taught seven
 * subjects). One offering teaches one course, so the two collapsed into one.
 *
 * `label` is **server-computed** and is the only thing a screen should print. An offering
 * row stores no name — the label derives from course code + section + term — so deriving
 * it here would put a second home under one fact. Sort on `course.code` then
 * `section_code`, never on `label`: "MATH1110-2" sorts before "MATH1110-10".
 */
export interface OfferingRef {
  id: string;
  course: CourseRef;
  /** Null only for a legacy row with no term resolved; current writes always set it. */
  semester: SemesterRef | null;
  /** "01", "02" for parallel sections of one course; null when there is only one. */
  section_code: string | null;
  label: string;
}

export interface SchoolIdentity {
  name: string;
  logo_url?: string;
  address?: string;
  contact_email?: string;
  contact_phone?: string;
}

/**
 * Enums mirroring the Postgres native enums (api-specification.md §4.5).
 *
 * `Role` is now RE-EXPORTED from the orval-generated client (the auth OpenAPI
 * defines it), so the role vocabulary cannot drift from the backend. The remaining
 * enums below are still hand-authored — their owning modules (Students, Assessments,
 * …) are not yet in the served OpenAPI; they will be re-sourced from codegen as those
 * endpoints land. All are string-literal unions (not TS `enum`s) so they serialize/
 * compare to the exact lowercase wire labels with zero runtime cost.
 */

// Generated role vocabulary (single source of truth). Re-exported as a type so all
// existing `import type { Role } from '@shared/types/enums'` sites keep working.
export type { Role } from '@shared/api/generated/model';
import type { Role } from '@shared/api/generated/model';

/**
 * Student lifecycle, in the CLIENT'S vocabulary (D34) — adopted verbatim from their own
 * `student_profiles` dump, mixed case and all.
 *
 *   Registered    "instead of active" — enrolled and attending.
 *   Unregistered  "when student do not continue further semesters, but has successfully
 *                 completed the last semester". NOT a failure state, which is why
 *                 "inactive" was the wrong word.
 *   DropOut       left mid-programme. Pairs with `dropout_date` / `dropout_reason`.
 *   graduated     only the Dean and Registrar may set it (already true — the endpoint is
 *                 role-guarded to those two).
 *   transferred / withdrawn   unchanged.
 *
 * The mixed case is deliberate: it mirrors the client's enum exactly, because their dump
 * is the authority for that column and normalising it would put the database out of step
 * with their own tooling. Mirrors `app/common/enums.py::StudentStatus`.
 */
/**
 * The gender values the forms offer (D37). Mirrors `app/common/enums.py::Gender`.
 *
 * **The COLUMNS are free text and stay so** — `student_profiles.gender` and
 * `applications.gender` are `varchar` carrying the comment "Free/lookup text; not a fixed
 * enum", because narrowing them would reject historical rows this system did not write.
 * What is constrained is the WRITE PATH: these two are the only values the dropdowns
 * offer, and the server folds anything else onto them (`normalise_gender`).
 *
 * Lowercase because 46 of the 47 live rows already are, and because every comparison in
 * this codebase is written that way — `gender === 'female'`. That matters more than it
 * looks: MariaDB's collation is case-insensitive so the directory FILTER tolerated a
 * stray `'Male'`, but JS does not, and a mismatched value renders an EMPTY select and the
 * wrong label on the profile card.
 */
export type Gender = 'female' | 'male';

export const GENDERS: readonly Gender[] = ['female', 'male'];

/** Display labels. The stored values are lowercase; these are what a human reads. */
export const GENDER_LABEL: Record<Gender, string> = {
  female: 'Female',
  male: 'Male',
};

/**
 * The value as one of the two canonical options, or `null` if it is neither.
 *
 * Used to seed a `<select>`: a value that is not among the options renders BLANK, and
 * saving from a blank select clears the field. Canonicalising on load turns a stored
 * `'Male'` into the Male option instead.
 */
export function canonicalGender(value: string | null | undefined): Gender | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return key === 'female' || key === 'male' ? key : null;
}

/**
 * A stored value as a label, tolerating anything the dropdowns did not write.
 */
export function genderLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (key === 'female' || key === 'male') return GENDER_LABEL[key];
  // Not one of ours — show it as stored rather than mislabelling it.
  return value;
}

export type StudentStatus =
  | 'Registered'
  | 'Unregistered'
  | 'DropOut'
  | 'transferred'
  | 'graduated'
  | 'withdrawn';

export type TeacherStatus = 'active' | 'inactive';

export type AcademicYearStatus = 'active' | 'archived';

export type AssessmentType = 'quiz' | 'test' | 'exam' | 'assignment';

export type AssessmentStatus = 'draft' | 'published' | 'grading' | 'graded';

export type GradeStatus = 'pending' | 'graded' | 'absent' | 'excused' | 'exempt';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type AnnouncementAudience = 'all' | 'students' | 'teachers' | 'class';

/** All roles, ordered for display/iteration. */
export const ROLES: readonly Role[] = ['principal', 'secretary', 'teacher', 'student'];

/**
 * Belize's six districts (`app/common/enums.District`).
 *
 * D33 — MOVED HERE from `features/admissions/types.ts`, which re-exports it so every
 * existing import keeps working. It stopped being an admissions-only vocabulary the moment
 * the student record grew an address: two independent copies of a closed enum is exactly
 * how "Stann Creek" ends up spelled two ways in one database.
 */
export type District =
  | 'Corozal'
  | 'Orange Walk'
  | 'Belize'
  | 'Cayo'
  | 'Stann Creek'
  | 'Toledo';

export const DISTRICTS: readonly District[] = [
  'Corozal',
  'Orange Walk',
  'Belize',
  'Cayo',
  'Stann Creek',
  'Toledo',
];

/**
 * Study load (`app/common/enums.EnrollmentLoad`). Part Time is under 15 credits a term,
 * Full Time over 15; Transient is a visiting student. Moved here with `District`, and
 * SEPARATE from year of study — `sims_bk.sql` had one column conflating the two, which
 * could answer neither question (D30 §D11).
 */
export type EnrollmentLoad = 'Part Time' | 'Full Time' | 'Transient' | 'Summer';

export const ENROLLMENT_LOADS: readonly EnrollmentLoad[] = [
  'Part Time',
  'Full Time',
  'Transient',
  // D34 — from the client's `yearofstudy` enum, which conflated the year with the load.
  // 'Summer' names a term, but it answers the same question this field does; putting it on
  // `year_of_study` would make "which year are they in" unanswerable for a summer student.
  'Summer',
];

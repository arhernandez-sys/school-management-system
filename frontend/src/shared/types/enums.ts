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

/**
 * Student lifecycle — the blueprint's §7.5 vocabulary (D45, client decision C5).
 *
 * **REPLACES the D34 six.** D34 adopted the client's own dump verbatim, mixed case and
 * all; the revised blueprint lists ten states and BAJC confirmed on 2026-09-08 that the
 * ten are what they want. The old values map on cleanly:
 *
 *   Registered -> Active      Unregistered -> Inactive     DropOut -> Dropout
 *   graduated  -> Graduated   withdrawn    -> Withdrawn    transferred -> Transferred
 *
 * `Transferred` is an ELEVENTH value and is NOT in the blueprint. The ten have no
 * equivalent, one live row carries it, and folding it into `Withdrawn` would have
 * rewritten that student's history to say something untrue about why they left — so the
 * client kept it.
 *
 * ⚠️ **TitleCase, all of them, and the case is load-bearing HERE in a way it is not on
 * the server.** MariaDB's collation is case-insensitive so `status = 'graduated'` matched
 * either spelling; JavaScript's `===` does not. A stray lowercase value renders a BLANK
 * select and the wrong label on the profile card — the same trap `canonicalGender` above
 * documents, and the reason D45 normalised the stored bytes rather than leaving the
 * mixed-case vocabulary in place.
 *
 * Mirrors `app/common/enums.py::StudentStatus`.
 */
export type StudentStatus =
  | 'Applicant'
  | 'Accepted'
  | 'Active'
  | 'Inactive'
  | 'Suspended'
  | 'Withdrawn'
  | 'Dropout'
  | 'Completed'
  | 'Graduated'
  | 'Alumni'
  | 'Transferred';

/** All student statuses, in LIFECYCLE order — which is the order a human reads them. */
export const STUDENT_STATUSES: readonly StudentStatus[] = [
  'Applicant',
  'Accepted',
  'Active',
  'Inactive',
  'Suspended',
  'Completed',
  'Graduated',
  'Alumni',
  'Withdrawn',
  'Dropout',
  'Transferred',
];

export type TeacherStatus = 'active' | 'inactive';

export type AcademicYearStatus = 'active' | 'archived';

export type AssessmentType = 'quiz' | 'test' | 'exam' | 'assignment';

export type AssessmentStatus = 'draft' | 'published' | 'grading' | 'graded';

export type GradeStatus = 'pending' | 'graded' | 'absent' | 'excused' | 'exempt';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type AnnouncementAudience = 'all' | 'students' | 'teachers' | 'class';

/** All roles, ordered for display/iteration. */
export const ROLES: readonly Role[] = [
  'principal',
  'secretary',
  'teacher',
  'student',
  'hod',
  'auditor',
  'sysadmin',
];

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

/**
 * Civil status — the values the forms offer (D40, client ask). Mirrors
 * `app/common/enums.py::CivilStatus`.
 *
 * **The COLUMNS stay free text**, exactly as `Gender` does: `student_profiles.civil_status`
 * and `applications.civil_status` are `varchar(50)`, and narrowing them to a DB enum would
 * reject historical rows this system did not write. What is constrained is the WRITE PATH —
 * these four are the only values the dropdowns offer, and the server folds recognised
 * spellings onto them (`normalise_civil_status`). That is D37's rule, applied to a second
 * field that was still free text.
 *
 * TitleCase, unlike `Gender`, because that is what the live `student_profiles` dump already
 * holds ('Single'). Matching the data beats matching the other enum's style: re-casing it
 * would put this system out of step with the client's own tooling for nothing.
 *
 * `Widow(er)` carries its parenthetical because the client's paper form does; it is one
 * status, not two, and splitting it would make the dropdown ask for a fact the form
 * does not collect.
 */
export type CivilStatus = 'Single' | 'Married' | 'Divorced' | 'Widow(er)';

export const CIVIL_STATUSES: readonly CivilStatus[] = [
  'Single',
  'Married',
  'Divorced',
  'Widow(er)',
];

/**
 * Accepted spellings → the canonical value. Mirrors `_CIVIL_STATUS_ALIASES` in
 * `app/common/enums.py`, entry for entry.
 *
 * Generous on purpose, exactly as the server's is: a Registrar transcribing a paper form,
 * an import, and the client's own dump have each produced a different spelling of the same
 * status, and rejecting one over a letter case would block a real record.
 */
const CIVIL_STATUS_ALIASES: Record<string, CivilStatus> = {
  single: 'Single',
  s: 'Single',
  married: 'Married',
  m: 'Married',
  divorced: 'Divorced',
  d: 'Divorced',
  'widow(er)': 'Widow(er)',
  widow: 'Widow(er)',
  widower: 'Widow(er)',
  widowed: 'Widow(er)',
  w: 'Widow(er)',
};

/**
 * A stored civil status as one of the four canonical options, or `null` if it is none of
 * them. Case- and whitespace-insensitive, and alias-aware: `'widower'` resolves to
 * `Widow(er)` because that is what the server would have folded it to on its next write.
 *
 * Used to SEED a `<select>`, and it is not cosmetic. MariaDB's collation is
 * case-insensitive so a stored `'single'` is indistinguishable from `'Single'` to the
 * database, but JS compares case-sensitively: fed to the select raw it matches no option,
 * renders BLANK, and the next save writes an empty civil status over a real one.
 * Canonicalising on load turns it into the Single option instead — the same fix
 * `canonicalGender` makes for the other free-text vocabulary.
 *
 * **It shares its alias table with `normaliseCivilStatus`**, and that is the point: when
 * the two disagreed, a stored `'widower'` opened as its own "(as recorded)" option while
 * the server considered it `Widow(er)` — one value shown as two, in the one control whose
 * job is to make sure it is one.
 */
export function canonicalCivilStatus(value: string | null | undefined): CivilStatus | null {
  if (!value) return null;
  return CIVIL_STATUS_ALIASES[value.trim().toLowerCase()] ?? null;
}

/**
 * The civil-status options to render, with `current` guaranteed present.
 *
 * The same shape and the same reasoning as `religionOptions`: a stored value absent from
 * the list renders an EMPTY select, and saving from a blank select clears the field — so a
 * legacy 'Common law' would be silently destroyed by an edit that never touched it. It is
 * carried as an extra "(as recorded)" option instead.
 *
 * The known-check is case-SENSITIVE on purpose, so this stays correct even for a caller
 * that did not run `canonicalCivilStatus` first: a raw `'single'` gets its own option
 * rather than matching `'Single'` and then rendering blank against it. Callers that DO
 * canonicalise never reach that branch.
 */
export function civilStatusOptions(
  current: string | null | undefined,
): Array<{ value: string; label: string; legacy: boolean }> {
  const list = CIVIL_STATUSES.map((value) => ({ value, label: value as string, legacy: false }));
  const stored = (current ?? '').trim();
  if (!stored) return list;
  const known = list.some((o) => o.value === stored);
  return known ? list : [...list, { value: stored, label: `${stored} (as recorded)`, legacy: true }];
}

/**
 * Fold a submitted civil status onto the canonical vocabulary — the browser mirror of
 * `app/common/enums.py::normalise_civil_status`.
 *
 * It exists for DEMO MODE. The MSW handlers stand in for the server, and the last two
 * times a write rule lived in only one of the two implementations, demo mode certified a
 * screen the real backend refused. Same contract as the server's:
 *
 *  * blank → `null` (the field is optional and `''` is not a value);
 *  * an UNRECOGNISED value passes through unchanged, never rejected — a Registrar
 *    transcribing 'Common law' from a paper form must not be blocked;
 *  * case- and whitespace-insensitive, which is the drift that actually occurs.
 *
 * The difference from `canonicalCivilStatus` is only what happens to an unrecognised
 * value: this one keeps it (it is a WRITE, and the value is real), that one reports `null`
 * (it is seeding a `<select>`, and the caller needs to know to add an option for it).
 */
export function normaliseCivilStatus(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return CIVIL_STATUS_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

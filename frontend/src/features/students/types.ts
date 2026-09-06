/**
 * Students module wire types (api-spec §5 Module 3).
 *
 * These mirror the exact snake_case shapes the demo MSW handler returns
 * (handlers/students.ts), which in turn match the api-spec §5.3 response models. The
 * enums are re-used from the shared vocabulary so the feature can never drift from the
 * role/status sets the real backend uses.
 */
import type { CourseRef, OfferingRef, Page } from '@shared/types/api';
import type {
  StudentStatus,
  AssessmentType,
  GradeStatus,
  District,
  EnrollmentLoad,
} from '@shared/types/enums';

/** The two BAJC years. `enum('First','Second')` server-side, not free text. */
export type YearOfStudy = 'First' | 'Second';

/*
 * NOTE — `StudentClassRef` is gone (D31).
 *
 * It described a homeroom: `{ id, name, grade_level, section }`, where `grade_level` was
 * "the year group the CLASS is for" as distinct from the student's own level. Neither
 * column exists any more, and an offering has no `name` at all. The shared `OfferingRef`
 * from `@shared/types/api` replaces it — the same ref every other module now uses, so
 * "the courses this student takes" and "the offerings on the schedule" cannot render
 * differently.
 */

/**
 * The stored name parts (D30 §D10, brief §11).
 *
 * `full_name` is COMPUTED server-side from these — the column was dropped in
 * `007_student_names.sql` — so it stays on every read shape but is never a write
 * field. `first_name` is nullable only for legacy single-token names.
 */
export interface StudentNameParts {
  full_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string;
}

/** Row in GET /students. */
export interface StudentListItem extends StudentNameParts {
  id: string;
  student_number: string;
  status: StudentStatus;
  /**
   * The student's own level. `enum('First','Second')` server-side — D30 renamed this from
   * `year_group` and narrowed it to the two BAJC years, so free text is not accepted.
   */
  year_of_study: YearOfStudy | null;
  /** How many course offerings they actively sit this term (D31: was `class_count`). */
  offering_count: number;
  guardian_name: string | null;
  /**
   * D32 (brief §3) — the three filterable attributes, on the ROW as well as in the query.
   * The printed list has to show what it was filtered by: a sheet headed "Female students
   * in Business Management" that does not print the programme cannot be checked by the
   * person holding it.
   */
  gender: string | null;
  religion: string | null;
  /** D40 — on the row as well as in the query, for the same reason as the three above. */
  civil_status: string | null;
  /** The programme CODE, e.g. "BMAD". Null until a student is assigned one. */
  program_code: string | null;
}

/**
 * GET /students/filter-options — the free-text values actually PRESENT in the register
 * (D32, D40).
 *
 * Neither list is the dropdown's primary source any more. Religion offers the
 * client-owned `religions` table (D39) and civil status offers the four `CivilStatus`
 * values; these two supply the RESIDUE — what is already stored that those vocabularies
 * do not carry, so a student imported with a religion nobody configured is still
 * selectable rather than being a row the directory shows but cannot filter to.
 */
export interface StudentFilterOptions {
  /** DISTINCT religions present on non-deleted students. Empty until admissions has run. */
  religions: string[];
  /**
   * DISTINCT civil statuses present (D40). Usually a subset of the four canonical values —
   * anything else is a row this system did not write.
   */
  civil_statuses: string[];
}

/**
 * Sections A–E of the BAJC application form, as they live on the STUDENT record
 * (D30 §D11, D33).
 *
 * These columns have existed on `student_profiles` since `005_tertiary.sql` — acceptance
 * has been copying them across all along — but nothing outside admissions could read or
 * write them. D33 (client asks 3 + 4) makes the student form the application form and the
 * profile show everything, which needs them on the wire.
 *
 * Declared once and reused by `StudentDetail` and `StudentWritePayload`, mirroring the
 * server's `_AdmissionProfileFields`. Documents, prior education and credit transfers stay
 * on the APPLICATION: no file bytes exist anywhere (OQ-DB5), and a transfer is anchored on
 * the application by policy (§D4).
 */
export interface StudentAdmissionFields {
  /** Social Security number, 9 chars. Transcribed as the card reads. */
  ssno: string | null;
  /**
   * D40 — written from a fixed dropdown (`CIVIL_STATUSES`), but the COLUMN stays free
   * text so a row this system did not write keeps whatever it holds.
   */
  civil_status: string | null;
  /** Free text on the column; the form writes from the `religions` table (D39). */
  religion: string | null;
  street: string | null;
  city_town_village: string | null;
  district: District | null;
  mother_name: string | null;
  father_name: string | null;
  nok_name: string | null;
  nok_relationship: string | null;
  nok_phone: string | null;
  has_health_condition: boolean;
  health_condition_note: string | null;
  atlib_exam: boolean;
  num_csec: number | null;
  finance_name: string | null;
  finance_phone: string | null;
  finance_email: string | null;
  enrollment_load: EnrollmentLoad | null;
  // ── D34 · reconciled from the CLIENT'S own schema (migration 011) ──────────
  // Their `student_profiles` had moved on from the `sims.sql` this repo was built
  // against; these are the columns it held that live had under no spelling.
  /** The ID this record carried in the system it was imported from. */
  student_id_original: number | null;
  /**
   * The student's OWN email address — how the office writes to them.
   *
   * **NOT the login.** That is `StudentDetail.login_email`, read from the linked `users`
   * row. Before D34 there was no email column on the student at all, so a paper
   * registration with no account had nowhere to record an address; conflating the two
   * under one name is how an address change would silently move a login.
   */
  email: string | null;
  /** The institution a transfer student came from (client column: `transferedfrom`). */
  transferred_from: string | null;
  /** Auto-stamped when the status becomes `graduated`; editable afterwards. */
  graduation_date: string | null;
  /** Auto-stamped when the status becomes `DropOut`; editable afterwards. */
  dropout_date: string | null;
  dropout_reason: string | null;
  /** The Registrar's own notes. Never on a student-facing payload. */
  comments: string | null;
  /** Where the record came from — an import batch, a migration, `admissions`. */
  origin: string | null;
}

/** GET /students/{id}, /me, POST, PATCH, POST /status. */
/**
 * A student's offering, plus whether the CURRENT VIEWER may open its page (D44).
 *
 * Mirrors the server's `students.schemas.StudentOfferingRef`. It is a students-local
 * widening of the shared `OfferingRef` rather than a field on the shared ref itself:
 * five modules send that ref and only this one has a viewer to answer the question for.
 *
 * ⚠️ `can_open` is an AFFORDANCE, never the boundary — the offering endpoints refuse on
 * their own authority. It exists so the UI does not offer a link that leads to a 404.
 */
export interface StudentOfferingRef extends OfferingRef {
  /** Absent on older payloads; treat only an explicit `false` as "closed". */
  can_open?: boolean;
}

export interface StudentDetail extends StudentNameParts, StudentAdmissionFields {
  id: string;
  student_number: string;
  date_of_birth: string;
  /**
   * D37 — `string`, not the two-value union, because the COLUMN is free text
   * (`varchar`, "Free/lookup text; not a fixed enum") and live data already held
   * `'Male'`. Typing it as the union was a lie that made a `<select>` render blank
   * for such a row. Use `genderLabel` / `canonicalGender` to read it.
   */
  gender: string | null;
  year_of_study: YearOfStudy | null;
  enrollment_date: string;
  status: StudentStatus;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  address: string;
  phone: string;
  /**
   * EVERY offering the student actively sits, ordered by course code then section.
   *
   * D29 made this a list (it was `current_section`, one homeroom); **D31 renamed it to
   * `current_offerings`** and gave it the shared `OfferingRef`. Empty when they are not
   * enrolled anywhere, which is a normal state for a newly registered student.
   */
  current_offerings: StudentOfferingRef[];
  /** The programme the student is CURRENTLY registered on (D30 §D12). */
  program: StudentProgramRefLite | null;
  /** The application admitted from, when there is one. Null for a paper registration. */
  application_id: string | null;
  /**
   * The student's LOGIN address, read from the linked `users` row. READ ONLY: changing a
   * login is a Users-module action with its own uniqueness rules. Null for a student who
   * has not been given an account yet.
   *
   * **D34 renamed this from `email`**, because the student record gained a real `email`
   * column of its own — see `StudentAdmissionFields.email` for why the two must not share
   * a name.
   */
  login_email: string | null;
  // ── D34 · mapped for the client's tooling, unused by the API ──────────────
  /** No FK and no consumer: prior education is application-scoped. Read-only. */
  educationbg_id: string | null;
  /** No FK: `student_documents.id` is a uuid and documents are 1:N. Read-only. */
  doc_id: number | null;
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

/**
 * Assessments grouped by the offerings the student sits.
 *
 * The group key is `offering_id` (D31: was `class_subject_id`). The `subject` field keeps
 * its wire name — it carries a `CourseRef` and is one of the few places the server still
 * spells the catalog entry "subject"; renaming it is a backend change, not a client one.
 */
export interface StudentAssessmentGroup {
  offering_id: string;
  subject: CourseRef | null;
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

/**
 * Create/update payload (StudentCreate; all optional on PATCH).
 *
 * D33 — extends `StudentAdmissionFields` as a Partial, so `StudentFormDialog` writes the
 * same Sections A–E the application collects. `program_id` is CREATE ONLY: changing a
 * programme has to move `student_program_history` with it, which is `PUT
 * /students/{id}/program` (Dean only, §D12).
 */
export interface StudentWritePayload extends Partial<StudentAdmissionFields> {
  /**
   * OPTIONAL on create (D30 §D9): omit it and the server issues the next
   * `YYYYMM###`. Generation is server-side only — the SPA never composes one.
   */
  student_number?: string;
  /** D30 §D10 — the name is written in parts. `full_name` is read-only. */
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  date_of_birth: string;
  /** Free text on the wire; the server folds it onto `female`/`male` (D37). */
  gender?: string | null;
  year_of_study?: YearOfStudy | null;
  enrollment_date: string;
  status?: StudentStatus;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  address?: string;
  phone?: string;
  /**
   * Offerings to enrol into, in the same transaction as the create (D29 replaced the
   * single `section_id`; D31 renamed `class_ids` → `offering_ids`). CREATE ONLY: PATCH
   * rejects it, because with many enrolments "set them from here" would be ambiguous
   * about removals. Later changes go through `POST /offerings/{id}/enrollments`.
   */
  offering_ids?: string[];
  /** CREATE ONLY — see the note on this interface. */
  program_id?: string | null;
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
  /** Narrow to the roster of ONE course offering (D31: was `class_id`). */
  offering_id?: string;
  /**
   * Filter on the student's own level. D29 replaced `grade_level` (which resolved through
   * the homeroom and would now answer the wrong question); D30 renamed it `year_of_study`.
   */
  year_of_study?: string;
  /** Per-module year switcher: restrict to students enrolled in this academic year. */
  academic_year_id?: string;
  /**
   * D32 (brief §3). All three AND with each other and with everything above, and they
   * filter the STUDENT RECORD rather than their enrolment — so a graduated student still
   * matches, which is what "print all Catholic students" means.
   */
  religion?: string;
  gender?: string;
  program_id?: string;
  /**
   * D40. Matched EXACTLY, like `religion` — the write path normalises spellings
   * (`normalise_civil_status`), so the column converges on the four canonical values and
   * a fuzzy match here would only conflate them.
   */
  civil_status?: string;
}

export type StudentsPage = Page<StudentListItem>;

// ──────────────────────────────────────────────────────────────────────────────
// Programme registration + derived academic history (D30 §D12, brief §12/§27)
// ──────────────────────────────────────────────────────────────────────────────
export interface StudentProgramRefLite {
  id: string;
  code: string;
  name: string;
}

export type AcademicHistoryCourseStatus =
  | 'completed'
  | 'failed'
  | 'in_progress'
  | 'transferred'
  | 'remaining'
  // D35 — the client's `coursestatus` buckets. Neither earns credit and neither enters the
  // GPA on either side of the fraction.
  | 'audited'
  | 'withdrawn';

export interface ProgramChangePayload {
  program_id: string;
  /** Defaults to today server-side. The outgoing programme closes the day before. */
  effective_from?: string | null;
  reason?: string | null;
  year_of_study?: YearOfStudy | null;
  enrollment_load?: 'Part Time' | 'Full Time' | 'Transient' | null;
}

export interface ProgramHistoryEntry {
  id: string;
  program: StudentProgramRefLite;
  started_at: string;
  /** null = CURRENT. At most one open row per student, enforced by the database. */
  ended_at: string | null;
  reason: string | null;
  is_current: boolean;
}

export interface StudentProgramRef {
  student_id: string;
  program: StudentProgramRefLite | null;
  year_of_study: YearOfStudy | null;
  enrollment_load: 'Part Time' | 'Full Time' | 'Transient' | null;
  history: ProgramHistoryEntry[];
}

export interface AcademicHistoryCourse {
  course_id: string;
  code: string;
  name: string;
  credits: number | null;
  /** Curriculum POSITION in the plan ("Semester 1"), never a dated term (§D3). */
  term_label: string | null;
  term_order: number | null;
  is_required: boolean;
  /**
   * False for a course the student took that the CURRENT programme does not list. After a
   * programme change that is the honest reading of work which no longer counts toward the
   * award — the grade is untouched, it simply stops being a requirement.
   */
  in_curriculum: boolean;
  status: AcademicHistoryCourseStatus;
  numeric: number | null;
  letter: string | null;
  grade_point: number | null;
  is_frozen: boolean;
  semester_id: string | null;
}

export interface AcademicHistoryCounts {
  completed: number;
  failed: number;
  in_progress: number;
  transferred: number;
  remaining: number;
  /** D35 — the client's `coursestatus` buckets. Keyed to match `STATUS_META`. */
  audited: number;
  withdrawn: number;
}

/**
 * GET /students/{id}/academic-history — **entirely derived** (§D12).
 *
 * Recomputed on every read from enrolments, frozen snapshots, approved credit transfers and
 * the programme curriculum. Nothing is cached as truth, so a corrected grade shows at once.
 */
export interface AcademicHistory {
  student_id: string;
  full_name: string;
  student_number: string;
  program: StudentProgramRefLite | null;
  year_of_study: YearOfStudy | null;
  enrollment_load: 'Part Time' | 'Full Time' | 'Transient' | null;
  /** As PRINTED on the programme sequence (86–102 for the BAJC awards). */
  program_total_credits: number | null;
  /** Summed from the curriculum's required rows. Compared against the printed total. */
  curriculum_required_credits: number;
  credits_earned: number;
  credits_remaining: number;
  /** Cumulative, from the single `calc.compute_gpa`. Transferred credit is excluded. */
  gpa: number | null;
  gpa_total_credits: number;
  counts: AcademicHistoryCounts;
  courses: AcademicHistoryCourse[];
  program_history: ProgramHistoryEntry[];
  active_semester_id: string | null;
}

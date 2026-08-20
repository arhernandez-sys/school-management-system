/**
 * Students module wire types (api-spec §5 Module 3).
 *
 * These mirror the exact snake_case shapes the demo MSW handler returns
 * (handlers/students.ts), which in turn match the api-spec §5.3 response models. The
 * enums are re-used from the shared vocabulary so the feature can never drift from the
 * role/status sets the real backend uses.
 */
import type { CourseRef, OfferingRef, Page } from '@shared/types/api';
import type { StudentStatus, AssessmentType, GradeStatus } from '@shared/types/enums';

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
}

/** GET /students/{id}, /me, POST, PATCH, POST /status. */
export interface StudentDetail extends StudentNameParts {
  id: string;
  student_number: string;
  date_of_birth: string;
  gender: 'male' | 'female';
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
  current_offerings: OfferingRef[];
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

/** Create/update payload (StudentCreate; all optional on PATCH). */
export interface StudentWritePayload {
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
  gender?: 'male' | 'female';
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
  | 'remaining';

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

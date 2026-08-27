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
import type { EnrollmentStatus } from '@features/offerings/types';
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
  District,
  EnrollmentLoad,
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
  /**
   * D30 §D3 — the KIND of calendar term. BAJC runs Summer and Spring blocks, not just
   * two symmetrical semesters. NOT a curriculum position: "Semester 1" in a
   * programme's PLAN is `DemoProgramCourse.term_label`, a different fact.
   */
  term_type: 'summer' | 'semester' | 'spring';
  /** 1-based, unique within the year. The old `1 | 2` cap went with D30. */
  sequence: number;
  start_date: string;
  end_date: string;
  /**
   * Brief §18 — the Lecturer grade-entry cutoff, i.e. the END-TERM deadline (D32-1).
   * Read-only until Phase 3 (§D6).
   */
  grade_submission_deadline: string | null;
  /**
   * D32 — the mid-term grading window. Both null = this term has no mid-term period, and
   * neither grade revisions nor a mid-term report card are available for it.
   */
  midterm_submission_start: string | null;
  midterm_submission_end: string | null;
  is_active: boolean;
}

/**
 * One requirement standing in front of a course (D30 §D4).
 *
 * Replaces `courses.prerequisites varchar(50)`, which was free text with no FK —
 * `EDUC2305 ← EDUC1210, 2226, 2228, 2330, 2334, 2336` did not fit in it, and
 * `EDUC3201 ← ALL COURSES` could not be said at all.
 *
 * `requirement_type: 'all_program_courses'` is the Internship gate: it keeps meaning
 * "everything the programme requires" as the curriculum changes.
 */
export interface DemoCoursePrerequisite {
  id: string;
  course_id: string;
  /** NULL for `all_program_courses`. */
  prerequisite_course_id: string | null;
  /** NULL = applies wherever the course is taken. */
  program_id: string | null;
  requirement_type: 'course' | 'all_program_courses';
}

// ── Programmes / studies + curriculum (D30 §D3) ─────────────────────────────────
export interface DemoProgram {
  id: string;
  code: string; // e.g. BMAD — printed on the report card
  name: string;
  award: string | null;
  /** Total credits as printed on the course sequence (BAJC: 86–102). */
  total_credits: number | null;
  /**
   * The pass mark AS A GRADE POINT, per programme (§D5) — 2.50 (C+) everywhere except
   * Primary Education, which is 2.00 (C). Serialised as a string, like the API's
   * Decimal. It cannot live on the grading scale, whose pass mark is one number per
   * ACADEMIC YEAR.
   */
  min_passing_grade_point: string;
  is_active: boolean;
}

/**
 * One course's position in one programme's plan.
 *
 * ⚠️ `term_label` is a CURRICULUM POSITION, not a calendar term — see `DemoSemester`.
 * `term_order` drives display order because "Spring 1" sorts before "Summer 1"
 * alphabetically, so the label can never be the ordering key.
 */
export interface DemoProgramCourse {
  id: string;
  program_id: string;
  course_id: string;
  term_label: string;
  term_order: number;
  is_required: boolean;
}

// ── Course catalog (api-spec §5b) ───────────────────────────────────────────────
/** D31 renamed this from `DemoSubject`, with `/subjects` → `/courses`. */
export interface DemoCourse {
  id: string;
  name: string;
  /**
   * D30: NOT nullable. `courses.code` is NOT NULL and a BAJC course is identified by
   * its code on every programme sequence and on the report card.
   */
  code: string;
  /**
   * D30 §D2 — the field the whole catalog cutover was for. Until a stored grade could
   * reach a credit value, credit-weighted GPA and credits-earned were impossible
   * (plan §B3). Real per-course values, from the BAJC 26/27 sequences.
   */
  credits: number;
  component: 'GEC' | 'SEC' | 'CEC' | null;
  is_active: boolean;
}

// ── Course offerings (D31) ──────────────────────────────────────────────────────
/**
 * One COURSE OFFERING — "MATH1110-01, Semester 1".
 *
 * **This ONE row replaces the two D29 tables**, `DemoSection` (which mapped to `classes`,
 * a homeroom scoped to an academic YEAR) and `DemoClassSubject` (the join that existed only
 * because a homeroom taught ~7 subjects). One offering teaches one course, so the join
 * collapsed to a column and the two ids collapsed to one.
 *
 * What went, and why each mattered:
 *  - **`name`** — an offering stores none. Its label derives from course code + section +
 *    term, and it is derived in ONE place (`offeringLabel` in the selectors) exactly as the
 *    server derives it in `offerings/labels.py`. Storing it would be a second home for one
 *    fact, and the demo would then be able to disagree with the API about what a thing is
 *    called.
 *  - **`grade_level`** — the Form the homeroom was for. `varchar(50) NOT NULL`, so every
 *    offering had to declare one even where the concept did not apply.
 *  - **`section`** / **`homeroom_label`** — the division letter and its display label.
 *    `section_code` is a different thing: "01"/"02" for PARALLEL SECTIONS of one course.
 *  - **`academic_year_id`** — replaced by `semester_id`. This is the whole point of D31: a
 *    year-scoped row cannot say "MATH1110 runs in Semester 1 AND again in Semester 2".
 *
 * Identity is `(course_id, semester_id, section_code)`, and a NULL `section_code` counts as
 * a section — so two unsectioned offerings of one course in one term collide, matching the
 * `COALESCE` in the real unique index.
 */
export interface DemoOffering {
  id: string;
  course_id: string;
  /** Replaces `academic_year_id`. The year is a hop through the semester. */
  semester_id: string;
  /** "01", "02" for parallel sections; null when the course has only one. */
  section_code: string | null;
  capacity: number | null;
  is_archived: boolean;
  /** Assigned lecturer(s); the lead is named separately, not implied by position. */
  teacher_ids: string[];
  lead_teacher_id: string | null;
  /** Lecturer-set stored drop-lowest fallback (D25); 0 = none. */
  drop_lowest_count: number;
}

// ── Weekly meetings: when and where an offering meets ───────────────────────────
export interface DemoOfferingMeeting {
  id: string;
  offering_id: string;
  day_of_week: 1 | 2 | 3 | 4 | 5; // ISO: 1 = Mon … 5 = Fri
  start_time: string; // "HH:MM:SS"
  end_time: string;
  /** Per MEETING: one course can meet in a lecture room Monday and a lab Wednesday. */
  room: string | null;
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
  /** Renamed from `education` by D39 (Meeting #2 item 10). */
  academic_qualification?: string;
  designation?: string;
  address?: string;
  expertise?: { area: string; level: number }[];
  // Employment record (D39, Meeting #2 item 10). `is_employed` is NOT stored here — the
  // handler derives it from `status` on read, mirroring what the server does, so the two
  // cannot drift in the demo any more than they can in production.
  first_name?: string;
  last_name?: string;
  ssno?: string;
  licensenum?: string;
  hire_date?: string | null;
  end_date?: string | null;
  comments?: string;
}

// ── Students ────────────────────────────────────────────────────────────────────
export interface DemoStudent {
  id: string;
  user_id: string | null;
  student_number: string;
  /**
   * D30 §D10 — the parts are the stored truth; the API computes `full_name` from
   * them and demo mode does the same, so a screen certified here cannot disagree
   * with the real backend about what a student is called or how a list is ordered.
   * `first_name` is nullable only for legacy single-token names.
   */
  first_name: string | null;
  middle_name: string | null;
  last_name: string;
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  gender: 'male' | 'female';
  /**
   * D32 (brief §3) — free text, collected on the admissions form and copied onto the
   * student on acceptance. Nullable because most records have never been through
   * admissions: on the live database it is NULL for all 45 students today.
   */
  religion: string | null;
  enrollment_date: string;
  status: StudentStatus;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  address: string;
  phone: string;
  /**
   * The student's own level. D30 renamed this from `year_group` and narrowed it to
   * `enum('First','Second')` — the two BAJC years — so free text is off-contract. It is no
   * longer distinct from anything on an offering, because an offering has no level at all.
   */
  year_of_study: 'First' | 'Second' | null;
  /**
   * The BAJC programme the student is registered on (D30 §D12). Real on the demo
   * dataset from Phase 2D so programme-scoped rules — the per-programme pass mark and
   * the `ALL COURSES` gate — are visible rather than theoretical.
   *
   * The BACKEND does not set this yet: assigning a student to a programme, with
   * `student_program_history` so a change never destroys history, is Phase 4.
   */
  program_id: string | null;
  /**
   * D33 (client asks 3 + 4) — Sections A–E of the admission form, which
   * `student_profiles` has carried since `005_tertiary.sql`. Demo mode has to hold them
   * too: the student form now writes them and the profile displays them, and the last two
   * times a field lived in only one of the two implementations, demo mode certified a
   * screen the real backend did not serve.
   *
   * All nullable, because most records have never been through admissions — the same
   * reason `religion` above is.
   */
  ssno: string | null;
  civil_status: string | null;
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
  // ── D34 · reconciled from the CLIENT'S own schema (migration 011) ─────────
  /** The ID this record carried in the system it was imported from. */
  student_id_original: number | null;
  /**
   * The student's OWN email. **NOT the login** — that is on the linked `users` row and is
   * served as `StudentDetail.login_email`. Before D34 the student record had no email
   * column at all, so a paper registration had nowhere to record a contact address.
   */
  email: string | null;
  transferred_from: string | null;
  graduation_date: string | null;
  dropout_date: string | null;
  dropout_reason: string | null;
  comments: string | null;
  origin: string | null;
  /** Client-tooling columns: no FK, no consumer. Mirrored so the shape matches. */
  educationbg_id: string | null;
  doc_id: number | null;
  /**
   * NOTE: there is deliberately no `section_id`/`offering_id` here. It was a convenience
   * denormalization of "the student's ONE current section", and a student sits many
   * offerings — any single-offering field would be an arbitrary pick. Enrollment is read
   * from `enrollments` (see `offeringsForStudent` in selectors).
   */
}

// ── Enrollment: student ↔ offering for a semester ────────────────────────────────
export interface DemoEnrollment {
  id: string; // enrollment_id
  student_id: string;
  offering_id: string;
  semester_id: string;
  enrolled_at: string; // RFC3339
  unenrolled_at: string | null; // null = active member
  /**
   * D35 — the client's `coursestatus`: HOW the student is sitting the offering.
   *
   * `audit` and both `withdraw_*` values mean no credit and out of the GPA, and the
   * transcript prints `AU` / `W/P` / `W/F` instead of a grade. Distinct from
   * `unenrolled_at`, which means the registration was undone: a withdrawal KEEPS the row,
   * because the transcript has to show the course.
   */
  enrollment_status: EnrollmentStatus;
}

// ── Assessment categories (optional weighting groups) ───────────────────────────
export interface DemoAssessmentCategory {
  id: string;
  offering_id: string;
  name: string; // e.g. "Quizzes"
  weight: number; // 0..1 relative weight
  drop_lowest_count: number;
}

// ── Assessments (assessment-first) ──────────────────────────────────────────────
export interface DemoAssessment {
  id: string;
  offering_id: string;
  /**
   * Kept alongside `offering_id` even though it is now derivable from it — the real schema
   * keeps it too, because `term_grade_snapshots` is a frozen record where denormalisation
   * is correct and dropping it from assessments would widen the refactor.
   */
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

// ── Attendance (per-offering, per-day) ──────────────────────────────────────────
export interface DemoAttendanceRecord {
  id: string;
  offering_id: string;
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
  /**
   * The `'class'` member of the enum is KEPT on purpose: it is a wire value shared by the
   * ORM, the API and these handlers, and renaming an enum member is a migration, not a
   * relabel. The TARGET it points at is an offering now.
   */
  audience: AnnouncementAudience;
  offering_id: string | null; // required iff audience=class
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
  /**
   * Inclusive ceiling. NEVER read when resolving a letter — `letterFor` is half-open on
   * `min_score`, mirroring `calc.letter_for` (OQ-DB2). The BAJC scale's integer ceilings
   * (A- is 90-94) would otherwise leave 94.5 matching no band at all.
   */
  max_score: number;
  /** The band's value on the 4.00 scale (D30 §D5). Null = unpriced, NOT zero. */
  grade_point: number | null;
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
  /**
   * D32 (brief §4) — the Dean's student grade-visibility switch. Not a grading rule; it
   * shares this singleton because that is the row the Dean already edits.
   */
  students_can_view_grades: boolean;
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


// ── Admissions (D30 §D11, Phase 4) ──────────────────────────────────────────────
/**
 * One admission application — Sections A–G of the BAJC form plus the official-use block.
 *
 * Almost everything is nullable, and that is what a `draft` means: the Registrar
 * transcribes a paper form section by section, so a half-entered application has to be
 * representable. Completeness is asserted at the SUBMIT and ACCEPT transitions.
 */
export interface DemoApplication {
  id: string;
  status: 'draft' | 'submitted' | 'under_review' | 'accepted' | 'denied' | 'withdrawn';
  school_year: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  ssno: string | null;
  gender: string | null;
  civil_status: string | null;
  religion: string | null;
  phone: string | null;
  email: string | null;
  has_health_condition: boolean;
  health_condition_note: string | null;
  street: string | null;
  city_town_village: string | null;
  /**
   * D33 — narrowed from `string` to the `District` enum. The wizard has always written it
   * from a fixed select and the column is `enum(...)` server-side, so the loose type only
   * ever hid the fact that acceptance copies this onto the student record.
   */
  district: District | null;
  mother_name: string | null;
  father_name: string | null;
  nok_name: string | null;
  nok_relationship: string | null;
  nok_phone: string | null;
  atlib_exam: boolean;
  num_csec: number | null;
  finance_name: string | null;
  finance_phone: string | null;
  finance_email: string | null;
  recommendation_received: boolean;
  program_id: string | null;
  year_of_study: 'First' | 'Second' | null;
  enrollment_load: 'Part Time' | 'Full Time' | 'Transient' | null;
  applicant_signed_at: string | null;
  guardian_signed_at: string | null;
  // FOR OFFICIAL USE ONLY
  date_accepted: string | null;
  academic_year_id: string | null;
  enrolment_status: string | null;
  student_code: string | null;
  comments: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  /** The student this became. Set by acceptance — and what makes it detectably done. */
  student_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * D38 — a SAVED but UNSUBMITTED form (`student_profile_temp`).
 *
 * Not an application: it lives in its own table, `created_by` is its VISIBILITY (the
 * Registrar who filed it, plus the Dean), and Sections B and F ride as arrays because a
 * form that has never been promoted has no application id for the child tables to key on.
 *
 * Deliberately reuses `DemoApplication`'s Sections A–G and drops the five columns the
 * ACCEPT transition writes — a pending form has no decision and no student.
 */
export interface DemoApplicationTemp
  extends Omit<
    DemoApplication,
    'status' | 'date_accepted' | 'student_code' | 'decided_by_user_id' | 'decided_at' | 'student_id'
  > {
  status: 'pending';
  /** THE SCOPE. A Registrar sees only their own rows; the Dean sees all of them. */
  created_by: string;
  created_by_name: string;
  education: DemoApplicationEducation[];
  documents: DemoApplicationDocument[];
}

/**
 * Section B's repeating institution table.
 *
 * The table that fixes a real defect: the source dump had a SINGLE-valued
 * `student_profiles.educationbg_id` against a table with no student reference at all, so
 * an applicant who attended two institutions could not be recorded either way round.
 */
export interface DemoApplicationEducation {
  id: string;
  application_id: string;
  institution: string;
  education_level: 'High School' | 'Tertiary';
  graduated: boolean;
  graduation_date: string | null;
  sort_order: number;
}

/**
 * Section F's checklist row. **A tick-list, not a file** — object storage is not
 * provisioned (OQ-DB5) and Section F on paper is a checklist. `received` is what carries
 * meaning; the file metadata is for when uploads land.
 */
export interface DemoApplicationDocument {
  id: string;
  application_id: string;
  document_type:
    | 'passport_photo'
    | 'hs_diploma'
    | 'recommendation_form'
    | 'social_security_card'
    | 'course_outline'
    | 'transcript'
    | 'cta'
    | 'other';
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  received: boolean;
}

/**
 * A credit-transfer request (brief §13). **Anchored on the APPLICATION**, because policy
 * allows it only at entrance — when no student record exists yet. Approval requires ≥75%
 * content equivalency and is the **Dean's** decision alone.
 */
export interface DemoCreditTransferRequest {
  id: string;
  application_id: string;
  external_institution: string;
  external_course_code: string | null;
  external_course_name: string;
  external_credits: number | null;
  external_grade: string | null;
  target_course_id: string;
  content_equivalency_pct: number | null;
  cta_document_id: string | null;
  transcript_document_id: string | null;
  outline_document_id: string | null;
  status: 'pending' | 'approved' | 'denied';
  decided_by_user_id: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
}

/**
 * One programme registration period (§D12). `ended_at === null` means CURRENT, and there
 * is at most ONE open row per student — in the real database that is enforced by a unique
 * index over a generated `open_flag`, which is why a change closes before it opens.
 */
export interface DemoStudentProgramHistory {
  id: string;
  student_id: string;
  program_id: string;
  started_at: string;
  ended_at: string | null;
  reason: string | null;
}


// ── Grade revision / second opportunity (D30 §D7, Phase 5) ──────────────────────
/**
 * A Lecturer's request to revise one grade, and the Dean's ruling on it.
 *
 * The second-attempt SCORE was always representable — `makeup_score` on the grade row. What
 * had nowhere to live was the request: who asked, why, what they proposed, who decided.
 *
 * **The original score is never overwritten.** `original_score` is what the student had when
 * the request was filed; on approval `proposed_score` is written to the grade's
 * `makeup_score` and its `score` is left alone. In the real schema a generated
 * `pending_flag` under a unique index limits a grade to ONE open request; demo mode enforces
 * the same rule in the handler.
 */
export interface DemoGradeRevisionRequest {
  id: string;
  assessment_grade_id: string;
  requested_by_user_id: string;
  reason: string;
  original_score: number | null;
  proposed_score: number;
  status: 'pending' | 'approved' | 'denied';
  decided_by_user_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

// ── The whole dataset (one object) ──────────────────────────────────────────────
export interface DemoDataset {
  school_profile: DemoSchoolProfile;
  academic_years: DemoAcademicYear[];
  semesters: DemoSemester[];
  courses: DemoCourse[];
  programs: DemoProgram[];
  program_courses: DemoProgramCourse[];
  course_prerequisites: DemoCoursePrerequisite[];
  offerings: DemoOffering[];
  teachers: DemoTeacher[];
  students: DemoStudent[];
  offering_meetings: DemoOfferingMeeting[];
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
  // D30 §D11/§D12 — admissions and the programme history acceptance opens.
  applications: DemoApplication[];
  /** D38 — saved-but-unsubmitted forms, scoped by `created_by`. */
  application_temp: DemoApplicationTemp[];
  application_education: DemoApplicationEducation[];
  application_documents: DemoApplicationDocument[];
  credit_transfer_requests: DemoCreditTransferRequest[];
  student_program_history: DemoStudentProgramHistory[];
  // D30 §D7 — the grade-revision approval workflow.
  grade_revision_requests: DemoGradeRevisionRequest[];
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

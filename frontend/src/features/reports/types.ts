/**
 * Reports module types (Phase 7 / demo). These describe the wire shapes the Reports
 * MSW handlers return (handlers/reports.ts). Wire format is snake_case (api-spec §1.2).
 */
// D45 Phase 9 — the institutional reports name offerings, and an offering ref is a
// SHARED wire shape (`shared/types/api.ts`). Re-declaring it here would be a second
// home for the same fact, which is the exact thing D31 collapsed five refs to avoid.
import type { OfferingRef } from '@shared/types/api';

export type { OfferingRef };

export type GradeReportStatus = 'graded' | 'pending';

/**
 * The student as printed on a report card / transcript / picker row.
 *
 * D29 replaced `section_id` / `section_name` / `grade_level` — all read off the student's
 * homeroom — with the student's own level, which **D30 renamed `year_of_study`** and
 * narrowed to `enum('First','Second')`. A college student sits many courses, so there is no
 * single class whose name could head their card.
 */
export interface StudentRef {
  id: string;
  full_name: string;
  student_number: string;
  date_of_birth: string;
  status: string;
  year_of_study: string | null;
}

export interface SchoolIdentity {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string | null;
}

export interface SemesterRef {
  id: string;
  name: string;
  sequence: number;
  academic_year_id: string;
  academic_year_name: string;
}

export interface SubjectRef {
  id: string;
  name: string;
  code: string;
}

// ── Student picker ─────────────────────────────────────────────────────────────
export interface StudentPickerPage {
  items: StudentRef[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ── Report card ──────────────────────────────────────────────────────────────────
export interface ReportCardSubjectRow {
  subject: SubjectRef;
  /** Printed as "Instructor" on the BAJC layout (D30 §D13). */
  teacher: string | null;
  /** The course's credit weight, and the weight behind `ReportCard.gpa` (D30 §D5). */
  credits: number | null;
  numeric: number | null;
  letter: string | null;
  status: GradeReportStatus;
}

export interface AttendanceSummary {
  pct_present: number;
  absent: number;
  late: number;
  excused: number;
}

/** D32 — the two report kinds. Mirrors `app/common/enums.py::ReportCardKind`. */
export type ReportCardKind = 'midterm' | 'endterm';

export interface ReportCard {
  student: StudentRef;
  /**
   * The student's level — "First" or "Second". Replaced the old `section` block: the card
   * covers every course they sit in the term, so there is no one class to name (D29).
   */
  year_of_study: string | null;
  semester: SemesterRef;
  school: SchoolIdentity;
  /**
   * The programme CODE, e.g. "BMAD" — the BAJC layout's `Program` label (D30 §D13).
   * Null only for a student with no programme registration; every seeded demo student
   * carries one (§D12), so the document prints it.
   */
  program_code: string | null;
  /** `"<Term>, <Mon YYYY> - <Mon YYYY>"`, e.g. "Summer, July 2026 - August 2026". */
  period: string | null;
  /** The layout's `Block` label. Always null — its meaning is unconfirmed (plan §G item 3). */
  block: string | null;
  subjects: ReportCardSubjectRow[];
  attendance_summary: AttendanceSummary;
  term_average: number | null;
  term_average_letter: string | null;
  /**
   * Credit-weighted GPA on the 4.00 scale (D30 §D5): total quality points over ALL
   * enrolled credits, with ungraded courses contributing 0 points and their full
   * credits. Sits BESIDE `term_average`, which is a 0-100 percentage — they answer
   * different questions. Null when no credits participated.
   */
  gpa: number | null;
  total_credits: number;
  is_frozen: boolean;
  /**
   * D32 (brief §5) — which report this is.
   *
   * `midterm` is served VERBATIM from a `report_card_snapshots` payload and never
   * recalculates: it is the document as it stood when the mid-term window closed.
   * `endterm` computes from current grades while the year is live.
   */
  report_kind: ReportCardKind;
  /** When a frozen card was captured; null on a computed one. */
  frozen_at: string | null;
}

// ── Transcript ─────────────────────────────────────────────────────────────────
export interface TranscriptSubjectRow {
  subject: SubjectRef;
  teacher: string | null;
  credits: number | null;
  numeric: number | null;
  letter: string;
  /**
   * D35 — the registry notation for a course with no grade: `AU` (audited), `W/P`
   * (withdrew passing), `W/F` (withdrew failing). `null` on an ordinary graded row.
   *
   * When set, `numeric` and `letter` are empty and the row is out of the term average AND
   * the GPA. It is printed anyway, which is the point of recording the status.
   */
  notation: string | null;
}

export interface TranscriptSemester {
  semester: SemesterRef;
  is_current: boolean;
  term_average: number | null;
  /**
   * Term GPA. Weighted over every credit enrolled that term, including courses absent
   * from `subjects` because they never resolved to a grade — the transcript lists
   * graded lines only, but the denominator is all enrolled credits (D30 decision #4).
   */
  gpa: number | null;
  total_credits: number;
  subjects: TranscriptSubjectRow[];
}

export interface TranscriptYear {
  academic_year: { id: string; name: string; status: string };
  year_average: number | null;
  /** Recomputed from the year's own credits, NOT averaged from its terms' GPAs. */
  gpa: number | null;
  total_credits: number;
  semesters: TranscriptSemester[];
}

export interface Transcript {
  student: StudentRef;
  school: SchoolIdentity;
  /**
   * The programme the transcript is issued against (D39, Meeting #2 item 7).
   * `program_name` is sent alongside the code because this document is read by people
   * outside the school, to whom `BMAD` means nothing. Both null when the student has no
   * programme registration.
   */
  program_code: string | null;
  program_name: string | null;
  issued_at: string;
  years: TranscriptYear[];
  cumulative_average: number | null;
  /** Again recomputed from the underlying credits, not averaged per-year. */
  cumulative_gpa: number | null;
  total_credits: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// D45 Phase 9 — the four institutional reports of §53
//
// Different in kind from everything above. A report card is a document about ONE
// student, printed and handed over; these are management reports about the COLLEGE,
// read on screen to find the thing that needs attention.
//
// Every one of them carries a `note` — the server's plain-language statement of what
// the numbers mean. **RENDER IT.** A management report whose definition lives only in
// a service docstring is a report two people read two different ways in the same
// meeting, and the screen is the only place the reader will ever see it.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Who is looking, and how much of the college they were shown. A Head of Department
 * sees only the programmes they head, and the screen has to SAY so — an HOD reading
 * "3 classes over capacity" must not carry it out of the room as the college total.
 */
export interface ReportScope {
  is_scoped: boolean;
  programmes: string[];
}

// ── New versus returning (§53 Enrollment) ──────────────────────────────────────
export interface NewVsReturningProgrammeRow {
  programme: string;
  programme_code: string | null;
  new: number;
  returning: number;
  total: number;
}

/**
 * One session of the chosen year.
 *
 * ⚠️ `new` here answers a DIFFERENT question from the year total: it means *this is the
 * first session this student has ever registered in*. A student who started in Session 1
 * is new there and returning in Session 2 — of the same year. Both readings are
 * legitimate and both are shown; do not "reconcile" them.
 */
export interface NewVsReturningSemesterRow {
  semester: SemesterRef;
  new: number;
  returning: number;
  total: number;
}

export interface NewVsReturningStudentRow {
  student: StudentRef;
  programme: string | null;
  is_new: boolean;
  /** The year the student FIRST registered in — the evidence behind `is_new`. */
  first_registered_year: string | null;
}

export interface NewVsReturningReport {
  academic_year: { id: string; name: string; status: string };
  generated_at: string;
  new: number;
  returning: number;
  total: number;
  by_programme: NewVsReturningProgrammeRow[];
  by_semester: NewVsReturningSemesterRow[];
  students: NewVsReturningStudentRow[];
  scope: ReportScope;
  note: string;
}

// ── Over capacity (§53 Registration) ───────────────────────────────────────────
/** No `under`: classes with room are counted in `under_capacity`, never listed. */
export type OvercapacityBand = 'over' | 'at' | 'unset';

export interface OvercapacityRow {
  offering: OfferingRef;
  lecturer: string | null;
  capacity: number | null;
  registered: number;
  over_by: number;
  /** `null` when no capacity is set — a percentage of nothing is unanswerable, and
   *  rendering it as 0% would sort every unlimited class to the bottom of a list
   *  ordered by pressure. Show a dash. */
  utilisation_pct: number | null;
  band: OvercapacityBand;
}

export interface OvercapacityReport {
  semester: SemesterRef;
  generated_at: string;
  over: OvercapacityRow[];
  at_capacity: OvercapacityRow[];
  no_capacity_set: OvercapacityRow[];
  under_capacity: number;
  offerings_total: number;
  seats_total: number;
  registered_total: number;
  scope: ReportScope;
  note: string;
}

// ── Credit load (§53 Registration) ─────────────────────────────────────────────
export interface CreditLoadStudentRow {
  student: StudentRef;
  programme: string | null;
  /** What the student declared at admission — intent stated once, not a fact about
   *  this session. */
  declared_load: string | null;
  courses: number;
  credits: number;
  /** Included in `credits` (an audit is real work) and shown apart (it earns nothing). */
  audit_credits: number;
  /** Set only where the declaration and the credits contradict BAJC's own
   *  application-form rule. `null` is the normal case. */
  mismatch: string | null;
}

export interface CreditLoadBand {
  credits: number;
  students: number;
}

export interface CreditLoadByDeclared {
  declared_load: string;
  students: number;
  min_credits: number;
  max_credits: number;
  avg_credits: number;
  mismatches: number;
}

export interface CreditLoadReport {
  semester: SemesterRef;
  generated_at: string;
  students: number;
  credits_total: number;
  min_credits: number;
  max_credits: number;
  avg_credits: number;
  /** Echoed by the server so this screen never hardcodes the threshold. */
  full_time_credits: number;
  mismatches: number;
  by_declared_load: CreditLoadByDeclared[];
  distribution: CreditLoadBand[];
  rows: CreditLoadStudentRow[];
  scope: ReportScope;
  note: string;
}

// ── Programme attendance (§53 Attendance — the "department" report, C4) ────────
export interface ProgrammeAttendanceRow {
  programme: string;
  programme_code: string | null;
  programme_id: string | null;
  /** Students with at least one register taken — NOT the programme's headcount. */
  students: number;
  records: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  pct_present: number;
  /** Strictly below the college's configured floor, matching the alerts screen. Never
   *  true for a programme with no registers taken: 0% of nothing is unmarked, not
   *  failing. */
  below_floor: boolean;
  students_below_floor: number;
}

export interface ProgrammeAttendanceStudentRow {
  student: StudentRef;
  records: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  pct_present: number;
  below_floor: boolean;
}

export interface ProgrammeAttendanceReport {
  semester: SemesterRef;
  generated_at: string;
  floor_pct: number;
  by_programme: ProgrammeAttendanceRow[];
  /** Present only when one programme was asked for. */
  programme: ProgrammeAttendanceRow | null;
  students: ProgrammeAttendanceStudentRow[];
  records_total: number;
  pct_present: number;
  scope: ReportScope;
  note: string;
}

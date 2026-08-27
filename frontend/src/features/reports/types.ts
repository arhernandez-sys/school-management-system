/**
 * Reports module types (Phase 7 / demo). These describe the wire shapes the Reports
 * MSW handlers return (handlers/reports.ts). Wire format is snake_case (api-spec §1.2).
 */

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

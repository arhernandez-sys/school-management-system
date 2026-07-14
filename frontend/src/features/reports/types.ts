/**
 * Reports module types (Phase 7 / demo). These describe the wire shapes the Reports
 * MSW handlers return (handlers/reports.ts). Wire format is snake_case (api-spec §1.2).
 */

export type GradeReportStatus = 'graded' | 'pending';

export interface StudentRef {
  id: string;
  full_name: string;
  student_number: string;
  date_of_birth: string;
  status: string;
  section_id: string | null;
  section_name: string | null;
  grade_level: string | null;
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
  teacher: string | null;
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

export interface ReportCard {
  student: StudentRef;
  section: { id: string; name: string; grade_level: string } | null;
  semester: SemesterRef;
  school: SchoolIdentity;
  subjects: ReportCardSubjectRow[];
  attendance_summary: AttendanceSummary;
  term_average: number | null;
  term_average_letter: string | null;
  is_frozen: boolean;
}

// ── Transcript ─────────────────────────────────────────────────────────────────
export interface TranscriptSubjectRow {
  subject: SubjectRef;
  teacher: string | null;
  numeric: number | null;
  letter: string;
}

export interface TranscriptSemester {
  semester: SemesterRef;
  is_current: boolean;
  term_average: number | null;
  subjects: TranscriptSubjectRow[];
}

export interface TranscriptYear {
  academic_year: { id: string; name: string; status: string };
  year_average: number | null;
  semesters: TranscriptSemester[];
}

export interface Transcript {
  student: StudentRef;
  school: SchoolIdentity;
  issued_at: string;
  years: TranscriptYear[];
  cumulative_average: number | null;
}

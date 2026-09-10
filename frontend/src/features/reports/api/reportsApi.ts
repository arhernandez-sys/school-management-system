/**
 * Reports API calls over the shared axios client (`@shared/api/client`). The Reports
 * endpoints are not part of the generated client, so these thin functions type the
 * responses and are consumed by the TanStack Query hooks in `../hooks/useReports`.
 */
import { api } from '@shared/api/client';
import type {
  CreditLoadReport,
  NewVsReturningReport,
  OvercapacityReport,
  ProgrammeAttendanceReport,
  ReportCard,
  ReportCardKind,
  SemesterRef,
  StudentPickerPage,
  Transcript,
} from '../types';

/** A term option for the report-card term picker. */
export interface TermOption {
  id: string;
  name: string;
  sequence: number;
  academic_year_id: string;
  is_active: boolean;
}

/** Semesters for the active year (backs the term picker). Uses the Settings endpoint. */
export async function fetchSemesters(academicYearId?: string): Promise<TermOption[]> {
  const res = await api.get<{ items: TermOption[] }>('/settings/semesters', {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
  });
  return res.data.items;
}

/** The active academic term (active year + semester). Used to default the term picker. */
export async function fetchActiveTerm(): Promise<{
  academic_year: { id: string; name: string; status: string };
  semester: SemesterRef | { id: string; name: string; sequence: number; is_active: boolean };
}> {
  const res = await api.get('/settings/active-term');
  return res.data;
}

export interface StudentPickerParams {
  search?: string;
  page?: number;
  page_size?: number;
  status?: string;
}

export async function fetchReportStudents(params: StudentPickerParams): Promise<StudentPickerPage> {
  const res = await api.get<StudentPickerPage>('/reports/students', { params });
  return res.data;
}

/**
 * D32 — `kind` is sent explicitly rather than omitted for the default, so a request is
 * self-describing in the network log. The server defaults to `endterm` either way.
 */
export async function fetchReportCard(
  studentId: string,
  semesterId?: string,
  kind: ReportCardKind = 'endterm',
): Promise<ReportCard> {
  const res = await api.get<ReportCard>('/reports/report-card', {
    params: {
      student_id: studentId,
      kind,
      ...(semesterId ? { semester_id: semesterId } : {}),
    },
  });
  return res.data;
}

export async function fetchMyReportCard(
  semesterId?: string,
  kind: ReportCardKind = 'endterm',
): Promise<ReportCard> {
  const res = await api.get<ReportCard>('/reports/report-card/me', {
    params: { kind, ...(semesterId ? { semester_id: semesterId } : {}) },
  });
  return res.data;
}

export async function fetchTranscript(studentId: string): Promise<Transcript> {
  const res = await api.get<Transcript>('/reports/transcript', {
    params: { student_id: studentId },
  });
  return res.data;
}

// ── D45 Phase 9 — the four institutional reports of §53 ───────────────────────
// Dean / Registrar / Auditor read the college; a Head of Department reads their own
// programmes, and the server narrows them — this client sends nothing to say so and
// must not try to. Every response carries `scope`; the screen renders it.

/** Intake for one academic year. Omit the year for the active one. */
export async function fetchNewVsReturning(academicYearId?: string): Promise<NewVsReturningReport> {
  const res = await api.get<NewVsReturningReport>('/reports/new-vs-returning', {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
  });
  return res.data;
}

/** Classes past their capacity in one session. Omit the session for the active one. */
export async function fetchOvercapacity(semesterId?: string): Promise<OvercapacityReport> {
  const res = await api.get<OvercapacityReport>('/reports/overcapacity', {
    params: semesterId ? { semester_id: semesterId } : undefined,
  });
  return res.data;
}

/** Credits each student is carrying this session. */
export async function fetchCreditLoad(semesterId?: string): Promise<CreditLoadReport> {
  const res = await api.get<CreditLoadReport>('/reports/credit-load', {
    params: semesterId ? { semester_id: semesterId } : undefined,
  });
  return res.data;
}

/**
 * Attendance per programme — §53's "department" report (D45 decision C4: there is no
 * `departments` table and a programme is the unit BAJC has).
 *
 * `programId` drills into one programme and adds its per-student rows. An HOD may only
 * drill into a programme they head; the server answers 403 otherwise.
 */
export async function fetchProgrammeAttendance(
  semesterId?: string,
  programId?: string,
): Promise<ProgrammeAttendanceReport> {
  const res = await api.get<ProgrammeAttendanceReport>('/reports/programme-attendance', {
    params: {
      ...(semesterId ? { semester_id: semesterId } : {}),
      ...(programId ? { program_id: programId } : {}),
    },
  });
  return res.data;
}

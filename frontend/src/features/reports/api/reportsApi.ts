/**
 * Reports API calls over the shared axios client (`@shared/api/client`). The Reports
 * endpoints are not part of the generated client, so these thin functions type the
 * responses and are consumed by the TanStack Query hooks in `../hooks/useReports`.
 */
import { api } from '@shared/api/client';
import type {
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

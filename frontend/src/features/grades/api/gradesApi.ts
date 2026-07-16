/**
 * Grades transport — thin wrappers over the shared axios client (Bearer + refresh +
 * credentialed cookie live there). The demo's MSW grades handler answers these paths.
 * Keeping the transport here lets the hooks own query-key identity + cache invalidation.
 */
import { api } from '@shared/api/client';
import type {
  ClassSubjectOptionsResponse,
  Gradebook,
  GradeEntry,
  GradeEntryResponse,
  MyGrades,
} from '../types';

/** GET /grades/class-subjects — the role-scoped gradebook picker (year-scoped). */
export async function fetchClassSubjectOptions(
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<ClassSubjectOptionsResponse> {
  const res = await api.get<ClassSubjectOptionsResponse>('/grades/class-subjects', {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** GET /grades/class-subject/{id} — the gradebook grid. */
export async function fetchGradebook(classSubjectId: string, signal?: AbortSignal): Promise<Gradebook> {
  const res = await api.get<Gradebook>(`/grades/class-subject/${classSubjectId}`, { signal });
  return res.data;
}

/** PUT /assessments/{id}/grades — bulk enter/update one assessment column. */
export async function saveAssessmentGrades(
  assessmentId: string,
  entries: GradeEntry[],
): Promise<GradeEntryResponse> {
  const res = await api.put<GradeEntryResponse>(`/assessments/${assessmentId}/grades`, { entries });
  return res.data;
}

/** POST /assessments/{id}/release | /unrelease — release control. */
export async function setAssessmentRelease(
  assessmentId: string,
  release: boolean,
): Promise<{ assessment_id: string; is_released: boolean; released_count: number }> {
  const path = release ? 'release' : 'unrelease';
  const res = await api.post<{ assessment_id: string; is_released: boolean; released_count: number }>(
    `/assessments/${assessmentId}/${path}`,
  );
  return res.data;
}

/** GET /grades/me — the student's own released grades. */
export async function fetchMyGrades(signal?: AbortSignal): Promise<MyGrades> {
  const res = await api.get<MyGrades>('/grades/me', { signal });
  return res.data;
}

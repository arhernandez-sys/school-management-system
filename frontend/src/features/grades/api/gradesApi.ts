/**
 * Grades transport — thin wrappers over the shared axios client (Bearer + refresh +
 * credentialed cookie live there). The demo's MSW grades handler answers these paths.
 * Keeping the transport here lets the hooks own query-key identity + cache invalidation.
 *
 * **D31 re-pathed two of these.** `/grades/class-subjects` → `/grades/offerings` and
 * `/grades/class-subject/{id}` → `/grades/offering/{id}`: the old paths named the
 * `class_subjects` join table, which no longer exists.
 */
import { api } from '@shared/api/client';
import type {
  Gradebook,
  GradeEntry,
  GradeEntryResponse,
  MyGrades,
  OfferingOptionsResponse,
} from '../types';

/** GET /grades/offerings — the role-scoped gradebook picker (year-scoped). */
export async function fetchOfferingOptions(
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<OfferingOptionsResponse> {
  const res = await api.get<OfferingOptionsResponse>('/grades/offerings', {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** GET /grades/offering/{id} — the gradebook grid. */
export async function fetchGradebook(offeringId: string, signal?: AbortSignal): Promise<Gradebook> {
  const res = await api.get<Gradebook>(`/grades/offering/${offeringId}`, { signal });
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

/**
 * GET /grades/me — the student's own released grades, scoped to the selected period.
 *
 * With `semesterId` supplied the term average is computed from that semester's rows
 * ONLY, so the number matches the assessments listed beside it; omitted, the response
 * spans the whole year as before. Both params are dropped when undefined so the request
 * never carries an empty value.
 */
export async function fetchMyGrades(
  academicYearId?: string,
  semesterId?: string,
  signal?: AbortSignal,
): Promise<MyGrades> {
  const params: Record<string, string> = {};
  if (academicYearId) params.academic_year_id = academicYearId;
  if (semesterId) params.semester_id = semesterId;
  const res = await api.get<MyGrades>('/grades/me', {
    params: Object.keys(params).length ? params : undefined,
    signal,
  });
  return res.data;
}

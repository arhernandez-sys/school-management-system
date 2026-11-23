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
  AssessmentReport,
  AssessmentReportParams,
  Gradebook,
  GradeEntry,
  GradeEntryResponse,
  MyGrades,
  OfferingOptionsResponse,
  ReopenDecisionPayload,
  ReopenRequest,
  ReopenRequestList,
  ReopenRequestStatus,
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

/**
 * GET /grades/assessment-report — the printable report (D47). The Dean filters freely; a
 * lecturer always gets only their own offerings, whatever is passed. Empty params are
 * dropped so the request never carries a blank value.
 */
export async function fetchAssessmentReport(
  params: AssessmentReportParams,
  signal?: AbortSignal,
): Promise<AssessmentReport> {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => Boolean(v)));
  const res = await api.get<AssessmentReport>('/grades/assessment-report', {
    params: clean,
    signal,
  });
  return res.data;
}

/** POST /assessments/{id}/reopen-requests — the lecturer asks the Dean (D47). */
export async function requestReopen(assessmentId: string, reason: string): Promise<ReopenRequest> {
  const res = await api.post<ReopenRequest>(`/assessments/${assessmentId}/reopen-requests`, {
    reason,
  });
  return res.data;
}

/** GET /assessment-reopen-requests — Dean: all; lecturer: their own. */
export async function fetchReopenRequests(
  status?: ReopenRequestStatus,
  signal?: AbortSignal,
): Promise<ReopenRequestList> {
  const res = await api.get<ReopenRequestList>('/assessment-reopen-requests', {
    params: status ? { status } : undefined,
    signal,
  });
  return res.data;
}

/** POST /assessment-reopen-requests/{id}/decision — Dean only. */
export async function decideReopen(
  requestId: string,
  payload: ReopenDecisionPayload,
): Promise<ReopenRequest> {
  const res = await api.post<ReopenRequest>(
    `/assessment-reopen-requests/${requestId}/decision`,
    payload,
  );
  return res.data;
}

/** DELETE /assessment-reopen-requests/{id} — the requester withdraws a pending one. */
export async function withdrawReopen(requestId: string): Promise<void> {
  await api.delete(`/assessment-reopen-requests/${requestId}`);
}

/**
 * GET /grades/me — the student's own grades, scoped to the selected period.
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

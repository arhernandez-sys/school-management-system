/**
 * Attendance transport — thin typed wrappers over the shared axios client.
 *
 * The shared `api` instance carries the Bearer + single-flight refresh + credentialed
 * cookie behavior; these functions just type the request/response for each attendance
 * endpoint. In the demo they hit the MSW handlers in handlers/attendance.ts.
 */
import { api } from '@shared/api/client';
import type {
  AttendanceRegister,
  AttendanceSectionsResponse,
  AttendanceSummaryResponse,
  AttendanceUpsertRequest,
  AttendanceUpsertResponse,
  MyAttendanceResponse,
} from '../types';

/** GET /attendance/sections — sections the caller may view/record (year-scoped). */
export async function getAttendanceSections(
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<AttendanceSectionsResponse> {
  const res = await api.get<AttendanceSectionsResponse>('/attendance/sections', {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** GET /attendance?section_id=&date= — the daily register. */
export async function getAttendanceRegister(
  params: { section_id: string; date: string },
  signal?: AbortSignal,
): Promise<AttendanceRegister> {
  const res = await api.get<AttendanceRegister>('/attendance', { params, signal });
  return res.data;
}

/** PUT /attendance — bulk upsert the register for one (section, date). */
export async function putAttendanceRegister(
  body: AttendanceUpsertRequest,
): Promise<AttendanceUpsertResponse> {
  const res = await api.put<AttendanceUpsertResponse>('/attendance', body);
  return res.data;
}

/** GET /attendance/summary?section_id= — per-section rate over the window. */
export async function getAttendanceSummary(
  sectionId: string,
  signal?: AbortSignal,
): Promise<AttendanceSummaryResponse> {
  const res = await api.get<AttendanceSummaryResponse>('/attendance/summary', {
    params: { section_id: sectionId },
    signal,
  });
  return res.data;
}

/**
 * GET /attendance/me — the signed-in student's own attendance, scoped to the selected
 * period. `semesterId` narrows within the year; the summary is then computed over the
 * same records as the history, so the percentage describes what is on screen.
 */
export async function getMyAttendance(
  academicYearId?: string,
  semesterId?: string,
  signal?: AbortSignal,
): Promise<MyAttendanceResponse> {
  const params: Record<string, string> = {};
  if (academicYearId) params.academic_year_id = academicYearId;
  if (semesterId) params.semester_id = semesterId;
  const res = await api.get<MyAttendanceResponse>('/attendance/me', {
    params: Object.keys(params).length ? params : undefined,
    signal,
  });
  return res.data;
}

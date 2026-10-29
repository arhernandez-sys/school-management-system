import { ApiError, api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type {
  StudentAssessmentsResponse,
  StudentDetail,
  StudentFilterOptions,
  StudentListItem,
  StudentWritePayload,
  StudentYear,
  StudentsListParams,
} from '../types';
import type { StudentStatus } from '@shared/types/enums';
import type { DocumentRow } from '@features/admissions/types';

/**
 * Students transport (api-spec §5 Module 3). Calls the shared axios `client` directly
 * (Bearer + single-flight refresh + credentialed cookie ride along) because the Students
 * endpoints aren't in the served OpenAPI yet, so there are no orval hooks. When codegen
 * catches up, swap the bodies for the generated operations — the hook layer and screens
 * won't change.
 */

/** GET /students — searchable, filterable, paginated directory. */
export async function listStudents(
  params: StudentsListParams,
  signal?: AbortSignal,
): Promise<Page<StudentListItem>> {
  const res = await api.get<Page<StudentListItem>>('/students', { params, signal });
  return res.data;
}

/**
 * GET /students/filter-options — the DISTINCT religions present in the directory (D32).
 *
 * Only religion is served: `gender` is a fixed pair and programmes come from `/programs`.
 */
export async function getStudentFilterOptions(
  signal?: AbortSignal,
): Promise<StudentFilterOptions> {
  const res = await api.get<StudentFilterOptions>('/students/filter-options', { signal });
  return res.data;
}

/** GET /students/{id} — full detail. `academicYearId` scopes the section to that year. */
export async function getStudent(
  id: string,
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<StudentDetail> {
  const res = await api.get<StudentDetail>(`/students/${id}`, {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** GET /students/{id}/years — academic years the student was enrolled in (newest first). */
export async function getStudentYears(id: string, signal?: AbortSignal): Promise<StudentYear[]> {
  const res = await api.get<{ items: StudentYear[] }>(`/students/${id}/years`, { signal });
  return res.data.items;
}

/**
 * GET /students/me — the acting student's own record.
 *
 * `academicYearId` scopes `current_section` to the section the caller sat in that year,
 * exactly as it does on `getStudent` above. WHICH student is read still comes from the
 * token alone (api-spec §3.2), so this narrows the caller's own record and can never
 * reach anyone else's.
 */
export async function getMyStudentRecord(
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<StudentDetail | null> {
  try {
    const res = await api.get<StudentDetail>('/students/me', {
      params: academicYearId ? { academic_year_id: academicYearId } : undefined,
      signal,
    });
    return res.data;
  } catch (err) {
    // A login not yet linked to a student record has nothing to show. That is an empty
    // page, not an error for the student; the 404 stays visible in devtools.
    if (err instanceof ApiError && err.code === 'no_student_profile') return null;
    throw err;
  }
}

/** GET /students/{id}/assessments — assessments grouped by subject, with term grades. */
export async function getStudentAssessments(
  id: string,
  academicYearId?: string,
  signal?: AbortSignal,
): Promise<StudentAssessmentsResponse> {
  const res = await api.get<StudentAssessmentsResponse>(`/students/${id}/assessments`, {
    params: academicYearId ? { academic_year_id: academicYearId } : undefined,
    signal,
  });
  return res.data;
}

/** POST /students — create a student profile (+ optional section enroll). */
export async function createStudent(body: StudentWritePayload): Promise<StudentDetail> {
  const res = await api.post<StudentDetail>('/students', body);
  return res.data;
}

/** PATCH /students/{id} — benign profile edits. */
export async function updateStudent(
  id: string,
  body: Partial<StudentWritePayload>,
): Promise<StudentDetail> {
  const res = await api.patch<StudentDetail>(`/students/${id}`, body);
  return res.data;
}

/** POST /students/{id}/status — lifecycle transition (422 invalid_transition). */
export async function setStudentStatus(id: string, status: StudentStatus): Promise<StudentDetail> {
  const res = await api.post<StudentDetail>(`/students/${id}/status`, { status });
  return res.data;
}

/** PUT /students/{id}/grades-withheld — the Dean's per-student grade hold. Dean only. */
export async function setGradesWithheld(
  id: string,
  withheld: boolean,
): Promise<{ student_id: string; grades_withheld: boolean }> {
  const res = await api.put<{ student_id: string; grades_withheld: boolean }>(
    `/students/${id}/grades-withheld`,
    { withheld },
  );
  return res.data;
}

/** DELETE /students/{id} — hard delete (409 has_academic_history). */
export async function deleteStudent(id: string): Promise<void> {
  await api.delete(`/students/${id}`);
}

/**
 * Section F for an enrolled student — the checklist of the application they were admitted
 * from. `application_id` is null for a student registered directly or imported; there is
 * then nothing to tick.
 */
export interface StudentDocumentChecklist {
  application_id: string | null;
  items: DocumentRow[];
}

/** GET /students/{id}/documents (Dean + Registrar). */
export async function getStudentDocuments(
  id: string,
  signal?: AbortSignal,
): Promise<StudentDocumentChecklist> {
  const res = await api.get<StudentDocumentChecklist>(`/students/${id}/documents`, { signal });
  return res.data;
}

/** PUT /students/{id}/documents — papers that arrive after enrolment. */
export async function replaceStudentDocuments(
  id: string,
  items: DocumentRow[],
): Promise<StudentDocumentChecklist> {
  const res = await api.put<StudentDocumentChecklist>(`/students/${id}/documents`, { items });
  return res.data;
}

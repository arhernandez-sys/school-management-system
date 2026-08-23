/**
 * Students data hooks (api-spec §5 Module 3). Thin TanStack Query wrappers over the
 * `studentsApi` transport. Query keys embed their params so the cache stays correct
 * across search / filter / pagination; mutations invalidate the affected student's reads
 * (detail + assessments + the whole list).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createStudent,
  deleteStudent,
  getMyStudentRecord,
  getStudent,
  getStudentFilterOptions,
  getStudentAssessments,
  getStudentYears,
  listStudents,
  nudgeRelease,
  setStudentStatus,
  updateStudent,
} from '../api/studentsApi';
import type { StudentWritePayload, StudentsListParams } from '../types';
import type { StudentStatus } from '@shared/types/enums';

export const studentKeys = {
  all: ['students'] as const,
  list: (params: StudentsListParams) => [...studentKeys.all, 'list', params] as const,
  detail: (id: string) => [...studentKeys.all, 'detail', id] as const,
  // The year is part of the key: without it the switcher would serve the first year's
  // cached profile for every subsequent year and look like it does nothing.
  me: (academicYearId?: string | null) =>
    [...studentKeys.all, 'me', academicYearId ?? null] as const,
  assessments: (id: string) => [...studentKeys.all, id, 'assessments'] as const,
  years: (id: string) => [...studentKeys.all, id, 'years'] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
/** GET /students — paginated directory. */
export function useStudentsList(params: StudentsListParams) {
  return useQuery({
    queryKey: studentKeys.list(params),
    queryFn: ({ signal }) => listStudents(params, signal),
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/**
 * GET /students/filter-options — the religion dropdown's values (D32, brief §3).
 *
 * Long `staleTime`: the set of religions in the directory changes only when a student is
 * admitted or edited, and re-fetching it on every mount of the list would be a request
 * per navigation for data that is effectively reference data.
 */
export function useStudentFilterOptions() {
  return useQuery({
    queryKey: [...studentKeys.all, 'filter-options'],
    queryFn: ({ signal }) => getStudentFilterOptions(signal),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The FULL filtered result set, for printing (D32, brief §3).
 *
 * The brief's requirement is that the printout match what is on screen — but what is on
 * screen is one PAGE of it, and "print all Male students" plainly means all of them, not
 * the 25 currently visible. So the print view re-fetches the same filters with the page
 * size raised.
 *
 * `enabled` gates it on the print dialog actually being open: the directory would
 * otherwise fetch the entire student body on every visit to pre-warm a button most
 * visitors never press.
 */
export function useStudentsForPrint(params: StudentsListParams, enabled: boolean) {
  const printParams: StudentsListParams = { ...params, page: 1, page_size: 100 };
  return useQuery({
    queryKey: [...studentKeys.list(printParams), 'print'],
    queryFn: ({ signal }) => listStudents(printParams, signal),
    enabled,
  });
}

/** GET /students/{id} — full detail, optionally scoped to an academic year. */
export function useStudentDetail(studentId: string | undefined, yearId?: string) {
  return useQuery({
    queryKey: [...studentKeys.detail(studentId ?? ''), yearId ?? null],
    enabled: Boolean(studentId),
    queryFn: ({ signal }) => getStudent(studentId as string, yearId, signal),
  });
}

/** GET /students/{id}/years — the years this student was enrolled in (for the year filter). */
export function useStudentYears(studentId: string | undefined) {
  return useQuery({
    queryKey: studentKeys.years(studentId ?? ''),
    enabled: Boolean(studentId),
    queryFn: ({ signal }) => getStudentYears(studentId as string, signal),
    staleTime: 5 * 60 * 1000, // a student's year history is stable within a session
  });
}

/**
 * GET /students/me — the acting student's own record, optionally scoped to a year.
 *
 * `academicYearId` comes from the global year·semester switcher, so "My Profile" shows
 * the section/grade the student sat in that year instead of always the current one.
 */
export function useMyStudentRecord(enabled: boolean, academicYearId?: string) {
  return useQuery({
    queryKey: studentKeys.me(academicYearId),
    enabled,
    queryFn: ({ signal }) => getMyStudentRecord(academicYearId, signal),
  });
}

/** GET /students/{id}/assessments — subject-grouped assessments + term grades (year-scoped). */
export function useStudentAssessments(studentId: string | undefined, yearId?: string) {
  return useQuery({
    queryKey: [...studentKeys.assessments(studentId ?? ''), yearId ?? null],
    enabled: Boolean(studentId),
    queryFn: ({ signal }) => getStudentAssessments(studentId as string, yearId, signal),
  });
}

/**
 * POST /assessments/{id}/nudge-release — remind the teacher to release grades.
 *
 * Invalidates the assessments tab so `last_nudged_at` is re-read from the server
 * rather than patched in locally: the server is the only place the cooldown clock
 * lives (it is derived from `audit_log`), so re-reading keeps the disabled state
 * honest even across two admins acting at once.
 */
export function useNudgeRelease(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assessmentId: string) => nudgeRelease(assessmentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studentKeys.assessments(studentId) });
    },
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────
/** POST /students — create a profile. */
export function useCreateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StudentWritePayload) => createStudent(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...studentKeys.all, 'list'] });
    },
  });
}

/** PATCH /students/{id} — benign profile edits. */
export function useUpdateStudent(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<StudentWritePayload>) => updateStudent(studentId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studentKeys.detail(studentId) });
      void qc.invalidateQueries({ queryKey: [...studentKeys.all, 'list'] });
    },
  });
}

/** POST /students/{id}/status — lifecycle transition. */
export function useSetStudentStatus(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: StudentStatus) => setStudentStatus(studentId, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studentKeys.detail(studentId) });
      void qc.invalidateQueries({ queryKey: [...studentKeys.all, 'list'] });
    },
  });
}

/** DELETE /students/{id} — hard delete (409 has_academic_history). */
export function useDeleteStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) => deleteStudent(studentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...studentKeys.all, 'list'] });
    },
  });
}

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
  me: () => [...studentKeys.all, 'me'] as const,
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

/** GET /students/me — the acting student's own record. */
export function useMyStudentRecord(enabled: boolean) {
  return useQuery({
    queryKey: studentKeys.me(),
    enabled,
    queryFn: ({ signal }) => getMyStudentRecord(signal),
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { AcademicHistory, ProgramChangePayload, StudentProgramRef } from '../types';

/**
 * Programme registration + derived academic history (D30 §D12).
 *
 * Kept out of `useStudents.ts` for the same reason `academics.py` is kept out of the
 * students service: these answer a different question from student CRUD, and the history
 * is derived rather than fetched-and-cached-as-truth.
 */
export const academicKeys = {
  history: (studentId: string) => ['students', 'academic-history', studentId] as const,
};

async function fetchAcademicHistory(
  studentId: string,
  signal?: AbortSignal,
): Promise<AcademicHistory> {
  const res = await api.get<AcademicHistory>(`/students/${studentId}/academic-history`, {
    signal,
  });
  return res.data;
}

async function setProgram(
  studentId: string,
  body: ProgramChangePayload,
): Promise<StudentProgramRef> {
  const res = await api.put<StudentProgramRef>(`/students/${studentId}/program`, body);
  return res.data;
}

export function useAcademicHistory(studentId: string | undefined) {
  return useQuery({
    queryKey: academicKeys.history(studentId ?? ''),
    queryFn: ({ signal }) => fetchAcademicHistory(studentId!, signal),
    enabled: Boolean(studentId),
  });
}

/**
 * **Dean only** server-side (§D14). A 403 here is the permission boundary, not a bug.
 *
 * The response carries the new programme AND the whole history, but the HISTORY query is
 * still invalidated rather than patched from it: a change re-derives every figure on the
 * panel — GPA, credits earned, credits remaining, and which courses now count — and none
 * of those are in the response. Setting the cache from it would show a correct programme
 * beside stale totals.
 */
export function useSetStudentProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, body }: { studentId: string; body: ProgramChangePayload }) =>
      setProgram(studentId, body),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: academicKeys.history(vars.studentId) });
      // The student's own record carries `program`, and the list shows it too.
      void qc.invalidateQueries({ queryKey: ['students'], exact: false });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/programsApi';
import type {
  ProgramCourseUpdatePayload,
  ProgramCourseWritePayload,
  ProgramDetail,
  ProgramWritePayload,
  ProgramsListParams,
} from '../types';

export const programKeys = {
  all: ['programs'] as const,
  list: (params: ProgramsListParams) => [...programKeys.all, 'list', params] as const,
  detail: (id: string) => [...programKeys.all, 'detail', id] as const,
};

/**
 * `options.enabled` lets a caller hold the request until the picker is actually on screen
 * (D33 — `StudentFormDialog` only needs the programme list on CREATE, and only once the
 * dialog is open). Defaults to enabled, so every existing call site is unchanged.
 */
export function useProgramsList(
  params: ProgramsListParams,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: programKeys.list(params),
    queryFn: ({ signal }) => api.listPrograms(params, signal),
    placeholderData: (prev) => prev,
    enabled: options.enabled ?? true,
  });
}

export function useProgram(id: string | undefined) {
  return useQuery({
    queryKey: programKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.getProgram(id!, signal),
    enabled: Boolean(id),
  });
}

/**
 * Every curriculum write returns the full programme, so the detail cache is SET from
 * the response rather than invalidated-and-refetched. That is what keeps the builder
 * from flickering between "course added" and the re-fetched totals — and the credit
 * totals it shows are the server's, never recomputed in the browser.
 *
 * The lists are still invalidated: `course_count` and `curriculum_credits` on the
 * list row change too.
 */
function useApplyProgram() {
  const qc = useQueryClient();
  return (program: ProgramDetail) => {
    qc.setQueryData(programKeys.detail(program.id), program);
    void qc.invalidateQueries({ queryKey: programKeys.all, exact: false });
  };
}

export function useCreateProgram() {
  const apply = useApplyProgram();
  return useMutation({
    mutationFn: (body: ProgramWritePayload) => api.createProgram(body),
    onSuccess: apply,
  });
}

export function useUpdateProgram() {
  const apply = useApplyProgram();
  return useMutation({
    mutationFn: (vars: { id: string; body: Partial<ProgramWritePayload> }) =>
      api.updateProgram(vars.id, vars.body),
    onSuccess: apply,
  });
}

export function useDeleteProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProgram(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: programKeys.all }),
  });
}

export function useAddProgramCourse(programId: string) {
  const apply = useApplyProgram();
  return useMutation({
    mutationFn: (body: ProgramCourseWritePayload) => api.addProgramCourse(programId, body),
    onSuccess: apply,
  });
}

export function useUpdateProgramCourse(programId: string) {
  const apply = useApplyProgram();
  return useMutation({
    mutationFn: (vars: { programCourseId: string; body: ProgramCourseUpdatePayload }) =>
      api.updateProgramCourse(programId, vars.programCourseId, vars.body),
    onSuccess: apply,
  });
}

export function useRemoveProgramCourse(programId: string) {
  const apply = useApplyProgram();
  return useMutation({
    mutationFn: (programCourseId: string) =>
      api.removeProgramCourse(programId, programCourseId),
    onSuccess: apply,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/classroomsApi';
import type { ClassroomWritePayload, ClassroomsListParams } from '../types';

export const classroomKeys = {
  all: ['classrooms'] as const,
  list: (params: ClassroomsListParams) => [...classroomKeys.all, 'list', params] as const,
  /** The picker's own key — a big page, cached separately from the paged admin list. */
  options: [...(['classrooms'] as const), 'options'] as const,
};

export function useClassroomsList(params: ClassroomsListParams) {
  return useQuery({
    queryKey: classroomKeys.list(params),
    queryFn: ({ signal }) => api.listClassrooms(params, signal),
    placeholderData: (prev) => prev,
  });
}

/**
 * Every ACTIVE room, for the offering form's picker.
 *
 * Filtered to `Active` server-side: a room that has been taken out of service should not
 * be offered for a new booking, and showing it greyed would only prompt the question.
 * `page_size: 200` because BAJC has tens of rooms, not thousands — the same shortcut
 * `useOfferingOptions` takes for the same reason.
 */
export function useClassroomOptions(enabled = true) {
  return useQuery({
    queryKey: classroomKeys.options,
    queryFn: ({ signal }) =>
      api.listClassrooms({ page_size: 200, status: 'Active' }, signal),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** Every write invalidates the whole namespace: the counts on the list move too. */
function useApplyClassroom() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: classroomKeys.all, exact: false });
    // A room's label is embedded on every offering row, so those go stale as well.
    void qc.invalidateQueries({ queryKey: ['offerings'], exact: false });
  };
}

export function useCreateClassroom() {
  const apply = useApplyClassroom();
  return useMutation({
    mutationFn: (body: ClassroomWritePayload) => api.createClassroom(body),
    onSuccess: apply,
  });
}

export function useUpdateClassroom() {
  const apply = useApplyClassroom();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ClassroomWritePayload }) =>
      api.updateClassroom(id, body),
    onSuccess: apply,
  });
}

export function useDeleteClassroom() {
  const apply = useApplyClassroom();
  return useMutation({
    mutationFn: (id: string) => api.deleteClassroom(id),
    onSuccess: apply,
  });
}

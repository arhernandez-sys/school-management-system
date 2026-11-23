import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type {
  PrerequisiteCreatePayload,
  PrerequisiteList,
} from '../types.prerequisites';

/**
 * Course-prerequisite hooks (D30 §D4). Hand-written transport — the endpoints are new
 * and absent from the served OpenAPI, and `npm run generate:api` is forbidden.
 *
 * Both writes return the whole LIST, so the cache is SET from the response rather than
 * invalidated-and-refetched: the editor is a list, and a re-fetch would flicker.
 */
export const prerequisiteKeys = {
  all: ['prerequisites'] as const,
  forCourse: (courseId: string) => [...prerequisiteKeys.all, courseId] as const,
};

export function usePrerequisites(courseId: string | undefined) {
  return useQuery({
    queryKey: prerequisiteKeys.forCourse(courseId ?? ''),
    queryFn: async ({ signal }) => {
      const res = await api.get<PrerequisiteList>(`/courses/${courseId}/prerequisites`, {
        signal,
      });
      return res.data;
    },
    enabled: Boolean(courseId),
  });
}

function useApply(courseId: string) {
  const qc = useQueryClient();
  return (list: PrerequisiteList) =>
    qc.setQueryData(prerequisiteKeys.forCourse(courseId), list);
}

export function useAddPrerequisite(courseId: string) {
  const apply = useApply(courseId);
  return useMutation({
    mutationFn: async (body: PrerequisiteCreatePayload) => {
      const res = await api.post<PrerequisiteList>(
        `/courses/${courseId}/prerequisites`,
        body,
      );
      return res.data;
    },
    onSuccess: apply,
  });
}

export function useRemovePrerequisite(courseId: string) {
  const apply = useApply(courseId);
  return useMutation({
    mutationFn: async (prerequisiteId: string) => {
      const res = await api.delete<PrerequisiteList>(
        `/courses/${courseId}/prerequisites/${prerequisiteId}`,
      );
      return res.data;
    },
    onSuccess: apply,
  });
}

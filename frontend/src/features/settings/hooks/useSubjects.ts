/**
 * Subjects data hooks (api-spec §5b). Thin wrappers over the ORVAL-GENERATED
 * operations/hooks so the feature owns query-key identity + cache invalidation while
 * the transport (Bearer + refresh + credentialed cookie) stays in the shared mutator.
 *
 * The list query key includes the filters so the cache stays correct across
 * search / active-toggle / pagination changes.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listSubjectsApiV1SubjectsGet,
  useCreateSubjectApiV1SubjectsPost,
  useUpdateSubjectApiV1SubjectsSubjectIdPatch,
  useDeleteSubjectApiV1SubjectsSubjectIdDelete,
} from '@shared/api/generated/subjects/subjects';
import type { ListSubjectsApiV1SubjectsGetParams } from '@shared/api/generated/model';

export const subjectKeys = {
  all: ['subjects'] as const,
  list: (params: ListSubjectsApiV1SubjectsGetParams) =>
    [...subjectKeys.all, 'list', params] as const,
};

/** GET /subjects — paginated. `is_active` omitted => backend defaults to active-only. */
export function useSubjectsList(params: ListSubjectsApiV1SubjectsGetParams) {
  return useQuery({
    queryKey: subjectKeys.list(params),
    queryFn: ({ signal }) => listSubjectsApiV1SubjectsGet(params, undefined, signal),
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/** Invalidate every subjects list after a mutation. */
function useInvalidateSubjects() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: subjectKeys.all });
}

export function useCreateSubject() {
  const invalidate = useInvalidateSubjects();
  return useCreateSubjectApiV1SubjectsPost({ mutation: { onSuccess: invalidate } });
}

export function useUpdateSubject() {
  const invalidate = useInvalidateSubjects();
  return useUpdateSubjectApiV1SubjectsSubjectIdPatch({ mutation: { onSuccess: invalidate } });
}

export function useDeleteSubject() {
  const invalidate = useInvalidateSubjects();
  return useDeleteSubjectApiV1SubjectsSubjectIdDelete({ mutation: { onSuccess: invalidate } });
}

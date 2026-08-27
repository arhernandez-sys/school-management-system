/**
 * Course catalog data hooks (api-spec §5b). Thin wrappers over the ORVAL-GENERATED
 * operations/hooks so the feature owns query-key identity + cache invalidation while
 * the transport (Bearer + refresh + credentialed cookie) stays in the shared mutator.
 *
 * The list query key includes the filters so the cache stays correct across
 * search / active-toggle / pagination changes.
 *
 * **D31** — `/subjects` became `/courses`, the last place the pre-D30 noun survived on the
 * wire (`Subject` → `Course` had already renamed 201 backend identifiers). The generated
 * client moved with it: `generated/subjects/` → `generated/courses/`.
 *
 * This is the CATALOG — code, name, credits, component, prerequisites; what the Dean
 * manages. A scheduled instance of one of these is an OFFERING, in `features/offerings`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCoursesApiV1CoursesGet,
  useCreateCourseApiV1CoursesPost,
  useUpdateCourseApiV1CoursesCourseIdPatch,
  useDeleteCourseApiV1CoursesCourseIdDelete,
} from '@shared/api/generated/courses/courses';
import type { ListCoursesApiV1CoursesGetParams } from '@shared/api/generated/model';

/**
 * The generated params plus `include_retired`, widened HERE rather than in
 * `generated/model/` — that directory is orval output and a hand-edit would be silently
 * reverted by the next `generate:api`. The generated client hands `params` straight to
 * axios, so an extra key rides along on the query string with no further plumbing.
 *
 * `include_retired` exists because `is_active` cannot answer the question. It is an
 * EQUALITY filter: `true` is active-only, `false` is retired-only, and omitting it makes
 * the server default it back to `true`. There was no value meaning "both", which is why
 * the "Show retired" switch redrew the identical list.
 */
export type CoursesListParams = ListCoursesApiV1CoursesGetParams & {
  include_retired?: boolean;
};

export const courseKeys = {
  all: ['courses'] as const,
  list: (params: CoursesListParams) => [...courseKeys.all, 'list', params] as const,
};

/** GET /courses — paginated. `is_active` omitted => backend defaults to active-only. */
export function useCoursesList(params: CoursesListParams) {
  return useQuery({
    queryKey: courseKeys.list(params),
    queryFn: ({ signal }) => listCoursesApiV1CoursesGet(params, undefined, signal),
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/** Invalidate every course list after a mutation. */
function useInvalidateCourses() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: courseKeys.all });
}

export function useCreateCourse() {
  const invalidate = useInvalidateCourses();
  return useCreateCourseApiV1CoursesPost({ mutation: { onSuccess: invalidate } });
}

export function useUpdateCourse() {
  const invalidate = useInvalidateCourses();
  return useUpdateCourseApiV1CoursesCourseIdPatch({ mutation: { onSuccess: invalidate } });
}

export function useDeleteCourse() {
  const invalidate = useInvalidateCourses();
  return useDeleteCourseApiV1CoursesCourseIdDelete({ mutation: { onSuccess: invalidate } });
}

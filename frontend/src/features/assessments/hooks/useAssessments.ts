/**
 * Assessments data hooks (api-spec §5 Module 6).
 *
 * Assessments are NOT yet in the served OpenAPI, so there is no orval-generated client
 * for them. These hooks call the shared axios `api` instance directly (it still carries
 * the Bearer + single-flight-refresh interceptors) and TanStack Query owns caching +
 * invalidation. When the module lands in the schema, swap the queryFns for the generated
 * operations without touching the screens.
 *
 * Wire format is snake_case (api-spec §1.2). Types below mirror the MSW handler shapes in
 * handlers/assessments.ts — the demo contract.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { Page } from '@shared/types/api';
import type { AssessmentStatus, AssessmentType } from '@shared/types/enums';

// ── Wire types ─────────────────────────────────────────────────────────────────────
export interface ClassSubjectRef {
  class_subject_id: string;
  section: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string } | null;
  label: string;
}

export interface AssessmentListItem {
  id: string;
  title: string;
  type: AssessmentType;
  class_subject: ClassSubjectRef | null;
  category_id: string | null;
  max_score: number;
  weight: number;
  assessment_date: string | null;
  status: AssessmentStatus;
  is_released: boolean;
}

export interface AssessmentDetail extends AssessmentListItem {
  semester_id: string;
  stats: { grade_count: number; graded_count: number; pending_count: number };
}

export interface AssessmentCategory {
  id: string;
  class_subject_id: string;
  name: string;
  weight: number;
  drop_lowest_count: number;
}

export interface AssessmentListParams {
  class_subject_id?: string;
  type?: AssessmentType;
  status?: AssessmentStatus;
  page?: number;
  page_size?: number;
  sort?: string;
}

export interface AssessmentCreateBody {
  class_subject_id: string;
  semester_id?: string;
  category_id?: string | null;
  title: string;
  type: AssessmentType;
  max_score: number;
  weight?: number;
  assessment_date?: string | null;
}

export type AssessmentUpdateBody = Partial<
  Pick<AssessmentCreateBody, 'title' | 'type' | 'category_id' | 'max_score' | 'weight' | 'assessment_date'>
>;

// ── Query keys ───────────────────────────────────────────────────────────────────
export const assessmentKeys = {
  all: ['assessments'] as const,
  classSubjects: (scope?: string, teacherProfileId?: string | null) =>
    [...assessmentKeys.all, 'class-subjects', scope ?? 'all', teacherProfileId ?? null] as const,
  list: (params: AssessmentListParams) => [...assessmentKeys.all, 'list', params] as const,
  detail: (id: string) => [...assessmentKeys.all, 'detail', id] as const,
  categories: (classSubjectId: string) =>
    [...assessmentKeys.all, 'categories', classSubjectId] as const,
};

// ── Picker feed (demo-only) ────────────────────────────────────────────────────────
/**
 * GET /assessments/class-subjects — options for the class-subject picker.
 * Teacher scope passes `scope=me&teacher_profile_id=…`; P/S omit scope (view-all).
 */
export function useClassSubjectOptions(scope: 'me' | 'all', teacherProfileId?: string | null) {
  const enabled = scope !== 'me' || Boolean(teacherProfileId);
  return useQuery({
    queryKey: assessmentKeys.classSubjects(scope, teacherProfileId),
    enabled,
    queryFn: async ({ signal }) => {
      const params: Record<string, string> = {};
      if (scope === 'me' && teacherProfileId) {
        params.scope = 'me';
        params.teacher_profile_id = teacherProfileId;
      }
      const res = await api.get<{ items: ClassSubjectRef[] }>('/assessments/class-subjects', {
        params,
        signal,
      });
      return res.data.items;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ── List ─────────────────────────────────────────────────────────────────────────
export function useAssessmentsList(params: AssessmentListParams, enabled = true) {
  return useQuery({
    queryKey: assessmentKeys.list(params),
    enabled,
    queryFn: async ({ signal }) => {
      const res = await api.get<Page<AssessmentListItem>>('/assessments', { params, signal });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });
}

// ── Categories (for the create/edit form's category picker) ─────────────────────────
export function useAssessmentCategories(classSubjectId: string | null) {
  return useQuery({
    queryKey: assessmentKeys.categories(classSubjectId ?? ''),
    enabled: Boolean(classSubjectId),
    queryFn: async ({ signal }) => {
      // class_id is not tracked on the ref; the demo handler keys on class_subject_id only.
      const res = await api.get<{ items: AssessmentCategory[] }>(
        `/classes/_/subjects/${classSubjectId}/categories`,
        { signal },
      );
      return res.data.items;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────────────
function useInvalidateAssessments() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: assessmentKeys.all });
}

export function useCreateAssessment() {
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (body: AssessmentCreateBody) => {
      const res = await api.post<AssessmentDetail>('/assessments', body);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateAssessment() {
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AssessmentUpdateBody }) => {
      const res = await api.patch<AssessmentDetail>(`/assessments/${id}`, body);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useSetAssessmentStatus() {
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AssessmentStatus }) => {
      const res = await api.post<AssessmentDetail>(`/assessments/${id}/status`, { status });
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAssessment() {
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/assessments/${id}`);
    },
    onSuccess: invalidate,
  });
}

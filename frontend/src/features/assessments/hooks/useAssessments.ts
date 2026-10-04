/**
 * Assessments data hooks (api-spec §5 Module 6).
 *
 * Assessments are not in the orval-generated surface (`orval.config.ts` covers the
 * auth / health / settings / courses tags), so these hooks call the shared axios `api`
 * instance directly — it still carries the Bearer + single-flight-refresh interceptors —
 * and TanStack Query owns caching + invalidation. When the module is added to codegen,
 * swap the queryFns for the generated operations without touching the screens.
 *
 * Wire format is snake_case (api-spec §1.2). Types below mirror
 * `backend/app/modules/assessments/schemas.py`.
 *
 * **D31 changed three things here, and one of them was a shim worth deleting.**
 *  1. An assessment hangs off `offering_id`, not `class_subject_id`.
 *  2. The categories path lost its fake homeroom segment — it was
 *     `/classes/_/subjects/{csId}/categories`, with a literal `_` standing in for a class
 *     id the ref did not carry. It is `/offerings/{id}/categories` now.
 *  3. The picker no longer takes `scope` / `teacher_profile_id`. The server scopes the
 *     picker to the CALLER, so passing a profile id from the client was both redundant and
 *     a request to be trusted about whose offerings to return.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { OfferingRef, Page } from '@shared/types/api';
import type { AssessmentStatus, AssessmentType } from '@shared/types/enums';

export type { OfferingRef };

// ── Wire types ─────────────────────────────────────────────────────────────────────
export interface AssessmentListItem {
  id: string;
  title: string;
  type: AssessmentType;
  /** Nullable only for a row whose offering was since deleted. */
  offering: OfferingRef | null;
  category_id: string | null;
  max_score: number;
  weight: number;
  assessment_date: string | null;
  status: AssessmentStatus;
  is_released: boolean;
}

export interface AssessmentDetail extends AssessmentListItem {
  semester_id: string;
  stats: { grade_count: number; graded_count: number; pending_count: number } | null;
}

export interface AssessmentCategory {
  id: string;
  offering_id: string;
  name: string;
  weight: number;
  drop_lowest_count: number;
}

export interface AssessmentListParams {
  offering_id?: string;
  type?: AssessmentType;
  status?: AssessmentStatus;
  academic_year_id?: string;
  /**
   * Narrows within the year — sent by the student's global year·semester switcher so
   * "My Assessments" lists one term rather than the whole year.
   *
   * Composing the two matters more now than it did: an offering belongs to a semester, so
   * a year alone spans BOTH terms and would list a finished course beside a live one.
   */
  semester_id?: string;
  /** `'me'` restricts to the caller's own. Any other scoping is the server's decision. */
  scope?: 'me';
  page?: number;
  page_size?: number;
  sort?: string;
}

export interface AssessmentCreateBody {
  offering_id: string;
  semester_id?: string;
  category_id?: string | null;
  title: string;
  type: AssessmentType;
  max_score: number;
  weight?: number;
  assessment_date?: string | null;
}

export type AssessmentUpdateBody = Partial<
  Pick<
    AssessmentCreateBody,
    'title' | 'type' | 'category_id' | 'max_score' | 'weight' | 'assessment_date'
  >
>;

// ── Query keys ───────────────────────────────────────────────────────────────────
export const assessmentKeys = {
  all: ['assessments'] as const,
  offerings: (academicYearId?: string | null) =>
    [...assessmentKeys.all, 'offerings', academicYearId ?? null] as const,
  list: (params: AssessmentListParams) => [...assessmentKeys.all, 'list', params] as const,
  detail: (id: string) => [...assessmentKeys.all, 'detail', id] as const,
  categories: (offeringId: string) => [...assessmentKeys.all, 'categories', offeringId] as const,
};

// ── Picker feed ────────────────────────────────────────────────────────────────────
/**
 * GET /assessments/offerings — options for the offering picker.
 *
 * Scoped SERVER-side to the caller: a lecturer gets the offerings they teach, the Dean and
 * Registrar get all. There is nothing for the client to pass, which is the point — the old
 * signature took `scope` and a `teacher_profile_id` and asked the server to trust both.
 */
export function useOfferingPickerOptions(academicYearId?: string) {
  return useQuery({
    queryKey: assessmentKeys.offerings(academicYearId),
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: OfferingRef[] }>('/assessments/offerings', {
        params: academicYearId ? { academic_year_id: academicYearId } : undefined,
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
export function useAssessmentCategories(offeringId: string | null) {
  return useQuery({
    queryKey: assessmentKeys.categories(offeringId ?? ''),
    enabled: Boolean(offeringId),
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: AssessmentCategory[] }>(
        `/offerings/${offeringId}/categories`,
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

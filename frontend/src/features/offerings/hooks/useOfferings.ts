/**
 * Offerings data hooks (api-spec §5). Thin TanStack Query wrappers over the shared axios
 * client (`@shared/api/client`) — the Offerings endpoints are not in the orval-generated
 * surface (`orval.config.ts` generates auth/health/settings/courses only), so these call
 * the transport directly. Bearer + single-flight refresh + credentialed cookie still ride
 * the shared `api` instance.
 *
 * Query keys embed their params so the cache stays correct across search / pagination.
 * Mutations invalidate the affected offering's reads (roster, meetings, detail, list).
 *
 * **D31** — `useClassSubjects` / `useAssignTeachers(classId, csId)` are gone with the
 * `class_subjects` join: an offering teaches ONE course, so there is no per-subject list
 * inside it and the teacher assignment addresses the offering directly.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import { teacherKeys } from '@features/teachers/hooks/useTeachers';
import type {
  EnrollmentResult,
  EnrollmentStatusBody,
  MeetingsReplaceBody,
  MeetingsResult,
  OfferingCreateBody,
  OfferingDetail,
  OfferingListParams,
  OfferingListResponse,
  RosterEntry,
  StudentRef,
  TeacherAssignBody,
} from '../types';

export const offeringKeys = {
  all: ['offerings'] as const,
  list: (params: OfferingListParams) => [...offeringKeys.all, 'list', params] as const,
  detail: (id: string) => [...offeringKeys.all, 'detail', id] as const,
  roster: (id: string) => [...offeringKeys.all, id, 'roster'] as const,
  meetings: (id: string) => [...offeringKeys.all, id, 'meetings'] as const,
  enrollable: (id: string, search: string) =>
    [...offeringKeys.all, id, 'enrollable', search] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
/** GET /offerings — paginated offering list. */
export function useOfferingsList(params: OfferingListParams) {
  return useQuery({
    queryKey: offeringKeys.list(params),
    queryFn: async ({ signal }) => {
      const res = await api.get<OfferingListResponse>('/offerings', { params, signal });
      return res.data;
    },
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/** GET /offerings/{id} — offering detail. */
export function useOfferingDetail(offeringId: string | undefined) {
  return useQuery({
    queryKey: offeringKeys.detail(offeringId ?? ''),
    enabled: Boolean(offeringId),
    queryFn: async ({ signal }) => {
      const res = await api.get<OfferingDetail>(`/offerings/${offeringId}`, { signal });
      return res.data;
    },
  });
}

/** GET /offerings/{id}/meetings — the weekly schedule (any role that can read it). */
export function useOfferingMeetings(offeringId: string | undefined) {
  return useQuery({
    queryKey: offeringKeys.meetings(offeringId ?? ''),
    enabled: Boolean(offeringId),
    queryFn: async ({ signal }) => {
      const res = await api.get<MeetingsResult>(`/offerings/${offeringId}/meetings`, { signal });
      return res.data;
    },
  });
}

/** GET /offerings/{id}/roster — active roster (not paginated). */
export function useOfferingRoster(offeringId: string | undefined) {
  return useQuery({
    queryKey: offeringKeys.roster(offeringId ?? ''),
    enabled: Boolean(offeringId),
    queryFn: async ({ signal }) => {
      const res = await api.get<RosterEntry[]>(`/offerings/${offeringId}/roster`, { signal });
      return res.data;
    },
  });
}

/** GET /offerings/{id}/enrollable-students — picker for the enroll dialog. */
export function useEnrollableStudents(
  offeringId: string | undefined,
  search: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: offeringKeys.enrollable(offeringId ?? '', search),
    enabled: enabled && Boolean(offeringId),
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: StudentRef[] }>(
        `/offerings/${offeringId}/enrollable-students`,
        { params: search ? { search } : undefined, signal },
      );
      return res.data.items;
    },
    placeholderData: (prev) => prev,
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────
/**
 * POST /offerings — create a course offering.
 *
 * The body carries the course (required) and the term, and optionally the teachers and
 * the weekly meetings, so one call creates the whole thing. Teachers are invalidated too
 * because their assignment counts change when an offering is created with one.
 */
export function useCreateOffering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: OfferingCreateBody) => {
      const res = await api.post<OfferingDetail>('/offerings', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: teacherKeys.all });
    },
  });
}

/*
 * NOTE — no `useUpdateOffering` / `useDeleteOffering`.
 *
 * `PATCH /offerings/{id}` (section code · capacity · archive) and `DELETE /offerings/{id}`
 * (soft delete) both exist on the server, but no screen calls them yet: an offering is
 * created complete, and the list has no edit or archive affordance. `OfferingUpdateBody`
 * is typed in `../types` so the body is documented when a screen wants it — adding the
 * hook then is three lines. A hook nothing renders is the thing that rots.
 */

/**
 * PUT /offerings/{id}/meetings — replace the whole weekly schedule (P/S only).
 *
 * Returns `conflicts` alongside the saved meetings: a teacher or room double-booking is
 * reported but does NOT fail the write, so callers must render the warning rather than
 * treat a non-empty `conflicts` as an error.
 *
 * Invalidates the timetable reads as well as the offering's own — retiming an offering
 * changes the week of every student enrolled in it.
 */
export function useReplaceMeetings(offeringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MeetingsReplaceBody) => {
      const res = await api.put<MeetingsResult>(`/offerings/${offeringId}/meetings`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offeringKeys.meetings(offeringId) });
      void qc.invalidateQueries({ queryKey: offeringKeys.detail(offeringId) });
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: ['timetable'] });
    },
  });
}

/** POST /offerings/{id}/enrollments — enroll one or more students (bulk). */
export function useEnrollStudents(offeringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentIds: string[]) => {
      const res = await api.post<EnrollmentResult>(`/offerings/${offeringId}/enrollments`, {
        student_ids: studentIds,
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offeringKeys.roster(offeringId) });
      void qc.invalidateQueries({ queryKey: offeringKeys.detail(offeringId) });
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, offeringId, 'enrollable'] });
      // Roster changes alter the affected student's own week, and their profile's
      // current_offerings / offering_count.
      void qc.invalidateQueries({ queryKey: ['timetable'] });
      void qc.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

/**
 * PUT /offerings/{id}/teachers — set the offering's lecturers (P/S only; the caller gates
 * rendering). This REPLACES the set, so callers send the full intended `teacher_ids` — an
 * empty array removes every teacher, which the API allows.
 *
 * **D31** — one call, one id. The old path threaded a homeroom id AND a class_subject id
 * (`PUT /classes/{id}/subjects/{csId}/teachers`) because owning one subject of a section
 * was a different question from owning the section. One course per offering makes them the
 * same question, which is also why `assert_teacher_owns_section` and
 * `assert_teacher_owns_class_subject` merged server-side.
 *
 * Invalidates this offering's reads plus the Teachers module reads whose assignment counts
 * now differ.
 */
export function useAssignTeachers(offeringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TeacherAssignBody) => {
      const res = await api.put<OfferingDetail>(`/offerings/${offeringId}/teachers`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offeringKeys.detail(offeringId) });
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: teacherKeys.all });
    },
  });
}

/**
 * PATCH /offerings/{id}/enrollments/{enrollmentId} — set the student's COURSE STATUS
 * (D35, the client's `coursestatus`).
 *
 * **Not the same action as `useWithdrawStudent` below**, which DELETEs. That un-enrols:
 * the row closes and the student leaves the roster, as though the registration were a
 * mistake. This records that they sat the course and left — the row stays open and on the
 * roster, because the transcript has to print `W/P` or `W/F` against it.
 *
 * Invalidates the roster and the affected student's reads: the status changes their
 * academic history buckets, their credits and their GPA.
 */
export function useSetEnrollmentStatus(offeringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { enrollmentId: string; body: EnrollmentStatusBody }) => {
      const res = await api.patch<RosterEntry>(
        `/offerings/${offeringId}/enrollments/${vars.enrollmentId}`,
        vars.body,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offeringKeys.roster(offeringId) });
      // The status feeds credits_earned, the GPA and the academic-history buckets, so the
      // student's own reads are stale the moment it changes.
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/**
 * DELETE /offerings/{id}/enrollments/{enrollmentId} — UN-ENROL from the roster.
 *
 * D35 renamed what this is called in the UI, from "Withdraw" to "Remove". "Withdraw" now
 * means a `coursestatus` that KEEPS the row (see `useSetEnrollmentStatus`), and two
 * different actions sharing one word on the same screen is how the wrong one gets clicked.
 */
export function useWithdrawStudent(offeringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      await api.delete(`/offerings/${offeringId}/enrollments/${enrollmentId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offeringKeys.roster(offeringId) });
      void qc.invalidateQueries({ queryKey: offeringKeys.detail(offeringId) });
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: [...offeringKeys.all, offeringId, 'enrollable'] });
      // Roster changes alter the affected student's own week, and their profile's
      // current_offerings / offering_count.
      void qc.invalidateQueries({ queryKey: ['timetable'] });
      void qc.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

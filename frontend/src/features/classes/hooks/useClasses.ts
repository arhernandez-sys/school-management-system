/**
 * Classes data hooks (api-spec §5). Thin TanStack Query wrappers over the shared axios
 * client (`@shared/api/client`) — the Classes endpoints are not in the orval-generated
 * surface yet, so these call the transport directly (Bearer + refresh + credentialed
 * cookie still ride the shared `api` instance).
 *
 * Query keys embed their params so the cache stays correct across search / pagination.
 * Mutations invalidate the affected class's reads (roster, subjects, detail, list).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import { teacherKeys } from '@features/teachers/hooks/useTeachers';
import type {
  ClassCreateBody,
  ClassDetail,
  ClassListParams,
  ClassListResponse,
  ClassSubjectItem,
  EnrollmentResult,
  MeetingsReplaceBody,
  MeetingsResult,
  RosterEntry,
  StudentRef,
  TeacherAssignBody,
} from '../types';

export const classKeys = {
  all: ['classes'] as const,
  list: (params: ClassListParams) => [...classKeys.all, 'list', params] as const,
  detail: (id: string) => [...classKeys.all, 'detail', id] as const,
  subjects: (id: string) => [...classKeys.all, id, 'subjects'] as const,
  roster: (id: string) => [...classKeys.all, id, 'roster'] as const,
  meetings: (id: string) => [...classKeys.all, id, 'meetings'] as const,
  enrollable: (id: string, search: string) =>
    [...classKeys.all, id, 'enrollable', search] as const,
};

// ── Reads ──────────────────────────────────────────────────────────────────────
/** GET /classes — paginated subject-class list. */
export function useClassesList(params: ClassListParams) {
  return useQuery({
    queryKey: classKeys.list(params),
    queryFn: async ({ signal }) => {
      const res = await api.get<ClassListResponse>('/classes', { params, signal });
      return res.data;
    },
    placeholderData: (prev) => prev, // keep the previous page visible during pagination
  });
}

/** GET /classes/{id} — section detail. */
export function useClassDetail(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.detail(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<ClassDetail>(`/classes/${classId}`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/subjects — class_subjects offered in the section. */
export function useClassSubjects(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.subjects(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<ClassSubjectItem[]>(`/classes/${classId}/subjects`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/meetings — the class's weekly schedule (any role that can read it). */
export function useClassMeetings(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.meetings(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<MeetingsResult>(`/classes/${classId}/meetings`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/roster — active roster (not paginated). */
export function useClassRoster(classId: string | undefined) {
  return useQuery({
    queryKey: classKeys.roster(classId ?? ''),
    enabled: Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<RosterEntry[]>(`/classes/${classId}/roster`, { signal });
      return res.data;
    },
  });
}

/** GET /classes/{id}/enrollable-students — picker for the enroll dialog. */
export function useEnrollableStudents(classId: string | undefined, search: string, enabled: boolean) {
  return useQuery({
    queryKey: classKeys.enrollable(classId ?? '', search),
    enabled: enabled && Boolean(classId),
    queryFn: async ({ signal }) => {
      const res = await api.get<{ items: StudentRef[] }>(
        `/classes/${classId}/enrollable-students`,
        { params: search ? { search } : undefined, signal },
      );
      return res.data.items;
    },
    placeholderData: (prev) => prev,
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────
/**
 * POST /classes — create a subject class.
 *
 * The body carries the subject (required), and optionally the teachers and the weekly
 * meetings, so one call creates the whole thing. Teachers are invalidated too because
 * their `assignment_count` / `classes_taught` change when a class is created with one.
 */
export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ClassCreateBody) => {
      const res = await api.post<ClassDetail>('/classes', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...classKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: teacherKeys.all });
    },
  });
}

/**
 * PUT /classes/{id}/meetings — replace the class's whole weekly schedule (P/S only).
 *
 * Returns `conflicts` alongside the saved meetings: a teacher or room double-booking is
 * reported but does NOT fail the write, so callers must render the warning rather than
 * treat a non-empty `conflicts` as an error.
 *
 * Invalidates the timetable reads as well as the class's own — retiming a class changes
 * the week of every student enrolled in it.
 */
export function useReplaceMeetings(classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MeetingsReplaceBody) => {
      const res = await api.put<MeetingsResult>(`/classes/${classId}/meetings`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classKeys.meetings(classId) });
      void qc.invalidateQueries({ queryKey: classKeys.detail(classId) });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: ['timetable'] });
    },
  });
}

/** POST /classes/{id}/enrollments — enroll one or more students (bulk). */
export function useEnrollStudents(classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentIds: string[]) => {
      const res = await api.post<EnrollmentResult>(`/classes/${classId}/enrollments`, {
        student_ids: studentIds,
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classKeys.roster(classId) });
      void qc.invalidateQueries({ queryKey: classKeys.detail(classId) });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, classId, 'enrollable'] });
      // Roster changes alter the affected student's own week, and their profile's
      // current_classes / class_count.
      void qc.invalidateQueries({ queryKey: ['timetable'] });
      void qc.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

/**
 * PUT /classes/{id}/subjects/{csId}/teachers — set the teachers for one subject offering
 * (P/S only; the caller gates rendering). This REPLACES the set, so callers send the full
 * intended `teacher_ids` — an empty array removes every teacher, which the API allows.
 *
 * Invalidates this section's subjects list (the row the caller just changed) plus the
 * section reads that summarise it, and the Teachers module reads whose `assignment_count`
 * / `classes_taught` now differ.
 */
export function useAssignTeachers(classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { classSubjectId: string; body: TeacherAssignBody }) => {
      const res = await api.put<ClassSubjectItem>(
        `/classes/${classId}/subjects/${vars.classSubjectId}/teachers`,
        vars.body,
      );
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classKeys.subjects(classId) });
      void qc.invalidateQueries({ queryKey: classKeys.detail(classId) });
      void qc.invalidateQueries({ queryKey: teacherKeys.all });
    },
  });
}

/*
 * NOTE — no `useAttachSubject` / `useDetachSubject`.
 *
 * Under D29 a class teaches exactly ONE subject, and `POST /classes` attaches it as part
 * of the create, so there is no UI path that adds or removes a subject afterwards (the
 * server would 409 a second attach anyway). The endpoints still exist to backfill a
 * pre-D29 class that has no offering; if that ever needs a screen, add the hooks back
 * rather than reviving the retired Subjects tab.
 */

/** DELETE /classes/{id}/enrollments/{enrollmentId} — withdraw from the roster. */
export function useWithdrawStudent(classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      await api.delete(`/classes/${classId}/enrollments/${enrollmentId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classKeys.roster(classId) });
      void qc.invalidateQueries({ queryKey: classKeys.detail(classId) });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, 'list'] });
      void qc.invalidateQueries({ queryKey: [...classKeys.all, classId, 'enrollable'] });
      // Roster changes alter the affected student's own week, and their profile's
      // current_classes / class_count.
      void qc.invalidateQueries({ queryKey: ['timetable'] });
      void qc.invalidateQueries({ queryKey: ['students'] });
    },
  });
}

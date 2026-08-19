import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import { announcementKeys } from '@features/announcements/hooks/useAnnouncements';
import { gradeKeys } from './useGrades';
import type {
  GradeRevision,
  GradeRevisionCreatePayload,
  GradeRevisionDecisionPayload,
  GradeRevisionList,
  GradeRevisionStatus,
} from '../revisionTypes';

/**
 * Grade revision / second opportunity (D30 §D7, brief §20).
 *
 * Every mutation invalidates the **bell count** as well as the queue, because §D8 makes the
 * badge a filtered read of this very table: filing a request raises the Dean's count and
 * deciding one lowers it. Without that the number goes stale the moment anybody acts, which
 * is exactly the kind of drift a notifications table would have introduced.
 *
 * Approving also invalidates the GRADEBOOK: an approved revision moves the student's term
 * grade through `calc`'s makeup arm, so the row the Lecturer is looking at changes.
 */
export const revisionKeys = {
  all: ['grade-revisions'] as const,
  list: (params: { status?: GradeRevisionStatus; class_subject_id?: string }) =>
    [...revisionKeys.all, 'list', params] as const,
  detail: (id: string) => [...revisionKeys.all, 'detail', id] as const,
};

async function listRevisions(
  params: { status?: GradeRevisionStatus; class_subject_id?: string },
  signal?: AbortSignal,
): Promise<GradeRevisionList> {
  const res = await api.get<GradeRevisionList>('/grade-revisions', { params, signal });
  return res.data;
}

export function useGradeRevisions(params: {
  status?: GradeRevisionStatus;
  class_subject_id?: string;
}) {
  return useQuery({
    queryKey: revisionKeys.list(params),
    queryFn: ({ signal }) => listRevisions(params, signal),
    placeholderData: (prev) => prev,
  });
}

function useAfterRevisionChange() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: revisionKeys.all, exact: false });
    // §D8 — the badge IS a read of the revision table.
    void qc.invalidateQueries({ queryKey: announcementKeys.unreadCount() });
    // An approval moves the term grade through `calc`'s makeup arm, so the gradebook the
    // Lecturer is looking at — and the student's own /grades/me — are both stale.
    void qc.invalidateQueries({ queryKey: gradeKeys.all, exact: false });
  };
}

export function useRequestGradeRevision() {
  const after = useAfterRevisionChange();
  return useMutation({
    mutationFn: async ({
      assessmentId,
      body,
    }: {
      assessmentId: string;
      body: GradeRevisionCreatePayload;
    }) => {
      const res = await api.post<GradeRevision>(
        `/assessments/${assessmentId}/grade-revisions`,
        body,
      );
      return res.data;
    },
    onSuccess: after,
  });
}

/** **Dean only** server-side (§D14). A 403 here is the permission boundary, not a bug. */
export function useDecideGradeRevision() {
  const after = useAfterRevisionChange();
  return useMutation({
    mutationFn: async ({
      revisionId,
      body,
    }: {
      revisionId: string;
      body: GradeRevisionDecisionPayload;
    }) => {
      const res = await api.post<GradeRevision>(
        `/grade-revisions/${revisionId}/decision`,
        body,
      );
      return res.data;
    },
    onSuccess: after,
  });
}

export function useWithdrawGradeRevision() {
  const after = useAfterRevisionChange();
  return useMutation({
    mutationFn: async (revisionId: string) => {
      await api.delete(`/grade-revisions/${revisionId}`);
    },
    onSuccess: after,
  });
}

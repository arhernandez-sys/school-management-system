import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { announcementKeys } from '@features/announcements/hooks/useAnnouncements';
import { decideReopen, fetchReopenRequests, requestReopen, withdrawReopen } from '../api/gradesApi';
import { gradeKeys } from './useGrades';
import type { ReopenDecisionPayload, ReopenRequestStatus } from '../types';

/**
 * D47 — reopening a closed marking window. Mirrors `useRevisions.ts`: every mutation
 * invalidates the queue, the BELL (the Dean's badge counts pending requests) and the
 * gradebooks (an approval reopens entry, so the grading screen unlocks).
 */
export const reopenKeys = {
  all: ['assessment-reopens'] as const,
  list: (status?: ReopenRequestStatus) => [...reopenKeys.all, 'list', status ?? null] as const,
};

export function useReopenRequests(status?: ReopenRequestStatus, enabled = true) {
  return useQuery({
    queryKey: reopenKeys.list(status),
    queryFn: ({ signal }) => fetchReopenRequests(status, signal),
    placeholderData: (prev) => prev,
    enabled,
  });
}

function useAfterReopenChange() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: reopenKeys.all, exact: false });
    void qc.invalidateQueries({ queryKey: announcementKeys.unreadCount() });
    void qc.invalidateQueries({ queryKey: gradeKeys.all, exact: false });
  };
}

export function useRequestReopen() {
  const after = useAfterReopenChange();
  return useMutation({
    mutationFn: ({ assessmentId, reason }: { assessmentId: string; reason: string }) =>
      requestReopen(assessmentId, reason),
    onSuccess: after,
  });
}

/** **Dean only** server-side. A 403 here is the permission boundary, not a bug. */
export function useDecideReopen() {
  const after = useAfterReopenChange();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: ReopenDecisionPayload }) =>
      decideReopen(requestId, body),
    onSuccess: after,
  });
}

export function useWithdrawReopen() {
  const after = useAfterReopenChange();
  return useMutation({
    mutationFn: (requestId: string) => withdrawReopen(requestId),
    onSuccess: after,
  });
}

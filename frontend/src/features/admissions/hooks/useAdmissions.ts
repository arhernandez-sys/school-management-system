import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/admissionsApi';
import type {
  AcceptPayload,
  ApplicationCreatePayload,
  ApplicationDetail,
  ApplicationWritePayload,
  ApplicationsListParams,
  CreditTransferDecisionPayload,
  CreditTransferStatus,
  CreditTransferWritePayload,
  DocumentRow,
  EducationRow,
  PendingApplicationWritePayload,
  PendingApplicationsListParams,
} from '../types';

export const admissionKeys = {
  all: ['applications'] as const,
  list: (params: ApplicationsListParams) => [...admissionKeys.all, 'list', params] as const,
  detail: (id: string) => [...admissionKeys.all, 'detail', id] as const,
  transfers: (params: { status?: CreditTransferStatus; application_id?: string }) =>
    ['credit-transfers', params] as const,
};

export function useApplications(params: ApplicationsListParams) {
  return useQuery({
    queryKey: admissionKeys.list(params),
    queryFn: ({ signal }) => api.listApplications(params, signal),
    placeholderData: (prev) => prev,
  });
}

export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: admissionKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.getApplication(id!, signal),
    enabled: Boolean(id),
  });
}

export function useCreditTransferQueue(status?: CreditTransferStatus) {
  return useQuery({
    queryKey: admissionKeys.transfers({ status }),
    queryFn: ({ signal }) => api.listCreditTransfers({ status }, signal),
  });
}

/**
 * Every application write returns the WHOLE application, so the detail cache is SET from
 * the response rather than invalidated-and-refetched.
 *
 * That is what keeps the seven-step wizard from flickering: each step patches, gets the
 * merged record back, and the next step renders from it immediately. It also means
 * `blocking_issues` is always the server's current answer — the browser never computes
 * its own version of the completeness rules and never shows a stale one.
 *
 * The LISTS are still invalidated: status and `pending_credit_transfers` change the row.
 */
function useApplyApplication() {
  const qc = useQueryClient();
  return (application: ApplicationDetail) => {
    qc.setQueryData(admissionKeys.detail(application.id), application);
    void qc.invalidateQueries({ queryKey: admissionKeys.all, exact: false });
  };
}

export function useCreateApplication() {
  const apply = useApplyApplication();
  return useMutation({
    mutationFn: (body: ApplicationCreatePayload) => api.createApplication(body),
    onSuccess: apply,
  });
}

export function useUpdateApplication() {
  const apply = useApplyApplication();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApplicationWritePayload }) =>
      api.updateApplication(id, body),
    onSuccess: apply,
  });
}

export function useDeleteApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: admissionKeys.all, exact: false }),
  });
}

export function useSubmitApplication() {
  const apply = useApplyApplication();
  return useMutation({ mutationFn: (id: string) => api.submitApplication(id), onSuccess: apply });
}

export function useReviewApplication() {
  const apply = useApplyApplication();
  return useMutation({ mutationFn: (id: string) => api.reviewApplication(id), onSuccess: apply });
}

export function useDenyApplication() {
  const apply = useApplyApplication();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string | null }) =>
      api.denyApplication(id, reason),
    onSuccess: apply,
  });
}

export function useWithdrawApplication() {
  const apply = useApplyApplication();
  return useMutation({ mutationFn: (id: string) => api.withdrawApplication(id), onSuccess: apply });
}

/**
 * Acceptance also touches STUDENTS — it creates one — so the students caches are
 * invalidated alongside. Without that the new student is missing from the list the
 * Registrar navigates to straight afterwards.
 */
export function useAcceptApplication() {
  const apply = useApplyApplication();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AcceptPayload }) =>
      api.acceptApplication(id, body),
    onSuccess: (res) => {
      apply(res.application);
      void qc.invalidateQueries({ queryKey: ['students'], exact: false });
    },
  });
}

export function useReplaceEducation() {
  const apply = useApplyApplication();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: EducationRow[] }) =>
      api.replaceEducation(id, items),
    onSuccess: apply,
  });
}

export function useReplaceDocuments() {
  const apply = useApplyApplication();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: DocumentRow[] }) =>
      api.replaceDocuments(id, items),
    onSuccess: apply,
  });
}

/**
 * The credit-transfer mutations return the TRANSFER, not the application — so unlike the
 * application writes these invalidate rather than set. The application's
 * `blocking_issues` and `pending_credit_transfers` both move with a decision, and neither
 * is derivable from the transfer row alone.
 */
function useInvalidateTransfers() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: admissionKeys.all, exact: false });
    void qc.invalidateQueries({ queryKey: ['credit-transfers'], exact: false });
  };
}

export function useCreateCreditTransfer() {
  const invalidate = useInvalidateTransfers();
  return useMutation({
    mutationFn: ({
      applicationId,
      body,
    }: {
      applicationId: string;
      body: CreditTransferWritePayload;
    }) => api.createCreditTransfer(applicationId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateCreditTransfer() {
  const invalidate = useInvalidateTransfers();
  return useMutation({
    mutationFn: ({
      transferId,
      body,
    }: {
      transferId: string;
      body: Partial<CreditTransferWritePayload>;
    }) => api.updateCreditTransfer(transferId, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCreditTransfer() {
  const invalidate = useInvalidateTransfers();
  return useMutation({
    mutationFn: (transferId: string) => api.deleteCreditTransfer(transferId),
    onSuccess: invalidate,
  });
}

/** **Dean only** (brief §13, §D14). */
export function useDecideCreditTransfer() {
  const invalidate = useInvalidateTransfers();
  return useMutation({
    mutationFn: ({
      transferId,
      body,
    }: {
      transferId: string;
      body: CreditTransferDecisionPayload;
    }) => api.decideCreditTransfer(transferId, body),
    onSuccess: invalidate,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * D38 · pending forms
 *
 * These invalidate rather than set. A pending write returns the pending row, but the
 * thing that changed for the USER is which list it appears in — and a promotion moves a
 * row out of `pending` and into `applications` entirely, so both caches are stale after
 * it. Setting one entry would leave the other list showing a form that is no longer there.
 * ──────────────────────────────────────────────────────────────────────────── */
export const pendingKeys = {
  all: ['pending-applications'] as const,
  list: (params: PendingApplicationsListParams) => [...pendingKeys.all, 'list', params] as const,
  detail: (id: string) => [...pendingKeys.all, 'detail', id] as const,
};

export function usePendingApplications(params: PendingApplicationsListParams) {
  return useQuery({
    queryKey: pendingKeys.list(params),
    queryFn: ({ signal }) => api.listPendingApplications(params, signal),
    placeholderData: (prev) => prev,
  });
}

export function usePendingApplication(id: string | undefined) {
  return useQuery({
    queryKey: pendingKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.getPendingApplication(id!, signal),
    enabled: Boolean(id),
  });
}

function useInvalidatePending() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: pendingKeys.all, exact: false });
  };
}

export function useCreatePendingApplication() {
  const invalidate = useInvalidatePending();
  return useMutation({
    mutationFn: (body: PendingApplicationWritePayload) => api.createPendingApplication(body),
    onSuccess: invalidate,
  });
}

export function useUpdatePendingApplication() {
  const invalidate = useInvalidatePending();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PendingApplicationWritePayload }) =>
      api.updatePendingApplication(id, body),
    onSuccess: invalidate,
  });
}

export function useDeletePendingApplication() {
  const invalidate = useInvalidatePending();
  return useMutation({
    mutationFn: (id: string) => api.deletePendingApplication(id),
    onSuccess: invalidate,
  });
}

/**
 * *Save and submit*. Invalidates BOTH caches: the row leaves the pending table and
 * arrives in the admissions list, so either one alone would be showing a lie.
 */
export function useSubmitPendingApplication() {
  const qc = useQueryClient();
  const apply = useApplyApplication();
  return useMutation({
    mutationFn: (id: string) => api.submitPendingApplication(id),
    onSuccess: (application) => {
      apply(application);
      void qc.invalidateQueries({ queryKey: pendingKeys.all, exact: false });
    },
  });
}

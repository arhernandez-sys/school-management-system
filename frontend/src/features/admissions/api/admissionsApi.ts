import { api } from '@shared/api/client';
import type {
  AcceptPayload,
  AcceptResponse,
  ApplicationCreatePayload,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationWritePayload,
  ApplicationsListParams,
  CreditTransfer,
  CreditTransferDecisionPayload,
  CreditTransferStatus,
  CreditTransferWritePayload,
  DocumentRow,
  EducationRow,
  PendingApplicationDetail,
  PendingApplicationListItem,
  PendingApplicationWritePayload,
  PendingApplicationsListParams,
} from '../types';
import type { Page } from '@shared/types/api';

/**
 * Admissions transport (D30 §D11). Calls the shared axios `client` directly — the
 * admissions endpoints are not in the served OpenAPI, so there are no orval hooks and
 * `npm run generate:api` is forbidden. Same arrangement as Students and Programmes.
 *
 * **The transitions are POSTs to named sub-paths**, not a PATCH of `status`. Each does
 * more than set a field — accept creates a user, a student and an ID — so a client that
 * could write `status` directly would be able to skip all of it.
 */
export async function listApplications(
  params: ApplicationsListParams,
  signal?: AbortSignal,
): Promise<Page<ApplicationListItem>> {
  const res = await api.get<Page<ApplicationListItem>>('/applications', { params, signal });
  return res.data;
}

export async function getApplication(
  id: string,
  signal?: AbortSignal,
): Promise<ApplicationDetail> {
  const res = await api.get<ApplicationDetail>(`/applications/${id}`, { signal });
  return res.data;
}

export async function createApplication(
  body: ApplicationCreatePayload,
): Promise<ApplicationDetail> {
  const res = await api.post<ApplicationDetail>('/applications', body);
  return res.data;
}

export async function updateApplication(
  id: string,
  body: ApplicationWritePayload,
): Promise<ApplicationDetail> {
  const res = await api.patch<ApplicationDetail>(`/applications/${id}`, body);
  return res.data;
}

export async function deleteApplication(id: string): Promise<void> {
  await api.delete(`/applications/${id}`);
}

export async function submitApplication(id: string): Promise<ApplicationDetail> {
  const res = await api.post<ApplicationDetail>(`/applications/${id}/submit`);
  return res.data;
}

export async function reviewApplication(id: string): Promise<ApplicationDetail> {
  const res = await api.post<ApplicationDetail>(`/applications/${id}/review`);
  return res.data;
}

export async function denyApplication(
  id: string,
  reason?: string | null,
): Promise<ApplicationDetail> {
  const res = await api.post<ApplicationDetail>(`/applications/${id}/deny`, { reason });
  return res.data;
}

export async function withdrawApplication(id: string): Promise<ApplicationDetail> {
  const res = await api.post<ApplicationDetail>(`/applications/${id}/withdraw`);
  return res.data;
}

export async function acceptApplication(
  id: string,
  body: AcceptPayload,
): Promise<AcceptResponse> {
  const res = await api.post<AcceptResponse>(`/applications/${id}/accept`, body);
  return res.data;
}

/** Section B — a whole-set replace; `sort_order` is renumbered server-side. */
export async function replaceEducation(
  id: string,
  items: EducationRow[],
): Promise<ApplicationDetail> {
  const res = await api.put<ApplicationDetail>(`/applications/${id}/education`, { items });
  return res.data;
}

/**
 * Section F — reconciled by id server-side, so a row cited by a credit transfer keeps its
 * papers. Sending an existing row WITHOUT its `id` would create a duplicate, which is why
 * the checklist editor round-trips ids rather than rebuilding the list from the enum.
 */
export async function replaceDocuments(
  id: string,
  items: DocumentRow[],
): Promise<ApplicationDetail> {
  const res = await api.put<ApplicationDetail>(`/applications/${id}/documents`, { items });
  return res.data;
}

export async function listCreditTransfers(
  params: { status?: CreditTransferStatus; application_id?: string },
  signal?: AbortSignal,
): Promise<CreditTransfer[]> {
  const res = await api.get<CreditTransfer[]>('/credit-transfers', { params, signal });
  return res.data;
}

export async function createCreditTransfer(
  applicationId: string,
  body: CreditTransferWritePayload,
): Promise<CreditTransfer> {
  const res = await api.post<CreditTransfer>(
    `/applications/${applicationId}/credit-transfers`,
    body,
  );
  return res.data;
}

export async function updateCreditTransfer(
  transferId: string,
  body: Partial<CreditTransferWritePayload>,
): Promise<CreditTransfer> {
  const res = await api.patch<CreditTransfer>(`/credit-transfers/${transferId}`, body);
  return res.data;
}

export async function deleteCreditTransfer(transferId: string): Promise<void> {
  await api.delete(`/credit-transfers/${transferId}`);
}

/** **Dean only** (brief §13). A 403 here is the permission boundary, not a bug. */
export async function decideCreditTransfer(
  transferId: string,
  body: CreditTransferDecisionPayload,
): Promise<CreditTransfer> {
  const res = await api.post<CreditTransfer>(`/credit-transfers/${transferId}/decision`, body);
  return res.data;
}

/* ────────────────────────────────────────────────────────────────────────────
 * D38 · pending forms
 *
 * A separate prefix, not `/applications/pending`: under the applications router the
 * literal segment would have to be declared before `/{id}` or the server would try to
 * parse "pending" as a UUID. Same reasoning as `/credit-transfers`.
 *
 * Row-level scope is the SERVER's: a Registrar reaches only what they filed, the Dean
 * reaches everything, and someone else's row answers 404 rather than 403.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function listPendingApplications(
  params: PendingApplicationsListParams,
  signal?: AbortSignal,
): Promise<Page<PendingApplicationListItem>> {
  const res = await api.get<Page<PendingApplicationListItem>>('/pending-applications', {
    params,
    signal,
  });
  return res.data;
}

export async function getPendingApplication(
  id: string,
  signal?: AbortSignal,
): Promise<PendingApplicationDetail> {
  const res = await api.get<PendingApplicationDetail>(`/pending-applications/${id}`, { signal });
  return res.data;
}

/** *Save and close* on a form that is not yet on disk. The WHOLE form, in one body. */
export async function createPendingApplication(
  body: PendingApplicationWritePayload,
): Promise<PendingApplicationDetail> {
  const res = await api.post<PendingApplicationDetail>('/pending-applications', body);
  return res.data;
}

/** *Save and close* on a form already on disk. Whole-form, not a per-section patch. */
export async function updatePendingApplication(
  id: string,
  body: PendingApplicationWritePayload,
): Promise<PendingApplicationDetail> {
  const res = await api.patch<PendingApplicationDetail>(`/pending-applications/${id}`, body);
  return res.data;
}

/** HARD, unlike an application: there is no admissions record to keep. */
export async function deletePendingApplication(id: string): Promise<void> {
  await api.delete(`/pending-applications/${id}`);
}

/**
 * *Save and submit*. Promotes the pending row into `applications`, expands its two JSON
 * arrays into the real child tables, and deletes it from the holding table.
 *
 * Returns the **application** — the pending form no longer exists. A 422 leaves the
 * pending row untouched, so a refused submit never costs the Registrar their typing.
 */
export async function submitPendingApplication(id: string): Promise<ApplicationDetail> {
  const res = await api.post<ApplicationDetail>(`/pending-applications/${id}/submit`);
  return res.data;
}

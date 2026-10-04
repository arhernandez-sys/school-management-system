import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { AuditFilters, AuditPage, AuditQuery, AuditReport } from '../types';

/**
 * Audit trail reads (D45 §46, §53). There is no mutation hook here and there must never
 * be one — `audit_log` is append-only and has no write endpoint. Rows are written as a
 * side effect of the action they describe.
 */
export const auditKeys = {
  all: ['audit'] as const,
  page: (q: AuditQuery) => [...auditKeys.all, 'page', q] as const,
  filters: () => [...auditKeys.all, 'filters'] as const,
  reports: () => [...auditKeys.all, 'reports'] as const,
};

export function useAuditPage(query: AuditQuery, enabled = true) {
  return useQuery({
    queryKey: auditKeys.page(query),
    enabled,
    queryFn: async ({ signal }) => {
      const res = await api.get<AuditPage>('/audit', {
        // Empty strings are dropped rather than sent: `?module=` would be a filter on
        // the empty module and return nothing, which reads as "no activity" instead of
        // "no filter".
        params: Object.fromEntries(
          Object.entries(query).filter(([, v]) => v !== undefined && v !== ''),
        ),
        signal,
      });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useAuditFilters(enabled = true) {
  return useQuery({
    queryKey: auditKeys.filters(),
    enabled,
    queryFn: async ({ signal }) => {
      const res = await api.get<AuditFilters>('/audit/filters', { signal });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAuditReports(enabled = true) {
  return useQuery({
    queryKey: auditKeys.reports(),
    enabled,
    queryFn: async ({ signal }) => {
      const res = await api.get<AuditReport[]>('/audit/reports', { signal });
      return res.data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

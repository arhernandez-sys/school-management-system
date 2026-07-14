/**
 * Dashboard data hook (api-spec Module 2). Thin wrapper over the shared axios client +
 * TanStack Query so the composite `GET /dashboard` drives real loading / error / empty
 * states on the page. There is no orval-generated hook for this endpoint yet, so we
 * call the shared `api` instance directly (it carries the Bearer + refresh interceptors)
 * and let the MSW handler shape the role-discriminated payload server-side.
 *
 * The query key is scoped by role so switching demo users refetches the right variant
 * rather than showing another role's cached payload.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { DashboardResponse, Role } from '../types';

export const dashboardQueryKey = (role: Role | undefined) => ['dashboard', role ?? 'unknown'] as const;

async function fetchDashboard(): Promise<DashboardResponse> {
  const { data } = await api.get<DashboardResponse>('/dashboard');
  return data;
}

export function useDashboard(role: Role | undefined) {
  return useQuery({
    queryKey: dashboardQueryKey(role),
    queryFn: fetchDashboard,
    // Dashboard aggregates are cheap to recompute but change rarely mid-session.
    staleTime: 60 * 1000,
  });
}

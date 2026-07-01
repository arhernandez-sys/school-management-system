import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@shared/api/client';

/**
 * QueryClient with sensible defaults (architecture §7.1).
 *
 * - Default staleTime is short; reference/config queries (semesters, grading scale,
 *   school profile) override with a long staleTime at the hook level.
 * - Do NOT retry 4xx (client errors) — only transient/5xx/network. A 401 is handled
 *   by the HTTP client's single-flight refresh, not by query retry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — volatile data default; reference data overrides per-hook
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Announcements data hooks (api-spec §5 Module 9).
 *
 * Thin wrappers over the shared axios `api` instance (Bearer + single-flight refresh +
 * credentialed cookie) and TanStack Query. There is no orval-generated client for
 * Announcements yet, so we call `api` directly and let the MSW handler shape the
 * role-targeted payloads server-side.
 *
 * Query-key factory keeps invalidation precise: any write invalidates the whole
 * `announcements` subtree (feed + detail) AND the unread-count so the feed's read
 * indicators and the shell bell stay reconciled.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type {
  AnnouncementDetail,
  AnnouncementListParams,
  AnnouncementWritePayload,
  AnnouncementsPageResult,
  TargetClass,
} from '../types';

export const announcementKeys = {
  all: ['announcements'] as const,
  list: (params: AnnouncementListParams) => [...announcementKeys.all, 'list', params] as const,
  detail: (id: string) => [...announcementKeys.all, 'detail', id] as const,
  unreadCount: () => [...announcementKeys.all, 'unread-count'] as const,
  targetClasses: () => [...announcementKeys.all, 'target-classes'] as const,
};

/** Build the query string, omitting empty values so keys stay stable. */
function toQuery(params: AnnouncementListParams): Record<string, string> {
  const q: Record<string, string> = {};
  if (params.page) q.page = String(params.page);
  if (params.page_size) q.page_size = String(params.page_size);
  if (params.audience) q.audience = params.audience;
  if (params.unread_only) q.unread_only = 'true';
  return q;
}

/** GET /announcements — targeted, newest-first feed. */
export function useAnnouncementsList(params: AnnouncementListParams) {
  return useQuery({
    queryKey: announcementKeys.list(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AnnouncementsPageResult>('/announcements', {
        params: toQuery(params),
        signal,
      });
      return data;
    },
    placeholderData: (prev) => prev, // keep the previous page during pagination
  });
}

/** GET /announcements/{id} — full detail (404 if it does not target the caller). */
export function useAnnouncementDetail(id: string | null) {
  return useQuery({
    queryKey: announcementKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AnnouncementDetail>(`/announcements/${id}`, { signal });
      return data;
    },
  });
}

/** GET /announcements/unread-count — bell badge source. */
export function useUnreadCount() {
  return useQuery({
    queryKey: announcementKeys.unreadCount(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ unread_count: number }>('/announcements/unread-count', {
        signal,
      });
      return data.unread_count;
    },
    staleTime: 30 * 1000,
  });
}

/** GET /announcements/target-classes — sections the caller may target (compose picker). */
export function useTargetClasses(enabled: boolean) {
  return useQuery({
    queryKey: announcementKeys.targetClasses(),
    enabled,
    staleTime: 5 * 60 * 1000, // reference-ish; changes rarely mid-session
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ items: TargetClass[] }>('/announcements/target-classes', {
        signal,
      });
      return data.items;
    },
  });
}

/** Invalidate the whole announcements subtree + the unread count. */
function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: announcementKeys.all });
}

export function useCreateAnnouncement() {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: async (payload: AnnouncementWritePayload) => {
      const { data } = await api.post<AnnouncementDetail>('/announcements', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateAnnouncement() {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: AnnouncementWritePayload }) => {
      const { data } = await api.patch<AnnouncementDetail>(`/announcements/${id}`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAnnouncement() {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/announcements/${id}`);
    },
    onSuccess: invalidate,
  });
}

export function useMarkRead() {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/announcements/${id}/read`, null);
    },
    onSuccess: invalidate,
  });
}

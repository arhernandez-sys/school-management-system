/**
 * Calendar data hooks. Thin TanStack Query wrappers over the shared axios `api`
 * (Bearer + refresh + credentialed cookie). The Events endpoints aren't in the
 * orval-generated surface, so these call the transport directly; the MSW handler
 * enforces role (only principal/secretary may write). Any write invalidates the
 * whole `events` subtree so every view reconciles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/api/client';
import type { CalendarEvent, EventsResponse, EventWritePayload } from '../types';

export const eventKeys = {
  all: ['events'] as const,
  list: () => [...eventKeys.all, 'list'] as const,
};

/** GET /events — the full school-wide feed + the server reference date. */
export function useEvents() {
  return useQuery({
    queryKey: eventKeys.list(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<EventsResponse>('/events', { signal });
      return data;
    },
  });
}

function useInvalidateEvents() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: eventKeys.all });
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: async (payload: EventWritePayload) => {
      const { data } = await api.post<CalendarEvent>('/events', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: EventWritePayload }) => {
      const { data } = await api.patch<CalendarEvent>(`/events/${id}`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/events/${id}`);
    },
    onSuccess: invalidate,
  });
}

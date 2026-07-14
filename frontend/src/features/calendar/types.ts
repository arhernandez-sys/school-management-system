/**
 * Calendar module wire types. Mirror the MSW handler shapes in
 * `mocks/handlers/events.ts` exactly (snake_case). Events are school-wide: every role
 * reads the same feed; principal & secretary create/edit/delete.
 */

export type EventCategory = 'holiday' | 'exam' | 'meeting' | 'activity' | 'other';

/** `global` = everyone; `internal` = staff only (teachers + principal + secretary). */
export type EventVisibility = 'global' | 'internal';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  visibility: EventVisibility;
  /** Inclusive YYYY-MM-DD range; `end_date === null` means a single-day event. */
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  start_time: string | null; // HH:mm
  end_time: string | null;
  location: string | null;
  created_by: { id: string; full_name: string };
  created_at: string;
}

/** GET /events response. `reference_date` is the server "today" (anchors the demo). */
export interface EventsResponse {
  items: CalendarEvent[];
  reference_date: string;
}

/** Body for POST/PATCH /events. */
export interface EventWritePayload {
  title: string;
  description: string | null;
  category: EventCategory;
  visibility: EventVisibility;
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
}

import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  DEMO_TODAY,
  DEMO_TODAY_ISO,
  getEvent,
  listEvents,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoEvent,
  DemoUser,
  EventCategory,
  EventVisibility,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for the CALENDAR / EVENTS module — DEMO.
 *
 * Two visibilities, chosen by the author: `global` events reach EVERY role; `internal`
 * events reach staff only (principal, secretary, teacher) and are hidden from students.
 * Only principal & secretary may create/edit/delete. The acting user is resolved from
 * the mock session role cookie (`sis_mock_session=<role>`) → a seeded dataset user,
 * exactly like announcements.ts, so authorship anchors to a real id.
 *
 * Endpoints:
 *   GET    /events            — { items: EventView[], reference_date }  (all roles)
 *   POST   /events            — create (principal/secretary) → 201
 *   PATCH  /events/{id}        — edit (principal/secretary)
 *   DELETE /events/{id}        — delete (principal/secretary) → 204
 *
 * `reference_date` is the demo "today" so the calendar opens onto the seeded month
 * without depending on the browser clock; a real backend would send the server date.
 *
 * ⚠️ Adding a brand-new module here, so this file IS wired into handlers/index.ts.
 */
const D = DEMO_DATASET;

const USER_BY_ROLE: Record<string, string> = {
  principal: DEMO_IDS.principalUserId,
  secretary: 'user-secretary',
  teacher: 'user-teach-1',
  student: 'user-stu-1',
};

/** Resolve the acting dataset user from the mock session role cookie. */
function currentUser(cookies: Record<string, string>): DemoUser {
  const role = cookies['sis_mock_session'] ?? 'principal';
  const userId = USER_BY_ROLE[role] ?? USER_BY_ROLE.principal!;
  return D.users.find((u) => u.id === userId) ?? D.users[0]!;
}

/** Only principal & secretary manage the shared school calendar. */
function canManage(user: DemoUser): boolean {
  return user.role === 'principal' || user.role === 'secretary';
}

/** Students only see `global` events; staff (P/S/teacher) see everything. */
function canSee(user: DemoUser, e: DemoEvent): boolean {
  return e.visibility === 'global' || user.role !== 'student';
}

const VALID_CATEGORIES: EventCategory[] = ['holiday', 'exam', 'meeting', 'activity', 'other'];
const VALID_VISIBILITIES: EventVisibility[] = ['global', 'internal'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function eventView(e: DemoEvent) {
  const author = D.users.find((u) => u.id === e.created_by_user_id);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    category: e.category,
    visibility: e.visibility,
    start_date: e.start_date,
    end_date: e.end_date,
    all_day: e.all_day,
    start_time: e.start_time,
    end_time: e.end_time,
    location: e.location,
    created_by: { id: e.created_by_user_id, full_name: author?.full_name ?? 'Unknown' },
    created_at: e.created_at,
  };
}

interface EventWriteBody {
  title?: string;
  description?: string | null;
  category?: EventCategory;
  visibility?: EventVisibility;
  start_date?: string;
  end_date?: string | null;
  all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
}

/** Shared field validation for create/edit. Returns a field-error map (empty = ok). */
function validate(body: EventWriteBody, existing?: DemoEvent): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  const title = body.title ?? existing?.title;
  if (title !== undefined && !title.trim()) fields.title = ['Title is required.'];
  if (!existing && (title === undefined || !title.trim())) fields.title = ['Title is required.'];

  const category = body.category ?? existing?.category;
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    fields.category = ['Choose a valid category.'];
  }

  const visibility = body.visibility ?? existing?.visibility;
  if (visibility !== undefined && !VALID_VISIBILITIES.includes(visibility)) {
    fields.visibility = ['Choose who can see this event.'];
  }

  const startDate = body.start_date ?? existing?.start_date;
  if (!existing && !startDate) fields.start_date = ['A start date is required.'];
  if (startDate && !DATE_RE.test(startDate)) fields.start_date = ['Use a valid date.'];

  const endDate = body.end_date !== undefined ? body.end_date : (existing?.end_date ?? null);
  if (endDate) {
    if (!DATE_RE.test(endDate)) fields.end_date = ['Use a valid date.'];
    else if (startDate && endDate < startDate) {
      fields.end_date = ['End date must be on or after the start date.'];
    }
  }

  const allDay = body.all_day !== undefined ? body.all_day : (existing?.all_day ?? true);
  const startTime = body.start_time !== undefined ? body.start_time : (existing?.start_time ?? null);
  const endTime = body.end_time !== undefined ? body.end_time : (existing?.end_time ?? null);
  if (!allDay) {
    if (!startTime) fields.start_time = ['A start time is required for a timed event.'];
    else if (!TIME_RE.test(startTime)) fields.start_time = ['Use 24-hour HH:mm.'];
    if (endTime) {
      if (!TIME_RE.test(endTime)) fields.end_time = ['Use 24-hour HH:mm.'];
      else if (startTime && TIME_RE.test(startTime) && endTime <= startTime) {
        fields.end_time = ['End time must be after the start time.'];
      }
    }
  }
  return fields;
}

export const eventsHandlers = [
  // ── GET /events — role-scoped feed (students: global only) ─────────────────────
  http.get(`${API_BASE_URL}/events`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const user = currentUser(cookies);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const items = listEvents(from, to)
      .filter((e) => canSee(user, e))
      .map(eventView);
    return HttpResponse.json({ items, reference_date: DEMO_TODAY });
  }),

  // ── POST /events — create (principal/secretary) ───────────────────────────────
  http.post(`${API_BASE_URL}/events`, async ({ request, cookies }) => {
    const user = currentUser(cookies);
    if (!canManage(user)) {
      return errorResponse(403, 'forbidden', 'Only administrators can add calendar events.');
    }
    const body = (await request.json()) as EventWriteBody;
    const fields = validate(body);
    if (Object.keys(fields).length > 0) {
      return errorResponse(422, 'validation_error', 'Please fix the highlighted fields.', fields);
    }

    const allDay = body.all_day ?? true;
    const created: DemoEvent = {
      id: `evt-new-${D.events.length + 1}`,
      title: body.title!.trim(),
      description: body.description?.trim() || null,
      category: body.category ?? 'other',
      visibility: body.visibility ?? 'global',
      start_date: body.start_date!,
      end_date: body.end_date || null,
      all_day: allDay,
      start_time: allDay ? null : (body.start_time ?? null),
      end_time: allDay ? null : (body.end_time ?? null),
      location: body.location?.trim() || null,
      created_by_user_id: user.id,
      created_at: DEMO_TODAY_ISO,
    };
    D.events.push(created);
    return HttpResponse.json(eventView(created), { status: 201 });
  }),

  // ── PATCH /events/{id} — edit (principal/secretary) ───────────────────────────
  http.patch(`${API_BASE_URL}/events/:id`, async ({ params, request, cookies }) => {
    const user = currentUser(cookies);
    if (!canManage(user)) {
      return errorResponse(403, 'forbidden', 'Only administrators can edit calendar events.');
    }
    const e = getEvent(String(params.id));
    if (!e) return errorResponse(404, 'not_found', 'Event not found.');

    const body = (await request.json()) as EventWriteBody;
    const fields = validate(body, e);
    if (Object.keys(fields).length > 0) {
      return errorResponse(422, 'validation_error', 'Please fix the highlighted fields.', fields);
    }

    if (body.title !== undefined) e.title = body.title.trim();
    if (body.description !== undefined) e.description = body.description?.trim() || null;
    if (body.category !== undefined) e.category = body.category;
    if (body.visibility !== undefined) e.visibility = body.visibility;
    if (body.start_date !== undefined) e.start_date = body.start_date;
    if (body.end_date !== undefined) e.end_date = body.end_date || null;
    if (body.all_day !== undefined) e.all_day = body.all_day;
    if (body.location !== undefined) e.location = body.location?.trim() || null;
    // Time fields only persist for timed events; an all-day event clears them.
    if (e.all_day) {
      e.start_time = null;
      e.end_time = null;
    } else {
      if (body.start_time !== undefined) e.start_time = body.start_time ?? null;
      if (body.end_time !== undefined) e.end_time = body.end_time ?? null;
    }
    return HttpResponse.json(eventView(e));
  }),

  // ── DELETE /events/{id} — delete (principal/secretary) → 204 ──────────────────
  http.delete(`${API_BASE_URL}/events/:id`, ({ params, cookies }) => {
    const user = currentUser(cookies);
    if (!canManage(user)) {
      return errorResponse(403, 'forbidden', 'Only administrators can delete calendar events.');
    }
    const e = getEvent(String(params.id));
    if (!e) return errorResponse(404, 'not_found', 'Event not found.');
    D.events = D.events.filter((x) => x.id !== e.id);
    return new HttpResponse(null, { status: 204 });
  }),
];

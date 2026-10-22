import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY,
  announcementsForUser,
  getCourse,
  getOffering,
  offeringLabel,
  offeringsOwnedByTeacher,
  paginate,
  unreadCountForUser,
} from '@shared/api/mocks/demo/dataset';
import type { DemoAnnouncement, DemoOffering, DemoUser } from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';
import { pendingRevisionsFor } from './revisions';

/**
 * MSW handlers for the ANNOUNCEMENTS module (api-spec §5 Module 9) — DEMO.
 *
 * Backs features/announcements/** offline against the shared demo dataset so the
 * targeted feed, detail, compose/edit, delete, mark-read and unread-count all render
 * real, reconciled data without a backend. Response shapes match the api-spec models
 * (AnnouncementListItem / AnnouncementDetail / AnnouncementAuthorRef /
 * AnnouncementOfferingRef).
 *
 * **D31** — the `class` audience targets an OFFERING (`offering_id`), and the 422 code is
 * `class_audience_requires_offering_id`. The audience enum member `'class'` is unchanged: it
 * is a shared wire value, and the backend's CHECK constraint
 * `ck_announcements_offering_audience` still enforces "audience='class' iff a target is set"
 * — a stakeholder rule, re-created rather than dropped when the column was re-pointed.
 *
 * "Current user" is resolved from the mock session role cookie (auth.ts sets
 * `sis_mock_session=<role>`) → a canonical seeded dataset user per role, exactly like
 * settings.ts resolves self. This anchors targeting + read-state + authorship to a
 * real dataset user id (the shell's CurrentUser id is `mock-<role>`, which is NOT a
 * dataset id, so we cannot use it here).
 *
 * Endpoints (api-spec §5 Module 9):
 *   GET    /announcements                — targeted feed, Page[AnnouncementListItem]
 *   GET    /announcements/unread-count   — { unread_count }
 *   GET    /announcements/target-offerings — offerings the caller may target (compose picker)
 *   GET    /announcements/{id}           — AnnouncementDetail (404 if not targeted)
 *   POST   /announcements                — create (per-audience ownership rule)
 *   PATCH  /announcements/{id}           — edit (author or principal)
 *   DELETE /announcements/{id}           — soft delete (author or principal) → 204
 *   POST   /announcements/{id}/read      — idempotent mark-read → 204
 *
 * ⚠️ Do NOT touch handlers/index.ts — `announcementsHandlers` is already wired.
 */
const D = DEMO_DATASET;

// Canonical dataset user per demo role. Chosen so each role sees meaningful targeted
// content. NOTE: the teacher maps to the CANONICAL demo teacher user-teach-1 (Maria
// Reyes) — the same seeded user every other handler (dashboard/grades/attendance/
// assessments/students) resolves the "teacher" session to — so the acting teacher is
// the same person across every tab. She owns sections, so class/teacher/all-audience
// announcements reach her; the student (user-stu-1, Freddy Lopez) receives offering notices.
const USER_BY_ROLE: Record<string, string> = {
  principal: 'user-principal',
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

const nowMs = () => new Date(`${DEMO_TODAY}T23:59:59Z`).getTime();

function isExpired(a: DemoAnnouncement): boolean {
  return Boolean(a.expires_at && new Date(a.expires_at).getTime() <= nowMs());
}

function userRef(userId: string) {
  const u = D.users.find((x) => x.id === userId);
  return { id: userId, full_name: u?.full_name ?? 'Unknown', role: u?.role ?? 'principal' };
}

/**
 * The narrow offering ref a feed row needs: the derived label plus the course name.
 *
 * Not the full shared `OfferingRef` — nothing on an announcement reads the term, the section
 * code or the credits, and shipping them would invite a screen to start depending on them.
 */
function offeringRef(offeringId: string | null) {
  if (!offeringId) return null;
  const offering = getOffering(offeringId);
  if (!offering) return null;
  return {
    id: offering.id,
    label: offeringLabel(offering),
    course_name: getCourse(offering.course_id)?.name ?? null,
  };
}

const BODY_PREVIEW_LEN = 140;
function bodyPreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > BODY_PREVIEW_LEN ? `${flat.slice(0, BODY_PREVIEW_LEN).trimEnd()}…` : flat;
}

function listItem(a: DemoAnnouncement, userId: string) {
  return {
    id: a.id,
    title: a.title,
    body_preview: bodyPreview(a.body),
    audience: a.audience,
    offering: offeringRef(a.offering_id),
    author: userRef(a.author_user_id),
    published_at: a.published_at,
    expires_at: a.expires_at,
    is_read: a.read_by_user_ids.includes(userId),
  };
}

function detail(a: DemoAnnouncement, userId: string) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience,
    offering: offeringRef(a.offering_id),
    author: userRef(a.author_user_id),
    published_at: a.published_at,
    expires_at: a.expires_at,
    is_read: a.read_by_user_ids.includes(userId),
  };
}

/** True if `user` may create an announcement with this audience/target (FR-ANN-02/07). */
function canCreate(user: DemoUser, audience: string, offeringId: string | null): boolean {
  if (user.role === 'principal' || user.role === 'secretary') return true;
  if (user.role === 'teacher') {
    // A lecturer may only post to an offering they teach — never broadcast.
    if (audience !== 'class' || !offeringId) return false;
    const teacher = D.teachers.find((t) => t.user_id === user.id);
    if (!teacher) return false;
    return offeringsOwnedByTeacher(teacher.id).some((o) => o.id === offeringId);
  }
  return false; // students never
}

/** Offerings the caller may target with a `class` announcement (compose picker source). */
function targetableOfferings(user: DemoUser): DemoOffering[] {
  if (user.role === 'principal' || user.role === 'secretary') {
    return D.offerings.filter((o) => !o.is_archived);
  }
  if (user.role === 'teacher') {
    const teacher = D.teachers.find((t) => t.user_id === user.id);
    return teacher ? offeringsOwnedByTeacher(teacher.id).filter((o) => !o.is_archived) : [];
  }
  return [];
}

interface AnnouncementWriteBody {
  title?: string;
  body?: string;
  audience?: DemoAnnouncement['audience'];
  offering_id?: string | null;
  published_at?: string | null;
  expires_at?: string | null;
}

export const announcementsHandlers = [
  // ── GET /announcements — targeted, most-recent-first feed ─────────────────────
  http.get(`${API_BASE_URL}/announcements`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const user = currentUser(cookies);
    const unreadOnly = url.searchParams.get('unread_only') === 'true';
    const audience = url.searchParams.get('audience');

    // announcementsForUser already applies role/section targeting + expiry + newest-first.
    let rows = announcementsForUser(user.id);
    if (audience) rows = rows.filter((a) => a.audience === audience);
    if (unreadOnly) rows = rows.filter((a) => !a.read_by_user_ids.includes(user.id));

    const items = rows.map((a) => listItem(a, user.id));
    // Preserve the selector's published_at-DESC order (paginate would re-sort by id
    // otherwise); default sort here is that pre-applied order.
    const params = listParamsFrom(url);
    const page = paginate(items as unknown as Array<Record<string, unknown>>, {
      ...params,
      sort: params.sort ?? null,
    });
    return HttpResponse.json(page);
  }),

  // ── GET /announcements/unread-count — bell badge ──────────────────────────────
  // D30 §D8 — extended with pending GRADE REVISIONS rather than adding a notifications
  // table. `unread_count` is the SUM, so a client reading only that field keeps working.
  // The revision component is what awaits the CALLER'S decision, so it is non-zero only
  // for the Dean: a badge counting a Lecturer's own pending request would nag them about
  // work only the Dean can do.
  http.get(`${API_BASE_URL}/announcements/unread-count`, ({ cookies }) => {
    const user = currentUser(cookies);
    const announcements = unreadCountForUser(user.id);
    const revisions = pendingRevisionsFor(cookies['sis_mock_session'] ?? 'principal');
    return HttpResponse.json({
      unread_count: announcements + revisions,
      unread_announcements: announcements,
      pending_grade_revisions: revisions,
    });
  }),

  // ── GET /announcements/target-offerings — offerings the caller may target ─────
  // A role-scoped source for the compose dialog, so it does not have to reach into
  // /offerings and re-derive who may be targeted.
  http.get(`${API_BASE_URL}/announcements/target-offerings`, ({ cookies }) => {
    const user = currentUser(cookies);
    const items = targetableOfferings(user).map((o) => ({
      id: o.id,
      label: offeringLabel(o),
      course_name: getCourse(o.course_id)?.name ?? null,
    }));
    return HttpResponse.json({ items });
  }),

  // ── GET /announcements/{id} — detail (must target the caller) ─────────────────
  http.get(`${API_BASE_URL}/announcements/:id`, ({ params, cookies }) => {
    const user = currentUser(cookies);
    const targeted = announcementsForUser(user.id);
    const a = targeted.find((x) => x.id === params.id);
    // Authors/principal can always read their own even if audience wouldn't target them.
    const own = D.announcements.find(
      (x) => x.id === params.id && (x.author_user_id === user.id || user.role === 'principal'),
    );
    const found = a ?? (own && !isExpired(own) ? own : undefined) ?? own;
    if (!found) return errorResponse(404, 'not_found', 'Announcement not found.');
    return HttpResponse.json(detail(found, user.id));
  }),

  // ── POST /announcements — create ──────────────────────────────────────────────
  http.post(`${API_BASE_URL}/announcements`, async ({ request, cookies }) => {
    const user = currentUser(cookies);
    const body = (await request.json()) as AnnouncementWriteBody;
    const audience = body.audience ?? 'all';
    const offeringId = audience === 'class' ? (body.offering_id ?? null) : null;

    if (!body.title?.trim() || !body.body?.trim()) {
      return errorResponse(422, 'validation_error', 'Title and body are required.', {
        ...(body.title?.trim() ? {} : { title: ['Title is required.'] }),
        ...(body.body?.trim() ? {} : { body: ['Body is required.'] }),
      });
    }
    if (audience === 'class' && !offeringId) {
      return errorResponse(
        422,
        'class_audience_requires_offering_id',
        'Choose a course offering for an offering-targeted announcement.',
        { offering_id: ['An offering is required for this audience.'] },
      );
    }
    if (user.role === 'teacher' && audience !== 'class') {
      return errorResponse(
        403,
        'teacher_cannot_broadcast',
        'Lecturers can only post announcements to their own offerings.',
      );
    }
    if (!canCreate(user, audience, offeringId)) {
      return errorResponse(403, 'forbidden', 'You cannot post to this audience.');
    }

    const publishedAt = body.published_at ?? `${DEMO_TODAY}T12:00:00Z`;
    if (body.expires_at && new Date(body.expires_at).getTime() <= new Date(publishedAt).getTime()) {
      return errorResponse(422, 'validation_error', 'Expiry must be after the publish date.', {
        expires_at: ['Expiry must be after the publish date.'],
      });
    }

    const created: DemoAnnouncement = {
      id: `ann-new-${D.announcements.length + 1}`,
      title: body.title.trim(),
      body: body.body.trim(),
      audience,
      offering_id: offeringId,
      author_user_id: user.id,
      published_at: publishedAt,
      expires_at: body.expires_at ?? null,
      read_by_user_ids: [user.id], // author has implicitly read their own
    };
    D.announcements.push(created);
    return HttpResponse.json(detail(created, user.id), { status: 201 });
  }),

  // ── PATCH /announcements/{id} — edit (author or principal) ────────────────────
  http.patch(`${API_BASE_URL}/announcements/:id`, async ({ params, request, cookies }) => {
    const user = currentUser(cookies);
    const a = D.announcements.find((x) => x.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Announcement not found.');
    if (a.author_user_id !== user.id && user.role !== 'principal') {
      return errorResponse(403, 'forbidden', 'Only the author or principal can edit this.');
    }
    const body = (await request.json()) as AnnouncementWriteBody;
    const audience = body.audience ?? a.audience;
    const offeringId = audience === 'class' ? (body.offering_id ?? a.offering_id) : null;

    if (body.title !== undefined && !body.title.trim()) {
      return errorResponse(422, 'validation_error', 'Title cannot be empty.', {
        title: ['Title is required.'],
      });
    }
    if (body.body !== undefined && !body.body.trim()) {
      return errorResponse(422, 'validation_error', 'Body cannot be empty.', {
        body: ['Body is required.'],
      });
    }
    if (audience === 'class' && !offeringId) {
      return errorResponse(
        422,
        'class_audience_requires_offering_id',
        'Choose a course offering for an offering-targeted announcement.',
        { offering_id: ['An offering is required for this audience.'] },
      );
    }
    // Re-check ownership for the (possibly changed) audience — a lecturer edit cannot
    // escalate to a broadcast or an offering they do not teach.
    if (user.role === 'teacher' && !canCreate(user, audience, offeringId)) {
      return errorResponse(
        403,
        'teacher_cannot_broadcast',
        'Lecturers can only post announcements to their own offerings.',
      );
    }
    const publishedAt = body.published_at ?? a.published_at;
    if (body.expires_at && new Date(body.expires_at).getTime() <= new Date(publishedAt).getTime()) {
      return errorResponse(422, 'validation_error', 'Expiry must be after the publish date.', {
        expires_at: ['Expiry must be after the publish date.'],
      });
    }

    if (body.title !== undefined) a.title = body.title.trim();
    if (body.body !== undefined) a.body = body.body.trim();
    a.audience = audience;
    a.offering_id = offeringId;
    if (body.published_at !== undefined && body.published_at) a.published_at = body.published_at;
    if (body.expires_at !== undefined) a.expires_at = body.expires_at ?? null;
    return HttpResponse.json(detail(a, user.id));
  }),

  // ── DELETE /announcements/{id} — author or principal → 204 ────────────────────
  http.delete(`${API_BASE_URL}/announcements/:id`, ({ params, cookies }) => {
    const user = currentUser(cookies);
    const a = D.announcements.find((x) => x.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Announcement not found.');
    if (a.author_user_id !== user.id && user.role !== 'principal') {
      return errorResponse(403, 'forbidden', 'Only the author or principal can delete this.');
    }
    D.announcements = D.announcements.filter((x) => x.id !== a.id);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── POST /announcements/{id}/read — idempotent mark-read → 204 ────────────────
  http.post(`${API_BASE_URL}/announcements/:id/read`, ({ params, cookies }) => {
    const user = currentUser(cookies);
    const targeted = announcementsForUser(user.id);
    const a = targeted.find((x) => x.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Announcement not found.');
    if (!a.read_by_user_ids.includes(user.id)) a.read_by_user_ids.push(user.id);
    return new HttpResponse(null, { status: 204 });
  }),
];

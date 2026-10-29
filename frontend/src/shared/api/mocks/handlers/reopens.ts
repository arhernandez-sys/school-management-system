import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  DEMO_TODAY_ISO,
  demoHodOfferingIds,
  demoUserIdFor,
  getCourse,
  getOffering,
  getSemester,
  isMarkingOpen,
  lecturerOwnsOffering,
  markingStateFor,
  offeringLabel,
  pendingReopenFor,
  reopenBlankCount,
  reopenUntilFor,
} from '@shared/api/mocks/demo/dataset';
import type { DemoAssessmentReopenRequest, DemoOffering } from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for MARKING-WINDOW REOPEN REQUESTS (D47) — DEMO.
 *
 * The mock mirror of `backend/app/modules/assessments/reopen.py` and the reopen routes at
 * the bottom of `assessments/router.py`, modelled — like the server — on the grade
 * revision workflow (`handlers/revisions.ts`):
 *
 *   Lecturer  REQUESTS, on an assessment in an offering they teach, once its 5-day window
 *             has closed, with a reason. May withdraw while it is pending.
 *   Dean      DECIDES. Approval sets `assessment.reopened_until` to 23:59:59 Belize on
 *             `today + granted_days` (1-14, default 2) and never moves it backwards.
 *
 * Guard ORDER is the server's, because the UI distinguishes the answers: role gate (403)
 * → body validation (422) → assessment (404) → ownership (404, no existence leak) → live
 * session (409) → window still open (409 `marking_open`) → already pending (409
 * `reopen_already_pending`).
 *
 * "Now" is `DEMO_TODAY_ISO`; ids come from a counter. No `Date.now()`, no randomness.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';
const REQUESTER_ROLES = new Set(['teacher', 'hod']);
const READER_ROLES = new Set(['principal', 'teacher', 'hod', 'auditor']);
const STATUSES = new Set(['pending', 'approved', 'denied']);

function sessionRole(cookies: Record<string, string>): string {
  return cookies[SESSION_COOKIE] ?? 'principal';
}

let idCounter = 0;
const nextId = (): string => {
  idCounter += 1;
  return `reopen-demo-${idCounter}`;
};

function offeringRef(offering: DemoOffering) {
  const course = getCourse(offering.course_id);
  const semester = getSemester(offering.semester_id);
  return {
    id: offering.id,
    course: course
      ? { id: course.id, name: course.name, code: course.code, credits: course.credits }
      : { id: offering.course_id, name: 'Unknown course', code: null, credits: null },
    semester: semester
      ? {
          id: semester.id,
          name: semester.name,
          sequence: semester.sequence,
          is_active: semester.is_active,
        }
      : null,
    section_code: offering.section_code,
    label: offeringLabel(offering),
  };
}

/** `reopen._read` — one request, fat enough for the Dean's queue to need no second call. */
function read(row: DemoAssessmentReopenRequest, role: string) {
  const assessment = D.assessments.find((a) => a.id === row.assessment_id);
  const offering = assessment ? getOffering(assessment.offering_id) : undefined;
  const window = assessment ? markingStateFor(assessment) : null;
  const requester = D.users.find((u) => u.id === row.requested_by_user_id);
  const decider = row.decided_by_user_id
    ? D.users.find((u) => u.id === row.decided_by_user_id)
    : undefined;
  return {
    id: row.id,
    assessment_id: row.assessment_id,
    assessment_title: assessment?.title ?? '',
    assessment_date: assessment?.assessment_date ?? null,
    max_score: assessment?.max_score ?? null,
    offering: offering ? offeringRef(offering) : null,
    status: row.status,
    reason: row.reason,
    granted_days: row.granted_days,
    decision_note: row.decision_note,
    decided_at: row.decided_at,
    created_at: row.created_at,
    // The ORIGINAL window end, and (after approval) the reopen instant.
    marking_closes_at: window?.closes_at ?? null,
    reopened_until: window?.reopened_until ?? null,
    blank_count: assessment ? reopenBlankCount(assessment) : 0,
    requested_by_user_id: row.requested_by_user_id,
    requested_by_name: requester?.full_name ?? '',
    decided_by_user_id: row.decided_by_user_id,
    decided_by_name: decider?.full_name ?? null,
    can_withdraw: row.status === 'pending' && row.requested_by_user_id === demoUserIdFor(role),
  };
}

/** `reopen.pending_for_actor` — non-zero only for the Dean, so the badge means "needs YOU". */
export function pendingReopensFor(role: string): number {
  if (role !== 'principal') return 0;
  return D.assessment_reopen_requests.filter((r) => r.status === 'pending').length;
}

export const reopensHandlers = [
  // ── GET /assessment-reopen-requests ─────────────────────────────────────────
  // The Dean and the Auditor see all; a Lecturer their own; a head of department their own
  // plus their programme's (the D43 rule the revision queue already follows).
  http.get(`${API_BASE_URL}/assessment-reopen-requests`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!READER_ROLES.has(role)) {
      return errorResponse(
        403,
        'forbidden',
        'Reopen requests are visible to the Dean and to the requesting Lecturer.',
      );
    }
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const offeringId = url.searchParams.get('offering_id');
    if (status && !STATUSES.has(status)) {
      return errorResponse(422, 'validation_error', 'Invalid status.', {
        status: ['Use pending, approved or denied.'],
      });
    }

    const offeringOf = (r: DemoAssessmentReopenRequest) =>
      D.assessments.find((a) => a.id === r.assessment_id)?.offering_id;
    const me = demoUserIdFor(role);
    let rows = [...D.assessment_reopen_requests];
    if (role === 'teacher') {
      rows = rows.filter((r) => r.requested_by_user_id === me);
    } else if (role === 'hod') {
      const scope = new Set(demoHodOfferingIds(role));
      rows = rows.filter((r) => {
        const off = offeringOf(r);
        return r.requested_by_user_id === me || (off !== undefined && scope.has(off));
      });
    }
    if (status) rows = rows.filter((r) => r.status === status);
    if (offeringId) rows = rows.filter((r) => offeringOf(r) === offeringId);
    // Oldest first, `id` as the tiebreak — `created_at` has whole-second precision.
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

    return HttpResponse.json({
      items: rows.map((r) => read(r, role)),
      pending_for_me: pendingReopensFor(role),
    });
  }),

  // ── POST /assessments/{id}/reopen-requests — the LECTURER asks ─────────────
  http.post(
    `${API_BASE_URL}/assessments/:assessmentId/reopen-requests`,
    async ({ params, request, cookies }) => {
      const role = sessionRole(cookies);
      if (!REQUESTER_ROLES.has(role)) {
        return errorResponse(
          403,
          'forbidden',
          'Only the Lecturer who teaches the course may ask to reopen marking.',
        );
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const reason = typeof body.reason === 'string' ? body.reason : '';
      const fields: Record<string, string[]> = {};
      if (reason.length < 1 || reason.length > 2000) {
        fields.reason = ['A reason of 1 to 2000 characters is required.'];
      }
      for (const key of Object.keys(body)) {
        if (key !== 'reason') fields[key] = ['Extra inputs are not permitted'];
      }
      if (Object.keys(fields).length > 0) {
        return errorResponse(422, 'validation_error', 'Please correct the highlighted fields.', fields);
      }

      const assessment = D.assessments.find((a) => a.id === String(params.assessmentId));
      if (!assessment) return errorResponse(404, 'not_found', 'Assessment not found.');
      const offering = getOffering(assessment.offering_id);
      if (!offering || !lecturerOwnsOffering(role, offering)) {
        return errorResponse(404, 'not_found', 'Resource not found.');
      }
      // `_assert_cs_year_writable`: a reopen in a session that can no longer change could
      // never be used.
      const sem = getSemester(offering.semester_id);
      const yearArchived =
        offering.is_archived ||
        D.academic_years.find((y) => y.id === sem?.academic_year_id)?.status === 'archived';
      if (yearArchived) return errorResponse(409, 'year_archived', 'The academic year is archived.');
      if (sem?.is_active !== true) {
        return errorResponse(
          409,
          'session_inactive',
          'This session is not active. Its assessments and grades are read-only.',
        );
      }
      if (isMarkingOpen(assessment)) {
        return errorResponse(
          409,
          'marking_open',
          'Marking is still open for this assessment — enter the marks directly.',
        );
      }
      if (pendingReopenFor(assessment.id)) {
        return errorResponse(
          409,
          'reopen_already_pending',
          'A reopen request for this assessment is already awaiting the Dean.',
        );
      }

      const created: DemoAssessmentReopenRequest = {
        id: nextId(),
        assessment_id: assessment.id,
        requested_by_user_id: demoUserIdFor(role),
        reason: reason.trim(),
        status: 'pending',
        granted_days: null,
        decided_by_user_id: null,
        decided_at: null,
        decision_note: null,
        created_at: DEMO_TODAY_ISO,
      };
      D.assessment_reopen_requests.push(created);
      return HttpResponse.json(read(created, role), { status: 201 });
    },
  ),

  // ── DELETE /assessment-reopen-requests/{id} — the requester withdraws ────────
  // A hard delete, since a pending request carries no ruling. A decided one is the
  // record and is never removed.
  http.delete(`${API_BASE_URL}/assessment-reopen-requests/:requestId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (!REQUESTER_ROLES.has(role)) {
      return errorResponse(403, 'forbidden', 'Only the requesting Lecturer may withdraw this.');
    }
    const row = D.assessment_reopen_requests.find((r) => r.id === String(params.requestId));
    if (!row || row.requested_by_user_id !== demoUserIdFor(role)) {
      return errorResponse(404, 'not_found', 'Reopen request not found.');
    }
    if (row.status !== 'pending') {
      return errorResponse(
        409,
        'reopen_decided',
        `This request has already been ${row.status}; the Dean's decision is kept.`,
      );
    }
    D.assessment_reopen_requests.splice(D.assessment_reopen_requests.indexOf(row), 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── POST /assessment-reopen-requests/{id}/decision — DEAN ONLY ──────────────
  http.post(
    `${API_BASE_URL}/assessment-reopen-requests/:requestId/decision`,
    async ({ params, request, cookies }) => {
      const role = sessionRole(cookies);
      if (role !== 'principal') {
        return errorResponse(403, 'forbidden', 'Only the Dean may decide a reopen request.');
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const fields: Record<string, string[]> = {};
      const status = body.status;
      if (typeof status !== 'string' || !STATUSES.has(status)) {
        fields.status = ['Use approved or denied.'];
      }
      const grantedDays = body.granted_days === undefined ? 2 : body.granted_days;
      if (
        typeof grantedDays !== 'number' ||
        !Number.isInteger(grantedDays) ||
        grantedDays < 1 ||
        grantedDays > 14
      ) {
        fields.granted_days = ['Must be a whole number of days from 1 to 14.'];
      }
      const note = body.decision_note ?? null;
      if (note !== null && (typeof note !== 'string' || note.length > 2000)) {
        fields.decision_note = ['At most 2000 characters.'];
      }
      for (const key of Object.keys(body)) {
        if (!['status', 'granted_days', 'decision_note'].includes(key)) {
          fields[key] = ['Extra inputs are not permitted'];
        }
      }
      if (Object.keys(fields).length > 0) {
        return errorResponse(422, 'validation_error', 'Please correct the highlighted fields.', fields);
      }

      const row = D.assessment_reopen_requests.find((r) => r.id === String(params.requestId));
      if (!row) return errorResponse(404, 'not_found', 'Reopen request not found.');
      if (row.status !== 'pending') {
        return errorResponse(409, 'reopen_decided', `This request has already been ${row.status}.`);
      }
      if (status === 'pending') {
        return errorResponse(422, 'validation_error', 'A decision must be approved or denied.', {
          status: ['Use approved or denied.'],
        });
      }
      const assessment = D.assessments.find((a) => a.id === row.assessment_id);
      if (!assessment) return errorResponse(404, 'not_found', 'The assessment no longer exists.');

      if (status === 'approved') {
        // Never backwards: a later, shorter approval cannot cut short a reopen running now.
        const until = reopenUntilFor(grantedDays as number);
        const current = assessment.reopened_until;
        assessment.reopened_until =
          current === null || Date.parse(until) > Date.parse(current) ? until : current;
        row.granted_days = grantedDays as number;
      }
      row.status = status as DemoAssessmentReopenRequest['status'];
      row.decided_by_user_id = DEMO_IDS.principalUserId;
      row.decided_at = DEMO_TODAY_ISO;
      row.decision_note = note as string | null;
      return HttpResponse.json(read(row, role));
    },
  ),
];

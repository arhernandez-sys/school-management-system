import { http, HttpResponse } from 'msw';
import type { RequestHandler } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  MARKING_WINDOW_DAYS,
  assessmentsForOffering,
  currentDemoStudent,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  gradesForAssessment,
  isMarkingOpen,
  lecturerOfferingIds,
  lecturerOwnsOffering,
  markingFieldsFor,
  offeringLabel,
  offeringsForStudent,
  offeringsForYear,
  paginate,
  plusSchoolDays,
  schoolDateOf,
} from '@shared/api/mocks/demo/dataset';
import type { DemoAssessment, DemoOffering } from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the ASSESSMENTS module (api-spec §5 Module 6) — DEMO.
 *
 * Backs features/assessments/** with the shared demo dataset so the assessment-first
 * (API-9) authoring flow renders real data offline. Response shapes mirror the api-spec
 * models (Page[AssessmentListItem], AssessmentDetail) in snake_case.
 *
 * **Caller identity.** The demo login carries only a role; the lecturer behind a `teacher`
 * or `hod` login is resolved by `currentDemoLecturer` (selectors), the same resolver the
 * grades, reopen and report handlers use. This file used to hard-code `teach-1` for the
 * teacher login only, so a head of department owned no offerings here while owning them
 * on the gradebook — the same person answered two ways.
 *
 * **D47 — no publish/release lifecycle.** `POST /assessments/{id}/status` is gone, as are
 * `status` / `is_released` on the wire. A new assessment is live at once and students see
 * every assessment on their offerings. Each row instead carries its 5-day MARKING WINDOW
 * (`markingFieldsFor`, the mirror of `assessments/marking.py`), and the window guards the
 * writes exactly as `assessments/service.py` does:
 *
 *   * POST with a date whose window has already passed  → 422 `marking_window_passed`
 *   * PATCH moving the date of a CLOSED assessment       → 409 `marking_closed`
 *   * PATCH moving it to a date whose window has passed  → 422 `marking_window_passed`
 *   * DELETE of a CLOSED assessment                      → 409 `marking_closed`
 *
 * Writes are the lecturer roles' only (403 for anyone else), on offerings they teach (404
 * otherwise — no existence leak) in the live session (409 `session_inactive`).
 *
 * Categories live in `handlers/offerings.ts` (`/offerings/{id}/categories`).
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';
const LECTURER_ROLES = new Set(['teacher', 'hod']);

/**
 * The server locks every assessment's weight at 1 (17 Oct 2026, `FIXED_ASSESSMENT_WEIGHT`):
 * a submitted `weight` is accepted (older clients send it) and ignored, and any edit brings
 * an older non-1 weight back to 1.
 */
const FIXED_ASSESSMENT_WEIGHT = 1;

const SESSION_INACTIVE_MESSAGE =
  'This session is not active. Its assessments and grades are read-only.';

// ── Response shaping (api-spec §4.4 refs + list/detail models) ─────────────────────
/** The shared `OfferingRef`, label from `offeringLabel` (the one derivation). */
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

function assessmentListItem(a: DemoAssessment) {
  const offering = getOffering(a.offering_id);
  return {
    id: a.id,
    title: a.title,
    offering: offering ? offeringRef(offering) : null,
    category_id: a.category_id,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    ...markingFieldsFor(a),
  };
}

function assessmentDetail(a: DemoAssessment, withStats = true) {
  const grades = gradesForAssessment(a.id);
  return {
    ...assessmentListItem(a),
    semester_id: a.semester_id,
    stats: withStats
      ? {
          grade_count: grades.length,
          graded_count: grades.filter((g) => g.status === 'graded').length,
          pending_count: grades.filter((g) => g.status === 'pending').length,
        }
      : null,
  };
}

// ── Write guards (assessments/service.py) ─────────────────────────────────────────
/** `_assert_cs_year_writable`: archived offering/year, then the live-session rule. */
function writableError(offering: DemoOffering) {
  const yearArchived =
    offering.is_archived ||
    D.academic_years.find((y) => y.id === getSemester(offering.semester_id)?.academic_year_id)
      ?.status === 'archived';
  if (yearArchived) return errorResponse(409, 'year_archived', 'The academic year is archived.');
  if (getSemester(offering.semester_id)?.is_active !== true) {
    return errorResponse(409, 'session_inactive', SESSION_INACTIVE_MESSAGE);
  }
  return null;
}

/** `_assert_marking_open` (the assessments-service wording). */
function markingClosedError() {
  return errorResponse(
    409,
    'marking_closed',
    'The marking window for this assessment has closed. Ask the Dean to reopen it first.',
  );
}

/**
 * `_assert_window_not_already_closed` — a date whose whole window is already in the past
 * would create an assessment locked from birth. Strict `<`: a date exactly five days ago
 * still closes tonight.
 */
function windowPassedError(assessmentDate: string | null | undefined) {
  if (!assessmentDate) return null;
  const today = schoolDateOf(DEMO_TODAY_ISO);
  if (plusSchoolDays(assessmentDate, MARKING_WINDOW_DAYS) < today) {
    return errorResponse(
      422,
      'marking_window_passed',
      `The assessment date is more than ${MARKING_WINDOW_DAYS} days ago, so its marking window has already closed.`,
      { assessment_date: [`Must be within the last ${MARKING_WINDOW_DAYS} days or later.`] },
    );
  }
  return null;
}

function categoryMismatch() {
  return errorResponse(
    409,
    'category_subject_mismatch',
    'Category does not belong to this subject offering.',
  );
}

function lecturerOnly() {
  return errorResponse(403, 'forbidden', 'Only the lecturer may change assessments.');
}

let newAssessmentSeq = 0;

export const assessmentsHandlers: RequestHandler[] = [
  // ── Picker feed: caller-scoped offerings with derived labels ─────────────────────
  // Scope comes from the SESSION COOKIE, not from the query string. As on the server, a
  // `teacher` is narrowed to the offerings they teach and a student to the ones they sit;
  // the Dean, Registrar, Auditor and a head of department see every offering of the year.
  http.get(`${API_BASE_URL}/assessments/offerings`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies[SESSION_COOKIE] ?? 'principal';
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;

    let rows: DemoOffering[];
    const student = currentDemoStudent(role);
    if (student) {
      // The offerings they sat in the SELECTED YEAR. No `is_archived` filter: a past year's
      // offerings are all archived by design; enrolment already scopes them to the year.
      rows = offeringsForStudent(student.id, yearId);
    } else {
      const inYear = yearId ? offeringsForYear(yearId) : D.offerings;
      const owned = role === 'teacher' ? new Set(lecturerOfferingIds(role)) : null;
      rows = owned ? inYear.filter((o) => owned.has(o.id)) : inYear;
    }

    // Course code then section code — never the formatted label.
    const items = rows
      .slice()
      .sort(
        (a, b) =>
          (getCourse(a.course_id)?.code ?? '').localeCompare(getCourse(b.course_id)?.code ?? '') ||
          (a.section_code ?? '').localeCompare(b.section_code ?? ''),
      )
      .map(offeringRef);
    return HttpResponse.json({ items });
  }),

  // ── Assessments list (Page[AssessmentListItem]) ───────────────────────────────────
  // `list_assessments`: a `teacher` is ALWAYS narrowed to their own offerings (not only
  // under `scope=me`), a student to the offerings they sit; no draft filter any more.
  http.get(`${API_BASE_URL}/assessments`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies[SESSION_COOKIE] ?? 'principal';
    const offeringId = url.searchParams.get('offering_id');
    const semesterId = url.searchParams.get('semester_id');

    let rows: DemoAssessment[];
    const student = currentDemoStudent(role);
    if (student) {
      const studentYearId =
        url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
      const ownIds = new Set(offeringsForStudent(student.id, studentYearId).map((o) => o.id));
      const visibleIds =
        offeringId && ownIds.has(offeringId)
          ? new Set([offeringId])
          : offeringId
            ? new Set<string>() // asked for someone else's offering → nothing
            : ownIds;
      rows = D.assessments.filter((a) => visibleIds.has(a.offering_id));
    } else {
      if (offeringId) {
        rows = assessmentsForOffering(offeringId);
      } else {
        // No specific offering: scope to the selected year (default active).
        const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
        const inYear = new Set((yearId ? offeringsForYear(yearId) : D.offerings).map((o) => o.id));
        rows = D.assessments.filter((a) => inYear.has(a.offering_id));
      }
      if (role === 'teacher') {
        const owned = new Set(lecturerOfferingIds(role));
        rows = rows.filter((a) => owned.has(a.offering_id));
      }
    }
    // Narrows within the year; composes with every scope branch above.
    if (semesterId) rows = rows.filter((a) => a.semester_id === semesterId);

    const page = paginate(rows.map(assessmentListItem) as unknown as Array<Record<string, unknown>>, {
      ...listParamsFrom(url),
      sort: url.searchParams.get('sort') ?? '-assessment_date',
    });
    return HttpResponse.json(page);
  }),

  // ── Assessment detail ─────────────────────────────────────────────────────────────
  // `get_assessment`: a `teacher` who does not teach it, or a student who does not sit
  // it, gets the same 404 as a nonexistent row. A student's detail carries no stats.
  http.get(`${API_BASE_URL}/assessments/:id`, ({ params, cookies }) => {
    const role = cookies[SESSION_COOKIE] ?? 'principal';
    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    if (role === 'teacher' && !lecturerOwnsOffering(role, getOffering(a.offering_id))) {
      return errorResponse(404, 'not_found', 'Resource not found.');
    }
    const student = currentDemoStudent(role);
    if (student) {
      const sits = offeringsForStudent(student.id).some((o) => o.id === a.offering_id);
      if (!sits) return errorResponse(404, 'not_found', 'Assessment not found.');
      return HttpResponse.json(assessmentDetail(a, false));
    }
    return HttpResponse.json(assessmentDetail(a));
  }),

  // ── Create (POST /assessments) — live at once (D47) ──────────────────────────────
  http.post(`${API_BASE_URL}/assessments`, async ({ request, cookies }) => {
    const role = cookies[SESSION_COOKIE] ?? 'principal';
    if (!LECTURER_ROLES.has(role)) return lecturerOnly();
    const body = (await request.json()) as {
      offering_id?: string;
      semester_id?: string;
      category_id?: string | null;
      title?: string;
      max_score?: number;
      weight?: number;
      assessment_date?: string | null;
    };

    const fields: Record<string, string[]> = {};
    const title = (body.title ?? '').trim();
    if (title.length < 1 || title.length > 160) {
      fields.title = ['Title must be between 1 and 160 characters.'];
    }
    // Assessment types were retired 16 Oct 2026 (column dropped); `extra="forbid"`.
    if ('type' in body) fields.type = ['Extra inputs are not permitted'];
    if ('status' in body) fields.status = ['Extra inputs are not permitted'];
    if (typeof body.max_score !== 'number' || body.max_score <= 0) {
      fields.max_score = ['Max score must be greater than 0.'];
    }
    if (
      body.weight !== undefined &&
      (typeof body.weight !== 'number' || body.weight < 0 || body.weight > 999.99)
    ) {
      fields.weight = ['Weight must be between 0 and 999.99.'];
    }
    if (Object.keys(fields).length > 0) {
      return errorResponse(422, 'validation_error', 'Please correct the highlighted fields.', fields);
    }

    const offering = body.offering_id ? getOffering(body.offering_id) : undefined;
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    if (!lecturerOwnsOffering(role, offering)) {
      return errorResponse(404, 'not_found', 'Resource not found.');
    }
    const notWritable = writableError(offering);
    if (notWritable) return notWritable;
    if (body.semester_id && body.semester_id !== offering.semester_id) {
      return errorResponse(
        409,
        'semester_mismatch',
        "The assessment's session must match the course offering's session.",
        { semester_id: ["Must be the course offering's session."] },
      );
    }
    const passed = windowPassedError(body.assessment_date);
    if (passed) return passed;
    if (body.category_id) {
      const cat = D.assessment_categories.find((c) => c.id === body.category_id);
      if (!cat || cat.offering_id !== offering.id) return categoryMismatch();
    }

    const created: DemoAssessment = {
      id: `asmt-new-${(newAssessmentSeq += 1)}`,
      offering_id: offering.id,
      // The OFFERING's term, never the body's — an offering belongs to one term.
      semester_id: offering.semester_id,
      category_id: body.category_id ?? null,
      title,
      max_score: body.max_score as number,
      weight: FIXED_ASSESSMENT_WEIGHT,
      assessment_date: body.assessment_date ?? null,
      // The demo "now": an undated assessment's window runs from today.
      created_at: DEMO_TODAY_ISO,
      reopened_until: null,
    };
    D.assessments.push(created);
    return HttpResponse.json(assessmentDetail(created), { status: 201 });
  }),

  // ── Edit (PATCH /assessments/{id}) ─────────────────────────────────────────────────
  // Every check runs BEFORE any field is written, so a refused edit changes nothing — the
  // server gets that from its transaction, the mock has to do it by ordering.
  http.patch(`${API_BASE_URL}/assessments/:id`, async ({ params, request, cookies }) => {
    const role = cookies[SESSION_COOKIE] ?? 'principal';
    if (!LECTURER_ROLES.has(role)) return lecturerOnly();
    const body = (await request.json()) as {
      title?: string;
      category_id?: string | null;
      max_score?: number;
      weight?: number;
      assessment_date?: string | null;
    };

    const fields: Record<string, string[]> = {};
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (title.length < 1 || title.length > 160) {
        fields.title = ['Title must be between 1 and 160 characters.'];
      }
    }
    if ('type' in body) fields.type = ['Extra inputs are not permitted'];
    if ('status' in body) fields.status = ['Extra inputs are not permitted'];
    if (body.max_score !== undefined && (typeof body.max_score !== 'number' || body.max_score <= 0)) {
      fields.max_score = ['Max score must be greater than 0.'];
    }
    if (
      body.weight !== undefined &&
      (typeof body.weight !== 'number' || body.weight < 0 || body.weight > 999.99)
    ) {
      fields.weight = ['Weight must be between 0 and 999.99.'];
    }
    if (Object.keys(fields).length > 0) {
      return errorResponse(422, 'validation_error', 'Please correct the highlighted fields.', fields);
    }

    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    const offering = getOffering(a.offering_id);
    if (!offering || !lecturerOwnsOffering(role, offering)) {
      return errorResponse(404, 'not_found', 'Resource not found.');
    }
    const notWritable = writableError(offering);
    if (notWritable) return notWritable;

    if (body.category_id) {
      const cat = D.assessment_categories.find((c) => c.id === body.category_id);
      if (!cat || cat.offering_id !== a.offering_id) return categoryMismatch();
    }
    // Lowering max_score below an existing graded score is rejected (§5.6).
    if (typeof body.max_score === 'number' && body.max_score < a.max_score) {
      const offenders = gradesForAssessment(a.id).filter(
        (g) => g.status === 'graded' && g.score != null && g.score > body.max_score!,
      );
      if (offenders.length > 0) {
        return errorResponse(
          409,
          'scores_exceed_new_max',
          `${offenders.length} recorded score(s) exceed the new maximum. Fix those scores first.`,
        );
      }
    }
    // D47 — the date anchors the window, so moving it moves the window: frozen once
    // closed, and a new date may not land in an already-closed window either.
    const movesDate =
      body.assessment_date !== undefined && body.assessment_date !== a.assessment_date;
    if (movesDate) {
      if (!isMarkingOpen(a)) return markingClosedError();
      const passed = windowPassedError(body.assessment_date);
      if (passed) return passed;
    }

    if (body.category_id !== undefined) a.category_id = body.category_id;
    if (body.title !== undefined) a.title = body.title.trim();
    if (body.max_score !== undefined) a.max_score = body.max_score;
    a.weight = FIXED_ASSESSMENT_WEIGHT;
    if (movesDate) a.assessment_date = body.assessment_date ?? null;

    return HttpResponse.json(assessmentDetail(a));
  }),

  // ── Delete (DELETE /assessments/{id}) ───────────────────────────────────────────────
  // D47 — a CLOSED assessment cannot be deleted: its blanks already count as 0, and
  // deleting it would erase them. Then the old rule: refused while any real grade exists.
  http.delete(`${API_BASE_URL}/assessments/:id`, ({ params, cookies }) => {
    const role = cookies[SESSION_COOKIE] ?? 'principal';
    if (!LECTURER_ROLES.has(role)) return lecturerOnly();
    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    const offering = getOffering(a.offering_id);
    if (!offering || !lecturerOwnsOffering(role, offering)) {
      return errorResponse(404, 'not_found', 'Resource not found.');
    }
    const notWritable = writableError(offering);
    if (notWritable) return notWritable;
    if (!isMarkingOpen(a)) return markingClosedError();
    const hasGrades = gradesForAssessment(a.id).some(
      (g) => g.status !== 'pending' || g.score != null,
    );
    if (hasGrades) {
      return errorResponse(
        409,
        'assessment_has_grades',
        'This assessment has recorded grades and cannot be deleted.',
      );
    }
    // Leftover pending rows go with it (FK RESTRICT on the server).
    D.assessment_grades = D.assessment_grades.filter((g) => g.assessment_id !== a.id);
    D.assessments = D.assessments.filter((row) => row.id !== a.id);
    return new HttpResponse(null, { status: 204 });
  }),
];

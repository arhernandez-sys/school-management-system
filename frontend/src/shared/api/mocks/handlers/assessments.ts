import { http, HttpResponse } from 'msw';
import type { RequestHandler } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  assessmentsForOffering,
  currentDemoStudent,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  gradesForAssessment,
  offeringLabel,
  offeringsForStudent,
  offeringsForYear,
  paginate,
} from '@shared/api/mocks/demo/dataset';
import type { DemoAssessment, DemoOffering } from '@shared/api/mocks/demo/dataset';
import type { AssessmentStatus, AssessmentType } from '@shared/types/enums';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the ASSESSMENTS module (api-spec §5 Module 6) — DEMO.
 *
 * Backs features/assessments/** with the shared demo dataset so the assessment-first
 * (API-9) authoring flow renders real data offline. Response shapes mirror the api-spec
 * models (Page[AssessmentListItem], AssessmentDetail, CategoryDetail) in snake_case.
 *
 * 🎬 DEMO NOTE — TEACHER SCOPE: the demo teacher session carries the placeholder
 * `teacher_profile_id = "mock-teacher-profile"` (fixtures.ts), which is not one of the
 * seeded `teach-N` ids. So a lecturer would otherwise own zero offerings. To keep the
 * lecturer demo meaningful, `resolveTeacherId` maps that placeholder onto a real seeded
 * teacher (`teach-1`, Maria Reyes) who leads several offerings.
 *
 * **D31 — the picker no longer takes a `scope` / `teacher_profile_id` hint.** It used to,
 * on the reasoning that "the demo does not receive the caller role on the wire". It does:
 * the `sis_mock_session` cookie carries it, and every other handler in this directory
 * already reads it. Accepting a caller-supplied profile id was a request to be trusted
 * about whose offerings to return — the mock's version of the same soft trust the real
 * server would never grant. Scope is now derived from the cookie alone.
 *
 * The list endpoint still reads `scope=me`, because that is a REAL query param on the
 * server (`GET /assessments?scope=me`) rather than an identity claim.
 *
 * Endpoints (api-spec): GET /assessments, GET /assessments/{id}, POST /assessments,
 * PATCH /assessments/{id}, POST /assessments/{id}/status (M1), DELETE /assessments/{id},
 * plus the offering picker feed `GET /assessments/offerings`.
 *
 * **Categories moved out of this file** to `handlers/offerings.ts`, following the path:
 * they were mounted under `/classes/{id}/subjects/{csId}/categories` and are now
 * `/offerings/{id}/categories`, which is offerings-owned.
 */
const D = DEMO_DATASET;

/** The seeded teacher a demo teacher login stands in for (keeps the picker non-empty). */
const DEMO_STANDIN_TEACHER_ID = 'teach-1';

// ── Response shaping (api-spec §4.4 refs + list/detail models) ─────────────────────
/**
 * The shared `OfferingRef`.
 *
 * Its predecessor built its own `label` as `"${section.name} · ${subject.name}"` — one of
 * the five private derivations of that string D31 consolidated. The label is server-derived
 * now, from `offeringLabel`, so the picker and the offerings list cannot disagree.
 */
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
    type: a.type,
    offering: offering ? offeringRef(offering) : null,
    category_id: a.category_id,
    max_score: a.max_score,
    weight: a.weight,
    assessment_date: a.assessment_date,
    status: a.status,
    is_released: a.is_released,
  };
}

function assessmentDetail(a: DemoAssessment) {
  const grades = gradesForAssessment(a.id);
  const graded = grades.filter((g) => g.status === 'graded').length;
  return {
    ...assessmentListItem(a),
    semester_id: a.semester_id,
    stats: {
      grade_count: grades.length,
      graded_count: graded,
      pending_count: grades.filter((g) => g.status === 'pending').length,
    },
  };
}

// ── Status lifecycle (M1 / API-16) ─────────────────────────────────────────────────
const LEGAL_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  draft: ['published'],
  published: ['grading', 'draft'],
  grading: ['graded', 'published'],
  graded: [],
};

function isLegalTransition(from: AssessmentStatus, to: AssessmentStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

const VALID_TYPES: readonly AssessmentType[] = ['quiz', 'test', 'exam', 'assignment'];
const VALID_STATUSES: readonly AssessmentStatus[] = ['draft', 'published', 'grading', 'graded'];

let newAssessmentSeq = 0;

export const assessmentsHandlers: RequestHandler[] = [
  // ── Picker feed: caller-scoped offerings with derived labels ─────────────────────
  //
  // Scope comes from the SESSION COOKIE, not from the query string. The predecessor read
  // `scope=me&teacher_profile_id=…` off the URL — i.e. it let the caller name whose
  // offerings to return.
  http.get(`${API_BASE_URL}/assessments/offerings`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies['sis_mock_session'] ?? 'principal';
    // Per-module year switcher: scope offerings to the chosen year (default active). The
    // year resolves THROUGH each offering's semester — an offering has no year column.
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;

    let rows: DemoOffering[];
    const student = currentDemoStudent(role);
    if (student) {
      /**
       * Student scope: the offerings they sat in the SELECTED YEAR (FR-CLS-07).
       *
       * Two bugs lived in the ancestor of this branch and made the student's global
       * switcher look broken on "My Assessments":
       *
       *  1. The year filter was computed and then never applied here, and the section came
       *     from `student.section_id` — a denormalisation of the ACTIVE semester only. So
       *     the dropdown listed this year's subjects whichever year was selected.
       *  2. `.filter(cs => cs.is_active)` emptied the dropdown for every archived year,
       *     because a past year's offerings are all inactive by design. Enrolment already
       *     scopes the rows to the year, so the flag was redundant and actively harmful.
       *     `handlers/grades.ts` documents the same trap.
       */
      rows = offeringsForStudent(student.id, yearId);
    } else {
      const teacherId = role === 'teacher' ? DEMO_STANDIN_TEACHER_ID : null;
      const inYear = yearId ? offeringsForYear(yearId) : D.offerings;
      rows = teacherId
        ? inYear.filter((o) => o.teacher_ids.includes(teacherId))
        : inYear;
    }

    // Ordered by course code then section code (`compareOfferings` semantics), never by
    // the formatted label — "MATH1110-2" would sort before "MATH1110-10".
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
  http.get(`${API_BASE_URL}/assessments`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies['sis_mock_session'] ?? 'principal';
    const offeringId = url.searchParams.get('offering_id');
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    // A REAL server-side param, unlike the retired `teacher_profile_id`: it says "restrict
    // to mine", and the server decides who that is.
    const scope = url.searchParams.get('scope');

    const semesterId = url.searchParams.get('semester_id');

    let rows: DemoAssessment[];
    const student = currentDemoStudent(role);
    if (student) {
      /**
       * Student scope (server-enforced): only assessments on offerings they sat in the
       * SELECTED YEAR, and never unpublished drafts. A requested `offering_id` must be one
       * of theirs — asking for someone else's returns nothing rather than a 403, so the
       * response does not confirm that the offering exists.
       *
       * The ancestor of this branch ignored `academic_year_id` entirely and resolved the
       * section from `student.section_id` (the active-semester denormalisation), so the
       * student's global year switcher had no effect on their own assessment list.
       * `is_archived` is deliberately NOT filtered: a past year's offerings are all
       * archived, and enrolment already scopes the rows to the year.
       */
      const studentYearId =
        url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
      const ownIds = new Set(offeringsForStudent(student.id, studentYearId).map((o) => o.id));
      const visibleIds =
        offeringId && ownIds.has(offeringId)
          ? new Set([offeringId])
          : offeringId
            ? new Set<string>() // asked for someone else's offering → nothing
            : ownIds;
      rows = D.assessments.filter(
        (a) => visibleIds.has(a.offering_id) && a.status !== 'draft',
      );
    } else if (offeringId) {
      rows = assessmentsForOffering(offeringId);
    } else {
      // No specific offering chosen: scope to the selected year (default active), then to
      // the lecturer's own offerings when scope=me.
      const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
      const inYear = yearId ? offeringsForYear(yearId) : D.offerings;
      const teacherId = role === 'teacher' ? DEMO_STANDIN_TEACHER_ID : null;
      const visibleIds = new Set(
        (scope === 'me' && teacherId
          ? inYear.filter((o) => o.teacher_ids.includes(teacherId))
          : inYear
        ).map((o) => o.id),
      );
      rows = D.assessments.filter((a) => visibleIds.has(a.offering_id));
    }
    // Narrows within the year — the student's year·semester switcher sends this so
    // "My Assessments" shows one term instead of the whole year. Applied after every
    // scope branch above so it composes with all of them (matching the backend, where
    // it is one more WHERE clause beside `academic_year_id`).
    if (semesterId) rows = rows.filter((a) => a.semester_id === semesterId);
    if (type) rows = rows.filter((a) => a.type === type);
    if (status) rows = rows.filter((a) => a.status === status);

    const page = paginate(rows.map(assessmentListItem) as unknown as Array<Record<string, unknown>>, {
      ...listParamsFrom(url),
      sort: url.searchParams.get('sort') ?? '-assessment_date',
    });
    return HttpResponse.json(page);
  }),

  // ── Assessment detail ─────────────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/assessments/:id`, ({ params }) => {
    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    return HttpResponse.json(assessmentDetail(a));
  }),

  // ── Create (POST /assessments) — status draft, is_released false (§5.6) ────────────
  http.post(`${API_BASE_URL}/assessments`, async ({ request }) => {
    const body = (await request.json()) as {
      offering_id?: string;
      semester_id?: string;
      category_id?: string | null;
      title?: string;
      type?: AssessmentType;
      max_score?: number;
      weight?: number;
      assessment_date?: string | null;
    };

    const fields: Record<string, string[]> = {};
    const title = (body.title ?? '').trim();
    if (title.length < 1 || title.length > 160) {
      fields.title = ['Title must be between 1 and 160 characters.'];
    }
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      fields.type = ['A valid assessment type is required.'];
    }
    if (typeof body.max_score !== 'number' || body.max_score <= 0) {
      fields.max_score = ['Max score must be greater than 0.'];
    }
    if (body.weight !== undefined && (typeof body.weight !== 'number' || body.weight < 0)) {
      fields.weight = ['Weight must be zero or greater.'];
    }
    if (Object.keys(fields).length > 0) {
      return errorResponse(422, 'validation_error', 'Please correct the highlighted fields.', fields);
    }

    const offering = body.offering_id ? getOffering(body.offering_id) : undefined;
    if (!offering) {
      return errorResponse(404, 'offering_not_found', 'Offering not found or not owned.');
    }
    if (body.category_id) {
      const cat = D.assessment_categories.find((c) => c.id === body.category_id);
      if (!cat || cat.offering_id !== offering.id) {
        return errorResponse(
          409,
          'category_offering_mismatch',
          'The chosen category does not belong to this offering.',
        );
      }
    }

    const created: DemoAssessment = {
      id: `asmt-new-${(newAssessmentSeq += 1)}`,
      offering_id: offering.id,
      // The OFFERING's term wins over anything the body asks for: an offering belongs to
      // one term, so an assessment on it cannot sit in another. `DEMO_IDS.activeSemesterId`
      // was the previous fallback, which would have filed a Semester-2 offering's first
      // assessment under Semester 1.
      semester_id: offering.semester_id,
      category_id: body.category_id ?? null,
      title,
      type: body.type as AssessmentType,
      max_score: body.max_score as number,
      weight: typeof body.weight === 'number' ? body.weight : 1,
      assessment_date: body.assessment_date ?? null,
      status: 'draft',
      is_released: false,
    };
    D.assessments.push(created);
    return HttpResponse.json(assessmentDetail(created), { status: 201 });
  }),

  // ── Edit (PATCH /assessments/{id}) — status NOT settable here (§5.6) ───────────────
  http.patch(`${API_BASE_URL}/assessments/:id`, async ({ params, request }) => {
    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    const body = (await request.json()) as {
      title?: string;
      type?: AssessmentType;
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
    if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
      fields.type = ['A valid assessment type is required.'];
    }
    if (body.max_score !== undefined && (typeof body.max_score !== 'number' || body.max_score <= 0)) {
      fields.max_score = ['Max score must be greater than 0.'];
    }
    if (body.weight !== undefined && (typeof body.weight !== 'number' || body.weight < 0)) {
      fields.weight = ['Weight must be zero or greater.'];
    }
    if (Object.keys(fields).length > 0) {
      return errorResponse(422, 'validation_error', 'Please correct the highlighted fields.', fields);
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

    if (body.category_id !== undefined) {
      if (body.category_id) {
        const cat = D.assessment_categories.find((c) => c.id === body.category_id);
        if (!cat || cat.offering_id !== a.offering_id) {
          return errorResponse(
            409,
            'category_offering_mismatch',
            'The chosen category does not belong to this offering.',
          );
        }
      }
      a.category_id = body.category_id;
    }
    if (body.title !== undefined) a.title = body.title.trim();
    if (body.type !== undefined) a.type = body.type;
    if (body.max_score !== undefined) a.max_score = body.max_score;
    if (body.weight !== undefined) a.weight = body.weight;
    if (body.assessment_date !== undefined) a.assessment_date = body.assessment_date;

    return HttpResponse.json(assessmentDetail(a));
  }),

  // ── Status transition (POST /assessments/{id}/status) — M1 / API-16 ────────────────
  http.post(`${API_BASE_URL}/assessments/:id/status`, async ({ params, request }) => {
    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    const body = (await request.json()) as { status?: AssessmentStatus };
    const next = body.status;
    if (!next || !VALID_STATUSES.includes(next)) {
      return errorResponse(422, 'validation_error', 'A valid target status is required.', {
        status: ['Must be one of draft, published, grading, graded.'],
      });
    }
    if (next === a.status) {
      return HttpResponse.json(assessmentDetail(a));
    }
    if (!isLegalTransition(a.status, next)) {
      return errorResponse(
        422,
        'invalid_transition',
        `Cannot move an assessment from "${a.status}" to "${next}".`,
      );
    }
    a.status = next;
    return HttpResponse.json(assessmentDetail(a));
  }),

  // ── Delete (DELETE /assessments/{id}) — blocked if grades exist (§5.6) ─────────────
  http.delete(`${API_BASE_URL}/assessments/:id`, ({ params }) => {
    const a = D.assessments.find((row) => row.id === params.id);
    if (!a) return errorResponse(404, 'not_found', 'Assessment not found.');
    const hasGrades = gradesForAssessment(a.id).some(
      (g) => g.status !== 'pending' || g.score != null,
    );
    if (hasGrades) {
      return errorResponse(
        409,
        'assessment_has_grades',
        'This assessment has recorded grades. Clear the grades before deleting it.',
      );
    }
    D.assessments = D.assessments.filter((row) => row.id !== a.id);
    return new HttpResponse(null, { status: 204 });
  }),
];

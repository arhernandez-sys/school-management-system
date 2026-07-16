import { http, HttpResponse } from 'msw';
import type { RequestHandler } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_IDS,
  assessmentsForClassSubject,
  classSubjectsForSection,
  classSubjectsForYear,
  classSubjectsOwnedByTeacher,
  currentDemoStudent,
  getActiveYear,
  getClassSubject,
  getSection,
  getSubject,
  gradesForAssessment,
  paginate,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAssessment,
  DemoAssessmentCategory,
  DemoClassSubject,
} from '@shared/api/mocks/demo/dataset';
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
 * seeded `teach-N` ids. So a teacher would otherwise own zero class_subjects. To keep
 * the teacher demo meaningful, `resolveTeacherId` maps that placeholder onto a real
 * seeded teacher (`teach-1`, Maria Reyes) who leads several offerings. P/S callers see
 * every class_subject; the demo does not receive the caller role on the wire, so the
 * picker feed (`GET /assessments/class-subjects`) accepts an explicit `scope`/`teacher`
 * hint from the screen (which knows the role) and defaults to view-all otherwise.
 *
 * Endpoints (api-spec): GET /assessments, GET /assessments/{id}, POST /assessments,
 * PATCH /assessments/{id}, POST /assessments/{id}/status (M1), DELETE /assessments/{id},
 * categories GET + write-family under /classes/{id}/subjects/{csId}/categories.
 * Plus a demo-only picker feed: GET /assessments/class-subjects.
 */
const D = DEMO_DATASET;

/** The seeded teacher a demo teacher login stands in for (keeps the picker non-empty). */
const DEMO_STANDIN_TEACHER_ID = 'teach-1';

/**
 * Resolve a wire `teacher_profile_id` to a seeded demo teacher id. The demo fixture's
 * placeholder is remapped so the teacher scope has real owned offerings.
 */
function resolveTeacherId(raw: string | null): string | null {
  if (!raw) return null;
  if (raw === 'mock-teacher-profile') return DEMO_STANDIN_TEACHER_ID;
  return raw;
}

// ── Response shaping (api-spec §4.4 refs + list/detail models) ─────────────────────
function classSubjectRef(cs: DemoClassSubject) {
  const section = getSection(cs.section_id);
  const subject = getSubject(cs.subject_id);
  return {
    class_subject_id: cs.id,
    section: section ? { id: section.id, name: section.name } : null,
    subject: subject ? { id: subject.id, name: subject.name, code: subject.code } : null,
    label:
      section && subject ? `${section.name} · ${subject.name}` : (subject?.name ?? cs.id),
  };
}

function assessmentListItem(a: DemoAssessment) {
  const cs = getClassSubject(a.class_subject_id);
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    class_subject: cs ? classSubjectRef(cs) : null,
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

function categoryDetail(c: DemoAssessmentCategory) {
  return {
    id: c.id,
    class_subject_id: c.class_subject_id,
    name: c.name,
    weight: c.weight,
    drop_lowest_count: c.drop_lowest_count,
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
  // ── Picker feed (demo-only): caller-scoped class_subjects with labels ─────────────
  // Query: `scope=me&teacher_profile_id=…` restricts to a teacher's owned offerings;
  // otherwise (P/S) returns every offering. Sorted by label.
  http.get(`${API_BASE_URL}/assessments/class-subjects`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies['sis_mock_session'] ?? 'principal';
    const scope = url.searchParams.get('scope');
    const teacherId = resolveTeacherId(url.searchParams.get('teacher_profile_id'));
    // Per-module year switcher: scope offerings to the chosen year (default active).
    const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
    const yearCsIds = yearId ? new Set(classSubjectsForYear(yearId).map((c) => c.id)) : null;

    let rows: DemoClassSubject[];
    const student = currentDemoStudent(role);
    if (student) {
      // Student scope: only the subjects taught in their own section (FR-CLS-07).
      rows = classSubjectsForSection(student.section_id ?? '').filter((cs) => cs.is_active);
    } else if (scope === 'me' && teacherId) {
      rows = classSubjectsOwnedByTeacher(teacherId);
      if (yearCsIds) rows = rows.filter((cs) => yearCsIds.has(cs.id));
    } else {
      rows = yearId ? classSubjectsForYear(yearId) : D.class_subjects.filter((cs) => cs.is_active);
    }

    const items = rows
      .map(classSubjectRef)
      .sort((a, b) => a.label.localeCompare(b.label));
    return HttpResponse.json({ items });
  }),

  // ── Categories (weighting groups) — GET + write-family (api-spec §5.6) ────────────
  http.get(
    `${API_BASE_URL}/classes/:classId/subjects/:classSubjectId/categories`,
    ({ params }) => {
      const rows = D.assessment_categories.filter(
        (c) => c.class_subject_id === params.classSubjectId,
      );
      return HttpResponse.json({ items: rows.map(categoryDetail) });
    },
  ),
  http.post(
    `${API_BASE_URL}/classes/:classId/subjects/:classSubjectId/categories`,
    async ({ params, request }) => {
      const csId = String(params.classSubjectId);
      if (!getClassSubject(csId)) return errorResponse(404, 'not_found', 'Class subject not found.');
      const body = (await request.json()) as {
        name?: string;
        weight?: number;
        drop_lowest_count?: number;
      };
      const name = (body.name ?? '').trim();
      if (!name) {
        return errorResponse(422, 'validation_error', 'A category name is required.', {
          name: ['Required.'],
        });
      }
      if (
        D.assessment_categories.some(
          (c) => c.class_subject_id === csId && c.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return errorResponse(
          409,
          'duplicate_category_name',
          'A category with this name already exists for this class subject.',
        );
      }
      const created: DemoAssessmentCategory = {
        id: `cat-new-${(newAssessmentSeq += 1)}`,
        class_subject_id: csId,
        name,
        weight: typeof body.weight === 'number' && body.weight >= 0 ? body.weight : 1,
        drop_lowest_count:
          typeof body.drop_lowest_count === 'number' && body.drop_lowest_count >= 0
            ? body.drop_lowest_count
            : 0,
      };
      D.assessment_categories.push(created);
      return HttpResponse.json(categoryDetail(created), { status: 201 });
    },
  ),
  http.patch(
    `${API_BASE_URL}/classes/:classId/subjects/:classSubjectId/categories/:categoryId`,
    async ({ params, request }) => {
      const cat = D.assessment_categories.find((c) => c.id === params.categoryId);
      if (!cat) return errorResponse(404, 'not_found', 'Category not found.');
      const body = (await request.json()) as {
        name?: string;
        weight?: number;
        drop_lowest_count?: number;
      };
      if (body.name !== undefined) {
        const name = body.name.trim();
        if (!name) {
          return errorResponse(422, 'validation_error', 'A category name is required.', {
            name: ['Required.'],
          });
        }
        if (
          D.assessment_categories.some(
            (c) =>
              c.id !== cat.id &&
              c.class_subject_id === cat.class_subject_id &&
              c.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          return errorResponse(
            409,
            'duplicate_category_name',
            'A category with this name already exists for this class subject.',
          );
        }
        cat.name = name;
      }
      if (typeof body.weight === 'number' && body.weight >= 0) cat.weight = body.weight;
      if (typeof body.drop_lowest_count === 'number' && body.drop_lowest_count >= 0) {
        cat.drop_lowest_count = body.drop_lowest_count;
      }
      return HttpResponse.json(categoryDetail(cat));
    },
  ),
  http.delete(
    `${API_BASE_URL}/classes/:classId/subjects/:classSubjectId/categories/:categoryId`,
    ({ params }) => {
      const cat = D.assessment_categories.find((c) => c.id === params.categoryId);
      if (!cat) return errorResponse(404, 'not_found', 'Category not found.');
      // FK SET NULL: referencing assessments lose their category.
      for (const a of D.assessments) {
        if (a.category_id === cat.id) a.category_id = null;
      }
      D.assessment_categories = D.assessment_categories.filter((c) => c.id !== cat.id);
      return new HttpResponse(null, { status: 204 });
    },
  ),

  // ── Assessments list (Page[AssessmentListItem]) ───────────────────────────────────
  http.get(`${API_BASE_URL}/assessments`, ({ request, cookies }) => {
    const url = new URL(request.url);
    const role = cookies['sis_mock_session'] ?? 'principal';
    const classSubjectId = url.searchParams.get('class_subject_id');
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const scope = url.searchParams.get('scope');
    const teacherId = resolveTeacherId(url.searchParams.get('teacher_profile_id'));

    let rows: DemoAssessment[];
    const student = currentDemoStudent(role);
    if (student) {
      // Student scope (server-enforced): only assessments taught in their own section,
      // and never unpublished drafts. A requested class_subject_id must be one of theirs.
      const ownIds = new Set(
        classSubjectsForSection(student.section_id ?? '').map((cs) => cs.id),
      );
      const visibleIds =
        classSubjectId && ownIds.has(classSubjectId)
          ? new Set([classSubjectId])
          : classSubjectId
            ? new Set<string>() // asked for someone else's subject → nothing
            : ownIds;
      rows = D.assessments.filter(
        (a) => visibleIds.has(a.class_subject_id) && a.status !== 'draft',
      );
    } else if (classSubjectId) {
      rows = assessmentsForClassSubject(classSubjectId);
    } else {
      // No specific offering chosen: scope to the selected year (default active), then
      // to the teacher's own offerings when scope=me.
      const yearId = url.searchParams.get('academic_year_id') ?? getActiveYear()?.id ?? null;
      const yearCsIds = new Set((yearId ? classSubjectsForYear(yearId) : D.class_subjects).map((c) => c.id));
      const visibleIds =
        scope === 'me' && teacherId
          ? new Set(classSubjectsOwnedByTeacher(teacherId).map((cs) => cs.id).filter((id) => yearCsIds.has(id)))
          : yearCsIds;
      rows = D.assessments.filter((a) => visibleIds.has(a.class_subject_id));
    }
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
      class_subject_id?: string;
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

    const cs = body.class_subject_id ? getClassSubject(body.class_subject_id) : undefined;
    if (!cs) {
      return errorResponse(404, 'class_subject_not_found', 'Class subject not found or not owned.');
    }
    if (body.category_id) {
      const cat = D.assessment_categories.find((c) => c.id === body.category_id);
      if (!cat || cat.class_subject_id !== cs.id) {
        return errorResponse(
          409,
          'category_subject_mismatch',
          'The chosen category does not belong to this class subject.',
        );
      }
    }

    const created: DemoAssessment = {
      id: `asmt-new-${(newAssessmentSeq += 1)}`,
      class_subject_id: cs.id,
      semester_id: body.semester_id ?? DEMO_IDS.activeSemesterId,
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
        if (!cat || cat.class_subject_id !== a.class_subject_id) {
          return errorResponse(
            409,
            'category_subject_mismatch',
            'The chosen category does not belong to this class subject.',
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

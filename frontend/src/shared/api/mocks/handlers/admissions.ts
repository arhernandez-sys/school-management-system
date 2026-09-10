import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import { canonicalGender, normaliseCivilStatus } from '@shared/types/enums';
import { DEMO_DATASET, DEMO_IDS, DEMO_TODAY, getCourse } from '@shared/api/mocks/demo/dataset';
import type {
  DemoApplication,
  DemoApplicationDocument,
  DemoApplicationEducation,
  DemoApplicationTemp,
  DemoCreditTransferRequest,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for ADMISSIONS (D30 §D11) — DEMO.
 *
 * **Parity with the real backend is the point, not a nicety.** This project has twice paid
 * for demo mode certifying a screen the server answered differently, so every rule that
 * shapes the UI is mirrored here:
 *
 *   * the completeness rules, returned as `blocking_issues` — including the **under-18
 *     guardian-signature** condition and the "a pending credit transfer blocks acceptance"
 *     rule;
 *   * **PATCH applies only the keys PRESENT**, so the wizard's per-section saves cannot
 *     blank the sections they do not carry;
 *   * the **≥75% content-equivalency floor** and the **tertiary-institution** requirement
 *     on approval;
 *   * **credit transfer at ADMISSION only** — 409 once the application is decided;
 *   * **the Dean alone decides a transfer** — 403 for anyone else;
 *   * acceptance creating a student, a login and a `YYYYMM###`, and returning the temporary
 *     password ONCE.
 *
 * `Math.random()` is never used: the dataset is deterministic by design, so ids come from
 * counters and the student number from `DEMO_TODAY` plus a sequence.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';

/** Mirrors the role cookie the other handler files read (see students.ts / auth.ts). */
function sessionRole(cookies: Record<string, string>): string {
  return cookies[SESSION_COOKIE] ?? 'principal';
}

const MIN_EQUIVALENCY_PCT = 75;

let idCounter = 0;
const nextId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}-demo-${idCounter}`;
};

/**
 * D44 — `APP-YYYY-NNNNN`, the demo's stand-in for the server's row-locked counter.
 *
 * Seeded past the four numbers in `demo/data.ts` rather than starting at 1, so a demo
 * session that files an application does not hand it a reference another row already
 * carries. The real allocator steps over collisions; this one only has to avoid them.
 */
let applicationSeq = 4;
const nextApplicationNumber = (): string => {
  applicationSeq += 1;
  return `APP-${DEMO_TODAY.slice(0, 4)}-${String(applicationSeq).padStart(5, '0')}`;
};

/** Registrar + Dean. Admission is administration (§D14). */
function assertAdmissions(cookies: Record<string, string>) {
  const role = sessionRole(cookies);
  if (role !== 'principal' && role !== 'secretary') {
    return errorResponse(403, 'forbidden', 'Only the Dean or the Registrar may manage admissions.');
  }
  return null;
}

/** The Dean alone decides a credit transfer (brief §13). */
function assertDean(cookies: Record<string, string>) {
  if (sessionRole(cookies) !== 'principal') {
    return errorResponse(403, 'forbidden', 'Only the Dean may decide a credit transfer.');
  }
  return null;
}

// D44 — mirrors `enums.DECIDED_APPLICATION_STATUSES`. `deferred` is decided: the
// applicant re-applies rather than this row reopening.
const isDecided = (app: DemoApplication) =>
  ['accepted', 'rejected', 'deferred', 'withdrawn', 'enrolled'].includes(app.status);

// D44 — mirrors `admissions/service._DECIDABLE`. `eligible` is in it (refusing to decide
// from it would make marking someone eligible a step backwards); `documents_pending` is
// not (the file is knowingly incomplete).
const DECIDABLE: string[] = ['submitted', 'under_review', 'eligible'];

const fullName = (app: DemoApplication) =>
  [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(' ');

function programRef(programId: string | null) {
  if (!programId) return null;
  const program = D.programs.find((p) => p.id === programId);
  return program ? { id: program.id, code: program.code, name: program.name } : null;
}

function courseRef(courseId: string) {
  const course = getCourse(courseId);
  return course
    ? { id: course.id, code: course.code, name: course.name, credits: course.credits }
    : null;
}

function ageOn(dob: string | null, on: string): number | null {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  const at = new Date(`${on}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return null;
  let years = at.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    at.getMonth() < birth.getMonth() ||
    (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

/** Mirrors `admissions.service.submission_issues` sentence for sentence. */
function submissionIssues(app: DemoApplication): string[] {
  const issues: string[] = [];
  if (!app.first_name?.trim() || !app.last_name?.trim()) {
    issues.push("The applicant's first and last name are required.");
  }
  if (!app.date_of_birth) issues.push('Date of birth is required.');
  else if (app.date_of_birth > DEMO_TODAY) issues.push('Date of birth cannot be in the future.');
  if (!app.program_id) issues.push('A programme of study must be chosen (Section E).');
  if (!app.year_of_study) issues.push('Year of study must be chosen (Section E).');
  if (!app.enrollment_load) {
    issues.push('Study load must be chosen — Part Time, Full Time or Transient.');
  }
  if (!app.applicant_signed_at) {
    issues.push('The applicant must sign and date the form (Section G).');
  }
  const age = ageOn(app.date_of_birth, app.applicant_signed_at ?? DEMO_TODAY);
  if (age !== null && age < 18 && !app.guardian_signed_at) {
    issues.push(
      'The applicant is under 18, so a parent or guardian must also sign (Section G).',
    );
  }
  return issues;
}

/** Mirrors `admissions.service.acceptance_issues`. */
function acceptanceIssues(app: DemoApplication): string[] {
  if (app.status === 'accepted') return ['This application has already been accepted.'];
  if (['rejected', 'withdrawn', 'deferred', 'enrolled'].includes(app.status)) {
    return [`This application is ${app.status}.`];
  }
  if (app.status === 'documents_pending') {
    return ['This application is waiting on documents from the applicant.'];
  }
  const issues = submissionIssues(app);
  if (app.status === 'draft') {
    issues.push('The application must be submitted before it can be accepted.');
  }
  const pending = D.credit_transfer_requests.filter(
    (t) => t.application_id === app.id && t.status === 'pending',
  ).length;
  if (pending > 0) {
    issues.push(
      `${pending} credit transfer request(s) are still awaiting the Dean's decision. ` +
        'Credit transfer may only be assessed at admission.',
    );
  }
  if (!app.email?.trim()) {
    issues.push(
      'An email address is required to issue the student a login (or supply one when accepting).',
    );
  }
  return issues;
}

function transferRead(row: DemoCreditTransferRequest) {
  return {
    id: row.id,
    application_id: row.application_id,
    external_institution: row.external_institution,
    external_course_code: row.external_course_code,
    external_course_name: row.external_course_name,
    external_credits: row.external_credits,
    external_grade: row.external_grade,
    target_course: courseRef(row.target_course_id),
    content_equivalency_pct: row.content_equivalency_pct,
    cta_document_id: row.cta_document_id,
    transcript_document_id: row.transcript_document_id,
    outline_document_id: row.outline_document_id,
    status: row.status,
    decided_by_user_id: row.decided_by_user_id,
    decided_at: row.decided_at,
    note: row.note,
    meets_equivalency_floor:
      row.content_equivalency_pct != null && row.content_equivalency_pct >= MIN_EQUIVALENCY_PCT,
  };
}

function listItem(app: DemoApplication) {
  return {
    id: app.id,
    status: app.status,
    full_name: fullName(app),
    first_name: app.first_name,
    middle_name: app.middle_name,
    last_name: app.last_name,
    school_year: app.school_year,
    program: programRef(app.program_id),
    year_of_study: app.year_of_study,
    enrollment_load: app.enrollment_load,
    email: app.email,
    phone: app.phone,
    date_accepted: app.date_accepted,
    student_code: app.student_code,
    student_id: app.student_id,
    created_at: app.created_at,
    pending_credit_transfers: D.credit_transfer_requests.filter(
      (t) => t.application_id === app.id && t.status === 'pending',
    ).length,
  };
}

function detail(app: DemoApplication) {
  return {
    ...listItem(app),
    date_of_birth: app.date_of_birth,
    ssno: app.ssno,
    gender: app.gender,
    civil_status: app.civil_status,
    religion: app.religion,
    has_health_condition: app.has_health_condition,
    health_condition_note: app.health_condition_note,
    street: app.street,
    city_town_village: app.city_town_village,
    district: app.district,
    mother_name: app.mother_name,
    father_name: app.father_name,
    nok_name: app.nok_name,
    nok_relationship: app.nok_relationship,
    nok_phone: app.nok_phone,
    atlib_exam: app.atlib_exam,
    num_csec: app.num_csec,
    finance_name: app.finance_name,
    finance_phone: app.finance_phone,
    finance_email: app.finance_email,
    recommendation_received: app.recommendation_received,
    applicant_signed_at: app.applicant_signed_at,
    guardian_signed_at: app.guardian_signed_at,
    academic_year_id: app.academic_year_id,
    enrolment_status: app.enrolment_status,
    comments: app.comments,
    decided_by_user_id: app.decided_by_user_id,
    decided_at: app.decided_at,
    updated_at: app.updated_at,
    education: D.application_education
      .filter((row) => row.application_id === app.id)
      .sort((a, b) => a.sort_order - b.sort_order),
    documents: D.application_documents.filter((row) => row.application_id === app.id),
    credit_transfers: D.credit_transfer_requests
      .filter((row) => row.application_id === app.id)
      .map(transferRead),
    blocking_issues: acceptanceIssues(app),
  };
}

const find = (id: string) => D.applications.find((a) => a.id === id);

/** The fields a client may write. Mirrors the server's `_WRITABLE` exactly. */
const WRITABLE = [
  'school_year',
  'first_name',
  'middle_name',
  'last_name',
  'date_of_birth',
  'ssno',
  'gender',
  'civil_status',
  'religion',
  'phone',
  'email',
  'has_health_condition',
  'health_condition_note',
  'street',
  'city_town_village',
  'district',
  'mother_name',
  'father_name',
  'nok_name',
  'nok_relationship',
  'nok_phone',
  'atlib_exam',
  'num_csec',
  'finance_name',
  'finance_phone',
  'finance_email',
  'recommendation_received',
  'program_id',
  'year_of_study',
  'enrollment_load',
  'applicant_signed_at',
  'guardian_signed_at',
  'academic_year_id',
  'enrolment_status',
  'comments',
] as const;

const BOOLEANS = new Set(['has_health_condition', 'atlib_exam', 'recommendation_received']);

/**
 * Apply only the keys PRESENT in the body — the wizard's whole premise. A body carrying
 * Section C must not blank Sections A, B and D.
 */
function applyWritable(app: DemoApplication, body: Record<string, unknown>): void {
  for (const key of WRITABLE) {
    if (!(key in body)) continue;
    const value = body[key];
    if (BOOLEANS.has(key)) {
      (app as unknown as Record<string, unknown>)[key] = Boolean(value);
      continue;
    }
    if (key === 'civil_status') {
      // D40 — folded here, mirroring the server's `normalise_civil_status` on this same
      // arm. It also covers the blank-to-null case the line below handles for everything
      // else, which is why it returns rather than falling through.
      app.civil_status = normaliseCivilStatus(value as string | null | undefined);
      continue;
    }
    (app as unknown as Record<string, unknown>)[key] =
      typeof value === 'string' && value.trim() === '' ? null : value;
  }
  app.updated_at = `${DEMO_TODAY}T12:00:00Z`;
}

/** `YYYYMM###`, allocated from the seeded rows so a second accept does not collide. */
function allocateStudentNumber(): string {
  const prefix = DEMO_TODAY.slice(0, 7).replace('-', '');
  const taken = D.students
    .map((s) => s.student_number)
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(6)))
    .filter((n) => !Number.isNaN(n));
  const next = (taken.length ? Math.max(...taken) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export const admissionsHandlers = [
  // ── GET /applications ────────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/applications`, ({ request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;

    const url = new URL(request.url);
    const params = listParamsFrom(url);
    const status = url.searchParams.get('status');
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    const programId = url.searchParams.get('program_id');

    let rows = [...D.applications];
    if (status) rows = rows.filter((a) => a.status === status);
    if (programId) rows = rows.filter((a) => a.program_id === programId);
    if (search) {
      rows = rows.filter((a) =>
        [a.first_name, a.last_name, a.email, a.student_code]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(search)),
      );
    }
    // Surname-first, the same rule as students (§D10) — never by the display string.
    rows.sort(
      (a, b) =>
        a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name),
    );

    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 25;
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      items: rows.slice(start, start + pageSize).map(listItem),
      total: rows.length,
      page,
      page_size: pageSize,
      total_pages: pageSize ? Math.ceil(rows.length / pageSize) : 0,
    });
  }),

  // ── POST /applications ──────────────────────────────────────────────────────
  http.post(`${API_BASE_URL}/applications`, async ({ request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const body = (await request.json()) as Record<string, unknown>;

    const first = String(body.first_name ?? '').trim();
    const last = String(body.last_name ?? '').trim();
    if (!first || !last) {
      return errorResponse(422, 'validation_error', 'Some fields need attention.', {
        last_name: ['Required.'],
      });
    }
    if (body.program_id && !D.programs.some((p) => p.id === body.program_id)) {
      return errorResponse(422, 'validation_error', 'Programme not found.', {
        program_id: ['Unknown programme.'],
      });
    }

    const app: DemoApplication = {
      id: nextId('app'),
      // D44 — allocated at CREATE, drafts included: the number is what the Registrar
      // quotes on the phone, long before anybody decides anything.
      application_number: nextApplicationNumber(),
      status: 'draft',
      school_year: null,
      first_name: first,
      middle_name: null,
      last_name: last,
      date_of_birth: null,
      ssno: null,
      gender: null,
      civil_status: null,
      religion: null,
      phone: null,
      email: null,
      has_health_condition: false,
      health_condition_note: null,
      street: null,
      city_town_village: null,
      district: null,
      mother_name: null,
      father_name: null,
      nok_name: null,
      nok_relationship: null,
      nok_phone: null,
      atlib_exam: false,
      num_csec: null,
      finance_name: null,
      finance_phone: null,
      finance_email: null,
      recommendation_received: false,
      program_id: null,
      year_of_study: null,
      enrollment_load: null,
      applicant_signed_at: null,
      guardian_signed_at: null,
      date_accepted: null,
      academic_year_id: null,
      enrolment_status: null,
      student_code: null,
      comments: null,
      decided_by_user_id: null,
      decided_at: null,
      student_id: null,
      created_at: `${DEMO_TODAY}T12:00:00Z`,
      updated_at: `${DEMO_TODAY}T12:00:00Z`,
    };
    applyWritable(app, body);
    D.applications.push(app);

    if (body.submit === true) {
      const issues = submissionIssues(app);
      if (issues.length > 0) {
        // Roll the create back: the server does the whole thing in one transaction.
        D.applications.splice(D.applications.indexOf(app), 1);
        return errorResponse(
          422,
          'application_incomplete',
          'This application is not complete enough to submit.',
          { application: issues },
        );
      }
      app.status = 'submitted';
    }
    return HttpResponse.json(detail(app), { status: 201 });
  }),

  // ── GET /applications/{id} ──────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/applications/:applicationId`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    return HttpResponse.json(detail(app));
  }),

  // ── PATCH /applications/{id} ────────────────────────────────────────────────
  http.patch(`${API_BASE_URL}/applications/:applicationId`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (isDecided(app)) {
      return errorResponse(
        409,
        'application_decided',
        `This application is ${app.status} and can no longer be edited.`,
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    if ('program_id' in body && body.program_id && !D.programs.some((p) => p.id === body.program_id)) {
      return errorResponse(422, 'validation_error', 'Programme not found.', {
        program_id: ['Unknown programme.'],
      });
    }
    const before = { first: app.first_name, last: app.last_name };
    applyWritable(app, body);
    if (!app.first_name?.trim() || !app.last_name?.trim()) {
      app.first_name = before.first;
      app.last_name = before.last;
      return errorResponse(422, 'validation_error', 'An application must keep a first and last name.', {
        last_name: ['Required.'],
      });
    }
    return HttpResponse.json(detail(app));
  }),

  // ── DELETE /applications/{id} — soft ────────────────────────────────────────
  http.delete(`${API_BASE_URL}/applications/:applicationId`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (app.status === 'accepted') {
      return errorResponse(
        409,
        'application_accepted',
        'This application has been accepted and a student record exists for it.',
      );
    }
    D.applications.splice(D.applications.indexOf(app), 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Transitions ─────────────────────────────────────────────────────────────
  http.post(`${API_BASE_URL}/applications/:applicationId/submit`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (app.status !== 'draft') {
      return errorResponse(
        409,
        isDecided(app) ? 'application_decided' : 'application_not_draft',
        `This application is already ${app.status}.`,
      );
    }
    const issues = submissionIssues(app);
    if (issues.length > 0) {
      return errorResponse(
        422,
        'application_incomplete',
        'This application is not complete enough to submit.',
        { application: issues },
      );
    }
    app.status = 'submitted';
    return HttpResponse.json(detail(app));
  }),

  http.post(`${API_BASE_URL}/applications/:applicationId/review`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    // D44 — also the RETURN path from `documents_pending`.
    if (app.status !== 'submitted' && app.status !== 'documents_pending') {
      return errorResponse(
        409,
        'application_not_submitted',
        `Only a submitted application, or one waiting on documents, can be moved under ` +
          `review (this one is ${app.status}).`,
      );
    }
    app.status = 'under_review';
    return HttpResponse.json(detail(app));
  }),

  // D44 — `/reject`, renamed from `/deny`, plus `/defer`. Both are terminal decisions
  // that take an optional note, so they share one handler factory rather than two copies
  // of the same twenty lines.
  ...(['reject', 'defer'] as const).map((verb) =>
    http.post(
      `${API_BASE_URL}/applications/:applicationId/${verb}`,
      async ({ params, request, cookies }) => {
        const denied = assertAdmissions(cookies);
        if (denied) return denied;
        const app = find(String(params.applicationId));
        if (!app) return errorResponse(404, 'not_found', 'Application not found.');
        if (!DECIDABLE.includes(app.status)) {
          return errorResponse(
            409,
            'application_not_decidable',
            `Only a submitted, under-review or eligible application can be ${verb}ed ` +
              `(this one is ${app.status}).`,
          );
        }
        const body = (await request.json().catch(() => ({}))) as { reason?: string | null };
        app.status = verb === 'reject' ? 'rejected' : 'deferred';
        app.decided_by_user_id = DEMO_IDS.principalUserId;
        app.decided_at = `${DEMO_TODAY}T12:00:00Z`;
        if (body.reason) {
          // Appended, never overwritten — earlier notes are part of the record.
          app.comments = app.comments ? `${app.comments}\n${body.reason}` : body.reason;
        }
        return HttpResponse.json(detail(app));
      },
    ),
  ),

  // D44 — back to the applicant. The one REVERSIBLE move; `/review` brings it back.
  http.post(
    `${API_BASE_URL}/applications/:applicationId/request-documents`,
    async ({ params, request, cookies }) => {
      const denied = assertAdmissions(cookies);
      if (denied) return denied;
      const app = find(String(params.applicationId));
      if (!app) return errorResponse(404, 'not_found', 'Application not found.');
      if (app.status !== 'submitted' && app.status !== 'under_review') {
        return errorResponse(
          409,
          'application_not_reviewable',
          `Only a submitted or under-review application can be sent back for documents ` +
            `(this one is ${app.status}).`,
        );
      }
      const body = (await request.json().catch(() => ({}))) as { reason?: string | null };
      app.status = 'documents_pending';
      if (body.reason) {
        app.comments = app.comments ? `${app.comments}\n${body.reason}` : body.reason;
      }
      return HttpResponse.json(detail(app));
    },
  ),

  // D44 — meets the requirements. NOT a decision: `decided_at` stays null.
  http.post(`${API_BASE_URL}/applications/:applicationId/eligible`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (app.status !== 'submitted' && app.status !== 'under_review') {
      return errorResponse(
        409,
        'application_not_reviewable',
        `Only a submitted or under-review application can be marked eligible ` +
          `(this one is ${app.status}).`,
      );
    }
    // `submissionIssues`, NOT `acceptanceIssues` — the latter adds "an email is required
    // to issue a login", which is a provisioning prerequisite rather than an academic
    // finding. Mirrors `service.mark_eligible`; see its docstring.
    const issues = submissionIssues(app);
    if (issues.length) {
      return errorResponse(
        422,
        'application_incomplete',
        'This application does not yet meet the requirements.',
      );
    }
    app.status = 'eligible';
    return HttpResponse.json(detail(app));
  }),

  // D44 — accepted AND registered. Closes the application behind the student record.
  http.post(`${API_BASE_URL}/applications/:applicationId/enrolled`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (app.status !== 'accepted') {
      return errorResponse(
        409,
        'application_not_accepted',
        `Only an accepted application can be marked enrolled (this one is ${app.status}).`,
      );
    }
    if (!app.student_id) {
      return errorResponse(
        409,
        'application_no_student',
        'This application has no student record, so it cannot be marked enrolled.',
      );
    }
    app.status = 'enrolled';
    return HttpResponse.json(detail(app));
  }),

  http.post(`${API_BASE_URL}/applications/:applicationId/withdraw`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (app.status === 'accepted') {
      return errorResponse(409, 'application_accepted', 'This application has already been accepted.');
    }
    if (isDecided(app)) {
      return errorResponse(409, 'application_decided', `This application is already ${app.status}.`);
    }
    app.status = 'withdrawn';
    app.decided_by_user_id = DEMO_IDS.principalUserId;
    app.decided_at = `${DEMO_TODAY}T12:00:00Z`;
    return HttpResponse.json(detail(app));
  }),

  // ── POST /applications/{id}/accept — the whole point (decision #5) ──────────
  http.post(`${API_BASE_URL}/applications/:applicationId/accept`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (app.status === 'accepted') {
      return errorResponse(409, 'application_accepted', 'This application has already been accepted.');
    }
    if (app.status !== 'submitted' && app.status !== 'under_review') {
      return errorResponse(
        409,
        'application_not_decidable',
        `Only a submitted or under-review application can be accepted (this one is ${app.status}).`,
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      login_email?: string | null;
      date_accepted?: string | null;
      comments?: string | null;
      temporary_password?: string | null;
    };
    const loginEmail = (body.login_email ?? app.email ?? '').trim();
    const issues = acceptanceIssues(app).filter(
      (issue) => !(loginEmail && issue.startsWith('An email address is required')),
    );
    if (issues.length > 0) {
      return errorResponse(422, 'application_incomplete', 'This application cannot be accepted yet.', {
        application: issues,
      });
    }
    if (D.users.some((u) => u.email === loginEmail)) {
      return errorResponse(409, 'duplicate_email', 'A user with this email already exists.');
    }

    const acceptedOn = body.date_accepted || DEMO_TODAY;
    const studentNumber = allocateStudentNumber();
    const userId = nextId('user-stu');
    const studentId = nextId('stu');

    D.users.push({
      id: userId,
      email: loginEmail,
      username: null,
      full_name: fullName(app),
      role: 'student',
      is_active: true,
      must_change_password: true,
      last_login_at: null,
      locale: 'en',
      theme: 'light',
      date_format: null,
      default_page_size: 25,
    });
    D.students.push({
      id: studentId,
      user_id: userId,
      student_number: studentNumber,
      first_name: app.first_name,
      middle_name: app.middle_name,
      last_name: app.last_name,
      full_name: fullName(app),
      date_of_birth: app.date_of_birth ?? '2000-01-01',
      // D37 — `canonicalGender`, mirroring the server's `normalise_gender` on this same
      // copy. The old line was `app.gender === 'female' ? 'female' : 'male'`, which sent
      // every unrecognised value — including a capitalised `'Female'` — to 'male'. That is
      // the browser-side half of the bug the live data already had.
      gender: canonicalGender(app.gender) ?? 'female',
      // D32 - acceptance copies the application's religion onto the student, mirroring
      // `admissions/service.py:263`. This is the only path that ever populates it.
      religion: app.religion ?? null,
      enrollment_date: acceptedOn,
      status: 'Active',
      // The declared year IS the level — the application and the profile now speak the same
      // `enum('First','Second')`, so this is a straight carry rather than a coercion.
      year_of_study: app.year_of_study ?? 'First',
      program_id: app.program_id,
      // These are non-null on `DemoStudent`; an application may legitimately omit them, so
      // they degrade to an empty string rather than widening the demo type.
      guardian_name: app.nok_name ?? app.mother_name ?? app.father_name ?? '',
      guardian_phone: app.nok_phone ?? '',
      guardian_email: '',
      address: [app.street, app.city_town_village, app.district].filter(Boolean).join(', '),
      phone: app.phone ?? '',
      // D33 — acceptance carries the WHOLE of Sections A-E across, mirroring
      // `admissions/service.py`. Before this only religion made the trip, so an accepted
      // applicant's next of kin and financier were on the frozen application and nowhere
      // on the live record the Registrar actually edits.
      ssno: app.ssno ?? null,
      // D40 — normalised on the copy for the same reason `gender` is: an application
      // written before the dropdown shipped still holds whatever was typed.
      civil_status: normaliseCivilStatus(app.civil_status),
      street: app.street ?? null,
      city_town_village: app.city_town_village ?? null,
      district: app.district ?? null,
      mother_name: app.mother_name ?? null,
      father_name: app.father_name ?? null,
      nok_name: app.nok_name ?? null,
      nok_relationship: app.nok_relationship ?? null,
      nok_phone: app.nok_phone ?? null,
      has_health_condition: app.has_health_condition ?? false,
      health_condition_note: app.health_condition_note ?? null,
      atlib_exam: app.atlib_exam ?? false,
      num_csec: app.num_csec ?? null,
      finance_name: app.finance_name ?? null,
      finance_phone: app.finance_phone ?? null,
      finance_email: app.finance_email ?? null,
      enrollment_load: app.enrollment_load ?? null,
      // ── D34 · the client's own columns ─────────────────────────────────────
      // The applicant's email becomes BOTH their login and their contact address at
      // acceptance; they are separate fields from here on, and only the login is
      // maintained through the Users module.
      email: app.email ?? null,
      origin: 'admissions',
      student_id_original: null,
      transferred_from: null,
      graduation_date: null,
      dropout_date: null,
      dropout_reason: null,
      comments: null,
      educationbg_id: null,
      doc_id: null,
    });
    if (app.program_id) {
      // History opens at admission, not at the first change (§D12).
      D.student_program_history.push({
        id: nextId('sph'),
        student_id: studentId,
        program_id: app.program_id,
        started_at: acceptedOn,
        ended_at: null,
        reason: 'Admitted',
      });
    }

    app.status = 'accepted';
    app.student_id = studentId;
    app.student_code = studentNumber;
    app.date_accepted = acceptedOn;
    app.academic_year_id = app.academic_year_id ?? DEMO_IDS.activeYearId;
    app.enrolment_status = app.enrolment_status ?? app.enrollment_load;
    app.decided_by_user_id = DEMO_IDS.principalUserId;
    app.decided_at = `${DEMO_TODAY}T12:00:00Z`;
    if (body.comments) {
      app.comments = app.comments ? `${app.comments}\n${body.comments}` : body.comments;
    }

    const transferred = D.credit_transfer_requests
      .filter((t) => t.application_id === app.id && t.status === 'approved')
      .map((t) => getCourse(t.target_course_id)?.code)
      .filter((code): code is string => Boolean(code))
      .sort();

    return HttpResponse.json(
      {
        application: detail(app),
        student_id: studentId,
        student_number: studentNumber,
        // Only a SERVER-generated secret comes back, and only once — same discipline as
        // `POST /settings/users`.
        temporary_password: body.temporary_password ? null : 'DemoTemp1!',
        login_email: loginEmail,
        transferred_course_codes: transferred,
      },
      { status: 201 },
    );
  }),

  // ── Section B ───────────────────────────────────────────────────────────────
  http.put(`${API_BASE_URL}/applications/:applicationId/education`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (isDecided(app)) {
      return errorResponse(409, 'application_decided', `This application is ${app.status}.`);
    }
    const body = (await request.json()) as { items?: Partial<DemoApplicationEducation>[] };
    const items = body.items ?? [];
    for (const item of items) {
      if (item.graduated && !item.graduation_date) {
        return errorResponse(422, 'validation_error', 'A graduated institution needs a graduation date.', {
          graduation_date: [`Required for ${item.institution ?? 'this institution'}.`],
        });
      }
    }
    // Whole-set replace, with `sort_order` renumbered server-side so the client never has
    // to keep it consistent while inserting and removing rows.
    for (let i = D.application_education.length - 1; i >= 0; i -= 1) {
      if (D.application_education[i]!.application_id === app.id) {
        D.application_education.splice(i, 1);
      }
    }
    items.forEach((item, index) => {
      D.application_education.push({
        id: nextId('appedu'),
        application_id: app.id,
        institution: String(item.institution ?? '').trim(),
        education_level: item.education_level ?? 'High School',
        graduated: Boolean(item.graduated),
        graduation_date: item.graduation_date ?? null,
        sort_order: index + 1,
      });
    });
    app.updated_at = `${DEMO_TODAY}T12:00:00Z`;
    return HttpResponse.json(detail(app));
  }),

  // ── Section F ───────────────────────────────────────────────────────────────
  http.put(`${API_BASE_URL}/applications/:applicationId/documents`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (isDecided(app)) {
      return errorResponse(409, 'application_decided', `This application is ${app.status}.`);
    }
    const body = (await request.json()) as { items?: Partial<DemoApplicationDocument>[] };
    const items = body.items ?? [];

    const existing = D.application_documents.filter((d) => d.application_id === app.id);
    const kept = new Set<string>();
    for (const item of items) {
      const target = item.id ? existing.find((d) => d.id === item.id) : undefined;
      if (target) {
        target.document_type = item.document_type ?? target.document_type;
        target.file_name = item.file_name ?? null;
        target.content_type = item.content_type ?? null;
        target.size_bytes = item.size_bytes ?? null;
        target.received = Boolean(item.received);
        kept.add(target.id);
      } else {
        const created: DemoApplicationDocument = {
          id: nextId('appdoc'),
          application_id: app.id,
          document_type: item.document_type ?? 'other',
          file_name: item.file_name ?? null,
          content_type: item.content_type ?? null,
          size_bytes: item.size_bytes ?? null,
          received: Boolean(item.received),
        };
        D.application_documents.push(created);
        kept.add(created.id);
      }
    }

    // A row cited by a credit transfer cannot be dropped: the three FKs are
    // `ON DELETE SET NULL`, so a blanket delete would silently strip a pending transfer of
    // its papers. 409 says so instead.
    const referenced = new Set(
      D.credit_transfer_requests
        .filter((t) => t.application_id === app.id)
        .flatMap((t) => [t.cta_document_id, t.transcript_document_id, t.outline_document_id])
        .filter((id): id is string => Boolean(id)),
    );
    for (const doc of existing) {
      if (kept.has(doc.id)) continue;
      if (referenced.has(doc.id)) {
        return errorResponse(
          409,
          'document_in_use',
          `The ${doc.document_type} document is attached to a credit transfer request and cannot be removed.`,
        );
      }
      D.application_documents.splice(D.application_documents.indexOf(doc), 1);
    }
    app.updated_at = `${DEMO_TODAY}T12:00:00Z`;
    return HttpResponse.json(detail(app));
  }),

  // ── Credit transfer on an application ───────────────────────────────────────
  http.get(`${API_BASE_URL}/applications/:applicationId/credit-transfers`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    return HttpResponse.json(
      D.credit_transfer_requests
        .filter((t) => t.application_id === String(params.applicationId))
        .map(transferRead),
    );
  }),

  http.post(`${API_BASE_URL}/applications/:applicationId/credit-transfers`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const app = find(String(params.applicationId));
    if (!app) return errorResponse(404, 'not_found', 'Application not found.');
    if (isDecided(app)) {
      // ADMISSION ONLY (brief §13) — once accepted there is a student, and the moment to
      // ask has passed.
      return errorResponse(
        409,
        'application_decided',
        `Credit transfer may only be requested while the application is open — this one is ${app.status}.`,
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    const targetCourseId = String(body.target_course_id ?? '');
    if (!getCourse(targetCourseId)) {
      return errorResponse(422, 'validation_error', 'Target course not found.', {
        target_course_id: ['Unknown course.'],
      });
    }
    if (
      D.credit_transfer_requests.some(
        (t) =>
          t.application_id === app.id &&
          t.target_course_id === targetCourseId &&
          t.status !== 'denied',
      )
    ) {
      return errorResponse(
        409,
        'duplicate_credit_transfer',
        'There is already a live credit transfer request for that course.',
      );
    }
    const created: DemoCreditTransferRequest = {
      id: nextId('cta'),
      application_id: app.id,
      external_institution: String(body.external_institution ?? '').trim(),
      external_course_code: (body.external_course_code as string) ?? null,
      external_course_name: String(body.external_course_name ?? '').trim(),
      external_credits: (body.external_credits as number) ?? null,
      external_grade: (body.external_grade as string) ?? null,
      target_course_id: targetCourseId,
      content_equivalency_pct: (body.content_equivalency_pct as number) ?? null,
      cta_document_id: (body.cta_document_id as string) ?? null,
      transcript_document_id: (body.transcript_document_id as string) ?? null,
      outline_document_id: (body.outline_document_id as string) ?? null,
      status: 'pending',
      decided_by_user_id: null,
      decided_at: null,
      note: (body.note as string) ?? null,
      created_at: `${DEMO_TODAY}T12:00:00Z`,
    };
    D.credit_transfer_requests.push(created);
    return HttpResponse.json(transferRead(created), { status: 201 });
  }),

  // ── Credit transfer by its own id ───────────────────────────────────────────
  http.get(`${API_BASE_URL}/credit-transfers`, ({ request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const applicationId = url.searchParams.get('application_id');
    let rows = [...D.credit_transfer_requests];
    if (status) rows = rows.filter((t) => t.status === status);
    if (applicationId) rows = rows.filter((t) => t.application_id === applicationId);
    return HttpResponse.json(rows.map(transferRead));
  }),

  http.patch(`${API_BASE_URL}/credit-transfers/:transferId`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const row = D.credit_transfer_requests.find((t) => t.id === String(params.transferId));
    if (!row) return errorResponse(404, 'not_found', 'Credit transfer request not found.');
    if (row.status !== 'pending') {
      return errorResponse(
        409,
        'credit_transfer_decided',
        `This request has already been ${row.status} and cannot be edited.`,
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    if ('target_course_id' in body && body.target_course_id) {
      if (!getCourse(String(body.target_course_id))) {
        return errorResponse(422, 'validation_error', 'Target course not found.', {
          target_course_id: ['Unknown course.'],
        });
      }
    }
    for (const [key, value] of Object.entries(body)) {
      if (key in row) (row as unknown as Record<string, unknown>)[key] = value;
    }
    return HttpResponse.json(transferRead(row));
  }),

  http.delete(`${API_BASE_URL}/credit-transfers/:transferId`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const row = D.credit_transfer_requests.find((t) => t.id === String(params.transferId));
    if (!row) return errorResponse(404, 'not_found', 'Credit transfer request not found.');
    if (row.status !== 'pending') {
      return errorResponse(
        409,
        'credit_transfer_decided',
        `This request has been ${row.status}; the Dean's decision is kept.`,
      );
    }
    D.credit_transfer_requests.splice(D.credit_transfer_requests.indexOf(row), 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── The DEAN decides (brief §13) ────────────────────────────────────────────
  http.post(`${API_BASE_URL}/credit-transfers/:transferId/decision`, async ({ params, request, cookies }) => {
    const denied = assertDean(cookies);
    if (denied) return denied;
    const row = D.credit_transfer_requests.find((t) => t.id === String(params.transferId));
    if (!row) return errorResponse(404, 'not_found', 'Credit transfer request not found.');
    if (row.status !== 'pending') {
      return errorResponse(409, 'credit_transfer_decided', `This request has already been ${row.status}.`);
    }
    const body = (await request.json()) as {
      status?: string;
      content_equivalency_pct?: number | null;
      note?: string | null;
    };
    if (body.status !== 'approved' && body.status !== 'denied') {
      return errorResponse(422, 'validation_error', 'A decision must be approved or denied.', {
        status: ['Use approved or denied.'],
      });
    }
    if (body.content_equivalency_pct != null) {
      row.content_equivalency_pct = body.content_equivalency_pct;
    }

    if (body.status === 'approved') {
      const pct = row.content_equivalency_pct;
      if (pct == null || pct < MIN_EQUIVALENCY_PCT) {
        return errorResponse(
          422,
          'equivalency_below_floor',
          `Credit transfer requires at least ${MIN_EQUIVALENCY_PCT}% content equivalency (brief §13).`,
          {
            content_equivalency_pct: [
              pct == null
                ? 'Not assessed yet.'
                : `${pct.toFixed(2)}% is below the ${MIN_EQUIVALENCY_PCT}% floor.`,
            ],
          },
        );
      }
      const hasTertiary = D.application_education.some(
        (e) => e.application_id === row.application_id && e.education_level === 'Tertiary',
      );
      if (!hasTertiary) {
        return errorResponse(
          422,
          'no_tertiary_institution',
          'Credit may only transfer from a recognised tertiary institution, and this application lists none in Section B.',
          { education: ['Add the tertiary institution to Section B.'] },
        );
      }
    }

    row.status = body.status;
    row.decided_by_user_id = DEMO_IDS.principalUserId;
    row.decided_at = `${DEMO_TODAY}T12:00:00Z`;
    if (body.note) row.note = row.note ? `${row.note}\n${body.note}` : body.note;
    return HttpResponse.json(transferRead(row));
  }),
];

/* ────────────────────────────────────────────────────────────────────────────
 * D38 · PENDING forms — `/pending-applications`
 *
 * Mirrors the server rule for rule, because the two behaviours the UI depends on here are
 * both invisible until they are wrong:
 *
 *   * **the `created_by` scope** — a Registrar reaches only their own rows, the Dean reaches
 *     all of them, and someone else's row answers **404, not 403**;
 *   * **a refused submit does not consume the row** — the pending form is still there after
 *     a 422, which is the whole point of D38's save-only-when-asked model.
 *
 * The demo login carries only a role, so the acting user is resolved from it the same way
 * handlers/students.ts resolves a teacher: `secretary` → `user-secretary`,
 * `principal` → the Dean. `temp-2` is seeded against a registrar with no demo login, so
 * signing in as the Registrar and seeing one row — then as the Dean and seeing two — is the
 * scope rule made visible rather than asserted.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The Dean sees every pending form; anyone else sees only their own. */
const maySeeAllPending = (role: string) => role === 'principal';

/** Role → the seeded user who acts. Mirrors the mapping in handlers/students.ts. */
function actingUser(role: string): { id: string; name: string } {
  if (role === 'principal') {
    const dean = D.users.find((u) => u.role === 'principal');
    return { id: dean?.id ?? 'user-principal', name: dean?.full_name ?? 'The Dean' };
  }
  const registrar = D.users.find((u) => u.id === 'user-secretary');
  return { id: registrar?.id ?? 'user-secretary', name: registrar?.full_name ?? 'The Registrar' };
}

/**
 * Scoped lookup. Returns `undefined` for a row that exists but is not the actor's, so the
 * caller answers 404 — a 403 would confirm the row is out there and whose it is.
 */
function findTemp(id: string, role: string): DemoApplicationTemp | undefined {
  const row = D.application_temp.find((t) => t.id === id);
  if (!row) return undefined;
  if (!maySeeAllPending(role) && row.created_by !== actingUser(role).id) return undefined;
  return row;
}

/**
 * `submissionIssues` reads only Sections A–G, which a pending row carries under the same
 * names — so the completeness answer is computed by the SAME function the applications
 * handlers use. Two implementations would be two chances to disagree with the server.
 */
const tempIssues = (row: DemoApplicationTemp): string[] =>
  submissionIssues(row as unknown as DemoApplication);

function pendingListItem(row: DemoApplicationTemp) {
  return {
    id: row.id,
    status: row.status,
    full_name: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    school_year: row.school_year,
    program: programRef(row.program_id),
    year_of_study: row.year_of_study,
    enrollment_load: row.enrollment_load,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    blocking_issues: tempIssues(row),
  };
}

function pendingDetail(row: DemoApplicationTemp) {
  return {
    ...pendingListItem(row),
    date_of_birth: row.date_of_birth,
    ssno: row.ssno,
    civil_status: row.civil_status,
    religion: row.religion,
    has_health_condition: row.has_health_condition,
    health_condition_note: row.health_condition_note,
    street: row.street,
    city_town_village: row.city_town_village,
    district: row.district,
    mother_name: row.mother_name,
    father_name: row.father_name,
    nok_name: row.nok_name,
    nok_relationship: row.nok_relationship,
    nok_phone: row.nok_phone,
    atlib_exam: row.atlib_exam,
    num_csec: row.num_csec,
    finance_name: row.finance_name,
    finance_phone: row.finance_phone,
    finance_email: row.finance_email,
    recommendation_received: row.recommendation_received,
    applicant_signed_at: row.applicant_signed_at,
    guardian_signed_at: row.guardian_signed_at,
    academic_year_id: row.academic_year_id,
    enrolment_status: row.enrolment_status,
    comments: row.comments,
    education: [...row.education].sort((a, b) => a.sort_order - b.sort_order),
    documents: row.documents,
  };
}

/**
 * Section B / F out of the request body. `sort_order` is renumbered from the submitted
 * ORDER, exactly as the server does, so the client never has to keep it consistent while
 * inserting and removing rows.
 */
function tempChildren(tempId: string, body: Record<string, unknown>) {
  const education = (Array.isArray(body.education) ? body.education : []).map(
    (item, index) =>
      ({
        ...(item as object),
        id: `${tempId}-edu-${index + 1}`,
        application_id: tempId,
        sort_order: index + 1,
      }) as DemoApplicationEducation,
  );
  const documents = (Array.isArray(body.documents) ? body.documents : []).map(
    (item, index) =>
      ({
        ...(item as object),
        id: `${tempId}-doc-${index + 1}`,
        application_id: tempId,
      }) as DemoApplicationDocument,
  );
  return { education, documents };
}

export const pendingApplicationsHandlers = [
  // ── GET /pending-applications ───────────────────────────────────────────────
  http.get(`${API_BASE_URL}/pending-applications`, ({ request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;

    const role = sessionRole(cookies);
    const url = new URL(request.url);
    const params = listParamsFrom(url);
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();

    let rows = maySeeAllPending(role)
      ? [...D.application_temp]
      : D.application_temp.filter((t) => t.created_by === actingUser(role).id);

    if (search) {
      rows = rows.filter((t) =>
        [t.first_name, t.last_name, t.email]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(search)),
      );
    }
    // Surname-first, the same rule as every other directory (§D10).
    rows.sort(
      (a, b) =>
        a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name),
    );

    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 25;
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      items: rows.slice(start, start + pageSize).map(pendingListItem),
      total: rows.length,
      page,
      page_size: pageSize,
      total_pages: pageSize ? Math.ceil(rows.length / pageSize) : 0,
    });
  }),

  // ── POST /pending-applications ──────────────────────────────────────────────
  http.post(`${API_BASE_URL}/pending-applications`, async ({ request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const body = (await request.json()) as Record<string, unknown>;

    const first = String(body.first_name ?? '').trim();
    const last = String(body.last_name ?? '').trim();
    if (!first || !last) {
      return errorResponse(422, 'validation_error', 'Some fields need attention.', {
        last_name: ['Required.'],
      });
    }
    if (body.program_id && !D.programs.some((p) => p.id === body.program_id)) {
      return errorResponse(422, 'validation_error', 'Programme not found.', {
        program_id: ['Unknown programme.'],
      });
    }

    const actor = actingUser(sessionRole(cookies));
    const id = nextId('temp');
    const { education, documents } = tempChildren(id, body);
    const row: DemoApplicationTemp = {
      id,
      status: 'pending',
      school_year: null,
      first_name: first,
      middle_name: null,
      last_name: last,
      date_of_birth: null,
      ssno: null,
      gender: null,
      civil_status: null,
      religion: null,
      phone: null,
      email: null,
      has_health_condition: false,
      health_condition_note: null,
      street: null,
      city_town_village: null,
      district: null,
      mother_name: null,
      father_name: null,
      nok_name: null,
      nok_relationship: null,
      nok_phone: null,
      atlib_exam: false,
      num_csec: null,
      finance_name: null,
      finance_phone: null,
      finance_email: null,
      recommendation_received: false,
      program_id: null,
      year_of_study: null,
      enrollment_load: null,
      applicant_signed_at: null,
      guardian_signed_at: null,
      academic_year_id: null,
      enrolment_status: null,
      comments: null,
      created_by: actor.id,
      created_by_name: actor.name,
      created_at: `${DEMO_TODAY}T12:00:00Z`,
      updated_at: `${DEMO_TODAY}T12:00:00Z`,
      education,
      documents,
    };
    // Reuses the applications writer: the writable set is identical by construction.
    applyWritable(row as unknown as DemoApplication, body);
    D.application_temp.push(row);
    return HttpResponse.json(pendingDetail(row), { status: 201 });
  }),

  // ── GET /pending-applications/{id} ──────────────────────────────────────────
  http.get(`${API_BASE_URL}/pending-applications/:tempId`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const row = findTemp(String(params.tempId), sessionRole(cookies));
    if (!row) return errorResponse(404, 'not_found', 'Pending application not found.');
    return HttpResponse.json(pendingDetail(row));
  }),

  // ── PATCH /pending-applications/{id} ────────────────────────────────────────
  http.patch(`${API_BASE_URL}/pending-applications/:tempId`, async ({ params, request, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const row = findTemp(String(params.tempId), sessionRole(cookies));
    if (!row) return errorResponse(404, 'not_found', 'Pending application not found.');

    const body = (await request.json()) as Record<string, unknown>;
    if (body.program_id && !D.programs.some((p) => p.id === body.program_id)) {
      return errorResponse(422, 'validation_error', 'Programme not found.', {
        program_id: ['Unknown programme.'],
      });
    }
    applyWritable(row as unknown as DemoApplication, body);
    const { education, documents } = tempChildren(row.id, body);
    row.education = education;
    row.documents = documents;
    // `created_by` is NOT reassigned: it is the scope, so a Dean's edit must not take the
    // form away from the Registrar who filed it.
    return HttpResponse.json(pendingDetail(row));
  }),

  // ── DELETE /pending-applications/{id} — HARD ────────────────────────────────
  http.delete(`${API_BASE_URL}/pending-applications/:tempId`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const row = findTemp(String(params.tempId), sessionRole(cookies));
    if (!row) return errorResponse(404, 'not_found', 'Pending application not found.');
    D.application_temp.splice(D.application_temp.indexOf(row), 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── POST /pending-applications/{id}/submit — PROMOTE ────────────────────────
  http.post(`${API_BASE_URL}/pending-applications/:tempId/submit`, ({ params, cookies }) => {
    const denied = assertAdmissions(cookies);
    if (denied) return denied;
    const row = findTemp(String(params.tempId), sessionRole(cookies));
    if (!row) return errorResponse(404, 'not_found', 'Pending application not found.');

    const issues = tempIssues(row);
    if (issues.length > 0) {
      // THE ROW STAYS. A refused submit that consumed it would destroy exactly the work
      // D38's save-only-when-asked model exists to protect.
      return errorResponse(
        422,
        'application_incomplete',
        'This application is not complete enough to submit.',
        { application: issues },
      );
    }

    const graduatedWithoutDate = row.education.find((e) => e.graduated && !e.graduation_date);
    if (graduatedWithoutDate) {
      return errorResponse(422, 'validation_error', 'Some fields need attention.', {
        graduation_date: [`Required for ${graduatedWithoutDate.institution}.`],
      });
    }

    const appId = nextId('app');
    const app: DemoApplication = {
      ...(row as unknown as DemoApplication),
      id: appId,
      // D44 — the pending row never had a number; this is the moment a real application
      // exists, so this is where one is issued.
      application_number: nextApplicationNumber(),
      status: 'submitted',
      date_accepted: null,
      student_code: null,
      decided_by_user_id: null,
      decided_at: null,
      student_id: null,
      updated_at: `${DEMO_TODAY}T12:00:00Z`,
    };
    // Strip the four fields that exist only on a pending row. The spread above copied
    // them, and leaving them on a `DemoApplication` would put properties in the demo store
    // that its own type does not have — which is how a demo drifts from the server it is
    // supposed to be standing in for.
    for (const key of ['education', 'documents', 'created_by', 'created_by_name']) {
      delete (app as unknown as Record<string, unknown>)[key];
    }
    D.applications.push(app);
    row.education.forEach((e, index) =>
      D.application_education.push({ ...e, id: `${appId}-edu-${index + 1}`, application_id: appId }),
    );
    row.documents.forEach((d, index) =>
      D.application_documents.push({ ...d, id: `${appId}-doc-${index + 1}`, application_id: appId }),
    );
    D.application_temp.splice(D.application_temp.indexOf(row), 1);

    return HttpResponse.json(detail(app), { status: 201 });
  }),
];

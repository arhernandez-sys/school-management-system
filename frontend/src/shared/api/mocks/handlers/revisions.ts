import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  getClassSubject,
  getSection,
  getStudent,
  getSubject,
} from '@shared/api/mocks/demo/dataset';
import type { DemoGradeRevisionRequest } from '@shared/api/mocks/demo/dataset';
import { errorResponse } from './_helpers';

/**
 * MSW handlers for GRADE REVISION (D30 §D7/§D8) — DEMO.
 *
 * **Parity with the real backend is the point.** Every rule that shapes the UI is mirrored:
 * the Lecturer requests and the DEAN decides (403 either way round); a revision needs a
 * recorded GRADED result; the proposed mark must be within `max_score` and must differ;
 * ONE pending request per grade; approval writes `makeup_score` and **leaves `score`
 * alone**; and approval works while the grade window is CLOSED.
 *
 * The last of those is why the demo dataset's active term carries a FUTURE deadline: the
 * gradebook stays usable, and moving the date back is how a demoer shows the lock plus the
 * revision route around it.
 *
 * Deterministic throughout — no `Math.random()`, no `Date.now()`. Ids come from a counter
 * and timestamps from `DEMO_TODAY_ISO`, so the dataset stays byte-stable across reloads.
 */
const D = DEMO_DATASET;
const SESSION_COOKIE = 'sis_mock_session';

function sessionRole(cookies: Record<string, string>): string {
  return cookies[SESSION_COOKIE] ?? 'principal';
}

/** The acting Lecturer, matching how students.ts / grades.ts resolve one. */
function currentTeacherId(role: string): string | null {
  if (role !== 'teacher') return null;
  return D.teachers.find((t) => t.user_id === 'user-teach-1')?.id ?? D.teachers[0]?.id ?? null;
}

/** The user id a request is filed under, so "my own requests" is answerable. */
function currentUserId(role: string): string {
  if (role === 'teacher') return 'user-teach-1';
  if (role === 'principal') return 'user-principal';
  return `user-${role}`;
}

let idCounter = 0;
const nextId = (): string => {
  idCounter += 1;
  return `rev-demo-${idCounter}`;
};

function read(row: DemoGradeRevisionRequest, role: string) {
  const grade = D.assessment_grades.find((g) => g.id === row.assessment_grade_id);
  const assessment = grade
    ? D.assessments.find((a) => a.id === grade.assessment_id)
    : undefined;
  const cs = assessment ? getClassSubject(assessment.class_subject_id) : undefined;
  const subject = cs ? getSubject(cs.subject_id) : undefined;
  const section = cs ? getSection(cs.section_id) : undefined;
  const student = grade ? getStudent(grade.student_id) : undefined;
  const requester = D.users.find((u) => u.id === row.requested_by_user_id);
  const decider = row.decided_by_user_id
    ? D.users.find((u) => u.id === row.decided_by_user_id)
    : undefined;

  return {
    id: row.id,
    assessment_grade_id: row.assessment_grade_id,
    status: row.status,
    reason: row.reason,
    original_score: row.original_score,
    proposed_score: row.proposed_score,
    decision_note: row.decision_note,
    decided_at: row.decided_at,
    created_at: row.created_at,
    student: student
      ? {
          id: student.id,
          full_name: student.full_name,
          student_number: student.student_number,
        }
      : null,
    assessment_id: assessment?.id ?? null,
    assessment_title: assessment?.title ?? '',
    max_score: assessment?.max_score ?? null,
    class_subject_id: cs?.id ?? null,
    subject_name: subject?.name ?? '',
    subject_code: subject?.code ?? null,
    section_name: section?.name ?? '',
    requested_by_user_id: row.requested_by_user_id,
    requested_by_name: requester?.full_name ?? '',
    decided_by_user_id: row.decided_by_user_id,
    decided_by_name: decider?.full_name ?? null,
    can_withdraw:
      row.status === 'pending' && row.requested_by_user_id === currentUserId(role),
  };
}

/** Non-zero only for the Dean — the badge has to mean "this needs YOU" (§D8). */
export function pendingRevisionsFor(role: string): number {
  if (role !== 'principal') return 0;
  return D.grade_revision_requests.filter((r) => r.status === 'pending').length;
}

export const revisionsHandlers = [
  // ── GET /grade-revisions ────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grade-revisions`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'teacher') {
      return errorResponse(
        403,
        'forbidden',
        'Grade revisions are visible to the Dean and to the requesting Lecturer.',
      );
    }
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const classSubjectId = url.searchParams.get('class_subject_id');

    let rows = [...D.grade_revision_requests];
    if (role === 'teacher') {
      // Scoped, not filtered-for-display: another Lecturer's request concerns a student
      // they may have no relationship with.
      rows = rows.filter((r) => r.requested_by_user_id === currentUserId(role));
    }
    if (status) rows = rows.filter((r) => r.status === status);
    if (classSubjectId) {
      rows = rows.filter((r) => {
        const grade = D.assessment_grades.find((g) => g.id === r.assessment_grade_id);
        const assessment = grade
          ? D.assessments.find((a) => a.id === grade.assessment_id)
          : undefined;
        return assessment?.class_subject_id === classSubjectId;
      });
    }
    // Oldest first, with the id as a TIEBREAKER — `created_at` has whole-second precision
    // in the real schema, so ordering on it alone lets queue rows shuffle between reads.
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

    return HttpResponse.json({
      items: rows.map((r) => read(r, role)),
      pending_for_me: pendingRevisionsFor(role),
    });
  }),

  // ── GET /grade-revisions/{id} ───────────────────────────────────────────────
  http.get(`${API_BASE_URL}/grade-revisions/:revisionId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (role !== 'principal' && role !== 'teacher') {
      return errorResponse(403, 'forbidden', 'Grade revisions are not visible to you.');
    }
    const row = D.grade_revision_requests.find((r) => r.id === String(params.revisionId));
    if (!row) return errorResponse(404, 'not_found', 'Grade revision request not found.');
    if (role === 'teacher' && row.requested_by_user_id !== currentUserId(role)) {
      // 404, not 403 — no existence leak, same as the gradebook.
      return errorResponse(404, 'not_found', 'Grade revision request not found.');
    }
    return HttpResponse.json(read(row, role));
  }),

  // ── POST /assessments/{id}/grade-revisions — the LECTURER asks ──────────────
  http.post(
    `${API_BASE_URL}/assessments/:assessmentId/grade-revisions`,
    async ({ params, request, cookies }) => {
      const role = sessionRole(cookies);
      const assessmentId = String(params.assessmentId);
      const assessment = D.assessments.find((a) => a.id === assessmentId);
      if (!assessment) return errorResponse(404, 'not_found', 'Assessment not found.');

      if (role !== 'teacher') {
        // The Dean DECIDES revisions; letting them file one would put both halves of the
        // workflow in one pair of hands.
        return errorResponse(
          403,
          'forbidden',
          'Only the Lecturer who teaches the course may request a grade revision.',
        );
      }
      const teacherId = currentTeacherId(role);
      const cs = getClassSubject(assessment.class_subject_id);
      if (!cs || (teacherId && !cs.teacher_ids.includes(teacherId))) {
        return errorResponse(404, 'not_found', 'Resource not found.');
      }

      const body = (await request.json()) as {
        student_id?: string;
        reason?: string;
        proposed_score?: number;
      };
      const grade = D.assessment_grades.find(
        (g) => g.assessment_id === assessmentId && g.student_id === body.student_id,
      );
      if (!grade) {
        return errorResponse(
          422,
          'grade_not_entered',
          'This student has no result recorded for that assessment, so there is nothing to revise.',
          { student_id: ['No grade on record.'] },
        );
      }
      if (grade.status !== 'graded') {
        return errorResponse(
          422,
          'grade_not_graded',
          `This result is ${grade.status}, not graded. An absent result already has a makeup path.`,
          { student_id: [`Result is ${grade.status}.`] },
        );
      }
      const proposed = Number(body.proposed_score);
      if (!Number.isFinite(proposed) || proposed < 0 || proposed > assessment.max_score) {
        return errorResponse(
          422,
          'score_exceeds_max',
          `The proposed score must be between 0 and ${assessment.max_score}.`,
          { proposed_score: [`Maximum is ${assessment.max_score}.`] },
        );
      }
      if (grade.score != null && Math.abs(grade.score - proposed) < 1e-9) {
        return errorResponse(
          422,
          'revision_no_change',
          'The proposed score is the same as the current one.',
          { proposed_score: ['Must differ from the current score.'] },
        );
      }
      if (!body.reason || !body.reason.trim()) {
        return errorResponse(422, 'validation_error', 'A reason is required.', {
          reason: ['Required.'],
        });
      }
      if (
        D.grade_revision_requests.some(
          (r) => r.assessment_grade_id === grade.id && r.status === 'pending',
        )
      ) {
        return errorResponse(
          409,
          'revision_already_pending',
          "There is already a revision request awaiting the Dean's decision for this result.",
        );
      }

      const created: DemoGradeRevisionRequest = {
        id: nextId(),
        assessment_grade_id: grade.id,
        requested_by_user_id: currentUserId(role),
        reason: body.reason.trim(),
        // Snapshotted at request time — the point is what the student had THEN.
        original_score: grade.score,
        proposed_score: proposed,
        status: 'pending',
        decided_by_user_id: null,
        decided_at: null,
        decision_note: null,
        created_at: DEMO_TODAY_ISO,
      };
      D.grade_revision_requests.push(created);
      return HttpResponse.json(read(created, role), { status: 201 });
    },
  ),

  // ── DELETE /grade-revisions/{id} — the requester withdraws ──────────────────
  http.delete(`${API_BASE_URL}/grade-revisions/:revisionId`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    const row = D.grade_revision_requests.find((r) => r.id === String(params.revisionId));
    if (!row) return errorResponse(404, 'not_found', 'Grade revision request not found.');
    if (row.requested_by_user_id !== currentUserId(role)) {
      // Withdrawal is the REQUESTER's action. The Dean's tool is a denial, which leaves a
      // ruling behind — deleting it instead would erase the fact it was asked.
      return errorResponse(404, 'not_found', 'Grade revision request not found.');
    }
    if (row.status !== 'pending') {
      return errorResponse(
        409,
        'revision_decided',
        `This request has already been ${row.status}; the Dean's decision is kept.`,
      );
    }
    D.grade_revision_requests.splice(D.grade_revision_requests.indexOf(row), 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── POST /grade-revisions/{id}/decision — the DEAN rules ───────────────────
  http.post(
    `${API_BASE_URL}/grade-revisions/:revisionId/decision`,
    async ({ params, request, cookies }) => {
      const role = sessionRole(cookies);
      if (role !== 'principal') {
        return errorResponse(403, 'forbidden', 'Only the Dean may decide a grade revision.');
      }
      const row = D.grade_revision_requests.find((r) => r.id === String(params.revisionId));
      if (!row) return errorResponse(404, 'not_found', 'Grade revision request not found.');
      if (row.status !== 'pending') {
        return errorResponse(
          409,
          'revision_decided',
          `This request has already been ${row.status}.`,
        );
      }
      const body = (await request.json()) as {
        status?: string;
        decision_note?: string | null;
      };
      if (body.status !== 'approved' && body.status !== 'denied') {
        return errorResponse(422, 'validation_error', 'A decision must be approved or denied.', {
          status: ['Use approved or denied.'],
        });
      }

      if (body.status === 'approved') {
        const grade = D.assessment_grades.find((g) => g.id === row.assessment_grade_id);
        if (grade) {
          // THE ONE WRITE. `score` is deliberately untouched (§D7); `makeup_score` holds
          // the revision, and `computeTermGrade` prefers it on a graded row.
          grade.makeup_score = row.proposed_score;
        }
        // NOTE: no grade-window check. Approval writes through a CLOSED deadline on
        // purpose — this is the post-deadline path Phase 3's dormant bypass pointed at.
      }

      row.status = body.status;
      row.decided_by_user_id = 'user-principal';
      row.decided_at = DEMO_TODAY_ISO;
      if (body.decision_note) {
        row.decision_note = row.decision_note
          ? `${row.decision_note}\n${body.decision_note}`
          : body.decision_note;
      }
      return HttpResponse.json(read(row, role));
    },
  ),
];

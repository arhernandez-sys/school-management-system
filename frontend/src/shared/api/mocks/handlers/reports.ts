import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  attendanceSummaryForSection,
  classSubjectsForStudent,
  rosterFor,
  computeTermGrade,
  getActiveSemester,
  getActiveYear,
  getSection,
  getStudent,
  getSubject,
  getTeacher,
  gpaFor,
  letterFor,
  listStudents,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAssessment,
  DemoClassSubject,
  DemoSemester,
  DemoStudent,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the REPORTS module (api-spec §5 Module 10, incl. Transcript) — DEMO.
 *
 * Read-only aggregators backed by the shared demo dataset so every figure reconciles
 * with the gradebook, attendance and dashboard screens (all derive from the same
 * `computeTermGrade` / `attendanceSummaryForSection` selectors). Export is browser
 * print of the rendered page (D27 / Q8) — there is no server-PDF endpoint.
 *
 * Endpoints:
 *  - GET /reports/students          — student picker source (self-contained; does not
 *                                     depend on the Students module's own handlers).
 *  - GET /reports/report-card       — assembled ReportCard for ?student_id (+?semester_id).
 *  - GET /reports/report-card/me    — the caller's own ReportCard (student role).
 *  - GET /reports/transcript        — multi-year Transcript for ?student_id. Teacher /
 *                                     student callers → 403 (D26 — P/S only).
 *  - GET /reports/class-grades      — per-offering subject grade summary + distribution.
 *  - GET /reports/attendance        — per-section attendance summary.
 *  - GET /reports/enrollment        — headcount / enrollment report.
 *
 * The mock session role is the non-HttpOnly `sis_mock_session` cookie (see auth.ts);
 * the transcript uses it to enforce the D26 P/S-only role gate server-side.
 */
const D = DEMO_DATASET;

const SESSION_COOKIE = 'sis_mock_session';

/** Read the mock session role from MSW-parsed cookies (auth.ts sets it on login). */
function sessionRole(cookies: Record<string, string>): string | null {
  return cookies[SESSION_COOKIE] ?? null;
}

/**
 * Resolve the demo student a "self" (`/me`) student caller maps to. The mock token's
 * `student_profile_id` is a placeholder, not a real dataset id, so for the demo we
 * pick the first active student that has a linked login (stu-1 = Ana Lopez).
 */
function selfStudent(): DemoStudent | undefined {
  return D.students.find((s) => s.status === 'active' && s.user_id) ?? D.students[0];
}

// ── Response shape builders ───────────────────────────────────────────────────────

/**
 * The student as printed on a report card / transcript / picker row.
 *
 * D29: `section_id` / `section_name` / `grade_level` are gone — all three were read off the
 * student's homeroom, and a sixth-former has no single class to head their card with.
 * `year_group` (their own level) replaces them.
 */
function studentRef(s: DemoStudent) {
  return {
    id: s.id,
    full_name: s.full_name,
    student_number: s.student_number,
    date_of_birth: s.date_of_birth,
    status: s.status,
    year_group: s.year_group,
  };
}

function schoolIdentity() {
  const p = D.school_profile;
  return { name: p.name, address: p.address, phone: p.phone, email: p.email, logo_url: p.logo_url };
}

function semesterRef(sem: DemoSemester) {
  const year = D.academic_years.find((y) => y.id === sem.academic_year_id);
  return {
    id: sem.id,
    name: sem.name,
    sequence: sem.sequence,
    academic_year_id: sem.academic_year_id,
    academic_year_name: year?.name ?? '',
  };
}

/**
 * The BAJC report card's `Period` label (D30 §D13) — `"<Term>, <Mon YYYY> - <Mon YYYY>"`,
 * reproducing the sample's `Summer, July 2026 - August 2026`. Mirrors
 * `reports/service._period_for` so demo mode and the backend print the same string.
 */
function periodFor(sem: DemoSemester): string {
  const month = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };
  return `${sem.name}, ${month(sem.start_date)} - ${month(sem.end_date)}`;
}

/** Lead teacher's display name for an offering, if any. */
function leadTeacherName(cs: DemoClassSubject): string | null {
  const id = cs.lead_teacher_id ?? cs.teacher_ids[0] ?? null;
  return id ? (getTeacher(id)?.full_name ?? null) : null;
}

/** Is every graded assessment counted toward this offering's term grade released? */
function offeringFullyReleased(cs: DemoClassSubject): boolean {
  const graded = D.assessments.filter(
    (a: DemoAssessment) => a.class_subject_id === cs.id && a.status === 'graded',
  );
  if (graded.length === 0) return true;
  return graded.every((a) => a.is_released);
}

/**
 * Assemble one ReportCard for a (student, semester). For a student caller
 * (`releaseFilter`), offerings with any unreleased graded assessment surface as
 * `status:"pending"` with no numeric (AC 5.5) — P/S/teacher always see the computed value.
 */
function buildReportCard(student: DemoStudent, semester: DemoSemester, releaseFilter: boolean) {
  // D29: one row per subject class the student sits, not per subject of one homeroom.
  const offerings = classSubjectsForStudent(student.id).filter((cs) => cs.is_active);

  const subjects = offerings
    .map((cs) => {
      const subject = getSubject(cs.subject_id);
      const term = computeTermGrade(student.id, cs.id);
      const released = offeringFullyReleased(cs);
      const pending = releaseFilter && !released;
      return {
        subject: { id: cs.subject_id, name: subject?.name ?? '', code: subject?.code ?? '' },
        teacher: leadTeacherName(cs),
        credits: subject?.credits ?? null,
        numeric: pending ? null : term.numeric,
        letter: pending ? null : term.letter,
        status: pending ? ('pending' as const) : ('graded' as const),
      };
    })
    .sort((a, b) => a.subject.name.localeCompare(b.subject.name));

  // Term average = mean of the graded subjects' numeric term grades.
  const graded = subjects.filter((s) => s.status === 'graded' && s.numeric != null);
  const termAverage =
    graded.length > 0
      ? Math.round((graded.reduce((sum, s) => sum + (s.numeric ?? 0), 0) / graded.length) * 100) / 100
      : null;

  // Credit-weighted GPA over EVERY enrolled row, ungraded and withheld included
  // (D30 §D5, decision #4). A withheld (`pending`) row already has `letter: null`, so it
  // contributes 0 quality points while keeping its credits — the same treatment the
  // backend gives it, and the reason the figure cannot be used to back out a hidden mark.
  const gpa = gpaFor(subjects.map((s) => ({ credits: s.credits, letter: s.letter })));

  // D29: the student's own attendance across every class they sit, matching the backend
  // (which scopes by student + semester, never by one class).
  const attRows = D.attendance_records.filter((r) => r.student_id === student.id);
  const attCounts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of attRows) attCounts[r.status] += 1;
  const att = {
    ...attCounts,
    pct_present: attRows.length
      ? Math.round((attCounts.present / attRows.length) * 1000) / 10
      : 0,
  };

  return {
    student: studentRef(student),
    // The `section` block is gone (D29) — the card spans every class the student sits, so
    // there is no one class to name. The header shows their level instead.
    year_group: student.year_group,
    semester: semesterRef(semester),
    school: schoolIdentity(),
    // Null until Phase 4 assigns students to programmes (§D12) — demo students carry no
    // programme either, so this matches the backend rather than papering over it.
    program_code: null,
    period: periodFor(semester),
    // Meaning unconfirmed with BAJC (plan §G item 3); the sample prints `-`.
    block: null,
    subjects,
    attendance_summary: {
      pct_present: att.pct_present,
      absent: att.absent,
      late: att.late,
      excused: att.excused,
    },
    term_average: termAverage,
    term_average_letter: termAverage != null ? letterFor(termAverage) : null,
    gpa: gpa.gpa,
    total_credits: gpa.total_credits,
    is_frozen: false, // demo: live compute-on-read only (no archived snapshots)
  };
}

/**
 * Assemble a multi-year Transcript for a student: every academic_year → semester →
 * subject with numeric+letter, newest year first. In the demo, graded data lives in
 * the active semester only, so completed/empty semesters render with no subjects.
 */
function buildTranscript(student: DemoStudent) {
  const activeSemester = getActiveSemester();
  const offerings = classSubjectsForStudent(student.id).filter((cs) => cs.is_active);

  const years = [...D.academic_years]
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((year) => {
      const semesters = D.semesters
        .filter((s) => s.academic_year_id === year.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((sem) => {
          // Demo: only the active semester of the student's section has computed grades.
          const hasData = activeSemester?.id === sem.id && offerings.length > 0;
          const subjects = hasData
            ? offerings
                .map((cs) => {
                  const subject = getSubject(cs.subject_id);
                  const term = computeTermGrade(student.id, cs.id);
                  return {
                    subject: {
                      id: cs.subject_id,
                      name: subject?.name ?? '',
                      code: subject?.code ?? '',
                    },
                    teacher: leadTeacherName(cs),
                    credits: subject?.credits ?? null,
                    numeric: term.numeric,
                    letter: term.letter ?? '',
                  };
                })
                .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
            : [];
          // The GPA is built from ALL enrolled rows and the LISTING is filtered after,
          // matching the backend: a transcript prints graded lines only, but the GPA
          // denominator is every enrolled credit (decision #4). Filtering first would
          // print a graded-only mean.
          const termGpa = gpaFor(subjects.map((r) => ({ credits: r.credits, letter: r.letter })));
          const gradedRows = subjects.filter((r) => r.numeric != null);
          const termAverage =
            gradedRows.length > 0
              ? Math.round(
                  (gradedRows.reduce((sum, s) => sum + (s.numeric ?? 0), 0) / gradedRows.length) *
                    100,
                ) / 100
              : null;
          return {
            semester: semesterRef(sem),
            is_current: activeSemester?.id === sem.id && year.status === 'active',
            term_average: termAverage,
            gpa: termGpa.gpa,
            total_credits: termGpa.total_credits,
            gpaEntries: subjects.map((r) => ({ credits: r.credits, letter: r.letter })),
            subjects: gradedRows,
          };
        })
        .filter((s) => s.subjects.length > 0 || s.is_current);

      const termAverages = semesters
        .map((s) => s.term_average)
        .filter((n): n is number => n != null);
      const yearAverage =
        termAverages.length > 0
          ? Math.round((termAverages.reduce((a, b) => a + b, 0) / termAverages.length) * 100) / 100
          : null;
      // Recomputed from the year's own credits, NOT averaged from its terms' GPAs — a
      // 6-credit summer block must not weigh the same as an 18-credit semester.
      const yearGpa = gpaFor(semesters.flatMap((sem) => sem.gpaEntries));

      return {
        academic_year: { id: year.id, name: year.name, status: year.status },
        year_average: yearAverage,
        gpa: yearGpa.gpa,
        total_credits: yearGpa.total_credits,
        semesters: semesters.map(({ gpaEntries: _drop, ...rest }) => rest),
        gpaEntries: semesters.flatMap((sem) => sem.gpaEntries),
      };
    })
    // Drop years with no populated semesters (empty archived year in the demo).
    .filter((y) => y.semesters.length > 0);

  const allTermAverages = years
    .flatMap((y) => y.semesters.map((s) => s.term_average))
    .filter((n): n is number => n != null);
  const cumulativeAverage =
    allTermAverages.length > 0
      ? Math.round((allTermAverages.reduce((a, b) => a + b, 0) / allTermAverages.length) * 100) / 100
      : null;

  const cumulative = gpaFor(years.flatMap((y) => y.gpaEntries));

  return {
    student: studentRef(student),
    school: schoolIdentity(),
    issued_at: DEMO_TODAY_ISO,
    years: years.map(({ gpaEntries: _drop, ...rest }) => rest),
    cumulative_average: cumulativeAverage,
    cumulative_gpa: cumulative.gpa,
    total_credits: cumulative.total_credits,
  };
}

export const reportsHandlers = [
  // ── Student picker source (self-contained for the Reports module) ────────────────
  http.get(`${API_BASE_URL}/reports/students`, ({ request }) => {
    const url = new URL(request.url);
    const page = listStudents({
      ...listParamsFrom(url),
      status: url.searchParams.get('status'),
    });
    return HttpResponse.json({ ...page, items: page.items.map(studentRef) });
  }),

  // ── Report card (self) ───────────────────────────────────────────────────────────
  // NOTE: /me must be registered before the query-based route so MSW matches it first.
  http.get(`${API_BASE_URL}/reports/report-card/me`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    const student = selfStudent();
    if (!student) return errorResponse(404, 'no_records', 'No report card is available.');
    const url = new URL(request.url);
    const semester =
      D.semesters.find((s) => s.id === url.searchParams.get('semester_id')) ?? getActiveSemester();
    if (!semester) return errorResponse(409, 'no_active_semester', 'No active term is configured.');
    return HttpResponse.json(buildReportCard(student, semester, true));
  }),

  // ── Report card (by student_id; P/S any, teacher own students) ───────────────────
  http.get(`${API_BASE_URL}/reports/report-card`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    const url = new URL(request.url);
    const studentId = url.searchParams.get('student_id');
    if (!studentId) return errorResponse(422, 'validation_error', 'student_id is required.');
    // A student caller may not read another student's card by id.
    if (role === 'student') {
      return errorResponse(403, 'forbidden', 'Use your own report card.');
    }
    const student = getStudent(studentId);
    if (!student) return errorResponse(404, 'student_not_found', 'Student not found.');
    const semester =
      D.semesters.find((s) => s.id === url.searchParams.get('semester_id')) ?? getActiveSemester();
    if (!semester) return errorResponse(409, 'no_active_semester', 'No active term is configured.');
    // Release filter only applies to student callers (P/S/teacher see computed values).
    return HttpResponse.json(buildReportCard(student, semester, false));
  }),

  // ── Transcript (multi-year; Principal / Secretary ONLY — D26) ────────────────────
  http.get(`${API_BASE_URL}/reports/transcript`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'The transcript is restricted to principals and secretaries.');
    }
    const url = new URL(request.url);
    const studentId = url.searchParams.get('student_id');
    if (!studentId) return errorResponse(422, 'validation_error', 'student_id is required.');
    const student = getStudent(studentId);
    if (!student) return errorResponse(404, 'student_not_found', 'Student not found.');
    return HttpResponse.json(buildTranscript(student));
  }),

  // ── Class grade summary (per offering) ───────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/class-grades`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    const url = new URL(request.url);
    const classSubjectId = url.searchParams.get('class_subject_id');
    if (!classSubjectId) return errorResponse(422, 'validation_error', 'class_subject_id is required.');
    const cs = D.class_subjects.find((c) => c.id === classSubjectId);
    if (!cs) return errorResponse(404, 'not_found', 'Class subject not found.');
    const subject = getSubject(cs.subject_id);
    // The roster of THIS class — read from enrollments now that a student has many.
    const students = rosterFor(cs.section_id);
    const rows = students
      .map((s) => {
        const term = computeTermGrade(s.id, cs.id);
        return {
          student: { id: s.id, full_name: s.full_name, student_number: s.student_number },
          numeric: term.numeric,
          letter: term.letter,
        };
      })
      .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name));
    const graded = rows.filter((r) => r.numeric != null);
    const classAverage =
      graded.length > 0
        ? Math.round((graded.reduce((sum, r) => sum + (r.numeric ?? 0), 0) / graded.length) * 100) / 100
        : null;
    const scale = D.grading_scales.find((g) => g.academic_year_id === getActiveYear()?.id);
    const distribution = (scale?.bands ?? []).map((b) => ({
      letter: b.letter,
      count: rows.filter((r) => r.letter === b.letter).length,
    }));
    return HttpResponse.json({
      class_subject: {
        id: cs.id,
        section_id: cs.section_id,
        section_name: getSection(cs.section_id)?.name ?? '',
        subject_name: subject?.name ?? '',
      },
      semester: getActiveSemester() ? semesterRef(getActiveSemester()!) : null,
      students: rows,
      class_average: classAverage,
      distribution,
    });
  }),

  // ── Attendance summary (per section) ─────────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/attendance`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    const url = new URL(request.url);
    const sectionId = url.searchParams.get('class_id') ?? url.searchParams.get('section_id');
    if (!sectionId) return errorResponse(422, 'validation_error', 'class_id is required.');
    const section = getSection(sectionId);
    if (!section) return errorResponse(404, 'not_found', 'Section not found.');
    const summary = attendanceSummaryForSection(sectionId);
    return HttpResponse.json({
      class: { id: section.id, name: section.name, grade_level: section.grade_level },
      semester: getActiveSemester() ? semesterRef(getActiveSemester()!) : null,
      summary,
    });
  }),

  // ── Enrollment / headcount report ────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/enrollment`, ({ cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (role !== 'principal' && role !== 'secretary') {
      return errorResponse(403, 'forbidden', 'Enrollment reports are restricted to principals and secretaries.');
    }
    const activeStudents = D.students.filter((s) => s.status === 'active');
    // D29: bucket by the student's OWN year group. Bucketing by their classes would count
    // one student once per class they take.
    const byGradeMap = new Map<string, number>();
    for (const s of activeStudents) {
      if (!s.year_group) continue;
      byGradeMap.set(s.year_group, (byGradeMap.get(s.year_group) ?? 0) + 1);
    }
    const byGrade = [...byGradeMap.entries()]
      .map(([grade_level, count]) => ({ grade_level, count }))
      .sort((a, b) => a.grade_level.localeCompare(b.grade_level));
    const byClass = D.sections.map((sec) => ({
      class_ref: { id: sec.id, name: sec.name, grade_level: sec.grade_level },
      enrolled: rosterFor(sec.id).length,
      capacity: sec.capacity,
    }));
    return HttpResponse.json({
      totals: { students: activeStudents.length, classes: D.sections.length },
      by_grade: byGrade,
      by_class: byClass,
    });
  }),
];

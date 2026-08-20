import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@shared/api/client';
import {
  DEMO_DATASET,
  DEMO_TODAY_ISO,
  attendanceSummaryForOffering,
  offeringsForStudent,
  rosterFor,
  computeTermGrade,
  getActiveSemester,
  getActiveYear,
  getCourse,
  getOffering,
  getSemester,
  getStudent,
  getTeacher,
  gpaFor,
  letterFor,
  listStudents,
  offeringLabel,
  offeringsForYear,
} from '@shared/api/mocks/demo/dataset';
import type {
  DemoAssessment,
  DemoOffering,
  DemoSemester,
  DemoStudent,
} from '@shared/api/mocks/demo/dataset';
import { errorResponse, listParamsFrom } from './_helpers';

/**
 * MSW handlers for the REPORTS module (api-spec §5 Module 10, incl. Transcript) — DEMO.
 *
 * Read-only aggregators backed by the shared demo dataset so every figure reconciles
 * with the gradebook, attendance and dashboard screens (all derive from the same
 * `computeTermGrade` / `attendanceSummaryForOffering` selectors). Export is browser
 * print of the rendered page (D27 / Q8) — there is no server-PDF endpoint.
 *
 * Endpoints:
 *  - GET /reports/students          — student picker source (self-contained; does not
 *                                     depend on the Students module's own handlers).
 *  - GET /reports/report-card       — assembled ReportCard for ?student_id (+?semester_id).
 *  - GET /reports/report-card/me    — the caller's own ReportCard (student role).
 *  - GET /reports/transcript        — multi-year Transcript for ?student_id. Teacher /
 *                                     student callers → 403 (D26 — P/S only).
 *  - GET /reports/offering-grades   — per-offering grade summary + distribution.
 *  - GET /reports/attendance        — per-offering attendance summary.
 *  - GET /reports/enrollment        — headcount / enrollment report.
 *
 * **D31** — `/reports/class-grades` became `/reports/offering-grades`, and the enrolment
 * report buckets by PROGRAMME rather than by Form. `classes.grade_level` (`Form 1`..`Form 4`)
 * was a homeroom column and a K-12 axis a junior college does not have; the same programme
 * query backs the Dean's dashboard tile, so the two screens cannot disagree.
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
 * pick the first active student that has a linked login (stu-1 = Freddy Lopez).
 */
function selfStudent(): DemoStudent | undefined {
  return D.students.find((s) => s.status === 'active' && s.user_id) ?? D.students[0];
}

// ── Response shape builders ───────────────────────────────────────────────────────

/**
 * The student as printed on a report card / transcript / picker row.
 *
 * D29 dropped `section_id` / `section_name` / `grade_level` — all three were read off the
 * student's homeroom, and a college student has no single class to head their card with.
 * `year_of_study` (their own level, D30's rename of `year_group`) replaces them.
 */
function studentRef(s: DemoStudent) {
  return {
    id: s.id,
    full_name: s.full_name,
    student_number: s.student_number,
    date_of_birth: s.date_of_birth,
    status: s.status,
    year_of_study: s.year_of_study,
  };
}

/** The shared `OfferingRef` — printed on the offering-grades and attendance reports. */
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

/** Lead lecturer's display name for an offering, if any. */
function leadTeacherName(offering: DemoOffering): string | null {
  const id = offering.lead_teacher_id ?? offering.teacher_ids[0] ?? null;
  return id ? (getTeacher(id)?.full_name ?? null) : null;
}

/** Is every graded assessment counted toward this offering's term grade released? */
function offeringFullyReleased(offering: DemoOffering): boolean {
  const graded = D.assessments.filter(
    (a: DemoAssessment) => a.offering_id === offering.id && a.status === 'graded',
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
  // One row per OFFERING the student sits, scoped to the card's own semester — a card is a
  // TERM record, and a year-wide list would print last term's courses on this term's card.
  const offerings = offeringsForStudent(student.id).filter(
    (o) => !o.is_archived && o.semester_id === semester.id,
  );

  const subjects = offerings
    .map((offering) => {
      const course = getCourse(offering.course_id);
      const term = computeTermGrade(student.id, offering.id);
      const released = offeringFullyReleased(offering);
      const pending = releaseFilter && !released;
      return {
        // The wire key stays `subject` (the server still spells the catalog entry that way
        // on report-card rows); it carries the COURSE.
        subject: { id: offering.course_id, name: course?.name ?? '', code: course?.code ?? '' },
        teacher: leadTeacherName(offering),
        credits: course?.credits ?? null,
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

  // The student's own attendance across every offering they sit, matching the backend
  // (which scopes by student + semester, never by one offering).
  const attRows = D.attendance_records.filter(
    (r) => r.student_id === student.id && r.semester_id === semester.id,
  );
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
    // The `section` block is gone (D29) — the card spans every offering the student sits,
    // so there is no one class to name. The header shows their level instead.
    year_of_study: student.year_of_study,
    semester: semesterRef(semester),
    school: schoolIdentity(),
    // Every demo student is registered on a real BAJC programme (§D12), so this prints.
    program_code: D.programs.find((pr) => pr.id === student.program_id)?.code ?? null,
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
  /**
   * EVERY offering the student ever sat, archived ones included — a transcript is the
   * historical record, so filtering on `is_archived` would erase every past year from it.
   * Grouped by the offering's OWN semester below.
   *
   * D31 is what makes this correct rather than approximate: the old version resolved one
   * flat list of "current" offerings and then only populated the ACTIVE semester with it,
   * because a year-scoped class row could not say which term it belonged to. A transcript
   * built that way showed real grades in one term and empty rows in every other.
   */
  const allOfferings = offeringsForStudent(student.id, null);
  const historic = new Map<string, DemoOffering[]>();
  for (const e of D.enrollments.filter((x) => x.student_id === student.id)) {
    const offering = getOffering(e.offering_id);
    if (!offering) continue;
    const list = historic.get(offering.semester_id) ?? [];
    if (!list.some((o) => o.id === offering.id)) list.push(offering);
    historic.set(offering.semester_id, list);
  }
  void allOfferings;

  const years = [...D.academic_years]
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((year) => {
      const semesters = D.semesters
        .filter((s) => s.academic_year_id === year.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((sem) => {
          // The offerings the student actually sat IN THIS TERM.
          const termOfferings = historic.get(sem.id) ?? [];
          const subjects = termOfferings
            .map((offering) => {
              const course = getCourse(offering.course_id);
              const term = computeTermGrade(student.id, offering.id);
              return {
                subject: {
                  id: offering.course_id,
                  name: course?.name ?? '',
                  code: course?.code ?? '',
                },
                teacher: leadTeacherName(offering),
                credits: course?.credits ?? null,
                numeric: term.numeric,
                letter: term.letter ?? '',
              };
            })
            .sort((a, b) => a.subject.name.localeCompare(b.subject.name));
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

  // ── Offering grade summary ───────────────────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/offering-grades`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    const url = new URL(request.url);
    const offeringId = url.searchParams.get('offering_id');
    if (!offeringId) return errorResponse(422, 'validation_error', 'offering_id is required.');
    const offering = getOffering(offeringId);
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    // The roster of THIS offering, in its own term.
    const students = rosterFor(offering.id);
    const rows = students
      .map((s) => {
        const term = computeTermGrade(s.id, offering.id);
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
    const reportSem = getSemester(offering.semester_id);
    return HttpResponse.json({
      // One shared ref replaces the flat `id` + `section_id` + `section_name` +
      // `subject_name` quartet — four fields describing what `offering.label` says once.
      offering: offeringRef(offering),
      // The OFFERING's term, not the school's active one: this report is read for archived
      // terms too, where "the active semester" would name the wrong period.
      semester: reportSem ? semesterRef(reportSem) : null,
      students: rows,
      class_average: classAverage,
      distribution,
    });
  }),

  // ── Attendance summary (per offering) ────────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/attendance`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    const url = new URL(request.url);
    const offeringId = url.searchParams.get('offering_id');
    if (!offeringId) return errorResponse(422, 'validation_error', 'offering_id is required.');
    const offering = getOffering(offeringId);
    if (!offering) return errorResponse(404, 'offering_not_found', 'Offering not found.');
    const summary = attendanceSummaryForOffering(offering.id);
    const sem = getSemester(offering.semester_id);
    return HttpResponse.json({
      offering: offeringRef(offering),
      // The OFFERING's term, not the school's active one.
      semester: sem ? semesterRef(sem) : null,
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
    /**
     * Bucketed by PROGRAMME (D31), not by Form.
     *
     * `classes.grade_level` was a homeroom column and a K-12 axis a junior college does not
     * have. Programme is the tertiary equivalent, and the SAME breakdown backs the Dean's
     * dashboard tile — so the report and the tile cannot disagree, which was the point of
     * moving both at once.
     *
     * Bucketing by the student rather than by their offerings is still load-bearing: by
     * offering, one student would be counted once per course they take.
     */
    const byProgrammeMap = new Map<string, number>();
    for (const s of activeStudents) {
      const programme = D.programs.find((pr) => pr.id === s.program_id)?.name;
      if (!programme) continue;
      byProgrammeMap.set(programme, (byProgrammeMap.get(programme) ?? 0) + 1);
    }
    const byProgramme = [...byProgrammeMap.entries()]
      .map(([programme, count]) => ({ programme, count }))
      .sort((a, b) => a.programme.localeCompare(b.programme));

    const liveOfferings = offeringsForYear(getActiveYear()?.id ?? '').filter(
      (o) => !o.is_archived,
    );
    const byOffering = liveOfferings.map((offering) => ({
      offering: offeringRef(offering),
      enrolled: rosterFor(offering.id).length,
      capacity: offering.capacity,
    }));
    return HttpResponse.json({
      totals: { students: activeStudents.length, offerings: liveOfferings.length },
      by_programme: byProgramme,
      by_offering: byOffering,
    });
  }),
];

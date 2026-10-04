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
  // D45 Phase 9 — the institutional reports.
  compareOfferings,
  demoHodProgramIds,
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
  return D.students.find((s) => s.status === 'Active' && s.user_id) ?? D.students[0];
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
    // Widened deliberately: `freezeMidtermFor` re-labels the same payload as 'midterm',
    // so pinning this to a literal would make the frozen copy untypeable.
    report_kind: 'endterm' as 'midterm' | 'endterm',
    frozen_at: null as string | null,
  };
}

/**
 * D32 (brief §5) — the demo's `report_card_snapshots`, keyed `studentId|semesterId`.
 *
 * **In-memory and per-session, on purpose.** A frozen card only means something if it
 * STOPS MOVING, so the demo has to actually store one rather than recompute and relabel.
 * A module-level Map is the demo's equivalent of the table; the dataset is a single
 * browser session by design (see `demo/selectors.ts`), so this is consistent with how
 * every other demo mutation works.
 */
const midtermSnapshots = new Map<string, { payload: ReturnType<typeof buildReportCard>; frozen_at: string }>();

function midtermKey(studentId: string, semesterId: string): string {
  return `${studentId}|${semesterId}`;
}

/**
 * Capture one student's mid-term card, mirroring `reports/freeze.freeze_midterm`.
 * Idempotent — a re-freeze refreshes in place, which is what lets a Dean re-freeze after
 * correcting a mark.
 */
function freezeMidtermFor(student: DemoStudent, semester: DemoSemester): void {
  const payload = buildReportCard(student, semester, false);
  midtermSnapshots.set(midtermKey(student.id, semester.id), {
    payload: { ...payload, is_frozen: true, report_kind: 'midterm' as const },
    frozen_at: DEMO_TODAY_ISO,
  });
}

/**
 * The mid-term branch of both report-card handlers, mirroring
 * `reports/service._midterm_report_card` — including the LAZY FREEZE, because the
 * behaviour a demo needs to show is "the number stops moving", and that only happens if
 * the first read captures.
 *
 * Returns an MSW response on every path: the error cases (`409 midterm_window_open`,
 * `422 no_midterm_window`) are states the screen explains, not failures to swallow.
 */
function midtermReportResponse(student: DemoStudent, semester: DemoSemester) {
  const start = semester.midterm_submission_start;
  const end = semester.midterm_submission_end;
  if (!start || !end) {
    return errorResponse(
      422,
      'no_midterm_window',
      'This session has no mid-session grading period configured, so there are no mid-session grades to freeze.',
    );
  }
  // DEMO_TODAY, not the real clock — same reason as `gradeWindow()` in the grades handler.
  if (new Date(DEMO_TODAY_ISO).getTime() <= new Date(end).getTime()) {
    return errorResponse(
      409,
      'midterm_window_open',
      'The mid-session grading period is still open. Mid-session grades can be frozen once it closes.',
    );
  }
  const key = midtermKey(student.id, semester.id);
  if (!midtermSnapshots.has(key)) freezeMidtermFor(student, semester);
  const snap = midtermSnapshots.get(key)!;
  return HttpResponse.json({ ...snap.payload, frozen_at: snap.frozen_at });
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
              // D35 — how the student sat it. `AU` / `W/P` / `W/F` is printed INSTEAD of a
              // grade, which is the whole reason the client wants the status recorded: the
              // graded-only filter below would otherwise drop the course entirely, and a
              // permanent record that omits a withdrawal is not a transcript.
              const enr = D.enrollments.find(
                (e) =>
                  e.student_id === student.id &&
                  e.offering_id === offering.id &&
                  !e.unenrolled_at,
              );
              const notation = enr ? NOTATION[enr.enrollment_status] : null;
              return {
                subject: {
                  id: offering.course_id,
                  name: course?.name ?? '',
                  code: course?.code ?? '',
                },
                teacher: leadTeacherName(offering),
                credits: course?.credits ?? null,
                numeric: notation ? null : term.numeric,
                letter: notation ? '' : (term.letter ?? ''),
                notation,
              };
            })
            .sort((a, b) => a.subject.name.localeCompare(b.subject.name));
          // The GPA is built from ALL enrolled rows and the LISTING is filtered after,
          // matching the backend: a transcript prints graded lines only, but the GPA
          // denominator is every enrolled credit (decision #4). Filtering first would
          // print a graded-only mean.
          //
          // Two DIFFERENT exclusions, mirroring `reports/service.get_transcript`:
          //
          //   * `AU` / `W/P` leave the fraction ENTIRELY — filtered out of the list.
          //   * `W/F` COUNTS AS A FAIL (BAJC, 2026-08-23), so it stays in with `letter: ''`
          //     — credits in the denominator, zero quality points.
          //
          // Excluding all three, as the first cut did, silently forgave a W/F.
          const counted = subjects.filter((r) => !r.notation || r.notation === 'W/F');
          const termGpa = gpaFor(counted.map((r) => ({ credits: r.credits, letter: r.letter })));
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
            gpaEntries: counted.map((r) => ({ credits: r.credits, letter: r.letter })),
            // Graded lines PLUS the notated ones — the notation is the information.
            subjects: subjects.filter((r) => r.numeric != null || r.notation),
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

  const transcriptProgram = D.programs.find((pr) => pr.id === student.program_id);

  return {
    student: studentRef(student),
    school: schoolIdentity(),
    // D39 (Meeting #2 item 7) — mirrors `reports/service._program_code_for` /
    // `_program_name_for`; null for a student with no programme registration.
    program_code: transcriptProgram?.code ?? null,
    program_name: transcriptProgram?.name ?? null,
    issued_at: DEMO_TODAY_ISO,
    years: years.map(({ gpaEntries: _drop, ...rest }) => rest),
    cumulative_average: cumulativeAverage,
    cumulative_gpa: cumulative.gpa,
    total_credits: cumulative.total_credits,
  };
}

/** `coursestatus` -> what the transcript prints instead of a grade (D35). */
const NOTATION: Record<string, string | null> = {
  enrolled: null,
  audit: 'AU',
  withdraw_passing: 'W/P',
  withdraw_failing: 'W/F',
};

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
    if (!semester) return errorResponse(409, 'no_active_semester', 'No active session is configured.');
    // D32 — a frozen card carries NO release filter: it is a document already issued, and
    // re-applying "hide unreleased" would blank rows the student has already been shown.
    if (url.searchParams.get('kind') === 'midterm') {
      return midtermReportResponse(student, semester);
    }
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
    if (!semester) return errorResponse(409, 'no_active_semester', 'No active session is configured.');
    if (url.searchParams.get('kind') === 'midterm') {
      return midtermReportResponse(student, semester);
    }
    // Release filter only applies to student callers (P/S/teacher see computed values).
    return HttpResponse.json(buildReportCard(student, semester, false));
  }),

  /*
   * D32 (brief §6) — the Dean's explicit mid-term freeze.
   *
   * Lives in THIS file rather than in `settings.ts`, even though the path is under
   * `/settings`, because the snapshot store and `buildReportCard` are here. Same
   * reasoning as the server, where `reports/freeze.py` owns the computation and
   * `settings/service` just calls it: a snapshot IS a report card, and putting the
   * shaping logic anywhere else would guarantee the two drift.
   */
  http.post(`${API_BASE_URL}/settings/semesters/:semesterId/midterm-freeze`, ({ params, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (role !== 'principal') {
      return errorResponse(403, 'forbidden', 'Only the Dean may freeze mid-session grades.');
    }
    const semester = D.semesters.find((sem) => sem.id === String(params.semesterId));
    if (!semester) return errorResponse(404, 'not_found', 'Semester not found.');

    const start = semester.midterm_submission_start;
    const end = semester.midterm_submission_end;
    if (!start || !end) {
      return errorResponse(
        422,
        'no_midterm_window',
        'This session has no mid-session grading period configured, so there are no mid-session grades to freeze.',
      );
    }
    if (new Date(DEMO_TODAY_ISO).getTime() <= new Date(end).getTime()) {
      return errorResponse(
        409,
        'midterm_window_open',
        'The mid-session grading period is still open. Mid-session grades can be frozen once it closes.',
      );
    }

    // Every student with a live enrolment in the term, collected as a SET: a student
    // sits several offerings and their card spans all of them, so freezing per
    // enrolment would capture the same card repeatedly.
    const semesterOfferings = new Set(
      D.offerings.filter((o) => o.semester_id === semester.id).map((o) => o.id),
    );
    const studentIds = new Set(
      D.enrollments
        .filter((e) => semesterOfferings.has(e.offering_id) && !e.unenrolled_at)
        .map((e) => e.student_id),
    );
    let written = 0;
    for (const id of studentIds) {
      const student = getStudent(id);
      if (!student) continue;
      freezeMidtermFor(student, semester);
      written += 1;
    }
    return HttpResponse.json({
      snapshots_written: written,
      semester_id: semester.id,
      frozen_at: DEMO_TODAY_ISO,
    });
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
    const activeStudents = D.students.filter((s) => s.status === 'Active');
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

// ══════════════════════════════════════════════════════════════════════════════
// D45 Phase 9 — the four institutional reports of §53
//
// ⚠️ Module agents: these mirror `backend/app/modules/reports/institutional.py`. The
// DEFINITIONS are the feature, so they are reproduced here rather than approximated —
// the last two times a rule lived in only one of the two implementations, demo mode
// certified a screen the real backend did not serve.
//
// Reproduced exactly:
//   * "registered" is `unenrolled_at == null`, the same predicate `rosterFor` uses and
//     the same one behind the registration screen's over-capacity warning;
//   * "new" is measured from REGISTRATIONS, never from `enrollment_date`;
//   * exactly `FULL_TIME_CREDITS` is NOT a credit-load mismatch, in either direction;
//   * late counts as present, and the attendance floor is compared STRICTLY BELOW;
//   * an HOD is narrowed to the programmes they head, and `scope` says so.
//
// Registered separately in `handlers/index.ts` rather than spread into
// `reportsHandlers` above: a `const` declared below cannot be spread into an array
// built above it, and hoisting 300 lines of helpers over the report-card handlers to
// work around that would have buried the module everyone actually reads.
// ══════════════════════════════════════════════════════════════════════════════

/** BAJC's own application-form rule. See `institutional.FULL_TIME_CREDITS`. */
const FULL_TIME_CREDITS = 15;
const UNASSIGNED = 'Not assigned';

/** The roles the server's `_institutional` gate admits. */
const INSTITUTIONAL_ROLES = ['principal', 'secretary', 'auditor', 'hod'];

/** `null` = the whole college; a list = an HOD's own programmes (possibly empty). */
function institutionalScope(role: string) {
  if (role !== 'hod') return { programIds: null as string[] | null, scope: { is_scoped: false, programmes: [] as string[] } };
  const programIds = demoHodProgramIds(role);
  const programmes = D.programs
    .filter((p) => programIds.includes(p.id))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  return { programIds, scope: { is_scoped: true, programmes } };
}

function scopedStudents(programIds: string[] | null): DemoStudent[] {
  const live = D.students;
  if (programIds === null) return live;
  return live.filter((s) => s.program_id !== null && programIds.includes(s.program_id));
}

function programmeNameOf(student: DemoStudent): string {
  return D.programs.find((p) => p.id === student.program_id)?.name ?? UNASSIGNED;
}

/** Late counts as present, one decimal — the same tally every attendance screen uses. */
function tally(statuses: string[]) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const s of statuses) {
    if (s === 'present') counts.present += 1;
    else if (s === 'absent') counts.absent += 1;
    else if (s === 'late') counts.late += 1;
    else if (s === 'excused') counts.excused += 1;
  }
  const total = statuses.length;
  const pct = total === 0 ? 0 : Math.round(((counts.present + counts.late) / total) * 1000) / 10;
  return { ...counts, records: total, pct_present: pct };
}

function liveRegistrations() {
  return D.enrollments.filter((e) => !e.unenrolled_at);
}

/**
 * The attendance floor. Mirrors `attendance/service.ATTENDANCE_ALERT_THRESHOLD` and the
 * frontend's own `features/attendance/types.ATTENDANCE_ALERT_THRESHOLD`. Spelled here
 * rather than imported so the mock layer does not reach up into a feature module; the
 * response echoes it back as `floor_pct`, exactly as the server does, so the screen
 * still renders the number it was given rather than a third copy.
 */
const ATTENDANCE_ALERT_THRESHOLD = 80;

export const institutionalReportHandlers = [
  // ── New versus returning (§53 Enrollment) ───────────────────────────────────
  http.get(`${API_BASE_URL}/reports/new-vs-returning`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (!INSTITUTIONAL_ROLES.includes(role)) {
      return errorResponse(403, 'forbidden', 'Institutional reports are restricted to the Dean, the Registrar, Heads of Department and the Auditor.');
    }
    const { programIds, scope } = institutionalScope(role);
    const url = new URL(request.url);
    const yearId = url.searchParams.get('academic_year_id');
    const year = yearId
      ? D.academic_years.find((y) => y.id === yearId)
      : getActiveYear();
    if (yearId && !year) {
      return errorResponse(404, 'academic_year_not_found', 'Academic year not found.');
    }
    if (!year) return errorResponse(404, 'no_active_year', 'No active academic year.');

    const students = new Map(scopedStudents(programIds).map((s) => [s.id, s]));

    // First-ever year and first-ever session per student, from registrations only.
    const firstYear = new Map<string, { key: string; id: string; name: string }>();
    const firstSemester = new Map<string, { key: string; id: string }>();
    const inYear = new Set<string>();
    const inSemester = new Map<string, Set<string>>();

    for (const e of liveRegistrations()) {
      if (!students.has(e.student_id)) continue;
      const sem = getSemester(e.semester_id);
      if (!sem) continue;
      const yr = D.academic_years.find((y) => y.id === sem.academic_year_id);
      if (!yr) continue;
      const yearKey = `${yr.start_date}|${yr.name}`;
      const semKey = `${yr.start_date}|${String(sem.sequence).padStart(4, '0')}`;
      const heldYear = firstYear.get(e.student_id);
      if (!heldYear || yearKey < heldYear.key) {
        firstYear.set(e.student_id, { key: yearKey, id: yr.id, name: yr.name });
      }
      const heldSem = firstSemester.get(e.student_id);
      if (!heldSem || semKey < heldSem.key) {
        firstSemester.set(e.student_id, { key: semKey, id: sem.id });
      }
      if (yr.id === year.id) {
        inYear.add(e.student_id);
        const bucket = inSemester.get(sem.id) ?? new Set<string>();
        bucket.add(e.student_id);
        inSemester.set(sem.id, bucket);
      }
    }

    const byProgramme = new Map<string, { new: number; returning: number }>();
    const studentRows = [...inYear].map((id) => {
      const student = students.get(id)!;
      const first = firstYear.get(id)!;
      const isNew = first.id === year.id;
      const programme = programmeNameOf(student);
      const bucket = byProgramme.get(programme) ?? { new: 0, returning: 0 };
      if (isNew) bucket.new += 1;
      else bucket.returning += 1;
      byProgramme.set(programme, bucket);
      return {
        student: studentRef(student),
        programme,
        is_new: isNew,
        first_registered_year: first.name,
      };
    });
    studentRows.sort((a, b) =>
      a.is_new === b.is_new
        ? a.student.full_name.localeCompare(b.student.full_name)
        : a.is_new
          ? -1
          : 1,
    );
    const newCount = studentRows.filter((r) => r.is_new).length;

    const bySemester = D.semesters
      .filter((s) => s.academic_year_id === year.id)
      .sort((a, b) => a.sequence - b.sequence)
      .map((sem) => {
        const members = [...(inSemester.get(sem.id) ?? [])];
        const firstHere = members.filter((id) => firstSemester.get(id)?.id === sem.id).length;
        return {
          semester: semesterRef(sem),
          new: firstHere,
          returning: members.length - firstHere,
          total: members.length,
        };
      });

    return HttpResponse.json({
      academic_year: { id: year.id, name: year.name, status: year.status },
      generated_at: DEMO_TODAY_ISO,
      new: newCount,
      returning: studentRows.length - newCount,
      total: studentRows.length,
      by_programme: [...byProgramme.entries()]
        .map(([programme, counts]) => ({
          programme,
          programme_code: D.programs.find((p) => p.name === programme)?.code ?? null,
          new: counts.new,
          returning: counts.returning,
          total: counts.new + counts.returning,
        }))
        .sort((a, b) => b.total - a.total || a.programme.localeCompare(b.programme)),
      by_semester: bySemester,
      students: studentRows,
      scope,
      note: 'A student is NEW if this is the first academic year they have ever held a registration in, and RETURNING otherwise — measured from registrations, not from the admission date on the student record. The per-session figures answer a narrower question: how many of that session’s students had never registered in any session before it.',
    });
  }),

  // ── Over capacity (§53 Registration) ────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/overcapacity`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (!INSTITUTIONAL_ROLES.includes(role)) {
      return errorResponse(403, 'forbidden', 'Institutional reports are restricted to the Dean, the Registrar, Heads of Department and the Auditor.');
    }
    const { programIds, scope } = institutionalScope(role);
    const url = new URL(request.url);
    const semesterId = url.searchParams.get('semester_id');
    const semester = semesterId ? getSemester(semesterId) : getActiveSemester();
    if (semesterId && !semester) {
      return errorResponse(404, 'semester_not_found', 'Semester not found.');
    }
    if (!semester) return errorResponse(404, 'no_active_semester', 'No active semester.');

    const allowedCourseIds =
      programIds === null
        ? null
        : new Set(
            D.program_courses
              .filter((pc) => programIds.includes(pc.program_id))
              .map((pc) => pc.course_id),
          );

    const offerings = D.offerings.filter(
      (o) =>
        o.semester_id === semester.id &&
        !o.is_archived &&
        (allowedCourseIds === null || allowedCourseIds.has(o.course_id)),
    );

    const over: unknown[] = [];
    const at: unknown[] = [];
    const unset: unknown[] = [];
    let under = 0;
    let seats = 0;
    let registered = 0;

    for (const offering of offerings.sort(compareOfferings)) {
      const count = rosterFor(offering.id).length;
      registered += count;
      const capacity = offering.capacity;
      const lead = offering.lead_teacher_id ? getTeacher(offering.lead_teacher_id) : null;
      const row = {
        offering: offeringRef(offering),
        lecturer: lead?.full_name ?? null,
        capacity,
        registered: count,
        over_by: 0,
        utilisation_pct: capacity ? Math.round((count / capacity) * 1000) / 10 : null,
        band: 'unset' as 'over' | 'at' | 'unset',
      };
      if (!capacity) {
        unset.push(row);
        continue;
      }
      seats += capacity;
      if (count > capacity) {
        row.band = 'over';
        row.over_by = count - capacity;
        over.push(row);
      } else if (count === capacity) {
        row.band = 'at';
        at.push(row);
      } else {
        under += 1;
      }
    }

    return HttpResponse.json({
      semester: semesterRef(semester),
      generated_at: DEMO_TODAY_ISO,
      over,
      at_capacity: at,
      no_capacity_set: unset,
      under_capacity: under,
      offerings_total: offerings.length,
      seats_total: seats,
      registered_total: registered,
      scope,
      note: 'Registered means a live registration row — the same count the Registrar sees as an over-capacity warning while seating a student. Capacity is a warning in this system, not a limit: a registration is never refused for it. Classes with no capacity recorded cannot appear as over capacity, which is why they are listed separately rather than left out.',
    });
  }),

  // ── Credit load (§53 Registration) ──────────────────────────────────────────
  http.get(`${API_BASE_URL}/reports/credit-load`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (!INSTITUTIONAL_ROLES.includes(role)) {
      return errorResponse(403, 'forbidden', 'Institutional reports are restricted to the Dean, the Registrar, Heads of Department and the Auditor.');
    }
    const { programIds, scope } = institutionalScope(role);
    const url = new URL(request.url);
    const semesterId = url.searchParams.get('semester_id');
    const semester = semesterId ? getSemester(semesterId) : getActiveSemester();
    if (semesterId && !semester) {
      return errorResponse(404, 'semester_not_found', 'Semester not found.');
    }
    if (!semester) return errorResponse(404, 'no_active_semester', 'No active semester.');

    const students = new Map(scopedStudents(programIds).map((s) => [s.id, s]));
    const perStudent = new Map<string, { courses: number; credits: number; audited: number }>();
    for (const e of liveRegistrations()) {
      if (e.semester_id !== semester.id || !students.has(e.student_id)) continue;
      const offering = getOffering(e.offering_id);
      const credits = offering ? (getCourse(offering.course_id)?.credits ?? 0) : 0;
      const held = perStudent.get(e.student_id) ?? { courses: 0, credits: 0, audited: 0 };
      held.courses += 1;
      held.credits += credits;
      if (e.enrollment_status === 'audit') held.audited += credits;
      perStudent.set(e.student_id, held);
    }

    const rows = [...perStudent.entries()].map(([id, held]) => {
      const student = students.get(id)!;
      const declared = student.enrollment_load;
      let mismatch: string | null = null;
      // Exactly FULL_TIME_CREDITS is deliberately not flagged: the form says "under 15"
      // and "over 15" and therefore says nothing about 15 itself.
      if (declared === 'Full Time' && held.credits < FULL_TIME_CREDITS) {
        mismatch = `Declared Full Time but carrying ${held.credits} credits, under the ${FULL_TIME_CREDITS}-credit full-time load.`;
      } else if (declared === 'Part Time' && held.credits > FULL_TIME_CREDITS) {
        mismatch = `Declared Part Time but carrying ${held.credits} credits, over the ${FULL_TIME_CREDITS}-credit part-time ceiling.`;
      }
      return {
        student: studentRef(student),
        programme: programmeNameOf(student),
        declared_load: declared,
        courses: held.courses,
        credits: held.credits,
        audit_credits: held.audited,
        mismatch,
      };
    });
    rows.sort((a, b) => b.credits - a.credits || a.student.full_name.localeCompare(b.student.full_name));

    const totals = rows.map((r) => r.credits);
    const byDeclared = new Map<string, number[]>();
    const mismatchesByDeclared = new Map<string, number>();
    for (const row of rows) {
      const label = row.declared_load ?? 'Not declared';
      byDeclared.set(label, [...(byDeclared.get(label) ?? []), row.credits]);
      if (row.mismatch) mismatchesByDeclared.set(label, (mismatchesByDeclared.get(label) ?? 0) + 1);
    }
    const distribution = new Map<number, number>();
    for (const value of totals) distribution.set(value, (distribution.get(value) ?? 0) + 1);
    const mean = (values: number[]) =>
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

    return HttpResponse.json({
      semester: semesterRef(semester),
      generated_at: DEMO_TODAY_ISO,
      students: rows.length,
      credits_total: totals.reduce((a, b) => a + b, 0),
      min_credits: totals.length ? Math.min(...totals) : 0,
      max_credits: totals.length ? Math.max(...totals) : 0,
      avg_credits: totals.length ? mean(totals) : 0,
      full_time_credits: FULL_TIME_CREDITS,
      mismatches: rows.filter((r) => r.mismatch).length,
      by_declared_load: [...byDeclared.entries()]
        .map(([declared_load, values]) => ({
          declared_load,
          students: values.length,
          min_credits: Math.min(...values),
          max_credits: Math.max(...values),
          avg_credits: mean(values),
          mismatches: mismatchesByDeclared.get(declared_load) ?? 0,
        }))
        .sort((a, b) => b.students - a.students || a.declared_load.localeCompare(b.declared_load)),
      distribution: [...distribution.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([credits, count]) => ({ credits, students: count })),
      rows,
      scope,
      note: `Credits are this session’s live registrations, valued from the course catalog. The declared load is what the student stated at admission and is not recalculated; a row is flagged only where the two contradict BAJC’s own application-form rule (Part Time under ${FULL_TIME_CREDITS} credits, Full Time over ${FULL_TIME_CREDITS}). Exactly ${FULL_TIME_CREDITS} credits is not flagged either way, because the form does not say which side it falls on. Audited courses are included in the load and shown separately; they earn no credit.`,
    });
  }),

  // ── Attendance by programme (§53 Attendance — C4) ───────────────────────────
  http.get(`${API_BASE_URL}/reports/programme-attendance`, ({ request, cookies }) => {
    const role = sessionRole(cookies);
    if (!role) return errorResponse(401, 'unauthenticated', 'Not signed in.');
    if (!INSTITUTIONAL_ROLES.includes(role)) {
      return errorResponse(403, 'forbidden', 'Institutional reports are restricted to the Dean, the Registrar, Heads of Department and the Auditor.');
    }
    const { programIds, scope } = institutionalScope(role);
    const url = new URL(request.url);
    const semesterId = url.searchParams.get('semester_id');
    const programId = url.searchParams.get('program_id');
    const semester = semesterId ? getSemester(semesterId) : getActiveSemester();
    if (semesterId && !semester) {
      return errorResponse(404, 'semester_not_found', 'Semester not found.');
    }
    if (!semester) return errorResponse(404, 'no_active_semester', 'No active semester.');
    if (programId && programIds !== null && !programIds.includes(programId)) {
      return errorResponse(403, 'forbidden', 'You do not head that programme.');
    }

    const floor = ATTENDANCE_ALERT_THRESHOLD;
    const students = new Map(scopedStudents(programIds).map((s) => [s.id, s]));
    const perStudent = new Map<string, string[]>();
    for (const record of D.attendance_records) {
      if (record.semester_id !== semester.id || !students.has(record.student_id)) continue;
      perStudent.set(record.student_id, [...(perStudent.get(record.student_id) ?? []), record.status]);
    }

    const grouped = new Map<string, string[]>();
    for (const id of perStudent.keys()) {
      const programme = programmeNameOf(students.get(id)!);
      grouped.set(programme, [...(grouped.get(programme) ?? []), id]);
    }

    const everyStatus: string[] = [];
    const byProgramme = [...grouped.entries()].map(([programme, memberIds]) => {
      const statuses = memberIds.flatMap((id) => perStudent.get(id) ?? []);
      everyStatus.push(...statuses);
      const counts = tally(statuses);
      const programmeRow = D.programs.find((p) => p.name === programme);
      return {
        programme,
        programme_code: programmeRow?.code ?? null,
        programme_id: programmeRow?.id ?? null,
        students: memberIds.length,
        records: counts.records,
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        excused: counts.excused,
        pct_present: counts.pct_present,
        // Strictly below, and never for a programme with no registers taken.
        below_floor: counts.records > 0 && counts.pct_present < floor,
        students_below_floor: memberIds.filter((id) => {
          const own = tally(perStudent.get(id) ?? []);
          return own.records > 0 && own.pct_present < floor;
        }).length,
      };
    });
    byProgramme.sort((a, b) => a.pct_present - b.pct_present || a.programme.localeCompare(b.programme));

    let focus = null;
    let studentRows: unknown[] = [];
    if (programId) {
      const programme = D.programs.find((p) => p.id === programId);
      if (!programme) return errorResponse(404, 'program_not_found', 'Programme not found.');
      focus =
        byProgramme.find((r) => r.programme_id === programId) ?? {
          programme: programme.name,
          programme_code: programme.code,
          programme_id: programme.id,
          students: 0,
          records: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          pct_present: 0,
          below_floor: false,
          students_below_floor: 0,
        };
      studentRows = (grouped.get(programme.name) ?? [])
        .map((id) => {
          const counts = tally(perStudent.get(id) ?? []);
          return {
            student: studentRef(students.get(id)!),
            records: counts.records,
            present: counts.present,
            absent: counts.absent,
            late: counts.late,
            excused: counts.excused,
            pct_present: counts.pct_present,
            below_floor: counts.pct_present < floor,
          };
        })
        .sort((a, b) => a.pct_present - b.pct_present || a.student.full_name.localeCompare(b.student.full_name));
    }

    const overall = tally(everyStatus);
    return HttpResponse.json({
      semester: semesterRef(semester),
      generated_at: DEMO_TODAY_ISO,
      floor_pct: floor,
      by_programme: byProgramme,
      programme: focus,
      students: studentRows,
      records_total: overall.records,
      pct_present: overall.pct_present,
      scope,
      note: `Grouped by the student’s programme, not by the course — a student’s absence belongs to the programme that will be asked about it. Late counts as present, as it does on every other attendance screen. The percentage divides by the registers ACTUALLY TAKEN, not by sessions scheduled, so a programme with few records has a fragile figure. Flagged below ${floor}%, the college’s configured attendance floor; a programme with no registers taken is never flagged.`,
    });
  }),
];

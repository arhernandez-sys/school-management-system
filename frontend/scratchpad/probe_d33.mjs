/**
 * D33 — EXECUTE the new behaviour through the real MSW handlers.
 *
 * `tsc` has hidden real defects in this repo before (docs/progress-tracker.md), and every
 * claim below is one a green typecheck says nothing about:
 *
 *   1. the students directory's `Last, First` display and the filter counter;
 *   2. `GET /students/{id}` actually CARRYING the admission fields, not just declaring them;
 *   3. `POST /students` round-tripping the whole form, and opening a programme history row;
 *   4. `PATCH /students/{id}` partial semantics — clearing a value, un-ticking a boolean;
 *   5. the MID-TERM FREEZE: entry refused inside the window, open before and after it, and
 *      the gradebook reporting it in advance.
 *
 * Run: `node scratchpad/probe_d33.mjs`
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.d33-probe-${process.pid}.cjs`);

await build({
  stdin: {
    contents: `
      export { studentsHandlers } from '@shared/api/mocks/handlers/students';
      export { gradesHandlers } from '@shared/api/mocks/handlers/grades';
      export { offeringsHandlers } from '@shared/api/mocks/handlers/offerings';
      export { reportsHandlers } from '@shared/api/mocks/handlers/reports';
      export { DEMO_DATASET } from '@shared/api/mocks/demo/dataset';
      export { surnameFirst } from '@shared/utils/names';
      export {
        activeStudentFilterCount,
        EMPTY_STUDENT_FILTERS,
      } from '@features/students/components/studentFilters';
    `,
    resolveDir: FE,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
  external: ['msw', 'msw/node'],
  alias: {
    '@shared': path.join(FE, 'src/shared'),
    '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'),
    '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://sis.test/api/v1"' },
});

const require = createRequire(import.meta.url);
const M = require(out);
const { setupServer } = require('msw/node');

const API = 'http://sis.test/api/v1';
const D = M.DEMO_DATASET;

// The handlers read the caller's role off the `sis_mock_session` cookie (`sessionRole`),
// and DEFAULT TO 'principal' when it is absent. Getting the name wrong therefore does not
// fail loudly — it silently runs every request as the Dean, who is exempt from both grade
// windows, so the freeze assertions below would all pass against no enforcement at all.
const SESSION_COOKIE = 'sis_mock_session';
const AS = (role) => ({ headers: { cookie: `${SESSION_COOKIE}=${role}` } });

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const server = setupServer(
  ...M.studentsHandlers,
  ...M.gradesHandlers,
  ...M.offeringsHandlers,
  ...M.reportsHandlers,
);
server.listen({ onUnhandledRequest: 'bypass' });

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 1 · ask 5: the register reads `Last, First` ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = D.students[0];
  ok(
    M.surnameFirst(s) === `${s.last_name}, ${s.first_name}`,
    'surnameFirst puts the surname first',
    M.surnameFirst(s),
  );
  // The legacy single-token rows `005_tertiary.sql` §9 parked in `lastname`: a bare comma
  // with nothing after it would be worse than the plain surname.
  ok(
    M.surnameFirst({ last_name: 'Mekonnen', first_name: null, full_name: 'Mekonnen' }) ===
      'Mekonnen',
    'a surname-only record does NOT gain a dangling comma',
  );
  ok(
    M.surnameFirst({ last_name: null, first_name: null, full_name: 'Unknown Person' }) ===
      'Unknown Person',
    'falls back to full_name when there is no surname',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 2 · ask 1: the filter counter behind the Filters button ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const activeYearId = D.academic_years.find((y) => y.status === 'active')?.id;
  ok(
    M.activeStudentFilterCount({ ...M.EMPTY_STUDENT_FILTERS, yearId: activeYearId }, { activeYearId }) === 0,
    'an unfiltered directory badges ZERO',
    'the default year must not count as a filter',
  );
  ok(
    M.activeStudentFilterCount(
      { ...M.EMPTY_STUDENT_FILTERS, yearId: activeYearId, gender: 'female', programId: 'prog-b' },
      { activeYearId },
    ) === 2,
    'two filters badge 2',
  );
  const other = D.academic_years.find((y) => y.id !== activeYearId)?.id;
  ok(
    M.activeStudentFilterCount({ ...M.EMPTY_STUDENT_FILTERS, yearId: other }, { activeYearId }) === 1,
    'moving OFF the active year does count',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 3 · ask 4: GET /students/{id} carries the whole record ===');
// ═══════════════════════════════════════════════════════════════════════════
const ADMISSION_FIELDS = [
  'ssno', 'civil_status', 'religion', 'street', 'city_town_village', 'district',
  'mother_name', 'father_name', 'nok_name', 'nok_relationship', 'nok_phone',
  'has_health_condition', 'health_condition_note', 'atlib_exam', 'num_csec',
  'finance_name', 'finance_phone', 'finance_email', 'enrollment_load',
];
{
  const seed = D.students[0];
  const detail = await (await fetch(`${API}/students/${seed.id}`, AS('secretary'))).json();
  const missing = ADMISSION_FIELDS.filter((f) => !(f in detail));
  ok(missing.length === 0, 'every admission field is on the detail payload', `missing: ${missing.join(', ') || 'none'}`);
  ok('program' in detail && 'email' in detail, 'programme ref and login email are present');
  // The one the client named specifically: the Religion filter selects on it, so the
  // profile has to show it.
  ok(detail.religion === seed.religion, 'religion round-trips to the profile', String(detail.religion));
  ok(detail.district === seed.district, 'district round-trips', String(detail.district));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 4 · ask 3: POST /students writes the whole application form ===');
// ═══════════════════════════════════════════════════════════════════════════
const FORM = {
  first_name: 'Ana', last_name: 'Perez', date_of_birth: '2008-04-11',
  enrollment_date: '2026-01-12',
  ssno: '123456789', civil_status: 'Single', religion: 'Anglican',
  street: '14 Mahogany Street', city_town_village: 'Belmopan', district: 'Cayo',
  mother_name: 'Rosa Perez', father_name: 'Luis Perez',
  nok_name: 'Marta Perez', nok_relationship: 'Aunt', nok_phone: '+501-6001111',
  has_health_condition: true, health_condition_note: 'Asthma.',
  atlib_exam: true, num_csec: 7,
  finance_name: 'Rosa Perez', finance_phone: '+501-6002222',
  finance_email: 'rosa.perez@example.bz',
  enrollment_load: 'Full Time',
};
let createdId;
{
  const programId = D.programs[0].id;
  const resp = await fetch(`${API}/students`, {
    method: 'POST',
    headers: { ...AS('secretary').headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ...FORM, program_id: programId }),
  });
  const body = await resp.json();
  ok(resp.status === 201, 'the create succeeds', `status=${resp.status}`);
  createdId = body.id;

  const wrong = Object.entries(FORM)
    .filter(([k]) => k in body)
    .filter(([k, v]) => body[k] !== v)
    .map(([k]) => k);
  ok(wrong.length === 0, 'every submitted field comes back unchanged', `wrong: ${wrong.join(', ') || 'none'}`);
  ok(body.program?.id === programId, 'the programme is assigned at registration');

  // The Academic-history panel reads the HISTORY, not the column. Setting one without the
  // other shows a student on no programme at all — invisible to any type check.
  const history = D.student_program_history.filter((h) => h.student_id === createdId);
  ok(history.length === 1, 'a programme history row is OPENED on day one', `rows=${history.length}`);
  ok(history[0]?.ended_at === null, 'and it is the OPEN row');
  ok(history[0]?.started_at === FORM.enrollment_date, 'starting on the enrollment date', String(history[0]?.started_at));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 5 · ask 3: PATCH partial semantics ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const patch = async (body) => {
    const r = await fetch(`${API}/students/${createdId}`, {
      method: 'PATCH',
      headers: { ...AS('secretary').headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  };

  let b = await patch({ religion: 'Catholic' });
  ok(b.religion === 'Catholic', 'a supplied field is written');
  ok(b.nok_name === 'Marta Perez', 'an OMITTED field is left alone (not blanked)', String(b.nok_name));
  ok(b.has_health_condition === true, 'an omitted BOOLEAN is left alone');

  b = await patch({ religion: null });
  ok(b.religion === null, 'null CLEARS a value');

  // The case `if (body.x)` cannot express. A health condition ticked by mistake must be
  // un-tickable, and under a truthiness check it would be permanent.
  b = await patch({ has_health_condition: false });
  ok(b.has_health_condition === false, 'a boolean can be turned OFF');

  b = await patch({ program_id: 'prog-something-else' });
  ok(
    b.program?.id === D.programs[0].id,
    'PATCH does NOT move the programme (that is the Dean-only endpoint, §D12)',
    String(b.program?.id),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 6 · ask 7: the MID-TERM FREEZE ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  // A Lecturer, their own offering, and an assessment in the ACTIVE term — the freeze is
  // read off the active semester, exactly as `getActiveSemester()` does.
  //
  // `currentTeacherId` always resolves the acting lecturer to `user-teach-1`'s profile, so
  // the offering has to be one THAT teacher owns or the ownership guard 403s first and the
  // freeze is never reached.
  const sem = D.semesters.find((s) => s.is_active);
  const teacherId = D.teachers.find((t) => t.user_id === 'user-teach-1')?.id ?? D.teachers[0].id;
  const offering = D.offerings.find(
    (o) => o.semester_id === sem.id && o.teacher_ids.includes(teacherId) && !o.is_archived,
  );
  const assessment = D.assessments.find((a) => a.offering_id === offering.id);
  const enrolled = D.enrollments.find((e) => e.offering_id === offering.id && !e.unenrolled_at);
  const H = { cookie: `${SESSION_COOKIE}=teacher` };
  ok(Boolean(offering && assessment && enrolled), 'the probe found a lecturer-owned offering to grade');

  const save = async (score) => {
    const r = await fetch(`${API}/assessments/${assessment.id}/grades`, {
      method: 'PUT',
      headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({
        entries: [{ student_id: enrolled.student_id, status: 'graded', score }],
      }),
    });
    return { status: r.status, body: await r.json() };
  };
  const gradebook = async () =>
    (await fetch(`${API}/grades/offering/${offering.id}`, { headers: H })).json();

  // The dataset's fixed clock. Demo mode reads DEMO_TODAY_ISO rather than `Date.now()`, so
  // the boundary tests below have to use this EXACT instant — an assumed midnight would
  // make "the start instant" nine hours in the past and test nothing.
  const DEMO_NOW = '2025-10-15T09:00:00Z';
  const setWindow = (start, end) => {
    sem.midterm_submission_start = start;
    sem.midterm_submission_end = end;
  };
  const day = (offsetDays) => {
    const d = new Date(DEMO_NOW);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString();
  };

  // ── no window: the state of every term as shipped ──
  setWindow(null, null);
  let g = await gradebook();
  ok(g.midterm_frozen === false, 'no window configured → not frozen');
  ok((await save(11)).status === 200, 'and entry is open');

  // ── inside the window ──
  setWindow(day(-2), day(+5));
  g = await gradebook();
  ok(g.midterm_frozen === true, 'INSIDE the window → the gradebook reports frozen IN ADVANCE');
  ok(g.midterm_submission_end !== null, 'and it names the reopen date', String(g.midterm_submission_end));
  let r = await save(12);
  ok(r.status === 409, 'entry is REFUSED inside the window', `status=${r.status}`);
  ok(r.body?.error?.code === 'midterm_frozen', 'with code midterm_frozen', String(r.body?.error?.code));

  // ── before it opens: the mid-term submission period itself ──
  setWindow(day(+3), day(+10));
  g = await gradebook();
  ok(g.midterm_frozen === false, 'BEFORE the window → not frozen');
  ok((await save(13)).status === 200, 'and entry is open — this is when mid-term marks go in');

  // ── after it closes: "any new grades after end date will be normal" ──
  setWindow(day(-30), day(-1));
  g = await gradebook();
  ok(g.midterm_frozen === false, 'AFTER the window → not frozen');
  ok((await save(14)).status === 200, 'and entry REOPENS — the freeze is a period, not a door');

  // ── boundaries: the two instants the design turns on ──
  setWindow(day(-2), DEMO_NOW);
  ok((await gradebook()).midterm_frozen === true, 'the END instant is still frozen (inclusive)');
  ok((await save(15)).status === 409, 'and entry is refused on it');
  setWindow(DEMO_NOW, day(+2));
  ok((await gradebook()).midterm_frozen === true, 'the START instant is already frozen (inclusive)');
  ok((await save(16)).status === 409, 'and entry is refused on it too');

  // Leave the dataset as it was found.
  setWindow(null, null);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 7 · D34: the client-schema reconciliation ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  // 7a — the ten columns from the client's dump reach the wire.
  const CLIENT_COLS = [
    'student_id_original', 'email', 'transferred_from', 'graduation_date',
    'dropout_date', 'dropout_reason', 'comments', 'origin',
    'educationbg_id', 'doc_id',
  ];
  const seed = D.students[0];
  const detail = await (await fetch(`${API}/students/${seed.id}`, AS('secretary'))).json();
  const absent = CLIENT_COLS.filter((f) => !(f in detail));
  ok(absent.length === 0, 'every client column is on the detail payload', `missing: ${absent.join(', ') || 'none'}`);

  // The rename that matters: the student's OWN email and the LOGIN are different fields.
  // Conflating them is how an address correction silently moves a login.
  ok('login_email' in detail, 'the LOGIN is served as `login_email`, not `email`');
  ok(
    Boolean(detail.email) && detail.email !== detail.login_email,
    'and it is a DIFFERENT value from the contact email',
    `email=${detail.email} login=${detail.login_email}`,
  );

  // 7b — the status vocabulary.
  const statuses = new Set(D.students.map((s) => s.status));
  ok(
    !statuses.has('active') && !statuses.has('inactive'),
    'no student is left on the OLD vocabulary',
    [...statuses].join(', '),
  );
  ok(statuses.has('Registered'), 'the register uses Registered');
  ok(statuses.has('DropOut'), 'and the new DropOut state is represented');

  // 7c — the new columns round-trip through create.
  const created = await (await fetch(`${API}/students`, {
    method: 'POST',
    headers: { ...AS('secretary').headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      first_name: 'Dee', last_name: 'Four', date_of_birth: '2007-02-02',
      enrollment_date: '2026-01-05',
      email: 'dee.four@student.bajc.edu.bz',
      student_id_original: 20777,
      transferred_from: 'Corozal Community College',
      comments: 'Fee plan agreed.',
      origin: 'import-2026',
    }),
  })).json();
  ok(created.email === 'dee.four@student.bajc.edu.bz', 'create writes the contact email');
  ok(created.student_id_original === 20777, 'create writes the original ID');
  ok(created.transferred_from === 'Corozal Community College', 'create writes transferred_from');
  ok(created.origin === 'import-2026', 'create writes origin');
  ok(created.status === 'Registered', 'a new student defaults to Registered', String(created.status));
  ok(created.login_email === null, 'and has no login yet');

  // 7d — the transition STAMPS the date the new state is about. A column nothing ever
  // writes is a column that is always NULL — the trap D32 found on `storage_key`.
  const setStatus = async (id, status) =>
    (await fetch(`${API}/students/${id}/status`, {
      method: 'POST',
      headers: { ...AS('secretary').headers, 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })).json();

  let after = await setStatus(created.id, 'graduated');
  ok(after.status === 'graduated', 'the student can be graduated');
  ok(Boolean(after.graduation_date), 'and graduation_date is STAMPED automatically', String(after.graduation_date));

  // Re-registering must not erase a graduation already on file.
  const stamped = after.graduation_date;
  after = await setStatus(created.id, 'Registered');
  ok(after.graduation_date === stamped, 're-registering KEEPS the graduation date', String(after.graduation_date));

  after = await setStatus(created.id, 'DropOut');
  ok(after.status === 'DropOut', 'DropOut is reachable from Registered');
  ok(Boolean(after.dropout_date), 'and dropout_date is STAMPED automatically', String(after.dropout_date));

  // 7e — 'Summer' is a study load now.
  const summer = await (await fetch(`${API}/students/${created.id}`, {
    method: 'PATCH',
    headers: { ...AS('secretary').headers, 'content-type': 'application/json' },
    body: JSON.stringify({ enrollment_load: 'Summer' }),
  })).json();
  ok(summer.enrollment_load === 'Summer', "'Summer' is accepted as a study load", String(summer.enrollment_load));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 8 · D35: coursestatus (audit / withdrew) ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  // The column has existed since `005_tertiary.sql` and was mapped and NOTHING ELSE until
  // D35 — no endpoint set it, no calculation read it. Everything below is a claim a green
  // typecheck says nothing about.
  const sem = D.semesters.find((x) => x.is_active);
  const offering = D.offerings.find((o) => o.semester_id === sem.id && !o.is_archived);
  const enr = D.enrollments.find(
    (e) => e.offering_id === offering.id && !e.unenrolled_at,
  );
  ok(Boolean(offering && enr), 'the probe found an active enrolment to work with');

  const roster = async () =>
    (await fetch(`${API}/offerings/${offering.id}/roster`, AS('secretary'))).json();
  const setStatus = async (status, role = 'secretary') =>
    fetch(`${API}/offerings/${offering.id}/enrollments/${enr.id}`, {
      method: 'PATCH',
      headers: { ...AS(role).headers, 'content-type': 'application/json' },
      body: JSON.stringify({ enrollment_status: status, reason: 'probe' }),
    });

  const entryFor = (rows) => rows.find((r) => r.enrollment_id === enr.id);

  // 8a — the roster carries it, and it defaults to `enrolled`.
  const original = enr.enrollment_status;
  ok(
    entryFor(await roster())?.enrollment_status === original,
    'the roster carries the course status',
    String(original),
  );

  // 8b — every value is settable, and a Lecturer cannot.
  for (const status of ['audit', 'withdraw_passing', 'withdraw_failing', 'enrolled']) {
    const r = await setStatus(status);
    ok(r.status === 200, `it can be set to ${status}`, `status=${r.status}`);
    if (r.status === 200) {
      ok((await r.json()).enrollment_status === status, `  ...and comes back as ${status}`);
    }
  }
  ok((await setStatus('audit', 'teacher')).status === 403, 'a Lecturer cannot set it');
  ok((await setStatus('nonsense')).status === 422, 'an unknown value is refused');

  // 8c — A WITHDRAWAL IS NOT AN UN-ENROLMENT. The row must stay on the roster, because the
  // transcript has to print the notation against it.
  await setStatus('withdraw_failing');
  const rows = await roster();
  ok(Boolean(entryFor(rows)), 'a withdrawn student STAYS on the roster');
  ok(entryFor(rows)?.unenrolled_at === null, 'and the row is not closed');
  ok(
    entryFor(rows)?.enrollment_status === 'withdraw_failing',
    'with the status recorded on it',
  );

  // 8d — it changes the arithmetic. Audit the student's whole load and their credits and
  // GPA denominator must both fall away; before D35 those credits stayed in the
  // denominator earning nothing, silently depressing the GPA.
  const studentId = enr.student_id;
  const mine = D.enrollments.filter((e) => e.student_id === studentId && !e.unenrolled_at);
  const saved = mine.map((e) => e.enrollment_status);

  const history = async () =>
    (await fetch(`${API}/students/${studentId}/academic-history`, AS('secretary'))).json();

  mine.forEach((e) => { e.enrollment_status = 'enrolled'; });
  const asEnrolled = await history();

  mine.forEach((e) => { e.enrollment_status = 'audit'; });
  const asAudited = await history();

  // Buckets are per COURSE, not per enrolment: the same course sat in two terms is one
  // course. So the expected count is the number of DISTINCT courses behind those rows —
  // counting enrolments was the first cut of this assertion and it was simply wrong.
  const distinctCourses = new Set(
    mine.map((e) => D.offerings.find((o) => o.id === e.offering_id)?.course_id),
  ).size;

  ok(
    asAudited.counts.audited === distinctCourses,
    'every audited course lands in the `audited` bucket',
    `${asAudited.counts.audited} of ${distinctCourses} distinct course(s), from ${mine.length} enrolment(s)`,
  );
  ok(asAudited.counts.in_progress === 0, 'and NONE of them reads as in_progress');
  ok(
    asAudited.gpa_total_credits < asEnrolled.gpa_total_credits,
    'their credits leave the GPA denominator',
    `${asEnrolled.gpa_total_credits} -> ${asAudited.gpa_total_credits}`,
  );

  mine.forEach((e) => { e.enrollment_status = 'withdraw_passing'; });
  const asWithdrawn = await history();
  ok(
    asWithdrawn.counts.withdrawn === distinctCourses,
    'and a withdrawal lands in the `withdrawn` bucket',
    `${asWithdrawn.counts.withdrawn} of ${distinctCourses}`,
  );

  // 8e — the transcript PRINTS the notation. This is the point of the whole feature: the
  // graded-only filter would otherwise drop the course entirely.
  mine.forEach((e) => { e.enrollment_status = 'withdraw_failing'; });
  const transcript = await (
    await fetch(`${API}/reports/transcript?student_id=${studentId}`, AS('secretary'))
  ).json();
  const printed = transcript.years
    .flatMap((y) => y.semesters)
    .flatMap((sm) => sm.subjects);
  ok(printed.length > 0, 'the transcript still lists the withdrawn courses', `${printed.length} rows`);
  ok(
    printed.some((r) => r.notation === 'W/F'),
    'and prints W/F against them',
    [...new Set(printed.map((r) => r.notation))].join(', '),
  );
  ok(
    printed.filter((r) => r.notation).every((r) => r.numeric === null && r.letter === ''),
    'a notated row carries no numeric and no letter',
  );

  // Leave the dataset as it was found.
  mine.forEach((e, i) => { e.enrollment_status = saved[i]; });
}

server.close();
console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

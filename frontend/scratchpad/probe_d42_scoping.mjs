/**
 * D42 — EXECUTE the demo-mode half of the lecturer scoping and the deadline removal.
 *
 * The backend suite covers the real API (`tests/test_d42_lecturer_scoping.py`). Demo mode is
 * a SECOND implementation of the same rules, and this repo's history is that a rule living
 * in only one of the two gets certified by the demo and refused by the server — or, worse
 * here, the demo stays STRICTER than the server and nobody notices, because everything
 * still "works".
 *
 * Every claim below is one `tsc` cannot see:
 *
 *   1. §3 — GET /students/{id} narrows `current_offerings` to the LECTURER's own offerings.
 *   2. §3 — GET /students/{id}/assessments groups only their own subjects.
 *   3. §3 — GET /students/{id}/years drops years they did not teach the student in.
 *   4. §2 — GET /teachers/{id}/years lists only years the lecturer has an assignment in.
 *   5. §2 — GET /teachers/{id}?academic_year_id= narrows `classes_taught` to that year.
 *   6. §5 — the gradebook reports an OPEN window even on a term carrying a past deadline,
 *          and a grade saves through it.
 *
 * Run: `node scratchpad/probe_d42_scoping.mjs`
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.d42-probe-${process.pid}.cjs`);

await build({
  stdin: {
    contents: `
      export { studentsHandlers } from '@shared/api/mocks/handlers/students';
      export { teachersHandlers } from '@shared/api/mocks/handlers/teachers';
      export { gradesHandlers } from '@shared/api/mocks/handlers/grades';
      export { offeringsHandlers } from '@shared/api/mocks/handlers/offerings';
      export { DEMO_DATASET, DEMO_TODAY_ISO } from '@shared/api/mocks/demo/dataset';
      export { offeringsOwnedByTeacher } from '@shared/api/mocks/demo/selectors';
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

// The handlers read the caller's role off this cookie and DEFAULT TO 'principal' when it is
// absent — so a misspelt name would silently run every request as the Dean, who is exempt
// from every rule under test here. Same trap `probe_d33.mjs` documents.
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
  ...M.teachersHandlers,
  ...M.gradesHandlers,
  ...M.offeringsHandlers,
);
server.listen({ onUnhandledRequest: 'bypass' });

const json = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

// The demo lecturer login stands in for Maria Reyes (`user-teach-1`); see
// DEMO_REPRESENTATIVE_USER_ID. Everything below is asserted against HER offerings.
const lecturer = D.teachers.find((t) => t.user_id === 'user-teach-1');
const owned = new Set(M.offeringsOwnedByTeacher(lecturer.id).map((o) => o.id));

/** A student the lecturer teaches who ALSO takes at least one course she does not. */
function studentWithBothKinds() {
  for (const s of D.students) {
    const mine = new Set(
      D.enrollments.filter((e) => e.student_id === s.id).map((e) => e.offering_id),
    );
    const hers = [...mine].filter((id) => owned.has(id));
    const others = [...mine].filter((id) => !owned.has(id));
    if (hers.length > 0 && others.length > 0) return { student: s, hers, others };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 0 · the fixture itself ===');
// ═══════════════════════════════════════════════════════════════════════════
const subject = studentWithBothKinds();
ok(
  subject !== null,
  'the demo seed HAS a student who takes both the lecturer\u2019s course and another\u2019s',
  subject
    ? `${subject.student.full_name}: ${subject.hers.length} hers, ${subject.others.length} not`
    : 'no such student — every assertion below would be vacuous',
);
if (!subject) {
  console.log('\nABORT: no discriminating fixture in the demo dataset.');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 1 · §3 GET /students/{id} — current_offerings ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const sid = subject.student.id;
  const dean = await json(`${API}/students/${sid}`, AS('principal'));
  const lect = await json(`${API}/students/${sid}`, AS('teacher'));

  const deanIds = new Set(dean.body.current_offerings.map((o) => o.id));
  const lectIds = new Set(lect.body.current_offerings.map((o) => o.id));

  ok(lect.status === 200, 'a lecturer who shares a course can still OPEN the profile');
  ok(
    deanIds.size > lectIds.size,
    'the Dean sees strictly more offerings than the lecturer',
    `dean ${deanIds.size} vs lecturer ${lectIds.size}`,
  );
  ok(
    [...lectIds].every((id) => owned.has(id)),
    'every offering the lecturer sees is one she teaches',
    [...lectIds].join(', '),
  );
  ok(lectIds.size > 0, 'and she is not left with an empty list', `${lectIds.size} offering(s)`);
  ok(
    lect.body.full_name === subject.student.full_name,
    'the rest of the record still comes through',
    lect.body.full_name,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 2 · §3 GET /students/{id}/assessments — the grades tab ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const sid = subject.student.id;
  const dean = await json(`${API}/students/${sid}/assessments`, AS('principal'));
  const lect = await json(`${API}/students/${sid}/assessments`, AS('teacher'));

  const deanGroups = dean.body.items.map((g) => g.offering_id);
  const lectGroups = lect.body.items.map((g) => g.offering_id);

  ok(
    deanGroups.length > lectGroups.length,
    'the Dean groups more subjects than the lecturer',
    `dean ${deanGroups.length} vs lecturer ${lectGroups.length}`,
  );
  ok(
    lectGroups.every((id) => owned.has(id)),
    'the lecturer sees grades ONLY for her own courses',
    lectGroups.join(', '),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 3 · §3 GET /students/{id}/years ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const sid = subject.student.id;
  const dean = await json(`${API}/students/${sid}/years`, AS('principal'));
  const lect = await json(`${API}/students/${sid}/years`, AS('teacher'));
  const lectYears = lect.body.items.map((y) => y.id);

  ok(
    lectYears.length <= dean.body.items.length,
    'the lecturer is never offered MORE years than the Dean',
    `dean ${dean.body.items.length} vs lecturer ${lectYears.length}`,
  );

  /*
   * Every year she is offered must be one she actually taught this student in — measured
   * against the DEAN's answer for the same year rather than against "the tab is non-empty".
   *
   * That distinction matters. The demo seed's archived-year offerings all carry
   * `is_archived: true`, and `assessmentsForStudent` drops archived offerings for EVERY
   * role — so the 2024-2025 tab is empty for the Dean too. Asserting "not empty" would have
   * been measuring a gap in the seed data, not the D42 rule.
   */
  for (const yearId of lectYears) {
    const deanScoped = await json(
      `${API}/students/${sid}/assessments?academic_year_id=${yearId}`,
      AS('principal'),
    );
    const lectScoped = await json(
      `${API}/students/${sid}/assessments?academic_year_id=${yearId}`,
      AS('teacher'),
    );
    const lectIds = lectScoped.body.items.map((g) => g.offering_id);
    ok(
      lectIds.length <= deanScoped.body.items.length && lectIds.every((id) => owned.has(id)),
      `year ${yearId}: the lecturer's view is a subset of the Dean's, all hers`,
      `dean ${deanScoped.body.items.length} vs lecturer ${lectIds.length}`,
    );
  }

  // And the scoping is real somewhere: at least one offered year must actually narrow.
  const narrowsSomewhere = [];
  for (const yearId of lectYears) {
    const deanScoped = await json(
      `${API}/students/${sid}/assessments?academic_year_id=${yearId}`,
      AS('principal'),
    );
    const lectScoped = await json(
      `${API}/students/${sid}/assessments?academic_year_id=${yearId}`,
      AS('teacher'),
    );
    if (deanScoped.body.items.length > lectScoped.body.items.length) narrowsSomewhere.push(yearId);
  }
  ok(
    narrowsSomewhere.length > 0,
    'the year-scoped read narrows for at least one year (not vacuously equal everywhere)',
    narrowsSomewhere.join(', '),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 4 · §2 GET /teachers/{id}/years ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const res = await json(`${API}/teachers/${lecturer.id}/years`, AS('principal'));
  ok(res.status === 200, 'the route exists (a bypassed request would 4xx or hang)');

  const returned = res.body.items.map((y) => y.id);
  // Derive the truth independently of the handler: the years behind her own offerings.
  const expected = new Set(
    M.offeringsOwnedByTeacher(lecturer.id)
      .map((o) => D.semesters.find((s) => s.id === o.semester_id)?.academic_year_id)
      .filter(Boolean),
  );
  ok(
    returned.length === expected.size && returned.every((id) => expected.has(id)),
    'lists exactly the years she has an assignment in',
    `${returned.length} year(s)`,
  );

  const unknown = await json(`${API}/teachers/does-not-exist/years`, AS('principal'));
  ok(unknown.status === 404, 'an unknown lecturer is 404, not an empty list', `${unknown.status}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 5 · §2 GET /teachers/{id}?academic_year_id= ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const all = await json(`${API}/teachers/${lecturer.id}`, AS('principal'));
  const allIds = all.body.classes_taught.map((c) => c.offering_id);
  ok(allIds.length > 0, 'unscoped, the profile lists her assignments', `${allIds.length}`);

  const years = (await json(`${API}/teachers/${lecturer.id}/years`, AS('principal'))).body.items;
  let scopedTotal = 0;
  for (const year of years) {
    const scoped = await json(
      `${API}/teachers/${lecturer.id}?academic_year_id=${year.id}`,
      AS('principal'),
    );
    const ids = scoped.body.classes_taught.map((c) => c.offering_id);
    scopedTotal += ids.length;
    ok(
      ids.every((id) => allIds.includes(id)),
      `year ${year.name} narrows rather than widens`,
      `${ids.length} of ${allIds.length}`,
    );
  }
  ok(
    scopedTotal === allIds.length,
    'the years PARTITION her assignments — none is unreachable through the switcher',
    `${scopedTotal} across years vs ${allIds.length} total`,
  );

  const nowhere = await json(
    `${API}/teachers/${lecturer.id}?academic_year_id=year-that-does-not-exist`,
    AS('principal'),
  );
  ok(
    nowhere.body.classes_taught.length === 0,
    'a year she never taught is EMPTY, not a silent fallback to everything',
    `${nowhere.body.classes_taught.length}`,
  );

  ok(
    all.body.classes_taught.every((c) => c.offering.semester !== null),
    'every assignment names its semester (the ref used to omit it)',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== 6 · §5 the end-of-session deadline no longer closes anything ===');
// ═══════════════════════════════════════════════════════════════════════════
{
  const offeringId = [...owned][0];
  // The seeded terms carry deadlines; force one firmly into the past on the ACTIVE term,
  // which is the state that used to shut the window.
  const active = D.semesters.find((s) => s.is_active);
  active.grade_submission_deadline = '2020-01-01T00:00:00Z';
  // ...and make sure no mid-session freeze is running, or the 409 below would be the
  // OTHER window and this test would prove nothing.
  active.midterm_submission_start = null;
  active.midterm_submission_end = null;

  const book = await json(`${API}/grades/offering/${offeringId}`, AS('teacher'));
  ok(
    book.body.grade_window_closed === false,
    'the gradebook reports an OPEN window despite a deadline in 2020',
    `grade_window_closed=${book.body.grade_window_closed}`,
  );
  ok(
    book.body.grade_submission_deadline === null,
    'and does not surface a deadline it will not honour',
    `${book.body.grade_submission_deadline}`,
  );

  const assessment = D.assessments.find((a) => a.offering_id === offeringId);
  const student = D.enrollments.find((e) => e.offering_id === offeringId);
  if (assessment && student) {
    const save = await json(`${API}/assessments/${assessment.id}/grades`, {
      method: 'PUT',
      headers: { ...AS('teacher').headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        entries: [{ student_id: student.student_id, status: 'graded', score: 11 }],
      }),
    });
    ok(save.status === 200, 'and a grade SAVES through it', `status ${save.status}`);
  } else {
    ok(false, 'fixture: no assessment + enrolment on the lecturer\u2019s offering to save into');
  }

  /*
   * The rule that survived: re-freeze and the same save must be refused again.
   *
   * The window is built around DEMO_TODAY, **not** `Date.now()`. `midtermFreeze()` in the
   * handler compares against `DEMO_TODAY_ISO` (2025-10-15) precisely so the demo is
   * deterministic — so a window around the real clock contains no demo "now" at all, and
   * the save would sail through while looking like the freeze had been removed.
   */
  const demoNow = new Date(M.DEMO_TODAY_ISO).getTime();
  active.midterm_submission_start = new Date(demoNow - 86400000).toISOString();
  active.midterm_submission_end = new Date(demoNow + 86400000).toISOString();
  if (assessment && student) {
    const frozen = await json(`${API}/assessments/${assessment.id}/grades`, {
      method: 'PUT',
      headers: { ...AS('teacher').headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        entries: [{ student_id: student.student_id, status: 'graded', score: 12 }],
      }),
    });
    ok(
      frozen.status === 409 && frozen.body?.error?.code === 'midterm_frozen',
      'the MID-SESSION freeze still refuses the same save',
      `${frozen.status} ${frozen.body?.error?.code ?? ''}`,
    );
  }
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;

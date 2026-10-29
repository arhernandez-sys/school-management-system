/**
 * D47 — execute the REAL demo MSW handlers and prove the marking window, the automatic
 * zeros, the reopen workflow and the printable report behave as the backend's contract
 * says. Everything here is a rule `tsc` cannot see: a hardcoded `marking_open: true` or a
 * term grade that skips blanks type-checks perfectly.
 *
 * Run from frontend/:  node scratchpad/probe_d47_marking.mjs
 *
 * The dataset is mutated in-process by the writes, so the sections run in order: reads
 * first, then the reopen round trip, then the authoring guards.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.d47-marking-probe-${process.pid}.cjs`);

await build({
  entryPoints: [path.join(FE, 'src/shared/api/mocks/handlers/index.ts')],
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
const mod = require(out);
const { setupServer } = require('msw/node');
const server = setupServer(...(mod.handlers ?? mod.default));
server.listen({ onUnhandledRequest: 'error' });

const BASE = 'http://sis.test/api/v1';
let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
async function call(method, url, role, body) {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { Cookie: `sis_mock_session=${role}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const get = (url, role) => call('GET', url, role);

const OFF = 'off-1'; // MATH1110-01 — Maria Reyes (the demo `teacher` login)
const col = (book, title) => book.assessments.find((a) => a.title === title);
const cellsFor = (book, id) => book.rows.map((r) => r.cells.find((c) => c.assessment_id === id));

/** Independent re-derivation of the term % from the cells the gradebook shows. */
function expectedTerm(book, row) {
  let sum = 0;
  let base = 0;
  book.assessments.forEach((a, i) => {
    const c = row.cells[i];
    let eff = null;
    if (c.status === 'graded') eff = c.makeup_score ?? c.score;
    else if (c.status === 'absent') eff = c.makeup_score ?? 0; // demo policy absent_as_zero
    else if (c.auto_zero) eff = 0;
    if (eff === null) return;
    sum += (eff / a.max_score) * 100 * a.weight;
    base += a.weight;
  });
  return base === 0 ? null : Math.round((sum / base) * 100) / 100;
}

// ═══ 1. The lecturer's gradebook ═════════════════════════════════════════════════
console.log('\n=== gradebook (lecturer, MATH1110-01) ===');
let book = (await get(`/grades/offering/${OFF}`, 'teacher')).body;
check('lecturer can edit their own gradebook', book.can_edit === true);
check(
  'no retired lifecycle keys on any column',
  book.assessments.every((a) => !('status' in a) && !('is_released' in a) && !('is_editable' in a)),
);
check('no `is_released` on any cell', book.rows.every((r) => r.cells.every((c) => !('is_released' in c))));
const lab = col(book, 'Lab Practical');
const ps2 = col(book, 'Problem Set 2');
const essay = col(book, 'Essay Draft');
const quiz3 = col(book, 'Quiz 3');
const reading = col(book, 'Reading Response');
const ut1 = col(book, 'Unit Test 1');
const project = col(book, 'Project');
check('Lab Practical LOCKED', lab.marking_open === false && lab.days_left === null, JSON.stringify(lab));
check(
  'Lab Practical window closed 2025-10-11 23:59:59 Belize',
  lab.marking_closes_at === '2025-10-12T05:59:59Z' && lab.effective_closes_at === lab.marking_closes_at,
);
check('Lab Practical offers "Ask the Dean"', lab.can_request_reopen === true && lab.pending_reopen_request_id === null);
const labCells = cellsFor(book, lab.id);
check('Lab Practical has 4 automatic zeros', labCells.filter((c) => c.auto_zero).length === 4, `${labCells.filter((c) => c.auto_zero).length}`);
check(
  'the excused Lab Practical cell is NOT zeroed',
  labCells.some((c) => c.status === 'excused' && c.auto_zero === false),
);
check('an auto-zero cell keeps score null', labCells.filter((c) => c.auto_zero).every((c) => c.score === null));
check(
  'Problem Set 2 locked with its PENDING request, so no second ask',
  ps2.marking_open === false && ps2.can_request_reopen === false && ps2.pending_reopen_request_id === 'reopen-seed-2',
);
check(
  'Essay Draft REOPENED until 2025-10-16 23:59:59 Belize, 1 day left',
  essay.marking_open === true && essay.reopened_until === '2025-10-17T05:59:59Z' &&
    essay.effective_closes_at === essay.reopened_until && essay.days_left === 1,
  JSON.stringify(essay),
);
check('Quiz 3 closes TODAY (days_left 0)', quiz3.marking_open && quiz3.days_left === 0);
check(
  'undated Reading Response counts from its creation day: 3 days left',
  reading.assessment_date === null && reading.marking_open && reading.days_left === 3,
);
check('Unit Test 1 closes tomorrow', ut1.marking_open && ut1.days_left === 1);
check('Project open with 12 days left', project.marking_open && project.days_left === 12);
check('open windows carry no auto-zero', cellsFor(book, quiz3.id).every((c) => !c.auto_zero));
const dates = book.assessments.map((a) => a.assessment_date);
check(
  'columns in server order (date asc, undated last)',
  dates.at(-1) === null && dates.slice(0, -1).every((d, i, xs) => i === 0 || xs[i - 1] <= d),
);
const termMismatch = book.rows.filter((r) => expectedTerm(book, r) !== r.term_numeric);
check(
  'every term % = cells re-derived (auto-zeros count, excused/open blanks do not)',
  termMismatch.length === 0,
  termMismatch.map((r) => `${r.student.full_name}: ${r.term_numeric} vs ${expectedTerm(book, r)}`).join('; '),
);
const zeroed = book.rows.find((r) => r.cells.some((c, i) => c.auto_zero && book.assessments[i].id === lab.id));
check('a zeroed student exists to make the last check meaningful', Boolean(zeroed));

// Dean's view of the same book.
const deanBook = (await get(`/grades/offering/${OFF}`, 'principal')).body;
check('Dean reads, cannot edit or ask', deanBook.can_edit === false && deanBook.assessments.every((a) => !a.can_request_reopen));
check('secretary has no gradebook (403, `_staff`)', (await get(`/grades/offering/${OFF}`, 'secretary')).status === 403);
check('lecturer gets 404 on a gradebook they do not teach', (await get('/grades/offering/off-2', 'teacher')).status === 404);

// HOD — teaches their own (editable), reads their programme's (read-only).
const hodPicker = (await get('/grades/offerings', 'hod')).body.items;
const hodOwn = hodPicker.filter((o) => o.can_edit);
check('HOD picker has editable OWN offerings (the old role==="teacher" gap)', hodOwn.length > 0, hodOwn.map((o) => o.offering.label).join(', '));
if (hodOwn[0]) {
  const hb = (await get(`/grades/offering/${hodOwn[0].offering.id}`, 'hod')).body;
  check('HOD can_edit their own gradebook', hb.can_edit === true);
}

// ═══ 2. Writes against the window ════════════════════════════════════════════════
console.log('\n=== PUT /assessments/{id}/grades ===');
const blankStudent = book.rows.find((r) => r.cells.find((c) => c.assessment_id === lab.id).auto_zero).student;
let r = await call('PUT', `/assessments/${lab.id}/grades`, 'teacher', {
  entries: [{ student_id: blankStudent.id, status: 'graded', score: 20 }],
});
check('PUT on the LOCKED assessment → 409 marking_closed', r.status === 409 && r.body.error.code === 'marking_closed', JSON.stringify(r.body));
check('…naming when it closed (top-level closed_at)', r.body.error.closed_at === '2025-10-12T05:59:59Z');
const quiz3Blank = book.rows.find((row) => row.cells.find((c) => c.assessment_id === quiz3.id).status === 'pending' && row.is_active_member).student;
r = await call('PUT', `/assessments/${quiz3.id}/grades`, 'teacher', {
  entries: [{ student_id: quiz3Blank.id, status: 'graded', score: 15 }],
});
check('PUT on an OPEN assessment → 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
check('Dean cannot enter marks (403)', (await call('PUT', `/assessments/${quiz3.id}/grades`, 'principal', { entries: [] })).status === 403);
const off2Asmt = (await get('/assessments?offering_id=off-2&page_size=50', 'principal')).body.items[0];
check(
  'lecturer PUT on an offering they do not teach → 404',
  (await call('PUT', `/assessments/${off2Asmt.id}/grades`, 'teacher', { entries: [] })).status === 404,
);

// ═══ 3. Reopen round trip ═════════════════════════════════════════════════════════
console.log('\n=== reopen requests ===');
let bell = (await get('/announcements/unread-count', 'principal')).body;
check('Dean bell counts 1 pending reopen', bell.pending_assessment_reopens === 1, JSON.stringify(bell));
check('bell unread_count is the sum of all three', bell.unread_count === bell.unread_announcements + bell.pending_grade_revisions + bell.pending_assessment_reopens);
check('lecturer bell carries 0 reopens', (await get('/announcements/unread-count', 'teacher')).body.pending_assessment_reopens === 0);

r = await call('POST', `/assessments/${quiz3.id}/reopen-requests`, 'teacher', { reason: 'x' });
check('ask on an OPEN window → 409 marking_open', r.status === 409 && r.body.error.code === 'marking_open');
r = await call('POST', `/assessments/${ps2.id}/reopen-requests`, 'teacher', { reason: 'again' });
check('ask twice → 409 reopen_already_pending', r.status === 409 && r.body.error.code === 'reopen_already_pending');
check('Dean cannot ask (403)', (await call('POST', `/assessments/${lab.id}/reopen-requests`, 'principal', { reason: 'x' })).status === 403);
check('empty reason → 422', (await call('POST', `/assessments/${lab.id}/reopen-requests`, 'teacher', { reason: '' })).status === 422);
const off2Locked = (await get('/assessments?offering_id=off-2&page_size=50', 'principal')).body.items.find((a) => !a.marking_open);
check(
  'ask on an assessment you do not teach → 404',
  (await call('POST', `/assessments/${off2Locked.id}/reopen-requests`, 'teacher', { reason: 'x' })).status === 404,
);

r = await call('POST', `/assessments/${lab.id}/reopen-requests`, 'teacher', { reason: 'Scripts found in the lab.' });
check('lecturer asks on Lab Practical → 201', r.status === 201, JSON.stringify(r.body).slice(0, 300));
const req = r.body;
// `reopen._blank_count` = active roster minus NON-PENDING rows, so the `absent`-without-
// makeup row counts as "marked" there even though it is one of the 4 auto-zeros. 3, not 4:
// the backend's definition, mirrored (flagged as ambiguous in the D47 hand-off).
check('request counts exactly the auto-zeroed students (4: no-row x2 + pending + absent w/o makeup)', req.blank_count === 4, `${req.blank_count}`);
check('request is withdrawable by its author', req.can_withdraw === true && req.requested_by_name === 'Maria Reyes');
check('request names the original close', req.marking_closes_at === '2025-10-12T05:59:59Z' && req.reopened_until === null);
book = (await get(`/grades/offering/${OFF}`, 'teacher')).body;
check(
  'gradebook now shows it pending, no second ask',
  col(book, 'Lab Practical').pending_reopen_request_id === req.id && col(book, 'Lab Practical').can_request_reopen === false,
);

let queue = (await get('/assessment-reopen-requests?status=pending', 'principal')).body;
check('Dean queue lists both pending, oldest first', queue.items.map((i) => i.id).join() === `reopen-seed-2,${req.id}` && queue.pending_for_me === 2, queue.items.map((i) => i.id).join());
check('Dean queue rows are not withdrawable by the Dean', queue.items.every((i) => i.can_withdraw === false));
check('secretary cannot read the queue (403)', (await get('/assessment-reopen-requests', 'secretary')).status === 403);
const mine = (await get('/assessment-reopen-requests', 'teacher')).body;
check('lecturer sees their own 3 (approved + 2 pending), pending_for_me 0', mine.items.length === 3 && mine.pending_for_me === 0);
check('auditor reads all', (await get('/assessment-reopen-requests', 'auditor')).body.items.length === 3);
check('auditor cannot decide (read-only guard)', (await call('POST', `/assessment-reopen-requests/${req.id}/decision`, 'auditor', { status: 'approved' })).status === 403);
check('lecturer cannot decide (403)', (await call('POST', `/assessment-reopen-requests/${req.id}/decision`, 'teacher', { status: 'approved' })).status === 403);
check('granted_days 15 → 422', (await call('POST', `/assessment-reopen-requests/${req.id}/decision`, 'principal', { status: 'approved', granted_days: 15 })).status === 422);

r = await call('POST', `/assessment-reopen-requests/${req.id}/decision`, 'principal', { status: 'approved', granted_days: 3, decision_note: 'Fine.' });
check('Dean approves for 3 days → 200', r.status === 200 && r.body.status === 'approved' && r.body.granted_days === 3);
check('reopened until 23:59:59 Belize on today+3 (2025-10-18)', r.body.reopened_until === '2025-10-19T05:59:59Z', r.body.reopened_until);
book = (await get(`/grades/offering/${OFF}`, 'teacher')).body;
const labNow = col(book, 'Lab Practical');
check('marking_open is TRUE after approval', labNow.marking_open === true && labNow.days_left === 3, JSON.stringify(labNow));
check('…and the blanks stop counting as 0', cellsFor(book, labNow.id).every((c) => !c.auto_zero));
r = await call('PUT', `/assessments/${lab.id}/grades`, 'teacher', {
  entries: [{ student_id: blankStudent.id, status: 'graded', score: 20 }],
});
check('PUT on the reopened assessment → 200', r.status === 200);
check('deciding again → 409 reopen_decided', (await call('POST', `/assessment-reopen-requests/${req.id}/decision`, 'principal', { status: 'denied' })).body.error.code === 'reopen_decided');
check('withdrawing a decided request → 409', (await call('DELETE', `/assessment-reopen-requests/${req.id}`, 'teacher')).status === 409);

r = await call('POST', '/assessment-reopen-requests/reopen-seed-2/decision', 'principal', { status: 'denied', decision_note: 'Window was ample.' });
check('Dean denies Problem Set 2', r.status === 200 && r.body.status === 'denied' && r.body.granted_days === null && r.body.reopened_until === null);
book = (await get(`/grades/offering/${OFF}`, 'teacher')).body;
check('after a denial it is still locked and may be asked again', col(book, 'Problem Set 2').marking_open === false && col(book, 'Problem Set 2').can_request_reopen === true);
r = await call('POST', `/assessments/${ps2.id}/reopen-requests`, 'teacher', { reason: 'Asking again.' });
check('ask again → 201', r.status === 201);
check('a stranger cannot withdraw it (404)', (await call('DELETE', `/assessment-reopen-requests/${r.body.id}`, 'hod')).status === 404);
check('the author withdraws it → 204', (await call('DELETE', `/assessment-reopen-requests/${r.body.id}`, 'teacher')).status === 204);
check('Dean bell back to 0', (await get('/announcements/unread-count', 'principal')).body.pending_assessment_reopens === 0);

// ═══ 4. The printable report ══════════════════════════════════════════════════════
console.log('\n=== GET /grades/assessment-report ===');
const lecturerPicker = (await get('/grades/offerings', 'teacher')).body.items.map((o) => o.offering.id);
const rep = (await get('/grades/assessment-report', 'teacher')).body;
const repIds = rep.offerings.map((o) => o.offering.offering.id);
check('lecturer report holds only their offerings', repIds.length > 0 && repIds.every((id) => lecturerPicker.includes(id)), repIds.join());
check('…all of them in the active session by default', rep.offerings.every((o) => o.semester.id === 'sem-2025-1'));
const repWidened = (await get('/grades/assessment-report?teacher_id=teach-2', 'teacher')).body;
check('lecturer `teacher_id` is ignored, not honoured', JSON.stringify(repWidened.offerings.map((o) => o.offering.offering.id)) === JSON.stringify(repIds));
check('lecturer naming an offering they do not teach → 404', (await get('/grades/assessment-report?offering_id=off-2', 'teacher')).status === 404);
check('secretary → 403', (await get('/grades/assessment-report', 'secretary')).status === 403);
const sec = rep.offerings.find((o) => o.offering.offering.id === OFF);
book = (await get(`/grades/offering/${OFF}`, 'teacher')).body;
const activeRows = book.rows.filter((row) => row.is_active_member);
check('report section = gradebook (same cells and term %, active members only)',
  sec && sec.rows.length === activeRows.length &&
    sec.rows.every((row, i) => JSON.stringify(row.cells) === JSON.stringify(activeRows[i].cells) && row.term_numeric === activeRows[i].term_numeric));
check('report columns carry category name + window', sec.assessments.every((a) => 'category_name' in a && 'marking_open' in a && 'effective_closes_at' in a));
const deanRep = (await get('/grades/assessment-report', 'principal')).body;
check('Dean report spans the college\'s active session', deanRep.total_offerings > repIds.length && !deanRep.truncated, `${deanRep.total_offerings}`);
const byStudent = (await get('/grades/assessment-report?student_id=stu-1', 'principal')).body;
check('student filter: one row per section, that student', byStudent.offerings.length > 0 && byStudent.offerings.every((o) => o.rows.length === 1 && o.rows[0].student.id === 'stu-1'));
const byTeacher = (await get('/grades/assessment-report?teacher_id=teach-1', 'principal')).body;
check('Dean teacher_id narrows to that lecturer', JSON.stringify(byTeacher.offerings.map((o) => o.offering.offering.id)) === JSON.stringify(repIds));
check('offering-grades: lecturer on a course they do not teach → 404', (await get('/reports/offering-grades?offering_id=off-2', 'teacher')).status === 404);
check('offering-grades: lecturer on their own → 200', (await get(`/reports/offering-grades?offering_id=${OFF}`, 'teacher')).status === 200);

// ═══ 5. Authoring guards ══════════════════════════════════════════════════════════
console.log('\n=== assessments CRUD ===');
const list = (await get(`/assessments?offering_id=${OFF}&page_size=50`, 'teacher')).body.items;
check('list items carry the five marking fields, no status', list.every((a) => ['marking_open', 'marking_closes_at', 'reopened_until', 'effective_closes_at', 'days_left'].every((k) => k in a) && !('status' in a) && !('is_released' in a)));
const lecturerAll = (await get('/assessments?page_size=200', 'teacher')).body.items;
check('a teacher\'s list is always their own (no scope=me needed)', lecturerAll.every((a) => lecturerPicker.includes(a.offering.id)));
r = await call('POST', '/assessments', 'teacher', { offering_id: OFF, title: 'Late', max_score: 10, assessment_date: '2025-10-01' });
check('create with a passed window → 422 marking_window_passed', r.status === 422 && r.body.error.code === 'marking_window_passed', JSON.stringify(r.body));
r = await call('POST', '/assessments', 'teacher', { offering_id: OFF, title: 'Edge', max_score: 10, assessment_date: '2025-10-10' });
check('create dated exactly 5 days ago → 201, closes today', r.status === 201 && r.body.marking_open && r.body.days_left === 0);
const edge = r.body;
r = await call('POST', '/assessments', 'teacher', { offering_id: OFF, title: 'Undated', max_score: 10, weight: 7 });
check('create undated → open 5 days, weight locked at 1', r.status === 201 && r.body.days_left === 5 && r.body.weight === 1);
check('Dean cannot create (403)', (await call('POST', '/assessments', 'principal', { offering_id: OFF, title: 'x', max_score: 1 })).status === 403);
const closedQuiz = list.find((a) => a.title === 'Quiz 1');
r = await call('PATCH', `/assessments/${closedQuiz.id}`, 'teacher', { assessment_date: '2025-10-14' });
check('moving the date of a CLOSED assessment → 409 marking_closed', r.status === 409 && r.body.error.code === 'marking_closed');
r = await call('PATCH', `/assessments/${closedQuiz.id}`, 'teacher', { title: 'Quiz 1 (renamed)' });
check('renaming a closed assessment is still fine', r.status === 200 && r.body.title === 'Quiz 1 (renamed)');
r = await call('PATCH', `/assessments/${edge.id}`, 'teacher', { assessment_date: '2025-10-01' });
check('moving an open one into a passed window → 422', r.status === 422 && r.body.error.code === 'marking_window_passed');
r = await call('DELETE', `/assessments/${closedQuiz.id}`, 'teacher');
check('deleting a CLOSED assessment → 409 marking_closed', r.status === 409 && r.body.error.code === 'marking_closed');
check('deleting an open empty one → 204', (await call('DELETE', `/assessments/${edge.id}`, 'teacher')).status === 204);
check('/status route is gone', (await call('POST', `/assessments/${edge.id}/status`, 'teacher', { status: 'published' }).catch(() => ({ status: 'unhandled' }))).status !== 200);

// ═══ 6. Dashboards, /grades/me, student tab ═══════════════════════════════════════
console.log('\n=== dashboards + student views ===');
const td = (await get('/dashboard', 'teacher')).body;
check('teacher stats are exactly the three D47 keys', JSON.stringify(Object.keys(td.stats).sort()) === JSON.stringify(['attendance_due_today', 'my_offerings', 'ungraded_items']));
check('no awaiting_release on the teacher dashboard', !('awaiting_release' in td));
const openMine = (await get('/assessments?page_size=200&semester_id=sem-2025-1', 'teacher')).body.items.filter((a) => a.marking_open);
check('ungraded_items = my open-window assessments this session', td.stats.ungraded_items === openMine.length, `${td.stats.ungraded_items} vs ${openMine.length}`);
const closes = td.recent_assessments.map((a) => a.marking_closes_at);
check('recent_assessments: open only, soonest-closing first, capped at 6',
  td.recent_assessments.length === Math.min(6, openMine.length) && td.recent_assessments.every((a) => a.days_left !== null && a.offering_id) && closes.every((c, i) => i === 0 || closes[i - 1] <= c), closes.join());
const dd = (await get('/dashboard', 'principal')).body;
const openCollege = (await get('/assessments?page_size=200&semester_id=sem-2025-1', 'principal')).body.items.filter((a) => a.marking_open);
check('Dean outstanding_grade_submissions = open-window assessments in session', dd.stats.outstanding_grade_submissions === openCollege.length, `${dd.stats.outstanding_grade_submissions} vs ${openCollege.length}`);
const me = (await get('/grades/me', 'student')).body;
check('/grades/me rows carry auto_zero', me.by_subject.every((s) => s.assessments.every((a) => typeof a.auto_zero === 'boolean')));
check('/grades/me lists only results or auto-zeros', me.by_subject.every((s) => s.assessments.every((a) => a.status !== 'pending' || a.auto_zero)));
// Someone in MATH1110-01 who was zeroed on Problem Set 2 (still locked after the denial).
const zeroedStu = book.rows.find((row) => row.cells.find((c) => c.assessment_id === ps2.id).auto_zero).student;
const tab = (await get(`/students/${zeroedStu.id}/assessments`, 'principal')).body;
check('student tab envelope drops nudge_cooldown_seconds', !('nudge_cooldown_seconds' in tab));
const tabLine = tab.items.flatMap((g) => g.assessments).find((a) => a.id === ps2.id);
check('student tab flags the auto-zero line, no is_released/last_nudged_at',
  tabLine && tabLine.auto_zero === true && tabLine.score === null && !('is_released' in tabLine) && !('last_nudged_at' in tabLine), JSON.stringify(tabLine));
const card = (await get('/reports/report-card/me', 'student')).body;
check('report card never withholds (every subject graded)', card.subjects.every((s) => s.status === 'graded'));

server.close();
rmSync(out, { force: true });
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

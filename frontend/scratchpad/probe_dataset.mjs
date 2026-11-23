/**
 * Build + execute the demo dataset in node, to prove it CONSTRUCTS.
 *
 * The `teacherByCode('MATH')` defect threw at module-evaluation time, which neither
 * `tsc` nor `vite build` can see: both only need the module to type-check and bundle.
 * Only running it catches that class of failure.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(os.tmpdir(), `sis-demo-probe-${process.pid}.cjs`);

await build({
  entryPoints: [path.join(FE, 'src/shared/api/mocks/demo/dataset.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
  // The dataset imports `@shared/types/*` for types only, but the barrel also pulls
  // `generated/model`, which is type-only too. Map the aliases so esbuild resolves them.
  alias: {
    '@shared': path.join(FE, 'src/shared'),
    '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'),
    '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'import.meta.env.VITE_API_BASE_URL': '"/api/v1"' },
});

const require = createRequire(import.meta.url);
const D = require(out);
const ds = D.DEMO_DATASET;

const fail = [];
function check(label, cond, detail) {
  if (!cond) fail.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== dataset constructed ===');
console.log(
  'counts:',
  JSON.stringify(
    {
      courses: ds.courses.length,
      offerings: ds.offerings.length,
      offering_meetings: ds.offering_meetings.length,
      students: ds.students.length,
      enrollments: ds.enrollments.length,
      assessments: ds.assessments.length,
      assessment_grades: ds.assessment_grades.length,
      attendance: ds.attendance_records.length,
    },
    null,
    0,
  ),
);

// ── The two D31 capabilities the dataset exists to prove ──────────────────────
const label = D.offeringLabel;
const byLabel = (l) => ds.offerings.filter((o) => label(o) === l);

const math = byLabel('MATH1110-01');
// >= 2, not === 2: the archived-year mirror gives it a third term, which is the same
// capability again rather than a violation.
check('MATH1110-01 exists in MORE THAN ONE term', new Set(math.map((o) => o.semester_id)).size >= 2,
  math.map((o) => `${o.id}@${o.semester_id}`).join(', '));
check('MATH1110-01 runs in BOTH terms of the active year',
  math.some((o) => o.semester_id === 'sem-2025-1') && math.some((o) => o.semester_id === 'sem-2025-2'));

const sem1Math = ds.offerings.filter(
  (o) => o.semester_id === 'sem-2025-1' && ds.courses.find((c) => c.id === o.course_id)?.code === 'MATH1110',
);
check('MATH1110 has 3 parallel sections in Semester 1', sem1Math.length === 3,
  sem1Math.map(label).sort().join(', '));

// ── Identity uniqueness: (course, semester, section_code), NULL counted ───────
const seen = new Map();
let dupes = 0;
for (const o of ds.offerings) {
  const key = `${o.course_id}|${o.semester_id}|${o.section_code ?? ''}`;
  if (seen.has(key)) dupes += 1;
  seen.set(key, o.id);
}
check('no duplicate (course, semester, section_code)', dupes === 0, `${dupes} duplicate(s)`);

// ── Referential integrity across the renamed FKs ──────────────────────────────
const offeringIds = new Set(ds.offerings.map((o) => o.id));
const courseIds = new Set(ds.courses.map((c) => c.id));
const semesterIds = new Set(ds.semesters.map((s) => s.id));

check('every offering.course_id resolves', ds.offerings.every((o) => courseIds.has(o.course_id)));
check('every offering.semester_id resolves', ds.offerings.every((o) => semesterIds.has(o.semester_id)));
check('every meeting.offering_id resolves', ds.offering_meetings.every((m) => offeringIds.has(m.offering_id)));
check('every enrollment.offering_id resolves', ds.enrollments.every((e) => offeringIds.has(e.offering_id)));
check('every assessment.offering_id resolves', ds.assessments.every((a) => offeringIds.has(a.offering_id)));
check('every category.offering_id resolves', ds.assessment_categories.every((c) => offeringIds.has(c.offering_id)));
check('every attendance.offering_id resolves', ds.attendance_records.every((a) => offeringIds.has(a.offering_id)));

// An enrollment's term MUST equal its offering's — the invariant the seed enforces by
// reading the term off the offering rather than taking it as an argument.
const termMismatch = ds.enrollments.filter((e) => {
  const o = ds.offerings.find((x) => x.id === e.offering_id);
  return o && o.semester_id !== e.semester_id;
});
check('enrollment.semester_id === its offering.semester_id', termMismatch.length === 0,
  `${termMismatch.length} mismatch(es)`);

const asmtTermMismatch = ds.assessments.filter((a) => {
  const o = ds.offerings.find((x) => x.id === a.offering_id);
  return o && o.semester_id !== a.semester_id;
});
check('assessment.semester_id === its offering.semester_id', asmtTermMismatch.length === 0,
  `${asmtTermMismatch.length} mismatch(es)`);

// ── The scenario the demo turns on ────────────────────────────────────────────
const freddy = ds.students.find((s) => s.id === 'stu-1');
const john = ds.students.find((s) => s.id === 'stu-2');
const loadOf = (id) =>
  D.currentOfferingsFor(id).map(label).sort();
const f = loadOf('stu-1');
const j = loadOf('stu-2');
// D34 renamed the vocabulary: 'active' is 'Registered' now. The two scenario students
// must stay live — the demo depends on their timetables and gradebooks rendering.
check('Freddy is stu-1 and Registered', freddy?.full_name === 'Freddy Lopez' && freddy.status === 'Registered');
check('John is stu-2 and Registered', john?.full_name === 'John Garcia' && john.status === 'Registered');
check('Freddy and John differ in exactly one course', (() => {
  const onlyF = f.filter((x) => !j.includes(x));
  const onlyJ = j.filter((x) => !f.includes(x));
  return onlyF.length >= 1 && onlyJ.length >= 1;
})(), `Freddy: ${f.join(', ')} | John: ${j.join(', ')}`);
check('they sit DIFFERENT Algebra sections',
  f.includes('MATH1110-01') && j.includes('MATH1110-02'));

// ── year_of_study is the enum, everywhere ────────────────────────────────────
const badYear = ds.students.filter((s) => s.year_of_study != null && !['First', 'Second'].includes(s.year_of_study));
check("every year_of_study is 'First' or 'Second'", badYear.length === 0,
  badYear.map((s) => `${s.id}=${s.year_of_study}`).join(', '));

// ── Nothing named after the retired model survives on a row ──────────────────
const banned = ['class_subject_id', 'section_id', 'grade_level', 'homeroom_label', 'year_group', 'numStudents'];
const offenders = new Set();
function scan(node, table) {
  if (Array.isArray(node)) { for (const v of node) scan(v, table); return; }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (banned.includes(k)) offenders.add(`${table}.${k}`);
      scan(node[k], table);
    }
  }
}
for (const [table, rows] of Object.entries(ds)) scan(rows, table);
check('no retired column name on any row', offenders.size === 0, [...offenders].join(', '));

// ── A gradebook and a term grade actually compute ─────────────────────────────
const gb = D.gradebookFor(math[0].id);
check('gradebook builds with a roster', gb.rows.length > 0, `${gb.rows.length} rows, ${gb.assessments.length} assessments`);
const withGrade = gb.rows.find((r) => r.term_numeric != null);
check('at least one term grade computes', Boolean(withGrade),
  withGrade ? `${withGrade.student.full_name}: ${withGrade.term_numeric} (${withGrade.term_letter})` : '');

fs.rmSync(out, { force: true });
console.log(fail.length === 0 ? '\nALL CHECKS PASSED' : `\n${fail.length} CHECK(S) FAILED`);
process.exit(fail.length === 0 ? 0 : 1);

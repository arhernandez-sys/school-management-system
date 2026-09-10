/**
 * Server-render the Dean dashboard and assert on the HTML it produces.
 *
 * **Why this exists.** `tsc` proves the types line up and says nothing about whether the
 * component runs: an undefined access on an optional field, a bad MUI prop, a `.map` over
 * something that is not an array, a `RouterLink` outside a router — all type-check
 * perfectly and all throw on first paint. The Dean dashboard reads seventeen optional-ish
 * fields off one payload, which is exactly the shape that breaks that way.
 *
 * It also checks the DEEP LINKS by looking for the real `href`s in the markup, which is
 * the only way to know a card actually links where it claims: a `to=` prop with a typo is
 * a valid string.
 *
 * esbuild's Node API bundles the TSX in-process (the binary runs in this repo — see
 * RUNBOOK §1's correction), and `react-dom/server` renders it with no browser involved.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.dean-render-${process.pid}.cjs`);

const ENTRY = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@shared/../theme/theme';
import { AdminDashboard } from '@features/dashboard/components/AdminDashboard';

export function render(data) {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        ThemeProvider,
        { theme },
        React.createElement(CssBaseline, null),
        React.createElement(AdminDashboard, { data }),
      ),
    ),
  );
}
`;

await build({
  stdin: { contents: ENTRY, resolveDir: path.join(FE, 'src'), loader: 'tsx' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/server', 'react-router-dom'],
  alias: {
    '@shared': path.join(FE, 'src/shared'),
    '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'),
    '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://sis.test/api/v1"' },
});

const require = createRequire(import.meta.url);
const { render } = require(out);

// MUI and react-router both call `useLayoutEffect`, which React warns about on the server
// once per component tree. The warning is expected here and its stack is 40 lines long,
// so it is swallowed — anything else React says still comes through.
const realError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  realError(...args);
};

let passes = 0;
let failures = 0;
function check(label, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** A payload with every field populated, shaped exactly like the server's. */
const FULL = {
  role: 'principal',
  user_full_name: 'Alicia Mendez',
  academic_year_name: '2025-2026',
  semester_name: 'Semester 1',
  stats: {
    active_students: 43,
    active_teachers: 11,
    total_sections: 12,
    attendance_rate: 92.9,
    unread_announcements: 2,
    new_students_term: 45,
    total_courses: 125,
    student_capacity: 212,
    new_applicants: 7,
    accepted_applicants: 3,
    active_programmes: 9,
    students_at_risk: 4,
    graduates: 1,
    outstanding_grade_submissions: 10,
    failure_rate: 10.1,
  },
  enrollment_by_programme: [
    { programme_id: 'p1', programme_code: 'BIOL', programme_name: 'Biology', count: 7 },
    { programme_id: 'p2', programme_code: 'ITEC', programme_name: 'Information Technology', count: 6 },
  ],
  grade_distribution: [
    { letter: 'A', count: 4 },
    { letter: 'F', count: 13 },
  ],
  enrollment_trend: [
    { period: 'S1 2024-25', count: 40 },
    { period: 'S1 2025-26', count: 43 },
  ],
  course_failure_rates: [
    { course_code: 'ITEC1104', course_name: 'Introduction to Computers', results: 22, failing: 4, failure_rate: 18.2 },
    { course_code: 'ENGL1102', course_name: 'College English 1', results: 30, failing: 4, failure_rate: 13.3 },
  ],
  recent_teachers: [
    { id: 't1', name: 'Alicia Cano', secondary: 'Mathematics', status: { label: 'Active', kind: 'success' } },
  ],
  recent_students: [
    { id: 's1', name: 'Freddy Lopez', secondary: 'First', status: { label: 'Active', kind: 'success' } },
  ],
  recent_announcements: [
    { id: 'a1', title: 'Registration closes Friday', body: 'Body.', audience: 'all', published_at: '2026-09-09T10:00:00Z', is_read: false },
  ],
};

console.log('='.repeat(78));
console.log('1. IT RENDERS');
console.log('='.repeat(78));
let html = '';
try {
  html = render(FULL);
  check('the Dean dashboard renders without throwing', html.length > 0, `${html.length} chars`);
} catch (e) {
  check('the Dean dashboard renders without throwing', false, String(e).slice(0, 400));
}

console.log();
console.log('='.repeat(78));
console.log('2. EVERY NUMBER IS ON THE PAGE');
console.log('='.repeat(78));
// Each KPI must actually appear. A tile that silently reads `undefined` renders as an
// empty box and type-checks fine.
const mustAppear = [
  ['active students', '43'],
  ['applicants waiting', '7'],
  ['accepted, not enrolled', '3'],
  ['students at risk', '4'],
  ['marking outstanding', '10'],
  ['graduates', '1'],
  ['failure rate', '10.1'],
  ['programmes', '9'],
  ['lecturers', '11'],
  ['courses (catalog)', '125'],
  ['attendance rate', '92.9'],
];
for (const [label, value] of mustAppear) {
  check(`${label} (${value}) appears in the markup`, html.includes(value));
}
check('no literal "undefined" reaches the page', !html.includes('undefined'));
check('no literal "NaN" reaches the page', !html.includes('NaN'));
check('"to date" qualifies the graduates figure', /to date/i.test(html));

console.log();
console.log('='.repeat(78));
console.log('3. THE DEEP LINKS ARE REAL HREFS');
console.log('='.repeat(78));
const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
console.log(`      ${links.length} links: ${[...new Set(links)].join('  ')}`);
const expected = [
  ['/attendance/alerts', 'students at risk → the alerts screen'],
  ['/attendance/summary', 'attendance rate → the summary screen'],
  ['/applications?status=submitted', 'applicants waiting → the submitted queue'],
  ['/applications?status=accepted', 'accepted → the accepted queue'],
  ['/students?status=Graduated', 'graduates → the graduated cohort'],
  ['/grades', 'marking outstanding → grades'],
  ['/students', 'total students → the register'],
  ['/courses', 'courses → the catalog'],
  ['/teachers', 'lecturers → the staff list'],
  ['/programs', 'programmes → the programme list'],
];
for (const [href, label] of expected) {
  check(label, links.some((l) => l === href || l === href.replace('?', '%3F')), href);
}
check(
  'every link is a real anchor (middle-click and ctrl-click work)',
  links.length >= expected.length,
  `${links.length} anchors`,
);
check('no link points at a route that does not exist', !links.some((l) => /\/(admissions|attention|kpi)\b/.test(l)));

console.log();
console.log('='.repeat(78));
console.log('4. THE DEGRADED PAYLOADS — the shapes that actually break a dashboard');
console.log('='.repeat(78));
const cases = {
  'all queues at zero (the all-clear)': {
    ...FULL,
    stats: { ...FULL.stats, new_applicants: 0, accepted_applicants: 0, students_at_risk: 0, outstanding_grade_submissions: 0 },
  },
  'the optional fields absent (an older server)': {
    ...FULL,
    stats: {
      active_students: 43, active_teachers: 11, total_sections: 12, attendance_rate: 92.9,
      unread_announcements: 0, new_applicants: 0, accepted_applicants: 0, active_programmes: 0,
      students_at_risk: 0, graduates: 0, outstanding_grade_submissions: 0, failure_rate: 0,
    },
    enrollment_trend: undefined,
    course_failure_rates: undefined,
    recent_teachers: undefined,
    recent_students: undefined,
  },
  'no failure-rate rows (a session with nothing graded)': { ...FULL, course_failure_rates: [] },
  'empty charts': { ...FULL, enrollment_by_programme: [], grade_distribution: [], enrollment_trend: [] },
  'zero capacity (no offering declares one)': { ...FULL, stats: { ...FULL.stats, student_capacity: 0 } },
  'the Auditor variant': { ...FULL, role: 'auditor' },
};
for (const [label, data] of Object.entries(cases)) {
  try {
    const out2 = render(data);
    check(label, out2.length > 0 && !out2.includes('undefined') && !out2.includes('NaN'));
  } catch (e) {
    check(label, false, String(e).slice(0, 300));
  }
}

// The all-clear must be a STATEMENT, not four green zeros.
try {
  const allClear = render(cases['all queues at zero (the all-clear)']);
  const zeros = (allClear.match(/>0</g) ?? []).length;
  console.log(`      the all-clear renders ${zeros} bare "0" values`);
  check('the all-clear does not render four separate zero tiles', zeros < 4, `${zeros} zeros`);
} catch {
  /* covered above */
}

console.log();
console.log('='.repeat(78));
console.log(`RESULT  ${passes} passed, ${failures} failed`);
console.log('='.repeat(78));
process.exit(failures ? 1 : 0);

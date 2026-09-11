/**
 * Render the Dean dashboard to a standalone HTML file and screenshot it with headless
 * Chrome, at desktop and phone widths.
 *
 * **Why.** The client's complaint was "so ugly" — a judgement about how it LOOKS, which
 * no typecheck, lint or DOM assertion can answer. This is the cheapest way to actually
 * look: emotion's cache exposes every style rule it inserted during a server render, so
 * the markup plus those rules is a faithful standalone page, and Chrome is already on
 * this machine.
 *
 * It is NOT a substitute for opening the real app — no hydration, no fonts beyond the
 * system stack, no interaction. It answers "does this read as a designed page" and
 * "does the 390px column hold", which are the two open questions.
 *
 * Usage: node scratchpad/shoot_dean.mjs [--empty]
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const SHOT_DIR = path.join(FE, 'scratchpad', 'shots');
mkdirSync(SHOT_DIR, { recursive: true });
const bundle = path.join(FE, 'scratchpad', `.dean-shot-${process.pid}.cjs`);
process.on('exit', () => {
  try {
    unlinkSync(bundle);
  } catch {
    /* already gone */
  }
});

const ENTRY = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@shared/../theme/theme';
import { AdminDashboard } from '@features/dashboard/components/AdminDashboard';

export function renderPage(data) {
  const cache = createCache({ key: 'sis', prepend: true });
  const html = renderToStaticMarkup(
    React.createElement(
      CacheProvider,
      { value: cache },
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
    ),
  );
  const css = Object.values(cache.inserted).filter((v) => typeof v === 'string').join('\\n');
  return { html, css };
}
`;

await build({
  stdin: { contents: ENTRY, resolveDir: path.join(FE, 'src'), loader: 'tsx' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
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
const realError = console.error;
console.error = (...a) => {
  if (typeof a[0] === 'string' && a[0].includes('useLayoutEffect does nothing')) return;
  realError(...a);
};
const { renderPage } = require(bundle);

const BUSY = {
  role: 'principal',
  user_full_name: 'Alicia Mendez',
  academic_year_name: '2025-2026',
  semester_name: 'Semester 1',
  stats: {
    active_students: 43, active_teachers: 11, total_sections: 12, attendance_rate: 92.9,
    unread_announcements: 2, new_students_term: 45, total_courses: 125, student_capacity: 212,
    new_applicants: 7, accepted_applicants: 3, active_programmes: 9, students_at_risk: 4,
    graduates: 1, outstanding_grade_submissions: 10, failure_rate: 10.1,
  },
  enrollment_by_programme: [
    { programme_id: '1', programme_code: 'BIOL', programme_name: 'Biology', count: 7 },
    { programme_id: '2', programme_code: 'ITEC', programme_name: 'Information Technology', count: 6 },
    { programme_id: '3', programme_code: 'BMAD', programme_name: 'Business Management', count: 6 },
    { programme_id: '4', programme_code: 'AGRI', programme_name: 'Applied Agriculture', count: 6 },
    { programme_id: '5', programme_code: 'GNST', programme_name: 'General Studies', count: 5 },
  ],
  grade_distribution: [
    { letter: 'A', count: 4 }, { letter: 'A-', count: 29 }, { letter: 'B+', count: 33 },
    { letter: 'B', count: 42 }, { letter: 'C+', count: 23 }, { letter: 'C', count: 12 },
    { letter: 'D', count: 3 }, { letter: 'F', count: 13 },
  ],
  enrollment_trend: [
    { period: 'S1 2023-24', count: 36 }, { period: 'S2 2023-24', count: 38 },
    { period: 'S1 2024-25', count: 40 }, { period: 'S2 2024-25', count: 41 },
    { period: 'S1 2025-26', count: 43 },
  ],
  course_failure_rates: [
    { course_code: 'ITEC1104', course_name: 'Introduction to Computers', results: 22, failing: 4, failure_rate: 18.2 },
    { course_code: 'ENGL1102', course_name: 'College English 1', results: 30, failing: 4, failure_rate: 13.3 },
    { course_code: 'SPAN2112', course_name: 'Intermediate Spanish', results: 8, failing: 1, failure_rate: 12.5 },
    { course_code: 'MATH1210', course_name: 'Pre-Calculus', results: 9, failing: 1, failure_rate: 11.1 },
    { course_code: 'BIOL1102', course_name: 'Foundations of Biology', results: 23, failing: 2, failure_rate: 8.7 },
    { course_code: 'MATH1110', course_name: 'Intermediate Algebra', results: 43, failing: 2, failure_rate: 4.7 },
  ],
  recent_teachers: [
    { id: 't1', name: 'Alicia Cano', secondary: 'Mathematics', status: { label: 'Active', kind: 'success' } },
    { id: 't2', name: 'Devon Flowers', secondary: 'Biology · Chemistry', status: { label: 'Active', kind: 'success' } },
    { id: 't3', name: 'Marlon Pou', secondary: 'General', status: { label: 'Active', kind: 'success' } },
  ],
  recent_students: [
    { id: 's1', name: 'Freddy Lopez', secondary: 'First', status: { label: 'Active', kind: 'success' } },
    { id: 's2', name: 'Alysha Ake', secondary: 'Second', status: { label: 'Active', kind: 'success' } },
    { id: 's3', name: 'Trevaughn Vasquez', secondary: 'First', status: { label: 'Active', kind: 'success' } },
  ],
  recent_announcements: [
    { id: 'a1', title: 'Registration closes Friday', body: 'All students must complete registration by 4pm.', audience: 'all', published_at: '2026-09-09T10:00:00Z', is_read: false },
    { id: 'a2', title: 'Staff meeting moved to Thursday', body: 'The weekly meeting moves to 3pm Thursday.', audience: 'teachers', published_at: '2026-09-08T14:00:00Z', is_read: true },
  ],
};

const CLEAR = {
  ...BUSY,
  stats: { ...BUSY.stats, new_applicants: 0, accepted_applicants: 0, students_at_risk: 0, outstanding_grade_submissions: 0 },
};

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

function shoot(name, data, width, height) {
  const { html, css } = renderPage(data);
  const page = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .page{padding:24px;max-width:${width}px;box-sizing:border-box;}
  ${css}
</style></head><body><div class="page">${html}</div></body></html>`;
  const file = path.join(SHOT_DIR, `${name}.html`);
  writeFileSync(file, page, 'utf8');
  const png = path.join(SHOT_DIR, `${name}.png`);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${png}`,
    `--virtual-time-budget=3000`,
    file,
  ], { stdio: 'pipe' });
  console.log(`  wrote ${png}`);
}

const which = process.argv.includes('--empty') ? 'empty' : 'all';
if (which === 'all' || which === 'empty') {
  shoot('dean-desktop', BUSY, 1440, 2600);
  shoot('dean-phone', BUSY, 390, 2400);
  shoot('dean-allclear', CLEAR, 1440, 1400);
}
console.log('done');

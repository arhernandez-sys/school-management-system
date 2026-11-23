/**
 * Render the Teacher dashboard (marking closing soonest overlap fix, 3 Nov 2026) to a standalone HTML file and screenshot it with headless
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
const bundle = path.join(FE, 'scratchpad', `.teacher-shot-${process.pid}.cjs`);
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
import { TeacherDashboard } from '@features/dashboard/components/TeacherDashboard';

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
          React.createElement(TeacherDashboard, { data }),
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

const off = (label, name) => ({ id: label, label, course: { id: label, code: label.split('-')[0], name } });
const DATA = {
  role: 'teacher', user_full_name: 'Devon Flowers', academic_year_name: '2025-2026', semester_name: 'Semester 1',
  stats: { my_offerings: 4, attendance_due_today: 2, ungraded_items: 4 },
  today_classes: [
    { offering: off('BIOL1102-01', 'Foundations of Biology and the Living Environment of Belize'), attendance_recorded: false },
    { offering: off('CHEM1101-02', 'General Chemistry'), attendance_recorded: true },
  ],
  recent_assessments: [
    { id: 'a1', title: 'Midterm Examination - Cellular Respiration and Photosynthesis Practical', offering: off('BIOL1102-01', 'Foundations of Biology and the Living Environment of Belize'), offering_id: 'o1', assessment_date: '2026-10-30', marking_closes_at: '2026-11-04T05:59:00', days_left: 1 },
    { id: 'a2', title: 'Lab Report 3', offering: off('CHEM1101-02', 'General Chemistry'), offering_id: 'o2', assessment_date: '2026-10-31', marking_closes_at: '2026-11-06T05:59:00', days_left: 3 },
    { id: 'a3', title: 'Quiz 4', offering: off('CHEM1101-02', 'General Chemistry'), offering_id: 'o2', assessment_date: '2026-11-02', marking_closes_at: '2026-11-07T05:59:00', days_left: 0 },
  ],
  recent_announcements: [],
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

shoot('teacher-desktop', DATA, 1440, 1300);
shoot('teacher-tablet', DATA, 900, 1500);
shoot('teacher-phone', DATA, 390, 2200);
console.log('done');

/**
 * Render the offering's Grading tab (assessment categories + weights) to HTML and
 * screenshot it with headless Chrome — same technique as `shoot_dean.mjs`. The category
 * list is pre-seeded into the React Query cache, so the tab renders its loaded state.
 *
 * Usage: node scratchpad/shoot_grading_tab.mjs
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const SHOT_DIR = path.join(FE, 'scratchpad', 'shots');
mkdirSync(SHOT_DIR, { recursive: true });
const bundle = path.join(FE, 'scratchpad', `.grading-shot-${process.pid}.cjs`);
process.on('exit', () => {
  try {
    unlinkSync(bundle);
  } catch {
    /* gone */
  }
});

const ENTRY = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import theme from '@shared/../theme/theme';
import { GradingTab } from '@features/offerings/components/GradingTab';
import { assessmentKeys } from '@features/assessments/hooks/useAssessments';

export function renderPage(data, canEdit) {
  const qc = new QueryClient();
  qc.setQueryData([...assessmentKeys.categories('off-1'), 'full'], data);
  const cache = createCache({ key: 'sis', prepend: true });
  const html = renderToStaticMarkup(
    React.createElement(CacheProvider, { value: cache },
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(ThemeProvider, { theme },
          React.createElement(CssBaseline, null),
          React.createElement(GradingTab, { offeringId: 'off-1', offeringLabel: 'MATH1110-01 · Semester 1', canEdit }),
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
  external: ['react', 'react-dom', 'react-dom/server', '@tanstack/react-query'],
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

const cat = (id, name, weight, drop = 0) => ({ id, offering_id: 'off-1', name, weight, drop_lowest_count: drop });
const COMPLETE = {
  items: [cat('1', 'Assignments', 20), cat('2', 'Final', 30), cat('3', 'Midterm', 25), cat('4', 'Participation', 10), cat('5', 'Quizzes', 15, 1)],
  weight_total: 100, weight_total_ok: true, uncategorized_assessment_count: 0,
};
const PARTIAL = {
  items: [cat('1', 'Assignments', 20), cat('3', 'Midterm', 25), cat('5', 'Quizzes', 15, 1)],
  weight_total: 60, weight_total_ok: false, uncategorized_assessment_count: 2,
};
const EMPTY = { items: [], weight_total: 0, weight_total_ok: false, uncategorized_assessment_count: 0 };

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
function shoot(name, data, canEdit, width, height) {
  const { html, css } = renderPage(data, canEdit);
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .page{padding:24px;max-width:${width}px;box-sizing:border-box;}
  ${css}</style></head><body><div class="page">${html}</div></body></html>`;
  const file = path.join(SHOT_DIR, `${name}.html`);
  writeFileSync(file, page, 'utf8');
  const png = path.join(SHOT_DIR, `${name}.png`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${width},${height}`, `--screenshot=${png}`, '--virtual-time-budget=3000', file], { stdio: 'pipe' });
  console.log(`  wrote ${png}`);
}

shoot('grading-complete', COMPLETE, true, 1100, 520);
shoot('grading-partial', PARTIAL, true, 1100, 460);
shoot('grading-empty-readonly', EMPTY, false, 1100, 320);
shoot('grading-partial-phone', PARTIAL, true, 390, 700);
console.log('done');

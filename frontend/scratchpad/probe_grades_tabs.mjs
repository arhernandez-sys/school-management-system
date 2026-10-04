/**
 * Render the real GradesPage for each role at each URL and assert what the user sees.
 * A green tsc says nothing about whether the "Grade Revision" tab appears, whether it
 * is hidden from the Registrar, or which screen a URL resolves to.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.grades-probe-${process.pid}.cjs`);

await build({
  stdin: {
    contents: `
      export { GradesPage } from '@features/grades/index';
      export { __setRole } from './scratchpad/stubs/useAuth';
      export { MemoryRouter, Routes, Route } from 'react-router-dom';
      export { renderToStaticMarkup } from 'react-dom/server';
      export { default as React } from 'react';
    `,
    resolveDir: FE,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
  jsx: 'automatic',
  plugins: [
    {
      // The four screens are imported RELATIVELY by index.tsx, so an alias never fires.
      // Redirect them by resolved path: this probe is about the CONTAINER, and the real
      // screens would need the whole provider tree.
      name: 'stub-screens',
      setup(b) {
        b.onResolve({ filter: /(GradeAssessmentsScreen|AssessmentGradingScreen|MyGradesScreen|GradeRevisionsScreen)$/ },
          () => ({ path: path.join(FE, 'scratchpad/stubs/screens.tsx') }));
      },
    },
  ],
  alias: {
    '@features/auth/hooks/useAuth': path.join(FE, 'scratchpad/stubs/useAuth.tsx'),
    '@shared': path.join(FE, 'src/shared'),
    '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'),
    '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_API_BASE_URL': '"/api/v1"' },
});

const require = createRequire(import.meta.url);
const m = require(out);
const { GradesPage, __setRole, MemoryRouter, Routes, Route, renderToStaticMarkup, React } = m;

const fails = [];
function check(label, cond, detail) {
  if (!cond) fails.push(label);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function render(role, url) {
  __setRole(role);
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [url] },
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/grades/*', element: React.createElement(GradesPage) }))),
  );
  const screen = (html.match(/data-screen="([^"]+)"/) || [])[1] ?? null;
  const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((x) => x[1].trim()).filter(Boolean);
  const selected = (html.match(/aria-selected="true"[^>]*>([^<]*)</) || [])[1]?.trim() ?? null;
  return { screen, tabs, selected, html };
}

for (const [role, url, expTabs, expScreen] of [
  ['principal', '/grades',            ['Gradebook', 'Grade Revision'], 'GradeAssessmentsScreen'],
  ['principal', '/grades/revisions',  ['Gradebook', 'Grade Revision'], 'GradeRevisionsScreen'],
  ['teacher',   '/grades',            ['Gradebook', 'Grade Revision'], 'GradeAssessmentsScreen'],
  ['teacher',   '/grades/revisions',  ['Gradebook', 'Grade Revision'], 'GradeRevisionsScreen'],
  ['secretary', '/grades',            [],                              'GradeAssessmentsScreen'],
  // A <Navigate> renders nothing on a static pass (its effect needs a DOM), so the
  // assertion here is the one that matters: the revisions screen must NOT appear.
  ['secretary', '/grades/revisions',  [],                              null],
  ['student',   '/grades',            [],                              'MyGradesScreen'],
  ['student',   '/grades/revisions',  [],                              null],
  ['principal', '/grades/assessment/a1', ['Gradebook', 'Grade Revision'], 'AssessmentGradingScreen'],
]) {
  const r = render(role, url);
  check(`${role.padEnd(9)} ${url.padEnd(24)} tabs=${JSON.stringify(r.tabs)}`,
        JSON.stringify(r.tabs) === JSON.stringify(expTabs));
  check(`${role.padEnd(9)} ${url.padEnd(24)} screen=${r.screen}`, r.screen === expScreen,
        r.screen === expScreen ? (expScreen === null ? 'redirects (no screen rendered)' : '') : `expected ${expScreen}`);
}

// The drill-down must not highlight a tab; the two tab URLs must highlight their own.
check('/grades highlights Gradebook', render('principal', '/grades').selected === 'Gradebook');
check('/grades/revisions highlights Grade Revision', render('principal', '/grades/revisions').selected === 'Grade Revision');
check('/grades/assessment/a1 highlights nothing', render('principal', '/grades/assessment/a1').selected === null);

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exitCode = fails.length ? 1 : 0;

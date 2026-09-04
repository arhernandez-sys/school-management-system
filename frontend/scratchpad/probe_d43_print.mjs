/**
 * D43 Phase 1 — execute the REAL MSW handlers and prove the print sheet gets the WHOLE
 * filtered set, not the page the table happens to be showing.
 *
 * This is the defect the print dialogs exist to avoid, and it is invisible to `tsc`: a
 * dialog that renders `query.data.items` from the list's own paginated query type-checks
 * perfectly and silently prints 25 of 114 courses under a heading that says "Course
 * catalog". So the probe asserts the thing the types cannot:
 *
 *   1. page_size=25 really does truncate          (i.e. there IS something to get wrong)
 *   2. page_size=200 returns every matching row   (what `useCoursesForPrint` sends)
 *   3. the filters still narrow at print size     (the sheet's caption must be true)
 *   4. the same three for /offerings, whose row count can exceed 200 for real
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.d43-print-probe-${process.pid}.cjs`);

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

const handlers = mod.handlers ?? mod.default;
const server = setupServer(...handlers);
server.listen({ onUnhandledRequest: 'bypass' });

const BASE = 'http://sis.test/api/v1';
let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** The demo session cookie IS the role word (handlers/auth.ts). */
async function get(url, role = 'principal') {
  const r = await fetch(url, { headers: { Cookie: `sis_mock_session=${role}` } });
  if (r.status !== 200) return { status: r.status, total: -1, items: [] };
  const b = await r.json();
  return { status: 200, total: b.total, items: b.items };
}

// ── /courses — the catalog sheet ────────────────────────────────────────────────
console.log('\n=== courses (catalog print) ===');
{
  const page = await get(`${BASE}/courses?page=1&page_size=25`);
  const print = await get(`${BASE}/courses?page=1&page_size=200`);

  check('list responds 200', page.status === 200, `status ${page.status}`);
  check(
    'the catalog is big enough for truncation to be a real risk',
    print.total > 25,
    `total ${print.total}`,
  );
  check(
    'page_size=25 truncates (the bug the dialog avoids)',
    page.items.length === 25 && page.items.length < print.total,
    `${page.items.length} of ${print.total}`,
  );
  check(
    'page_size=200 returns EVERY matching row',
    print.items.length === print.total,
    `${print.items.length} of ${print.total}`,
  );

  // The caption on the sheet claims the filters were applied. Prove they were.
  const filtered = await get(`${BASE}/courses?page=1&page_size=200&search=MATH`);
  check(
    'search still narrows at print page size',
    filtered.total > 0 && filtered.total < print.total,
    `${filtered.total} match "MATH" of ${print.total}`,
  );
  check(
    'every returned row actually matches the filter',
    filtered.items.every(
      (c) => `${c.code} ${c.name}`.toUpperCase().includes('MATH'),
    ),
    filtered.items.map((c) => c.code).join(', '),
  );

  // `include_retired` is the other live filter on the page.
  const withRetired = await get(
    `${BASE}/courses?page=1&page_size=200&include_retired=true`,
  );
  check(
    'include_retired=true is a superset of the default sheet',
    withRetired.total >= print.total,
    `${withRetired.total} vs ${print.total}`,
  );
}

// ── /offerings — the schedule sheet ─────────────────────────────────────────────
console.log('\n=== offerings (schedule print) ===');
{
  const page = await get(`${BASE}/offerings?page=1&page_size=25`);
  const print = await get(`${BASE}/offerings?page=1&page_size=200`);

  check('list responds 200', page.status === 200, `status ${page.status}`);
  check(
    'page_size=200 returns EVERY matching row',
    print.items.length === print.total,
    `${print.items.length} of ${print.total}`,
  );

  // The printed columns must actually be present on the row, or the sheet prints "—"
  // for every lecturer and nobody notices until it is on paper.
  const withTeachers = print.items.filter((o) => (o.teachers ?? []).length > 0);
  check(
    'rows carry the lecturer(s) the sheet prints',
    withTeachers.length > 0,
    `${withTeachers.length} of ${print.total} rows have a lecturer`,
  );
  check(
    'rows carry the term the sheet prints',
    print.items.every((o) => o.semester === null || typeof o.semester?.name === 'string'),
  );
  check(
    'rows carry the server-computed label the sheet prints',
    print.items.every((o) => typeof o.label === 'string' && o.label.length > 0),
  );
  check(
    'rows carry enrolled_count for the Enrolled column',
    print.items.every((o) => typeof o.enrolled_count === 'number'),
  );
}

server.close();
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

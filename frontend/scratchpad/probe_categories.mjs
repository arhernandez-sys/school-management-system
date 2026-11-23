/**
 * Execute the REAL MSW `/offerings/{id}/categories` handlers through msw/node, as each
 * role, and check they agree with `backend/app/modules/assessments/service.py`:
 * Dean + owning lecturer write, Registrar 403, non-owning lecturer 404, the 100% verdict,
 * case-insensitive duplicate 409, and delete DETACHES rather than refusing.
 *
 * Usage: node scratchpad/probe_categories.mjs
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { unlinkSync } from 'node:fs';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.categories-probe-${process.pid}.cjs`);
process.on('exit', () => {
  try {
    unlinkSync(out);
  } catch {
    /* gone */
  }
});

await build({
  stdin: {
    contents: `
      export { offeringsHandlers } from '@shared/api/mocks/handlers/offerings';
      export { DEMO_DATASET, currentDemoTeacher, offeringsOwnedByTeacher } from '@shared/api/mocks/demo/dataset';
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
const { offeringsHandlers, DEMO_DATASET: D, currentDemoTeacher, offeringsOwnedByTeacher } =
  require(out);
const { setupServer } = require('msw/node');
const server = setupServer(...offeringsHandlers);
server.listen({ onUnhandledRequest: 'error' });

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function call(role, method, p, body) {
  const r = await fetch(`http://sis.test/api/v1${p}`, {
    method,
    headers: { cookie: `sis_mock_session=${role}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

const teacher = currentDemoTeacher('teacher');
const owned = offeringsOwnedByTeacher(teacher.id);
const mine = owned[0];
const notMine = D.offerings.find((o) => !o.teacher_ids.includes(teacher.id) && !o.is_archived);
const base = `/offerings/${mine.id}/categories`;
console.log(`lecturer ${teacher.full_name ?? teacher.id}; own offering ${mine.id}; other ${notMine.id}\n`);

// Start from a clean slate on the owned offering.
for (const c of D.assessment_categories.filter((c) => c.offering_id === mine.id)) {
  await call('principal', 'DELETE', `${base}/${c.id}`);
}

let r = await call('teacher', 'GET', base);
check('empty list: verdict false', r.status === 200 && r.body.weight_total_ok === false, JSON.stringify(r.body));

r = await call('secretary', 'POST', base, { name: 'X', weight: 10 });
check('Registrar cannot create → 403', r.status === 403, String(r.status));

r = await call('teacher', 'POST', `/offerings/${notMine.id}/categories`, { name: 'X', weight: 10 });
check('lecturer on an offering they do not teach → 404', r.status === 404, String(r.status));

const scheme = [['Assignments', 20], ['Quizzes', 15], ['Midterm', 25], ['Final', 30]];
for (const [name, weight] of scheme) {
  r = await call('teacher', 'POST', base, { name, weight });
  check(`lecturer creates ${name} ${weight}`, r.status === 201, String(r.status));
}
r = await call('principal', 'POST', base, { name: 'Participation', weight: 10 });
check('Dean creates Participation 10', r.status === 201, String(r.status));
const partId = r.body.id;

r = await call('teacher', 'POST', base, { name: 'quizzes', weight: 5 });
check('duplicate name (case-insensitive) → 409', r.status === 409 && r.body.error?.code === 'duplicate_category_name', JSON.stringify(r.body));

r = await call('auditor', 'GET', base);
const uncategorized = r.body.uncategorized_assessment_count;
check('total is exactly 100', r.body.weight_total === 100, String(r.body.weight_total));
check(
  'verdict ok iff no uncategorized assessments',
  r.body.weight_total_ok === (uncategorized === 0),
  `ok=${r.body.weight_total_ok} uncategorized=${uncategorized}`,
);
check('sorted by name', r.body.items.map((c) => c.name).join(',') === 'Assignments,Final,Midterm,Participation,Quizzes');

r = await call('principal', 'PATCH', `${base}/${partId}`, { weight: 12.5 });
check('Dean edits weight', r.status === 200 && r.body.weight === 12.5, JSON.stringify(r.body));
r = await call('teacher', 'GET', base);
check('total now 102.5, verdict false', r.body.weight_total === 102.5 && r.body.weight_total_ok === false, String(r.body.weight_total));

// Delete a category that has an assessment in it: the server detaches, it does not refuse.
const asmt = D.assessments.find((a) => a.offering_id === mine.id);
if (asmt) {
  asmt.category_id = partId;
  r = await call('teacher', 'DELETE', `${base}/${partId}`);
  check('delete in-use category → 204 (detach)', r.status === 204, String(r.status));
  check('its assessment survives, uncategorized', asmt.category_id === null && D.assessments.includes(asmt));
} else {
  console.log('SKIP  no assessment on this offering to test detach');
}

r = await call('teacher', 'GET', `/offerings/${notMine.id}`);
check('detail: lecturer reading another lecturer’s offering → 404', r.status === 404, String(r.status));
r = await call('teacher', 'GET', `/offerings/${notMine.id}/categories`);
check('grading scheme: lecturer reading another lecturer’s → 404', r.status === 404, String(r.status));
r = await call('principal', 'GET', `/offerings/${notMine.id}/categories`);
check('grading scheme: Dean reads any → 200', r.status === 200, String(r.status));
r = await call('teacher', 'GET', `/offerings/${mine.id}`);
check('detail: lecturer actionable on own offering', r.body.actionable_by_caller === true);

server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

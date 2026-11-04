/**
 * Types were retired and the column dropped (16 Oct 2026). Execute the real MSW assessment
 * handlers: no `type` comes back, and a stale client that SENDS one gets a 422.
 *
 * Usage: node scratchpad/probe_no_assessment_type.mjs
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { unlinkSync } from 'node:fs';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.notype-probe-${process.pid}.cjs`);
process.on('exit', () => { try { unlinkSync(out); } catch { /* gone */ } });
await build({
  stdin: {
    contents: `export { assessmentsHandlers } from '@shared/api/mocks/handlers/assessments';
               export { DEMO_DATASET, currentDemoTeacher, offeringsOwnedByTeacher } from '@shared/api/mocks/demo/dataset';`,
    resolveDir: FE, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
  external: ['msw', 'msw/node'],
  alias: {
    '@shared': path.join(FE, 'src/shared'), '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'), '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://sis.test/api/v1"' },
});
const require = createRequire(import.meta.url);
const m = require(out);
const { setupServer } = require('msw/node');
const server = setupServer(...m.assessmentsHandlers);
server.listen({ onUnhandledRequest: 'error' });
let failures = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? `  — ${x}` : ''}`); if (!c) failures++; };
const call = async (method, p, body) => {
  const r = await fetch(`http://sis.test/api/v1${p}`, { method,
    headers: { cookie: 'sis_mock_session=teacher', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
};
const mine = m.offeringsOwnedByTeacher(m.currentDemoTeacher('teacher').id)[0];
let r = await call('POST', '/assessments', { offering_id: mine.id, title: 'No type', max_score: 10, weight: 2, assessment_date: '2026-10-20' });
check('create without type → 201', r.status === 201, String(r.status) + ' ' + JSON.stringify(r.body?.error ?? ''));
check('no type in the response', r.body && !('type' in r.body), String(r.body?.type));
check('weight 2 kept', r.body?.weight === 2, String(r.body?.weight));
const id = r.body?.id;
r = await call('POST', '/assessments', { offering_id: mine.id, title: 'Stale', type: 'quiz', max_score: 10 });
check('a sent type → 422', r.status === 422, String(r.status));
r = await call('PATCH', `/assessments/${id}`, { title: 'Renamed', weight: 3 });
check('edit → 200, weight saved, still no type', r.status === 200 && !('type' in r.body) && r.body.weight === 3, JSON.stringify(r.body).slice(0, 120));
server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

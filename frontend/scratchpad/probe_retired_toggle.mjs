/**
 * D39 — execute the REAL MSW `GET /programs` and `GET /courses` handlers and prove the
 * "Show retired" switch has something to do.
 *
 * Static checks cannot see any of this. The handlers type-checked perfectly while the
 * switch was inert: it dropped `is_active`, and dropping it is exactly what re-applies
 * the active-only default, so the same list came back and the control looked broken.
 *
 * Three questions, in the order the screen asks them:
 *   1. the DEFAULT list hides retired rows                (the picker's contract)
 *   2. `include_retired=true` returns BOTH                (what the switch now sends)
 *   3. `is_active=false` returns RETIRED ONLY             (the probe that decides
 *                                                          whether the switch renders)
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.retired-probe-${process.pid}.cjs`);

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

async function get(url) {
  const r = await fetch(url, { headers: { Cookie: 'sessionRole=principal' } });
  if (r.status !== 200) return { status: r.status, total: -1, codes: [] };
  const b = await r.json();
  return { status: 200, total: b.total, codes: b.items.map((i) => i.code) };
}

for (const resource of ['programs', 'courses']) {
  console.log(`\n=== ${resource} ===`);
  const all = await get(`${BASE}/${resource}?page=1&page_size=200&include_retired=true`);
  if (all.total < 2) {
    check(`${resource}: enough rows to test`, false, `only ${all.total}`);
    continue;
  }

  // Retire one through the real PATCH handler, so the state change is the app's own.
  const victim = all.codes[0];
  const listForId = await fetch(
    `${BASE}/${resource}?page=1&page_size=200&include_retired=true`,
    { headers: { Cookie: 'sessionRole=principal' } },
  ).then((r) => r.json());
  const row = listForId.items.find((i) => i.code === victim);

  const patched = await fetch(`${BASE}/${resource}/${row.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: 'sessionRole=principal' },
    body: JSON.stringify({ is_active: false }),
  });
  check(`${resource}: retire ${victim} via PATCH`, patched.status === 200, `status=${patched.status}`);

  const dflt = await get(`${BASE}/${resource}?page=1&page_size=200`);
  const both = await get(`${BASE}/${resource}?page=1&page_size=200&include_retired=true`);
  const only = await get(`${BASE}/${resource}?page=1&page_size=200&is_active=false`);

  check(
    `${resource}: DEFAULT hides the retired row`,
    !dflt.codes.includes(victim),
    `${dflt.total} shown`,
  );
  check(
    `${resource}: include_retired=true returns BOTH`,
    both.codes.includes(victim) && both.total === dflt.total + 1,
    `${both.total} total vs ${dflt.total} active`,
  );
  check(
    `${resource}: is_active=false is RETIRED ONLY (the switch's probe)`,
    only.total === 1 && only.codes[0] === victim,
    `total=${only.total}`,
  );

  // Restore, and prove the probe then reports nothing retired — which is what hides
  // the switch. This is the state the live database is actually in.
  await fetch(`${BASE}/${resource}/${row.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: 'sessionRole=principal' },
    body: JSON.stringify({ is_active: true }),
  });
  const none = await get(`${BASE}/${resource}?page=1&page_size=1&is_active=false`);
  check(
    `${resource}: with nothing retired the probe reports 0 — the switch stays hidden`,
    none.total === 0,
    `total=${none.total}`,
  );
}

server.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

/**
 * MSW ROUTE PARITY — every mock route must exist in the real contract, and every real
 * route should have a mock.
 *
 * Why this exists: `onUnhandledRequest: 'bypass'` means a request the handlers do not match
 * falls through to the NETWORK and fails silently in demo mode. A handler left on a retired
 * path (`/classes/...`) is therefore invisible — the screen just shows nothing — and so is a
 * real endpoint nobody mocked. Neither `tsc` nor `eslint` can see either case, which is why
 * D31 needed a check that reads both sides.
 *
 * Run:  node scratchpad/check_msw_routes.mjs
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FE = path.resolve(import.meta.dirname, '..');
const SPEC = path.join(FE, 'openapi.json');
const PREFIX = '/api/v1';

// ── 1. The real contract ──────────────────────────────────────────────────────
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const real = new Set();
for (const [p, item] of Object.entries(spec.paths)) {
  const stripped = p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p;
  for (const m of METHODS) if (m in item) real.add(`${m.toUpperCase()} ${normalize(stripped)}`);
}

/** Collapse both `{param}` and `:param` to `{}` so the two spellings compare. */
function normalize(p) {
  return p.replace(/\{[^}]+\}/g, '{}').replace(/:[A-Za-z0-9_]+/g, '{}');
}

// ── 2. The mock handlers ──────────────────────────────────────────────────────
const out = path.join(os.tmpdir(), `sis-msw-routes-${process.pid}.cjs`);
await build({
  entryPoints: [path.join(FE, 'src/shared/api/mocks/handlers/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
  alias: {
    '@shared': path.join(FE, 'src/shared'),
    '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'),
    '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'import.meta.env.VITE_API_BASE_URL': `"${PREFIX}"` },
});
const require = createRequire(import.meta.url);
const { handlers } = require(out);
fs.rmSync(out, { force: true });

const mocked = new Set();
for (const h of handlers) {
  const { method, path: p } = h.info;
  const rel = String(p).startsWith(PREFIX) ? String(p).slice(PREFIX.length) : String(p);
  mocked.add(`${String(method).toUpperCase()} ${normalize(rel)}`);
}

// ── 3. Compare ────────────────────────────────────────────────────────────────
// Demo-only helpers with no server counterpart. Each is listed deliberately: a mock route
// that is NOT in the contract is normally a bug (it would 404 against the real backend).
const DEMO_ONLY = new Set([
  'POST /auth/mock-login', // the demo's role switcher
  // D43 — the auditor read-only guard. An `http.all('*')` that sits in FRONT of every
  // handler and returns `undefined` (fall through) for anyone who is not an auditor, so
  // it is a cross-cutting filter rather than a route. It is the demo's mirror of the
  // server's central `get_current_user` refusal, and by design it matches no single path.
  '/.+/ *',
]);

const ghosts = [...mocked].filter((r) => !real.has(r) && !DEMO_ONLY.has(r)).sort();
const unmocked = [...real].filter((r) => !mocked.has(r)).sort();

console.log(`contract routes: ${real.size}   mock routes: ${mocked.size}`);

console.log(`\n── mock routes NOT in the contract (${ghosts.length}) ──`);
for (const r of ghosts) console.log('  GHOST   ' + r);

console.log(`\n── contract routes with NO mock (${unmocked.length}) ──`);
for (const r of unmocked) console.log('  UNMOCKED ' + r);

// A ghost is always a defect: it is a handler that can never match the real API, and in
// demo mode it silently shadows nothing. Unmocked routes are reported but not fatal — some
// are legitimately out of the demo's scope.
if (ghosts.length > 0) {
  console.log(`\nFAILED: ${ghosts.length} handler(s) on a route the API does not have.`);
  process.exit(1);
}
console.log('\nOK: every mock route exists in the contract.');

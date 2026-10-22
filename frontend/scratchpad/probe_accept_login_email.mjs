/**
 * The login-email rule, executed against the REAL demo handlers.
 *
 * ⚠️ WHY: the demo layer is a second implementation of the whole API, and it has
 * disagreed with the server five recorded times in this project. `tsc` cannot see any of
 * it. The rule changed on 11 Sep 2026 — the email moved OFF the application (where it was
 * listed as *"Outstanding before this can be accepted"*, i.e. a debt the applicant owed)
 * and ONTO the accept action, where the college types the address it is issuing. Three
 * things therefore have to hold demo-side, and none of them are type-checkable:
 *
 *   1. Neither `form_issues` nor `blocking_issues` mentions an email any more.
 *   2. An accept with no `login_email` is a 422 `login_email_required`, reported on the
 *      FIELD rather than under the old `application` key.
 *   3. The applicant's own address is never borrowed as a fallback — the defect the
 *      removal of `|| row.email` was meant to close.
 *
 * Plus the ordering the server has: a decided application is refused on STATUS before the
 * login rule is reached, so an empty body still yields 409 and not 422.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { unlinkSync } from 'node:fs';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.accept-probe-${process.pid}.cjs`);

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
// Deleted the moment it is loaded: six of these bundles were committed by accident on
// 10 Sep 2026 because the probes left them behind.
process.on('exit', () => { try { unlinkSync(out); } catch { /* already gone */ } });
const mod = require(out);
const { setupServer } = require('msw/node');

const server = setupServer(...(mod.handlers ?? mod.default));
server.listen({ onUnhandledRequest: 'bypass' });

const BASE = 'http://sis.test/api/v1';
let failures = 0;
let passes = 0;

function check(label, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, url, role, body) {
  const r = await fetch(url, {
    method,
    headers: {
      Cookie: `sis_mock_session=${role}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* empty body */
  }
  return { status: r.status, body: json };
}

const bar = '='.repeat(78);

// ── find an application in each state the demo dataset offers ────────────────
const list = await req('GET', `${BASE}/applications?page_size=200`, 'secretary');
check('GET /applications answers 200', list.status === 200, JSON.stringify(list.body).slice(0, 140));
const items = list.body?.items ?? [];
const byStatus = new Map();
for (const a of items) if (!byStatus.has(a.status)) byStatus.set(a.status, a.id);
console.log(`      statuses present: ${[...byStatus.keys()].join(', ')}`);

const acceptable = byStatus.get('submitted') ?? byStatus.get('under_review') ?? byStatus.get('eligible');
check('the dataset offers an acceptable application', Boolean(acceptable), [...byStatus.keys()].join(','));

console.log();
console.log(bar);
console.log('1. THE EMAIL IS OFF BOTH ISSUE LISTS');
console.log(bar);
for (const [status, id] of byStatus) {
  const d = await req('GET', `${BASE}/applications/${id}`, 'secretary');
  if (d.status !== 200) {
    check(`${status}: detail reads back`, false, String(d.status));
    continue;
  }
  for (const field of ['form_issues', 'blocking_issues']) {
    const issues = d.body?.[field] ?? [];
    check(
      `${status}.${field} says nothing about an email`,
      !issues.some((i) => String(i).toLowerCase().includes('email address is required')),
      JSON.stringify(issues),
    );
  }
  check(`${status}: both fields are present on the wire`,
    Array.isArray(d.body?.form_issues) && Array.isArray(d.body?.blocking_issues),
    `form=${typeof d.body?.form_issues} blocking=${typeof d.body?.blocking_issues}`);
}

console.log();
console.log(bar);
console.log('2. AN ACCEPT WITHOUT A LOGIN EMAIL IS A FIELD ERROR');
console.log(bar);
if (acceptable) {
  const r = await req('POST', `${BASE}/applications/${acceptable}/accept`, 'secretary', {});
  check('422, not 201', r.status === 422, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const err = r.body?.error ?? {};
  check('code is login_email_required', err.code === 'login_email_required', String(err.code));
  check('reported on the login_email FIELD',
    Array.isArray(err.fields?.login_email) && err.fields.login_email.length > 0,
    JSON.stringify(err.fields));
  check('NOT smuggled back under the old `application` key',
    !('application' in (err.fields ?? {})),
    JSON.stringify(err.fields));
  check('the message names who provides the address',
    String(err.message ?? '').toLowerCase().includes('college'),
    String(err.message));
}

console.log();
console.log(bar);
console.log("3. THE APPLICANT'S OWN ADDRESS IS NEVER BORROWED");
console.log(bar);
if (acceptable) {
  const before = await req('GET', `${BASE}/applications/${acceptable}`, 'secretary');
  const personal = before.body?.email ?? null;
  console.log(`      the form carries: ${personal ?? '(none)'}`);
  // An empty body was previously enough BECAUSE the personal address filled in. It is
  // now a 422 whether or not the form has one — asserted above — which is the proof.
  const issued = `issued.${Date.now()}@bajc.edu.bz`;
  const ok = await req('POST', `${BASE}/applications/${acceptable}/accept`, 'secretary', {
    login_email: issued,
  });
  check('accepting WITH an issued address succeeds', ok.status === 201,
    `${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
  check('the response echoes the issued address, not the personal one',
    ok.body?.login_email === issued, `${ok.body?.login_email} vs personal ${personal}`);
  if (personal) {
    check('...and they are genuinely different', ok.body?.login_email !== personal,
      String(ok.body?.login_email));
  }

  console.log();
  console.log(bar);
  console.log('4. ORDERING — status is checked BEFORE the login rule');
  console.log(bar);
  // The same application is now accepted. An empty body must still give 409, not 422:
  // supplying better inputs does not reopen a decided application.
  const again = await req('POST', `${BASE}/applications/${acceptable}/accept`, 'secretary', {});
  check('a second accept with an empty body is 409, not 422', again.status === 409,
    `${again.status} ${JSON.stringify(again.body).slice(0, 160)}`);
  check('...and the code is application_accepted',
    again.body?.error?.code === 'application_accepted', String(again.body?.error?.code));
}

console.log();
console.log(bar);
console.log(`RESULT  ${passes} passed, ${failures} failed`);
console.log(bar);
server.close();
process.exit(failures ? 1 : 0);

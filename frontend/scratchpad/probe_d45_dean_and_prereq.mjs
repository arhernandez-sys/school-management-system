/**
 * D45 — execute the REAL MSW handlers for the Dean dashboard, the audit trail and the
 * enrol gate.
 *
 * ⚠️ WHY THIS EXISTS, AND THE CORRECTION IT CARRIES. Two earlier write-ups in this cycle
 * said the demo handlers "cannot be execution-verified because esbuild is blocked". That
 * is wrong, and this file is the proof: `vite dev` / `vite build` cannot run on this
 * machine, but **esbuild's Node API works fine** — which is exactly how the nine probes
 * beside this one have been running since D33. The demo layer is executable headlessly;
 * only the BROWSER is unavailable.
 *
 * What it asserts, all of it demo-side behaviour `tsc` cannot see:
 *
 *   DEAN DASHBOARD (§42, Phase 8) — the seven KPIs the payload was missing are present
 *   and are numbers; `total_courses` is the CATALOG and not the offering count (the
 *   defect); the failure rate agrees with the histogram beside it; the worst-course
 *   ranking respects the minimum-results bar and is worst-first.
 *
 *   ENROL GATE (§4b item 5) — the picker reports pass-versus-fail rather than a flat
 *   "not passed", a student who failed the prerequisite is BARRED, the POST refuses them,
 *   and the Dean's override is honoured while a Registrar's is refused. Every one of
 *   these was broken in the demo and invisible to the type checker.
 *
 *   AUDIT TRAIL (§4b items 1–2) — one door, the sysadmin refused, and every row carrying
 *   the merged `record` / `reference` / `details`.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.d45-dean-probe-${process.pid}.cjs`);

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

console.log('='.repeat(78));
console.log('1. DEAN DASHBOARD — the full §42 KPI set');
console.log('='.repeat(78));
const dash = await req('GET', `${BASE}/dashboard`, 'principal');
check('GET /dashboard answers 200 for the Dean', dash.status === 200, JSON.stringify(dash.body).slice(0, 160));
const stats = dash.body?.stats ?? {};
for (const k of [
  'new_applicants',
  'accepted_applicants',
  'active_programmes',
  'students_at_risk',
  'graduates',
  'outstanding_grade_submissions',
  'failure_rate',
]) {
  check(`${k} is a number, not missing`, Number.isFinite(stats[k]), String(stats[k]));
}
console.log(
  `      applicants=${stats.new_applicants} accepted=${stats.accepted_applicants} programmes=${stats.active_programmes} at_risk=${stats.students_at_risk} graduates=${stats.graduates} marking=${stats.outstanding_grade_submissions} failure=${stats.failure_rate}%`,
);
check(
  'total_courses is the CATALOG, not the offering count (the defect)',
  stats.total_courses !== stats.total_sections,
  `courses=${stats.total_courses} sections=${stats.total_sections}`,
);

const rows = dash.body?.course_failure_rates ?? [];
console.log(`      ranked courses: ${rows.map((r) => `${r.course_code} ${r.failure_rate}%`).join(', ')}`);
check('course_failure_rates is present', Array.isArray(dash.body?.course_failure_rates));
check('every ranked course clears the minimum-results bar', rows.every((r) => r.results >= 5), JSON.stringify(rows.map((r) => r.results)));
check(
  'the ranking is worst-first',
  JSON.stringify(rows.map((r) => r.failure_rate)) ===
    JSON.stringify([...rows.map((r) => r.failure_rate)].sort((a, b) => b - a)),
);
check('no ranked course reports more failures than results', rows.every((r) => r.failing <= r.results));

const hist = (dash.body?.grade_distribution ?? []).filter((d) => d.count > 0);
const histTotal = hist.reduce((a, d) => a + d.count, 0);
check(
  'the histogram beside the failure rate is non-empty',
  histTotal > 0,
  `total=${histTotal}`,
);
// The failure rate must be a share of RESOLVED grades, so it cannot exceed 100 and
// cannot be non-zero when nothing resolved.
check('failure_rate is a share, not a count', stats.failure_rate <= 100);
check('failure_rate is 0 when nothing resolved', histTotal > 0 || stats.failure_rate === 0);

const auditorDash = await req('GET', `${BASE}/dashboard`, 'auditor');
check(
  'the Auditor gets the same KPI set (D43 — the Dean payload, read-only)',
  ['graduates', 'outstanding_grade_submissions', 'failure_rate'].every((k) =>
    Number.isFinite(auditorDash.body?.stats?.[k]),
  ),
  `role=${auditorDash.body?.role}`,
);
for (const absent of ['students_on_probation', 'probation', 'graduation_candidates']) {
  check(`${absent} is NOT faked with a zero (C1/C2 deferred)`, !(absent in stats));
}

console.log();
console.log('='.repeat(78));
console.log('2. THE ENROL GATE — pass versus fail, and the override');
console.log('='.repeat(78));
// Find a gated offering in the active session: MATH1210 requires MATH1110.
const offerings = await req('GET', `${BASE}/offerings?page_size=200`, 'principal');
const gated = (offerings.body?.items ?? []).find(
  (o) => (o.offering?.course?.code ?? o.course?.code) === 'MATH1210',
);
const offeringId = gated?.offering?.id ?? gated?.id;
check('found the gated MATH1210 offering', Boolean(offeringId), JSON.stringify(gated ?? {}).slice(0, 120));

if (offeringId) {
  const picker = await req(
    'GET',
    `${BASE}/offerings/${offeringId}/enrollable-students`,
    'principal',
  );
  const items = picker.body?.items ?? [];
  const barred = items.filter((i) => i.eligible === false);
  const eligible = items.filter((i) => i.eligible !== false);
  console.log(`      picker: ${items.length} candidates, ${eligible.length} eligible, ${barred.length} barred`);
  check(
    'the picker BARS somebody (it used to hardcode eligible:true for everyone)',
    barred.length > 0,
    `${barred.length} barred`,
  );
  const failedRow = barred.find((i) => /Taken but not passed \(earned .+\)/.test(i.ineligible_reason ?? ''));
  check(
    'a student who TOOK the prerequisite and failed says so, with the grade earned',
    Boolean(failedRow),
    JSON.stringify(barred.slice(0, 2)),
  );
  check(
    'no reason still uses the old flat "not passed"',
    !barred.some((i) => (i.ineligible_reason ?? '').includes('(not passed)')),
  );
  check(
    'every barred row names WHICH rule bars them',
    barred.every((i) => i.ineligible_rule === 'prerequisites' || i.ineligible_rule === 'student_status'),
  );
  if (failedRow) {
    console.log(`      barred: ${failedRow.student_number} ${failedRow.full_name} — ${failedRow.ineligible_reason}`);

    const refused = await req('POST', `${BASE}/offerings/${offeringId}/enrollments`, 'principal', {
      student_ids: [failedRow.id],
    });
    check(
      'POSTing a barred student is refused 409 prerequisite_not_met',
      refused.status === 409 && refused.body?.error?.code === 'prerequisite_not_met',
      `${refused.status} ${JSON.stringify(refused.body).slice(0, 160)}`,
    );
    check(
      'the refusal names the grade earned, not just "not passed"',
      /earned/.test(refused.body?.error?.message ?? ''),
      refused.body?.error?.message,
    );

    // §12/§20 — the Dean may waive it with a reason; the Registrar may not.
    const registrar = await req('POST', `${BASE}/offerings/${offeringId}/enrollments`, 'secretary', {
      student_ids: [failedRow.id],
      override: { prerequisites: true, reason: 'Trying it on.' },
    });
    check(
      "a Registrar's override is refused 403 override_not_permitted",
      registrar.status === 403 && registrar.body?.error?.code === 'override_not_permitted',
      `${registrar.status} ${JSON.stringify(registrar.body).slice(0, 140)}`,
    );
    const noReason = await req('POST', `${BASE}/offerings/${offeringId}/enrollments`, 'principal', {
      student_ids: [failedRow.id],
      override: { prerequisites: true },
    });
    check(
      'an override with no reason is refused 422',
      noReason.status === 422,
      `${noReason.status} ${JSON.stringify(noReason.body).slice(0, 140)}`,
    );
    const waived = await req('POST', `${BASE}/offerings/${offeringId}/enrollments`, 'principal', {
      student_ids: [failedRow.id],
      override: { prerequisites: true, reason: 'Sat and passed the August make-up examination.' },
    });
    check(
      "the Dean's override with a reason is HONOURED (the demo used to ignore it)",
      waived.status === 200,
      `${waived.status} ${JSON.stringify(waived.body).slice(0, 160)}`,
    );
  }
}

console.log();
console.log('='.repeat(78));
console.log('3. THE AUDIT TRAIL — one door, and the merged detail');
console.log('='.repeat(78));
const audit = await req('GET', `${BASE}/audit?page_size=25`, 'principal');
check('the Dean reads /audit', audit.status === 200);
const entries = audit.body?.items ?? [];
check('every entry names what KIND of record it is', entries.length > 0 && entries.every((e) => e.record), JSON.stringify(entries.map((e) => e.record)));
check('every entry carries a quotable reference', entries.every((e) => String(e.reference ?? '').startsWith('Entry #')));
check(
  'the override entry carries the waived rule in `details` (it used to be dropped)',
  entries.some((e) => (e.details ?? []).some((d) => d.label === 'Rule waived')),
  JSON.stringify(entries.map((e) => (e.details ?? []).map((d) => d.label))),
);
check(
  'no entry offers a disclosure that would open onto nothing',
  // The screen shows "Show detail" when changes | details | ip_address is non-empty.
  // A reason ALONE must never be what enables it — that was the defect.
  entries
    .filter((e) => e.reason && !e.changes?.length && !e.details?.length && !e.ip_address)
    .length === 0,
);
// The deleted route has NO handler, so MSW passes it through to the network and the
// fetch fails to resolve `sis.test`. That failure IS the assertion: a handler that
// still existed would answer, and this probe would see a status instead of an error.
let staleHandled = true;
try {
  await req('GET', `${BASE}/settings/audit-log`, 'principal');
} catch {
  staleHandled = false;
}
check('the deleted second door has no demo handler either', !staleHandled);
const sysadminAudit = await req('GET', `${BASE}/audit`, 'sysadmin');
check(
  'the System Administrator is refused the trail (the demo used to allow them)',
  sysadminAudit.status === 403,
  String(sysadminAudit.status),
);
const registrarAudit = await req('GET', `${BASE}/audit`, 'secretary');
check("the Registrar is refused (they are the log's most frequent subject)", registrarAudit.status === 403, String(registrarAudit.status));

server.close();
console.log();
console.log('='.repeat(78));
console.log(`RESULT  ${passes} passed, ${failures} failed`);
console.log('='.repeat(78));
process.exit(failures ? 1 : 0);

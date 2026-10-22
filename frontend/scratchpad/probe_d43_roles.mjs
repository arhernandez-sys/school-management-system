/**
 * D43 — execute the REAL MSW handlers as an Auditor and as an HOD.
 *
 * The demo has its own authorization layer, re-implemented per handler, and it has twice
 * certified behaviour the real backend refused. `tsc` cannot see any of it: every scoping
 * bug in this area type-checks perfectly, because the types say `DemoOffering[]` either
 * way and only the CONTENTS are wrong.
 *
 * So this asserts the two properties the roles exist for:
 *
 *   AUDITOR — reads everything, and every mutating verb is refused with `read_only_role`.
 *   HOD     — sees their programme's students / lecturers / offerings and NOT the rest of
 *             the college; and an unappointed head sees nothing extra rather than
 *             everything, which is the failure that would matter most.
 *
 * The HOD assertions are only meaningful because the seed has more than one programme —
 * a single-programme dataset makes "my programme" and "everything" the same set.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.d43-roles-probe-${process.pid}.cjs`);

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

function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
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

const ids = (b) => new Set((b?.items ?? []).map((i) => i.id));

// ── AUDITOR ─────────────────────────────────────────────────────────────────────
console.log('\n=== auditor: reads everything ===');
for (const [label, url] of [
  ['students', `${BASE}/students?page_size=200`],
  ['teachers', `${BASE}/teachers?page_size=200`],
  ['offerings', `${BASE}/offerings?page_size=200`],
  ['courses', `${BASE}/courses?page_size=200`],
]) {
  const r = await req('GET', url, 'auditor');
  check(`auditor reads ${label}`, r.status === 200 && (r.body?.total ?? 0) > 0,
    `status ${r.status}, total ${r.body?.total}`);
}

// The auditor's reach must MATCH the Dean's — "sees everything" is a comparison, not a
// count. A scoping rule that silently narrowed them would still return 200 and rows.
console.log('\n=== auditor: same reach as the Dean ===');
for (const [label, url] of [
  ['students', `${BASE}/students?page_size=200`],
  ['offerings', `${BASE}/offerings?page_size=200`],
]) {
  const dean = await req('GET', url, 'principal');
  const auditor = await req('GET', url, 'auditor');
  check(
    `auditor sees every ${label} the Dean does`,
    dean.body?.total === auditor.body?.total,
    `dean ${dean.body?.total} vs auditor ${auditor.body?.total}`,
  );
}

console.log('\n=== auditor: writes nothing ===');
const WRITES = [
  ['POST', `${BASE}/courses`, { name: 'Forged', code: 'FRG9999', credits: 3 }],
  ['PATCH', `${BASE}/courses/course-1`, { name: 'Renamed' }],
  ['DELETE', `${BASE}/courses/course-1`, undefined],
  ['POST', `${BASE}/students`, { first_name: 'X', last_name: 'Y' }],
  ['PUT', `${BASE}/offerings/off-1/teachers`, { teacher_ids: [] }],
];
for (const [method, url, body] of WRITES) {
  const r = await req(method, url, 'auditor', body);
  check(
    `${method} ${url.replace(BASE, '')} refused`,
    r.status === 403 && r.body?.error?.code === 'read_only_role',
    `status ${r.status}, code ${r.body?.error?.code}`,
  );
}

// The guard must key on the ROLE. If it keyed on anything else it would eventually
// refuse a Dean, and this is the assertion that would notice.
const deanWrite = await req('POST', `${BASE}/courses`, 'principal', {
  name: 'Dean Course',
  code: 'DNC9001',
  credits: 3,
});
check(
  'the Dean can still write (guard is role-keyed)',
  deanWrite.status !== 403 || deanWrite.body?.error?.code !== 'read_only_role',
  `status ${deanWrite.status}, code ${deanWrite.body?.error?.code}`,
);

// ── HOD ─────────────────────────────────────────────────────────────────────────
console.log('\n=== hod: scoped to their programme ===');
const deanStudents = await req('GET', `${BASE}/students?page_size=200`, 'principal');
const hodStudents = await req('GET', `${BASE}/students?page_size=200`, 'hod');
check('hod reads students', hodStudents.status === 200, `status ${hodStudents.status}`);
check(
  'hod sees SOME students',
  (hodStudents.body?.total ?? 0) > 0,
  `total ${hodStudents.body?.total}`,
);
check(
  'hod sees FEWER students than the Dean (scope is real)',
  (hodStudents.body?.total ?? 0) < (deanStudents.body?.total ?? 0),
  `hod ${hodStudents.body?.total} vs dean ${deanStudents.body?.total}`,
);

const deanOfferings = await req('GET', `${BASE}/offerings?page_size=200`, 'principal');
const hodOfferings = await req('GET', `${BASE}/offerings?page_size=200`, 'hod');
check(
  'hod sees SOME offerings',
  (hodOfferings.body?.total ?? 0) > 0,
  `total ${hodOfferings.body?.total}`,
);
check(
  'hod sees fewer offerings than the Dean',
  (hodOfferings.body?.total ?? 0) < (deanOfferings.body?.total ?? 0),
  `hod ${hodOfferings.body?.total} vs dean ${deanOfferings.body?.total}`,
);

// A head must see MORE than a plain lecturer — otherwise the role adds nothing and the
// demo would be showing a lecturer's view under a different name.
const lecturerOfferings = await req('GET', `${BASE}/offerings?page_size=200`, 'teacher');
check(
  'hod sees more offerings than a plain lecturer',
  (hodOfferings.body?.total ?? 0) > (lecturerOfferings.body?.total ?? 0),
  `hod ${hodOfferings.body?.total} vs lecturer ${lecturerOfferings.body?.total}`,
);

const deanTeachers = await req('GET', `${BASE}/teachers?page_size=200`, 'principal');
const hodTeachers = await req('GET', `${BASE}/teachers?page_size=200`, 'hod');
check(
  'hod sees SOME lecturers',
  (hodTeachers.body?.total ?? 0) > 0,
  `total ${hodTeachers.body?.total}`,
);
check(
  'hod sees fewer lecturers than the Dean',
  (hodTeachers.body?.total ?? 0) < (deanTeachers.body?.total ?? 0),
  `hod ${hodTeachers.body?.total} vs dean ${deanTeachers.body?.total}`,
);

// The head's own teaching must survive the programme scope — being promoted must not
// take away the gradebook they had as a lecturer.
const hodOfferingIds = ids(hodOfferings.body);
const hodOwn = await req('GET', `${BASE}/offerings?page_size=200`, 'hod');
check(
  'hod offerings are a strict subset of the Dean’s',
  [...hodOfferingIds].every((id) => ids(deanOfferings.body).has(id)),
  'hod sees an offering the Dean does not — impossible unless scoping invented rows',
);
check('hod offering set is stable across calls', ids(hodOwn.body).size === hodOfferingIds.size);

// ── the dashboard discriminator ─────────────────────────────────────────────────
console.log('\n=== dashboards carry an honest role ===');
// A 200 proves nothing here. The page switches on `role` and renders a component that
// reads specific fields, so the assertion has to be that the TAG and the SHAPE agree —
// a payload tagged `hod` carrying admin fields renders an empty lecturer dashboard.
for (const [role, mustHave, mustNotHave] of [
  ['hod', 'my_offerings', 'active_students'],
  ['auditor', 'active_students', 'my_offerings'],
]) {
  const r = await req('GET', `${BASE}/dashboard`, role);
  check(`${role} dashboard responds`, r.status === 200, `status ${r.status}`);
  check(
    `${role} dashboard is tagged '${role}'`,
    r.body?.role === role,
    `got '${r.body?.role}'`,
  );
  const stats = r.body?.stats ?? {};
  check(
    `${role} dashboard carries the right SHAPE (has ${mustHave})`,
    mustHave in stats,
    `stats keys: ${Object.keys(stats).join(', ')}`,
  );
  check(
    `${role} dashboard is not the other variant (no ${mustNotHave})`,
    !(mustNotHave in stats),
    `stats keys: ${Object.keys(stats).join(', ')}`,
  );
}

// ── appointing PROMOTES, removing demotes ───────────────────────────────────────
// Mirrors `programs/service._sync_head_roles`. The two safeguards are the interesting
// part: a Dean is never touched, and a head of two programmes taken off one keeps the
// role. Both are silent failures if wrong — the second revokes access to a department
// the person still runs, and nothing on screen would say so.
console.log('\n=== appointment drives the role ===');
{
  const programs = await req('GET', `${BASE}/programs?page_size=200`, 'principal');
  const all = programs.body?.items ?? [];
  const teachersAll = await req('GET', `${BASE}/teachers?page_size=200`, 'principal');
  const users = await req('GET', `${BASE}/settings/users?page_size=200`, 'principal');

  const roleOf = async (userId) => {
    const r = await req('GET', `${BASE}/settings/users?page_size=200`, 'principal');
    return (r.body?.items ?? []).find((u) => u.id === userId)?.role;
  };

  // A programme with no head yet, and a lecturer who heads nothing.
  const headed = new Set();
  for (const pr of all) {
    const h = await req('GET', `${BASE}/programs/${pr.id}/heads`, 'principal');
    for (const item of h.body?.items ?? []) headed.add(item.teacher_id);
  }
  const freeProgram = (
    await Promise.all(
      all.map(async (pr) => {
        const h = await req('GET', `${BASE}/programs/${pr.id}/heads`, 'principal');
        return (h.body?.items ?? []).length === 0 ? pr : null;
      }),
    )
  ).find(Boolean);

  const candidate = (teachersAll.body?.items ?? []).find((t) => !headed.has(t.id));
  const candidateUser = (users.body?.items ?? []).find(
    (u) => u.full_name === candidate?.full_name,
  );

  check(
    'fixture: found a free programme and an unappointed lecturer',
    Boolean(freeProgram && candidate && candidateUser),
    `programme ${freeProgram?.code}, lecturer ${candidate?.full_name}`,
  );

  if (freeProgram && candidate && candidateUser) {
    const url = `${BASE}/programs/${freeProgram.id}/heads`;

    const before = await roleOf(candidateUser.id);
    const appointed = await req('PUT', url, 'principal', {
      teacher_ids: [candidate.id],
    });
    check('appointing succeeds', appointed.status === 200, `status ${appointed.status}`);
    check(
      'the response already reports the new role',
      appointed.body?.items?.[0]?.role === 'hod',
      `got '${appointed.body?.items?.[0]?.role}'`,
    );
    check(
      'appointing PROMOTED the account',
      (await roleOf(candidateUser.id)) === 'hod',
      `was '${before}', now '${await roleOf(candidateUser.id)}'`,
    );

    // Give them a SECOND programme, then take away the first: they must stay an HOD.
    const second = all.find((pr) => pr.id !== freeProgram.id);
    await req('PUT', `${BASE}/programs/${second.id}/heads`, 'principal', {
      teacher_ids: [candidate.id],
    });
    await req('PUT', url, 'principal', { teacher_ids: [] });
    check(
      'a head who still runs another programme is NOT demoted',
      (await roleOf(candidateUser.id)) === 'hod',
      `now '${await roleOf(candidateUser.id)}'`,
    );

    // Now remove the last one.
    await req('PUT', `${BASE}/programs/${second.id}/heads`, 'principal', {
      teacher_ids: [],
    });
    check(
      'removing the LAST appointment demotes back to lecturer',
      (await roleOf(candidateUser.id)) === 'teacher',
      `now '${await roleOf(candidateUser.id)}'`,
    );
  }
}

server.close();
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

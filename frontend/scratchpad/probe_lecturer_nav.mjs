/**
 * Execute the real nav builder per role: a lecturer must get a flat "My Courses" →
 * /offerings item (their `courses: 'none'` drops the Courses group and its Course
 * Offerings child), and no other role may gain a duplicate.
 *
 * Usage: node scratchpad/probe_lecturer_nav.mjs
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { unlinkSync } from 'node:fs';
import path from 'node:path';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.nav-probe-${process.pid}.cjs`);
process.on('exit', () => { try { unlinkSync(out); } catch { /* gone */ } });

await build({
  stdin: {
    contents: `export { navSectionsForRole } from '@app/layout/navConfig';
               export { ROUTES } from '@shared/constants/routes';`,
    resolveDir: FE, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
  jsx: 'automatic', loader: { '.tsx': 'tsx' },
  alias: {
    '@shared': path.join(FE, 'src/shared'), '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'), '@i18n': path.join(FE, 'src/i18n'),
  },
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://sis.test/api/v1"' },
});

const require = createRequire(import.meta.url);
const { navSectionsForRole, ROUTES } = require(out);
let failures = 0;
const flatten = (items) => items.flatMap((i) => [i, ...(i.children ?? [])]);
for (const role of ['principal', 'secretary', 'hod', 'auditor', 'teacher', 'student']) {
  const items = flatten(navSectionsForRole(role).flatMap((s) => s.items));
  const hits = items.filter((i) => i.path === ROUTES.offerings);
  const ok = role === 'auditor' ? hits.length <= 1 : hits.length === 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${role.padEnd(9)} offerings entries: ${hits.length} ${hits.map((h) => `"${h.label}"`).join(', ')}`);
  if (!ok) failures++;
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

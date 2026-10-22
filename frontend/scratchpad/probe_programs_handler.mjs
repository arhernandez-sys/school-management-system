/**
 * Execute the REAL MSW `GET /programs` handler through msw/node and see what the
 * application wizard's programme picker actually receives. Static checks cannot see
 * this: the handler type-checks fine, it just filters every row away at run time.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
const out = path.join(FE, 'scratchpad', `.programs-probe-${process.pid}.cjs`);

await build({
  entryPoints: [path.join(FE, 'src/shared/api/mocks/handlers/programs.ts')],
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
  // Absolute base so msw/node can intercept a real fetch.
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://sis.test/api/v1"' },
});

const require = createRequire(import.meta.url);
const { programsHandlers } = require(out);
const { setupServer } = require('msw/node');

const server = setupServer(...programsHandlers);
server.listen({ onUnhandledRequest: 'error' });

async function probe(qs) {
  const r = await fetch(`http://sis.test/api/v1/programs${qs}`);
  const b = await r.json();
  console.log(`GET /programs${qs}\n  status=${r.status} total=${b.total} items=${b.items.length} ${JSON.stringify(b.items.map((p) => p.code))}`);
  return b;
}

// The wizard's exact call: useProgramsList({ page: 1, page_size: 100 }).
const wizard = await probe('?page=1&page_size=100');
await probe('?page=1&page_size=100&is_active=true');

server.close();
console.log(
  wizard.items.length === 0
    ? '\nFAIL — the wizard sends no is_active param and receives ZERO programmes.'
    : '\nPASS — the picker receives programmes.',
);

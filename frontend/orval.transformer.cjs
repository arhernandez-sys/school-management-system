/**
 * orval input transformer (referenced by orval.config.ts `input.override.transformer`).
 *
 * Does TWO things, both load-bearing.
 *
 * ── 1. Strip the `/api/v1` version prefix from every path key ──
 * The backend OpenAPI bakes the prefix into every path (e.g. `/api/v1/auth/login`). The
 * shared axios instance in `client.ts` ALREADY carries it in its `baseURL`
 * (`VITE_API_BASE_URL`, e.g. `/api/v1`). If the generated operations also emitted
 * `/api/v1/...`, axios would concatenate baseURL + path into
 * `/api/v1/api/v1/auth/login` (double prefix).
 *
 * Stripping it here → generated operations call `/auth/login`, which combine correctly
 * with the baseURL and match both the hand-authored wrappers and the MSW handlers
 * (which key on `${API_BASE_URL}/auth/...`).
 *
 * ── 2. Prune paths AND schemas to the generated tags (D31, 2026-08-19) ──
 * `input.filters.tags` in orval.config.ts filters OPERATIONS ONLY — it does not touch
 * `components.schemas`, which orval emits in full regardless. That was invisible while
 * `openapi.json` was a stale 21-path snapshot whose components happened to be small: the
 * committed tree held 90 model files. Refreshing the spec to the real 101-path surface
 * emitted **750**, i.e. a generated type for every module that deliberately
 * hand-authors its wire types in `features/<x>/types.ts` — the exact
 * generated-copy-beside-a-hand-authored-copy drift the config warns against.
 *
 * It also reintroduced the `dashboard` failure the config documents: `GET /dashboard` is
 * a role-discriminated `oneOf` with a hand-written schema carrying internal `$defs`, and
 * pulling it in raises `MissingPointerError: Missing $ref pointer "#/$defs/..."`.
 *
 * So the pruning happens HERE, where the whole spec is in hand: keep only the operations
 * whose tags are generated, then keep only the schemas reachable from them by `$ref`
 * (transitively). Everything else is deleted before orval sees it.
 *
 * TAGS is duplicated from `input.filters.tags` on purpose — the transformer runs before
 * the filters and cannot read the config. Keep the two lists in sync; the filter stays
 * because it is the documented knob, and this is a no-op when they agree.
 *
 * CommonJS (.cjs) because orval `require()`s the transformer and the package is ESM
 * (`"type": "module"`), which would otherwise reject a `.js` CommonJS module.
 */
const PREFIX = '/api/v1';

/** Mirror of `input.filters.tags` in orval.config.ts. */
const TAGS = ['auth', 'health', 'settings', 'courses'];

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Collect every `#/components/schemas/<name>` referenced anywhere inside `node`. */
function collectRefs(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const m = /^#\/components\/schemas\/(.+)$/.exec(value);
        if (m) out.add(m[1]);
      } else {
        collectRefs(value, out);
      }
    }
  }
  return out;
}

module.exports = (spec) => {
  if (!spec.paths) return spec;

  // ── 1. Keep only the tagged operations, and strip the version prefix. ──
  const paths = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    const kept = {};
    for (const [key, op] of Object.entries(item)) {
      const isOperation = HTTP_METHODS.includes(key);
      if (!isOperation || (op.tags ?? []).some((t) => TAGS.includes(t))) {
        kept[key] = op;
      }
    }
    // A path item left with only shared keys (`parameters`, `summary`) has no
    // operations worth generating — drop it rather than emit an empty entry.
    if (!HTTP_METHODS.some((m) => m in kept)) continue;
    const stripped = path.startsWith(PREFIX) ? path.slice(PREFIX.length) || '/' : path;
    paths[stripped] = kept;
  }
  spec.paths = paths;

  // ── 2. Keep only the schemas those operations can reach. ──
  const schemas = spec.components?.schemas;
  if (!schemas) return spec;

  const reachable = collectRefs(paths, new Set());
  // Transitive closure: a kept schema's own `$ref`s are kept too.
  const queue = [...reachable];
  while (queue.length > 0) {
    const name = queue.pop();
    const schema = schemas[name];
    if (!schema) continue; // dangling ref — orval reports it; do not mask it here
    for (const dep of collectRefs(schema, new Set())) {
      if (!reachable.has(dep)) {
        reachable.add(dep);
        queue.push(dep);
      }
    }
  }

  spec.components.schemas = Object.fromEntries(
    Object.entries(schemas).filter(([name]) => reachable.has(name)),
  );
  return spec;
};

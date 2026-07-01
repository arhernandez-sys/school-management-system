/**
 * orval input transformer (referenced by orval.config.ts `input.override.transformer`).
 *
 * The backend OpenAPI bakes the `/api/v1` version prefix into every path key
 * (e.g. `/api/v1/auth/login`). The shared axios instance in `client.ts` ALREADY
 * carries that prefix in its `baseURL` (`VITE_API_BASE_URL`, e.g. `/api/v1`). If the
 * generated operations also emitted `/api/v1/...`, axios would concatenate
 * baseURL + path into `/api/v1/api/v1/auth/login` (double prefix).
 *
 * So we strip the leading `/api/v1` from each path here → generated operations call
 * `/auth/login`, which combine correctly with the baseURL and match both the
 * hand-authored wrappers and the MSW handlers (which key on `${API_BASE_URL}/auth/...`).
 *
 * CommonJS (.cjs) because orval `require()`s the transformer and the package is ESM
 * (`"type": "module"`), which would otherwise reject a `.js` CommonJS module.
 */
const PREFIX = '/api/v1';

module.exports = (spec) => {
  if (!spec.paths) return spec;
  const rewritten = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    const stripped = path.startsWith(PREFIX) ? path.slice(PREFIX.length) || '/' : path;
    rewritten[stripped] = item;
  }
  spec.paths = rewritten;
  return spec;
};

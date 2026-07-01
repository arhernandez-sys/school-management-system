import { defineConfig } from 'orval';

/**
 * orval codegen config (OQ-FE-B; progress-tracker Current Phase).
 *
 * Generates, from the backend FastAPI OpenAPI 3.1 schema, into
 * `src/shared/api/generated/`:
 *   - TypeScript types for every component schema (CurrentUser, AuthTokenResponse,
 *     ErrorResponse, LoginRequest, …) — snake_case PRESERVED (the wire format,
 *     api-spec §1.2; matches the existing hand-authored bridge types).
 *   - TanStack Query (`react-query`) hooks + plain operation functions for the
 *     auth endpoints — this is why orval was chosen over a types-only tool.
 *
 * INPUT: a copy of the backend OpenAPI at `frontend/openapi.json`
 *   (`cp ../backend/openapi.json ./openapi.json` — re-copy when the backend
 *   contract changes, then `npm run generate:api`). A committed copy is used
 *   rather than a live `http://localhost:8000` URL so codegen is deterministic
 *   and does not require the backend to be running in CI.
 *
 * MUTATOR (the load-bearing override): every generated call routes through
 *   `customInstance` in `src/shared/api/mutator.ts`, which delegates to the
 *   shared `api` axios instance (Bearer attach + single-flight refresh +
 *   withCredentials + ApiError normalization). orval does NOT emit its own
 *   HTTP client — `httpClient: 'axios'` only informs the call shape; the mutator
 *   replaces the transport.
 */
export default defineConfig({
  sis: {
    input: {
      target: './openapi.json',
      override: {
        // Strip the `/api/v1` prefix from every path so generated operations are
        // RELATIVE (`/auth/login`) and combine correctly with the axios `baseURL`
        // (which already carries `/api/v1`). Without this, axios would double the
        // prefix → `/api/v1/api/v1/auth/login`. See orval.transformer.cjs.
        transformer: './orval.transformer.cjs',
      },
    },
    output: {
      mode: 'tags-split', // one folder per OpenAPI tag (e.g. `auth/`) + shared `model/`
      target: './src/shared/api/generated',
      schemas: './src/shared/api/generated/model',
      client: 'react-query',
      httpClient: 'axios',
      // Keep the generated tree formatted to the project's prettier config.
      prettier: true,
      override: {
        // Route ALL generated requests through the shared axios instance so they
        // inherit the single-flight refresh + Bearer + credentialed-cookie logic.
        mutator: {
          path: './src/shared/api/mutator.ts',
          name: 'customInstance',
        },
        query: {
          // TanStack Query v5 — match the project's installed major.
          useQuery: true,
          useMutation: true,
        },
      },
    },
    // Formatting is handled by `output.prettier: true` above (orval invokes the
    // locally-resolved prettier internally). No `afterAllFilesWrite` shell hook —
    // it would shell out to a *global* prettier, which isn't installed here.
  },
});

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
      /**
       * Generate ONLY the tags the app actually imports from `generated/`.
       *
       * Added 2026-08-06, during the D29 frontend work. Before this the config was
       * unfiltered, and the committed `generated/` tree happened to hold just these four
       * tags because `openapi.json` was a stale 4-tag snapshot. Refreshing the spec to the
       * real 77-path surface therefore generated all 16 tags — including `dashboard`, which
       * DOES NOT survive codegen: `GET /dashboard` is a role-discriminated `oneOf` with a
       * hand-written schema (no `response_model` — see the backend router's docstring), and
       * orval emits imports for its inline `$defs` models without writing those files,
       * producing 19 TS2307 errors. So a routine "re-copy the spec and regenerate" broke
       * `tsc` on code nothing imported.
       *
       * Filtering makes that refresh safe and deterministic. Every other module deliberately
       * hand-authors its wire types in `features/<x>/types.ts` (each says so); to migrate one
       * to codegen, add its tag here and replace those types in the same change — do not
       * leave a generated copy sitting alongside a hand-authored one to drift.
       */
      filters: {
        tags: ['auth', 'health', 'settings', 'courses'],
      },
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

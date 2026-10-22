# Frontend Implementation — School Management System (SIS)

> **Phase 6 — Frontend Foundation.** Owner: `frontend-engineer`. This is the first code-writing phase. It delivers the **application shell everything else plugs into** — scaffold, theme, routing + guards, auth structure, TanStack Query + API client infra, and the feature-based folder tree. It deliberately builds **no feature-module functionality** (that is Phase 7). It honors `architecture.md` (§3 auth, §5 folder structure, §7 state strategy), `ui-design-system.md` (D18 nav, D19 theme tokens, D20–D22), `api-specification.md` (§1 conventions, §2 auth, §4 envelopes), and `complete-work.md` (D14/D15/D27/D28).

_Last updated: 2026-07-28._

> **⚙️ THE BACKEND NOW EXISTS FOR EVERY SCREEN (2026-07-28).** Phase 7 is complete: all twelve
> modules are served (70 path templates / 99 operations — see `backend/openapi.json`). The routes
> that were previously dead against the real API — `/dashboard`, `/grades`, `/attendance`,
> `/announcements`, `/reports`, `/calendar` — are all live now. **Run with
> `VITE_ENABLE_MOCKS=false` to hit the real backend**; `npm run demo` remains the MSW fake-data
> track for client previews.
>
> **Two things to know when comparing the real API to `npm run demo`:**
> 1. **Term grades will differ where the demo data uses weighted categories.** The backend
>    implements the documented two-level rollup (`database-schema.md` §10.2c: grades → category %,
>    categories → by `category.weight`, with drop-lowest); `mocks/demo/selectors.ts::computeTermGrade`
>    does a flat mean and ignores category weights entirely. The backend is correct — the mock is a
>    simplification. Screens are unaffected (they render `term_numeric` from the server), only the
>    numbers move.
> 2. **`selectors.ts::letterFor` still has the OQ-DB2 bug** — a strict `min <= v <= max` lookup
>    against `.99`-ceiling bands, so e.g. `179.99/200 = 89.995` matches no band and renders blank
>    where a "B" belongs. The backend resolves this half-open on `min_score`. Demo-only and
>    cosmetic, but worth aligning if the demo is shown again.
>
> **Orval was deliberately NOT regenerated** for the new modules: they use hand-written transports
> (`features/*/api/*.ts`), so generating clients nothing imports would add noise without proving
> anything. `npm run typecheck` passes clean. See the progress tracker's note for the full reasoning.

---

## 1. Location & how to run

- **App root:** `C:\Users\arhernandez\source\repos\school-management-system\frontend\`
  (placed beside the future `backend/` per architecture §6; the backend is a separate FastAPI app).
- **Stack:** Vite 5 + React 18 + TypeScript 5 (strict) + MUI v6 + React Router v6 + TanStack Query v5 + Recharts + axios.

```bash
cd frontend
cp .env.example .env      # configure VITE_API_BASE_URL etc. (mocks ON by default)
npm install               # installs deps ONLY — see the note below
npx msw init public/ --save  # REQUIRED on a fresh clone: creates public/mockServiceWorker.js
npm run dev               # http://localhost:5173  (login → shell works via the mock layer)
npm run build             # tsc -b && vite build  → dist/
npm run typecheck         # tsc -b --noEmit
npm run lint              # eslint
npm run format            # prettier --write
```

> ⚠️ **`npm install` does NOT create the MSW worker.** This block used to claim it did.
> There is no `postinstall` script in `package.json`, and `public/mockServiceWorker.js` is
> gitignored (`frontend/.gitignore:29`) — so on a fresh clone nothing generates it. Demo mode
> then loads and 404s every request, which reads like a broken app rather than a missing
> file. `RUNBOOK.md` §1.3 has the same warning.

**Build/run status (verified in Phase 6):**
- `npm install` — ✅ 362 packages, no blocking errors (transitive deprecation warnings only).
- `npm run typecheck` (`tsc -b`) — ✅ passes (strict mode, `noUnusedLocals`, `noImplicitOverride`, `noUncheckedIndexedAccess`).
- `npm run build` — ✅ passes; vendor chunks split (react / mui / query / charts) — no chunk-size warning.
- `npm run lint` — ✅ 0 problems.
- `npm run dev` — ✅ serves the SPA (HTTP 200); all route-tree module transforms compile; MSW worker present.

---

## 2. Dependency versions (locked)

| Package | Version | Role |
|---|---|---|
| `react` / `react-dom` | ^18.3.1 | UI runtime (React 18 — stable, broad MUI v6 support) |
| `typescript` | ^5.7.2 | Types (strict) |
| `vite` / `@vitejs/plugin-react` | ^5.4.11 / ^4.3.4 | Build/dev |
| `@mui/material` / `@mui/icons-material` | ^6.1.10 | Component library (D19, MUI v6 `colorSchemes`) |
| `@emotion/react` / `@emotion/styled` | ^11.13.5 | MUI styling engine |
| `react-router-dom` | ^6.28.0 | Routing (data router) |
| `@tanstack/react-query` (+ devtools) | ^5.62.7 | Server-state cache (architecture §7) |
| `recharts` | ^2.14.1 | Charts (paired with tables in Phase 7) |
| `axios` | ^1.7.9 | HTTP client (interceptor-based single-flight refresh) |
| `react-hook-form` | ^7.54.0 | Form library (architecture §7.2) — wired in Phase 7 forms |
| `msw` | ^2.7.0 | Dev-only mock layer (auth fixtures) |
| ESLint 8 + `@typescript-eslint` 8 + Prettier 3 | — | Lint/format |

**HTTP client choice — axios over a fetch wrapper (justification):** the load-bearing auth requirement is **single-flight refresh** — concurrent 401s must queue on one in-flight `/auth/refresh` and replay. Axios response interceptors give one centralized place to implement attach-Bearer + refresh-and-replay without re-wrapping every call site. A hand-rolled fetch wrapper would re-implement interceptors and retry/replay plumbing for no benefit.

---

## 3. Folder structure (as built)

Feature-based (D15 / architecture §5). Path aliases configured in `tsconfig.app.json` + `vite.config.ts`: `@/`, `@app/`, `@features/`, `@shared/`, `@theme/`, `@i18n/`.

```
frontend/
├── index.html
├── package.json · tsconfig*.json · vite.config.ts · .eslintrc.cjs · .prettierrc.json
├── .env.example                      # VITE_API_BASE_URL, VITE_SUPABASE_STORAGE_URL (D28), VITE_ENABLE_MOCKS
├── public/mockServiceWorker.js       # MSW worker (generated; git-ignored)
└── src/
    ├── main.tsx                      # bootstrap: start mocks → render <App/> in StrictMode
    ├── App.tsx                       # AppProviders + RouterProvider
    ├── vite-env.d.ts                 # typed import.meta.env
    │
    ├── app/
    │   ├── providers/                # AppProviders, queryClient, ErrorBoundary,
    │   │                             #   YearContext (student year·semester selection)
    │   ├── router/                   # routes.tsx, ProtectedRoute, RoleRoute, ErrorPages (403/404)
    │   └── layout/                   # AppShell, TopBar, Sidebar, UserMenu, StudentYearSwitcher,
    │                                 #   NotificationsBell, navConfig (role-aware nav map)
    │
    ├── features/                     # one folder per module — components/ api/ hooks/ types.ts
    │   ├── auth/                      # ★ IMPLEMENTED: api/authApi, context/AuthProvider+AuthContext,
    │   │                             #   hooks/useAuth, components/LoginForm, routes (Login + ChangePassword)
    │   ├── dashboard/ students/ teachers/ classes/ assessments/ grades/
    │   ├── attendance/ announcements/ reports/ settings/   # placeholders (index.tsx → ModulePlaceholder)
    │
    ├── shared/
    │   ├── components/               # IMPLEMENTED: LoadingState, EmptyState, ErrorState, PageHeader,
    │   │                             #   ModulePlaceholder · STUBBED (stubs.tsx): DataTable, ConfirmDialog,
    │   │                             #   ChartWithTable, StatCard, FormDialog, FormPage, FilterBar, RoleChip,
    │   │                             #   StatusBadge, DetailTabs, PrintLayout, PasswordField, CollapsibleSection
    │   ├── hooks/                    # useDisclosure, useDebounce
    │   ├── api/                      # client.ts (axios + single-flight refresh), queryKeys.ts,
    │   │                             #   mocks/ (browser, handlers, fixtures) — dev-only
    │   ├── auth/permissions.ts       # central permission map (requirements §2 matrix)
    │   ├── constants/routes.ts       # route path constants
    │   └── types/                    # enums.ts, api.ts (Page<T>, ErrorResponse, CurrentUser) — temp until codegen
    │
    ├── theme/                        # theme.ts (D19 tokens via colorSchemes), index.ts
    └── i18n/                         # strings.ts (English source strings) — NFR-LOC-01 stub
```

---

## 4. Theme (D19)

`src/theme/theme.ts` — `createTheme()` with **MUI v6 `colorSchemes`** so dark mode (D20) is a later config addition, not a refactor. Implements the D19 token set: primary `#1F5BA8`, secondary `#0E7C7B`, semantic error/warning/info/success, text/divider/background tokens; 8px spacing + 8px radius; system font stack (Inter optional, OQ-C); `textTransform:'none'` on buttons/tabs; flat outlined cards/paper with hairline borders; dense `size="small"` tables/inputs (D21); strengthened `:focus-visible` ring + `prefers-reduced-motion` reset (a11y §9.2/§9.7). `<ThemeProvider defaultMode="light">` (D20 light-only for v1). **Components must reference `theme.palette.*` tokens, never raw hex.**

---

## 5. Routing & role-based guards

`src/app/router/routes.tsx` — `createBrowserRouter` data router.

- **Public:** `/login`, `/login/change-password` (forced-change placeholder).
- **Authenticated layout route:** wraps `<AppShell/>` in `<ProtectedRoute>`. Children = one route per module, each wrapped by `<RoleRoute module=…>`, plus `/me` (student profile), `/forbidden` (403), and `*` (404).
- **`ProtectedRoute`** — while auth bootstrap (silent refresh) is in flight, renders a full-screen `LoadingState` (NOT a redirect) so a hard reload of a valid session does not flash `/login`. Anonymous → redirect to `/login` preserving the attempted path in `location.state.from`.
- **`RoleRoute`** — checks the central permission map; a role lacking the module is redirected to `/forbidden`. This validates the AC "a Student visiting an admin URL is redirected and gets no data."
- **Central permission map** (`shared/auth/permissions.ts`) mirrors the requirements §2 matrix (role × module → capability). It drives both nav visibility (`navConfig`) and `RoleRoute`. **Code comments mark it UX-only — the server is authoritative (NFR-SEC-01).**

Each feature placeholder renders `ModulePlaceholder`, which shows the signed-in role + its capability for that module, so role-aware nav + guards are demonstrably working end-to-end.

---

## 6. Auth flow (architecture §3.1)

Files: `shared/api/client.ts`, `features/auth/api/authApi.ts`, `features/auth/context/AuthProvider.tsx`, `hooks/useAuth.ts`.

- **In-memory access token** — held only in the `client.ts` module closure (`setAccessToken`/`getAccessToken`); never localStorage/sessionStorage (XSS hardening). The request interceptor attaches `Authorization: Bearer`.
- **Credentialed cross-origin** — axios `withCredentials: true` so the HttpOnly `sis_refresh` cookie rides cross-origin (Vercel ↔ Railway). `/auth/refresh` also sends the `X-Refresh: 1` custom header (api-spec §2.2 CSRF defense).
- **Bootstrap silent refresh** — on mount, `AuthProvider` calls `bootstrapSession()` (→ `/auth/refresh` then `/auth/me`) **before guards render**. Status machine: `bootstrapping → authenticated | anonymous`. Guards show loading during `bootstrapping`. (Guarded against StrictMode double-invoke via a ref.)
- **Single-flight refresh** — `client.ts` `performRefresh()` coalesces all callers onto one in-flight promise. On a 401, the response interceptor runs one refresh, replays the original request once (`_retried` flag), and on definitive failure clears the token + fires `onRefreshFailure` (AuthProvider drops to anonymous → guards redirect to `/login`). A bare `rawClient` (no interceptors) performs the refresh call itself so a refresh can never recursively trigger another.
- **Error normalization** — all errors become `ApiError { status, code, message, fields?, requestId? }` from the `ErrorResponse` envelope (api-spec §4.2), so call sites branch on `code`/`status`.

### ⚠️ Foundation task flagged for backend (architecture §3.1, §10): cross-origin cookie + credentialed CORS smoke test
The hard-reload-session-survival test requires a running backend that sets `sis_refresh` as `Secure; HttpOnly; SameSite=None` and returns credentialed CORS (`Access-Control-Allow-Credentials: true` + explicit allow-listed origin, never `*`). The **frontend is wired for it** (`withCredentials`, `X-Refresh`, bootstrap refresh), but the end-to-end smoke test is **blocked until the backend exists** (Phase 7). **`SameSite=Strict`/`Lax` will silently break refresh** — call out at backend wiring time.

---

## 7. Mock layer (dev-only) & swapping to the real API

Lives in `src/shared/api/mocks/` (`browser.ts`, `handlers.ts`, `fixtures.ts`), using **MSW**. Gated by `VITE_ENABLE_MOCKS` (`true` in `.env.example`). `main.tsx` starts the worker before rendering; no-op when the flag is off.

- Intercepts the **auth surface** only: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout` — enough for **login → bootstrap → shell → role navigation** with no backend.
- **Pick a role at login:** type `principal`, `secretary`, `teacher`, or `student` as the identifier (any password). A non-HttpOnly `sis_mock_session` cookie simulates the refresh session (real cookies are HttpOnly + backend-set).
- Unhandled requests `bypass` to the network, so partial real-backend testing is possible.

**Swap to the real API (Phase 7 / when backend exists):**
1. Set `VITE_ENABLE_MOCKS=false` (or unset) and point `VITE_API_BASE_URL` at the FastAPI server. The SPA code does **not** change — only the flag.
2. Replace `shared/types/api.ts` + `shared/types/enums.ts` hand-authored types with the **OpenAPI-generated TS client** (D14, architecture §7 — e.g. `openapi-typescript` against the FastAPI schema). Keep the `Page<T>` / `ErrorResponse` envelope names (widely imported). The auth API wrappers in `features/auth/api/authApi.ts` can then call the generated operations.

---

## 8. TanStack Query + query-key conventions

- `app/providers/queryClient.ts` — defaults: short `staleTime` (30s) for volatile data (reference/config data overrides long per-hook); `refetchOnWindowFocus: false`; **no retry on 4xx** (only transient/5xx/network); mutations don't retry. A 401 is handled by the client's single-flight refresh, not query retry.
- `shared/api/queryKeys.ts` — **hierarchical query-key factory** (architecture §7.1). Phase 6 ships `authKeys`, `dashboardKeys`, `settingsKeys`. Convention documented inline (`all`, `list(filters)`, `detail(id)`, scoped keys include semester/term/filters so the global semester switcher + FilterBar URL state drive cache identity). Phase 7 feature factories follow the same shape (commented examples for `studentKeys`, `gradeKeys` included).

---

## 9. Done vs Stubbed/Deferred

**DONE (implemented for real):**
- Scaffold + tooling (Vite/TS strict/ESLint/Prettier), `.env.example`, path aliases, vendor chunk-splitting.
- MUI theme (D19) via `colorSchemes`.
- Feature-based folder tree (11 modules + shared + theme + i18n).
- AppShell + TopBar + Sidebar (role-aware nav from permission map, responsive permanent/temporary/mini drawer) + UserMenu + NotificationsBell (shell-functional; data sources wired in Phase 7). The app-bar period control shipped as the **student-only `StudentYearSwitcher`** (`YearContext`), not the all-roles `SemesterSwitcher` originally specified — staff scope per module via `?year=`. See ui-design-system §3.1.
- Routing + `ProtectedRoute` + `RoleRoute` + 403/404 pages + per-role placeholder pages.
- Auth structure: in-memory token, bootstrap silent refresh, single-flight refresh, logout, `/auth/me`, error normalization.
- QueryClient + query-key factory.
- Shared shell components: `LoadingState`, `EmptyState`, `ErrorState`, `PageHeader`, `ModulePlaceholder`; hooks `useDisclosure`, `useDebounce`; `ErrorBoundary`.
- Dev-only MSW mock layer for auth.
- Accessibility baseline: skip link, landmarks (header/nav/main), focus ring, labelled controls, aria on icon buttons/menus, reduced-motion.

**STUBBED / DEFERRED to Phase 7:**
- The 13 data/feature-composition shared components (`stubs.tsx`): `DataTable`, `ConfirmDialog`, `ChartWithTable`, `StatCard`, `FormDialog`, `FormPage`, `FilterBar`, `RoleChip`, `StatusBadge`, `DetailTabs`, `PrintLayout`, `PasswordField`, `CollapsibleSection` — typed placeholders rendering a "Phase 7" marker.
- All 11 feature modules' real functionality (lists/detail/forms/dashboards/reports).
- Forced password-change form body (route + placeholder exist; `PATCH /auth/me/password` wiring is Phase 7).
- Period-switcher term list + NotificationsBell unread count (need Settings + Announcements modules). ✅ Both landed: `StudentYearSwitcher` reads `GET /students/me/years` + `GET /settings/academic-years`; the bell reads `GET /announcements/unread-count`.
- OpenAPI-generated TS client (needs the running backend / Phase 5 artifact).
- i18n is a string-table stub (English); no i18n library wired yet.

---

## 10. Decisions & open questions for the orchestrator

**New foundation decisions (recommend logging):**
- **FE-1 — HTTP client = axios** (interceptor-based single-flight refresh; justification in §2).
- **FE-2 — React 18** (not 19) for v1 — stable, broad MUI v6 compatibility; upgrade is a later, isolated step.
- **FE-3 — Hand-authored API/envelope types as a temporary bridge** until the OpenAPI-generated client lands; envelope shapes (`Page<T>`, `ErrorResponse`, `CurrentUser`) match api-spec §4 exactly to minimize churn at swap time.
- **FE-4 — Dev mock layer = MSW**, gated by `VITE_ENABLE_MOCKS`, auth-only surface. Lives in `shared/api/mocks/`, clearly dev-only.
- **FE-5 — Vendor chunk-splitting** (react/mui/query/charts) now; route-level `React.lazy` code-splitting deferred to Phase 7.

**Open questions / flags:**
- **OQ-FE-A — Cross-origin cookie/CORS smoke test is backend-blocked** (§6). Frontend is wired; the hard-reload-survival test runs once the FastAPI backend sets the cookie + credentialed CORS. `SameSite=Strict`/`Lax` breaks refresh — flag at backend wiring.
- **OQ-FE-B — OpenAPI codegen tool choice** (e.g. `openapi-typescript` vs `orval`) — decide before heavy Phase 7 module work so feature hooks consume generated types from day one (architecture §10 prerequisite).
- **OQ-FE-C — `VITE_SUPABASE_STORAGE_URL`** placeholder added (D28) for the school-logo public URL; the concrete project-ref URL is needed when Settings/branding is built (Phase 7).
- Inherited confirmations unchanged: OQ-C (self-hosted Inter — defaulting to system stack), OQ-D (phone bottom-nav deferred), OQ-E (bell = in-app announcements only).

---

## 11. Phase 7 — Module 7.1 (Auth) frontend + codegen

_Added 2026-06-28. First Phase-7 module; resolves OQ-FE-A, OQ-FE-B and retires FE-3._

**FE-6 — OpenAPI codegen = orval** (resolves OQ-FE-B; ratified stakeholder choice). `frontend/orval.config.ts` generates **TS types + TanStack Query v5 hooks** into `src/shared/api/generated/` from `frontend/openapi.json` (a committed copy of `backend/openapi.json` — deterministic/CI-safe, not a live URL). `npm run generate:api` regenerates. Input transformer (`orval.transformer.cjs`) strips the `/api/v1` prefix from path keys because the axios `baseURL` already carries it (otherwise paths double to `/api/v1/api/v1/...`).
- **Mutator reuse (load-bearing):** orval `override.mutator` → `src/shared/api/mutator.ts` `customInstance`, which delegates to the EXISTING `api` axios instance in `shared/api/client.ts`. So every generated call inherits Bearer-attach + single-flight refresh + `withCredentials` + `ApiError` normalization. orval emits NO parallel HTTP client. `client.ts` refresh logic is untouched.
- **esbuild pinned** to `0.21.5` via `package.json` overrides (orval's transitive esbuild 0.25.x binary wouldn't execute on the dev machine; 0.21.5 is the build vite already ships). Do not remove.

**FE-3 RETIRED.** Hand-authored auth bridge types removed from `shared/types/api.ts`; `CurrentUser`/`AuthTokenResponse`/`UserPreferences`/`ErrorResponse`/`ErrorBody`/`Role` now re-export from the generated model (names kept stable → no churn at ~13 import sites). `Page<T>`/`SemesterRef`/`SchoolIdentity` + non-auth enums remain hand-authored until their modules' endpoints enter the OpenAPI.

**FE-7 — Local dev uses a Vite dev proxy** (`vite.config.ts` `server.proxy` forwards `/api/v1` → `http://localhost:8000`), with `VITE_API_BASE_URL=/api/v1` (relative) and `VITE_ENABLE_MOCKS=false`. Reason: in `ENVIRONMENT=local` the backend sets the refresh cookie `SameSite=Lax` (None requires Secure/HTTPS), and a Lax cookie is NOT sent on a cross-site XHR — so the proxy makes API calls same-origin so silent refresh works over http. `.env.example` documents the direct + prod alternatives.

**Forced-password-change flow built** (`features/auth/components/ChangePasswordForm.tsx` + real `ChangePasswordPage`): login with `must_change_password=true` → change-password → `PATCH /auth/me/password` (omits `current_password` in the forced flow) → `refreshUser()` → dashboard. MSW handlers added for change-password + reset-password so mock-mode stays coherent.

**OQ-FE-A — RESOLVED (mechanics).** Cross-origin cookie cycle verified live (login sets `sis_refresh; HttpOnly; Path=/api/v1/auth`, refresh+`X-Refresh:1` rotates, credentialed CORS explicit-origin). The only browser-only unverifiable piece is auto-attach on a real hard-reload XHR — the same-origin proxy is designed to satisfy it. **Prod caveat:** cross-origin (Vercel↔Railway) requires `SameSite=None; Secure` over HTTPS; `Lax`/`Strict` silently breaks cross-site refresh — validate at deploy.

Verified: `tsc -b --noEmit` (strict) exit 0; `vite build` exit 0 (1335 modules).

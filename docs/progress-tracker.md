# Progress Tracker — School Management System (SIS)

> **This is the most important document.** It is the single source of truth for project state. Updated at the end of every phase. Every agent reads this first.

_Last updated: 2026-07-01 — Module 7.2 (Settings + Subjects) COMPLETE (backend + tests + frontend all ✅, verified). Next: Module 7.3 Students/Teachers._

---

## Current Phase

**Phase 7 — Core Modules: 🟡 IN PROGRESS.** Phases 1–6 ✅ complete. Sub-phase 7.0 (backend stand-up: app factory, test harness, Alembic+RLS+seed against live Supabase) ✅ COMPLETE and INDEPENDENTLY RE-VERIFIED 2026-06-27 (live DB: alembic_version=`0001_initial_schema`, 28 data tables, 28 RLS-enabled w/ 0 policies, 0 anon/authenticated grants, 1 seeded principal; app boots).

**Module 7.1 — Auth: ✅ COMPLETE (2026-06-29, verified live: `41 passed in 74.89s`).** Backend ✅ (`app/modules/auth/{router,service}.py`, 6 endpoints mounted via `MODULE_ROUTERS`; OpenAPI snapshot `backend/openapi.json`). Frontend + orval ✅ / OQ-FE-B done (orval@7.13 → TS types + TanStack Query hooks in `frontend/src/shared/api/generated/`, reusing the existing axios instance as its `override.mutator` so generated calls inherit Bearer + single-flight refresh + ApiError; FE-3 hand-authored auth types replaced by generated re-exports; forced-password-change flow wired; live-API via Vite dev proxy so the Lax cookie works same-origin over http — see `frontend-implementation.md` §11). Test suite ✅ (`tests/test_auth.py`, **40 tests** + health = 41 passing against the rolled-back live DB; covers every endpoint + lockout/rotation-replay/idle-timeout/enumeration-safety/session-revocation/privilege-guards). **Cookie-clear bug FIXED** (`router.py` `_refresh_invalid_response()` now RETURNS a 401 `JSONResponse` with the clearing `sis_refresh` cookie attached instead of mutate-then-raise; all 6 refresh-failure tests assert the clearing cookie; divergence note removed). **conftest cwd-independence FIXED** (the `.env`→os.environ bridge uses an absolute path anchored to conftest, so the suite runs from both `backend/` and repo root instead of silently skipping).

**Module 7.2 — Settings + Subjects: ✅ COMPLETE (2026-07-01) — backend ✅ + tests ✅ + frontend ✅.** Backend ✅ verified live (`41 passed`; orchestrator re-confirmed 14 path templates = 22 operations in OpenAPI, suite green). Files: `app/modules/settings/{schemas,service,router}.py` + new slice `app/modules/subjects/{schemas,service,router}.py` (Subject ORM stays in `classes/models.py`); both mounted via `MODULE_ROUTERS`. 18 Settings endpoints (school/active-term/academic-years/semesters/grading-scale/assessment-policy/users/account) + 4 Subjects CRUD. Verified security-sensitive paths: 409 active_year_exists, 422 grading_bands_invalid, 409 scale_frozen, 403 role_change_forbidden, Secretary-cannot-edit-Principal 403, 409 duplicate_email, archive 202→409 year_already_archived→active-term 409 no_active_semester. **DISCOVERY:** the seed committed an ACTIVE year `2025-2026` + `Semester 1`, so `/settings/active-term` returns 200 (system is NOT in the empty state). **Two flagged integration points (stubbed w/ TODO):** (1) logo upload storage `TODO(OQ-DB5)` — shape+validation real (413/415, 2 MiB), no real upload until Supabase bucket+anon-key provisioned; (2) archive snapshot computation `TODO(7.6/7.8)` — state transitions + idempotency done, writes 0 snapshots; **7.6 Grades + 7.8 Reports MUST complete the freeze.** **Out-of-scope bug fixed:** `app/common/schemas.py::UserPreferences` (Pydantic) lacked `from_attributes=True` → crashed `model_validate(orm_row)` when a prefs row exists; fixed, suite green (note name collision w/ ORM `users.models.UserPreferences`). **Test suite ✅ DONE** — `tests/test_settings.py` + `tests/test_subjects.py` on disk; verified `140 passed` (Auth 40 + Settings + Subjects + health) against the live pooler DB. _(Caveat: re-running from the orchestrator's own shell shows `140 skipped` because psycopg's `pq` DLL hits a Windows-sandbox "Access is denied" load error in that shell — the SAME sandbox exec-policy block the frontend hit on npm `.bin` shims — so the conftest reachability probe skips cleanly. Not a code/test defect; tests pass wherever psycopg loads, as in the verifying run.)_ **Settings FRONTEND — ✅ COMPLETE (2026-07-01, verified: `tsc --noEmit` exit 0, `npm run lint` 0 problems, `npm run build` exit 0 / 1458 modules).** orval regen ✅ DONE (`src/shared/api/generated/settings/` + `/subjects/` full query+mutation hooks incl. `useUploadSchoolLogo...`). All 3 slices landed: **Slice A** = Subjects CRUD + Account/preferences + SemesterSwitcher active-term wiring (`app/layout/SemesterSwitcher.tsx` consumes `GET /settings/active-term`, degrades to a "No active term" chip on 409 `no_active_semester`, no crash); **Slice B** = School profile (logo upload control rendered DISABLED with explanatory copy per OQ-DB5/OQ-FE-C — blocked on Supabase bucket + anon key) + Academic structure (years/semesters/archive); **Slice C** = Grading scale/bands + Assessment policy + Users admin. `features/settings/index.tsx` is now the real tabbed, role-aware, nested-routed container (7 tabs for P/S; account-only for Teacher/Student) — Phase-6 placeholder replaced. Files: `screens/{SchoolProfile,AcademicStructure,GradingScale,AssessmentPolicy,Users,Account}Screen.tsx` + `SubjectsPage.tsx` + `components/{SubjectForm,UserForm,TempPassword}Dialog.tsx` + `hooks/{useSettings,useSubjects}.ts`. **Module 7.2 is now fully COMPLETE (backend + tests + frontend).** Only remaining Settings deferral = real logo upload, gated on the Supabase bucket name + anon key from the user (does not block 7.3).

**Module 7.3 — Students + Teachers: 🟡 BACKEND ✅ + TESTS ✅ (2026-07-01) — real frontend pending (a fake-data DEMO build exists, see DEMO note below).** Files: `app/modules/students/{schemas,service,router}.py` + `app/modules/teachers/{schemas,service,router}.py`, both mounted via `MODULE_ROUTERS` (after subjects). **14 new operations** (Students 8, Teachers 6); app boots, OpenAPI diff purely additive (29 total paths, was 21); regression `pytest -m "not requires_db"` = 1 passed / 139 deselected. Endpoints: Students `GET /` (P/S/Teacher, teacher auto-scoped to own sections), `GET /me` (Student, server-derived), `GET /{id}`, `GET /{id}/assessments`, `POST /` (P/S, optional same-txn enroll into `section_id`), `PATCH /{id}`, `POST /{id}/status`, `DELETE /{id}` (soft-delete, blocked by academic history); Teachers `GET /` + `GET /{id}` (RO directory, Student→403), `POST /` (P/S, optional `create_login`), `PATCH /{id}`, `POST /{id}/status` + `DELETE /{id}` (Principal-only, blocked if assigned). **Deliberate spec resolutions:** (1) `POST /teachers` with `create_login` returns `TeacherCreateResponse {teacher, temporary_password?}` (bare `TeacherDetail` can't carry the one-time secret — mirrors `POST /settings/users`); (2) `GET /students/{id}/assessments` returns a local `StudentAssessmentItem` (not the 7.5 `AssessmentSummary`) to avoid building ahead; (3) `current_section` derived from active-semester `class_enrollments` (unenrolled_at IS NULL), batched (no N+1), resolves null when no active semester. **PRE-EXISTING BUG FIXED (2026-07-01):** `app/core/rbac.py::assert_teacher_owns_section` used the invalid `exists().select_from().join()` (raises `AttributeError: 'Exists' has no 'join'` at runtime — would crash the first teacher ownership check in Attendance/Announcements); rewritten to `select(ClassTeacher.teacher_id).join(...).where(...).exists()`, verified against Postgres dialect in an isolated repro. **TESTS ✅ (2026-07-01):** `tests/test_students.py` (72) + `tests/test_teachers.py` (41) = **113 passed, real run** (`155.16s`) against the live SESSION POOLER (psycopg loaded — genuine green, not skip-clean); full-dir collection now **253 tests** (was 140; +113, no import regression). **All 6 flagged cases exercised end-to-end, ZERO app defects found:** status matrix (10 allowed + 6 terminal→terminal 422 + same→same no-op), `section_archived` (fires on both `Class.is_archived` and year `archived_at` — the real Settings write sets `archived_at`; note the conftest `archive_seeded_active_year` helper flips `status` but not `archived_at`, so tests set it explicitly), `create_login` temp-password (once on create, None on plain, absent on GET/PATCH, hash≠plaintext, linked user `must_change_password=true`), rbac helper executes against Postgres correctly (owner passes, non-owner + profile-less both NotFound), 404-vs-403 discipline, soft-delete guards (`409 has_academic_history` / `409 teacher_has_active_assignments`). _(Test-side fix, not app: future-DOB tests used `+1 day` which tied the UTC server date; changed to `+3650 days`. Service's strict-future check is correct.)_ **⚠️ TWO PRODUCT-JUDGMENT FLAGS on the status matrix (not defects, confirm with stakeholder):** (1) `inactive → graduated/withdrawn/transferred` allowed directly (a paused student can jump straight to terminal without reactivating); (2) terminal → `active`/`inactive` (un-graduate / re-admit) allowed with only an audited `reason`, no extra approval guard. **Residual (low-risk, unverified):** multi-subject assessment sort order; `current_section` null-when-no-active-semester path; concurrency race on partial-unique-index backstop (pre-check 409s are tested). **Real frontend + orval regen for 7.3 still pending** (deferred — see DEMO note).

> **🎬 CLIENT DEMO BUILD — ✅ COMPLETE (2026-07-02), PARALLEL TRACK, does NOT replace the real per-module build.** Verified: `tsc -p tsconfig.app.json` exit 0, `npm run build:demo` exit 0 (2336 modules), dev server boots (HTTP 200) with `mockServiceWorker.js` served. ALL 9 modules built (Dashboard, Students, Teachers, Classes, Assessments, Grades, Attendance, Announcements, Reports) + Settings + Auth, all MSW-backed offline. Integration pass done: (1) role→seeded-user resolver reconciled — every handler now maps the "teacher" demo session to the SAME canonical seeded teacher `user-teach-1` (Maria Reyes) and "student" to `user-stu-1` (Ana Lopez), so data reconciles across tabs (announcements.ts had used user-teach-3; fixed); (2) `NotificationsBell` unread count wired to `useUnreadCount()` in AppShell (was hardcoded 0; falls back to 0 in real-backend mode where the endpoint 404s). Stakeholder requested a frontend-only, no-backend, no-DB demo with FAKE DATA to show the client. **Launch: `cd frontend && npm run demo`** → http://localhost:5173; log in by typing a role as the username (`principal`/`secretary`/`teacher`/`student`) + ANY password. (`npm run build:demo` for a static bundle.) Real dev/build behavior unchanged (`npm run dev` keeps mocks OFF → real backend via Vite proxy to :8000).
> - **Foundation ✅** — `frontend/src/shared/api/mocks/demo/{dataset,data,selectors,types}.ts` = ONE coherent fake Belize secondary school ("Belmopan Comprehensive High School"): 45 students, 12 teachers, 8 sections, 11 subjects, 54 class_subjects, 216 assessments, 1192 grades, 440 attendance rows, 6 announcements — all reconciled via selectors (`dashboardFor`, `gradebookFor`, `computeTermGrade`, `attendanceFor`, etc.). MSW restructured into per-module `handlers/*.ts` aggregated by `handlers/index.ts`. Promoted components: StatCard, ChartWithTable, CollapsibleSection, PrintLayout, DetailTabs. `DEMO_TODAY='2025-10-15'`.
> - **Modules ✅ (all 9 built + verified):** Dashboard (4 role variants), Students (list/detail/tabs), Teachers (directory/detail/create-login), Classes/Sections, Assessments, Grades (gradebook grid — marquee), Attendance (tablet register), Announcements, Reports (report card + transcript via PrintLayout). Settings + Auth already worked via MSW. Each `features/<m>/**` has real screens + hooks over the shared axios client; each `handlers/<m>.ts` mocks the api-spec endpoints from the dataset. (5 minor tsc errors from two limit-interrupted agents were fixed by the orchestrator.)
> - **This demo does NOT satisfy the real 7.3+ frontend acceptance criteria.** The real per-module frontend (orval-generated hooks vs live OpenAPI) is still pending. Demo screens are presentational + MSW-backed — a client preview, not production module code. _Resume real build: Module 7.3 frontend (orval regen students/teachers + real screens) → review, then Classes → Assessments → …_

> **OQ-DB2 — NEEDS STAKEHOLDER DECISION before 7.6 Grades hardens (flagged 2026-06-29).** Grading-band boundary convention unresolved: half-open `[min, next.min)` vs inclusive `.99` ceilings. The seed uses `.99` ceilings; the 7.2 validator (`settings/service.py::_validate_band_contiguity`) currently accepts BOTH (lenient) to tolerate the seed. Resolve to ONE convention so seed + validator + the eventual Grades letter-derivation agree. Low urgency now (validator correct, just lenient); must settle before 7.6 derive-on-read letters.
> **Accepted deviation:** `GET /settings/academic-years` + `/settings/semesters` return `{items:[...]}` not `Page[T]` (spec doesn't specify pagination; single school has few rows). `GET /settings/users` + `GET /subjects` use full `Page[T]`.

**Stand-up sub-phase 7.0 progress:** 7.0a app factory + CORS/cookie/logging wiring ✅ DONE (`app/main.py`, `app/core/cookies.py`; boots + serves OpenAPI/health with no DB; credentialed explicit-origin CORS). 7.0c pytest harness ✅ DONE (`tests/conftest.py` + smoke test green; transactional-rollback isolation against the shared Supabase DB, DB fixtures skip cleanly with no connection string). 7.0b Alembic migrations + RLS security baseline + seed ✅ DONE (`alembic/` + `versions/0001_initial_schema.py` + `app/db/seed.py`; verified against live Supabase: 28 tables, RLS default-deny on all 28 + anon/authenticated REVOKEd, clean downgrade/upgrade 28→0→28, idempotent seed with `$argon2id$` principal, `alembic check` = zero ORM drift; DB left upgraded+seeded). _Reversibility re-confirmed 2026-06-27 by inspecting `downgrade()` (disables RLS, drops triggers + `set_updated_at()`, drops all tables reverse-FK-order, drops enums last, intentionally preserves shared extensions) rather than re-executing — the 28→0→28 round-trip already ran in the original 7.0b; re-running would needlessly drop the good seeded data._ 7.0d OQ-FE-A cookie smoke test and 7.0e orval codegen RE-SEQUENCED into the Auth module (7.1): both are gated on real auth endpoints existing — there is no `/login`/`/refresh` to set the `sis_refresh` cookie until 7.1, and orval against the current near-empty OpenAPI (only `/health`) would be throwaway churn. The CORS infrastructure half of OQ-FE-A was already verified in 7.0a (credentialed, explicit-origin, rejects unknown origins). **OQ-FE-A end-to-end cookie/CORS hard-reload test + orval codegen are now acceptance criteria of 7.1-Auth.** Sub-phase 7.0 (backend stand-up infrastructure) is COMPLETE. Then D17 module order: Auth → Settings → Students/Teachers → Classes → Assessments → Grades/Attendance → Announcements → Dashboard/Reports.

> **RESOLVED (cookie Path) — RATIFIED 2026-06-27 = `Path=/api/v1/auth`.** api-spec §2.3 had been internally inconsistent (set `/api/v1/auth/refresh`, but `POST /auth/logout` must READ the cookie to revoke its session and would never receive it at that path). Stakeholder ratified `/api/v1/auth` (narrowest path serving both `/refresh` and `/logout`; CSRF posture preserved — every non-auth endpoint uses the Bearer header). **api-spec §2.3 corrected; matches `app/core/cookies.py`.** Auth module (7.1) + orval/frontend use `/api/v1/auth`.
>
> **Dev/test DB = live Supabase Postgres** (project-ref `qriovbrkzqbrzneyskar`, PostgreSQL 17.6). **PERMANENT DSN = the Supabase SESSION POOLER (IPv4):** `...@aws-1-us-east-1.pooler.supabase.com:5432` (session mode/5432, user `postgres.qriovbrkzqbrzneyskar`, password `%40`-encoded). Reason (2026-06-29): the DIRECT host `db.<ref>.supabase.co` is IPv6-only and unreachable from the user's IPv4-only SSB corporate network (`getaddrinfo failed`) — which is what caused the 41-test all-skip. **Do NOT revert to the direct host.** Still NOT the 6543 transaction pooler (breaks DDL/prepared statements). Connection string lives in gitignored `backend/.env`. Alembic + the test conftest both read this same DSN.
>
> **OQ-FE-C partially resolved (2026-06-29):** Supabase project-ref = `qriovbrkzqbrzneyskar` → project URL `https://qriovbrkzqbrzneyskar.supabase.co`, storage public base `https://qriovbrkzqbrzneyskar.supabase.co/storage/v1/object/public/`. Project-ref/URL no longer blocks 7.2; the **anon key + bucket name** still need to be requested from the user when Settings/branding builds the logo upload. **Security baseline required in 7.0b migration:** app connects as `postgres` (table owner, BYPASSES RLS — so app-layer RBAC/ownership remain the real authz, NOT optional). But Supabase auto-exposes `public` over PostgREST to anon/authenticated API roles, so the migration MUST default-deny-RLS every public table + REVOKE privileges from anon/authenticated to shut that surface. **OQ-7.0-ROLE (open, non-blocking):** consider a dedicated least-privilege app role instead of connecting as `postgres`.

> **Backend scaffold already exists** (created 2026-06-27, after this tracker's prior 2026-06-26 update). See "Phase 7 — Backend scaffold" under Completed Work below for the verified inventory of what is built vs. missing.

---

## Phase Status Overview

| Phase | Name | Status |
|-------|------|--------|
| 1 | Requirements Analysis | ✅ Complete |
| 2 | System Architecture | ✅ Complete |
| 3 | UI/UX Design | ✅ Complete |
| 4 | Database Design | ✅ Complete |
| 5 | API Design | ✅ Complete |
| 6 | Frontend Foundation | ✅ Complete |
| 7 | Core Modules | 🟡 In progress (7.0 backend stand-up) |
| 8 | Quality Assurance | ⬜ Not started |
| 9 | Security Review | ⬜ Not started |
| 10 | Code Review | ⬜ Not started |
| 11 | Release Readiness | ⬜ Not started |

---

## Completed Work

**Phase 7 — Backend scaffold** (created 2026-06-27 by `backend-engineer`; verified by orchestrator) — pre-stand-up groundwork
- FastAPI modular monolith scaffolded at `C:\Users\arhernandez\source\repos\school-management-system\backend\`. `pyproject.toml`: FastAPI 0.115.6, uvicorn 0.34, SQLAlchemy 2.0.36, Alembic 1.14, Pydantic 2.10 + pydantic-settings, argon2-cffi 23.1, pyjwt 2.10, psycopg[binary] 3.2, python-multipart, email-validator; dev: pytest 8.3 + pytest-asyncio + httpx. `.venv` present; `.env.example` at backend root.
- **Built & verified:** `app/config.py` (pydantic-settings + fail-fast `validate_runtime()` guarding default JWT_SECRET outside `local` and rejecting `*` in credentialed CORS; `cookie_secure` derived from environment). `app/core/`: `deps.py` (`get_db`, `get_current_user` Bearer→live-user load + is_active gate, `require_role`), `errors.py` (full `ErrorResponse` envelope + handlers: AppError hierarchy, 422 normalization, bare-HTTPException mapping, last-resort 500 with request_id, no stack/SQL leak), `security.py` (Argon2id hash/verify/needs_rehash, HS256 JWT access tokens, jti-prefixed opaque refresh token stored as SHA-256, temp-password gen, password-policy validator), `logging.py`, `pagination.py`, `rbac.py`. `app/db/` (base, models aggregator, sync engine session w/ pool_pre_ping, types). `app/common/` (`enums.py`, `schemas.py` incl. `Page[T]`, `ErrorResponse`/`ErrorBody`, `CurrentUser` w/ nested `preferences`, and all `*Ref` read models). `app/modules/auth/schemas.py` (Login/ChangePassword/ResetPassword + AuthTokenResponse).
- **SQLAlchemy models for all entities, across 12 code folders** (`auth, users, students, teachers, classes, settings, assessments, grades, attendance, announcements, reports` — NOTE: `users` (User, UserPreferences) is split from `auth` (LoginAttempt, PasswordResetToken, RefreshSession); the project's 11 *functional* modules are unchanged). `Base.metadata` imports clean (orchestrator ran it): **28 tables** registered — the 27 in `database-schema.md` plus `student_documents` (the deferred D28/OQ-API-7 write-nothing table; model materialized, unused in v1). Reconcile mentally: schema doc = 27 active, ORM = 28 incl. one deferred.
- **`rbac.py` ownership helpers implemented eagerly** (not stubbed): `assert_teacher_owns_class_subject` + `assert_teacher_owns_section`, both indexed `exists()` lookups resolving the teacher profile server-side, denial→`NotFound` (404-vs-403 discipline). Co-teachers pass (D-Q9).
- **MISSING (the work of sub-phase 7.0):** `app/main.py` (app factory + router/exception/CORS/logging/cookie wiring), all API routers/endpoints, the service layer, Alembic env + migrations, seed script, `tests/` (does not exist).

**Phase 0 — Setup**
- Project location: `C:\Users\arhernandez\source\repos\school-management-system`
- `/docs` folder + stubs for all phase documents created.
- `project-overview.md` authored (stable project definition, roles, fixed tech stack, module list).

**Phase 6 — Frontend Foundation** (delegated to `frontend-engineer`) — first code phase
- React app at `C:\Users\arhernandez\source\repos\school-management-system\frontend\` (beside future `backend/`). Vite 5.4 + React 18.3 + TS 5.7 (strict) + MUI v6.1 + React Router 6.28 + TanStack Query 5.62 + Recharts 2.14 + axios 1.7 + RHF 7.54 + MSW 2.7 (dev mocks) + ESLint/Prettier.
- **Verified passing (orchestrator re-ran):** `npm install`, `tsc` typecheck (strict, 0 errors), `npm run build` (1331 modules, vendor chunks split), lint 0 problems, `npm run dev` serves.
- Foundation complete: MUI theme (D19 tokens via `colorSchemes`); feature-based tree (11 module placeholders + shared/theme/i18n); role-aware AppShell (TopBar + Sidebar + UserMenu + SemesterSwitcher + NotificationsBell); routing with `ProtectedRoute`/`RoleRoute` + 403/404 + per-role placeholders; auth (in-memory access token, bootstrap silent refresh, single-flight refresh, `withCredentials` for HttpOnly cookie); QueryClient + query-key factory; Loading/Empty/Error/PageHeader + ErrorBoundary; a11y baseline (skip link, landmarks, focus, reduced-motion).
- Dev MSW mock layer (auth surface only, flag-gated) → login→shell→nav works with no backend; swap to real API = flip flag + set base URL.
- Stubbed for Phase 7: 13 data/feature shared components (DataTable, ConfirmDialog, ChartWithTable, StatCard, FilterBar, etc.), all 11 modules' real functionality, OpenAPI-generated TS client.
- `frontend-implementation.md` authored. Decisions FE-1..FE-5.

**Phase 5 — API Design** (authored by `backend-engineer`, reviewed by `product-architect`)
- `api-specification.md` authored — REST `/api/v1`, OpenAPI-aligned, **89 endpoints** across 12 module groups (Auth 6, Dashboard 1 composite, Students 8, Teachers 6, Classes 12, **Subjects 4**, Assessments 8, Grades 8, Attendance 4, Announcements 7, Reports 7, Settings 18).
- Conventions: snake_case wire format (feeds generated TS client), `Page[T]` pagination (page/page_size/sort/filter), single `ErrorResponse` envelope with closed code vocabulary, 401-vs-403 + 404-vs-403 ownership discipline (no existence leaks).
- Faithful to decisions: **assessment-first** (no `POST /grades`; only `PUT /assessments/{id}/grades`, rejects non-enrolled with `422`, stamps `enrollment_id`); grades scoped to `class_subject`; attendance per-section; **transcript P/S-only (D26)** (`403` for teacher/student, no `/me` route); **teacher-controlled excused/drop-lowest (D25)**; server-derived student scope; server-side grade-release read filter; two ownership helpers as per-endpoint Authz deps; composite `/dashboard`.
- Review: `product-architect` → **Approve-with-changes**. 5 must-fix closed (M1 assessment status lifecycle → `POST /assessments/{id}/status`; M2 Subjects CRUD added; M3 transfer/term-grade provenance; M4 teacher→class_subject_id path; M5 makeup-score validation matrix) + 6 should-fix applied. Decisions API-1..API-19; OQ-API-1..7 resolved (2 stakeholder-facing items flagged below).

**Phase 4.5 — Post-validation reconciliation** (orchestrated across 4 specialists)
- Independent pre–Phase-5 validation (`principal-fullstack-engineer`): 8/12 ✅, surfaced the class↔subject blocker.
- Stakeholder decisions D23 (multi-subject section model) + D24 (multi-year transcript) propagated across ALL design docs:
  - `database-schema.md` (`database-engineer`): reworked to section model — `class_subjects` join, ownership rescoped to `(section,subject)`, term-grade regrained, transcript support, `announcement_reads` index. **27 tables.** (DB15–DB17)
  - `architecture.md` (`product-architect`): ownership helper split into `assert_teacher_owns_class_subject` + `assert_teacher_owns_section`; module breakdown + query-key examples updated; **OQ-DB8 resolved**.
  - `requirements.md` (`business-analyst`): "class"→SECTION wording across CLS/ASMT/GRD/ATT/RPT; new **FR-TRN-01..07** transcript block + user stories (US-PRIN/SEC/STD-10) + acceptance criteria §5.8; assumptions A-SECTION-MODEL, A-TRANSCRIPT-*.
  - `ui-design-system.md` (`ui-ux-designer`): Class(Section) detail + gradebook (per class_subject) + report card aligned; **new Transcript screen §7.10**; new `CollapsibleSection` component. Now **23 components, ~51 screens**.
- Result: all four docs mutually consistent; no Phase-5 blockers remain.

**Phase 4 — Database Design** (delegated to `database-engineer`)
- `database-schema.md` authored — implementation-ready PostgreSQL schema, **27 tables** (post-4.5) across 8 groups, normalized to ≥3NF (denormalizations justified).
- Groups: Identity/RBAC (users, refresh_sessions, password_reset_tokens, login_attempts, user_preferences), People & linkage (student_profiles, teacher_profiles — each 0..1 → users), Academic (academic_years, semesters, subjects, classes, class_teachers M:N, class_enrollments M:N), Assessment/Grading (grading_scales, grading_scale_bands, assessment_categories, assessments, assessment_grades, term_grade_snapshots), Attendance (attendance_records), Communications (announcements, announcement_reads), Documents (student_documents, report_card_snapshots), System (school_profile, audit_log).
- Includes Mermaid ERD, full per-table DDL-style definitions, constraints, indexes (gradebook/term-grade/attendance/My-pages/login hot paths), audit + soft-delete strategies, RBAC structures, assessment-to-grade calculation model, migration/seeding notes.
- **Assessment-first grading is structurally enforced:** `assessment_grades.enrollment_id` FK → `class_enrollments` makes "grades derive from the roster" FK-enforced — no insert path to fabricate a grade for a non-enrolled student. Term grades computed-on-read; letters derived-on-read against per-year configurable bands; archived years freeze into `term_grade_snapshots` + `report_card_snapshots` (jsonb).

**Phase 3 — UI/UX Design** (delegated to `ui-ux-designer`)
- `ui-design-system.md` authored (636 lines) covering: design principles, full MUI theme spec (palette/typography/spacing tokens ready for `createTheme()`), navigation model + per-role nav map, AppShell/layout system + responsive breakpoints, **22-component inventory** (incl. the 5 from architecture.md), **~50-screen sitemap** across all 11 modules with role tags, detailed ASCII wireframes for Login + all 4 role dashboards + Students list/detail + Class detail + Attendance + Gradebook + Report card + Announcements, data-display/form/chart patterns, WCAG 2.1 AA accessibility spec, interaction/feedback patterns.
- Phase-impact flags raised for Phase 4 (per-user display-preferences store; student/teacher↔user linkage for "My…" pages) and Phase 5 (composite `/dashboard` payload shaped to the 4 dashboard specs; `Page[T]`+sort/filter contract; server-side grade-release filter).

**Phase 2 — System Architecture** (authored by `product-architect`, reviewed by `staff-eng-tech-lead` + `principal-fullstack-engineer`)
- `architecture.md` authored covering: system overview + diagrams, technology decisions (O1 resolved), auth/RBAC model, 11-module breakdown, frontend + backend folder structures, TanStack Query/state strategy, cross-cutting concerns, NFR alignment, phased-delivery notes.
- Both reviewers returned **Approve-with-changes**; 10 refinements (5 must-fix authz/scoping items + 3 should-fix + 2 nice-to-have) were folded back into the doc. No redesign required.
- Key fixes pinned: `class_teacher` many-to-many ownership w/ single `assert_teacher_owns_class` helper; user→student/teacher identity linkage with server-derived student scoping; server-side grade-release filter; server-side refresh-token store; cross-origin cookie/CORS posture; compute-on-read term grades; bootstrap silent refresh + single-flight; archived-year grade freezing.

**Phase 1 — Requirements Analysis** (delegated to `business-analyst`)
- `requirements.md` authored (~330 lines). Contents:
  - In-scope / out-of-scope definition for v1.
  - Roles × Modules permission matrix (4 roles × 11 modules, with capability levels).
  - **75 functional requirements** across 11 modules (AUTH 10, DASH 6, STU 10, TCH 7, CLS 8, ASMT 8, GRD 10, ATT 9, ANN 7, RPT 7, SET 7).
  - **38 user stories** (Principal 9, Secretary 9, Teacher 11, Student 9).
  - Given/When/Then acceptance criteria for all 7 core flows (login, attendance, assessment creation, grade entry, report card, announcements, enrollment).
  - Non-functional requirements (usability, performance, WCAG accessibility, security/privacy, browser support, responsiveness, localization).
  - Assumptions + open questions for stakeholder.

---

## Pending Work

- **Phase 7 sub-phase 7.0 — backend stand-up (IN PROGRESS):** ✅ 7.0a app factory wiring (`backend-engineer`) — `app/main.py` + `app/core/cookies.py`; verified boots + serves OpenAPI/health without a DB, credentialed CORS, refresh-cookie helper honoring `sis_refresh`/HttpOnly/Secure/SameSite. ✅ 7.0c pytest harness (`testing-engineer`) — `tests/` green, transactional-rollback isolation, forward-compatible with `create_app`. ⏸ 7.0b Alembic migrations + seed (`database-engineer`) and ⏸ 7.0d OQ-FE-A cookie smoke test HELD pending the user's Supabase connection string. 7.0e orval codegen after OpenAPI is consumed. Added `backend/.gitignore` (repo is not yet a git repo; ensures `.env` is excluded once it is).
- **Phase 7 — Core Modules** (after 7.0): implement the 11 functional modules one at a time, in order (D17), backend-first per module. Per-module loop: backend-engineer → frontend-engineer → testing-engineer → review → update this tracker + `frontend-implementation.md`. Do NOT build ahead.
- Phases 8–11 not yet started.

---

## Pre–Phase-5 Validation Results (independent audit by `principal-fullstack-engineer`)

_Run 2026-06-25 against requirements.md + ui-design-system.md + database-schema.md (post-DB14)._ **8/12 ✅ fully supported, 4 ⚠️ partial. Overall: GO for Phase 5 conditional on the class↔subject decision below.**

| # | Checklist item | Verdict |
|---|----------------|---------|
| 1 | Every page/module backed by schema | ✅ (after D23 section rework — was the blocker, now resolved) |
| 2 | Every role permission has supporting tables | ✅ |
| 3 | Dashboard metrics queryable efficiently | ⚠️ Partial — school-wide Principal aggregates scan term-wide rows; OK at scale, design `/dashboard` deliberately |
| 4 | Assessment → Grade workflow | ✅ (assessment-first FK-enforced; DB14 policy; compute-on-read) |
| 5 | Transcript generation | ✅ (after D24 — FR-TRN added, Transcript screen §7.10 added, schema regrained) |
| 6 | Attendance history | ✅ |
| 7 | Announcements | ✅ |
| 8 | Documents | ✅ |
| 9 | Notification model | ⚠️ Partial — in-app announcements only (correctly scoped); add `announcement_reads(user_id)` index |
| 10 | User preferences | ✅ (`user_preferences`, FR-SET-05) |
| 11 | Audit logging | ✅ (inline AuditMixin + `audit_log`) |
| 12 | Academic year versioning | ✅ |

**BLOCKER (RESOLVED 2026-06-26):** Class↔Subject cardinality → stakeholder chose **multi-subject section model (D23)**. Schema reworked (`class_subjects` join, ownership rescoped, 27 tables); requirements/architecture/UI all reconciled. Blocker cleared.

**Non-blocking notes:** add `ix_announcement_reads_user (user_id)`; design composite `/dashboard` as one batched aggregate query (Phase 5), profile for materialized views in Phase 8; "needs setup" dashboard tiles via `NOT EXISTS`; OQ-DB7 still open for Phase 7-Grades.

---

## Decisions Made

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| D1 | Project folder name = `school-management-system` | No existing SIS repo; clear conventional name. | 0 |
| D2 | Frontend stack fixed: React + TS + MUI + React Router + TanStack Query + Recharts | Specified by stakeholder. | 0 |
| D3 | Backend/persistence tech deferred to Phase 2 | Frontend builds against a defined API contract regardless. | 0 |
| D4 | v1 is single-school / single-tenant | Bounds scope; flagged as blocking question Q1 to confirm. | 1 |
| D5 | Admin-provisioned accounts; no public self-registration | Standard for school systems; shapes auth design. | 1 |
| D6 | Out of scope for v1: billing, timetabling engine, parent portal, messaging/chat, LMS, multi-tenant, native mobile, offline | Keeps v1 focused on core SIS. | 1 |
| D7 | Default grading: weighted numeric + derived letter grade; terms/semesters structure | Reasonable K-12/secondary default; pending Q3 confirmation. | 1 |
| D8 | **Single school confirmed** (Q1) | Stakeholder confirmed single-tenant for v1. | 1 |
| D9 | **No formal compliance regime** (Q2 = O2). Standard security best practices (hashed passwords, RBAC, TLS); hosting region flexible. | Stakeholder: no FERPA/GDPR-style mandate, no data-residency rule. | 1 |
| D10 | **Academic structure = 2 semesters/year** (Q3) | Stakeholder confirmed. | 1 |
| D11 | **Grading = 0–100 numeric, system-derived letter grade** with configurable cutoffs (default A≥90, B≥80, C≥70, D≥60, F<60) (Q3) | Stakeholder confirmed; cutoffs editable in Settings. | 1 |
| D12 | **Backend = Python + FastAPI** (modular monolith); **DB = managed PostgreSQL** (SQLAlchemy 2.0 + Alembic). Resolves O1. | User's strongest stack; auto-OpenAPI feeds Phase 5; relational integrity-critical data needs an RDBMS. | 2 |
| D13 | **Auth = custom JWT**: in-memory access token + HttpOnly refresh cookie, Argon2id hashing, **server-side refresh-token store**, two-layer RBAC (role gate + ownership gate). | Self-contained, no IdP dependency; fits single-school/4-role model. | 2 |
| D14 | **Hosting = Railway** (API + Postgres) + **Vercel** (SPA); REST `/api/v1`; OpenAPI→generated TS client. | Both already used by the user; closes the Python↔TS type gap. | 2 |
| D15 | **Frontend structure = feature-based** (`features/<module>/` co-locating components/api/hooks/types) + `shared/` primitives. | Scales cleanly across 11 modules. | 2 |
| D16 | **Ownership model:** Teacher↔Class via `class_teacher` many-to-many; ownership = membership; **co-teachers get full edit rights in v1 (resolves Q9)**. Student scope server-derived from the principal, never client-supplied. | Single reusable authz helper; closes the highest-risk data-leak gap. **Confirmable with stakeholder.** | 2 |
| D17 | **Build order (Phase 7):** Auth → Settings → Students/Teachers → Classes → Assessments → Grades/Attendance → Announcements → Dashboard/Reports. Settings is foundation, not last-mile. | Settings (active term + grading scale) is a cross-cutting dependency. | 2 |
| D-Q4 | **Attendance = per-day** (stakeholder confirmed Q4) | — | 3 |
| D-Q9 | **Co-teachers get full edit rights** (stakeholder confirmed Q9; confirms D16) | — | 3 |
| D-Q6 | **Class over-capacity = warn-only** (default; confirmable before Phase 7-Classes) | More forgiving; matches real-world school behavior. | 3 |
| D18 | **Navigation = persistent left drawer + top app bar**, role-aware from a central permission map; app bar carries global active-semester switcher, announcements bell, user menu; mini-collapse on md, temporary overlay <900px. | Canonical MUI admin layout. | 3 |
| D19 | **Token-driven MUI v6 theme.** Primary `#1F5BA8`, secondary `#0E7C7B`; error `#C62828`, warning `#B26A00`, info `#0277BD`, success `#2E7D32`; 8px spacing + 8px radius; flat hairline-border surfaces; `textTransform:'none'`. | Trust/institutional tone, AA contrast. | 3 |
| D20 | **Light mode only for v1**; dark mode deferred but architected via `colorSchemes` (no hard-coded hex). | Reduce v1 surface; keep future path open. | 3 |
| D21 | **Comfortable-compact density** (dense tables, comfortable forms). | Data-dense admin tool. | 3 |
| D22 | **Responsive web, no native; tablet-first** for attendance/gradebook; phone bottom-nav deferred. | Teachers use tablets for attendance/grading. | 3 |
| DB1–DB13 | Full DB design decisions (see `database-schema.md` §12.1): **UUID PKs** on business tables (PII/enumeration resistance) — `audit_log` uses bigint identity; hybrid enum strategy; **per-academic-year grading scale**; **enrollment-provenance FK** on grades (assessment-first enforced); **freeze-on-archival** snapshots; single-row `school_profile`; **role-as-enum** (one role per user); hybrid audit; partial-unique soft-delete. | Implementation-ready, ≥3NF. | 4 |
| D23 | **Class = multi-subject SECTION / homeroom** (e.g. "Form 1A"). A section has one roster; many subjects are taught within it, each subject having its own teacher(s) and its own gradebook/assessments. A student enrolls in ONE section. Report card lists all subjects for the section. Resolves the Phase-5 blocker (Caribbean/Commonwealth model). | Stakeholder confirmed; matches Belize secondary-school structure. | 4.5 |
| D24 | **Multi-year transcript added to v1.** A transcript compiles a student's full academic record across all years (archived snapshots + current). Requires new FR + Phase-3 screen + Phase-5 endpoint; schema already capable. | Stakeholder confirmed (was implied by Phase-4 brief). | 4.5 |
| API-1..19 | Full API-contract decisions (see `api-specification.md` §10): snake_case wire; `/api/v1`; `Page[T]`; `ErrorResponse` envelope + closed codes; 404-vs-403 ownership discipline; two ownership-helper Authz deps; server-derived student scope; server-side release read-filter; **assessment-first / no `POST /grades`** (API-9); transcript P/S-only; warn-only capacity; **API-16** assessment status transitions via `POST /assessments/{id}/status`; **API-17** Subjects CRUD; **API-18** transfer/term-grade provenance (gradebook = grade-rows ∪ active-roster; term grade keyed per (student, class_subject, semester)); **API-19** makeup-score reject-not-ignore matrix. | Implementation-ready REST contract. | 5 |
| D27 | **Export = browser print/PDF** for v1 (resolves Q8/OQ-A/OQ-API-6). | Stakeholder confirmed; server-PDF additive later. | 5 |
| D28 | **Object storage = Supabase Storage** (resolves OQ-DB5/OQ-API-7) for school-logo upload; student-document CRUD deferred. | Stakeholder confirmed; consistent with existing Supabase usage. | 5 |
| FE-1..FE-5 | Frontend foundation decisions: axios (single-flight refresh), React 18 (not 19), hand-authored envelope types as temporary bridge until OpenAPI codegen, MSW dev mocks, vendor chunk-splitting now + route lazy-loading in Phase 7. | See `frontend-implementation.md`. | 6 |
| OQ-API-1..7 | Resolved: no idempotency-key v1; teacher-only authoring; co-teacher gradebook last-write-wins; archival `202` retry-safe + `409 no_active_semester` degrade; drop-lowest category-level-when-categories-exist; **browser print/PDF for v1** (no server-PDF); **defer `student_documents` CRUD** (write-nothing table in v1). | Architect-concurred; 2 items flagged to stakeholder (below). | 5 |
| D25 | **Grade exclusions are teacher-controlled & DB-persisted** (resolves OQ-DB7): teacher marks a grade `excused` (always excluded) and/or sets drop-lowest on their class_subject; values stored so the compute-on-read engine applies them. | Teacher owns pedagogical judgment on their gradebook. | 4.5 |
| D26 | **Transcript visibility = Principal + Secretary ONLY** (resolves OQ-TRN). Teachers: no transcript (gradebook only). Students: no compiled transcript in v1 (keep own report card/grades). | Stakeholder restriction. Student-own-transcript reversal flagged for confirmation. | 4.5 |
| DB15 | **Class = multi-subject SECTION; new `class_subjects` join** (section↔subject, surrogate PK, parents assessments/categories/teacher-assignments). `classes.subject_id` removed; `class_teachers`/`assessments`/`assessment_categories` rescoped to `class_subject_id`. Implements D23. | Caribbean/Commonwealth model; restores ≥3NF. | 4.5 |
| DB16 | **Multi-year transcript support, no new table.** Regrained `term_grade_snapshots` to per-(student, class_subject, semester) + frozen `subject_id`; transcript = archived snapshots ∪ live compute; new `ix_term_snapshot_student`. No stored GPA (overall average computed at assembly). Implements D24. | Reuses freeze-on-archival; name-stable across renames. | 4.5 |
| DB17 | Added `ix_announcement_reads_user (user_id)` for per-user unread-count anti-join. | Composite PK couldn't serve it (validation note). | 4.5 |
| DB14 | **Configurable assessment grading policy** (resolves OQ-DB1; supersedes hardcoded absent=0). New `assessment_policies` singleton + nullable override columns on `academic_years`/`assessment_categories`/`assessments` for `absent_as_zero`, `allow_makeup`, `drop_lowest_count`. Precedence: assessment → category → year → school-default (COALESCE, most-specific wins). New `grade_status` enum (**pending**/graded/absent/excused/exempt): pending & exempt & excused always excluded from averages; absent is policy-driven; `makeup_score` added. Resolved policy frozen into `term_grade_snapshots.effective_policy` (jsonb) at archival. Table count 25 → **26**. | Stakeholder: grading rules must be configurable, not hardcoded; pending grades must not affect averages. | 4 |

---

## Open Issues

| # | Issue | Status |
|---|-------|--------|
| O1 | Backend technology / hosting not yet decided. | ✅ RESOLVED (D12–D14) — FastAPI + Postgres + Railway/Vercel |
| O2 | Data residency / compliance regime for student data unconfirmed. | ✅ RESOLVED (D9) — no formal regime; best-practice security |

### Stakeholder questions — status after Phase 2
| # | Question | Status |
|---|----------|--------|
| Q1 | Single-school vs. multi-tenant | ✅ Resolved — single-school (D8) |
| Q2 | Data residency & compliance | ✅ Resolved — no formal regime (D9) |
| Q3 | Academic structure + grading scale | ✅ Resolved — 2 semesters; 0–100 + letter (D10/D11) |
| Q4 | Attendance granularity (per-day vs per-period) | ✅ Resolved — **per-day** (stakeholder confirmed) |
| Q5 | Password reset (self-service vs admin-initiated) | ✅ Resolved (2026-06-27) — **admin-initiated** |
| Q6 | Class over-capacity (warn vs hard-block) | ✅ Resolved (2026-06-27) — **warn-only** |
| Q7 | Grade re-derivation on scale change | ✅ Resolved (2026-06-27) — **derive-on-read; archived years frozen** |
| Q8 | Report export (browser/print PDF vs server PDF) | ✅ Resolved (2026-06-27) — **browser/print-to-PDF; no server PDF v1** (confirms D27) |
| Q9 | Co-teachers / shared-class edit rights | ✅ Resolved — **co-teachers get full edit rights (D16)** (stakeholder confirmed) |

> **All stakeholder questions Q1–Q9 are now resolved (Q5–Q8 confirmed 2026-06-27).** None gate their modules any longer.

### Phase 4 database open questions (OQ-DB) — confirm at relevant phase
- **OQ-DB1** — ✅ RESOLVED (DB14): grading rules are now **configurable per-assessment policy** (`absent_as_zero`, `allow_makeup`, `drop_lowest_count`); exempt/pending/excused always excluded. Supersedes the old absent=0 default.
- **OQ-DB7** — ✅ RESOLVED (D25): **teacher-controlled, DB-persisted.** A teacher marks a grade `excused` (per-grade `grade_status` → **always excluded** from the average) and/or enables drop-lowest (`drop_lowest_count` override on their class_subject/category, **stored**). Matches existing DB14 model — no schema change; permission = teacher edits these on class_subjects they own.
- **OQ-DB8** — ✅ RESOLVED: ownership helper split into `assert_teacher_owns_class_subject` + `assert_teacher_owns_section` (architecture.md §3.2 now matches schema).
- **Q8 / OQ-A / OQ-API-6** — ✅ RESOLVED (D27): export = **browser print/PDF** for v1. No server-generated PDF; server-PDF stays additive later via `report_card_snapshots.storage_key`.
- **OQ-DB5 / OQ-API-7** — ✅ RESOLVED (D28): object storage = **Supabase Storage**. School-logo upload (v1) targets it; `student_documents` CRUD still deferred (write-nothing in v1).

### Phase 6 frontend open questions (OQ-FE) — address during Phase 7 / backend integration
- **OQ-FE-A** *(scheduled — sub-phase 7.0d, HELD)* — cross-origin HttpOnly refresh cookie + credentialed-CORS **hard-reload smoke test** to run once the backend (7.0a) is live and sets the cookie (`SameSite=Strict/Lax` silently breaks refresh; needs `SameSite=None; Secure`). Frontend is fully wired. Gated on the Supabase connection string so the backend can boot against a real DB.
- **OQ-FE-B** — ✅ RESOLVED (2026-06-27): codegen tool = **orval** (generates TS types + TanStack Query hooks). Wired in sub-phase 7.0e once the backend serves OpenAPI; replaces the hand-authored bridge types (FE-3).
- **OQ-FE-C** — ✅ RESOLVED (2026-06-27): `VITE_SUPABASE_STORAGE_URL` comes from the **same Supabase project** used for dev/test Postgres. Concrete project-ref URL to be requested from the user when Settings/branding (7.2) is built.
- **OQ-7.0-DB (new, 2026-06-27)** — dev/test database = the user's **existing Supabase Postgres** (consistent with D28). Connection string + project-ref must be requested from the user and pasted into a gitignored `.env`; never invented/hardcoded. Test isolation via transactional-rollback fixture or throwaway schema against the same DB (approach decided in 7.0c).
- **OQ-TRN** — ✅ RESOLVED (D26): **Transcript visible to Principal + Secretary ONLY.** Teachers have NO transcript access (only their assigned class gradebook). Students do NOT get the compiled multi-year transcript in v1 (retain own per-term report card + grades). _Inferred from stakeholder wording "only secretary and principal"; student-own-transcript reversal flagged for confirmation._
- **OQ-DB2** — grading-band storage: half-open `[min, next.min)` (recommended) vs inclusive `.99` ceilings.
- **OQ-DB3** — single-role-per-user confirmed; a future dual-role need would require a `user_roles` M:N table (not built).
- **OQ-DB4** — FR-ATT-05 no-future-date enforced in service layer; optional DB trigger as defense-in-depth (recommend service-only).
- **OQ-DB5** — object-storage target for logo/student documents/optional report PDFs (Railway volume / S3 / Supabase Storage) — does NOT affect schema; decide by Phase 6/7.
- **OQ-DB6** — retention windows: login_attempts >90d, audit_log 1y, expired refresh_sessions purged nightly.

### Phase 3 design open questions (OQ) — low-stakes, confirm when convenient
- **OQ-A** — Report export = browser-print PDF for v1 (ties to Q8). Confirm before Phase 7-Reports.
- **OQ-B** — Password-reset is admin-initiated (ties to Q5); UI copy reflects this.
- **OQ-C** — Optional self-hosted **Inter** font vs. system font stack (cosmetic; default = system stack).
- **OQ-D** — Phone bottom-nav deferred (tablet-first); confirm acceptable for v1.
- **OQ-E** — Notifications bell scope = in-app announcements only (no email/push), consistent with v1 out-of-scope.

---

## Next Steps

1. **(NEXT) Module 7.3 — Students/Teachers, backend-first.** Per the per-module loop: `backend-engineer` builds `app/modules/students/` + `app/modules/teachers/` (schemas/service/router) mounted via `MODULE_ROUTERS`, honoring the section model (a student enrolls in ONE section; server-derived student scope; 404-vs-403 ownership discipline) and the api-spec (Students 8 endpoints, Teachers 6). Then `testing-engineer` (live pooler DB, transactional-rollback isolation) → then `frontend-engineer` (+ orval regen) → review → update this tracker + `frontend-implementation.md`. Do NOT build ahead into Classes.
2. **Then remaining D17 module order**, one at a time, backend-first: Classes → Assessments → Grades/Attendance → Announcements → Dashboard/Reports. Per module: build (backend-engineer + frontend-engineer) → test (testing-engineer) → review → update `frontend-implementation.md` + this tracker.
3. **Deferred, non-blocking:** real school-logo upload (needs Supabase bucket name + anon key from the user — OQ-DB5/OQ-FE-C); OQ-DB2 grading-band convention must settle before 7.6 Grades hardens.

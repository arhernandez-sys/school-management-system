# API Specification — School Management System (SIS)

> **Phase 5 — API Design.** Owner: `backend-engineer` (primary author) → `product-architect` (contract review). This document is the implementation-ready, OpenAPI-aligned REST contract that the Phase 7 backend engineers implement and that the Phase 6 frontend consumes **via a TypeScript client generated from the FastAPI-emitted OpenAPI schema** (D14). It honors every locked decision in `progress-tracker.md` (D1–D26, DB1–DB17, D-Q4/Q6/Q9) and conforms to `architecture.md` (auth/RBAC/session model, the two ownership helpers, server-derived student scoping, server-side grade-release filter, composite `/dashboard`, `Page[T]`) and `database-schema.md` (the authoritative 27-table model).
>
> It does **not** write application code (Phase 7) or re-decide DB/UI/architecture questions — it formalizes the wire contract those phases build against. The DB schema is the source of truth for entities and constraints; this doc maps them to HTTP.

_Last updated: 2026-06-26 — Phase 5._

---

## Table of Contents

1. [API Conventions](#1-api-conventions)
2. [Authentication & Session Endpoints](#2-authentication--session-endpoints)
3. [Authorization Model in the Contract](#3-authorization-model-in-the-contract)
4. [Standard Envelopes & Shared Types](#4-standard-envelopes--shared-types)
5. [Endpoint Catalog (per module)](#5-endpoint-catalog-per-module)
6. [Pagination, Filtering, Sorting](#6-pagination-filtering-sorting)
7. [Error Handling & Status Codes](#7-error-handling--status-codes)
8. [Cross-Cutting Concerns](#8-cross-cutting-concerns)
9. [OpenAPI Alignment Notes](#9-openapi-alignment-notes)
10. [Decisions & Open Questions](#10-decisions--open-questions)

---

## 1. API Conventions

### 1.1 Base path & versioning
- **All endpoints are under `/api/v1`.** Version is a path prefix (not a header), so the generated TS client and browser network tab read unambiguously, and a future `/api/v2` can coexist during migration. Within `v1` we add fields/endpoints additively (non-breaking); a removal or semantic change forces `v2`.
- **Resource-oriented REST/JSON** (D14). Collections are plural nouns (`/students`, `/assessments`); a specific resource is `/{resource}/{id}`; sub-resources nest one level where ownership is structural (`/classes/{class_id}/subjects`). Verbs only for non-CRUD actions that don't map to resource state cleanly, expressed as a sub-path (`POST /assessments/{id}/release`, `POST /students/{id}/status`).

### 1.2 JSON casing — **`snake_case` on the wire, justified**
**Decision: request and response bodies use `snake_case` keys** (e.g. `student_number`, `class_subject_id`, `is_released`).

**Rationale (the load-bearing choice for the generated client):** FastAPI/Pydantic models are `snake_case` Python attributes and the auto-emitted OpenAPI schema names properties exactly as the Pydantic fields. The frontend consumes a **generated** TS client (D14), so the keys the SPA sees are whatever OpenAPI declares. Forcing `camelCase` on the wire would require a Pydantic `alias_generator` + `populate_by_name` on every model and `by_alias=True` on every serialization — a pervasive, error-prone layer that buys nothing, because **no hand-written frontend code types these keys**; the generated client does. We keep one casing end-to-end (`snake_case`), the OpenAPI schema is the single source of truth, and the contract cannot drift between Python and TS. (If a future hand-coded consumer wants idiomatic TS, the codegen tool can apply a `camelCase` transform at generation time without changing the server.)

- **Path/query params:** `snake_case` too (`?page_size=25&sort=full_name`), for consistency with body keys.
- **Enums** serialize as their lowercase string value, matching the Postgres native enum labels (`"present"`, `"graded"`, `"principal"`).

### 1.3 Date & time format
- **Instants** (timestamps) are **RFC 3339 / ISO 8601 UTC** strings with a `Z` suffix: `"2026-06-25T14:03:22Z"`. The DB stores `timestamptz` (UTC); the SPA formats locale-aware (NFR-LOC-01). Field names keep the `_at` suffix (`created_at`, `published_at`, `released_at`).
- **Calendar dates** (no time) are **`YYYY-MM-DD`** strings: `attendance_date`, `date_of_birth`, `enrollment_date`, `assessment_date`. These map to Postgres `date` / Pydantic `date`.
- The server **never** trusts a client-supplied "now" for security/temporal rules (lockout windows, no-future-date attendance) — it uses the server clock.

### 1.4 Content types & request shape
- Request/response bodies are `application/json; charset=utf-8`. The only exception is **file upload** for student documents and the school logo, which is `multipart/form-data` (binary part + metadata) — see §5.11.
- `Accept: application/json` assumed; the API returns JSON for all errors too (no HTML error pages).
- Unknown body fields are **rejected** (Pydantic `extra="forbid"`) on write endpoints, so a typo'd field name fails loudly (422) rather than being silently ignored.

### 1.5 Idempotency stance
- **GET, PUT, DELETE are idempotent by definition** and implemented as such (a repeated `DELETE` of an already-deleted resource returns `404`, not `500`).
- **Natural-idempotent upserts** are modeled explicitly where the UI needs them, keyed on a **stable composite natural key enforced by a unique index**, so a retried request reconciles rather than duplicates:
  - **Attendance** `PUT /attendance/class/{class_id}` upserts on `(class_id, student_id, attendance_date)` (FR-ATT-03).
  - **Grade entry** `PUT /assessments/{assessment_id}/grades` upserts on `(assessment_id, student_id)` (FR-GRD-01).
- **POST creates** (student, teacher, class, assessment, announcement) are **not** auto-idempotent. We do **not** introduce an `Idempotency-Key` header in v1 — write volume is low (single school), the UI disables submit while in-flight, and the natural-key unique constraints (`student_number`, `staff_number`, `email`, `(class_id, subject_id)`, …) already convert an accidental double-submit into `409 Conflict` rather than a duplicate row. Logged as a deliberate non-goal (§10, OQ-API-1).

### 1.6 Cross-origin & credentials
SPA (Vercel) and API (Railway) are **different origins** (architecture §3.1). CORS is **credentialed**: `Access-Control-Allow-Credentials: true` with an **explicitly allow-listed origin** (the `CORS_ORIGINS` env list) — never `*` with credentials. The refresh cookie is `Secure; HttpOnly; SameSite=None`. Mechanics in §2.

---

## 2. Authentication & Session Endpoints

> Implements FR-AUTH-01..10 and architecture §3.1. Module: `auth`. Tables: `users`, `refresh_sessions`, `password_reset_tokens`, `login_attempts`.

### 2.1 Token & cookie mechanics (shared by all auth endpoints)
- **Access token (JWT):** short-lived (~15 min, `JWT_ACCESS_TTL`), returned in the JSON body of login/refresh as `access_token`. The SPA holds it **in memory only** (never localStorage) and sends `Authorization: Bearer <token>` on every protected call. Claims: `sub` (user id), `role`, `exp`, `iat`, `jti`.
- **Refresh token:** longer-lived (~7 days, `JWT_REFRESH_TTL`), delivered **only** as an `HttpOnly; Secure; SameSite=None` cookie named `sis_refresh`. Never in a JSON body, never readable by JS. Each refresh token is 1:1 with a `refresh_sessions` row (server-side store, schema §3.A) keyed by `jti`, storing the **SHA-256 hash** of the token (raw token never persisted).
- **Refresh = rotation + store validation:** `/auth/refresh` validates the presented cookie against `refresh_sessions` (exists, not revoked, not past `expires_at`, within the idle window `now - last_used_at <= SESSION_IDLE_TIMEOUT`), then **rotates** (revokes the old row, issues a new refresh token + row) and mints a new access token. Rotation makes a replayed old token detectable (already revoked).
- **Idle timeout (FR-AUTH-10):** enforced on refresh via `last_used_at`; exceeding `SESSION_IDLE_TIMEOUT` refuses refresh → SPA must re-authenticate.
- **Logout / lockout / password-reset** revoke the relevant `refresh_sessions` row(s) server-side, so a session cannot be silently extended.

### 2.2 CSRF stance for the cookie
The refresh cookie is `SameSite=None` (required cross-origin), so it *is* sent on cross-site requests — CSRF must be addressed:
- The refresh cookie authorizes **exactly one endpoint**, `POST /auth/refresh`. It is **not** an ambient credential for the rest of the API — every other endpoint requires the `Authorization: Bearer` header, which lives in SPA memory (not a cookie) and which a cross-site attacker cannot read or set. So the broad API surface is inherently CSRF-immune.
- A forged cross-site `/auth/refresh` cannot read the response (CORS blocks it) and would merely rotate/burn the victim's token (self-healing on next login). To harden even that, `/auth/refresh` additionally requires a **custom header `X-Refresh: 1`** — browsers only send custom headers after a CORS preflight against our allow-list, which a malicious origin fails. This is the standard custom-header + credentialed-CORS CSRF defense; no CSRF token table needed.

### 2.3 Endpoints

#### `POST /auth/login`
- **Purpose:** authenticate by identifier + password; establish a session (FR-AUTH-01..04).
- **Authz:** `public`.
- **Request body:** `{ identifier: string (req, email or username, 1..255), password: string (req, 1..256) }`.
- **Success `200`:** `LoginResponse { access_token: string, user: CurrentUser }`; sets `Set-Cookie: sis_refresh=…; HttpOnly; Secure; SameSite=None; Path=/api/v1/auth`. _(Path ratified 2026-06-27 = `/api/v1/auth`, corrected from the earlier `/api/v1/auth/refresh`: the cookie must also reach `POST /auth/logout` to revoke its session; `/api/v1/auth` is the narrowest path serving both `/refresh` and `/logout`, and still keeps the cookie off the rest of the API per §2.2 CSRF posture.)_ Writes `login_attempts(succeeded=true)`, resets `failed_login_count=0`, sets `last_login_at`. If `user.must_change_password=true`, the SPA routes to forced change (only `/auth/me/password` is permitted until cleared).
- **Errors:** `401 invalid_credentials` (wrong identifier **or** password — non-enumerating, FR-AUTH-02; increments `failed_login_count`, logs attempt); `423 account_locked` (`locked_until > now`, FR-AUTH-07; body `{ retry_after_seconds }`); `403 account_inactive`; `429 rate_limited`; `422`.

#### `POST /auth/refresh`
- **Purpose:** silent re-issue of an access token (bootstrap + on 401), rotating the refresh token (architecture §3.1 single-flight on the client side).
- **Authz:** the `sis_refresh` cookie only + header `X-Refresh: 1` (§2.2). No `Authorization` needed.
- **Request body:** none.
- **Success `200`:** `RefreshResponse { access_token: string, user: CurrentUser }`; sets a **new** `sis_refresh` cookie (rotation); updates `last_used_at`.
- **Errors:** `401 refresh_invalid` (missing/expired/revoked/idle-timeout/not-in-store) — clears the cookie; SPA treats as anonymous (bootstrap) or session-ended (mid-session → re-auth modal). `429 rate_limited`.

#### `POST /auth/logout`
- **Purpose:** terminate the current session (FR-AUTH-05).
- **Authz:** `authenticated`; also reads the refresh cookie to identify the session row.
- **Success `204`:** revokes the current `refresh_sessions` row, clears the cookie. Idempotent (already-logged-out → still `204`). (Access tokens are short-lived and not individually revoked; the guarantee is the refresh token is dead.)

#### `GET /auth/me`
- **Purpose:** the principal's identity + role for bootstrap, guards, the permission map (architecture §3.2/§7.2).
- **Authz:** `authenticated`.
- **Success `200`:** `CurrentUser` (§4.4) — includes `student_profile_id`/`teacher_profile_id` when applicable (**informational**; scope is still server-derived, never a client echo).
- **Errors:** `401 unauthenticated`.

#### `PATCH /auth/me/password`
- **Purpose:** the signed-in user changes their own password (FR-SET-05; also satisfies forced first-change / post-admin-reset).
- **Authz:** `authenticated`; self only (subject = principal, never a param).
- **Request body:** `{ current_password?: string (required UNLESS must_change_password=true), new_password: string (req, meets policy: min length + complexity, FR-AUTH-09, server-validated) }`.
- **Success `204`:** updates `password_hash` (Argon2id), clears `must_change_password`, **revokes all other `refresh_sessions`** for the user (keeps the current, rotated one).
- **Errors:** `401` (bad `current_password`), `422 weak_password` (human message), `401 unauthenticated`.

#### `POST /auth/users/{user_id}/reset-password` — **admin-initiated reset (D5/Q5)**
- **Purpose:** Principal/Secretary triggers a reset for another user (FR-AUTH-08, FR-SET-04). v1 = admin-initiated (no self-service email).
- **Authz:** `require_role(principal, secretary)`; **privilege guard: a Secretary may NOT reset a Principal** (FR-SET-04 reserves role-level admin to the Principal).
- **Path:** `user_id` (target).
- **Request body:** `{ delivery?: "temp_password" | "reset_link" }` (v1 default `temp_password`).
- **Success `200`:** sets `must_change_password=true`, **revokes all the target's sessions**, returns a generated **temporary password once** (`{ temporary_password: string }`) for out-of-band delivery (D5; no email dependency). Writes `audit_log("user.reset_password")`.
- **Errors:** `403` (Secretary→Principal, or role denial), `404 user_not_found`, `409 cannot_reset_self` (use `/auth/me/password`).

> **Forced-change flow:** after login with `must_change_password=true`, the SPA routes to `/login/change-password`; the only permitted write is `PATCH /auth/me/password`. Other protected calls may be refused with `409 password_change_required` until cleared (can't be bypassed by URL).

---

## 3. Authorization Model in the Contract

### 3.1 The `Authz:` line convention
Every endpoint carries an explicit **`Authz:`** declaration with two parts:
1. **Role gate (coarse):** `require_role(...)` over {principal, secretary, teacher, student}. `public` = unauthenticated; `authenticated` = any role.
2. **Ownership/scope gate (fine):** one of the named checks below, or `—` if the role gate suffices.

This maps 1:1 to FastAPI dependencies: the role gate is `Depends(require_role(...))`; the ownership gate is a `Depends`/service call to a helper or the student-scope resolver. The frontend permission map (architecture §3.2) mirrors these for UX hiding, but **the server re-checks every call** (NFR-SEC-01).

### 3.2 The named ownership/scope checks (architecture §3.2 + schema §9, rescoped by D23)
- **`assert_teacher_owns_class_subject(user, class_subject_id)`** — passes iff a `class_teachers` row exists for `(class_subject_id, user→teacher_profiles.id)`. Used by **Grades, Assessments, the gradebook, class-subject-scoped Announcements**. Co-teachers pass identically (D-Q9). For grade/assessment writes, `class_subject_id` is resolved from the assessment.
- **`assert_teacher_owns_section(user, class_id)`** — passes iff the teacher owns **any** `class_subject` of the section (`class_teachers → class_subjects` join). Used by the **per-section daily attendance register** and **class-scoped announcements** (any subject teacher of the homeroom).
- **`student_scope(user)`** — resolves `user→student_profiles.id` from the principal and constrains every student-scoped query to it. **The target student id is NEVER taken from path/query/body for a student caller** — `/grades/me`, `/attendance/me`, `/students/me`, `/reports/report-card/me` all derive it from the token (architecture §3.2 hard rule).
- **`grade_release_filter`** — a server-side **read filter** (not an access gate) on student-facing grade/report reads: only rows with `COALESCE(assessment_grades.is_released, assessments.is_released) = true` are returned; Teacher (own)/Secretary/Principal **bypass** it. A student literally never receives unreleased data (architecture §8.5, FR-GRD-09).

### 3.3 404-vs-403 discipline (avoid leaking existence)
- **Record-ownership denial** on a PII/scoped resource (a teacher poking a `class_subject` they don't own; a student probing another student) → **`404 not_found`** so an attacker can't distinguish "exists but forbidden" from "absent" (NFR-SEC-02).
- **Role-level denial** of a route the role openly lacks (a Teacher hitting a Settings admin endpoint; a Teacher/Student hitting the Transcript, D26) → **`403 forbidden`**.
- Encoded per-endpoint in §5.

### 3.4 Permission matrix → contract (summary, mirrors requirements §2)
| Module | Principal | Secretary | Teacher | Student |
|---|---|---|---|---|
| Auth (own session) | full | full | full | full |
| Dashboard | view-all | view-all | view-own | view-own |
| Students | full | full | view-own (own classes) | view-own (self, RO) |
| Teachers | full | create-edit | view-all (RO) | none (403) |
| Classes/Sections | full | create-edit | view-own | view-own (enrolled) |
| Assessments | view-all | view-all | full (own) | view-own |
| Grades | view-all | view-all | create-edit (own) | view-own (released) |
| Attendance | view-all | view-all | create-edit (own) | view-own |
| Announcements | full | full | create-edit (own classes) | view-own (targeted) |
| Reports (report card/summaries) | all | all | own | own report card |
| **Transcript** | **any student** | **any student** | **none (403)** | **none (403)** |
| Settings | full | limited admin | account only | account only |

---

## 4. Standard Envelopes & Shared Types

> Defined once in `app/common/schemas.py` + `app/common/enums.py` (architecture §6) → reusable OpenAPI components flowing into the generated TS types (§9). Notation: `field: type`, `?` = optional/nullable, `[]` = array.

### 4.1 `Page[T]` — pagination envelope (NFR-PERF-02; architecture §7.1)
Every list endpoint returns this generic envelope (generic Pydantic model → one OpenAPI component per concrete `T`):
```
Page[T] {
  items:       T[]
  total:       int      // rows matching the filter
  page:        int      // 1-based current page
  page_size:   int      // effective page size
  total_pages: int      // ceil(total / page_size)
}
```
The SPA's `DataTable` binds directly to this; coming from the generated client, the frontend never hand-rolls a pagination type (architecture §7.1).

### 4.2 `ErrorResponse` — standard error envelope (architecture §8.1)
```
ErrorResponse {
  error: {
    code:    string                              // stable, machine-readable snake_case (closed vocabulary)
    message: string                              // human-readable, safe to show; never leaks internals
    fields?: { [field: string]: string[] }       // present on 422; per-field messages
    request_id?: string                          // present on 500 for correlation
  }
}
```
- `code` is from the closed vocabulary in the per-endpoint "Errors" lists, so the SPA branches without parsing prose.
- `message` is copy-safe, localizable (the SPA may map `code` → localized string, NFR-LOC-01).
- `500` returns `code:"internal_error"` + generic message + `request_id` — **never** a stack trace or SQL.

### 4.3 `ValidationError` shape (422)
FastAPI/Pydantic 422s normalize into the **same `ErrorResponse`** with `code:"validation_error"` and `fields` populated (so the SPA maps server errors back to inputs, UI §8.2):
```
{ "error": { "code": "validation_error", "message": "Some fields need attention.",
  "fields": { "max_score": ["Must be greater than 0."], "weight": ["Must be ≥ 0."] } } }
```

### 4.4 Common reusable types
```
CurrentUser {
  id: uuid; email: string; username?: string; full_name: string
  role: Role; must_change_password: bool; is_active: bool
  student_profile_id?: uuid     // iff role=student (informational; scope still server-derived)
  teacher_profile_id?: uuid     // iff role=teacher
  preferences: UserPreferences
}
UserPreferences { locale: string; theme: string; date_format?: string; default_page_size: int }
AuditStamp { created_at: datetime; updated_at: datetime; created_by?: UserRef; updated_by?: UserRef }
UserRef    { id: uuid; full_name: string; role: Role }            // lightweight actor (name/role only)
StudentRef { id: uuid; student_number: string; full_name: string }
TeacherRef { id: uuid; staff_number: string; full_name: string }
ClassRef   { id: uuid; name: string; grade_level: string; section?: string }
SubjectRef { id: uuid; name: string; code?: string }
ClassSubjectRef { class_subject_id: uuid; class_ref: ClassRef; subject: SubjectRef }
SemesterRef { id: uuid; name: string; sequence: int; is_active: bool }
AcademicYearRef { id: uuid; name: string; status: AcademicYearStatus }
SchoolIdentity { name: string; logo_url?: string; address?: string; contact_email?: string; contact_phone?: string }
```

### 4.5 Common enums (`app/common/enums.py` → OpenAPI string enums)
Matching the Postgres native enums (schema §1.5) exactly (lowercase labels):
```
Role                 = principal | secretary | teacher | student
StudentStatus        = active | inactive | transferred | graduated | withdrawn
TeacherStatus        = active | inactive
AcademicYearStatus   = active | archived
AssessmentType       = quiz | test | exam | assignment
AssessmentStatus     = draft | published | grading | graded
GradeStatus          = pending | graded | absent | excused | exempt      // DB-14
AttendanceStatus     = present | absent | late | excused
AnnouncementAudience = all | students | teachers | class
```
> Letter grades (A/B/C/D/F) are **NOT** an enum — they are derived-on-read from the configurable `grading_scale_bands` (D11) and returned as plain `string` (`letter: "A"`), so a school renaming bands doesn't break the schema.

---

## 5. Endpoint Catalog (per module)

> Per endpoint: **method + path**, **purpose**, **Authz** (§3.1), **params**, **request body** (field/type/req/validation), **success** (status + schema), **key errors**. Repeating CRUD patterns (create/edit/soft-delete of an admin-owned resource) are stated once and referenced. Entity field names track `database-schema.md` exactly.

### 5.0 Module index & endpoint counts

> **⚙️ RECONCILED AGAINST THE SHIPPED BACKEND, 2026-08-06 (D29).** Phase 7 is complete; the
> served OpenAPI (`backend/openapi.json`) is the authoritative surface — **77 path
> templates / 107 operations**. Where this document and the finished frontend disagreed,
> **the frontend won** and the spec has been corrected here; every such change is listed
> in §5.0a. The per-module counts below are the *operation* counts actually served.

| # | Module | Operations |
|---|---|---|
| 1 | Auth | 6 |
| 2 | Dashboard | 1 |
| 3 | Students | 10 |
| 4 | Teachers | 6 |
| 5 | Classes (subject classes: + class_subjects, teachers, **meetings**, enrollment, categories) | 19 |
| 5b | **Subjects (catalog — feeds the subject picker)** | 4 |
| 6 | Assessments (+ status + release + the grade write) | 10 |
| 7 | Grades | 4 |
| 8 | Attendance | 5 |
| 9 | Announcements | 8 |
| 10 | Reports (incl. Transcript) | 7 |
| 11 | Settings | 18 |
| 12 | **Calendar / Events (scope addition, 2026-07)** | 4 |
| 13 | **Timetable (D29 — Mon–Fri week)** | 2 |
| — | Health | 1 |
| | **Total** | **109** |

> **Count notes.** Module 5 (17) now includes the 4 assessment-category operations,
> which are served under `/classes/{id}/subjects/{cs}/categories`. Module 6 (10) includes
> `POST /{id}/status`, `POST /{id}/release`, `POST /{id}/unrelease` and
> **`PUT /assessments/{id}/grades`** — the grade write is mounted under `/assessments`
> because grading is assessment-first (§7, there is no `POST /grades`), but its logic
> belongs to the Grades module. Module 7 (4) is therefore the `/grades/*` reads only.
> Module 12 is a scope addition outside the original 11-module charter — see
> `project-overview.md` §4 for its provenance.

### 5.0a Corrections applied 2026-07-28 (frontend is binding)

The finished frontend is the contract. These paths/shapes in earlier revisions of this
document did not match what it calls, and have been corrected:

| Was specified as | Actually served | Why |
|---|---|---|
| `GET/PUT /attendance/class/{class_id}` | `GET/PUT /attendance?section_id=&date=` | `features/attendance/api/attendanceApi.ts` |
| `GET /attendance/class/{id}/history` | `GET /attendance/summary?section_id=` | same |
| — | `GET /attendance/sections` | picker the spec never listed |
| `GET /reports/report-card/{student_id}` | `GET /reports/report-card?student_id=` | `features/reports/api/reportsApi.ts` |
| `GET /reports/transcript/{student_id}` | `GET /reports/transcript?student_id=` | same |
| `GET /reports/class-grades/{class_id}` | `GET /reports/class-grades?class_subject_id=` | keyed by offering, not section |
| `GET /reports/attendance/{class_id}` | `GET /reports/attendance?section_id=` | query-param form |
| — | `GET /reports/students` | picker the spec never listed |
| — | `GET /grades/class-subjects`, `GET /grades/class-subject/{id}` | pickers/gradebook the spec never listed |
| — | `GET /announcements/target-classes` | compose picker the spec never listed |
| `PUT /classes/{cid}/subjects/{csid}/drop-lowest` | **not built** | no frontend caller; drop-lowest resolves category → year → school (schema §10.2a), which has no offering level |
| `GET /students/{id}/assessments` → `AssessmentSummary[]` (bare array), query `semester_id?` | `{items: StudentAssessmentGroup[]}`, query `academic_year_id?` | `features/students/api/studentsApi.ts` reads `res.data.items`; a bare array made it `undefined` and crashed the tab |
| `GET /students/{id}/years`, `GET /students/me/years` — *"deferred, deliberately"* | **built** | `studentsApi.getStudentYears` + `app/providers/YearContext.tsx` call them unconditionally; the student role 404'd on every page load |
| `GET /students` / `GET /students/{id}` — no `academic_year_id` | both accept `academic_year_id?` | the year switcher sends it on both; FastAPI silently dropped the undeclared param, so a past year showed the CURRENT section in the profile header while the assessments tab showed the past year's |

> **Correction to an earlier correction (2026-07-28).** This section previously recorded
> the two `/years` endpoints as deliberately deferred, on the belief that only the demo
> called them. It is not true of the finished frontend: `YearContext` fetches
> `/students/me/years` for every student session and the profile page's year filter
> fetches `/students/{id}/years`. Both are now served.

---

### Module 1 — Auth
Fully specified in **§2** (6 endpoints: `login`, `refresh`, `logout`, `me`, `me/password`, `users/{id}/reset-password`).

---

### Module 2 — Dashboard

#### `GET /dashboard`
- **Purpose:** the single composite, role-scoped landing payload (architecture §4 — one round trip, server-side scoping, no client fan-out). Shaped to the 4 dashboard specs (UI §7.2). FR-DASH-01..06.
- **Authz:** `authenticated`; payload shape & scope determined **server-side by the principal's role** — never a `role` query param.
- **Query:** `semester_id?: uuid` (default active semester; a past semester scopes the read, UI §3.1).
- **Success `200`:** a **role-discriminated union** `DashboardResponse` (literal `role` discriminator so the generated TS client narrows):
  - `PrincipalDashboard { role:"principal", semester: SemesterRef, stats:{ total_students:int, total_teachers:int, total_classes:int, attendance_rate:float }, enrollment_by_grade:{grade_level:string,count:int}[], attendance_trend:{period:string,rate:float}[], grade_distribution:{letter:string,count:int}[], recent_announcements: AnnouncementSummary[] }`
  - `SecretaryDashboard { role:"secretary", semester, stats:{ new_enrollments:int, classes_needing_setup:int, unassigned_students:int }, setup_tasks:{ type:string, label:string, ref_id:uuid }[], recent_enrollments: EnrollmentSummary[] }`
  - `TeacherDashboard { role:"teacher", semester, stats:{ my_classes:int, attendance_due_today:int, ungraded_items:int }, today_classes:{ class_id:uuid, name:string, attendance_recorded:bool }[], my_class_subjects:{ class_subject_id:uuid, class_ref: ClassRef, subject: SubjectRef }[], upcoming_assessments: AssessmentSummary[] }` ← `attendance_recorded` drives FR-ATT-08; `my_class_subjects` (and each `AssessmentSummary.class_subject_id`) give the teacher a **direct** `class_subject_id` for one-hop gradebook navigation (**M4**)
  - `StudentDashboard { role:"student", semester, stats:{ term_average?:float, term_letter?:string, attendance_rate:float, upcoming_count:int }, my_classes: ClassSummary[], recent_grades: GradeSummary[] /* released only */, upcoming_assessments: AssessmentSummary[], announcements: AnnouncementSummary[] }`
- **`AssessmentSummary`** carries `{ id, title, type, assessment_date?, max_score, class_subject_id, class_ref: ClassRef, subject: SubjectRef, status }` so any caller can jump from an assessment to its gradebook/class-subject without a second lookup (**M4**).
- **Scoping:** P/S = school-wide for the semester; Teacher = own `class_subjects`/sections; Student = `student_scope` + **grade_release_filter** (recent grades released only). All scoped to the active/chosen semester (FR-DASH-06).
- **N+1 avoidance:** §8.4 — a small set of batched aggregate queries in one service call.
- **Errors:** `401`; `409 no_active_semester` (Settings not configured) → SPA shows a setup prompt.

> **How the SPA obtains a `class_subject_id` (M4):** two equivalent paths, both supported. (a) **Direct** — the teacher dashboard's `my_class_subjects` and every `AssessmentSummary.class_subject_id` already carry it (one hop to the gradebook). (b) **Navigational** — section → `GET /classes/{id}/subjects` (the Subjects tab, each row has `class_subject_id`) → `GET /grades/class-subject/{class_subject_id}`. The gradebook route never receives a bare `class_id`; the contract always furnishes the `class_subject_id` upstream.

---

### Module 3 — Students
Tables: `student_profiles`, `class_enrollments`. FR-STU-01..10.

#### `GET /students`
- **Purpose:** searchable, filterable, paginated list (FR-STU-06; UI §7.3).
- **Authz:** `require_role(principal, secretary, teacher)`. **Teacher scope:** results auto-restricted to students enrolled in a section the teacher owns any subject of (`assert_teacher_owns_section` as a filter, read-only) — cannot list students outside own classes (FR-STU-08).
- **Query:** list params (§6) + `search` (name or `student_number`), `status: StudentStatus`, `class_id: uuid`, `grade_level: string`, `academic_year_id: uuid`. `sort` ∈ {`full_name`,`student_number`,`status`,`created_at`}; default `full_name`.
- **`academic_year_id` (year switcher) FILTERS the student set, it does not rescope rows.** A **past** year restricts the directory to students enrolled that year (ended enrollments included — `unenrolled_at` being set is the normal state for a past year). The **active** year, or no year at all, applies no enrollment filter so the whole directory lists, including graduated/withdrawn students who hold no active enrollment; filtering there would silently empty the `status=graduated` view. Each row's `current_section` always stays the student's **live** section — the field is named *current*, and the frontend's `studentListItem` resolves it with no year. Teacher scope (FR-STU-08) composes with the filter and is evaluated against the selected year's sections.
- **`religion`, `gender`, `program_id` (D32, brief §3).** Three attribute filters that AND with each other and with everything above — "all Female students in Programme X" is two of them together. They filter the **student record**, not their enrolment, so a graduated or withdrawn student still matches; filtering them through enrolment would silently empty the `status=graduated` view, the same trap the `academic_year_id` note above records. `religion` is **exact-match**, never a substring, because a LIKE would only conflate two real values ("Catholic" swallowing "Roman Catholic").
- **Success `200`:** `Page[StudentListItem]` `{ id, student_number, full_name, status, current_section?: ClassRef, guardian_name?, gender?, religion?, program_code? }`. The last three are D32: the printed list has to show what it was filtered by.
- **Errors:** `401`, `403` (student).

#### `GET /students/filter-options` *(D32)*
- **Purpose:** the values the directory's filters can actually take (brief §3).
- **Authz:** `require_role(principal, secretary, teacher)`.
- **Success `200`:** `{ religions: string[] }` — DISTINCT non-null religions present on non-deleted students, sorted.
- **Only `religion` is served, and it has to be:** it is free text collected on the admissions form (`applications.religion`, copied across on acceptance), so there is no enum to build a dropdown from and a hardcoded list would offer options matching nothing. `gender` is a fixed pair and programmes come from `/programs`.
- **Route order:** declared before `/students/{student_id}` so the literal wins — otherwise FastAPI parses "filter-options" as a UUID and 422s.
- **Errors:** `401`, `403` (student).

#### `GET /students/{id}`
- **Purpose:** detail header (FR-STU-07; UI §7.4 — tabs lazy-load via their modules).
- **Authz:** `require_role(principal, secretary, teacher)`; **Teacher** must own a section the student is enrolled in (else `404`, §3.3).
- **Query:** `academic_year_id?` — rescopes `current_section` to the section the student sat in **that year**, resolved by the same helper `GET /students/{id}/assessments` uses (`students.service.section_in_year`), so the profile header and the assessments tab can never name different sections for the same selected year. Branching is on the **presence** of the param: supplied and unmatched → `current_section: null`, never a fall-through to another year. Omitted → the live active-semester section. Authorization is unaffected — teacher ownership is still evaluated against live enrollments, so a past year cannot widen a teacher's reach.
- **Success `200`:** `StudentDetail { ...profile fields per student_profiles..., current_section?: ClassRef, audit: AuditStamp }`.

> **D33 (client asks 3 + 4) — `StudentDetail` and both write models now carry the whole
> admission form.** The nineteen Section A–E fields (`ssno`, `civil_status`, `religion`,
> `street`, `city_town_village`, `district`, `mother_name`, `father_name`, `nok_name`,
> `nok_relationship`, `nok_phone`, `has_health_condition`, `health_condition_note`,
> `atlib_exam`, `num_csec`, `finance_name`, `finance_phone`, `finance_email`,
> `enrollment_load`) are declared once in `schemas.py::_AdmissionProfileFields` and mixed
> into `StudentDetail`, `StudentCreateRequest` and `StudentUpdateRequest`.
>
> **No migration was needed** — every column has existed on `student_profiles` since
> `005_tertiary.sql`, and acceptance has been copying them across all along. What did not
> exist was any way to read or write them outside admissions, so a student registered
> directly had a permanently blank next of kin and D32's Religion filter selected on a
> column the Registrar could not see.
>
> Three deliberate asymmetries:
>
> * **`program_id` is accepted on `POST` only.** It also opens the first
>   `student_program_history` row (the Academic-history panel reads the history, not the
>   column). CHANGING a programme must close the open row and open a new one in the same
>   transaction, which is `PUT /students/{id}/program` (Dean only, §D12) — a `PATCH` field
>   would write the column and silently leave the history behind. `404 program_not_found`
>   for an unknown id, raised **before** the insert so it is not an FK error.
> * **`email` is read-only on `StudentDetail`**, derived from the linked `users` row.
>   `student_profiles` has no email column, and changing a login is a Users-module action.
> * **`PATCH` uses presence, not truthiness** (`model_fields_set`). An omitted field is left
>   alone; an explicit `null` clears it; and the two booleans can be set **false** —
>   un-ticking a health condition entered by mistake has to be possible.
>
> Documents, prior education and credit transfers stay on the APPLICATION: no file bytes
> exist anywhere (OQ-DB5), and a transfer is anchored on the application by policy (§D4).
- **Errors:** `401`, `403` (student → use `/students/me`), `404`.

#### `GET /students/me`
- **Purpose:** the student's own profile, read-only (FR-STU-09; UI `/me`).
- **Authz:** `require_role(student)`; `student_scope` (self).
- **Query:** `academic_year_id?` — rescopes `current_section` to the section the caller sat in that year, the same way `GET /students/{id}` does for staff. Added 2026-07-29: it was missing here, so "My Profile" kept showing the **current** section while every other student screen followed the global year·semester switcher — and a student sits in a different section each year, so the profile contradicted the rest of their session. **WHICH student is read still comes from the token alone** (§3.2 hard rule); the param narrows the caller's view of their own record and cannot reach anyone else's.
- **Success `200`:** `StudentDetail` (own). **Errors:** `401`, `403` (non-student), `404 no_student_profile` (defensive).

#### `POST /students`
- **Authz:** `require_role(principal, secretary)` (FR-STU-01,02).
- **Request body `StudentCreate`:**
  | field | type | req | validation |
  |---|---|---|---|
  | `student_number` | string | yes | unique among live students (FR-STU-02); 1..32 |
  | `full_name` | string | yes | 1..160 |
  | `date_of_birth` | date | yes | not in the future |
  | `gender` | string? | no | free/lookup text |
  | `enrollment_date` | date | yes | |
  | `status` | StudentStatus | no | default `active` |
  | `guardian_name`/`guardian_phone`/`guardian_email`/`address`/`phone` | string? | no | `guardian_email` is email-format |
  | `section_id` | uuid? | no | if present, enroll into this section for the active semester in the same transaction (FR-STU-05) |
- **Success `201`:** `StudentDetail`. `audit_log("student.create")`.
- **Errors:** `409 duplicate_student_number`, `409 section_archived`, `422`, `403`.

#### `PATCH /students/{id}`
- **Authz:** `require_role(principal, secretary)` (FR-STU-03). All `StudentCreate` fields optional; `student_number` change re-checks uniqueness. **`status` is NOT editable here** — lifecycle goes through the dedicated endpoint (auditable, guarded).
- **Success `200`:** `StudentDetail`. **Errors:** `404`, `409 duplicate_student_number`, `422`.

#### `POST /students/{id}/status`
- **Purpose:** lifecycle change (deactivate/transfer/graduate/withdraw) — FR-STU-04; never hard delete.
- **Authz:** `require_role(principal, secretary)`.
- **Request body:** `{ status: StudentStatus, reason?: string }`.
- **Success `200`:** `StudentDetail`. `audit_log("student.status_change", before/after)`.
- **Errors:** `404`, `422 invalid_transition`, `403`.

#### `DELETE /students/{id}`
- **Purpose:** soft-delete **only if** no academic history (FR-STU-10).
- **Authz:** `require_role(principal, secretary)`.
- **Behavior:** blocked if any `assessment_grades`/`attendance_records` reference the student (FKs `RESTRICT`).
- **Success `204`** (sets `deleted_at`). **Errors:** `409 has_academic_history` ("deactivate instead", UI §10.4), `404`.

#### `GET /students/{id}/assessments`
- **Purpose:** assessments for the subjects in the student's section, with that student's per-assessment result and computed term grade (Student-detail Grades/Assessments tab). FR-ASMT-06.
- **Authz (D32):** `require_role(principal, teacher)` — **the Registrar was removed** (brief §4: grade information leaves the registration screens). Teacher must own a section the student is in → else `404`. *(Student self uses `GET /grades/me`, §5.7.)*
- **Query:** `academic_year_id?` — scopes to the section the student sat in **that year** (a year spans both semesters, so this is *not* a semester filter). Default: the active year.
- **Success `200`:** `{ items: StudentAssessmentGroup[] }` — **an envelope, not a bare array** (§5.0a).
  - `StudentAssessmentGroup { class_subject_id: uuid, subject: SubjectRef|null, term_grade: { numeric: float|null, letter: string|null }, assessments: StudentAssessmentLine[] }`
  - `StudentAssessmentLine { id: uuid, title: string, type: AssessmentType, max_score: float, weight: float|null, assessment_date: date|null, status: GradeStatus, score: float|null, is_released: bool }`
- **Semantics:** `status` is the **student's grade status** (`pending` when no `assessment_grades` row exists), *not* the assessment's lifecycle status. `is_released` = `grade.is_released ?? assessment.is_released`. `score` is withheld (`null`) unless released **and** graded — but the row is still listed, because the viewer is an admin/teacher (contrast `GET /grades/me`, which drops unreleased rows). `draft` assessments are excluded. `term_grade` is computed by the single engine in `grades/calc.py` with `released_only=false`, so it is the true working average and may legitimately differ from the student's own `/grades/me` number while results are unreleased.
- **Errors:** `401`, `403`, `404`.

#### `GET /students/{id}/years`
- **Purpose:** the academic years the student was actually enrolled in — backs the per-student year filter on the profile page.
- **Authz:** `require_role(principal, secretary, teacher)` (teacher: owns a section the student is in → else `404`). **Student → 403** (use `/students/me/years`).
- **Success `200`:** `{ items: { id: uuid, name: string, status: AcademicYearStatus }[] }`, **newest first**. Resolved `class_enrollments → semesters → academic_years`; ended enrollments (`unenrolled_at` set) still count. **Errors:** `401`, `403`, `404`.

#### `GET /students/me/years`
- **Purpose:** same list for the signed-in student — backs the student-only top-bar year switcher (`app/providers/YearContext.tsx`).
- **Authz:** `require_role(student)`. Scope is server-derived from the token (§3.2), never a param.
- **Success `200`:** as above. **Errors:** `401`, `403`, `404 no_student_profile`.

> The Student-detail **Grades/Attendance tabs for an admin/teacher viewer** are served by `GET /grades?student_id=…` and `GET /attendance/class/{id}/history?student_id=…` (admin/teacher only; §5.7/§5.8), where `student_id` is a legitimate addressed param **for those roles** — never for a student caller (who is server-scoped).

---

### Module 4 — Teachers
Tables: `teacher_profiles`, `class_teachers`. FR-TCH-01..07.

#### `GET /teachers`
- **Purpose:** searchable directory (FR-TCH-05).
- **Authz:** `require_role(principal, secretary, teacher)` (Teacher = read-only directory, FR-TCH-07). **Student → 403.**
- **Query:** list params + `search` (name/`staff_number`), `status: TeacherStatus`, `specialization: string` (GIN array search).
- **Success `200`:** `Page[TeacherListItem]` `{ id, staff_number, full_name, email?, status, subject_specializations: string[] }`.

#### `GET /teachers/{id}`
- **Authz:** `require_role(principal, secretary, teacher)` (RO for teacher).
- **Success `200`:** `TeacherDetail { ...profile..., classes_taught:{ class_subject_id, class_ref: ClassRef, subject: SubjectRef, is_lead: bool }[], audit: AuditStamp }`.
- **Errors:** `401`, `403` (student), `404`.

#### `POST /teachers`
- **Authz:** `require_role(principal, secretary)` (FR-TCH-01).
- **Request body `TeacherCreate`:** `staff_number` (unique live), `full_name`, `email?` (contact), `phone?`, `status?` (default active), `subject_specializations: string[]?`, optional `create_login:{ email, role:"teacher" }` to provision the linked `users` account in the same transaction (admin-provisioned, D5).
- **Success `201`:** `TeacherDetail`. `audit_log("teacher.create")`.
- **Errors:** `409 duplicate_staff_number`, `409 duplicate_email`, `422`.

#### `PATCH /teachers/{id}`
- **Authz:** `require_role(principal, secretary)` (FR-TCH-03). **Deactivation = `POST /teachers/{id}/status` (Principal-only); role change = Settings users (Principal-only).** Benign profile edits only here.
- **Success `200`:** `TeacherDetail`.

#### `POST /teachers/{id}/status`
- **Purpose:** activate/deactivate (FR-TCH-03; Principal-only per requirements §2.1).
- **Authz:** `require_role(principal)`.
- **Behavior:** deactivating a teacher assigned to any active `class_subject` is **blocked** (FR-TCH-06) — reassign first.
- **Success `200`:** `TeacherDetail`. **Errors:** `409 teacher_has_active_assignments` (with offending `class_subject` refs for reassignment guidance), `404`, `403`.

#### `DELETE /teachers/{id}`
- **Authz:** `require_role(principal)` (FR-TCH-03,06). Blocked if assigned to any active `class_subject` (FK `RESTRICT`).
- **Success `204`.** **Errors:** `409 teacher_has_active_assignments`, `404`, `403`.

---

### Module 5 — Classes (subject classes: + class_subjects, teachers, meetings, enrollment)
The hub (**D29**). Tables: `classes` (the subject class), `class_subjects` (exactly one per class), `class_teachers`, `class_meetings`, `class_enrollments`, `subjects`. FR-CLS-01..09, FR-SCH-01/02. **All write paths reject mutations to a class whose academic year is `archived`** (FR-CLS-06; schema §5 rule 7) → `409 year_archived`.

> **D29 wire changes (breaking, intentional).**
> * `ClassListItem` / `ClassDetail` gained `subject`, `class_subject_id`, `teachers`,
>   `lead_teacher_id`, `meetings` — a subject-class row is unreadable without them, and
>   fetching them per row would be N+1 from the client.
> * `subject_count` is **gone** from `ClassListItem` (it is always 1).
> * `POST /classes` requires `subject_id`, and accepts `teacher_ids` + `meetings` so a whole
>   class is created in one request.
> * `EnrollmentResult.transferred` is **gone**; `schedule_conflicts` replaces it.

#### `GET /classes`
- **Purpose:** sections list.
- **Authz:** `require_role(principal, secretary, teacher, student)`. **Scope:** P/S = all; Teacher = classes they teach; Student = **every class they are actively enrolled in** (`student_scope` — a LIST under D29, not one row).
- **Query:** list params + `academic_year_id?` (default active), `grade_level?` (the year group a class is *for*), `subject_id?` (e.g. both Math classes), `search` (class name).
- **Success `200`:** `Page[ClassListItem]` `{ id, name, grade_level, section?, capacity?, enrolled_count:int, is_archived:bool, subject: SubjectRef?, class_subject_id?, teachers: TeacherRef[], lead_teacher_id?, meetings: ClassMeeting[] }`.

#### `GET /classes/{id}`
- **Authz:** P/S; Teacher (owns any subject → else `404`); Student (enrolled → else `404`, limited fields).
- **Success `200`:** `ClassDetail { id, name, grade_level, section?, capacity?, academic_year: AcademicYearRef, enrolled_count, over_capacity: bool, is_archived, subject: SubjectRef?, class_subject_id?, teachers: TeacherRef[], lead_teacher_id?, meetings: ClassMeeting[], audit: AuditStamp }`. `over_capacity` is the warn-only flag (D-Q6).

> **Naming (S5):** `over_capacity` (on `ClassDetail`/`ClassListItem`) is a **state** flag — "this section's roster currently exceeds `capacity`" — read any time. `over_capacity_warning` (returned by `POST .../enrollments`, §5) is an **action result** — "the enrollment you just performed pushed it over." Same underlying condition (D-Q6 warn-only), two intentionally distinct names: one is a persistent property of the section, the other is per-mutation feedback the SPA toasts. Neither ever blocks.

#### `POST /classes`
- **Authz:** `require_role(principal, secretary)` (FR-CLS-01).
- **Request body `ClassCreate`:** `name` (unique per active year among live), **`subject_id` (REQUIRED, D29)**, `grade_level` (the year group the class is for), `section?`, `capacity?` (>0 if set; **advisory** only, D-Q6), `academic_year_id?` (default active), `teacher_ids?`, `lead_teacher_id?`, `meetings?`.
- The class, its single `class_subjects` row, its teachers and its meetings are created in **one transaction** — a class with no subject cannot be graded, scheduled or enrolled into, so a partial create would leave an unusable row.
- **Success `201`:** `ClassDetail`. **Errors:** `409 duplicate_class_name` (per year), `404 subject_not_found`, `404 teacher_not_found`, `422` (incl. missing `subject_id`), `409 year_archived`.

#### `PATCH /classes/{id}` / `DELETE /classes/{id}`
- **Authz:** `require_role(principal, secretary)`.
- `PATCH` edits name/grade_level/section/capacity. `DELETE` soft-deletes **only if** no `class_subjects` carry history (FK `RESTRICT`) → else `409 class_has_history` ("archive instead", FR-CLS-08). Whole-year archival is a Settings action (§5.11).

#### Sub-resource: the weekly schedule (`class_meetings`) — FR-SCH-01/02

##### `GET /classes/{id}/meetings`
- **Authz:** anyone who can read the class (P/S any; Teacher owns; Student enrolled — else `404`).
- **Success `200`:** `MeetingsResult { meetings: ClassMeeting[], conflicts: [] }` where `ClassMeeting = { id, day_of_week:1..5, start_time, end_time, room? }`, ordered Mon→Fri then earliest-first. `conflicts` is always empty on a read.

##### `PUT /classes/{id}/meetings`
- **Authz:** `require_role(principal, secretary)`.
- **Request body `MeetingsReplace`:** `{ meetings: [{ day_of_week:1..5, start_time, end_time, room? }] }` — **REPLACES the whole week** (mirrors the teachers PUT). An empty list is valid and clears the schedule; replace-the-set means a retimed week cannot half-apply.
- **Success `200`:** `MeetingsResult { meetings, conflicts: ScheduleConflict[] }`.
- **`conflicts` IS NOT AN ERROR (FR-SCH-06).** A teacher or room double-booking, or a self-overlap in the submitted week, is **reported and the write still succeeds** — the same warn-only call as over-capacity enrollment (D-Q6). Clients must not treat `conflicts.length > 0` as failure. `ScheduleConflict = { kind: 'teacher'|'room'|'student', label, with_class_id, with_class_name, day_of_week, start_time, end_time, message }`; `message` is server-rendered so the identical sentence appears in every surface.
- **Errors:** `409 year_archived`, `409 subject_not_set` (a pre-D29 class with no offering has nothing to schedule), `422` (day outside 1..5, or `end_time <= start_time`).

#### Sub-resource: the class's subject (`class_subjects`) — FR-CLS-01a

##### `GET /classes/{id}/subjects`
- **Authz:** P/S; Teacher (owns any subject in section); Student (enrolled).
- **Success `200`:** `ClassSubjectItem[]` `{ class_subject_id, subject: SubjectRef, teachers: TeacherRef[], assessment_count:int, is_active:bool, actionable_by_caller: bool }` — `actionable_by_caller` true for P/S and for the **teacher who owns that specific subject** (others read-only), so the UI enables/disables per row (UI §7.5).

##### `POST /classes/{id}/subjects`
- **Authz:** `require_role(principal, secretary)` (FR-CLS-01a).
- **Request body:** `{ subject_id: uuid }`.
- **Success `201`:** `ClassSubjectItem`. **Errors:** `409 subject_already_in_section` (unique `(class_id,subject_id)` live), `404 subject_not_found`, `409 year_archived`.

##### `DELETE /classes/{class_id}/subjects/{class_subject_id}`
- **Authz:** `require_role(principal, secretary)`.
- **Behavior:** soft-delete **only if** no assessments/grades (FK `RESTRICT`) → else `409 class_subject_has_history` (retire via `is_active=false` instead, FR-CLS-08).
- **Success `204`.**

#### Sub-resource: teacher assignment (`class_teachers`) — FR-CLS-03, D-Q9

##### `PUT /classes/{class_id}/subjects/{class_subject_id}/teachers`
- **Purpose:** set the assigned teacher(s) (lead + co-teachers). **All assigned teachers get full edit rights** (D-Q9). Idempotent full-set replace (PUT).
- **Authz:** `require_role(principal, secretary)`.
- **Request body:** `{ teacher_ids: uuid[], lead_teacher_id?: uuid }` — `lead_teacher_id` must be within `teacher_ids`; `is_lead` is display-only (no rights impact).
- **Success `200`:** `ClassSubjectItem` (updated `teachers`). Reconciles `class_teachers` rows in one transaction; `audit_log("class_subject.assign_teachers")`. An **empty set is allowed** (offering temporarily unstaffed; Secretary dashboard flags "needs setup").
- **Errors:** `404 teacher_not_found`/`404 class_subject_not_found`, `409 year_archived`, `422`.

#### Sub-resource: class roster / enrollment (`class_enrollments`) — FR-CLS-02, FR-STU-05

##### `GET /classes/{id}/roster`
- **Authz:** P/S; Teacher (owns any subject → read-only roster); **Student does NOT get peer roster** (privacy, UI §7.5) → `404`.
- **Query:** `semester_id?` (default active); **`include?: "withdrawn"`** (S3) — by default the roster is **active-only** (`unenrolled_at IS NULL`); pass `include=withdrawn` to also return historical/withdrawn entries (each flagged) for an admin auditing who left the section mid-term.
- **Success `200`:** `RosterEntry[]` `{ enrollment_id, student: StudentRef, enrolled_at, unenrolled_at? }`. `unenrolled_at` is null for active members; present (and only returned) for withdrawn/transferred entries when `include=withdrawn`. Not paginated (a section is ≤ ~35).
- **Note (S3, ties M3):** the **roster** is active membership; a transferred/withdrawn student's *grade and attendance history* on this section does **not** disappear with their roster row — it remains in the gradebook (§5.7 read = grade rows ∪ active roster) and in `/grades/term` / report cards, keyed by `class_subject`+semester regardless of enrollment state.

##### `POST /classes/{id}/enrollments` — enroll (incl. bulk)
- **Purpose:** enroll one or more students into **this subject class** for a semester (FR-CLS-02, FR-STU-05).
- **PURELY ADDITIVE (D29) — it is NOT a transfer.** This endpoint used to `unenrolled_at`-stamp the student's active enrollment anywhere else in the semester, because a student could sit only one section. Under the subject-class model that is **data loss**: adding Freddy to Biology would silently drop him from Math. A student holds many concurrent enrollments; the only way to leave a class is `DELETE .../enrollments/{id}`.
- **Authz:** `require_role(principal, secretary)`.
- **Request body:** `{ student_ids: uuid[], semester_id?: uuid }` (default active). Idempotent — re-enrolling into the same class adds no second row.
- **Behavior (capacity):** **warn-only** (D-Q6) — enrollment **succeeds** even over `capacity`; response carries `over_capacity_warning: true`. The API never hard-blocks on capacity.
- **Behavior (timetable):** also warn-only. If the class's week overlaps one the student already sits, the clash is returned in `schedule_conflicts` and **the enrollment still succeeds** (FR-SCH-06).
- **Success `200`:** `{ enrolled: RosterEntry[], over_capacity_warning: bool, schedule_conflicts: ScheduleConflict[] }`. **`transferred` is GONE** (D29) — it reported behaviour that no longer exists. `audit_log` per student (`class.enroll`).
- **Errors:** `409 year_archived`, `404 student_not_found`, `422`.

##### `DELETE /classes/{class_id}/enrollments/{enrollment_id}` — withdraw from roster
- **Purpose:** remove from the section roster (FR-CLS-02). Sets `unenrolled_at` (keeps history); does not delete recorded grades/attendance.
- **Authz:** `require_role(principal, secretary)`.
- **Success `204`.** **Errors:** `404`, `409 year_archived`.

> **Enrollment is the assessment-first enforcement point (schema §3.D/§10).** There is **no** endpoint to create a grade for a non-enrolled student; grade rows seed from this roster (§5.7). Transfer/withdraw never fabricates or destroys grades — it stamps `unenrolled_at` and leaves history intact (FKs `RESTRICT`).

> **Withdrawn/switched-student grade provenance (M3) — the explicit contract.** D29 removed the automatic transfer, but a student can still **switch classes** — the office withdraws them from Math-1 and enrolls them into Math-2, two explicit actions. The provenance rules below are unchanged and still govern that case (read "transfers" as "is withdrawn from one class and enrolled into another"):
> 1. **Prior `assessment_grades` are preserved** — they reference the old `enrollment_id`, whose `class_enrollments` row still exists (it is only `unenrolled_at`-stamped, never deleted; the grade→enrollment FK is `RESTRICT`). No grade is moved, copied, or dropped on transfer.
> 2. **The prior section's gradebook still shows that student's historical rows.** The gradebook read (§5.7) is defined as **grade rows ∪ active roster**, *not* active roster alone: any student who has an `assessment_grade` for an assessment of that `class_subject` appears in the grid (flagged `withdrawn` so the teacher knows they left), so the data the teacher entered never becomes invisible. A purely-active-roster read would have hidden it — explicitly avoided.
> 3. **`/grades/term` and the report card aggregate per `(student, class_subject, semester)`** — they sum the student's `assessment_grades` for that subject+semester **regardless of which enrollment sourced each row**. A student who took half the term in section A and transferred to section B *for the same subject offering* would (in the section model, D23) have grades under whichever `class_subject` rows applied; each `(student, class_subject, semester)` term grade is computed independently from its own grade rows. The term grade is **not** keyed on `enrollment_id`, so a transfer never splits or double-counts it.
> 4. **The destination section's term grade starts empty** — the new enrollment seeds new `pending` rows only as the destination teacher creates/opens assessments there; the student's destination-subject term grade reflects only work done under the destination offering. There is no automatic carry-over of numeric grades across offerings (that is a manual academic decision the system does not model in v1).
> 5. **Attendance** behaves identically: prior `attendance_records` (referencing the old `enrollment_id`) remain in the prior section's history and summaries; the destination section accrues new daily records going forward.

---

### Module 6 — Assessments (assessment-first; FR-ASMT-01..08)
Tables: `assessments`, `assessment_categories`. **Created independently of any student**, scoped to exactly one `class_subject` + semester.

#### `GET /assessments`
- **Authz:** `authenticated`. **Scope:** P/S = view-all; Teacher = own `class_subjects`; Student (`scope=me`) = assessments for subjects in their enrolled section.
- **S6 — student visibility (FR-ASMT-06):** a student **sees the assessment itself** (title, type, `assessment_date`, `max_score`) for every **published** assessment in their subjects — so they can prepare — but the **`my_score`/`my_status` fields are omitted (null) until that assessment's grade is released** to them (grade_release_filter on the *score*, not the assessment). The whole assessment is **not** hidden. Draft assessments are not shown to students. *(Contrast `/grades/me` (§5.7), which lists graded results and **excludes unreleased assessments entirely** — that endpoint is about results, this one is about the upcoming/known assessment set.)*
- **Query:** list params + `class_subject_id?`, `class_id?` (all subjects in a section), `academic_year_id?`, `semester_id?`, `type?: AssessmentType`, `status?: AssessmentStatus`, `scope?:"me"`.
  - `academic_year_id` filters on the **section's** year; `semester_id` on the **assessment's own** `semester_id`. They **compose** — the student's global switcher sends both. Pairing a year with a semester from a *different* year intersects to nothing, and empty is the intended answer: showing one period's rows under another's heading is the mislabelling class of defect `/grades/me` was fixed for.
  - ⚠️ `semester_id` was specified here but **not declared by the endpoint until 2026-07-29**, so FastAPI silently dropped it — "My Assessments" listed a student's whole year under a heading naming one semester. Now honoured; pinned by `tests/test_year_scoping.py::TestAssessmentsSemesterFilter`.
- **Success `200`:** `Page[AssessmentListItem]` `{ id, title, type, class_subject: ClassSubjectRef, max_score, weight, assessment_date?, status, is_released, my_score?: number /* student scope, released only */, my_status?: GradeStatus /* student scope, released only */ }`.

#### `GET /assessments/{id}`
- **Authz:** `authenticated`; Teacher must own the `class_subject` (else `404`); Student must be enrolled in the section (else `404`); P/S any.
- **Success `200`:** `AssessmentDetail`. For a **student** caller the body omits aggregate stats and reflects only released info.

#### `POST /assessments`
- **Purpose:** create under a `class_subject` (FR-ASMT-01).
- **Authz:** `require_role(teacher)` **+ `assert_teacher_owns_class_subject(user, body.class_subject_id)`** (FR-ASMT, FR-GRD-10). *(P/S are view-all only — they do not author; see OQ-API-2.)*
- **Request body `AssessmentCreate`:**
  | field | type | req | validation |
  |---|---|---|---|
  | `class_subject_id` | uuid | yes | caller must own it (else `404`) |
  | `semester_id` | uuid | yes | must belong to the same active (non-archived) year as the section |
  | `category_id` | uuid? | no | if set, must belong to the **same** `class_subject` (service check, schema §5) |
  | `title` | string | yes | 1..160 |
  | `type` | AssessmentType | yes | |
  | `max_score` | number | yes | **> 0** (FR-ASMT-02) |
  | `weight` | number | no | **≥ 0**, default 1.00 |
  | `assessment_date` | date? | no | |
  | `absent_as_zero` / `allow_makeup` / `drop_lowest_count` | bool?/bool?/int? | no | per-assessment policy overrides (DB-14); `null` = inherit |
- **Success `201`:** `AssessmentDetail` (status `draft`, `is_released=false`). Optionally seeds `pending` grade rows for the current section roster (see §5.7 note).
- **Errors:** `404 class_subject_not_found` (or not owned — same code, §3.3), `422`, `409 category_subject_mismatch`, `409 year_archived`.

#### `PATCH /assessments/{id}`
- **Authz:** `require_role(teacher)` + `assert_teacher_owns_class_subject` (resolved from the assessment).
- **Success `200`:** `AssessmentDetail`. Lowering `max_score` re-validates existing grades → `409 scores_exceed_new_max` (lists offending students) so the teacher fixes scores first. **`status` is NOT settable here** — lifecycle transitions go through the dedicated endpoint below (M1), so the legal-transition set is enforced and audited in one place.

#### `POST /assessments/{id}/status` — assessment lifecycle transition (M1; FR-ASMT-04, AC 5.3)
- **Purpose:** move an assessment through `draft → published → grading → graded` (the `AssessmentStatus` the dashboard/list filter and AC 5.3 depend on). Created assessments default to `draft` (§5.6 `POST`).
- **Authz:** `require_role(teacher)` + `assert_teacher_owns_class_subject` (resolved from the assessment).
- **Request body:** `{ status: AssessmentStatus }`.
- **Legal transitions (forward, with one rollback for correction):**
  - `draft → published` — the assessment is visible to students (title/type/date/max; scores still gated by `is_released`, §8.3).
  - `published → grading` — the teacher has started entering scores (a UI signal; grade entry itself is allowed in `published` or `grading`).
  - `grading → graded` — all intended scores are in (no `pending` rows the teacher considers outstanding; not hard-enforced — a teacher may mark `graded` with some `excused`/`exempt`).
  - `published → draft` and `grading → published` — **single-step rollback** allowed for correcting a premature transition.
  - Any other jump (e.g. `draft → graded`, `graded → draft`) → **`422 invalid_transition`** (body names the current and attempted status).
  - **Release (`is_released`) is orthogonal** to `status` and is controlled only by `POST /assessments/{id}/release` (§5.7) — `graded` does **not** imply released, and an assessment can be released while still `grading`.
- **Success `200`:** `AssessmentDetail`. Writes `audit_log("assessment.status_change", from/to)`.
- **Errors:** `422 invalid_transition`, `404` (not found/owned), `409 year_archived`.

#### `DELETE /assessments/{id}`
- **Authz:** `require_role(teacher)` + ownership.
- **Behavior:** **blocked if any grades exist** (FK `RESTRICT`, FR-ASMT-07) — clear grades first (confirmed destructive flow).
- **Success `204`.** **Errors:** `409 assessment_has_grades`, `404`, `409 year_archived`.

#### Assessment categories (optional weighting groups) — FR-ASMT-01, D25
- **`GET /classes/{class_id}/subjects/{class_subject_id}/categories`** — Authz: `authenticated` scoped (P/S read-all; Teacher own; Student own classes). Lists categories with weights + policy overrides.
- **`POST` (same path)** / **`PATCH`/`DELETE /.../categories/{category_id}`** — Authz: `require_role(teacher)` + `assert_teacher_owns_class_subject`. Body: `{ name, weight (≥0), absent_as_zero?, allow_makeup?, drop_lowest_count? (≥0) }`. **`drop_lowest_count` is teacher-controlled & persisted here (D25, FR-GRD-11)** — most meaningful at category level. Success `200/201` `CategoryDetail`; `DELETE` → `204` (sets referencing assessments' `category_id` null, FK `SET NULL`). Errors: `409 duplicate_category_name` (per `class_subject`), `422`.

> *(Module 6 = 8 endpoints: list, detail, create, patch, delete, **status (M1)** + the categories `GET` and the categories write-family counted as one. The category write-family shares one path group.)*

---

### Module 5b — Subjects (catalog) — M2; FR-CLS-01a producer
The school-wide subject catalog (schema `subjects`, year-independent) that **feeds `class_subjects.subject_id`** — i.e. the subject picker the Secretary uses when adding a subject to a section (§5, `POST /classes/{id}/subjects`). Without this, `class_subjects` has no producer.

#### `GET /subjects`
- **Purpose:** the subject picker + catalog list (UI Class-detail Subjects tab "Add subject").
- **Authz:** `authenticated` (everyone may read the catalog; it's reference data with no PII). Read-only for non-admins.
- **Query:** list params + `search` (name/`code`), `is_active?: bool` (default `true` — the picker hides retired subjects).
- **Success `200`:** `Page[SubjectListItem]` `{ id, name, code?, is_active }`. Default sort `name`.

#### `POST /subjects`
- **Authz:** `require_role(principal, secretary)` (FR-CLS-01a — the Secretary sets up the academic structure).
- **Request body:** `{ name: string (req, 1..120, unique among live), code?: string (unique among live when present) }`.
- **Success `201`:** `SubjectDetail { id, name, code?, is_active, audit: AuditStamp }`. `audit_log("subject.create")`.
- **Errors:** `409 duplicate_subject_name`, `409 duplicate_subject_code`, `422`, `403`.

#### `PATCH /subjects/{id}`
- **Authz:** `require_role(principal, secretary)`. Edits `name`/`code`/`is_active`. Renaming is safe for history — transcript lines use the **frozen `subject_id`** (schema §10.6), so a rename never breaks a past transcript line. Setting `is_active=false` retires it from the picker without affecting existing offerings.
- **Success `200`:** `SubjectDetail`. **Errors:** `409 duplicate_subject_name`/`409 duplicate_subject_code`, `404`, `422`.

#### `DELETE /subjects/{id}`
- **Authz:** `require_role(principal, secretary)`.
- **Behavior:** soft-delete **only if** the subject is referenced by **no** `class_subjects` offering (live or historical — the FK is `RESTRICT`). A subject that has ever been taught is retired via `is_active=false`, not deleted (preserves transcript resolvability, schema §8).
- **Success `204`.** **Errors:** `409 subject_in_use` (message: "Taught in one or more sections — retire it instead"), `404`.

---

### Module 7 — Grades (FR-GRD-01..11; D25; the assessment-first no-manual-grade rule)
Tables: `assessment_grades`, `term_grade_snapshots`, `grade_revision_requests`. **Compute-on-read term grades; derive-on-read letters** (schema §10).

> **D32 (brief §4) narrowed who can reach this whole module, in two different ways.** Every
> `require_role(...)` listed below is superseded accordingly:
>
> - **The Registrar (`secretary`) is gone from every grade route, unconditionally.** There
>   is no setting for it: the client asked for the Register to lose grade visibility, and a
>   flag would have implied it is reversible from the UI. Everything else the Registrar owns
>   — students, enrolment, offerings, admissions (§D14) — is untouched, and they **keep report
>   cards and transcripts**, which is core registry work. `GET /students/{id}/assessments`
>   was closed to them too, as the grade information on a registration screen.
> - **A student reaches their own grades only while the Dean allows it.**
>   `require_student_grade_visibility` layers `assessment_policies.students_can_view_grades`
>   on top of the role check and answers `403 grades_hidden` when it is off. **Default off.**
>   Applies to `GET /grades/me`, `GET /grades/term`, `GET /reports/report-card/me`.
>
> Neither affects a Lecturer or the Dean. **Revision endpoints are not gated by the student
> switch** because a student can never see them anyway (`list_revisions` admits only the Dean
> and the requesting Lecturer) — which is also why a student is never told whether a revision
> was approved or denied: they see the resolved score and nothing about how it got there.

> **D32 (brief §1) also gated WHICH results may be revised.**
> `POST /assessments/{id}/grade-revisions` now requires all four of: the term's mid-term
> window has **closed**; the assessment was **created before** `midterm_submission_start`;
> the student's grade was **entered before** it (`graded_at`, falling back to `created_at`);
> and the assessment is in the **current** semester. Otherwise `422 revision_not_eligible`
> with the failing rule as `fields.assessment_id`. `GradebookCell.can_request_revision` +
> `revision_blocked_reason` carry the same verdict to the UI so the button and the endpoint
> cannot disagree. **Deciding and withdrawing are NOT date-gated** — a filed request must stay
> rulable even after the window moves, or it strands as pending forever.

> **D33 (client ask 7) — THE MID-TERM FREEZE. The window now stops grade ENTRY too.**
> D32 used `midterm_submission_start`/`_end` for one thing only: deciding whether a result
> had been part of the mid-term submission, and therefore whether it could be revised.
> Nothing stopped a mark being typed in while the window was running, so the snapshot the
> Dean freezes at its close was assembled from a set that could still move underneath it.
>
> `upsert_grades` — the single grade write path — now also calls
> `_assert_midterm_not_frozen`, which answers **`409 midterm_frozen`** while
> `midterm_submission_start <= now <= midterm_submission_end`, carrying both dates in
> `extra` (a freeze with no reopen date is unactionable — the Lecturer's next question is
> always wait-or-file-a-revision). The timeline is:
>
> | period | grade entry | changing a pre-`start` mark |
> |---|---|---|
> | before `start` | **open** — this is the mid-term submission period | n/a |
> | `[start, end]` | **FROZEN** `409 midterm_frozen` | refused, `midterm_window_open` |
> | after `end` | **open** — a new mark goes in normally | **revision** (D32 rules above) |
>
> **Both bounds are inclusive**, mirroring `midterm_revision_eligible`'s `now <= end`: if one
> were exclusive there would be a single instant in which a mark could neither be entered nor
> revised. Either date NULL → never frozen, the state of every semester created before D32.
> The Dean is exempt, matching `_assert_grade_window_open`. Checked **after** the end-term
> deadline, so when both are shut the caller gets `grade_window_closed` — the term being over
> is more useful than being told to wait for a window to reopen.
>
> `Gradebook` reports it in advance via **`midterm_frozen`** +
> `midterm_submission_start`/`_end` — a third flag rather than a value folded into
> `grade_window_closed`, because the three states are answered differently: `can_edit=false`
> means "not yours", `grade_window_closed` means "file a revision", `midterm_frozen` means
> "wait, until this date". Reported to every viewer, not just writers.
>
> `grade_submission_deadline` is unchanged and remains the END-TERM cutoff (D32-1).

> **D35 — `coursestatus`: how a student is sitting one offering.**
>
> `class_enrollments.enrollment_status` (`enrolled` / `audit` / `withdraw_passing` /
> `withdraw_failing`) has existed since `005_tertiary.sql` §8, which moved it off the
> client schema's `courses.coursestatus` — on the CATALOG, marking one student as auditing
> would have marked everyone taking the course. Until D35 it was **mapped and nothing
> else**: nothing set it and nothing read it.
>
> **Write:** `enrollment_status` on `POST /offerings/{id}/enrollments` (whole batch,
> defaults `enrolled`), and **`PATCH /offerings/{id}/enrollments/{enrollment_id}`**
> (Dean/Registrar) for one student. `409 enrollment_closed` on an un-enrolled row. The
> change is audited with before/after and the reason.
>
> **`PATCH` is not `DELETE`.** `DELETE` un-enrols — the row closes and the student leaves
> the roster, which says the registration was a mistake. A withdrawal says they SAT the
> course and left, so the row stays open and on the roster, because the transcript has to
> print `W/P` or `W/F` against it. Deleting it would erase the fact being recorded.
>
> **Consequences, which are most of the feature:**
>
> | | credit | GPA | academic-history bucket | transcript |
> |---|---|---|---|---|
> | `enrolled` | on passing | counted | `completed` / `failed` / `in_progress` | grade |
> | `audit` | none | **out entirely** | `audited` | `AU` |
> | `withdraw_passing` | none | **out entirely** | `withdrawn` | `W/P` |
> | `withdraw_failing` | none | **counts as a FAIL** | `withdrawn` | `W/F` |
>
> "Out entirely" means the credits leave the DENOMINATOR too. Leaving them in with no
> quality points against them would depress the GPA of a student who did nothing wrong —
> the same argument the `transferred` bucket makes.
>
> **`withdraw_failing` is the exception, by BAJC's ruling (2026-08-23):** *"w/f is a f
> because its like a student dropout while failing"*. Its credits stay in the denominator
> and it scores zero quality points, which is exactly what a fail does. The split is one
> named constant per module — `students/academics.py::_GPA_DROPPED` and
> `reports/service.py::GPA_DROPPED`, both `{audit, withdraw_passing}` — and it applies even
> when a mark already exists: the status outranks the result, so a passing mark left in the
> gradebook does not rescue the GPA.
>
> ⚠️ `_gpa_entries(exclude_cs_ids=...)` **does not drop a row** — it scores it as UNGRADED,
> keeping the credits in the denominator (it exists so a withheld `pending` row cannot let a
> student solve for the hidden mark). That is right for `W/F` and wrong for the other two,
> which have to be filtered out of the list instead.
>
> **The course status OUTRANKS the result** (`transferred > audit/withdrawn > result >
> enrolled > remaining`). The gradebook does not know about course status, so a lecturer can
> mark an auditing student and a withdrawal recorded after grades went in is ordinary; a
> graded-then-audited course must still earn nothing.
>
> A `notation` row on the transcript carries `numeric: null` and `letter: ""`, is out of the
> term average, and is printed anyway — the graded-only filter would otherwise drop the
> course, and a permanent record that omits a withdrawal is not a transcript.

#### `GET /grades/class-subject/{class_subject_id}` — the gradebook read
- **Purpose:** the grid: roster (derived from **enrollment**) × the subject's assessments, each cell carrying the student's grade row/status (UI §7.7). FR-GRD-01,04.
- **Authz:** `require_role(teacher, principal, secretary)`; **Teacher** must `assert_teacher_owns_class_subject` (else `404`); P/S read-only (view-all, FR-GRD-08).
- **Query:** `semester_id?` (default active).
- **Success `200`:** `Gradebook`:
  ```
  Gradebook {
    class_subject: ClassSubjectRef; semester: SemesterRef
    assessments: { id, title, type, max_score, weight, category_id?, is_released }[]
    categories?: { id, name, weight, drop_lowest_count? }[]
    rows: {
      student: StudentRef; enrollment_id: uuid; is_active_member: bool   // false = transferred/withdrawn, retained for history (M3)
      cells: { assessment_id, status: GradeStatus, score?: number, makeup_score?: number, is_released: bool, letter?: string }[]
      term_numeric?: number        // computed-on-read (null → "—" when all pending)
      term_letter?: string         // derived-on-read from active bands
      weight_base_used?: number    // explainability (schema §10)
    }[]
    drop_lowest_applied: bool
  }
  ```
- **Roster provenance (M3):** `rows` are the **union of (a) active `class_enrollments` of the section** for the semester **and (b) any student who has an `assessment_grade` for this `class_subject`** — *not* the active roster alone. So a newly-enrolled student appears immediately with all-`pending` cells (read side of assessment-first), **and** a transferred/withdrawn student keeps their already-entered rows visible (flagged `is_active_member=false`) instead of vanishing from the grid. Grade *entry* (`PUT`, below) still requires an active enrollment — historical rows are read-only for a non-member.
- **Errors:** `401`, `404`.

#### `PUT /assessments/{assessment_id}/grades` — grade entry/update (the ONLY grade-write path)
- **Purpose:** set/update score + status per `(assessment, enrolled student)` — bulk upsert for the assessment column (UI §7.7 save). FR-GRD-01,02,05; D25.
- **Authz:** `require_role(teacher)` **+ `assert_teacher_owns_class_subject(user, assessment.class_subject_id)`** (resolved from the assessment) (FR-GRD-10).
- **Request body:** `{ entries: GradeEntry[] }` where
  ```
  GradeEntry {
    student_id: uuid          // MUST be actively enrolled in the assessment's section
    status: GradeStatus       // pending|graded|absent|excused|exempt
    score?: number            // REQUIRED iff status=graded; else MUST be null
    makeup_score?: number     // only meaningful for status=absent + allow_makeup
  }
  ```
- **Validation & the no-manual-creation rule (explicit in the contract):**
  - For each entry, the server resolves the student's **active section enrollment** for the assessment's section + semester. **If the student is not enrolled, the entry is rejected (`422 student_not_enrolled`)** — there is no path to create a grade for a non-enrolled student. The row stamps `enrollment_id` (structural provenance, schema §3.D/DB-5).
  - Upsert key `(assessment_id, student_id)` — one row per student per assessment; a row is created **only** for an enrolled student against this **existing** assessment, never invented standalone.
  - `status=graded` ⇒ `0 ≤ score ≤ assessment.max_score` (FR-GRD-02, cross-row service check); other statuses ⇒ `score=null` (DB-14 check).
  - **`makeup_score` validation matrix (M5) — reject, do not silently ignore** (silent-ignore would lose teacher intent):
    - `makeup_score` present **and** `0 ≤ makeup_score ≤ assessment.max_score` is required when present (the DB enforces only the `≥ 0` floor; **the `≤ max_score` upper bound is a service check** against `assessments.max_score`) → else `422 score_exceeds_max` (field `makeup_score`).
    - `makeup_score` present on a row whose `status ≠ absent` → **`422 makeup_not_allowed`** ("Makeup score applies only to an absent result").
    - `makeup_score` present but the **resolved** `allow_makeup` policy (DB-14 precedence chain) is `false` for this assessment → **`422 makeup_not_allowed`** ("Makeups are disabled by the grading policy for this assessment").
    - When valid (`status=absent` + resolved `allow_makeup=true`), the makeup substitutes for the absent result in term-grade compute (schema §10.2b).
- **Success `200`:** `{ updated: GradeCellResult[] }` (each with recomputed `letter` for graded rows). The SPA invalidates the gradebook + affected students' term-grade keys (architecture §7.1). `audit_log("grade.update")` + `AuditMixin` (who/when, FR-GRD-06).
- **Concurrency (OQ-API-3, resolved):** the bulk upsert is keyed on the unique `(assessment_id, student_id)` constraint, so two co-teachers (D-Q9) saving the same assessment column concurrently **reconcile as last-write-wins per cell** — the later transaction's value stands, with `updated_by`/`updated_at` recording who set it. There is **no** optimistic-lock version in v1 (low contention, single school); the SPA reconciles its optimistic toggles from this response (UI §10.5). A future `If-Match`/version is an additive change.
- **Errors:** `422 student_not_enrolled`, `422 score_exceeds_max` (lists offenders; covers both `score` and `makeup_score`), `422 makeup_not_allowed`, `422 score_status_conflict`, `404` (assessment not found/owned), `409 year_archived`.

> **Contract statement — assessment-first, no manual grade creation (D23/D25; schema §3.D/§10):** *Grades are only ever created or updated through `PUT /assessments/{id}/grades`, against an existing assessment, for a student with an active section enrollment (proven by the stamped `enrollment_id`). There is deliberately **no** `POST /grades` accepting an arbitrary (student, subject, score) tuple. Term grades are **never** written by a client — they are computed-on-read (`/grades/term`, the gradebook's `term_numeric`) and frozen only by the system at year archival (Settings, §5.11).* This is the API-level expression of the schema's enrollment-provenance FK.

#### `GET /grades/term` — computed-on-read term grade(s)
- **Purpose:** per-`(student, class_subject, semester)` weighted term grade + derived letter (FR-GRD-04; schema §10.1–10.3). Powers report-card subject rows, the student dashboard average, and the transcript live-year compute.
- **Authz:**
  - **Student self:** `?scope=me` → `student_scope` + **grade_release_filter** (only released contribute; unreleased subjects shown as `pending`/hidden).
  - **Teacher:** `?class_subject_id=` they own (else `404`); no release filter (own oversight).
  - **P/S:** any `student_id`/`class_subject_id`/`class_id`; no release filter.
- **Query:** `student_id?` (P/S/Teacher addressing; ignored for student-self), `class_subject_id?`, `class_id?` (all subjects in a section), `semester_id?`, `scope?:"me"`.
- **Success `200`:** `TermGrade[]` `{ student: StudentRef, class_subject: ClassSubjectRef, semester: SemesterRef, numeric?: number, letter?: string, weight_base_used?: number, is_frozen: bool, effective_policy?:{absent_as_zero,allow_makeup,drop_lowest_count} }`. `is_frozen=true` when read from a `term_grade_snapshots` row (archived year).
- **Errors:** `401`, `403`/`404` per scope.

#### `GET /grades/me`
- **Purpose:** the student's own grades per assessment + term grade, **released only** (FR-GRD-07; UI "My Grades").
- **Authz:** `require_role(student)`; `student_scope` + `grade_release_filter`.
- **Query:** `academic_year_id?`, `semester_id?`, `class_subject_id?`.
- `academic_year_id` resolves which section's offerings are listed; `semester_id` (declared 2026-07-29 — specified before then but silently dropped) narrows within it. **`semester_id` also narrows the term average**, because it is threaded into the single `_assessments_for` call that feeds both the rows and `compute_term_grade` — so the number stays derivable from the marks shown instead of averaging the whole year beneath a one-semester heading.
- An explicitly-requested year or semester the student has no data in returns **empty**, never another period's marks — see the fallback guard in `get_my_grades` (defect fixed 2026-07-29). The current-enrollment fallback survives **only** for the "no year requested" case.
- **Success `200`:** `MyGrades { by_subject:{ class_subject: ClassSubjectRef, teacher?: TeacherRef, assessments:{ title, type, max_score, score?, status, letter?, assessment_date? }[], term_numeric?, term_letter? }[] }` — **unreleased assessments are excluded entirely** server-side.

#### `POST /assessments/{assessment_id}/release` / `POST /assessments/{assessment_id}/unrelease` — release control (FR-GRD-09)
- **Purpose:** release/retract an assessment's grades to the section's students — consequential, server-enforced (UI §7.7; architecture §8.5).
- **Authz:** `require_role(teacher)` + `assert_teacher_owns_class_subject`.
- **Request body (release):** `{ student_ids?: uuid[] }` — omit to release the whole assessment (`assessments.is_released=true`, the common case); supply ids for per-row release (`assessment_grades.is_released`). Unrelease mirrors.
- **Success `200`:** `{ assessment_id, is_released, released_count }`. `audit_log("grade.release"/"grade.unrelease")`. Effect: flips the value the **server-side read filter** keys on; students start/stop receiving the data on their next read — **not** a client hide.
- **Errors:** `404`, `409 year_archived`.

#### `PUT /classes/{class_id}/subjects/{class_subject_id}/drop-lowest` — teacher-set drop-lowest (D25, FR-GRD-11)
- **Purpose:** the teacher sets the **offering-level** stored drop-lowest fallback. Persisted; applied automatically by compute-on-read.
- **Authz:** `require_role(teacher)` + `assert_teacher_owns_class_subject`.
- **Request body:** `{ drop_lowest_count: int (≥0) }`.
- **Success `200`:** `{ class_subject_id, drop_lowest_count }`.
- **Placement model (OQ-API-5, resolved):** drop-lowest is **category-level when categories exist, offering-level otherwise.** When the offering uses `assessment_categories`, the meaningful drop-lowest is the **per-category** count (set via the categories endpoint, §5.6) — "drop the lowest N quizzes" within that category. This **offering-level knob sets only the year-inherited fallback** in the DB-14 precedence chain (it populates the offering's resolved `drop_lowest_count`, which sits *below* any category override); it **does NOT override a per-category count**. So a teacher who has set "drop lowest 2 quizzes" on the Quizzes category and then sets offering-level `drop_lowest_count=1` still drops 2 from Quizzes (category wins) and 1 from any uncategorized assessments. Schema §10.2a COALESCE order is unchanged: assessment → category → **offering/year fallback** → school default.
- **Note (D25):** `excused` is teacher-set per grade via normal entry (`status=excused`) and is **always excluded** — no separate endpoint. This endpoint covers only the stored drop-lowest knob. Both are teacher-controlled & persisted (resolves OQ-DB7 at the API).
- **Errors:** `404` (not owned), `422`, `409 year_archived`.

---

### Module 8 — Attendance (per subject class, per-day; FR-ATT-01..09; D-Q4, D29)
Table: `attendance_records`. **Per SUBJECT CLASS**, once per day (D29 — it was per homeroom; with no homeroom, the subject class is the only roster there is). A student can be present in Biology and absent in Math on the same day. D-Q4's per-day granularity is unchanged, and so is the wire shape: `class_id` / `section_id` still address a `classes` row, which is what they always did.

#### `GET /attendance/class/{class_id}` — daily register read
- **Purpose:** the attendance sheet for a section + date; full roster + existing rows (FR-ATT-02 default-present is a UI default). UI §7.6.
- **Authz:** `require_role(teacher, principal, secretary)`; **Teacher** must `assert_teacher_owns_section(user, class_id)` (any subject teacher of the homeroom, FR-ATT-09) → else `404`; P/S read-only.
- **Query:** `date: YYYY-MM-DD` (required), `semester_id?` (default active).
- **Success `200`:** `AttendanceRegister { class_ref: ClassRef, date, semester: SemesterRef, entries:{ student: StudentRef, enrollment_id, status?: AttendanceStatus, recorded_by?: UserRef, recorded_at?: datetime }[], last_recorded?:{ by: UserRef, at: datetime } }` — `status` null where not yet recorded; `last_recorded` surfaces "Last recorded by …" (FR-ATT-04).
- **Errors:** `401`, `404`.

#### `PUT /attendance/class/{class_id}` — bulk upsert the register
- **Purpose:** record/correct attendance for a section + date; upsert on `(class_id, student_id, date)` — no duplicates (FR-ATT-03), editable (FR-ATT-04). UI §7.6 save.
- **Authz:** `require_role(teacher)` + `assert_teacher_owns_section(user, class_id)`. *(P/S view-all only; they do not record — UI §7.6.)*
- **Request body:** `{ date: YYYY-MM-DD, entries:{ student_id: uuid, status: AttendanceStatus }[] }`.
- **Validation:**
  - **No future date (FR-ATT-05, service-enforced):** `date <= CURRENT_DATE` (server clock) → else `422 future_date_not_allowed`.
  - Each `student_id` must be actively enrolled in the section for the semester (stamps `enrollment_id`, mirrors grade provenance) → else `422 student_not_enrolled`.
- **Success `200`:** `{ upserted: int, summary:{ present:int, absent:int, late:int, excused:int } }`. Stamps `AuditMixin` (who/when, FR-ATT-04) + `audit_log("attendance.upsert")`.
- **Errors:** `422 future_date_not_allowed`, `422 student_not_enrolled`, `404`, `409 year_archived`.

#### `GET /attendance/class/{class_id}/history` — historical/summary read (FR-ATT-06)
- **Authz:** `require_role(teacher, principal, secretary)`; Teacher owns section (else `404`).
- **Query:** list params + `semester_id?`, `from?`, `to?` (dates), `student_id?` (per-student filter for the admin/teacher Student-detail Attendance tab), `view: "daily" | "summary"` (default `summary`).
- **Success `200`:** `view=daily` → `Page[AttendanceDay]`; `view=summary` → `AttendanceSummaryReport { per_student:{ student, present, absent, late, excused, pct_present }[], by_date:{ date, counts }[] }`.

#### `GET /attendance/me` — student's own (FR-ATT-07)
- **Authz:** `require_role(student)`; `student_scope`.
- **Query:** `academic_year_id?`, `semester_id?`, `from?`, `to?`.
- `academic_year_id` fans out to that year's semesters; `semester_id` (declared 2026-07-29) is applied **in addition**, not instead — a semester paired with a foreign year intersects to nothing, which is the intended empty rather than one period shown under another's heading. The `summary` is computed from the same filtered records as `history`, so the percentage always describes the period on screen.
- **Success `200`:** `MyAttendance { summary:{ present, absent, late, excused, pct_present }, history:{ date, status }[] }` (own only).

---

### Module 9 — Announcements (FR-ANN-01..07)
Tables: `announcements`, `announcement_reads`.

#### `GET /announcements` — targeted feed (FR-ANN-03)
- **Purpose:** most-recent-first feed **scoped to the caller** (UI §7.9). Audience resolved **server-side** (schema §3.F): `all`→everyone; `students`/`teachers`→by role; `class`→users linked to that section (student via enrollment, teacher via owning any subject). Expired (`expires_at <= now`) excluded.
- **Authz:** `authenticated`. The set is computed from the principal — a Student sees only what targets them.
- **Query:** list params + `unread_only?: bool`. Default sort `published_at DESC` (FR-ANN-03).
- **Success `200`:** `Page[AnnouncementListItem]` `{ id, title, body_preview, audience, class_ref?, author: UserRef, published_at, expires_at?, is_read: bool }`.

#### `GET /announcements/{id}`
- **Authz:** `authenticated` + must target the caller (else `404`, §3.3 — don't leak others' class announcements).
- **Success `200`:** `AnnouncementDetail` (full body). Reading does **not** implicitly mark read (the SPA calls mark-read).

#### `POST /announcements` (FR-ANN-01,02,07)
- **Authz:** `require_role(principal, secretary, teacher)` with a **per-audience ownership rule:**
  - `audience ∈ {all, students, teachers}` (school-wide) → **`require_role(principal, secretary)`** only (FR-ANN-07: a Teacher **cannot** broadcast).
  - `audience = class` → P/S (any section) **or** Teacher with `assert_teacher_owns_section(user, class_id)` (FR-ANN-02). Student → never (`403`).
- **Request body:** `{ title, body, audience: AnnouncementAudience, class_id? (required iff audience=class, forbidden otherwise — schema check), published_at?: datetime (default now), expires_at?: datetime (> published_at) }`.
- **Success `201`:** `AnnouncementDetail`. **Errors:** `403 teacher_cannot_broadcast`, `404`/`403` (teacher not owning the class), `422 class_audience_requires_class_id`.

#### `PATCH /announcements/{id}` / `DELETE /announcements/{id}` (FR-ANN-04)
- **Authz:** the **author** (any creating role) **or Principal** (may edit/delete any). Enforced as an ownership check (`author_id == principal` or `role==principal`). Else `403`/`404`.
- `DELETE` soft-deletes (history retained). `204`.
- **Archived-year scope (S4):** unlike grades/attendance/classes, **announcements are NOT bound by the `year_archived` guard** — a `class`-audience announcement whose section belongs to a now-archived year **remains editable/deletable by its author (or the Principal)**. An announcement is communication, not academic record state; the freeze (FR-SET-07) protects grades/attendance/term snapshots, not message housekeeping (fixing a typo or removing a stale notice). So there is no `409 year_archived` on announcement edit/delete. (Creating a *new* class announcement against an archived section is still possible but pointless — the SPA simply doesn't offer it; not a server block.)

#### `POST /announcements/{id}/read` — mark read (UI NotificationsBell, OQ-E)
- **Authz:** `authenticated` + must be targeted (else `404`).
- **Behavior:** upsert `announcement_reads (announcement_id, user_id)` (idempotent — re-marking is a no-op).
- **Success `204`.**

#### `GET /announcements/unread-count` — bell badge (backed by `ix_announcement_reads_user`, DB-17)
- **Authz:** `authenticated`.
- **Success `200`:** `{ unread_count: int }` — `NOT EXISTS` anti-join of targeted, non-expired announcements vs `announcement_reads`. Cached short client-side.

---

### Module 10 — Reports (incl. Transcript) (FR-RPT-01..07; FR-TRN-01..07; D24/D26)
Read-only aggregators. Tables read: `term_grade_snapshots`, `report_card_snapshots`, plus live compute. **Print/PDF = browser print of the returned, rendered page** (Q8/OQ-A stance — no server PDF in v1).

#### `GET /reports/report-card/{student_id}` (FR-RPT-01,05,06)
- **Purpose:** per-student, per-term report card: all subjects in the section with score/letter/teacher, attendance summary, term average, school identity (UI §7.8).
- **Authz:** P/S = any `student_id`; **Teacher** = only a student in a section they own a subject of (else `404`); **Student** = self only → must call `/reports/report-card/me` (the `{student_id}` path is rejected for a student caller). **grade_release_filter** applies for students (unreleased subjects → `status:"pending"`, AC 5.5).
- **Query:** `semester_id?` (default active; FR-RPT-07), **`kind?: "midterm"|"endterm"` (D32, default `endterm`)**.
- **Success `200`:** `ReportCard { student: StudentRef, section: ClassRef, semester: SemesterRef, school: SchoolIdentity, subjects:{ subject: SubjectRef, teacher?: TeacherRef, numeric?: number, letter?: string, status:"graded"|"pending" }[], attendance_summary:{ pct_present, absent, late }, term_average?: number, term_average_letter?: string, is_frozen: bool }`. Archived semester → from `report_card_snapshots.payload` (frozen, `is_frozen=true`); live year → computed-on-read.
- **`is_frozen` semantics (S1):** a value is `is_frozen=true` **only** when read from a snapshot, which exists **only after the academic year is archived** (schema §10.4 freeze is a year-level event). A **completed-but-not-archived prior semester** (e.g. Semester 1 is over, but the year is still active because Semester 2 is in progress) has **no snapshot yet** — it is still **computed-on-read with `is_frozen=false`**, against the *current* (still-editable) grading scale/policy. Report/transcript consumers must not assume a finished semester is frozen mid-year; only year archival freezes it. (This mirrors `/grades/term.is_frozen` and the transcript's `is_current` marker.)
- **`kind` (D32, brief §5) — two report types, produced by different mechanisms.**
  - **`endterm`** (default, and the pre-D32 behaviour): computed on read for a live year, read from `term_grade_snapshots` once the year archives. Its figures are supposed to keep moving until then. Every existing caller is unaffected.
  - **`midterm`**: the frozen `report_card_snapshots.payload` for `kind='midterm'`, returned **verbatim**. It never recalculates, and that is the requirement rather than an optimisation — recomputing a mid-term card in November would fold in October's post-midterm work and silently move a mark a parent has already seen.
  - The response carries `report_kind` and `frozen_at` (`null` on a computed card).
  - **Lazy freeze:** a mid-term card requested after `semesters.midterm_submission_end` with no snapshot is frozen on the spot and then read. There is no scheduler in this backend, so the alternative is a report that fails until the Dean presses the button; `freeze_midterm` is idempotent, so concurrent first-reads converge.
  - Extra errors on this branch: `409 midterm_window_open` before the window closes, `422 no_midterm_window` for a term with no mid-term period configured, `404 no_midterm_snapshot` for a student with no live enrolment in the term.
- **Errors:** `401`, `403`/`404` per scope, `404 no_records` → SPA empty state.

#### `GET /reports/report-card/me`
- **Authz:** `require_role(student)` **plus the Dean's student grade-visibility switch (D32, brief §4)** — `403 grades_hidden` when `assessment_policies.students_can_view_grades` is false, which is the default. `student_scope` + grade_release_filter otherwise.
- **Query:** `semester_id?`, `kind?` — same semantics as above. The **mid-term branch carries no release filter**: a frozen card is a document already issued, and re-applying "hide subjects with unreleased work" would blank rows the student has already been shown, because release state has moved on since the freeze.
- Same `ReportCard` for self.

#### `POST /settings/semesters/{semester_id}/midterm-freeze` — **Dean only (D32, brief §6)**
- **Purpose:** capture every enrolled student's report card for the term into `report_card_snapshots` with `kind='midterm'`, so mid-term reports serve a frozen document.
- **Authz:** `require_role(principal)`.
- **Success `200`:** `{ snapshots_written: int, semester_id: uuid, frozen_at: timestamptz }`. `0` means nobody was enrolled, not that it failed.
- **Idempotent** on `uq_report_card_snapshot (student_id, semester_id, kind)` — a re-freeze refreshes in place, which is what lets the Dean re-freeze after correcting a mark.
- **Writes only `report_card_snapshots`.** `term_grade_snapshots` is the transcript's source and describes a FINISHED term; a mid-term figure there would surface on a transcript as though the term had ended.
- **Optional:** the lazy freeze on first read covers a Dean who never presses it. The endpoint exists so the moment is chosen deliberately.
- **Errors:** `401`, `403`, `404`, `409 midterm_window_open`, `422 no_midterm_window`.

#### `GET /reports/transcript/{student_id}` — **multi-year transcript (D24; Principal/Secretary ONLY, D26)**
- **Purpose:** the full multi-year record — every academic_year → semester → subject with numeric+letter, assembled from **archived `term_grade_snapshots` ∪ live-year compute**, grouped chronologically (FR-TRN-01..07; schema §10.6; UI §7.10).
- **Authz:** **`require_role(principal, secretary)` — and nothing else.** A **Teacher or Student** → **`403 forbidden`** (D26, FR-TRN-05): a **role-level** denial of a known route (not a hidden record), so `403` (§3.3). **No `/transcript/me` route exists** (D26 removed it). P/S may request **any** student.
- **Query:** `academic_year_id?` (one year; default all years, newest first).
- **Success `200`:** `Transcript`:
  ```
  Transcript {
    student: StudentRef         // + DOB, status for the header
    school: SchoolIdentity; issued_at: datetime
    years: {
      academic_year: AcademicYearRef; year_average?: number
      semesters: {
        semester: SemesterRef; is_current: bool      // true = live, not yet frozen (UI ⊙ marker)
        term_average?: number
        subjects: { subject: SubjectRef, teacher?: TeacherRef, numeric?: number, letter: string }[]
      }[]
    }[]
    cumulative_average?: number  // computed at assembly (plain mean; NOT a GPA — schema §10.6)
  }
  ```
- **Behavior (FR-TRN-04/07):** archived lines use the **frozen `subject_id`** so renamed/retired subjects and soft-deleted offerings still resolve; a student with only a current year renders the live year alone; no records → `years: []` (SPA empty state). **grade_release_filter does NOT apply** (P/S oversight). Frozen years are immutable regardless of later scale/policy edits.
- **Errors:** `401`, **`403 forbidden`** (teacher/student), `404 student_not_found`.

#### `GET /reports/class-grades/{class_id}` — subject grade summary (FR-RPT-02)
- **Authz:** `require_role(principal, secretary, teacher)`; Teacher owns the subject (`class_subject_id` query); P/S any.
- **Query:** `class_subject_id` (required — per offering), `semester_id?`.
- **Success `200`:** `ClassGradeSummary { class_subject: ClassSubjectRef, semester: SemesterRef, students:{ student: StudentRef, numeric?, letter? }[], class_average?: number, distribution:{ letter, count }[] }` (distribution feeds the Recharts bar + its `ChartWithTable`).

#### `GET /reports/attendance/{class_id}` — attendance summary (FR-RPT-03)
- **Authz:** `require_role(principal, secretary, teacher)`; Teacher owns section.
- **Query:** `semester_id?`, `from?`, `to?`.
- **Success `200`:** `AttendanceSummaryReport` (as §5.8 summary view).

#### `GET /reports/enrollment` — enrollment/headcount (FR-RPT-04)
- **Authz:** `require_role(principal, secretary)`.
- **Query:** `academic_year_id?` (default active), `semester_id?`.
- **Success `200`:** `EnrollmentReport { totals:{ students:int, classes:int }, by_grade:{ grade_level, count }[], by_class:{ class_ref: ClassRef, enrolled, capacity? }[] }`.

> **Reports respect the source modules' release & scope rules** — a Teacher's scope = own classes/students; a Student's = own report card; unreleased grades never appear on a student-facing report (FR-RPT-05; architecture §8.5). The Transcript is the one report **role-restricted to P/S** (D26).

---

### Module 11 — Settings (FR-SET-01..07; D10/D11; DB-14)
Tables: `school_profile`, `academic_years`, `semesters`, `grading_scales`, `grading_scale_bands`, `assessment_policies`, `users`, `user_preferences`. **The most-depended-on module** (active term, scale, identity read system-wide).

#### School profile / branding (FR-SET-01)
- **`GET /settings/school`** — Authz: `authenticated` (everyone needs identity for report headers/branding; read-only for non-admins). Success: `SchoolProfile` / `SchoolIdentity`.
- **`PUT /settings/school`** — Authz: `require_role(principal)` (Secretary read-only per matrix). Body: `name, address?, contact_email?, contact_phone?`. `audit_log`. Success `200`.
- **`POST /settings/school/logo`** — Authz: `require_role(principal)`; `multipart/form-data` (image). Stores to object storage (OQ-DB5/OQ-API-7), writes `logo_storage_key`. Success `200 { logo_url }`. Errors: `413 file_too_large`, `415 unsupported_media_type`.

#### Academic structure (FR-SET-02; D10 — 2 semesters/year)
- **`GET /settings/active-term`** — Authz: `authenticated`. Returns `{ academic_year: AcademicYearRef, semester: SemesterRef }` for the global semester switcher (UI §3.1). Returns **`409 no_active_semester`** when none is configured/active (e.g. fresh install, or the only active year was just archived) — so **every module degrades to the same setup-prompt path uniformly** (the SPA keys on this one code; `/dashboard` returns the matching `409 no_active_semester`). (OQ-API-4 resolved.)
- **`GET /settings/academic-years`** — Authz: **authenticated (any role)**. Returns years + their 2 semesters + which is active.
- **`GET /settings/semesters`** — Authz: **authenticated (any role)**. Query `academic_year_id?`.
  - ⚠️ **Widened from `require_role(principal, secretary)` on 2026-07-29 — this was a live defect, not a relaxation for convenience.** These two reads are the calendar every period picker in the app is built from: the staff per-module year filter (`useYearFilter`) runs on **teacher**-reachable screens (Grades, Attendance, Classes), and the student's global year·semester switcher needs each year's semesters. Under the old gate a teacher got a `403`, so the picker's year list came back empty, no `academic_year_id` was sent, and the filter silently did nothing — with no error anywhere. **The MSW handler had no role gate, so demo mode showed none of this** (that gap is now closed for the writes; `handlers/settings.ts::assertPrincipal`). Year and semester names/dates are not sensitive, and `GET /settings/active-term` already exposes the current pair to every role. All **writes** below remain `require_role(principal)` — the authority did not move. Pinned by `tests/test_settings.py::TestListAcademicStructure` (200 for teacher + student, 401 anonymous) and `tests/test_year_scoping.py::TestEveryRoleCanReadThePeriodCalendar` (which also asserts writes still 403 for a teacher).
- **`POST /settings/academic-years`** — Authz: `require_role(principal)`. Body: `{ name, start_date, end_date, semesters:[ {name, sequence:1, start_date, end_date}, {name, sequence:2, ...} ] }` — service **creates exactly two semesters** (D10; schema enforces `sequence IN (1,2)`). Creating an active year requires no other active year (`uq_academic_years_one_active`) → else `409 active_year_exists`. Also seeds the year's `grading_scales` + default bands (D11). Success `201`.
- **`PATCH /settings/semesters/{id}/activate`** — Authz: `require_role(principal)`. Sets this semester active (clears the prior active; one-active invariant). Success `200`.
- **`POST /settings/academic-years/{id}/archive`** — Authz: `require_role(principal)` (FR-SET-07). **The freeze trigger:** computes & writes `term_grade_snapshots` (per student/`class_subject`/semester, with frozen `subject_id` + `effective_policy`) and `report_card_snapshots` (jsonb), sets `grading_scales.is_frozen`, `academic_years.status='archived'`, `classes.is_archived=true` (schema §10.4). Success `202 { snapshots_written: int, no_active_year_remaining: bool }` (batch; may be async, §8).
  - **Retry-safe (OQ-API-4 resolved):** archival is **idempotent at the request level** — if the year is already `archived`, the call returns **`409 year_already_archived`** (no double-write of snapshots); a client retrying after a dropped `202` response can poll `GET /settings/academic-years` to see the terminal `status='archived'` rather than re-invoking. The snapshot write itself is guarded so a partial/retried batch reconciles on the `uq_term_snapshot` / `uq_report_card_snapshot` unique keys (no duplicate snapshots).
  - Archiving the **only** active year is allowed but sets `no_active_year_remaining: true`; the school then has **no active term** until a new year is created/activated — every module degrades via the uniform `409 no_active_semester` path above. The SPA should prompt the Principal to set up the next year (warn-only stance, OQ-API-4).
  - **Errors:** `409 year_already_archived`, `404`.

#### Grading scale (FR-SET-03,06; D11)
- **`GET /settings/grading-scale`** — Authz: `authenticated` (Grades/Reports/SPA need it to display letters). Query `academic_year_id?` (default active). Success: `GradingScale { academic_year_id, pass_mark, is_frozen, bands:{ letter, min_score, max_score, is_passing, sort_order }[] }`.
- **`PUT /settings/grading-scale`** — Authz: `require_role(principal)` (Secretary **cannot** change it, FR-SET-04). Body `{ pass_mark, bands:[...] }`. **Service validates band contiguity** (tiles 0–100, no gaps/overlaps — schema §5 rule 3) → else `422 grading_bands_invalid` (lists conflicts). **Blocked on a frozen scale** → `409 scale_frozen`. Derive-on-read means it applies going forward (Q7); response includes `affects_displayed_grades: true` so the SPA warns (FR-SET-06). Success `200`.

#### Assessment grading policy defaults (DB-14)
- **`GET /settings/assessment-policy`** — Authz: `require_role(principal, secretary)`. Success: the single-row `assessment_policies` `{ absent_as_zero, allow_makeup, drop_lowest_count }` (school defaults).
- **`PUT /settings/assessment-policy`** — Authz: `require_role(principal)` (FR-SET-03). Body: the three fields (non-null base). Year overrides are part of year config; category/assessment overrides via Module 6. Success `200`.

#### User & role management (FR-SET-04)
- **`GET /settings/users`** — Authz: `require_role(principal, secretary)`. Success: `Page[UserListItem]` (list params + `role?`, `is_active?`, `search`).
- **`POST /settings/users`** — Authz: `require_role(principal, secretary)` to create teacher/student logins; **assigning principal/secretary, and any role *change*, is Principal-only** (FR-SET-04). Body `{ email, username?, full_name, role: Role, temporary_password? }` (admin-provisioned, D5; `must_change_password=true`). `audit_log("user.create")`. Success `201`. Errors: `409 duplicate_email`, `403 role_change_forbidden`.
- **`PATCH /settings/users/{id}`** — Authz: `require_role(principal)` for `role`/`is_active`; `require_role(principal, secretary)` for benign profile edits (**Secretary cannot edit a Principal**, §2.3 privilege guard). `audit_log` on role/active changes. Success `200`. Errors: `403`, `404`.
- *(Password reset for a user = `POST /auth/users/{id}/reset-password`, §2.3.)*

#### Per-user account & preferences (FR-SET-05) — every role
- **`GET /settings/account`** — Authz: `authenticated`. Returns own `CurrentUser` + `UserPreferences`.
- **`PATCH /settings/account`** — Authz: `authenticated` (self). Body: own contact info + `preferences:{ locale?, theme?, date_format?, default_page_size? (5..200) }` (FR-SET-05). Password change is the separate `PATCH /auth/me/password` (§2.3). Success `200`.

> *(Settings = 17 endpoints: school 3; academic 6 (active-term, list-years, list-semesters, create-year, activate-semester, archive-year); grading-scale 2; assessment-policy 2; users 3; account 2 → 18 listed; the index rounds the active-term lightweight read into the academic group → 17. The list above is authoritative over the count.)*

---

### Module 13 — Timetable (D29; FR-SCH-03..05)
No tables of its own — it reads `class_meetings` through `class_subjects` and joins to either `class_enrollments` (a student's week) or `class_teachers` (a teacher's week). It lives in its own module rather than inside Classes because it spans two different notions of "my classes" and belongs to neither Students nor Teachers.

> **Response shape.** The week is **pre-bucketed by weekday** — `days: [{ day_of_week, day_name, entries }]` — rather than a flat meeting list. Every consumer renders five columns (or five day-groups on mobile), so grouping server-side means the client never re-derives it, and **an empty day is explicit**: a flat list makes "Wednesday has no classes" indistinguishable from "Wednesday is missing from the data". All five weekdays are always present.
>
> **`unscheduled`** lists classes the viewer belongs to that have **no meetings yet**. Reported rather than omitted: such a class would otherwise be invisible here while still appearing under My Classes, which reads as a bug to the user and hides genuinely missing data from the office.

#### `GET /timetable/me`
- **Purpose:** the caller's own Mon–Fri week (FR-SCH-03/04).
- **Authz:** `authenticated`. **Scope is server-derived from the token, never a param.** Student → the classes they are actively enrolled in; Teacher → the classes they teach; **P/S → an empty week, not a `403`** (they have no personal timetable and the nav never offers them this screen; returning empty keeps the endpoint honest for a client that asks anyway).
- **Query:** `academic_year_id?` (default active) — scopes to one year so an archived year's classes are never interleaved into the current week.
- **Success `200`:** `TimetableView { student: StudentRef?, academic_year_id?, days: TimetableDay[], unscheduled: UnscheduledClass[] }` where `TimetableDay = { day_of_week:1..5, day_name, entries: TimetableEntry[] }` and `TimetableEntry = { meeting_id, class_id, class_name, class_subject_id, subject: SubjectRef, teachers: TeacherRef[], room?, day_of_week, start_time, end_time }`. Entries are start-time ordered. `student` is null for a teacher's own week.
- **Errors:** `401`, `404 student_not_found` (a student login with no linked profile).

#### `GET /timetable/students/{student_id}`
- **Purpose:** any student's week (FR-SCH-05) — the office checks it before enrolling them into one more class, which is the cheapest moment to catch a clash.
- **Authz:** `require_role(principal, secretary)`.
- **Query:** `academic_year_id?` (default active).
- **Success `200`:** `TimetableView` (with `student` set). **Errors:** `403`, `404 student_not_found`.

> There is deliberately **no whole-school timetable endpoint**. That is a room/teacher-utilisation report, not a personal week, and it belongs to Reports if it is ever needed.

---


## 6. Pagination, Filtering, Sorting

Applied **consistently across every `Page[T]` list endpoint**. The SPA's `DataTable` + `FilterBar` push these to the URL query string → TanStack Query keys (architecture §7.1; UI §8.1).

- **Pagination:** `?page=<1-based int, default 1>&page_size=<int, default 25, max 100>`. The server **clamps** `page_size` to `[1,100]` (the UI offers 10/25/50; clamping protects the DB — NFR-PERF-02). Response is `Page[T]` (§4.1).
- **Sorting:** `?sort=<field>` ascending, `?sort=-<field>` descending (leading `-`). **One sort column at a time** (UI §8.1). Each list endpoint declares its **allowed sort fields** (an enum in the contract); an unknown field → `422 invalid_sort_field`. Sort maps to a **whitelisted column** — never interpolated into SQL (no injection).
- **Filtering:** endpoint-specific named params (`status`, `class_id`, `search`, …), documented per endpoint in §5. `search` is a debounced free-text **parameterized `ILIKE`** on the documented columns (name + business number). Multiple filters AND together.
- **Default ordering** (no `sort`): per-resource sensible default (students `full_name`; announcements `published_at DESC`; attendance history `attendance_date DESC`) — documented per endpoint.
- **Stability:** every sort has an implicit `id` tiebreaker so pagination is deterministic (no row drift across pages).

---

## 7. Error Handling & Status Codes

One global exception handler (architecture §8.1) maps an internal exception hierarchy to the `ErrorResponse` envelope (§4.2) + the right status. The **closed set**:

| Status | `code` examples | When |
|---|---|---|
| **200** | — | Successful GET/PUT/PATCH/action returning a body. |
| **201** | — | Resource created (POST creating a resource); body = the created resource. |
| **202** | — | Accepted, async/batch in progress (year-archival snapshot write, §5.11). |
| **204** | — | Success, no body (logout, soft-delete, mark-read, save with no echo). |
| **400** | `malformed_request` | Unparseable JSON / wrong content-type. (Distinct from 422 = well-formed-but-invalid.) |
| **401** | `unauthenticated`, `invalid_credentials`, `refresh_invalid` | No/expired/invalid access token (or bad login). Single-flight refresh fires on a generic 401; a hard 401 after refresh → re-auth. |
| **403** | `forbidden`, `teacher_cannot_broadcast`, `role_change_forbidden`, `account_inactive` | **Role-level** denial of a known capability/route — incl. **Transcript for teacher/student** (D26). |
| **404** | `not_found` | Resource absent **or** an **ownership/scope** denial on a PII/scoped record — **deliberately indistinguishable from absent** to avoid leaking existence (§3.3, NFR-SEC-02). |
| **409** | `duplicate_student_number`, `has_academic_history`, `year_archived`, `active_year_exists`, `assessment_has_grades`, `teacher_has_active_assignments`, `scale_frozen`, `subject_already_in_section` | **Conflict** with current state: uniqueness, delete-guard (history present), write to an archived year, one-active-invariant breach. The UI anticipates many and disables the action with guidance (UI §10.4). |
| **413 / 415** | `file_too_large` / `unsupported_media_type` | File upload (logo, student docs). |
| **422** | `validation_error`, `score_exceeds_max`, `future_date_not_allowed`, `student_not_enrolled`, `weak_password`, `grading_bands_invalid`, `invalid_sort_field`, `score_status_conflict`, `invalid_transition` | **Well-formed but semantically invalid** — Pydantic field validation **and** service-layer business rules a stored CHECK can't express (cross-row/temporal/enrollment, schema §5). `fields` map populated for field-level errors. |
| **423** | `account_locked` | Brute-force lockout (FR-AUTH-07); includes `retry_after_seconds`. |
| **429** | `rate_limited` | Auth rate limit exceeded (§8.1); includes `retry_after_seconds`. |
| **500** | `internal_error` | Unhandled — generic message + `request_id`; **never** a stack trace, SQL, or internal detail. |

**401 vs 403 (explicit):** `401` = "I don't know who you are / your session lapsed"; `403` = "I know who you are, and your role can't do this." A logged-in Student hitting the Transcript route is **`403`**, not `401`.

**404 vs 403 for ownership (explicit):** denying a **record** the caller shouldn't know exists → **`404`** (no existence leak); denying a **route/capability** the role openly lacks → **`403`**. Encoded per-endpoint in §5.

---

## 8. Cross-Cutting Concerns

### 8.1 Rate-limiting (auth surface)
- **`POST /auth/login`**, **`POST /auth/refresh`**, and **`PATCH /auth/me/password`** are rate-limited (per-IP and per-account) beyond the per-account lockout (FR-AUTH-07). Exceeding → `429 rate_limited` + `retry_after_seconds`. v1 implementation: an in-process token bucket is sufficient for a single Railway instance (documented so Phase 7 doesn't over-build a Redis dependency). The **per-account `failed_login_count` + `locked_until`** (schema `users`) is the primary defense; the limiter is the coarse network backstop. The rest of the API is **not** globally rate-limited in v1 (low-traffic, authenticated) — a deliberate scope choice.

### 8.2 Audit-touch points (which mutations write `audit_log`) — NFR-SEC-04
Beyond the inline `AuditMixin` on every mutable row, these write an explicit `audit_log` row **in the same transaction** (schema §7):
- **Grades:** `grade.update` (FR-GRD-06), `grade.release`/`grade.unrelease` (FR-GRD-09).
- **Attendance:** `attendance.upsert` (FR-ATT-04).
- **Students:** `student.create`, `student.status_change`, `student.delete`.
- **Teachers:** `teacher.create`, `teacher.status_change`, `teacher.delete`.
- **Enrollment:** `enrollment.enroll`/`enrollment.transfer`/`enrollment.withdraw`.
- **Auth/Users:** `user.create`, `user.reset_password`, `user.role_change`, `user.deactivate`.
- **Settings:** `settings.grading_scale_update`, `settings.policy_update`, `academic_year.archive` (the freeze event).
The actor is always the **authenticated principal** (never client-supplied). A user-facing audit UI is out of v1 scope (data captured for later).

### 8.3 Grade-release filtering in responses (how it manifests for student callers)
- Applied **in the service read path**, not a response post-process the client could bypass. For a **student caller**, unreleased `assessment_grades` (`COALESCE(row.is_released, assessment.is_released)=false`) are **omitted entirely** from `/grades/me`, `/dashboard` recent grades, `/reports/report-card/me`, `/grades/term?scope=me`, and any `/assessments?scope=me` score field — the SPA never receives them (architecture §8.5). On the report card an unreleased subject shows `status:"pending"` (renders "Pending"), not a number (AC 5.5).
- **Teacher (own), Secretary, Principal bypass** the filter (oversight), with `is_released` per row so the gradebook can show the "visible to you only" banner (UI §7.7).
- The Transcript (P/S only, D26) is **not** release-filtered.

### 8.4 Composite dashboard — N+1 avoidance
`/dashboard` (architecture §4) is **one service call issuing a small fixed set of set-based aggregate queries** (counts, rates, recent-N), not a per-widget fan-out or per-row loop:
- Principal counts/rates = a handful of `COUNT`/`AVG` aggregates over term-scoped tables (OK at ≤2,000-student scale; profile for a materialized view in Phase 8 — schema §10.5).
- Teacher "attendance recorded today per class" = **one** grouped query over the teacher's sections joined to today's `attendance_records` (`ix_attendance_class_date`) — not one query per class (avoids FR-ATT-08 N+1).
- "Needs setup" tiles (Secretary) = `NOT EXISTS` anti-joins (class without `class_teachers`, student without an active enrollment).
- Recent lists = single `ORDER BY … LIMIT N` reads on indexed columns.
Assembled once, cached briefly client-side (volatile data, short `staleTime`, architecture §7.1).

### 8.5 Concurrency on the gradebook / register
Grade and attendance writes are **bulk upserts in one transaction**, keyed on the natural unique constraint (`(assessment_id, student_id)` / `(class_id, student_id, date)`), so two co-teachers (D-Q9) saving concurrently reconcile deterministically (last-write-wins per cell; `updated_by/updated_at` records who) rather than duplicating rows. No optimistic-lock version field in v1 (low contention, single school); the UI's optimistic toggle reconciles from the server response (UI §10.5). Logged as a scope choice (OQ-API-3).

---

## 9. OpenAPI Alignment Notes

The API is **FastAPI-first**: the OpenAPI document is *generated from* the Pydantic models + route signatures — this spec describes what those models must encode, not a hand-maintained parallel schema (D14).

- **Shared components flow through, not re-declared.** `Page[T]`, `ErrorResponse`, `CurrentUser`, `UserPreferences`, `AuditStamp`, the `*Ref` types, and every enum (§4) live in `app/common/` and are `$ref`'d everywhere. `Page[T]` is a **generic Pydantic model** (`Page[StudentListItem]`, …) → FastAPI emits one component per concrete `T`; the **generated TS client gets `Page<StudentListItem>` etc. for free**, so the frontend never hand-rolls a pagination/error type (architecture §7.1; UI §8). This is the contract-drift firewall.
- **Enums → OpenAPI `enum`** with the exact lowercase labels matching the Postgres native enums (§4.5): Python `StrEnum` → OpenAPI `string`+`enum` → TS string-literal union. Letters stay `string` (not enum), per D11 configurability.
- **Discriminated unions** (the role-shaped `/dashboard` payload) use a Pydantic discriminated union on a literal `role` field → OpenAPI `oneOf` + `discriminator` → the TS client narrows correctly.
- **Validation in Pydantic + a thin service layer.** Field constraints (`max_score > 0`, `weight ≥ 0`, `page_size ≤ 100`, email format, lengths) are Pydantic `Field(...)` → appear in OpenAPI and produce the normalized `422` (§4.3). **Cross-row/temporal/ownership/enrollment rules** (score ≤ max_score, no-future-date, band contiguity, teacher-owns, student-enrolled, archived-year read-only — schema §5 service-enforced list) are **not** OpenAPI-expressible and are service-enforced, surfacing as the documented `422`/`409`/`404` codes. The contract lists these "Errors" so the generated client knows the closed code set even though OpenAPI can't constrain them.
- **Auth in OpenAPI:** `Authorization: Bearer` is an OpenAPI `securityScheme` (HTTP bearer/JWT); the refresh cookie is documented but out-of-band (only `/auth/refresh` reads it). Per-endpoint `security` reflects the coarse role gate; fine-grained ownership lives in the description (`Authz:` line) since OpenAPI can't express it.
- **Operation ids & tags:** each route gets a stable `operation_id` (`students_list`, `grades_gradebook_read`, `reports_transcript`) and a module `tag` → a well-named, module-grouped generated client. Convention: `<module>_<action>`.
- **Examples:** request/response `examples` attached on key flows (login, grade upsert, dashboard, transcript) so the OpenAPI doc and generated client docs are useful.

---

## 10. Decisions & Open Questions

### 10.1 API-level decisions (with rationale)
| # | Decision | Rationale |
|---|---|---|
| API-1 | **`snake_case` on the wire** (bodies, params, enum values) | FastAPI/Pydantic emit it natively; the frontend uses a *generated* client, so wire casing is invisible to hand-written TS — one casing end-to-end kills drift, no alias layer (§1.2). |
| API-2 | **`/api/v1` path versioning; additive within v1** | Unambiguous; clean v2 coexistence (§1.1). |
| API-3 | **`Page[T]` generic envelope; standardized `page/page_size/sort/search`; `page_size` clamped ≤100** | One reusable OpenAPI component → generated TS types; protects the DB (§4.1, §6). |
| API-4 | **`ErrorResponse{ error:{ code, message, fields? } }` with a closed `code` vocabulary** | Machine-branchable + human-safe + localizable; field map drives inline form errors (§4.2). |
| API-5 | **404 for ownership/PII-scope denial; 403 for role denial** | No existence leak on scoped records (NFR-SEC-02); honest role denial on openly-known routes (§3.3, §7). |
| API-6 | **Two ownership helpers as `Authz:` deps** (`assert_teacher_owns_class_subject` / `assert_teacher_owns_section`) | D23 rescoping; one source of truth, no per-module re-implementation (§3). |
| API-7 | **Student scope server-derived; `me` routes + ignored path-id** | Architecture §3.2 hard rule — a student can't reach another by editing a URL (§3.2). |
| API-8 | **Grade-release as a server-side read filter, omitting unreleased rows for students** | Architecture §8.5 — SPA never receives unreleased data (§8.3). |
| API-9 | **Assessment-first: the ONLY grade write is `PUT /assessments/{id}/grades`, rejecting non-enrolled students; no `POST /grades`; term grades computed-on-read, frozen only at archival** | API expression of the enrollment-provenance FK (DB-5) + compute-on-read model (§5.7). |
| API-10 | **Transcript = `require_role(principal, secretary)` only; no `/transcript/me`; teacher/student → 403** | D26 (§5.10). |
| API-11 | **Idempotent upserts for attendance & grade entry on natural keys; no `Idempotency-Key` header in v1** | FR-ATT-03 / FR-GRD-01; natural-key uniqueness converts double-submits to 409 (§1.5). |
| API-12 | **Composite role-discriminated `/dashboard`, one batched aggregate service call** | Architecture §4; N+1-free (§5.2, §8.4). |
| API-13 | **Capacity is warn-only at the API** (enroll succeeds with `over_capacity_warning`) | D-Q6 (§5.5). |
| API-14 | **Auth-surface rate limiting only (login/refresh/password); 429 + retry_after; in-process limiter** | FR-AUTH-07 backstop; rest is low-traffic authenticated (§8.1). |
| API-15 | **Year archival returns `202` (batch snapshot write), may be async; idempotent (`409 year_already_archived` on retry); snapshots reconcile on unique keys** | A large year's freeze is a batch op; retry-safe (§5.11, OQ-API-4). |
| API-16 | **Assessment lifecycle via `POST /assessments/{id}/status`** with a fixed legal-transition set (`draft→published→grading→graded`, single-step rollback) + `422 invalid_transition`; release is orthogonal to status | M1 — gives `AssessmentStatus` (FR-ASMT-04, dashboard filter, AC 5.3) a single audited write path (§5.6). |
| API-17 | **Subjects catalog sub-module** (`GET` authenticated picker; `POST/PATCH/DELETE` P/S; `409 subject_in_use` on delete-with-history) | M2 — produces `class_subjects.subject_id`; without it the subject picker has no source (§5b). |
| API-18 | **Transfer preserves grade/attendance provenance; gradebook read = grade rows ∪ active roster; term grade keyed on `(student, class_subject, semester)` not `enrollment_id`; destination term grade starts empty; roster is active-only with `?include=withdrawn`** | M3/S3 — historical rows never vanish on transfer; aggregation is enrollment-agnostic (§5.5/§5.7). |
| API-19 | **`makeup_score` rejected (not silently ignored) on non-`absent` rows or when resolved `allow_makeup=false` (`422 makeup_not_allowed`); `makeup_score ≤ max_score` is a service check** | M5 — preserves teacher intent; the DB enforces only the `≥0` floor (§5.7). |

### 10.2 Resolved questions (architect concurred; baked into the contract)
- **OQ-API-1 — RESOLVED: no `Idempotency-Key` header in v1.** Creates rely on natural-key `409`s + the SPA's disabled-while-in-flight submit (§1.5). Additive later if a non-browser consumer needs it.
- **OQ-API-2 — RESOLVED: teacher-only authoring of assessments/grades.** No admin "enter on a teacher's behalf" path in v1 (matches FR-ASMT-01/FR-GRD-01; P/S remain view-all). Adding it later means a new P/S write path + an ownership exception (§5.6/§5.7).
- **OQ-API-3 — RESOLVED: co-teacher gradebook = last-write-wins per cell**, attributed via `updated_by`/`updated_at`; no optimistic-lock version in v1 (D-Q9, low contention). Semantics documented on the grade-write endpoint (§5.7) and §8.5. `If-Match`/version is an additive future option.
- **OQ-API-4 — RESOLVED: archival `202`, retry-safe** (`409 year_already_archived` if already done; snapshots reconcile on unique keys). `GET /settings/active-term` returns **`409 no_active_semester`** so all modules degrade to one uniform setup-prompt path; archiving the only active year is warn-only (`no_active_year_remaining`), SPA prompts to set up the next year (§5.11).
- **OQ-API-5 — RESOLVED: drop-lowest = category-level when categories exist, offering-level otherwise.** The offering-level knob sets only the **year-inherited fallback** in the precedence chain and does **NOT** override per-category counts (§5.7; mirrors schema OQ-DB7).
- **OQ-API-6 — RESOLVED for v1: browser print/PDF; no server-PDF endpoint.** Report card & transcript export is browser print of the rendered page; a `GET …/export.pdf` + `report_card_snapshots.storage_key` wiring is an **additive** later change. _(Still flagged to the stakeholder for final Phase-7 confirmation — Q8/OQ-A.)_
- **OQ-API-7 — RESOLVED: defer `student_documents` CRUD to a fast-follow; keep the v1 logo upload.** No document-upload endpoints in v1 — `student_documents` is **write-nothing in v1** (no endpoint creates rows → no orphan/PII-leak risk; the table stands for the fast-follow). The school **logo** upload (`POST /settings/school/logo`) **is** in v1; its **object-storage target (OQ-DB5)** — Railway volume / S3-compatible / Supabase Storage — must be chosen for Phase 6/7 (does not change the contract shape, only the storage adapter behind `logo_storage_key`).

> **Still genuinely open / deferred to stakeholder (not blocking Phase 6):** OQ-API-6's official-PDF question (tracks Q8/OQ-A, confirm before Phase 7-Reports) and OQ-API-7's object-storage target (tracks OQ-DB5, confirm by Phase 6/7). Everything else above is decided.

---

_End of Phase 5 API design (revised post-review: M1–M5 + S1–S6 closed, OQ-API-1..7 resolved). Next: `product-architect` contract re-check → update `progress-tracker.md` (log API-1..API-19; OQ-API-1..7 resolved, with Q8/OQ-A + OQ-DB5 still flagged to stakeholder) → Phase 6 (Frontend Foundation) builds against the FastAPI-generated OpenAPI TS client._

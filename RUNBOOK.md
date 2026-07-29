# SIS — Runbook

Operational guide for the School Information System: how to run it, how to point it at a
database, and how to recover when something breaks.

- **Backend** — FastAPI + SQLAlchemy (sync, pymysql), Python 3.12
- **Frontend** — React 19 + TypeScript + MUI + Vite, TanStack Query
- **Database** — self-hosted **MariaDB 12.3** (`sims`)
- **API surface** — 70 paths / 99 operations, all under `/api/v1`

> The docs under `docs/` still describe PostgreSQL on Railway in several places
> (`database-schema.md`, `architecture.md`, `api-specification.md`). That is **stale**.
> MariaDB is authoritative — see `docs/progress-tracker.md` line 111 and
> `backend/db/mariadb/README.md`. Reconciling those docs is Step 5 of the production plan.

---

## 1. Two ways to run

| | `npm run demo` | `npm run dev` |
|---|---|---|
| Backend needed | **No** | **Yes** (`:8000`) |
| Database needed | **No** | **Yes** (live MariaDB) |
| Data source | MSW in-browser mocks | Real API + `sims` |
| Login | type `principal` / `secretary` / `teacher` / `student`, **any** password | real email + real password |
| Vite mode | `--mode demo` → loads `.env.demo` (`VITE_ENABLE_MOCKS=true`) | default → loads `.env` (`VITE_ENABLE_MOCKS=false`) |
| Typechecked | **No** (`demo` skips `tsc -b`) | No (only `npm run build` typechecks) |
| Use it for | client demos, offline UI work | real testing, backend work |

**Grade numbers differ between the two, deliberately.** The backend implements the documented
two-level category rollup (weights + drop-lowest); the demo's `selectors.ts::computeTermGrade`
does a flat mean and ignores both. Do not report that as a bug — see
`docs/progress-tracker.md` line 107.

---

## 2. Running against the live database

Two terminals. Both must stay open.

### Terminal 1 — backend on `:8000`

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

> **Must be run from `backend\`.** `app/config.py` loads `.env` by a *relative* path, so
> starting from anywhere else silently falls back to defaults and points at the wrong DB.

Verify before moving on:
- http://127.0.0.1:8000/api/v1/health → `200`
- http://127.0.0.1:8000/api/v1/docs → interactive OpenAPI

### Terminal 2 — frontend on `:5173`

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\frontend
npm run dev
```

Open http://localhost:5173.

### Logins

All seeded accounts share the password **`SimsDemo2025!`**.

| Role | Email | Count |
|---|---|---|
| principal | `principal@belmopancomp.edu.bz` | 1 |
| secretary | `secretary@belmopancomp.edu.bz` | 1 |
| teacher | `alicia.cano@belmopancomp.edu.bz` | 11 |
| student | `s-25001@student.belmopancomp.edu.bz` | 6 |

The login field accepts an **email address** (the API field is `identifier`, not `email`).
Note only 6 of the 45 student profiles have user accounts — the rest exist as records only.

### Why the base URL must stay relative

`vite.config.ts` proxies `/api/v1` → `http://localhost:8000`, making API calls **same-origin**.
That matters: with `ENVIRONMENT=local` the backend issues the `sis_refresh` cookie as
`SameSite=Lax`, which a browser will **not** send on a cross-site request. Setting
`VITE_API_BASE_URL=http://localhost:8000/api/v1` therefore breaks silent-refresh on hard reload
in a way that looks like a random logout. Keep `VITE_API_BASE_URL=/api/v1`.

### Confirming you're on live data, not mocks

Open DevTools → Network. Live requests hit `localhost:5173/api/v1/*` **and appear in the
uvicorn terminal log**. If uvicorn logs nothing while the UI still shows data, MSW is
intercepting — check `frontend/.env` says `VITE_ENABLE_MOCKS=false` and hard-reload.

---

## 3. Environment files

None of these are in git (`.env*` is gitignored); only `.env.example` is tracked.
**All of them already exist on this machine** — this section is for a fresh clone.

### `backend/.env`

```ini
DATABASE_URL=mysql+pymysql://<user>:<urlencoded-password>@127.0.0.1:3306/sims
JWT_SECRET=<openssl rand -hex 32>
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
LOCKOUT_THRESHOLD=5
LOCKOUT_DURATION=900
SESSION_IDLE_TIMEOUT=1800
ARGON2_TIME_COST=3
ARGON2_MEMORY_COST=65536
ARGON2_PARALLELISM=4
PASSWORD_MIN_LENGTH=10
ENVIRONMENT=local
SEED_ADMIN_EMAIL=principal@school.local
```

> ⚠️ **Do not copy `backend/.env.example` verbatim** — it still advertises a
> `postgresql+psycopg://` URL and will not connect. (Cleanup is Step 3e.)
>
> ⚠️ **URL-encode special characters in the password** (`@` → `%40`). Both
> `alembic/env.py:31` and `tests/conftest.py:81` depend on the value staying encoded.

`ENVIRONMENT` is load-bearing beyond logging: outside `local` the app refuses to start with a
default `JWT_SECRET` or an empty/`*` CORS list (`config.validate_runtime()`), and the refresh
cookie flips to `SameSite=None; Secure`, which requires real HTTPS.

### `frontend/.env`

```ini
VITE_API_BASE_URL=/api/v1
VITE_SUPABASE_STORAGE_URL=
VITE_ENABLE_MOCKS=false
```

`VITE_SUPABASE_STORAGE_URL` is declared but **read nowhere** in `src/` — dead config until
the school-logo upload is unstubbed. Leave it empty.

### `frontend/.env.demo`

```ini
VITE_API_BASE_URL=/api/v1
VITE_ENABLE_MOCKS=true
```

---

## 4. Provisioning a database from scratch

> Not needed on this machine — `sims` is already provisioned and seeded.

**Alembic does not work.** The single revision
(`backend/alembic/versions/0001_initial_schema.py`) is PostgreSQL-only — native enums,
`pgcrypto`, RLS, `CREATE INDEX CONCURRENTLY`. Running `alembic upgrade head` against MariaDB
will fail. This is a known, accepted gap: fresh provisioning is **manual**.

Apply these in **exact order** against the `sims` database (HeidiSQL: open the file, run the
whole thing). All are re-runnable.

| # | File | Purpose |
|---|---|---|
| 1 | `backend/db/mariadb/sims.sql` | Base legacy schema. **Empty DB only.** |
| 2 | `backend/db/mariadb/001_missing_fields.sql` | The big ORM reconciliation — renames, type changes, PK swaps, FK adds, generated columns emulating Postgres partial-unique indexes |
| 3 | `backend/db/mariadb/002_column_defaults.sql` | `CURRENT_TIMESTAMP` defaults on `login_attempts.attempted_at`, `refresh_sessions.issued_at`/`last_used_at`. **Without this the entire auth flow fails** with MariaDB error 1364 |
| 4 | `backend/db/mariadb/003_subjects_is_active.sql` | Converts `subjects.is_active` from generated to a real column |

Then seed — **pick one**:

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend

# (a) Minimal bootstrap — idempotent, safe on a populated DB.
#     Creates school profile, one academic year + 2 semesters, grading scale,
#     and ONE principal with a generated temp password PRINTED ONCE. Copy it.
.\.venv\Scripts\python.exe -m app.db.seed

# (b) Full demo dataset — 19 users / 45 students / ~4,400 rows.
.\.venv\Scripts\python.exe -m db.mariadb.seed_demo
```

> 🔴 **`seed_demo` IS DESTRUCTIVE.** It runs `DELETE FROM` against **22 tables** before
> inserting. Never point it at anything you care about.
>
> 🔴 It also creates 19 accounts sharing the hardcoded password `SimsDemo2025!` with
> `must_change_password = false`. **This must never run against production.**
>
> The static equivalent is `backend/db/mariadb/010_seed_demo.sql` (4,494 lines) if you'd
> rather run it in HeidiSQL.

### Fresh machine, first time

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"   # [dev] matters — see §6

cd ..\frontend
npm install        # also copies the MSW worker into public/
```

---

## 5. Database timezone — important

The app's contract (`app/core/timeutil.py`) is **"storage is always UTC"**, with calendar
*dates* resolved in `America/Belize` (UTC-6, no DST) via `school_today()`.

62 columns across 30 tables are filled by the **server** via `CURRENT_TIMESTAMP` — every
`TimestampMixin.created_at`/`updated_at`, plus `login_attempts.attempted_at`. On a Belize host
with `time_zone=SYSTEM`, those landed **6 hours behind** the UTC values the app reads them back
as. Measured drift against the Python-written `issued_at` on the same `refresh_sessions` row:
exactly `21600s`.

**Fixed** in `backend/app/db/session.py` — the engine now pins every connection with
`SET time_zone = '+00:00'`. Auth was never affected (`locked_until`, `issued_at`,
`last_used_at`, `published_at` are all written from Python in UTC), so this only corrected
display timestamps.

Verify at any time:

```sql
SELECT @@session.time_zone, NOW(), UTC_TIMESTAMP();
```

Through the app's engine, `NOW()` and `UTC_TIMESTAMP()` must be **identical**. Raw HeidiSQL
sessions still show server-local time — that's expected and harmless.

> **Rows written before this fix are still 6h early.** In the demo dataset that's cosmetic.
> If it matters, `UPDATE <table> SET created_at = created_at + INTERVAL 6 HOUR` per table,
> but re-seeding is simpler.

---

## 6. Tests

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe -m pytest -q                  # full suite — ~18 minutes
.\.venv\Scripts\python.exe -m pytest tests/test_auth.py -q   # one module — seconds
.\.venv\Scripts\python.exe -m pytest -m "not requires_db" -q # DB-free subset
```

- **819 tests.** Run per-module while iterating; save the full run for checkpoints.
- The ~18 minutes is dominated by Argon2id (`memory_cost=65536`) on every user fixture.
- ⚠️ **Tests run against the live `sims` database.** Isolation is per-test
  transaction-rollback (`tests/conftest.py`) so nothing commits — but there is no separate
  test schema and no CI. Don't run them against anything precious.
- ⚠️ `pytest-asyncio` may be missing if `.venv` was built without `[dev]`. Symptom:
  `PytestConfigWarning: Unknown config option: asyncio_mode`. Fix: `pip install -e ".[dev]"`.
- There is **no frontend test suite** — no Vitest, no Playwright, no `*.test.*` files.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| UI shows data but uvicorn logs nothing | MSW intercepting | `VITE_ENABLE_MOCKS=false` in `frontend/.env`, hard-reload |
| Login 422 `identifier: Field required` | Posting `email` instead of `identifier` | Field is `identifier` |
| Logged out on every hard refresh | `VITE_API_BASE_URL` is absolute → cross-site `SameSite=Lax` cookie dropped | Set it back to `/api/v1` |
| `423` on login with `retry_after_seconds` | Account lockout, 5 failures / 900s | Wait, or clear `users.failed_login_count` + `locked_until` |
| Backend starts but every query fails | Started from the wrong directory → `.env` not found | `cd backend` first |
| MariaDB error 1364 "doesn't have a default value" on login | `002_column_defaults.sql` never applied | Apply it |
| `alembic upgrade head` fails | The revision is Postgres-only | Don't use Alembic — see §4 |
| CORS error in browser console | Origin missing from `CORS_ORIGINS` | Add it, restart backend |
| Timestamps display 6 hours early | Rows written before the §5 fix | Cosmetic; re-seed if it matters |
| `npm run demo` shows a blank/404 app | Missing `public/mockServiceWorker.js` or `.env.demo` (both gitignored) | `npx msw init public/ --save`, recreate `.env.demo` per §3 |

### Health endpoints

- `GET /api/v1/health` — liveness. **Does not touch the database**, so it returns 200 even
  when MariaDB is down. A DB-backed readiness probe is Step 3d.

---

## 8. Known gaps

Tracked in the production-readiness plan; none block local use.

- **`GET /students/me/years` and `GET /students/{id}/years` return 404 live.** Called by
  `frontend/src/app/providers/YearContext.tsx:47` and
  `frontend/src/features/students/api/studentsApi.ts:45`; mocked in MSW so they only work in
  demo. The student year-switcher renders empty against the real API.
- **No rate limiting.** `RateLimited` exists in `app/core/errors.py` and `429` is declared in
  the OpenAPI for `/auth/login` and `/auth/refresh`, but nothing raises it. Per-account
  lockout is the only protection — password-spraying across accounts is unthrottled.
- **No retention jobs.** `login_attempts` and `refresh_sessions` grow unbounded.
- **No backups, no Dockerfile, no CI**, and no production process manager. The only
  documented launch uses `--reload`, a dev flag.
- **School-logo upload is stubbed** — validation is real, the byte upload is not
  (`TODO(OQ-DB5)`, needs an object-storage bucket).
- **MSW ships in the production bundle** — `main.tsx` imports it statically, so the mock
  handlers and demo dataset are in `dist/`, kept dormant only by a runtime flag.
- **`frontend/openapi.json` is stale** (covers 4 of 14 modules). Don't run
  `npm run generate:api` until it's refreshed from `backend/openapi.json`.

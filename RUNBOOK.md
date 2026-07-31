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

> ⚠️ **URL-encode special characters in the password** (`@` → `%40`). Both
> `alembic/env.py:31` and `tests/conftest.py:81` depend on the value staying encoded.
>
> _(An earlier note here warned that `backend/.env.example` advertised a
> `postgresql+psycopg://` URL. That was already fixed — the example is MariaDB
> throughout and is safe to copy. It also now documents the `JWT_SECRET` length and
> Argon2 floor the app enforces outside `local`.)_

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

See `docs/testing-plan.md` for the full plan — strategy, coverage, gaps and the manual UAT
scripts. Quick reference:

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe -m pytest -q                  # full suite — ~56 seconds
.\.venv\Scripts\python.exe -m pytest tests/test_auth.py -q   # one module — seconds
.\.venv\Scripts\python.exe -m pytest -m "not requires_db" -q # DB-free subset
.\.venv\Scripts\python.exe -m pytest -q --durations=10       # find the slow ones
```

- **941 tests, all green.** The whole suite now runs in under a minute, so just run it.
- **It used to take ~18 minutes, and the cause recorded here was wrong.** The note said Argon2id
  dominated. Measured (2026-07-29): Argon2 was ~96ms/hash — real but minor — the database ~1ms
  per test, and **`create_app()` ~1.3s per test**, paid by all 941 tests because the `app`
  fixture was function-scoped. Building the app once per session, plus a reduced Argon2 work
  factor inside the test process, took the run to ~56s. Both live in `tests/conftest.py` and
  are guarded by `tests/test_qa_foundation.py`.
- Run at production hashing cost with `$env:SIS_TEST_FULL_ARGON2="1"` when you want to verify
  the parameters themselves. Production defaults are unchanged and pinned by a test.
- A test needing **different settings** must build its own app (`test_hardening.py::_build_app`);
  the shared fixture's settings are fixed at construction.
- ⚠️ **Tests run against the live `sims` database.** Isolation is per-test
  transaction-rollback (`tests/conftest.py`) so nothing commits — but there is no separate
  test schema and no CI. Don't run them against anything precious.
- There is **no frontend test suite** — no Vitest, no Playwright, no `*.test.*` files. Every
  user-facing flow is covered by a human following `docs/testing-plan.md` §5, or not at all.

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

- `GET /api/v1/health` — **liveness**. Deliberately does not touch the database, so it
  returns 200 even when MariaDB is down. Point restart-on-failure checks here: a liveness
  probe that fails on DB trouble causes restart loops.
- `GET /api/v1/ready` — **readiness**. Runs `SELECT 1` and returns **503** when the database
  is unreachable. Point load-balancer traffic gating here. Note it has no client-side
  connect timeout, so against a black-holed host it waits pymysql's default (~10s) before
  answering — give anything polling it its own timeout.

---

## 9. Running behind a reverse proxy — READ THIS

**You must start uvicorn with `--forwarded-allow-ips=""` unless you have deliberately
configured it otherwise.**

uvicorn enables its own `ProxyHeadersMiddleware` **by default**, trusting `127.0.0.1`. When
the immediate peer is loopback — which is the normal self-hosted layout, nginx/Caddy/IIS in
front of the app on the same host — it **overwrites the client address from
`X-Forwarded-For` before the application ever sees the request**. The app's own
`TRUSTED_PROXIES` setting cannot override that; it runs too late.

Consequence, measured on this codebase: an attacker rotating the `X-Forwarded-For` header
gets a **fresh rate-limit bucket every request**, and every `login_attempts` and `audit_log`
row records whatever IP they chose.

```
# exhaust the limiter from one identity
X-Forwarded-For: 10.0.0.1   -> 429 after 31 failed logins
# then simply rotate it
X-Forwarded-For: 8.8.8.8    -> 401   (throttle evaded)
X-Forwarded-For: 1.1.1.1    -> 401
```

With `--forwarded-allow-ips=""` the same rotation stays `429`.

```powershell
# correct production launch (TLS terminated by the proxy in front)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --forwarded-allow-ips=""
```

Then set `TRUSTED_PROXIES` in `.env` to your proxy's address so the app resolves the real
client IP itself, under its own rules.

This cannot be fixed from `.env` — uvicorn reads `FORWARDED_ALLOW_IPS` from the environment
before importing the app, so it must be a real environment variable or the CLI flag.

The backend detects the situation at runtime and logs `proxy_header_conflict` **once** if it
sees a rewritten peer. If that appears in your logs, the flag is missing.

> Also note the rate limiter is **in-process**. With `--workers 4` each worker keeps its own
> counters, so the effective limit is roughly 4x the configured value, and it does not hold
> across multiple hosts at all. Fine for a single-school deployment; revisit before scaling out.

---

## 10. Going live on a public URL — pre-flight

Everything above assumes a laptop on a private network. The moment this answers on a
public hostname, the threat model changes: the login page is reachable from any phone on
any network, and it fronts named minors' academic records.

Work top to bottom. Items marked **BLOCKER** must be done before the first public
request; the app cannot enforce them for you.

### 10.1 BLOCKER — the demo accounts must not exist

The `sims` database on this machine was populated by `seed_demo`, which creates **19
accounts sharing the password `SimsDemo2025!`** with `must_change_password = false`. That
password is written in plain text in this repository and in the seed script. If that
database is what goes live, the system is open to anyone who has seen either.

Before go-live, either provision a fresh database (§4, minimal seed `(a)`) or, on the
existing one:

```sql
-- See what you have. Every row here is a live credential.
SELECT email, role, must_change_password FROM users ORDER BY role, email;
```

Then delete every demo account you do not need, and for the ones you keep, force a reset
(`must_change_password = 1`) **and** set a fresh individual password through the app.
Flipping `must_change_password` alone does not invalidate the old password.

`seed_demo` now refuses to run unless `ENVIRONMENT=local` **and**
`SIS_ALLOW_DEMO_SEED=yes-destroy-my-data` — but that guard protects the future, not the
data already seeded.

### 10.2 BLOCKER — TLS, and one origin

Serve the SPA and the API from **the same origin** behind one reverse proxy:

```
https://sims.yourschool.edu.bz/           →  frontend/dist  (static files)
https://sims.yourschool.edu.bz/api/v1/    →  http://127.0.0.1:8000
```

Two reasons this is not merely tidier. The refresh cookie is `SameSite=None; Secure`
outside `local`, which browsers only accept over HTTPS — without TLS **every user is
silently logged out on each reload**. And same-origin means the CORS allow-list stops
being load-bearing at all.

Keep `VITE_API_BASE_URL=/api/v1` (relative). Rebuild the frontend after changing it —
Vite inlines env vars at build time, so editing `.env` on the server changes nothing.

The SPA is a single-page app: the proxy must serve `index.html` for any unmatched path,
or a hard reload on `/students/123` returns 404 from the web server.

### 10.3 BLOCKER — the database must not be on the internet

Bind MariaDB to loopback (`bind-address = 127.0.0.1` in `my.cnf`) and confirm port 3306
is not reachable from outside the host. The app connects over localhost; nothing else
needs to.

Also note the app currently connects as the **table owner**. There is no row-level
security behind it — application-layer RBAC is the only thing between a caller and the
data, which is why the authorization tests matter so much. A least-privilege application
user (no DDL, no DROP) is worth creating; it is tracked as `OQ-7.0-ROLE` and is not done.

### 10.4 Backend launch

```powershell
# NOT --reload. That is a development flag: it watches the filesystem, runs a
# supervisor process, and serves single-threaded.
$env:FORWARDED_ALLOW_IPS=""
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4 --forwarded-allow-ips=""
```

`--forwarded-allow-ips=""` is **mandatory** behind a proxy — see §9 for the measured
consequence of omitting it (an attacker rotating `X-Forwarded-For` gets a fresh
rate-limit bucket per request and writes any IP they like into the audit trail).

Bind to `127.0.0.1`, not `0.0.0.0`, so the app is reachable only through the proxy.

Run it under a process manager that restarts on failure and starts at boot (systemd on
Linux; NSSM or a Scheduled Task on Windows). **There is none configured today.**

### 10.5 Production `.env` differences

```ini
ENVIRONMENT=production                      # flips cookie Secure + HSTS, arms the guards
JWT_SECRET=<openssl rand -hex 32>           # >= 32 chars or the app refuses to start
DATABASE_URL=mysql+pymysql://<least-priv-user>:<urlencoded-pw>@127.0.0.1:3306/sims
CORS_ORIGINS=https://sims.yourschool.edu.bz # exact origin; never "*"
TRUSTED_HOSTS=sims.yourschool.edu.bz        # "*" logs a warning and answers to any host
TRUSTED_PROXIES=127.0.0.1                   # your proxy's address
HSTS_MAX_AGE=300                            # start LOW; raise to 31536000 once TLS is proven
```

`HSTS_MAX_AGE` low at first is deliberate: HSTS **cannot be un-sent** to a browser that
already cached it, so a year-long header on a misconfigured certificate locks users out
of the site for a year.

On startup the app refuses to boot on: the default or a short `JWT_SECRET`, an Argon2
work factor below the OWASP floor, the built-in `DATABASE_URL`, or an empty/`*` CORS
list. It logs `hardening_advisory` warnings for `TRUSTED_HOSTS=*`, empty
`TRUSTED_PROXIES`, and disabled rate limiting. **Read the startup log once after the
first deploy** — those advisories are the difference between "it runs" and "it is
configured".

### 10.6 Verify after deploying

```bash
curl -si https://sims.yourschool.edu.bz/api/v1/health   # 200
curl -si https://sims.yourschool.edu.bz/api/v1/ready    # 200 (503 = DB unreachable)
```

- Log in, then **hard-reload**. Staying logged in proves the `Secure` cookie works.
- Confirm `Strict-Transport-Security` is present on a response.
- Confirm `/api/v1/docs` — the interactive API browser is **public and unauthenticated**.
  It exposes no data, but it does hand an attacker a complete map of the API. Consider
  blocking `/api/v1/docs`, `/redoc` and `/openapi.json` at the proxy.
- In DevTools → Network, log in as a **student** and confirm no `feature-students`,
  `feature-settings`, `feature-teachers` or `feature-reports` chunk is ever requested
  (see §11).
- Fail a login 5 times and confirm the lockout `423`; keep failing and confirm the `429`.

### 10.7 Still missing (decisions, not code)

None of these are blockers for switching it on, but each is a real exposure. They are
tracked in `docs/testing-plan.md` §6 and the progress tracker:

- **No backups.** Nothing is scheduled and no restore has ever been tested. For student
  records this is the largest remaining risk on this list — an untested backup is not a
  backup. A nightly `mysqldump` off-host is a few lines.
- **No reproducible provisioning.** Alembic cannot run against MariaDB (§4), so rebuilding
  the schema is a manual four-file sequence.
- **Retention not scheduled.** `python -m app.jobs.purge` works (`--dry-run` first) but
  nothing calls it, so `login_attempts` and `audit_log` grow without bound.
- **The rate limiter is in-process.** With `--workers 4` the effective limit is ~4x the
  configured value. Fine for one school; it does not hold across hosts.
- **No CI, no automated frontend tests**, and the eight manual UAT scripts in
  `docs/testing-plan.md` §5 have not been executed against a live deployment.

---

## 11. Frontend build and role-scoped loading

```powershell
cd frontend
npm run build        # tsc -b && vite build → dist/
```

Serve `dist/` as static files (§10.2). Rebuild whenever a `VITE_*` value changes.

**Each role downloads only the screens it can reach.** Every feature module is a
`React.lazy` boundary in `src/app/router/routes.tsx`, wrapped so the `RoleRoute` guard
runs *outside* `Suspense` — a role without access redirects before the component mounts,
so its chunk is never fetched. Chunks are named for their feature
(`feature-grades-<hash>.js`), which is what makes this verifiable in DevTools rather than
merely claimed.

First load is the shell plus vendor chunks (~247 kB gzip); it was ~425 kB with every
role's screens in one file. `charts` (recharts, 110 kB gzip) now loads only for screens
that draw charts.

⚠️ **This is a payload measure, not a security boundary.** Chunk URLs are public and
anyone can fetch one directly. What protects data is the server re-checking role and
ownership on every call (NFR-SEC-01).

### The mock layer is excluded from production builds

`npm run build` produces a bundle containing **no** MSW runtime, **no** mock handlers,
**no** demo dataset, and no `mockServiceWorker.js` — verified by grepping `dist/`. It is
gated on `VITE_ENABLE_MOCKS` being statically false at build time, so Rollup drops the
branch entirely (`src/main.tsx`), and a Vite plugin deletes the stray worker file.

Previously all of it shipped to production, dormant behind a runtime flag. If you ever
see `[MSW] Mock layer active` in a production console, the build was made with
`.env.demo` — rebuild with `npm run build`, not `npm run build:demo`.

---

## 8. Known gaps

Tracked in the production-readiness plan; none block local use. **For public deployment,
read §10 — several of these become blockers there.**

- 🔴 **The live `sims` database contains 19 accounts sharing the password
  `SimsDemo2025!`** (`must_change_password = false`), because `seed_demo` created them and
  that password is in this repository. Harmless on a laptop, catastrophic on a public URL.
  See §10.1 before going live.
- ~~**`GET /students/me/years` and `GET /students/{id}/years` return 404 live**~~ — **stale,
  both are served.** Verified in the live route table (`app/modules/students/router.py:104`
  and `:142`), with `/me/years` declared first so "me" is never parsed as a UUID. The
  student year-switcher works against the real API.
- **No backups, no Dockerfile, no CI**, and no production process manager. The only
  documented local launch uses `--reload`, a dev flag — see §9 for the production form.
- **Retention is not scheduled.** `python -m app.jobs.purge` exists (add `--dry-run` to see
  counts without deleting) and trims `login_attempts`, `audit_log` and expired
  `refresh_sessions` to the configured windows, but nothing runs it on a timer yet —
  scheduling waits on a deployment target. Until then those tables still grow.
- **`backend/openapi.json` is stale** — it predates `/api/v1/ready`. It is a hand-maintained
  snapshot with no regeneration script.
- **School-logo upload is stubbed** — validation is real, the byte upload is not
  (`TODO(OQ-DB5)`, needs an object-storage bucket).
- ~~**MSW ships in the production bundle**~~ — **fixed.** The mock runtime, handlers, demo
  dataset and `mockServiceWorker.js` are all excluded from a `npm run build` bundle. See §11.
- **`frontend/openapi.json` is stale** (covers 4 of 14 modules). Don't run
  `npm run generate:api` until it's refreshed from `backend/openapi.json`.
- **`/api/v1/docs` and `/openapi.json` are public and unauthenticated.** They expose no
  data but publish a complete map of the API surface. Consider blocking them at the proxy
  (§10.6).

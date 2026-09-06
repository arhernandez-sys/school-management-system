# SIS — Runbook

Operational guide for the School Information System: how to run it, how to point it at a
database, and how to recover when something breaks.

- **Backend** — FastAPI + SQLAlchemy (sync, pymysql), **Python 3.12** (3.11+ required)
- **Frontend** — React 19 + TypeScript + MUI + Vite, TanStack Query. **Node 22 / npm 10**
- **Database** — self-hosted **MariaDB 12.3** (`sims`)
- **API surface** — 103 paths / 145 operations, all under `/api/v1`

**New here? Go to §1 — first-time setup — then §3 to start both halves.**

> The docs under `docs/` still describe PostgreSQL on Railway in several places
> (`database-schema.md`, `architecture.md`, `api-specification.md`). That is **stale**.
> MariaDB is authoritative — see `docs/progress-tracker.md` line 111 and
> `backend/db/mariadb/README.md`. Reconciling those docs is Step 5 of the production plan.

---

## 1. First-time setup

Two independent installs: a Python virtualenv for the backend, and `node_modules` for the
frontend. Neither knows about the other. **Do both once, then jump to §3.**

### 1.1 Prerequisites

| | Version | Check |
|---|---|---|
| Python | **3.11+** (3.12.10 here) | `python --version` |
| Node.js | **22.x** (22.15.0 here) | `node --version` |
| npm | **10.x** (10.9.2 here) | `npm --version` |
| MariaDB | **12.3** — only for `npm run dev`, not for `npm run demo` | HeidiSQL, or `mysql --version` |

`npm run demo` needs neither Python nor MariaDB — it is the browser and mocks only. If a
demo is all you want, do §1.3 and stop.

### 1.2 Backend — the virtualenv

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend

# 1. Create the venv. It lives at backend\.venv and is gitignored.
python -m venv .venv

# 2. Upgrade pip inside it. Note: `.\.venv\Scripts\python.exe -m pip`, never a bare
#    `pip` — a bare `pip` may be a DIFFERENT interpreter's pip and will install into
#    the wrong place while appearing to succeed.
.\.venv\Scripts\python.exe -m pip install -U pip

# 3. Install. THIS is the line you want on a dev machine:
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

**~40 packages, under a minute.** Verify:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_requirements_sync.py -q
```

That test compares `requirements*.txt` against `pyproject.toml` **and against what is
actually installed in the venv**, so a green run means the environment matches the pins the
suite was proven against. It is the fastest check that setup worked.

#### Which install command?

| Command | Installs | Use when |
|---|---|---|
| `pip install -r requirements-dev.txt` | runtime + pytest/httpx | **normal dev work** |
| `pip install -r requirements.txt` | runtime only | deploys, containers, CI |
| `pip install -e ".[dev]"` | the same, plus `sis-backend` as an editable package | you want `import app` to resolve from outside `backend\` |

All three give the same dependency versions — `requirements.txt` mirrors
`pyproject.toml`, enforced by the test above. The difference is only whether the app itself
is installed as a package. **The suite and `uvicorn` do not need it installed**, because
both are run from `backend\` where `app/` is already importable.

> **`.venv` is not portable.** It hardcodes absolute paths. Never copy one between
> machines or commit it — delete and recreate instead.

#### Why exact pins everywhere

Every line in `requirements.txt` is `==`. There is **no lockfile and no CI** in this
project, so the pins *are* the lockfile: they are the only thing making "the suite passed"
mean the same on two machines. `test_requirements_sync.py` fails on any unpinned line.

#### `backend\.env` is required for anything DB-backed

Copy or create it before starting the server or running the suite — §4 has the contents.
Without it, `app/config.py` falls back to defaults and points at the wrong database.

### 1.3 Frontend — node_modules

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\frontend
npm install

# REQUIRED on a fresh clone — see below. Creates public/mockServiceWorker.js.
npx msw init public/ --save
```

**`npm install` does NOT create the MSW service worker, despite what this runbook used to
say.** There is no `postinstall` script in `package.json`, and
`public/mockServiceWorker.js` is **gitignored** (`frontend/.gitignore:29`) — so on a fresh
clone the file simply does not exist and nothing generates it.

The symptom is misleading: `npm run demo` starts fine and the app loads, then **every
request 404s**, because the worker that was supposed to intercept them is not there. If a
fresh clone's demo mode looks broken, run the `msw init` line before investigating anything
else. `.env.demo` is gitignored for the same reason and has the same effect — §4 has its
contents.

> ⚠️ **`npm run build` and `npm run dev` cannot run on this machine** — esbuild's binary is
> blocked by policy, and Vite needs it. `npm run demo` is affected the same way. What DOES
> work: `npx tsc -b --force` (typecheck), `npx eslint .` (lint), and the plain-Node probes
> in `frontend/scratchpad/`. See §7.

---

## 2. Two ways to run

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

## 3. Running against the live database

Two terminals. Both must stay open.

### How it fits together

```
        browser
           │  http://localhost:5173
           ▼
   ┌─────────────────────┐
   │  Vite dev server    │   frontend/ · npm run dev
   │       :5173         │
   │                     │   serves the SPA, AND proxies:
   │   /api/v1/*  ───────┼──────────┐
   └─────────────────────┘          │  vite.config.ts → server.proxy
                                    ▼
                          ┌─────────────────────┐
                          │  uvicorn / FastAPI  │   backend/ · uvicorn app.main:app
                          │       :8000         │
                          └──────────┬──────────┘
                                     │  SQLAlchemy + pymysql
                                     ▼
                          ┌─────────────────────┐
                          │  MariaDB  `sims`    │   127.0.0.1:3306
                          │       :3306         │
                          └─────────────────────┘
```

**The browser never talks to `:8000` directly, and that is deliberate.**
`frontend/.env` sets `VITE_API_BASE_URL=/api/v1` — a *relative* base — so every request
goes to `:5173` and Vite forwards `/api/v1/*` to `:8000`. That makes the calls
**same-origin**, which is what lets the `SameSite=Lax` HttpOnly refresh cookie work over
plain http. Point the base at `http://localhost:8000` instead and login appears to succeed
but the session dies on the first refresh, because the browser drops the cookie as
cross-site. §4 says the same thing under "Why the base URL must stay relative".

Production mirrors this shape: one origin, a reverse proxy sending `/` to the static bundle
and `/api/v1` to uvicorn (§9).

**Start order does not matter.** The frontend proxies lazily, so a request made before
uvicorn is up returns a 502 and works on retry — nothing needs restarting.

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

### Demo mode — one terminal, no backend, no database

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\frontend
npm run demo
```

`--mode demo` loads `.env.demo`, which sets `VITE_ENABLE_MOCKS=true`. A **service worker
(MSW)** then intercepts every `/api/v1/*` call inside the browser and answers it from the
in-memory dataset in `src/shared/api/mocks/demo/` — nothing leaves the page. Log in by
typing `principal`, `secretary`, `teacher` or `student` with **any** password.

Use it for client demos and offline UI work. §2 lists what differs from the real thing.

### Stopping

`Ctrl+C` in each terminal. Neither leaves anything behind: the backend holds no lock and
the frontend writes nothing outside `node_modules/.vite` (its cache — safe to delete if the
dev server starts behaving oddly after a dependency change).

### Logins

**Every account has its OWN generated password, printed once per seed run to
`backend/db/mariadb/generated/demo-credentials.txt`** (untracked). Read them there — there is
no shared password any more. Before D31 Phase 5 all 19 accounts shared `SimsDemo2025!` with
`must_change_password = false`, and the Argon2 hash of it was committed in
`010_seed_demo.sql`, so rotating the constant in the script fixed nothing.

| Role | Email | Count |
|---|---|---|
| principal | `principal@belmopancomp.edu.bz` | 1 |
| secretary | `secretary@belmopancomp.edu.bz` | 1 |
| teacher | `alicia.cano@belmopancomp.edu.bz` | 11 |
| student | `s-25001@student.belmopancomp.edu.bz` | 6 |

The login field accepts an **email address** (the API field is `identifier`, not `email`).
Note only 6 of the 45 student profiles have user accounts — the rest exist as records only.

**Expect to change the password on first login.** Every seeded account starts with
`must_change_password = true`, and the server ENFORCES it: until you change it, the API answers
**403 `password_change_required`** on everything except `GET /auth/me`,
`PATCH /auth/me/password` and `POST /auth/logout`. In the browser the app redirects you to the
change-password screen; with `curl` or the docs UI you must `PATCH /api/v1/auth/me/password`
first (`current_password` may be omitted in this flow). The exempt set lives in
`backend/app/core/deps.py`.

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

## 4. Environment files

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

## 5. Provisioning a database from scratch

> Not needed on this machine — `sims` is already provisioned and seeded.

**Alembic does not work.** The single revision
(`backend/alembic/versions/0001_initial_schema.py`) is PostgreSQL-only — native enums,
`pgcrypto`, RLS, `CREATE INDEX CONCURRENTLY`. Running `alembic upgrade head` against MariaDB
will fail. This is a known, accepted gap: fresh provisioning is **manual**.

Apply these in **exact order** against the `sims` database. All are re-runnable.

Two ways to run one:

```powershell
# (a) From a terminal — reads DATABASE_URL from backend/.env, prints each statement's result.
#     Must be run from `backend\` (the .env path is relative).
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py --check                      # inspect, change nothing
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py --backup pre.sql             # snapshot first
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\005_tertiary.sql  # apply
```

(b) HeidiSQL — open the file and run the whole thing.

Prefer (a): it reports per-statement, so a failure names the exact statement instead of
leaving you to find it. It exists because Alembic cannot be used here (see above).

| # | File | Purpose |
|---|---|---|
| 1 | `backend/db/mariadb/sims.sql` | Base legacy schema. **Empty DB only.** |
| 2 | `backend/db/mariadb/001_missing_fields.sql` | The big ORM reconciliation — renames, type changes, PK swaps, FK adds, generated columns emulating Postgres partial-unique indexes |
| 3 | `backend/db/mariadb/002_column_defaults.sql` | `CURRENT_TIMESTAMP` defaults on `login_attempts.attempted_at`, `refresh_sessions.issued_at`/`last_used_at`. **Without this the entire auth flow fails** with MariaDB error 1364 |
| 4 | `backend/db/mariadb/003_subjects_is_active.sql` | Converts `subjects.is_active` from generated to a real column |
| 5 | `backend/db/mariadb/004_subject_class_model.sql` | **D29 sixth-form subject-class model** — adds `class_meetings` and `student_profiles.year_group`. **This step was missing from the list**, so a DB provisioned by following this runbook had no timetable table and the Timetable module was dead |
| 6 | `backend/db/mariadb/005_tertiary.sql` | **D30 tertiary / junior-college model (BAJC)** — the `courses` catalog, `programs`, curriculum, prerequisites, grade points, applications, credit transfer, grade revisions, `YYYYMM###` student-ID sequences. See `docs/tertiary-refactor-plan.md` |
| 7 | `backend/db/mariadb/006_courses_cutover.sql` | **D30 Phase 2A catalog cutover** — swaps the catalog FKs from `subjects` to `courses` and comments `subjects` as retired (it is kept, not dropped). Applied 2026-08-16 together with the ORM change that points `Subject.__tablename__` at `courses`; applying it against an OLDER checkout of the app breaks every course write with 1452. |
| 8 | `backend/db/mariadb/007_student_names.sql` | **D30 Phase 1 name split** — tightens `student_profiles.lastname` to NOT NULL and **drops `full_name`**, which becomes a computed property on the ORM. Same rule as `006`: apply it with the matching code, never against an older checkout, or every student INSERT fails on the NOT NULL column. |
| 9 | `backend/db/mariadb/008_course_offerings.sql` | **D31 offering model** — `course_offerings` replaces `classes` + `class_subjects`. Re-points every child (`assessments`, `assessment_categories`, `class_teachers`, `class_meetings`, `term_grade_snapshots`, `class_enrollments`, `attendance_records`, `announcements`) from `class_id`/`class_subject_id` to `offering_id`, drops `student_profiles.year_group`, and quarantines 7 superseded tables as `*_legacy_pre_d31` (renamed, never dropped). Same rule as `006`/`007`, and it matters most here: **apply it with the matching code**, or every offering write breaks. Verify with `python db\mariadb\verify_schema.py --expect 008` (20 probes). See `docs/tertiary-offerings-refactor-plan.md` |
| 10 | `backend/db/mariadb/009_midterm_windows.sql` … `016_hod_auditor_roles.sql` | D32–D43, in numeric order. Each is re-runnable and documented in its own header. |
| 11 | `backend/db/mariadb/017_sims10_reconcile.sql` | **D44 — the client's `sims_10` dump.** The ten-state `applications.status` (renaming `denied` → `rejected`, with the data migration), `application_number` + backfill, `number_sequences` (replacing `student_number_sequences`), `term_type` += `independent`, `semester_status`, three `programs` columns, the `classroom` table, `course_offerings.classroomid` + FK, and `users.role` += `sysadmin`. **Four of the dump's decisions are deliberately NOT reproduced** — read the file header before touching it, especially `programs.head_of_dept_id` (not added; `program_heads` owns that fact) and the LOWERCASE `independent`. Verify with `python db\mariadberify_schema.py --expect 017` (17 probes). See `docs/d44-sims10-and-meeting3.md` |

> 🔴 **`008` is DESTRUCTIVE, and its destructive half is gated on a pre-collapse sentinel.**
> Every `DELETE` is keyed on `class_subjects` still existing, so a replay *after* the demo data
> has been re-seeded deletes nothing. That gate is why the deletes are safe to ship inside a
> migration at all. It also carries **no hardcoded `USE \`sims\`;`** (unlike `005`–`007`), so
> it honours the DSN you connect with — which is what makes rehearsing it on a copy possible.
>
> ⚠️ **The pre-`008` demo data is destroyed, not migrated.** Forced, not chosen: `classes` is
> year-scoped and an offering is semester-scoped, so one academic year maps to *two* semesters
> and nothing in the data says which. Take a backup first
> (`apply_sql.py --backup` plus a `mysqldump`).

Then seed. **(a) and (b) are both reference data — run both, in order. (c) is optional.**

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend

# (a) Minimal bootstrap — idempotent, safe on a populated DB.
#     Creates school profile, one academic year + 2 semesters, grading scale,
#     and ONE principal with a generated temp password PRINTED ONCE. Copy it.
.\.venv\Scripts\python.exe -m app.db.seed

# (b) The REAL BAJC catalog (D30 Phase 2D) — idempotent, safe on a populated DB.
#     114 courses, 8 programmes, 243 curriculum rows, 63 prerequisites, and the
#     Internship's ALL-COURSES gate, from the 2026/27 course sequences.
#     `--dry-run` reports what would change and rolls back.
#     REQUIRED BEFORE (c): the demo seed references these courses by code.
.\.venv\Scripts\python.exe -m app.db.seed_bajc

# (c) The BAJC GRADING SCALE (D30 Phase 3) — idempotent, `--dry-run` supported.
#     Re-bands existing grading scales onto the 8-band BAJC scale with grade points:
#     A 95-100 (4.00) ... C 70-74 (2.00), D 65-69 (1.00, FAIL), F 0-64 (0.00, FAIL),
#     pass_mark 70. `app.db.seed` already creates it for a NEW year, so this is only
#     needed on a database provisioned before Phase 3.
#     It SKIPS frozen scales on purpose: an archived year keeps the bands that were in
#     force when it ran (schema 10.4), so its report cards do not get re-lettered.
.\.venv\Scripts\python.exe -m app.db.seed_grading_scale

# (d) Full demo dataset — 19 users / 45 students / ~4,400 rows.
.\.venv\Scripts\python.exe -m db.mariadb.seed_demo
```

> ⚠️ **Without (c), the GPA is weightless.** `grading_scale_bands.grade_point` is NULL on a
> pre-Phase-3 scale, so `calc.grade_point_for` answers None for every letter, every report
> card prints GPA 0.00, and `calc.meets_grade_point` falls back to the band's `is_passing`
> when gating prerequisites. Nothing errors — which is exactly why it is easy to miss.

> 🔴 **`seed_demo` IS DESTRUCTIVE.** It runs `DELETE FROM` against its seeded tables before
> inserting. Never point it at anything you care about.
>
> ⚠️ It does **NOT** touch `courses`. The catalog is reference data owned by
> `app.db.seed_bajc`; clearing it here — FK checks are off during that sweep — would
> silently destroy 114 courses and every programme curriculum hanging off them. `seed_demo`
> resolves its courses by code and fails loudly if the catalog seed has not been run.
>
> 🔴 It creates 19 login accounts and deletes every row in ~34 tables. **This must never run
> against production.** Two independent guards must both be satisfied on purpose
> (`ENVIRONMENT=local` **and** `SIS_ALLOW_DEMO_SEED=yes-destroy-my-data`), and it prints the
> target database — with the password redacted — when it refuses.
>
> Since D31 Phase 5 each of those accounts gets its OWN generated password with
> `must_change_password = true`, written to `backend/db/mariadb/generated/demo-credentials.txt`.
>
> The static equivalent is now **`backend/db/mariadb/generated/010_seed_demo.sql`**, written by
> the same run, if you'd rather load it in HeidiSQL. It is gitignored and must not be committed
> or copied between machines: it carries that run's password hashes. Re-generate instead.
>
> It also requires `008_course_offerings.sql` to have been applied, and says so before touching
> anything rather than failing halfway through the sweep.

### Fresh machine, first time

**Moved to §1 — first-time setup.** It covers the venv, `requirements-dev.txt`, `npm
install`, and how to verify each half. A second copy here had already started to drift
(it recommended a different install command), which is why it is a pointer now and not
a duplicate.

Then come back to this section to provision the database itself.

---

## 6. Database timezone — important

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

## 7. Tests

See `docs/testing-plan.md` for the full plan — strategy, coverage, gaps and the manual UAT
scripts. Quick reference:

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe -m pytest -q                       # full suite — ~3m40s
.\.venv\Scripts\python.exe -m pytest tests/test_auth.py -q       # one module — seconds
.\.venv\Scripts\python.exe -m pytest -m "not requires_db" -q    # DB-free subset
.\.venv\Scripts\python.exe -m pytest -q --durations=10          # find the slow ones
.\.venv\Scripts\python.exe -m pytest tests/test_requirements_sync.py -q  # setup sanity, <1s
```

- **1,633 tests, all green** (D37, 2026-08-23), in about **1m15s–3m40s** (it varies with
  connection warmth). Run the whole thing —
  cherry-picking a file is how a cross-module regression gets missed.
- The count and the runtime both grew a lot since this section was written (it said 941
  tests / 56 seconds). If the number you see is materially lower, you are probably on a
  stale checkout.
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

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| UI shows data but uvicorn logs nothing | MSW intercepting | `VITE_ENABLE_MOCKS=false` in `frontend/.env`, hard-reload |
| Login 422 `identifier: Field required` | Posting `email` instead of `identifier` | Field is `identifier` |
| Logged out on every hard refresh | `VITE_API_BASE_URL` is absolute → cross-site `SameSite=Lax` cookie dropped | Set it back to `/api/v1` |
| `423` on login with `retry_after_seconds` | Account lockout, 5 failures / 900s | Wait, or clear `users.failed_login_count` + `locked_until` |
| Backend starts but every query fails | Started from the wrong directory → `.env` not found | `cd backend` first |
| MariaDB error 1364 "doesn't have a default value" on login | `002_column_defaults.sql` never applied | Apply it |
| `alembic upgrade head` fails | The revision is Postgres-only | Don't use Alembic — see §5 |
| CORS error in browser console | Origin missing from `CORS_ORIGINS` | Add it, restart backend |
| Timestamps display 6 hours early | Rows written before the §6 fix | Cosmetic; re-seed if it matters |
| `npm run demo` shows a blank/404 app | Missing `public/mockServiceWorker.js` or `.env.demo` (both gitignored) | `npx msw init public/ --save`, recreate `.env.demo` per §4 |

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

**Still a blocker, but for a smaller reason than before.** D31 Phase 5 fixed the *cause*: the
seed now generates a separate password per account with `must_change_password = true`, the
server enforces that flag, and the SQL file carrying the hashes is no longer tracked in git.
What it could not fix is *data already written* — and until the `sims` cut-over is run (see
`docs/tertiary-offerings-refactor-plan.md`, "The `sims` cut-over"), the `sims` database on this
machine **still holds the 19 pre-D31 accounts sharing `SimsDemo2025!` with
`must_change_password = false`**, and that password is still in this repository's git history.
If that database is what goes live, the system is open to anyone who has read the history.

Before go-live, either provision a fresh database (§5, minimal seed `(a)`) or, on the existing
one:

```sql
-- See what you have. Every row here is a live credential.
-- The pre-D31 rows are the ones with must_change_password = 0.
SELECT email, role, must_change_password FROM users ORDER BY role, email;
```

Then delete every demo account you do not need, and for the ones you keep, force a reset
(`must_change_password = 1`) **and** set a fresh individual password through the app.
Flipping `must_change_password` alone does not invalidate the old password — though it now does
stop the account doing anything else until the change is made, which it did not before.

`seed_demo` refuses to run unless `ENVIRONMENT=local` **and**
`SIS_ALLOW_DEMO_SEED=yes-destroy-my-data`, and it never writes a shared password — but those
guards protect the future, not the data already seeded.

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
- **No reproducible provisioning.** Alembic cannot run against MariaDB (§5), so rebuilding
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

## 12. Known gaps

Tracked in the production-readiness plan; none block local use. **For public deployment,
read §10 — several of these become blockers there.**

- 🔴 **The live `sims` database still contains 19 accounts sharing the password
  `SimsDemo2025!`** (`must_change_password = false`), because the pre-D31 `seed_demo` created
  them and that password is in this repository's git history. Harmless on a laptop,
  catastrophic on a public URL. **The code cause is fixed** — the seed now generates a password
  per account with the forced-change flag, the server enforces that flag, and the hash file is
  untracked — but these ROWS survive until the `sims` cut-over re-seeds them
  (`docs/tertiary-offerings-refactor-plan.md`). See §10.1 before going live.
- ⚠️ **This checkout cannot run against `sims` yet.** D31 is committed and the code expects
  `008_course_offerings.sql`, which is deliberately **not** applied to `sims`. Point
  `DATABASE_URL` at `sims_d31` (which has `008` and the D31 demo data) until the cut-over is
  done.
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

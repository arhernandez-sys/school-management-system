# The project as it stands — 10 September 2026

_What this system is **today**: the stack, the shape, how to run it, and where each thing
lives. For the history of how it got here see [`complete-work.md`](complete-work.md); for
what is still open see [`needs-attention.md`](needs-attention.md)._

---

## 1. Stack

| Layer | What | Notes |
|---|---|---|
| Frontend | **React 18 + TypeScript + MUI v6**, Vite 5 | `frontend/`. Route-level code splitting; ~403 source files |
| Backend | **FastAPI + SQLAlchemy 2.0, Python 3.12** | `backend/`. 15 modules under `app/modules/` |
| Database | **MariaDB 12.3**, self-hosted, database `sims` | HeidiSQL on `127.0.0.1:3306` |
| Demo mode | **MSW** in-browser mocks over a hand-built dataset | A second implementation of the API — see the warning below |
| Auth | JWT access + rotating refresh cookie, Argon2id | — |

⚠️ **The stack diverges from the blueprint's suggestion** (Laravel/ASP.NET, PostgreSQL).
That is settled and not worth revisiting — the blueprint's own wording is "recommended
option", and none of its architectural properties are lost.

⚠️ **Demo mode is a second implementation of the whole API.** It has disagreed with the
real backend five times and each disagreement type-checked perfectly. Anything changed in
`app/modules/**` must be mirrored in `frontend/src/shared/api/mocks/handlers/**`, and the
probes are how you check.

---

## 2. Running it

```bash
# Backend — always through the project venv, never the global python
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload     # http://127.0.0.1:8000
.\.venv\Scripts\python.exe -m pytest -q                          # ~2 min, 2161 tests

# Frontend
cd frontend
npm run dev      # real API
npm run demo     # MSW mocks, no backend needed
npm run build
```

⚠️ **`vite dev` binds IPv6 localhost.** `curl http://127.0.0.1:<port>` is refused;
`http://localhost:<port>` answers. That refusal is not a dead server.

⚠️ **`pytest` points at whatever `DATABASE_URL` says, and `.env` says live `sims`.**
Copy `sims` to a scratch database and point at that before running the suite or anything
that writes:

```bash
DATABASE_URL='mysql+pymysql://root:<pw>@127.0.0.1:3306/sims_test' .\.venv\Scripts\python.exe -m pytest -q
```

---

## 3. The database

**One live database: `sims`.** One throwaway: `sims_test`, recreated in place.

`backend/db/mariadb/sims_final.sql` is the **complete current dump** — 44 tables with
data, including every schema change through D45. It is the single provisioning artefact:

```sql
-- fresh environment, from scratch
SOURCE backend/db/mariadb/sims_final.sql;
```

⚠️ **The 20 numbered migrations (`001_…sql` … `020_…sql`) were deleted on 10 Sep 2026.**
They are in git history if a specific change ever needs re-reading. `sims_final.sql`
supersedes them: every one of them had already been applied to the database it was dumped
from. Source files still mention them by name in docstrings ("`005_tertiary.sql` §8 moved
this column") — that prose is the surviving record of *why* a column exists, and it was
deliberately left alone.

Still in `backend/db/mariadb/`:

| File | What it is |
|---|---|
| `sims_final.sql` | The current database. The only provisioning artefact |
| `verify_schema.py` | Probes a live database for the columns, indexes and FKs the code expects |
| `apply_sql.py` | Applies a `.sql` file with an optional backup first |
| `seed_demo.py` | Rebuilds demo data; generates per-account passwords into gitignored `generated/` |
| `README.md` | How to provision |

---

## 4. Repository shape

```
backend/
  app/
    main.py            app factory, middleware, router mounting
    config.py          settings from .env
    common/            enums, shared schemas, audit modules, numbering
    core/              deps (the auth choke point), rbac, errors, pagination, timeutil
    db/                base, session, models registry, seeds
    modules/           auth · settings · students · teachers · courses · programs ·
                       offerings · prerequisites · assessments · grades · attendance ·
                       admissions · announcements · events · reports · audit ·
                       dashboard · classrooms · timetable · users
  tests/               2161 tests, one module per feature area
  db/mariadb/          the dump and its tooling

frontend/
  src/
    app/               router, guards, layout (Sidebar, TopBar, AppShell), providers
    features/          one directory per module, each with screens/ components/ hooks/ api/
    shared/
      api/             axios client, generated orval client, mocks/ (MSW + demo dataset)
      components/      DataTable, StatCard, ChartWithTable, FilterBar, DateField, …
      auth/            the permission matrix
      types/           wire types
    theme/             MUI theme — BAJC navy #1E3A6E, crimson #C21F30
  scratchpad/          executable probes (see below)

docs/                  see documentation-map.md
RUNBOOK.md             operations: setup, deploy, troubleshooting
```

---

## 5. Roles

| Role | Wire value | Reach |
|---|---|---|
| Dean | `principal` | Everything, including the audit trail |
| Registrar | `secretary` | Records, admissions, enrolment. **Not** the audit trail — they are its most frequent subject. No grades (D39) |
| Lecturer | `teacher` | Their own offerings only — ownership, not role, is the limit |
| Head of Programme | `hod` | A Lecturer, plus read access to their programme(s) via `program_heads` |
| Student | `student` | Their own records |
| Auditor | `auditor` | Reads everything, writes nothing — enforced centrally |
| System Administrator | `sysadmin` | Accounts, configuration, backups. **No academic data at all** |

The permission matrix lives in `frontend/src/shared/auth/permissions.ts` for nav
visibility, and the server enforces independently on every request. Page visibility is a
payload measure only.

---

## 6. Conventions that are load-bearing

- **One definition per rule.** `grades/calc.py` for term grades, `_summarize` for
  attendance percentages, `offerings/labels.py` for an offering's name,
  `STUDENT_NAME_ORDER` for register order. A second implementation drifts, and the screen
  is what shows the drift.
- **Dates are dd/mm/yyyy** via the shared `DateField`. Never `<input type="date">` — it
  renders in the *browser's* locale and no prop changes that.
- **The UI says "Session", not term or semester.** The wire fields are still
  `semester_id` / `term_type`; only the display copy changed.
- **America/Belize** is the school timezone; the server renders dates, not the client.
- **Soft deletes** via `deleted_at` on most tables; unique indexes are partial on it.
- **Every mutation writes `audit_log`**, and `module` / `ip_address` are filled by a
  listener so no call site can forget them.

---

## 7. Verification tooling

| Tool | What it proves |
|---|---|
| `pytest` (2161) | Backend behaviour, against a scratch copy of the real database |
| `frontend/scratchpad/probe_*.mjs` (10) | The **real MSW handlers**, executed under `msw/node` |
| `probe_dean_render.mjs` | A React component actually renders, and its links point where they claim |
| `shoot_dean.mjs` | Headless-Chrome screenshots — the only way to judge how something looks |
| `check_msw_routes.mjs` | Demo routes match the server's OpenAPI (no ghost routes) |
| `verify_schema.py` | The live database matches what the code expects |
| `tsc -b --force` | ⚠️ Use `--force`; the incremental build has hidden an undefined identifier |

# Testing Plan — School Management System (SIS)

_Authored 2026-07-29 (Phase 8, Step 4 — QA foundation). Supersedes the placeholder stub._

This document says what is tested, how to run it, **what is not tested**, and what "done"
means for Phase 8. It is written to be read by someone deciding whether this system is safe
to put in front of a school, so the gaps are stated as plainly as the coverage.

Companion documents: `RUNBOOK.md` (how to run things), `docs/requirements.md` §5 (the eight
acceptance-criteria flows this plan traces to), `complete-work.md` (project state).

---

## 1. Testing strategy

The system is a modular monolith with a **finished frontend that was built first**, against
MSW mock handlers. That single fact shapes the whole strategy:

- **The frontend's MSW handlers were the binding API contract.** Where
  `docs/api-specification.md` disagreed with a handler, the handler won and the spec was
  corrected. Contract conformance is therefore asserted in the backend tests as **exact
  response key sets** (`assert set(body.keys()) == {...}`), including the deliberately
  asymmetric ones (`class_ref` not `class`; `teachers[].name` in Attendance vs
  `teachers[].full_name` in Grades; the student dashboard's `announcements` vs everyone
  else's `recent_announcements`; `letter` omitted rather than `null`).
- **Type generation is not contract verification.** `orval` generates TypeScript *from* the
  OpenAPI schema; it never compares that schema to hand-written frontend types. So a green
  `npm run typecheck` proves the frontend is internally consistent, not that the backend
  agrees with it. Only the key-set assertions above do that.
- **Authorization is application-layer and must be tested as such.** The app connects to
  MariaDB as the table owner; there is no row-level security backstop. Every RBAC and
  ownership rule is enforced in Python, so an untested authorization path is an unprotected
  one. This is why the suite is dense with negative cases.
- **404-vs-403 discipline is a test target, not a detail.** The rule is that a caller who
  may not know a record exists gets **404**, not 403. It appears in nearly every module and
  is asserted per module.

### Test levels

| Level | What it is | Where | Needs a DB |
|---|---|---|---|
| **L0 — pure unit** | Grade computation, letter bands, the school clock, config guards, harness guards | `test_grade_calc.py`, `test_qa_foundation.py`, most of `test_hardening.py` | **No** |
| **L1 — module integration** | Real HTTP requests through the real app to the real database, per endpoint, per role | the 15 `test_<module>.py` files | Yes |
| **L2 — manual UAT** | A human driving the browser against the live API, per role | §5 of this document | Yes |
| **L3 — absent** | Automated frontend tests, browser E2E, load/perf, fresh-provisioning | — | see §6 |

L0 exists as a deliberate category, not an accident. The grade engine
(`app/modules/grades/calc.py`) is pure by construction — no `Session`, no ORM, no I/O — and
its 65 tests carry **no `requires_db` marker**, so the arithmetic that determines a student's
report card is locked where it runs in under a second and **cannot be masked by a skipped
suite**. Anything that can be made DB-free should be.

### Isolation model

`tests/conftest.py` wraps every test in a transaction that is **always rolled back**: one
connection, an outer transaction, and a `Session` bound with
`join_transaction_mode="create_savepoint"` so a `commit()` in the code under test lands on a
savepoint instead of ending the outer transaction. Nothing the suite writes is ever
committed.

Consequences to know:
- Tests **cannot** exercise behaviour that needs a real cross-connection commit to be visible
  to a second connection. Nothing currently needs that; a test that does must use a dedicated
  schema instead.
- Fixtures create their own users, sections and offerings inside the rollback rather than
  leaning on the seeded demo data, so the suite is hermetic and never mutates `sims`.
- The suite **still runs against the live `sims` database** — see §6.1, this is the single
  largest structural gap.

---

## 2. Running the tests

From `backend/`, with the venv Python (never a bare `pytest` — it may resolve outside the
venv):

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend

.\.venv\Scripts\python.exe -m pytest -q                        # everything
.\.venv\Scripts\python.exe -m pytest tests/test_grades.py -q    # one module
.\.venv\Scripts\python.exe -m pytest -m "not requires_db" -q    # DB-free only
.\.venv\Scripts\python.exe -m pytest -q --durations=10          # find the slow ones
```

Everything runs from `backend/`, but the harness is cwd-independent by design: `conftest.py`
reads `DATABASE_URL` out of `.env` at an **absolute** path anchored to its own location, so
running from the repo root does not silently skip the entire DB suite (it once did).

### Why the suite is fast now, and what keeps it that way

The suite took **~18 minutes** and now takes **~56 seconds**. Two changes, both in
`conftest.py`, both guarded by `tests/test_qa_foundation.py`:

1. **The app is built once per session, not once per test.** `create_app()` costs ~1.3s —
   it registers 99 operations and FastAPI builds a validator/serializer pair for each. The
   `app` fixture was function-scoped, so all 941 tests paid it: **~20 minutes of pure route
   construction**, which was essentially the entire runtime. It is now a session-scoped fixture
   with the per-test `get_db` override applied and removed around each test.
2. **Argon2id runs at a reduced work factor in-process.** Production is `time_cost=3`,
   `memory_cost=64 MiB` (~96ms/hash); the suite mints a real hash for every user fixture. The
   test process runs `time_cost=1`, `memory_cost=1 MiB` (~1.3ms) — same algorithm, same
   `hash_password`/`verify_password` code path, same `$argon2id$` hash in the database, only
   the work factor differs.

> **The measurement corrected a wrong belief.** The progress tracker attributed the 18 minutes
> to Argon2. Measured: Argon2 was ~96ms/hash (real, but minor), the database ~1ms per test,
> and app construction ~1.3s per test. Had the Argon2 assumption been acted on alone, the
> suite would still be ~15 minutes. Profile before optimising: `--durations=10` shows
> **setup** time separately from **call** time, which is what exposed this.

Run at production hashing cost when you want to verify the parameters themselves:

```powershell
$env:SIS_TEST_FULL_ARGON2="1"; .\.venv\Scripts\python.exe -m pytest tests/test_auth.py -q
```

`test_qa_foundation.py` pins the production Argon2 numbers from a `Settings` built with the
environment excluded, so the test-lane reduction cannot quietly become the shipped
configuration — the failure mode that would otherwise pass every test while making every
stored password cheap to crack.

`addopts = ["--strict-markers", "--strict-config"]` is set in `pyproject.toml`: a typo'd
marker and a stale config key both fail loudly. That was added because the reverse happened —
`asyncio_mode = "auto"` sat in the config warning on every run, for a `pytest-asyncio` that
was never installed and zero async tests.

---

## 3. Current coverage

Suite: **970 tests, all passing in ~69s** (full run, 2026-07-29). Per module (collected
counts, so parametrized cases are included):

| File | Tests | Level | Notes |
|---|---:|---|---|
| `test_students.py` | 108 | L1 | Status-transition matrix, soft-delete guards, teacher auto-scoping |
| `test_announcements.py` | 107 | L1 | The ratified visibility model, incl. admins not seeing teacher notices |
| `test_grades.py` | 85 | L1 | Gradebook union rows, all-or-nothing writes, release semantics |
| `test_settings.py` | 75 | L1 | Academic structure, grading scale freeze, users admin |
| `test_grade_calc.py` | 65 | **L0** | The grade engine + school clock. **DB-free** |
| `test_reports.py` | 65 | L1 | Report card, transcript union, per-offering release rule |
| `test_dashboard.py` | 64 | L1 | Four role variants; the two mock scope leaks NOT copied |
| `test_attendance.py` | 62 | L1 | Teacher-only recording, `pct_present` counting LATE as present |
| `test_events.py` | 56 | L1 | Two authz axes (manage vs see), `HH:mm` serialization |
| `test_assessments.py` | 53 | L1 | Status lifecycle, ownership, release toggles |
| `test_auth.py` | 40 | L1 | Lockout, rotation replay, idle timeout, enumeration safety |
| `test_teachers.py` | 39 | L1 | Directory, `create_login` temp password |
| `test_hardening.py` | 39 | L0/L1 | Rate limiter, proxy-header spoofing, security headers, purge job |
| `test_classes.py` | 34 | L1 | Sections, offerings, transfer-aware enrollment |
| `test_subjects.py` | 24 | L1 | CRUD + `subject_in_use` guard |
| `test_archive_freeze.py` | 17 | L1 | Snapshot freeze, incl. the ordering rule |
| `test_year_scoping.py` | 29 | L1 | Cross-module academic-year partitioning, per role (this phase) |
| `test_qa_foundation.py` | 7 | **L0** | Harness guards (this phase) |
| `test_health.py` | 1 | L1 | Liveness wiring |

**Endpoint coverage: 94/94 of the endpoints the finished frontend calls are served**, verified
mechanically by normalising every path the frontend's `features/*/api/*.ts`, hooks and MSW
handlers call and diffing against the served OpenAPI.

### What the density is spent on

Test count is not the point; these are the classes of case that carry the weight:

- **Per-role, per-endpoint authorization** — principal / secretary / teacher / student, with
  ownership scoping for teachers, and 404-not-403 for non-existence.
- **All-or-nothing batch writes** — grade and attendance batches validate every entry and
  collect every offender before mutating anything, so one bad row in forty leaves the
  gradebook untouched. Asserted, not assumed.
- **Archived-year immutability** — `409 year_archived` on academic writes, plus the
  end-to-end freeze guarantee: after archival, collapsing every grading band to floor 0 does
  **not** relabel a frozen "C" as an "A", and editing the underlying score does not move the
  frozen figure.
- **Internal reconciliation** — a student's term average equals the teacher's gradebook figure
  for the same data (`test_term_average_reconciles_with_the_teachers_gradebook`). The three
  surfaces that show a grade cannot silently disagree.
- **Release/visibility leaks** — the highest-value tests in the suite: unreleased grades never
  reach a student, draft assessments never appear in a student's upcoming list.
- **School-local dates** — anything a human calls "today" resolves in `America/Belize`, pinned
  against a fixed instant so the tests cannot pass-or-fail depending on the hour they run.
- **Academic-year partitioning** (`test_year_scoping.py`) — two years holding real data for
  the *same* teacher and student, asserted in both directions per endpoint per role. The
  target failure mode is that **FastAPI silently ignores an undeclared query parameter**, so
  a year picker can send `academic_year_id`, be ignored, and show unchanged rows with no
  error anywhere. Asserting only "an unrelated year returns `[]`" does not catch that.

---

## 4. Traceability — acceptance criteria to tests

`docs/requirements.md` §5 defines eight core flows. Automated coverage of each:

| AC | Flow | Automated coverage | Manual (§5) |
|---|---|---|---|
| 5.1 | Authentication / login | `test_auth.py` (40) — lockout, refresh rotation replay, idle timeout, enumeration safety | UAT-1 |
| 5.2 | Recording attendance | `test_attendance.py` (62) — teacher-only `PUT`, future-date guard, all-or-nothing | UAT-4 |
| 5.3 | Creating an assessment | `test_assessments.py` (53) — lifecycle, ownership, category mismatch | UAT-3 |
| 5.4 | Entering grades | `test_grades.py` (85) + `test_grade_calc.py` (65) | UAT-3 |
| 5.5 | Viewing a report card | `test_reports.py` (65) — incl. the **per-offering** release rule | UAT-5, UAT-6 |
| 5.6 | Posting an announcement | `test_announcements.py` (107) — the full ratified visibility model | UAT-7 |
| 5.7 | Enrolling a student | `test_students.py` (94) + `test_classes.py` (34) | UAT-2 |
| 5.8 | Multi-year transcript | `test_reports.py` transcript union + `test_archive_freeze.py` (17) | UAT-6 |

**All eight flows have backend coverage. None has automated frontend or end-to-end coverage** —
every one is exercised through the API, not through the UI a user actually touches. That is
what §5 is for, and why it is a required gate rather than a nicety.

### Two behaviours where the backend deliberately differs from the demo

Both are tested as *intended* behaviour. Neither is a bug; do not "fix" either without a
stakeholder decision.

1. **Grade math.** The backend implements the documented two-level category rollup (grades →
   category %, categories → by `category.weight`, drop-lowest within each category). The
   demo's `selectors.ts::computeTermGrade` does a flat mean and ignores category weights and
   drop-lowest entirely. Where demo data has weighted categories, **real-API numbers differ
   from `npm run demo` numbers.** Internal consistency is preserved and asserted.
2. **Announcements have no admin override.** Following the ratified "principals should not see
   teachers' announcements" rule, only the authoring teacher can withdraw their own post.
   `test_archived_year_does_NOT_block_creation` and the `_assert_can_modify` tests pin this so
   nobody quietly re-adds a moderator power.

---

## 5. Manual UAT scripts

**These are a required Phase 8 gate.** With no automated frontend or E2E tests, this is the
only coverage the actual user interface has.

Setup: `RUNBOOK.md` §2 (two terminals — backend on `:8000`, `npm run dev` on `:5173`). Confirm
you are on live data, not mocks: live requests appear in the **uvicorn log**. If the UI shows
data while uvicorn logs nothing, MSW is intercepting and you are testing the demo.

Each seeded login has its OWN generated password, listed in
`backend/db/mariadb/generated/demo-credentials.txt` (written by the seed run, untracked).
The login field takes an **email address**.

**Every seeded account starts with `must_change_password = true` and the server enforces
it** (D31 Phase 5): the first thing each role must do is set a new password, and until then
the API answers 403 `password_change_required` on everything except `GET /auth/me`,
`PATCH /auth/me/password` and `POST /auth/logout`. Treat that forced change as step 0 of
every role's script rather than a defect — and note it is now itself worth testing: a
flagged account must be redirected, not shown a dashboard full of errors.

Record for each step: pass / fail / observation. A failed step gets an entry in the defect log
(§7) before the run continues.

### UAT-1 — Authentication (all roles) · AC 5.1
1. Log in as principal (`principal@belmopancomp.edu.bz`). Land on the dashboard.
2. **Hard-reload the page.** You must stay logged in. _(This is the silent-refresh path: an
   absolute `VITE_API_BASE_URL` makes the `SameSite=Lax` cookie cross-site and it is dropped,
   which presents as a random logout.)_
3. Log out. Confirm you cannot reach a protected route with the back button.
4. Log in with a wrong password 5 times → expect a **423** with a retry countdown, not a
   generic error. _(Then clear `users.failed_login_count` + `locked_until`, or wait.)_
5. Repeat 1–3 as secretary, teacher (`alicia.cano@…`), student (`s-25001@student.…`).
6. For each role, confirm the navigation shows **only** that role's permitted items.

### UAT-2 — Student records and enrollment (secretary) · AC 5.7
1. Create a student. Confirm required-field validation fires **inline on the right field**.
2. Enroll them into a section in the same step. Confirm they appear on that section's roster.
3. Edit the student; confirm the change persists across a reload.
4. Change status through a legal transition, then attempt an illegal terminal→terminal one —
   expect a clear refusal, not a stack trace.
5. Attempt to delete a student who has academic history — expect a **refusal explaining why**.

### UAT-3 — Assessment and gradebook (teacher) · AC 5.3, 5.4
1. As `alicia.cano@…`, create an assessment on a section you teach. Confirm it starts as a
   **draft**.
2. Confirm a section you do **not** teach is not reachable — by picker and by URL.
3. Publish it, open the gradebook, enter marks for the whole class, save.
4. **Enter one score above `max_score` and save the batch.** Expect the whole save to be
   rejected, the offending row identified, and **no other row silently saved**.
5. Fix it, save, confirm the term average updates.
6. Release the column. Log in as a student in that section and confirm the grade is now
   visible — and that an **unreleased** assessment's grade is not.
7. Back as the teacher: confirm the letter grade shown matches the school's grading bands,
   including a score landing exactly on a band boundary (e.g. exactly 80).

### UAT-4 — Attendance register (teacher) · AC 5.2
1. Open the register for a section you teach; take it for **today**. Confirm unmarked rows
   default to present and that `null` ≠ an attendance value.
2. Save, reload, confirm it persisted with "last recorded by" naming you.
3. Attempt a **future** date → expect a refusal.
4. Mark some late, some absent; confirm the summary percentage counts **late as present**.
5. Log in as principal: confirm you can **read** the register and the summary but **cannot**
   save one. _(Recording is teacher-only — the opposite of most modules.)_
6. **Do step 1 after 18:00 local.** Belize is UTC-6, so a naive server would have already
   rolled over to tomorrow; confirm the register still offers the correct school day.

### UAT-5 — Report card (principal, teacher, student) · AC 5.5
1. As principal, open a student's report card for the active semester. Confirm the school
   name/address/logo area, the student identity block, and per-subject rows all render.
2. Print it (or print-preview). Confirm the print layout is not a screenshot of the app — no
   navigation, no clipped table.
3. Confirm a subject with **any** unreleased graded assessment shows as **pending** with no
   number on the **student's own** card, while staff see the computed value.
4. Confirm the headline term average visually reconciles with the rows printed beneath it.

### UAT-6 — Transcript and archived years · AC 5.8
1. As principal, open a multi-year transcript. Confirm newest year first and that term → year
   → cumulative averages roll up.
2. As a **teacher**, attempt the transcript → expect refusal (transcripts are
   principal/secretary only).
3. For an archived year, confirm figures are marked frozen and do **not** move when underlying
   data changes.

### UAT-7 — Announcements · AC 5.6
1. As principal, post school-wide. Confirm it appears for a teacher and a student, and that
   the bell's unread count increments and clears on read.
2. As teacher, post to a class you teach. Confirm the students in that class see it.
3. As principal, confirm you **cannot see** the teacher's post. _(Ratified rule — expected,
   not a defect. Note the operational consequence: no admin can withdraw it.)_
4. As secretary, confirm you see the principal's posts and vice versa.
5. Schedule one for a future `published_at`; confirm it does not leak early.

### UAT-8 — Calendar, settings and the seams
1. As principal, create / edit / delete a calendar event. Confirm an `internal` event is
   invisible to a student.
2. As principal, switch the school's **active semester** in Settings → Academic structure;
   confirm dependent screens (dashboard, the "current term" labels) follow it. Note this is
   the *administrative* active term, not the student's view selection — the two are separate
   (`activeSemesterId` vs `selectedSemesterId` in `YearContext`) and must not be conflated:
   assessment **writes** use the active term, **reads** use the student's selection.
3. Open Settings → grading scale; confirm bands are contiguous and a frozen scale refuses
   edits.
4. Confirm the school-logo upload control renders **disabled with an explanation** — it is
   deliberately stubbed, not broken.
5. **Period switchers, end to end — the part no automated test covers.** API-level
   partitioning is pinned by `test_year_scoping.py` (56 tests: year **and** semester, both
   directions), but nothing verifies the switchers as a *user* drives them. Confirm all of:
   - As a **student**, the top-bar switcher lists every **year·semester pair** you were
     enrolled in — grouped by year, newest first, the current term marked. Changing it
     re-scopes **My Assessments**, **My Grades**, **My Classes**, **My Attendance** and
     **My Profile** (the numbers and the section must actually change, not just the label).
   - **My Assessments specifically** (the reported defect): changing the year must change
     the **subject dropdown**, not only the table — the dropdown used to stay pinned to the
     current year's subjects. Then within one year, switch Semester 1 ↔ Semester 2 and
     confirm the assessment list differs. In demo, Semester 2 of 2025-2026 holds
     *Quiz 3* + *Midterm Exam* and Semester 1 holds *Quiz 1 / Quiz 2 / Unit Test 1 /
     Project*, so a leak between semesters is visible by title.
   - **My Classes for an archived year must NOT show an empty subject table** — past-year
     offerings are all `is_active: false`, and filtering on that flag used to empty it.
   - **My Profile** for a past year shows that year's grade level / section / homeroom.
   - The selected period **survives a page reload** (`sessionStorage`), the way staff's
     `?year=` does.
   - As **staff**, each module's year filter (Students, Teachers, Classes, Assessments,
     Grades, Attendance register + summary) persists to `?year=` and **survives a reload**.
   - 🔴 **As a TEACHER, confirm the year dropdown is POPULATED** on Grades, Attendance and
     Classes, and that DevTools shows `academic_year_id` on the list request and **no 403**
     from `GET /settings/academic-years`. That endpoint was principal/secretary-only, so a
     teacher's picker silently emptied and sent nothing — **and the MSW mock had no role
     gate, so this was invisible in demo mode. Check it against the real backend.**
   - On the **report card**, the term picker labels each option with its year
     (`Semester 1 · 2024-2025`), newest year first. Pick an **archived** year and confirm the
     card prints that year's figures marked frozen — this is where picking the wrong
     identically-named "Semester 1" used to be possible.
   - Switch to a year in which the student has **no** enrollment (staff view) and confirm an
     empty state, **not** another year's data silently relabelled.
6. **Announcements filters (student).** The Audience dropdown must offer only what a student
   can receive — *School-wide*, *All students*, *My class* — and **not** "Teachers", which
   could never match and rendered as a misleading "no announcements" empty state. The
   All / Unread toggle must change the list; opening a card clears its unread dot and
   decrements the bell badge. Announcements are **not** period-scoped by design (no year or
   semester column exists), so the top-bar switcher must leave this screen unchanged — that
   is correct behaviour, not a bug.
7. Resize to a tablet and a phone width. Confirm tables become cards and nothing scrolls the
   page body horizontally.

---

## 6. Gaps — what is NOT tested

Stated plainly. Each is a real risk, ordered by how much it should worry you.

### 6.1 There is no test database (highest structural risk)
The suite runs against **live `sims`**. Isolation is per-test transaction rollback, so nothing
commits — but "nothing commits" is a property of the harness, not a guarantee of the
environment. A test that bypasses the fixture, or a fixture bug, writes to the same database
that holds the demo data. There is no separate test schema and no throwaway instance.

Blocked by the same thing as §6.2: there is no reproducible way to create a database.

### 6.2 A fresh environment cannot be provisioned reproducibly
`alembic upgrade head` **cannot run** — the single revision is PostgreSQL-only (native enums,
`pgcrypto`, RLS, `CREATE INDEX CONCURRENTLY`) and the backend now targets MariaDB.
Provisioning is a documented **manual** sequence of four SQL files plus a seed script
(`RUNBOOK.md` §4). Consequences: the schema is not version-controlled in an executable form,
no CI can stand up a database, and disaster recovery depends on a human following a checklist
in the right order.

### 6.2a Demo constants were reaching production screens (fixed, and untested)
Five real screens imported constants from the demo dataset. Fixed 2026-07-29, but **no
automated test prevents it recurring**, and the class of bug is invisible in `npm run demo`
— which is the only way the frontend gets exercised today:

- `AttendanceRegisterScreen` / `AttendanceToolbar` used `DEMO_TODAY` ('2025-10-15') as
  "today" **and as the date picker's `max`**, so against a real backend the register opened
  months in the past and the current day could not be selected at all. Now `schoolToday()`
  (`America/Belize`, matching the backend's `school_today()`).
- `StudentFormDialog` defaulted a new student's enrollment date to the same fixed date.
- `AssessmentsListScreen` / `SubjectGradesScreen` sent `DEMO_IDS.activeSemesterId` as
  `semester_id` when creating an assessment — a hardcoded id no real database contains, so
  **authoring an assessment could not work against the live API**. Now read from
  `YearContext` (which already holds `GET /settings/active-term`), with an explicit message
  when no active semester is set.

A lint rule forbidding `@shared/api/mocks/**` imports outside the mocks tree would prevent
recurrence mechanically. Not added — flagged as a recommendation.

### 6.3 No automated frontend tests at all
No Vitest, no Playwright, no `*.test.*` files, no testing dependencies in `package.json`. The
only frontend verification is `npm run typecheck`, `npm run lint`, and the manual scripts in
§5. Every user-facing flow — the gradebook grid, the register, the print layout, the role-based
navigation — is verified by a human or not at all.

Recommended first targets, if this gets funded (highest value per unit of effort):
- `selectors.ts::letterFor` — has a **known bug**: a strict `min <= v <= max` lookup against
  `.99` band ceilings leaves unreachable holes, so `179.99/200 = 89.995` matched no band and
  rendered "Graded" instead of "B". The backend was fixed to a half-open lookup on `min_score`;
  the frontend selector was not. Demo-only today, so cosmetic — and exactly the kind of pure
  function a unit test pins in minutes.
- `apiErrorMessage` — the single funnel every error the user reads passes through.
- The permission matrix — a table-driven test over role → allowed navigation.

### 6.4 No CI
Nothing runs on commit. The suite is green because someone remembered to run it. There is no
Dockerfile and no pipeline, so there is also nowhere for CI to run a database (§6.2).

### 6.5 No performance or load testing
`docs/requirements.md` states performance NFRs (FR-PERF-*). None is verified. Known-unmeasured
hot spots, from reading rather than profiling:
- the principal dashboard's `grade_distribution` — bounded to **three** queries plus in-memory
  computation by design, but never measured against a full school;
- `_build_report_card` re-runs `_subject_results` per student during the annual archive freeze,
  roughly doubling that computation (accepted: once a year, one school);
- the rate limiter is **in-process** — with `--workers 4` each worker keeps its own counters,
  so the effective limit is ~4× configured, and it does not hold across hosts at all.

### 6.6 Untested operational paths
- **The purge job has tests but no schedule.** `python -m app.jobs.purge` is covered including
  dry-run accounting; nothing runs it on a timer, so `login_attempts` and `audit_log` grow
  unbounded in practice.
- **No backup or restore has ever been exercised.** There is no backup.
- **The reverse-proxy posture is tested in code but not in deployment.** `test_hardening.py`
  proves the app ignores untrusted `X-Forwarded-For`, but the actual protection depends on
  launching uvicorn with `--forwarded-allow-ips=""` (RUNBOOK §9). Nothing verifies the real
  launch command; get this wrong and an attacker rotating the header gets a fresh rate-limit
  bucket per request and writes any IP they like into the audit log.
- ~~**MSW ships in the production bundle.**~~ **Fixed 2026-07-29** — the mock runtime,
  handlers, demo dataset and `mockServiceWorker.js` are all excluded from a `npm run build`
  bundle (verified by grepping `dist/`). Still untested by any automated check: the
  verification was manual, so a regression would not be caught. A `grep dist/ for 'Belmopan'`
  assertion in CI would close that — see §6.4.

### 6.7 Stale artefacts that make verification harder
- `backend/openapi.json` predates `/api/v1/ready`; it is a hand-maintained snapshot with no
  regeneration script.
- `frontend/openapi.json` covers 4 of 14 modules — **do not run `npm run generate:api`** until
  it is refreshed.
- `docs/database-schema.md`, `architecture.md` and parts of `api-specification.md` still
  describe PostgreSQL. MariaDB is authoritative. (Step 5.)
- `backend/.env.example` still advertises a `postgresql+psycopg://` URL that cannot connect.

### 6.8 Accepted minor items
- `assessment_grades.chk_score_limit CHECK (score <= max_score)` references a vestigial
  nullable `max_score`, so it always passes (`x <= NULL` → NULL). Harmless today, a landmine if
  anything ever populates that column. One-line drop when convenient.
- Multi-subject assessment sort order, and `current_section` resolving null when no semester is
  active, are both low-risk and unverified.

---

## 7. Defect log protocol

For anything the manual runs surface:

1. **Reproduce it against the live API**, not the demo. Grade-number differences between
   `npm run demo` and the real backend are expected (§4) and are not defects.
2. Record: role, exact steps, expected, actual, and whether the uvicorn log shows the request.
3. Classify:
   - **Blocker** — data loss, a wrong grade, or one role seeing another's data. Fix before
     anything else.
   - **Major** — a documented flow cannot be completed.
   - **Minor** — cosmetic, or a workaround exists.
4. A fix lands **with a regression test at the lowest level that can hold it** — L0 if the
   logic is pure, L1 otherwise. A fix without a test is not a fix; it is the same bug with a
   shorter memory.
5. Re-run the affected module file, then the full suite before calling the phase done.

---

## 8. Phase 8 exit criteria

Phase 8 is complete when **all** of the following hold:

- [x] **8.1** This plan exists and reflects reality, gaps included.
- [x] **8.2** The full suite passes: **970 tests green in ~69s** (2026-07-29). One stale
      assertion was found and fixed in the process — `test_students.py`'s student-assessment
      key set predated the release-nudge feature's `last_nudged_at` field, so the suite had a
      standing failure. The **app** was correct (the frontend contract requires that field);
      the test was not.
- [x] **8.3** The suite is fast enough to actually be run — **~56 seconds**, down from ~18
      minutes — with both speedups guarded by `test_qa_foundation.py` so they cannot silently
      regress.
- [ ] **8.4** All eight UAT scripts (§5) executed against the live API, results recorded.
- [ ] **8.5** Every blocker and major defect found in 8.4 is fixed **with a regression test**,
      and the full suite is re-run green.
- [ ] **8.6** `needs-attention.md` authored (Step 5 — still a stub).
- [ ] **8.7** Doc reconciliation: the Postgres→MariaDB drift in §6.7 resolved (Step 5).
- [ ] **8.8** A **decision recorded** on each item below. These are the gaps that cannot be
      closed by testing harder, only by someone choosing to spend on them:
      - a real test database (§6.1) and executable MariaDB migrations (§6.2);
      - automated frontend tests (§6.3) — the three targets named there;
      - CI (§6.4);
      - a scheduled purge job and a backup/restore procedure that has actually been run (§6.6).

**8.4 is the gate that matters.** Backend coverage is genuinely dense, but a school does not
use the API — it uses the screens, and the screens have no automated coverage at all.

_Deferring an item on the 8.8 list is a legitimate decision for a single-school deployment.
Not deciding is not._

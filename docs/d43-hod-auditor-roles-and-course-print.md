# D43 — Auditor & HOD roles + Course print/PDF

## Context

Two things the client needs, in one increment.

**Two new roles.** Today `users.role` is a closed 4-value enum (`principal`/`secretary`/`teacher`/`student`, displayed as Dean/Registrar/Lecturer/Student). Two gaps:

- **Auditor** — needs the Dean's *reach* with none of the Dean's *authority*. Sees everything, changes nothing. There is currently no read-only concept anywhere on the backend: `require_role` is a role allowlist and cannot express "GET only", and no middleware inspects the HTTP method for authorization.
- **HOD (Head of Department)** — a lecturer who also supervises a programme. The research is consistent across institutions ([Purdue](https://www.purdue.edu/academics/faculty-affairs/department-heads/roles.html), [Stony Brook](https://www.stonybrook.edu/commcms/provost/faculty/handbook/academic_policies/chair), [WashU](https://research.washu.edu/about/roles-responsibilities/department-head-chair/), [Lafayette](https://provost.lafayette.edu/appointment-and-responsibilities-of-department-heads-program-chairs-and-conveners/)): the department head is an academic leader with oversight of the curriculum, the faculty, and the students in their unit — and, critically, **keeps teaching**. In SIS terms that maps to departmental *visibility* plus normal lecturer powers on their own courses. Note `teacher_profiles.designation` already literally holds the string `"Head of Department"` in the seed data — decorative today, read by nothing.

**Print/PDF for courses.** The catalog and the offerings schedule are both list screens people want on paper, and neither has a print button. The repo's v1 export stance is settled (`docs/architecture.md` Q8): browser `window.print()` → Save as PDF, no server-side PDF. `PrintLayout` + `StudentListPrintDialog` already implement exactly this for a filtered list.

**Outcome:** six roles; an auditor who physically cannot write; an HOD scoped to the programme(s) they head; and a Print button on both course screens that prints what the filters actually selected.

---

## Decisions taken

| Question | Decision |
|---|---|
| What does an HOD head? | A **programme** (`programs`). No new departments taxonomy. |
| Cardinality | **Many-to-many** — new `program_heads` join table. |
| HOD and grades | **Keeps full lecturer powers on offerings they are assigned to**; read-only everywhere else in the programme. Existing ownership checks already enforce this. |
| Auditor writes | **Blocked server-side (403) and hidden in the UI.** |
| Auditor reach | Everything except account-security internals (password hashes, reset tokens, login attempts). Includes a new read-only **Audit Log** screen and all reports. |
| HOD reports | Report cards / gradebooks for students in their programme. No transcripts. |
| HOD assignment | Dean, from the **Programme page**. |
| Print button | **Both** the course catalog and the offerings list. |

---

## The scoping model

There is no `departments` table and lecturers have no programme link at all — that edge is the main new modelling work. Students already carry `program_id`; courses reach a programme only through the many-to-many `program_courses`.

```
teacher_profiles ──< program_heads >── programs
                                          │
   students.program_id ───────────────────┤   → HOD's students
   program_courses ───────────────────────┤   → HOD's courses
            │
        courses ──< course_offerings ──< class_teachers → HOD's lecturers + offerings
```

Everything an HOD sees derives from `program_heads`, resolved from the authenticated principal — never from the request. This matches the rule in `docs/architecture.md` §3.2.

⚠️ A course can sit in several programmes (9 of 114 do), so a shared GEC course legitimately appears for more than one HOD. That is correct, not a bug.

---

## Phase 1 — Print/PDF for courses *(independent of the roles work; ship first)*

Copy the established pattern verbatim. Reference implementation: `frontend/src/features/students/components/StudentListPrintDialog.tsx` + `useStudentsForPrint` in `frontend/src/features/students/hooks/useStudents.ts`. Its docstring already argues the design: a `@media print` rule over a paginated table silently prints one page of the answer, so the dialog **re-fetches the same filters at a raised page size** and renders its own table.

- [x] `frontend/src/features/settings/components/CourseListPrintDialog.tsx` — new. Columns: Code, Course, Credits, Component, Status.
- [x] `useCoursesForPrint(params, enabled)` in `frontend/src/features/settings/hooks/useCourses.ts` — `{...params, page: 1, page_size: 200}` (`MAX_PAGE_SIZE` in `backend/app/core/pagination.py`; 114 courses today, so one fetch is the whole catalog), `enabled` gated on the dialog being open.
- [x] `frontend/src/features/offerings/components/OfferingListPrintDialog.tsx` — new. Columns: Course, Semester, Section, Lecturer(s), Enrolled/Capacity. Same hook shape in `frontend/src/features/offerings/hooks/useOfferings.ts`.
- [x] Print buttons into `PageHeader.secondaryActions` on `frontend/src/features/settings/CoursesPage.tsx` and `frontend/src/features/offerings/OfferingsListPage.tsx`, matching `StudentsListPage.tsx:387`.
- [x] `filterSummary: string[]` on both pages — **the active filters are printed on the sheet**. A page of course codes with no heading saying what selected them cannot be checked by the person holding it.
- [x] Keep the truncation warning (`Showing the first N of M. Narrow the filters to print the rest.`) — the offerings list can exceed 200.
- [x] Pass `contactLines={[address, contact_phone, contact_email]}` from `useSchoolProfile()` so both sheets carry the letterhead. (The students dialog omits this; the report card sets the precedent.)
- [x] Date the sheet with `formatSchoolDate(new Date())` — dd/mm/yyyy, America/Belize.

Reuse `PrintLayout` (`frontend/src/shared/components/PrintLayout.tsx`) unchanged. No new dependency — there is no PDF library in this repo and none is being added.

**Defect found by the probe (fixed).** `paginate()` in `mocks/demo/selectors.ts` clamped
`page_size` to **100** while the server's `MAX_PAGE_SIZE` is **200**. The catalog print
sheet therefore returned 100 of 114 courses in the demo — a full sheet on the real API,
silently short in the demo, under a heading saying "Course catalog". Both the clamp and
the stale "the server caps page_size at 100" comment in `StudentListPrintDialog` are
corrected. `tsc` and `eslint` were clean throughout; only executing the handlers found it.

Verified by `frontend/scratchpad/probe_d43_print.mjs` — ALL PASS.

---

## Phase 2 — Backend role plumbing

- [x] `backend/app/common/enums.py` — add `HOD = "hod"` and `AUDITOR = "auditor"` to `Role`.
- [x] `backend/db/mariadb/016_hod_auditor_roles.sql` — new, hand-run in numeric order via `apply_sql.py` (**Alembic does not work in this repo**; its one revision is Postgres-only):
  - `ALTER TABLE users MODIFY COLUMN role enum('principal','secretary','teacher','student','hod','auditor') NOT NULL` — nothing in `001`–`015` has ever touched this enum.
  - `CREATE TABLE IF NOT EXISTS program_heads` — `id` uuid PK, `program_id` FK→`programs` CASCADE, `teacher_id` FK→`teacher_profiles` CASCADE, `appointed_at`, audit columns, `UNIQUE (program_id, teacher_id)`. Mirror the shape and comment style of `class_teachers` (`005_tertiary.sql`).
- [x] `backend/app/modules/programs/models.py` — `ProgramHead` model. **Also register it in `backend/app/db/models.py`** — that aggregator is already missing ~10 models; do not add an eleventh.

### The auditor write-block

`get_current_user` in `backend/app/core/deps.py:89` already takes `Request` and already does a method+path check (`_is_forced_change_exempt`, line 66). Every authenticated route passes through it; `/auth/login` and `/auth/refresh` do not. That makes it the single choke point — **~6 lines instead of auditing 121 `Depends(...)` declarations**, with no way to miss one.

- [x] Add `READ_ONLY_ROLES = frozenset({Role.AUDITOR})`, a write-method set, and a small exempt allowlist (`POST /auth/logout`, `PATCH /auth/me/password`, and the preferences write) modelled directly on `_FORCED_CHANGE_EXEMPT`.
- [x] Raise `Forbidden("This account has read-only access.", code="read_only_role")` just after the `must_change_password` check.

Belt and braces: the UI also hides edit controls (Phase 5), but the server is the boundary.

**Verified.** `016` applied to a scratch DB (`sims_d43`, a full `mysqldump` copy of `sims`
— the live DB is never the target, since the services commit internally and a rollback
wrapper protects nothing). All 20 users survived the enum widening with `HEX(role)`
confirming no case drift. Full suite **1784 passed** against the scratch DB.

`tests/test_d43_auditor_readonly.py` — 9 passed. It walks the **live FastAPI route table**
rather than a hand-written list, so a mutating route added later is covered the day it is
written. Confirmed non-vacuous by mutation: emptying `READ_ONLY_ROLES` makes it fail.

---

## Phase 3 — Backend read access and HOD scoping

`require_role` is an allowlist, so both new roles are 403 everywhere until named. Add them to the **read** gates listed in the router headers — `students/router.py:57`, `teachers/router.py:45`, `offerings/router.py:65`, `attendance/router.py:47`, `reports/router.py:50`, `assessments/router.py:50`, `admissions/router.py:104`, `settings/router.py:82`. In `grades/router.py:84`, `_staff` currently covers both reads and the revision POST — **split it** so the new roles land on reads only.

Add `Role.HOD` to the lecturer *write* gates (`_teacher` in `grades/router.py:85`, `assessments/router.py:47`, `attendance/router.py:48`). This is safe and is what delivers the "teaches own courses" decision: `assert_teacher_owns_offering` (`backend/app/core/rbac.py:54`) resolves the profile from the principal and passes only for offerings the HOD actually holds a `class_teachers` row on. It does **not** check role, so the role tuple is the only thing gating it — which is exactly the lever we want.

### New scope helpers — `backend/app/core/rbac.py`

Alongside the existing `_teacher_profile_id` / `teacher_offering_ids`:

- [x] `hod_program_ids(db, user)` — programmes this user heads, via `program_heads`.
- [x] `hod_course_ids` / `hod_offering_ids` / `hod_teacher_ids` — derived through `program_courses` → `courses` → `course_offerings` → `class_teachers`, as correlated `EXISTS` subqueries in the style of `_apply_teacher_ownership` (`students/service.py:726`).

### ⚠️ The `elif` fallthroughs — the real risk in this phase

Several services branch `if TEACHER … elif STUDENT …`, so a new role silently inherits whatever the `else` does. Each must get an explicit branch:

| Site | Today's fallthrough | Required |
|---|---|---|
| `offerings/service.py:660` list | new role sees **everything** | fine for auditor; HOD must narrow to programme |
| `offerings/service.py:713` `_assert_caller_can_read` | falls to the student branch → **404** | explicit auditor/HOD branches (asymmetric with the list today) |
| `offerings/service.py:315` `_owned_offering_ids` | returns `set()` → `actionable_by_caller=false` | correct for auditor; HOD needs their own offerings actionable |
| `grades/service.py:394` `is_teacher` | HOD gets `can_edit=false` everywhere | `role in (TEACHER, HOD)`, ownership still narrows |
| `grades/service.py:233` `_assert_readable` | — | add both roles as read-only viewers |
| `students/service.py:566` | unscoped | HOD filtered on `StudentProfile.program_id` (the `program_id` filter at line 555 already exists) |
| `dashboard/service.py:1078` | unknown role → **`_admin_payload`**, i.e. school-wide | explicit branches + new `Literal` variants in `dashboard/schemas.py` |
| `auth/service.py:96` `build_current_user` | `elif role == TEACHER` | HOD must resolve a `teacher_profile_id` |
| `teachers/service.py:427` | hardcodes `role=Role.TEACHER` on login provisioning | allow provisioning an HOD |
| `settings/service.py:82` `_PRIVILEGED_ROLES` | — | add both, so only a Dean may create or edit one |

`GET /courses` and `GET /programs` are already `get_current_user`-only, so both roles read the catalog with no change.

**Verified.** Full suite **1815 passed**. `tests/test_d43_hod_scoping.py` — 22 passed,
built on a **two-programme** fixture, because a single-programme one passes every scoping
assertion with the filter deleted. Mutation-checked: neutering the students and offerings
programme filters fails 3 tests, including the one asserting an HOD with no appointment
does not become a Dean.

Two behaviours worth recording because they were decisions, not defaults:

* **`PUT /programs/{id}/heads` promotes and demotes** (revised 2026-09-02 at the client's
  request — it originally did not, and the two-step version left the Dean having done
  something with no visible effect). Appointing sets the account to `hod`; removing the
  last appointment returns it to `teacher`. Three server-side rules keep it safe: only a
  plain `teacher` is promoted (a Dean who also teaches is never touched), only an `hod` is
  demoted, and **a head who still runs another programme is not demoted** — that last one
  is mutation-checked, because getting it wrong revokes access to a department the person
  still runs and nothing on screen would say so. Every change writes a `user.role_change`
  audit row, the same action the Settings screen uses.
* **The dashboard no longer falls back to the Dean's payload.** `get_dashboard` ended in a
  bare `return _admin_payload(...)`, so ANY future role would have been handed the most
  privileged view in the app by omission. It now dispatches explicitly and raises for an
  unmatched role.

---

## Phase 4 — New endpoints

- [x] `GET /programs/{id}/heads` (any authenticated) and `PUT /programs/{id}/heads` (`require_role(PRINCIPAL)`) — set the programme's heads as a list. `programs/router.py` already has `_dean_only`.
- [x] ~~`GET /settings/audit-log`~~ — **SUPERSEDED AND DELETED, 10 Sep 2026.** It was paginated, read-only, Dean + Auditor, and it was the right call at the time: the `audit_log` table had been appended to since day one with no endpoint and no UI. D45 Phase 7 then built `GET /audit`, which reads the same rows and renders them into sentences with the module, the IP and a before/after — so there were two doors onto one table, and D45 Phase 1 had widened THIS one to include the System Administrator, whom Phase 7 deliberately refused on the other. The client asked which screen was which; the answer was "same table, and the older one is wider". Deleted, and it now answers 404. See `docs/d45-meeting4-yellow-plan.md` §4b.
- [x] Regenerate `backend/openapi.json` (it has gone stale before) and mirror to `frontend/openapi.json`.

---

## Phase 5 — Frontend role plumbing

`npm run generate:api` is **forbidden** in this repo, so `frontend/src/shared/api/generated/model/role.ts` is hand-edited with the existing warning-comment convention.

Six `Record<Role, …>` maps are exhaustive by design — `tsc` fails until every one names both new roles. That is the safety net; let it work.

- [x] `shared/auth/permissions.ts` — `PERMISSION_MATRIX`
- [x] `shared/auth/roleLabels.ts` — `ROLE_LABEL` + `ROLE_OPTIONS`
- [x] `shared/components/RoleChip.tsx` — `ROLE_COLOR`
- [x] `features/announcements/presentation.ts` — `RECEIVABLE_AUDIENCES`
- [x] `shared/api/mocks/fixtures.ts` — `names`
- [x] `shared/types/enums.ts:106` — `ROLES`; `i18n/strings.ts:81` — labels `Auditor`, `Head of Department`

**Matrix rows.** `Capability` has no "view-all-within-my-programme" level and should not grow one — the file's own header says the map is UX-only and the server re-checks every call. So give HOD `view-all` for reachability and let the server narrow:

- **auditor** — `view-all` on every module; `profile: view-own`. Never `full` or `create-edit`.
- **hod** — `view-all` on students, teachers, offerings, courses, programs, reports, calendar, timetable; `create-edit` on grades, assessments, attendance, announcements (server ownership limits these to their own offerings, and the gradebook already returns a per-offering `can_edit` flag the UI honours); `applications: none`; `settings: view-own`.

- [x] **`features/settings/index.tsx`** — the Courses and Programmes tabs are gated on `canWrite(role, 'settings')`, so an auditor or HOD cannot reach the catalog at all. Re-gate per tab on `canAccessModule(role, 'courses' | 'programs')`. Verify Dean and Registrar are unchanged.
- [x] `app/router/TeacherProfileRoute.tsx:32` — the `switch` sends unknown roles to `/forbidden`; add both cases.
- [x] `features/grades/index.tsx` — `canSeeRevisions` branches on literal role strings; make the new roles explicit rather than letting them fall through.
- [x] `app/router/routes.tsx` `MyProfileRoute` — HOD resolves to the lecturer profile.

---

## Phase 6 — Frontend screens

- [x] **Programme heads editor** — a "Head(s) of Department" section on `features/programs/ProgramCurriculumScreen.tsx` (or the programme detail surface), Dean-only, multi-select of lecturers.
- [x] **Audit Log screen** — new, read-only, under Settings. `DataTable` + `FilterBar`, both already responsive.
- [x] Sweep the ~40 inline `role === '…'` checks so neither new role lands in a wrong branch. The exhaustive maps do not catch these.

---

## Phase 7 — MSW demo parity

The demo build has a **parallel authorization layer** that has twice certified behaviour the real backend refused. Treat parity as part of the work, not a follow-up.

- [x] `mocks/fixtures.ts` — `MOCK_USERS` + `names`. `LoginForm` renders a button per `ROLE_OPTIONS` entry automatically, so both roles appear on the demo login screen for free.
- [x] `mocks/demo/selectors.ts` — `DEMO_REPRESENTATIVE_USER_ID`; `mocks/demo/data.ts` — seed an HOD lecturer (head of a programme with several other lecturers under it) and an auditor.
- [x] Per-handler `sessionRole` gates re-implement authorization independently: `handlers/{students,teachers,grades,offerings,settings,courses,attendance,reports,admissions}.ts`. In particular `narrowToLecturer` (`handlers/students.ts:135`) returns **everything** for any role that is not `'teacher'` — an HOD would see the whole school.
- [x] Mirror the auditor write-block in the mock layer so the demo refuses writes too.

---

## Phase 8 — Docs

Per the repo convention, a tracked phase plan with checkboxes lives in `docs/`:

- [x] `docs/d43-hod-auditor-roles-and-course-print.md` — this plan, as the tracking doc.
- [x] `docs/requirements.md` §2 — two new columns on the authoritative matrix, plus §2.1 prose.
- [x] `docs/roles-access-and-flows.md` — currently "the four roles" throughout, and already flagged stale (pre-D31 homeroom model). Update the matrix and role summaries; do not attempt a full de-staling here.
- [x] `docs/architecture.md` §3.2 — "**Roles are fixed (4)**" is now wrong.
- [x] `docs/database-schema.md` — the `user_role` "Fixed at 4" note (line 90), decision DB-9, and the new `program_heads` table.
- [x] `docs/progress-tracker.md` — the D43 entry.

---

## Verification

Static checks have hidden four defects in this repo, so each phase is verified by **executing**, not by a green typecheck.

**Backend**
```
backend/.venv/Scripts/python.exe -m pytest
```
Use the project venv — the global python silently skips 53 tests with a misleading message. Full suite is ~1784 tests in ~100–140 s, so just run all of it.

New suites, modelled on `backend/tests/test_d42_lecturer_scoping.py` (the closest precedent) and reusing the `_Graph` fixture from `test_grades.py`, which already builds an owned offering plus one owned by a different lecturer:

- [ ] `test_d43_auditor_readonly.py` — auditor reads each module 200; **every** mutating verb across all routers returns 403 `read_only_role`; logout and own-password-change still succeed.
- [ ] `test_d43_hod_scoping.py` — HOD sees students/lecturers/courses/offerings of their programme and **not** another's; can write grades on an offering they hold; gets 403/404 on one they do not; a two-programme HOD sees the union; a shared GEC course appears for both HODs.
- [ ] Regression: Dean, Registrar, Lecturer and Student behaviour unchanged — especially the D42 lecturer scoping.

**Migration** — apply `016` to a **scratch database**, then `verify_schema.py`. Never verify write paths against the live `sims` DB: the services commit internally, so a rollback wrapper protects nothing. Note the collation is case-insensitive, so use `HEX()`/`BINARY` if comparing role strings for drift.

**Frontend** — Vite and `npm run dev`/`build`/`demo` cannot run here (esbuild's binary is blocked by policy).
```
cd frontend
npx tsc -b --force      # never plain `tsc -b` — the incremental build has hidden an undefined identifier
npx eslint src          # 0 errors; 2 pre-existing warnings expected
node scratchpad/probe_d43_roles.mjs
```
The probe is the real verification: plain-Node, bundling the actual MSW handlers with the esbuild **JS API** (which does work). Model it on `probe_d42_scoping.mjs` and `probe_retired_toggle.mjs` — the latter already exercises `GET /courses` for the active/retired cases and is the natural place to assert the print query. Assert: each role's nav sections, the HOD programme narrowing, the auditor write refusals, and that the print fetch returns the full filtered set rather than one page.

Also run `node scratchpad/check_msw_routes.mjs` for route parity against `backend/openapi.json`.

---

## Status — COMPLETE (2026-09-02)

| Check | Result |
|---|---|
| Backend suite | **1831 passed** (was 1784) against scratch DB `sims_d43` |
| `test_d43_auditor_readonly.py` | 9 passed — walks the live route table; mutation-checked |
| `test_d43_hod_scoping.py` | 38 passed — two-programme fixture; mutation-checked |
| `npx tsc -b --force` | clean |
| `npx eslint src` | 0 errors (2 pre-existing warnings) |
| `probe_d43_roles.mjs` | ALL PASS — HOD 6/45 students, 9/12 offerings, 6/12 lecturers; auditor matches the Dean and is refused every write |
| `probe_d43_print.mjs` | ALL PASS |
| `probe_d42_scoping.mjs` | 25/25 — D42 lecturer scoping unchanged |
| `check_msw_routes.mjs` | 0 ghosts |
| Migration `016` | applied to scratch DB; 20 users intact, `HEX(role)` shows no case drift |

### Defects found on the way (all fixed)

1. **The demo clamped `page_size` to 100 where the server allows 200** — the catalog print
   sheet returned 100 of 114 courses under a heading saying "Course catalog". Static checks
   were clean throughout; only executing the handlers found it.
2. **`get_dashboard` fell back to `_admin_payload`** for any unmatched role, so a role added
   later would inherit the Dean's school-wide dashboard by omission. Now explicit, and it
   raises rather than guessing.
3. **The demo had the same bug inverted** — an unmatched role got the *student* payload
   tagged with its own role name, which the page would then render with the wrong component.
4. **The offerings list and detail disagreed** for an unrecognised role: the list returned
   everything, the detail 404'd.
5. **The programmes module was never in `app/db/models.py`**, so `programs` and
   `program_courses` had been absent from `Base.metadata` since D30.

### Deliberately NOT done

* **No `user_roles` M:N table.** An HOD is one role value that carries lecturer powers, so
  the one-role-per-user invariant (OQ-DB3) is intact.
* **No `departments` table.** A programme is the unit BAJC actually has.
* **Provisioning a lecturer login still creates `teacher`, never `hod`.** Promotion is the
  Dean's separate, audited act — creating staff is the Registrar's, and it must not be a
  way to mint a role that reads a whole programme.
* **The live `sims` database was never touched.** Everything was verified on `sims_d43`, a
  full copy. **`016_hod_auditor_roles.sql` still needs applying to `sims`** — an operator
  task, like every migration in this chain.

---

## Notes and risks

- **78 files are already uncommitted** on `tertiary-refactor` (the D40/D41/D42 work). Worth committing before starting so D43 is a reviewable diff.
- The biggest correctness risk is not the new code but the **`elif` fallthroughs** in Phase 3 — a role that is merely unlisted inherits the admin dashboard and the unscoped offerings list. The table above is the checklist.
- `progress-tracker.md` OQ-DB3 records that a genuine dual-role need would require a `user_roles` M:N table. This plan does not create one: HOD is a single role value that carries lecturer powers, which keeps the one-role-per-user invariant intact.


---

## Follow-up (2026-09-02) — two client changes

### 1. Appointing a head now grants the role

The original design kept the appointment and the access apart on purpose, and the client
overruled it: *"why do i need to manually change the role to hod? make it automatic when i
appoint and when i remove the appointed."* Fair — the two-step version meant the Dean
appointed someone, nothing observable happened, and the head only found out when their
screens were still empty.

`programs/service._sync_head_roles` does it, and carries the three rules that make
automatic role changes safe rather than surprising:

| Rule | Why |
|---|---|
| Only a `teacher` is promoted | A Dean, Registrar or Auditor who is also appointed keeps their role. This endpoint must never grant MORE than an HOD, and silently demoting a Dean to a lecturer would be worse. |
| Only an `hod` is demoted, and only to `teacher` | Any other role was not granted here and is not this endpoint's to remove. |
| **A removed head keeps the role if they still head anything else** | Someone running two programmes taken off one is still a Head of Department. Demoting them would revoke access to the department they still run — a silent failure. |

The third is mutation-checked: replacing the "still heads something" query with an
unconditional demote fails `test_a_two_programme_head_removed_from_ONE_keeps_the_role`.

The diff is flushed **before** the role sync, because the demotion test asks what remains
and would otherwise still see the row just deleted.

Mirrored in the MSW handler, including both safeguards, and covered end-to-end by
`probe_d43_roles.mjs` (appoint → promoted; second programme → still `hod` after one is
removed; last one removed → back to `teacher`).

The `ProgramHeadsCard` warning about un-promoted heads is gone — it described a state that
can no longer occur.

### 2. Dropdowns scroll instead of filling the screen

*"make all dropdown like text dropdown so when its alot of options it doesnt take the
screen but i/user can scroll the options."* Two layers:

- **Every dropdown, in the theme.** MUI caps nothing by default, so a `<Select>` over a
  long list renders every option and grows past the viewport. `MuiSelect`, `MuiMenu` and
  `MuiAutocomplete` now cap at `max(40vh, 240px)` — a viewport fraction rather than a fixed
  pixel height, because a fixed 320px menu still covers most of a 390px phone. Set as a
  *default prop*, so any screen needing different behaviour can still override it.
- **Type-to-filter where the list is genuinely long.** A cap makes 114 courses scrollable;
  it does not make finding `MATH1210` pleasant. New `shared/components/SearchableSelect`
  is shaped like the `<TextField select>` it replaces (plain string `value`/`onChange`), so
  converting a picker is a local edit. It searches a `hint` as well as the label, so typing
  a course *code* finds a row whose label is the course *name*.

Converted: the offerings course filter, the offering form's course picker, the
credit-transfer course picker, and the students offering filter. `PrerequisitesDialog`
already used an Autocomplete. Everything else is short enough that the cap is the whole fix.


---

## Defect fix (2026-09-02) — the HOD dashboard 500'd

Reported: *"when i placed a lecturer as hod, the lecturers dashboard crashed getting a
internal server error 500."*

**Cause.** The re-tagging in `get_dashboard` splatted one model's dump into another:

```python
HodDashboard(**_teacher_payload(...).model_dump())    # role="teacher" -> Literal["hod"]
```

`TeacherDashboard.role` is `Literal["teacher"]` **with a default**, so `model_dump()`
carries `role="teacher"`, and handing that to `HodDashboard` is a Pydantic
`literal_error` — a 500 on the dashboard of the role this increment added. The Auditor
branch had the identical bug. Fixed with `model_dump(exclude={"role"})`, which lets each
subclass apply its own discriminator.

**Why nothing caught it, which is the more important part.** `probe_d43_roles.mjs` DID
assert the HOD dashboard's tag and shape — against the **MSW mock**, a separate
implementation that happened to build its payload as `{...teacherPayload(user), role:
'hod'}`, spread-then-override, which is correct. So the probe was green and the server was
broken. There was no backend test on `GET /dashboard` at all.

This is the third recorded instance of the demo certifying behaviour the backend does not
have, and the first where I wrote the divergence myself. **A frontend probe is not
evidence about the server.**

**Coverage added** (both mutation-checked — reverting the fix fails 5 of them):

* `TestEveryRoleGetsADashboard` — `GET /dashboard` for all **six** roles, asserting 200
  and the right discriminator, plus tag-and-shape agreement for the two new ones, plus the
  literal client path (appoint a lecturer via the real endpoint, then load their dashboard).
* `TestFirstPageLoadNeverFivehundreds` — sweeps the twelve endpoints the app shell fires on
  sign-in (`/auth/me`, `/dashboard`, announcements, unread count, grade-revisions,
  academic-years, timetable, and the five lists) for HOD and Auditor, appointed and not,
  failing on any 5xx. A new role's first symptom is rarely one endpoint; it is whichever of
  these the shell touches first. No other endpoint was crashing.

Backend **1831 passed**.

### Unrelated: a stray edit in `AccountScreen.tsx`

Partway through this session the "Date format" picker was removed from that file by
something outside this work, leaving `DATE_FORMAT_OPTIONS` unused and `tsc` failing. I
removed the orphaned constant to unbreak the build and did **not** restore the field — the
removal looks deliberate (it matches D42's "dd/mm/yyyy everywhere"), but it is not mine to
undo. Note `date_format: dateFormat` is still sent on save and is now hard-wired to
`'YYYY-MM-DD'`, which may or may not be intended.

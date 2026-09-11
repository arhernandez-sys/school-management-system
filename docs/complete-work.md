# Complete work — BAJC Student Information Management System

_Consolidated 10 September 2026. This replaces `progress-tracker.md` and the fifteen
per-cycle plan documents (`d33`–`d45`, the two tertiary-refactor plans, the
midterm-revision plan), which were deleted. Everything below is a record of work that is
**built, tested and in the tree**; the full blow-by-blow, including every superseded
draft, remains in git history._

**Companion documents:** [`project-now.md`](project-now.md) — what the system *is* today.
[`needs-attention.md`](needs-attention.md) — what is still open and who owns it.
[`documentation-map.md`](documentation-map.md) — what survived this clean-up and why.

---

## 1. What this system is

A Student Information Management System for **Belize Adventist Junior College (BAJC)** —
a tertiary institution running 8–9 Associate-degree programmes with fixed course
sequences, credits, prerequisites, a 4.00 grading scale and credit-weighted GPA.

It began as a K-12 school system and was refactored into a junior-college system. That
history explains most of the odd names still in the code, and the refactor is the single
largest piece of work in the project.

**Counts as of this consolidation:** 2,161 backend tests green · ~403 frontend source
files · 44 database tables · 46 students, 9 programmes, 125 courses in the live register.

---

## 2. The two structural refactors

### D30 — the catalog and curriculum became tertiary

The graded chain used to end at `subjects`, which has **no credits**. Nothing stored
could reach a credit value, so credit-weighted GPA, quality points and credits-earned
were all impossible. `subjects` became **`courses`** (with `credits`, `component`,
prerequisites), and `programs` / `program_courses` (243 rows) became the curriculum.

Every row was copied **preserving its UUID**, so re-pointing the foreign keys orphaned
nothing.

### D31 — `classes` became `course_offerings`

The offering layer stayed K-12 in three ways, all verified against the live database:

- `classes` was scoped to an academic **YEAR** with no `semester_id`, so "Programming I,
  Semester 1" and "Programming I, Semester 2" were inexpressible;
- `classes.grade_level` was `NOT NULL` and held `Form 1`–`Form 4`, so every offering had
  to declare a Form;
- `class_subjects` was a many-to-many that only made sense while one homeroom taught
  seven subjects.

**One offering now teaches ONE course in ONE semester.** `Class` and `CourseOffering`
merged. The child tables kept their names (`class_enrollments`, `class_teachers`,
`class_meetings`) because renaming the tables was not in scope, and an ORM class whose
name disagrees with its table is worse than one carrying a historical prefix.

Two consequences worth knowing: an offering's **label is derived**, not stored
(`offerings/labels.py` is the one definition), and reaching an offering's academic year is
a hop through its semester (`offerings/queries.py::offerings_in_year`, written once
because the hop appeared in 17 places).

---

## 3. The modules, and what each one enforces

| Module | What it does | The rule that matters |
|---|---|---|
| **Auth** | Argon2id, lockout after 5 failures, 30-min idle timeout, refresh rotation, forced password change | `must_change_password` is enforced in `get_current_user`, not at one client call site — a deep link used to walk straight past it |
| **Students** | Register, profiles, programme history, documents, academic history | Ordered by **surname** (`STUDENT_NAME_ORDER`, one definition; there were once nine) |
| **Admissions** | Application → review → decision → student record, credit transfer, document checks | `deferred` is TERMINAL; `eligible` is deliberately not a decision. The SSN guard refuses only while an earlier application is still OPEN |
| **Courses / Programmes** | The catalog, programme curricula, prerequisites, heads of programme | Prerequisite validation reads `course_prerequisites`; `prerequisites_text` is documentation and cannot be queried |
| **Offerings** | One course, one session, sections, lecturers, roster, meetings | Capacity is a **warning**, never a gate. Prerequisites ARE a gate, overridable only by the Dean with a logged reason |
| **Assessments** | Categories, weights, lifecycle (draft → published → grading → graded), release | Weights are **not** assumed to total 100 — see [`needs-attention.md`](needs-attention.md) |
| **Grades** | Gradebook, term grades, GPA, revisions, mid-term freeze | One engine (`grades/calc.py`). Nothing recomputes term-grade maths locally |
| **Attendance** | Registers, summaries, per-student and per-class alerts | One tally (`_summarize`); **late counts as present**; the floor is configurable and compared *strictly below* |
| **Reports** | Report card, transcript, offering grades, plus the four §53 institutional reports | Documents print frozen snapshots for archived years and compute live for the current one |
| **Audit** | The whole `audit_log`, rendered into sentences | One door. No id, table name, action key or JSON reaches the client |
| **Dashboard** | Six role-shaped payloads from one endpoint | Dispatches explicitly and fails closed — a bare fallthrough once handed any new role the Dean's view |
| **Settings** | School profile, academic years, sessions, grading scale, assessment policy, classrooms, users | Academic-structure routes are refused to the technical role even though they sit under `/settings` |
| **Announcements / Calendar** | Audience-targeted notices with read tracking; school events | — |
| **Timetable** | Read-only Mon–Fri week per student/lecturer, built from `class_meetings` | Editing is **not built** — see [`needs-attention.md`](needs-attention.md) |

---

## 4. Roles and access

Six roles: **Dean** (principal), **Registrar** (secretary), **Lecturer** (teacher),
**Student**, **Head of Programme** (HOD), **Auditor**, plus **System Administrator**.
The wire values are the older words; the display vocabulary is the college's.

Three access decisions are load-bearing and were each reached the hard way:

1. **The Auditor reads everything and writes nothing**, enforced in `get_current_user` —
   the one dependency every authenticated route passes through. Expressing it per-route
   would have meant getting ~121 dependency tuples right, where one miss is a read-only
   account that can delete a student. **An endpoint written next year is read-only for an
   Auditor without its author knowing the role exists.** Three exemptions: logout, own
   password, own preferences.

2. **The HOD is a Lecturer who also runs a programme.** They keep every lecturer power on
   offerings they are *assigned to* — ownership, not role, is the limit — and additionally
   *read* their programme's students, courses, offerings and colleagues. "They can't edit
   grades" is delivered by `assert_teacher_owns_offering`, not by the role tuple: an HOD
   must be inside `require_role(TEACHER, HOD)` on grade entry or they could not grade
   their own class. Appointing a head grants the role; removing the last appointment
   revokes it, unless they still run another programme.

3. **The System Administrator gets accounts, configuration and backups — and no academic
   data at all**, enforced centrally as `technical_role_scope` against an **allowlist**
   of route prefixes. A denylist would be default-allow, so a router added next year would
   be open until somebody remembered it.

---

## 5. The client cycles, in one line each

| Cycle | Delivered |
|---|---|
| **D33** | Directory UX; the **mid-term freeze** now blocks grade ENTRY, not just revisions; filters moved into a modal |
| **D34** | Legacy tables dropped; client's own status vocabulary adopted; live `sims` down to 39 tables |
| **D35** | `coursestatus` made real — a withdrawal KEEPS the roster row, audit and W-P leave the GPA alone |
| **D37** | Gender and school-year dropdowns — constrain the write path, not the column |
| **D38** | The admissions holding table — `application_temp`, renamed 11 Sep 2026 from the misleading `student_profile_temp`; a refused submit never eats the row. ⚠️ Its *save only at the end* rule was **reversed on 11 Sep 2026** at the client's request — every *Continue* now saves |
| **D39** | Meeting #2: date formats, registration wording, the post-graduation access window |
| **D40** | Religion from its table, civil-status dropdown, the lecturer form became a page |
| **D41** | Offering Edit + green Restore — archiving an offering had been a one-way door |
| **D42** | Lecturer scoping, login lands on the dashboard, **dd/mm/yyyy everywhere** via one `DateField` |
| **D43** | The **Auditor** and **HOD** roles; course print/PDF |
| **D44** | The client's `sims_10` dump reconciled — diffed field by field, four of its decisions deliberately not reproduced |
| **D45** | Meeting #4/#5: the yellow-highlighted blueprint sections. Phases 1, 2, 3A, 4, 7, 8, 9 complete |

### D45 in detail (the current cycle)

- **Phase 1** — the mid-term freeze lock, the sysadmin allowlist, §8 programme fields, a
  configurable attendance floor, Dean tiles.
- **Phase 2** — the two status vocabularies: student statuses 6 → 11, registration
  statuses 4 → 8. ⚠️ An ENUM **case** change is invisible to MariaDB's case-insensitive
  collation, so the migration went via varchar and verified with `HEX()`.
- **Phase 3A** — "term" reads **Session** throughout the UI; four prerequisite UX defects
  fixed, including a picker that offered students the gate would refuse.
- **Phase 4** — registration validation: the §20 student-status rule was **not enforced
  at all** before this (the picker filtered, the API did not — a filtered dropdown is not
  an access rule), plus the Dean's override with a logged reason.
- **Phase 7** — the audit trail. §46's worked example was **not reproducible**: a grade
  change stored `{"entries": 3}`, the count of cells touched. It now emits one row per
  mark that actually moved, with before and after, and every row renders server-side into
  a sentence.
- **Phase 8** — the Dean dashboard's full §42 KPI set, then redesigned around a
  "Needs you today" hero after the client called the first pass ugly. Every figure
  deep-links to the screen that clears it.
- **Phase 9** — the four §53 institutional reports: new-versus-returning, over-capacity
  classes, credit load, per-programme attendance. **No migration needed** — the reports
  were never a schema gap, just four unwritten queries.

**Phase 3 (Curriculum Management) was removed**, not deferred, at Meeting #5.

---

## 6. Defects worth remembering

These are the ones that would recur:

- **A rule enforced at one entrance is not enforced.** The status gate existed on the
  picker and not the API; the prerequisite gate had to be added to the students-module
  enrolment path as well as the offerings one.
- **The MSW demo layer has certified behaviour the backend does not have five times** —
  a page-size clamp, a role fallthrough, an unmatched-role payload, the sysadmin on the
  audit trail, and a picker that hardcoded `eligible: true` for every student. A frontend
  probe is not evidence about the server.
- **Two doors onto one table.** `GET /settings/audit-log` and `GET /audit` read the same
  rows; the security decision that refused the sysadmin was applied to one of them. Grep
  for the *table*, not the endpoint.
- **A field the server always sends must not be optional in the frontend type.** Four
  Dean KPIs were computed for a whole phase and silently dropped because the type could
  not express them.
- **A comment describing a query parameter is not a query parameter.** The admissions
  list documented `?status=` from D30 and never read the URL.
- **A value can be saved correctly and dropped on the way out — and then erase itself.**
  `_pending_list_item` hardcoded `program=None`, so a pending application's programme was
  stored fine and returned null. The wizard seeds its draft from the read, so reopening a
  form showed an empty Programme select and the next save wrote that emptiness back.
  **A read defect that destroys data on the following write.** ⚠️ And for once the MSW
  demo was RIGHT and the server was wrong, so the bug was invisible in demo mode — the
  parity check runs in both directions.
- **An optional field with a fallback is a decision nobody made.** The accept action took
  `login_email` and, if it was blank, silently used the applicant's own address — so a
  contact detail became a sign-in credential because nobody typed anything. The prompt for
  it was also in the wrong place: the review screen listed *"An email address is required
  to issue the student a login"* under **Outstanding before this can be accepted**, which
  reads as a debt the APPLICANT owes, when in fact the college issues the address. The
  fix was to delete the fallback, make the field required at the moment the account is
  created, and report it as a **field** error rather than an application-level issue.
  ⚠️ Two collaborators had each done something reasonable about this and produced a hack
  between them: the client filtered the issue out of `blocking_issues` by matching the
  first few words of the server's prose. A client re-deriving a server rule from its
  wording breaks the moment the wording is edited.
- **`total_courses` counted offerings**, with `deleted_at IS NULL` written three times —
  the tell-tale of a copy-paste.
- **Verify by executing.** A green typecheck has hidden defects here repeatedly; and
  before accepting that you *cannot* execute something, test the constraint itself — the
  project believed for three phases that the frontend could not be built locally, and it
  can.

---

## 7. How the work is verified

- **Backend:** 2,172 pytest tests, transactional-rollback isolation, run against a
  throwaway copy of the live database. Never against live `sims`.
  ⚠️ 37 of them (all of `test_pending_applications.py`) fail until the
  `application_temp` rename is run — see **needs-attention.md §13**. They fail for one
  reason, *"Table 'application_temp' doesn't exist"*, which is also the proof that the
  rename's blast radius is a single table.
- **Demo layer:** twelve executable probes in `frontend/scratchpad/probe_*.mjs` bundle the
  real MSW handlers with esbuild's Node API and serve them under `msw/node`.
- **React components:** server-rendered and asserted on
  (`probe_dean_render.mjs`), and screenshotted in headless Chrome (`shoot_dean.mjs`).
- **Frontend:** `tsc -b --force`, `eslint`, and a real `vite build`.
- **Schema:** `backend/db/mariadb/verify_schema.py` probes the live database for the
  columns, indexes and foreign keys the code expects.

# D44 — `sims_10` reconcile + Meeting #3

**Branch:** `tertiary-refactor` · **Migration:** `backend/db/mariadb/017_sims10_reconcile.sql`
· **Status:** built and verified (backend 1896 tests green; frontend typecheck + lint clean;
API driven end-to-end against a scratch copy of `sims`).

The client returned an updated MariaDB dump (`sims_10.sql`) and a list of UI changes. The
two had to land together: the `independent` term type, the ten-state application vocabulary
and the new programme and classroom columns are schema deltas the requested features sit
directly on top of.

---

## 1. What `sims_10.sql` actually changed

Diffed live `sims` (42 tables) against the dump (43) by comparing `SHOW CREATE TABLE`
output field-for-field against the dump's `CREATE TABLE` bodies. The complete delta:

**New table:** `classroom` — `classroomid`, `roomcode`, `Building`, `Capacity`,
`room_type`, `status`, `created_by/on`, `edited_by/on`.

**New columns**

| Table | Column | Definition |
|---|---|---|
| `applications` | `conditions_of_admission` | `varchar(180) NULL` |
| `course_offerings` | `classroomid` | `uuid DEFAULT uuid_v4()` |
| `programs` | `head_of_dept_id` | `uuid NOT NULL DEFAULT uuid_v4()` |
| `programs` | `admission_requirements` | `varchar(100) NULL` |
| `programs` | `graduation_requirements` | `varchar(100) NULL` |
| `programs` | `comments` | `varchar(500) NOT NULL DEFAULT '1'` |
| `semesters` | `semester_status` | 6-value enum, default `active` |

**Changed enums:** `semesters.term_type` += `Independent`; `users.role` += `sysadmin`;
`applications.status` from 6 values to 10, **renaming `denied` → `rejected`**.

Nothing was dropped. No views either side.

### Five things in the dump NOT copied verbatim

1. **`'Independent'` is stored lowercase.** Not tidiness. MariaDB returns an enum label as
   the column DECLARES it, and SQLAlchemy maps `TermType` by exact value — a column
   declaring `'Independent'` hands the ORM a string no member matches, and every read of an
   independent term raises `ValueError`. The capital lives in
   `frontend/src/features/settings/termTypes.ts`, which is where a display decision belongs.

2. **`programs.head_of_dept_id` was not adopted** (confirmed with the user). D43 already
   answers "who heads this programme" with `program_heads`, a join table, because a lecturer
   can head two programmes and a programme can have co-heads during a handover. The dump's
   column is single-valued, has **no foreign key**, and defaults to `uuid_v4()` — every
   existing programme would carry a head id pointing at nothing, while `rbac.hod_program_ids`
   went on reading the join table. Two sources for one fact, one of them wrong on every row.

3. **`course_offerings.classroomid` is nullable with a real FK.** The dump's
   `DEFAULT uuid_v4()` would have pointed all 19 existing offerings at a room that does not
   exist.

4. **`denied` → `rejected` needed a data migration**, not just an enum rewrite. Live `sims`
   had a row on `denied`. §2 of the migration widens to the union of both vocabularies,
   rewrites the data, then narrows — the shape `011` §3 established.

5. **Three defects corrected on the way in:** `classroom.status` was missing an `l` in
   `Available`; `programs.comments` was `NOT NULL DEFAULT '1'`, a stray test value that
   would have put a literal `1` in all seven programmes' notes; and
   `semesters.semester_status` had `'grade submission'` with a space where every other enum
   here is `snake_case`.

### Not in the dump, but needed

The dump has **no application-number column** — applications were addressed by uuid only,
which is unusable over a telephone. And `student_number_sequences` was keyed
`year_month char(6)`, which cannot express a year-scoped counter. Both are D44's own
additions (§1 and §4 of the migration).

---

## 2. Migration `017_sims10_reconcile.sql`

Numbered, re-runnable, `information_schema`-guarded, applied with `db/mariadb/apply_sql.py`.
**Rehearsed on a full copy (`sims_d44`), applied twice, second run a clean no-op.** Alembic
remains non-functional against MariaDB here.

Contents: `number_sequences` (generalising the student counter), the ten-state
`applications.status` + data migration, `conditions_of_admission`, `application_number` +
unique index + backfill + sequence seed, `term_type` += `independent`, `semester_status`,
the three `programs` columns, the `classroom` table, `course_offerings.classroomid` + FK,
and `users.role` += `sysadmin`.

**`sysadmin` is a DB enum value ONLY.** `app.common.enums.Role` deliberately has no member
for it: `ROLE_LABEL` is `Record<Role, string>` so adding one without a label is a frontend
type error, `PERMISSION_MATRIX` is keyed by role, and no sysadmin BEHAVIOUR was specified.
The column can hold the value, which is what makes the client's dump loadable; the code
gains the role when there is a feature to gain it for.

---

## 3. The application state machine

```
draft → submitted → under_review ⇄ documents_pending
                    under_review → eligible
        under_review | eligible → accepted → enrolled
        under_review | eligible → rejected | deferred
      any non-terminal → withdrawn
```

Three decisions worth recording:

**`deferred` is TERMINAL.** It could either reopen at the next intake or be terminal with
the applicant re-applying — not both. If it reopened it would be an OPEN status, and the SSN
duplicate guard would then refuse the very re-application the deferral points the applicant
towards. Terminal is what makes the two rules agree, and it is the more honest record: an
intake is what an application is *for*.

**`eligible` is NOT a decision.** It leaves `decided_by_user_id` and `decided_at` NULL,
because the college may have more qualified applicants than places. Collapsing it into
`accepted` would make the count of accepted students meaningless.

**`eligible` checks `submission_issues`, not `acceptance_issues`.** ⚠️ This was a real
defect, caught by driving the API rather than by any type check: the first implementation
reused `acceptance_issues`, which demands "an email address is required to issue the student
a login" — a *provisioning prerequisite*, not an academic finding. An applicant can plainly
meet the requirements while the Registrar is still chasing them for an email. Pinned by
`test_eligibility_does_not_require_a_login_email`.

`/deny` was renamed `/reject` on the route, in the service and in the audit action. **Not
aliased** — two spellings of one decision is how an audit trail ends up with both in it.

---

## 4. The SSN duplicate guard

"Check the SSN so they can re-register" is one sentence, and a blunt one-application-per-SSN
rule would honour its first half by breaking its second: a rejected applicant could never
apply again. So the guard refuses only while an earlier application is **open**
(`OPEN_APPLICATION_STATUSES`, derived from `DECIDED_APPLICATION_STATUSES` rather than listed
separately, so a status cannot be added to the enum and fall outside both).

It also checks `student_profiles.ssno`: the likeliest real duplicate is not two applications
but somebody already studying here filling in the form again.

Mirrored at **three** entry points — `create_application`, `create_pending_application` and
`submit_pending_application` — via one `_assert_no_open_application` helper. The pending
check matters: telling the Registrar at the END of a seven-step wizard that the applicant
already has an open file wastes the whole transcription.

---

## 5. ID formats

| | Before | After |
|---|---|---|
| Student | `YYYYMM###` | `YYYY-NNNNN` |
| Application | *(uuid only)* | `APP-YYYY-NNNNN` |

`student_number_sequences` (`year_month char(6)` PK, encoding the retired format in the
schema) became `number_sequences(scope, seq_key, last_seq)`, so **one** allocator serves
both. The row-lock safety argument (`INSERT … ON DUPLICATE KEY UPDATE` inside the caller's
transaction) is subtle enough that it should exist once, not twice.

The **46 existing students keep their numbers** (confirmed with the user) — 45 legacy
`S-25001` forms and one `202608006`. Pre-D44 counters are carried across under scope
`student_ym` for provenance and never allocated from again. The old table is kept on disk
(the 006 convention) but nothing maps it: a model for a table no code may write is an
invitation to write to it.

An application gets its number at CREATE, drafts included — the number is what the Registrar
quotes on the phone, and that call happens long before anybody decides anything. A pending
(`student_profile_temp`) row gets one at promotion, since that is when a real application
exists.

---

## 6. Attendance alerts

`GET /attendance/alerts?academic_year_id=&threshold=` — classes and students below 80%,
worst first. Built on `_summarize`, the same tally the summary screen, both dashboards and
the report card use, and scoped through `list_offerings`, so a lecturer is alerted about
their own classes without that rule being written twice.

⚠️ **READ THE DENOMINATOR BEFORE THE PERCENTAGE.** `_summarize` divides by records
**written**, not sessions scheduled: a class marked twice with one absence reads 50% and is
not in trouble. Every alert therefore carries `sessions_recorded`, every class alert carries
`enrolled_count`, and rows under five sessions are annotated. An alert that hides its
denominator is one people learn to close without reading.

A class with **no** records is not flagged — that is a register nobody has opened, and
reporting it at 0% would bury the classes genuinely in trouble.

Fixing the denominator properly means knowing which sessions *should* have been held —
`class_meetings` plus a term calendar plus a holiday list — and would move the percentage on
five other surfaces at once. **Out of scope here; stated rather than silently inherited.**

New screens: an **Alerts** tab, plus two drill-downs (`/attendance/student/:id?offering_id=`
and `/attendance/offering/:id`) reached from a row rather than browsed to.

---

## 7. Lecturer scoping on the student page

D42 **filtered** `current_offerings` down to a lecturer's own offerings, so a colleague's
course vanished and a lecturer could not tell whether their advisee was taking three courses
or eight. D44 shows the full enrolment with `can_open` per row.

⚠️ **This is a widening.** A lecturer now sees the NAMES of courses they do not teach. That
is a small amount of information about a student they are already authorised to view
(`_assert_teacher_can_see_student` has already run), and the offering PAGE stays shut —
`offerings/service` refuses on its own authority. **`can_open` is an affordance, never the
boundary.**

The directory's `offering_count` was un-narrowed to match. D42 wrote down the invariant
"the count and the profile must agree"; D44 only changed which side they agree on.

Adjacent D43 bug fixed while here: `StudentDetailPage` computed `canSeeGrades` as
`role === 'principal' || role === 'teacher'`, omitting `hod` — so a Head of Department lost
a tab `students/router.py` explicitly grants them. Now uses `isLecturerRole`.

---

## 8. Navigation

Courses and Programmes left Settings for the main menu (`/courses`, `/programs`). The old
paths redirect, including `/settings/programs/:programId` → `/programs/:programId` with the
id preserved: a route path is user-visible, and a 404 is a poor reward for having saved a
link.

**The first collapsible nav group in this app.** `NavItem` gained `children`; `Sidebar`
renders them in a `Collapse` with a separate expand control, so clicking the LABEL still
navigates — folding the two together would turn a real destination into a toggle.

⚠️ **The parent is highlighted while a child is active.** `/offerings` is not a sub-path of
`/courses`, so the prefix rule alone would leave the group unlit while Course Offerings is
open and the nav would say you are nowhere. This is also exactly what was asked for.

⚠️ **Both entries are gated on the `courses` module, not `programs`.** `PERMISSION_MATRIX`
gives `programs` capability `view-all` to EVERY role, so gating Programmes on its own module
would put it in front of Lecturers and Students. The Settings tab was keyed this way for the
same reason; the note moved to `navConfig` with the code.

---

## 9. Smaller items

- **Mid-session freeze copy.** The session row read `Mid-session frozen {start} → {end}`
  unconditionally — a window that closed in March still announced itself as frozen in
  September. Now time-aware against the same comparison the server enforces
  (`grades/service.midterm_freeze_state`, both bounds inclusive): while running it reads
  *"Grades are currently closed and will accept new grades after {end}."*
  The frontend/backend **mid-session vs mid-term** split was also closed, by adding the three
  missing overrides to `errorMessages.ts` — without them the server's "mid-term" wording
  reached users verbatim.

- **Teacher → Lecturer.** Mostly done in D30; the Add-user role dropdown already read
  "Lecturer". Three genuine strings remained: the Registrar dashboard's *Add teacher* tile,
  the *Teacher licence no.* field, and the audit-log entity filter, which rendered the raw
  wire value `teacher` through `humanizeAction`.

- **Editing an application under review.** The server has always allowed this
  (`_assert_editable` refuses only once decided); only the button was missing. Added to the
  review screen and the list, gated to Dean + Registrar.
  ⚠️ **A real defect went with it:** the wizard's `/:id/edit` route offered *Save and submit*,
  which calls `POST /submit` and 409s `application_not_draft` on anything already submitted.
  The footer is now mode-aware.

- **Classrooms.** New module, Settings tab, and a room picker on the offering form.
  Occupancy (`In-Use`/`Available`/`Occupied`) is **storable but not settable** — it is a
  function of the timetable, and a room marked `Occupied` on Monday morning is wrong by
  Monday afternoon. Deleting a room in use is refused with a 409 naming the count, rather
  than letting the `ON DELETE SET NULL` quietly unroom every class in it.

---

## 10. Still open

- ⚠️ **`class_meetings.room` vs `course_offerings.classroomid`.** Both now describe where a
  class meets, and the free-text one is still what the timetable renders. Two sources for one
  fact. Which wins is a decision for the timetable work; it must not stay unmade.
- **`semesters.semester_status` is storage only.** It overlaps `semesters.is_active` (exactly
  one term, unique-indexed) and the year's archive state. Wiring a third answer to "is this
  term running" into the freeze logic, roster scoping and report snapshots — all of which key
  off `is_active` — without first deciding which wins is how they start disagreeing.
- **`eligible` and `enrolled` are the client's words.** The meanings implemented above are
  inferred from the vocabulary. Worth confirming at the next meeting.
- **The attendance denominator**, per §6.

---

## 11. Verification

```powershell
# Rehearse on a COPY. pytest reads DATABASE_URL from backend/.env, which points at live
# `sims`, and several services commit internally, so write paths escape the rollback.
mariadb-dump -h127.0.0.1 -uroot -p sims > snapshot.sql
mariadb -h127.0.0.1 -uroot -p -e "CREATE DATABASE sims_d44 ..."
mariadb -h127.0.0.1 -uroot -p sims_d44 < snapshot.sql

cd backend
$env:DATABASE_URL = 'mysql+pymysql://root:...@127.0.0.1:3306/sims_d44'
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\017_sims10_reconcile.sql
.\.venv\Scripts\python.exe -m pytest -q          # 1896 tests

cd ..\frontend
npx tsc -b --force    # --force is required; the incremental build has hidden a real error
npx eslint .
```

`npm run build` / `dev` / `demo` cannot run on this machine (esbuild is blocked by policy —
RUNBOOK §1), and there is no frontend test suite, so **a typecheck is not verification**.
The API was driven by hand against `sims_d44` instead: the full ten-state lifecycle including
the edit-under-review and the re-application after a deferral, the alerts endpoint and its
lecturer scoping, classroom CRUD including the in-use delete refusal, the programme fields
round-tripping an explicit null, and `independent` round-tripping through
`POST /settings/semesters`.

**Still to do by hand once the frontend can run:** the collapsible Courses group staying
highlighted on Course Offerings, the greyed unclickable chips on a student profile as a
lecturer, and the freeze wording on a session inside its window.

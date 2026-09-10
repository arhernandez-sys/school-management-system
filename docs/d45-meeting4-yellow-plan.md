# D45 — Meeting #4: the yellow-highlighted sections

**Source:** `BAJC Student Information Management System_Revised.docx` (Downloads, 8 Sep 2026)
**Branch:** `tertiary-refactor` · **Database:** `sims` (the only real one) · **Scratch:** `sims_test`
**Legend the client set:** blue/cyan = future, do not build · **yellow = build or modify** · unhighlighted = already agreed as in-scope.

> **⚠️ MEETING #5 (9 Sep 2026) CHANGED THE SHAPE OF THIS PLAN. Read §4a before picking up work,**
> **and §4b for the 10 Sep client feedback — it deleted a route and closed a hole this document
> thought Phase 7 had already closed.**
> **Curriculum Management (Phase 3) is REMOVED.** **Timetable Management is back IN scope**, Dean-only,
> and is now the LAST phase (Phase 10). A new **Phase 3A** carries the terminology sweep and the
> prerequisite UX defects found on 9 Sep. Blue-list §5 changed: timetable is no longer do-not-build.

47 yellow runs across 33 sections. This document sorts every one of them into
*already done*, *half-done*, *genuinely missing*, or *blocked on a decision*, then
sequences the missing work into phases.

---

## 0. Read this first — the ground rules for this cycle

- **`sims` is the only database the app, HeidiSQL, `.env` and `pytest` ever point at.**
  `sims_test` is the one throwaway, recreated in place, never renamed. No new database
  will be created for any phase in this document.
- **Every SQL block below is for you to run, in HeidiSQL, against `sims`.** I will not run
  them. Each phase names the migration file the block will be saved as.
- **Do not run a phase's SQL before that phase's code is merged.** Several blocks widen or
  narrow an `enum` the running application reads. Schema ahead of code is a 500, not a
  no-op. The order inside each phase is: merge code -> run SQL -> verify.
- Verification is by **executing**, not by a green typecheck. `pytest` runs against
  `sims_test`.

⚠️ **CORRECTED 10 Sep 2026 — THE FRONTEND *CAN* BE BUILT AND RUN LOCALLY.** Every claim in this document that it cannot was wrong, and this note is the retraction. Verified by running them: the esbuild binary executes (0.21.5), `node node_modules/vite/bin/vite.js build --mode demo` completes in **12.6s**, and `vite dev` serves HTTP 200. The belief came from a machine-wide note recorded on a DIFFERENT project (`ad-inovo-identity`), where esbuild genuinely is blocked, and it was never tested here — so three phases deferred hand-verification of the UI for no reason, and every "frontend items are verified by driving the UI by hand" caveat in this file was describing a limitation that did not exist. ⚠️ One real gotcha: **`vite dev` binds IPv6 localhost**, so `curl http://127.0.0.1:<port>` is refused while `curl http://localhost:<port>` answers.

**And the demo (MSW) layer is executable headlessly**, which is what several write-ups below said it was not: esbuild's Node API bundles the handlers in-process and `msw/node` serves them to `fetch`. `frontend/scratchpad/probe_*.mjs` are ten such probes, the newest being `probe_d45_dean_and_prereq.mjs` (**38/38**), which is the proper verification of the Phase 8 dashboard payload, the enrol gate and the audit merge.

---

## 1. Contradictions in the document — I need your answer before some phases can start

These are places where the same feature is yellow in one section and blue in another, or
where the document assumes something the system deliberately does not have. I have not
guessed at any of them.

| # | The conflict | Where | What I need |
|---|---|---|---|
| ~~**C1**~~ **ANSWERED — defer** | **Academic Standing** is **blue** as module 15 (§3) but **yellow** as a section heading (§30) and yellow again as a report (§53 Academic Reports). | §3 / §30 / §53 | ✅ *Defer.* Blue title wins: the feature partly exists but not as a full module. |
| ~~**C2**~~ **ANSWERED — defer** | **Graduation Audit, Degree Award, Transcript Management** are all **blue** (§3 modules 16-17, §33-§37) — but the **Graduation Reports** and **Transcript Reports** under §53 are **yellow**, as is "Transcript issuance" for the Auditor (§43) and the `TR-2026-000458` number format (§36). | §33-§37 vs §43 / §53 | ✅ *Defer with their modules.* |
| ~~**C3**~~ **ANSWERED — defer** | **Timetable Management** is **blue** (§3 module 10, §18) — but "Student schedule conflicts / Lecturer conflicts / Room conflicts" inside it is **yellow**, and "No timetable conflict exists" in §20 is **yellow**. Note: a timetable module **already exists** in this system. | §18 / §20 | ✅ *Defer.* ⚠️ **One loose end:** §18's conflict detection sits under a blue title, but §20's "No timetable conflict exists" sits under a **yellow** title. Same feature. It defers by dependency — flagged, not assumed. |
| ~~**C4**~~ **ANSWERED — option (a)** | **§8 Department Management** is unhighlighted (= agreed in-scope), and its "Head of Department" and "Office information" are yellow — but **this system has no `departments` table**. D43 decided a *programme* is the unit BAJC actually has, and HOD is linked through `program_heads`. | §8 | ✅ **(a) — add Head of Department and Office information to the `programs` table.** No `departments` table. Folded into Phase 1; Phase 10 is dissolved. |
| ~~**C5**~~ **ANSWERED — adopt all 10** | **§7.5 Student Status** lists 10 values (Applicant, Accepted, Active, Inactive, Withdrawn, Dropout, Suspended, Completed, Graduated, Alumni). It is **unhighlighted**, so by your legend it is "already in the project" — but the implemented vocabulary is the 6 values D34 set with you: Registered, Unregistered, DropOut, transferred, graduated, withdrawn. | §7.5 | ✅ **Adopt the 10 statuses.** This REPLACES the D34 vocabulary. ⚠️ `transferred` has no target in the blueprint's list — see Phase 2. |
| ~~**C6**~~ **ANSWERED — as the document says** | **§19 Registration statuses** (yellow) drop the **W-P / W-F distinction** that D35 built with you — where a withdrawal-passing leaves the GPA alone and a withdrawal-failing counts as a fail. §19 has only a flat "Withdrawn". | §19 vs D35 | ✅ **Do exactly what the document says — the flat 8.** BAJC's call, reaffirmed after the W-P/W-F warning. The GPA consequence moves to Phase 5 (§29 says withdrawal treatment is configurable), and is recorded in Phase 2. |
| **C7** | Your own question marks: §20 "Authorized staff should be able to override some restrictions. **???**", §29 "GPA rules configurable **??????**", §31 "repeat rule **??????**", §10 "Electives **??**". | §10 §20 §29 §31 | These are policy decisions BAJC must make (the document says so itself in §72 and §74). Phase 5 builds the *configurability*; it cannot invent the *policy*. |

---

## 2. Yellow items that are ALREADY DONE — no work, verification only

Nine of the 47 are already shipped. Listed so nothing gets rebuilt.

- [x] **§5.3 `Documents Pending`** — `ApplicationStatus.DOCUMENTS_PENDING` (D44)
- [x] **§5.3 `Deferred`** — `ApplicationStatus.DEFERRED` (D44)
- [x] **§6 Student ID `YYYY-NNNNN`** — `app/common/numbering.py` (D44). *Note: 46 students keep legacy `S-25xxx` numbers and one keeps `202608006`. The document says a number must never be **reused**; it does not say historic numbers must be re-issued. Leaving them is correct.*
- [x] **§17 Classroom Management** — `classroom` table + `course_offerings.classroomid` (D44), full CRUD with an in-use delete refusal
- [x] **§20 "Prerequisites are satisfied"** — `_assert_prerequisites_met`, `app/modules/offerings/service.py:1146` (D30)
- [x] **§20 / §64 "No duplicate course registration" / "cannot register twice for the same section"** — unique index `uq_enroll_active (offering_id, student_id, semester_id, enroll_active_flag)`
- [x] **§64 "Attendance cannot be entered for a student who is not registered"** — guarded in `app/modules/attendance/service.py:421`
- [x] **§43 Auditor Role** — D43, enforced centrally in `get_current_user`
- [x] **§40 Head of Department Portal** — D43. *One gap check owed: §40 lists 12 HOD functions; I will diff them against what the HOD role actually reaches and report the shortfall in Phase 1.*
- [x] **§9 Admission requirements / Graduation requirements** — columns exist on `programs` (D44). ⚠️ **but they are `varchar(100)`**, which will not hold a requirements paragraph. Widened in Phase 1.

---

## 3. Yellow items that are HALF DONE — storage exists, nothing uses it

| Item | What exists | What is missing |
|---|---|---|
| **§2 System Administrator** | `users.role` enum on disk already accepts `'sysadmin'` (D44 added it as **storage only**) | `app.common.enums.Role` has no member; no route accepts it; no permissions defined. **No SQL needed** — the column is already right. |
| **§14 Semester status** | `semesters.semester_status` column + `SemesterStatus` enum, six values | Nothing reads it. It overlaps `semesters.is_active` and the year's archive state — three answers to "is this term running". Must be reconciled before it drives anything. |
| **§28 Grade Changes — "fix start & end freezing date"** | `midterm_submission_start` / `midterm_submission_end` on `semesters`; freeze logic in `grades/service.py:162` | **INVESTIGATED — see §3a. One real defect found: after the window closes a Lecturer can silently overwrite a pre-window grade with no revision.** |

---

## 3a. §28 freeze investigation — executed against `sims_test`, 8 Sep 2026

Driven end to end through the real HTTP API (not read from the source, and not inferred
from a green suite — `test_midterm_freeze.py` + `test_midterm_revision_rules.py` +
`test_midterm_window.py` + `test_grade_revision.py` are **105 passed** and still miss the
defect below).

| # | Scenario | Result | Verdict |
|---|---|---|---|
| 1 | Before the window opens, enter a grade | `200` | ✅ correct |
| 2a | **Inside `[start, end]`, enter a grade** | `409 midterm_frozen` | ✅ **the freeze works** |
| 2b | Score during the freeze | held at the pre-freeze value | ✅ correct |
| 2c | Revision button during the freeze | `false` / `midterm_window_open` | ✅ correct |
| 2d | Inside the freeze, a brand-new assessment | `409 midterm_frozen` | ✅ correct |
| 3a | After the window, a **pre-window** grade | `can_request_revision = true` | ✅ **the revision appears, as you described** |
| **3b** | **After the window, DIRECT EDIT of that same pre-window grade** | **`200 ACCEPTED`, score moved 11.0 → 19.0** | ❌ **DEFECT** |
| 3c | After the window, a new assessment | `200`, no revision button (`assessment_after_window`) | ✅ correct |
| 4 | Semester 1 frozen, write to Semester 2 | `200` — and Semester 1 still `409` at the same instant | ✅ **the freeze is per-semester, as you asked** |
| 5 | Lecturer files revision → Dean approves | `201` → `200`; `makeup_score = 17.0`, original `score` preserved at 11.0, 2 audit rows | ✅ **the revision workflow works** |

### The defect, precisely

> *"if the assessment was entered before the freeze date then they cant modify those and a
> revision appears beside the grade"*

**The revision appears (3a). Nothing forces its use (3b).** Once the window closes,
`upsert_grades` stops checking anything — `_assert_midterm_not_frozen` raises only while
`start <= now <= end`. So a Lecturer sees the revision button *and* an editable cell, and
the editable cell wins: the mid-term mark can be changed with no Dean approval and no
revision record.

**This is not a design disagreement — it is an unimplemented rule the code already claims.**
`grades/service.py:180` states the intent verbatim: *"After `end` the window is over and
entry re-opens — a new mark goes in normally … while CHANGING one that was entered before
`start` needs the Dean to approve a revision."* The second half was never enforced.

**Second-order effect, worth more than it looks:** the direct edit rewrites `graded_at`,
so `midterm_revision_eligible` rule 3 then fails and the revision button **disappears**.
The evidence that the mark was ever part of the mid-term submission is destroyed by the
same action that changed it. Reproduced: after 3b, filing a revision returns
`422 revision_not_eligible`.

**No existing test pins the wrong behaviour**, so the fix breaks nothing:
`test_after_the_window_closes_entry_reopens` only covers a *new* grade, which must keep
working.

### The fix (Phase 1)
Extend `_assert_midterm_not_frozen` — or add a sibling — so that after the window closes,
`upsert_grades` refuses a write to a cell whose existing grade predates `start` on an
assessment that predates `start`, with a 409 naming the revision path. New cells and
post-window assessments are untouched. The Dean bypass stays. Permanent regression tests
go into `test_midterm_freeze.py::TestInteractionWithRevisions`.

---

## 3b. Prerequisite investigation — executed against `sims_test`, 9 Sep 2026

**Reported:** *"if I remove a course or course offering — not sure which one is for the
prerequisites — it isn't allowing to add students in it. I tested a continuation of a
course then I removed the prerequisites but it didn't help, it says student requires
previous class."*

**Method.** `sims` was copied to `sims_test` (`mysqldump` → restore, 44 tables, 64
`course_prerequisites` rows) and driven through the **real HTTP API** with a Dean token —
never against live `sims`. The one live gated offering in the whole database is
**MATH1210 Pre-Calculus ← MATH1110 Intermediate Algebra**, which is exactly the
"continuation of a course" case described.

| # | Step | Result | Verdict |
|---|---|---|---|
| 1 | `check_eligibility` for all 46 students vs MATH1210 | **6 blocked**, 40 eligible. 4 blocked with *"Taken but not passed (earned F)"*, 2 with *"Not yet taken."* | ✅ the gate discriminates correctly |
| 2 | `POST /offerings/{id}/enrollments` for a blocked student | `409 prerequisite_not_met` — *"Trevaughn Vasquez has not met the prerequisites: MATH1110 (Taken but not passed (earned F))."* | ✅ correct refusal, and it names the grade earned |
| 3 | `DELETE /courses/{id}/prerequisites/{row}` as Dean | `200`; `SELECT COUNT(*)` on a **fresh connection** = `0` | ✅ **the delete persists** |
| 4 | Re-enrol the same blocked student | **`200` — enrolled** | ✅ **removing the prerequisite DOES unblock enrolment** |

> **The enforcement gate is not broken.** Steps 2→4 are the exact sequence reported, and
> the block lifts. What is broken is everything the Dean *sees* around it, below. (One
> false alarm worth recording so it is not re-chased: an early probe appeared to show the
> row surviving its own `DELETE`. That was a stale `REPEATABLE READ` snapshot in the
> long-lived probe session, not a defect. Re-check on a **new connection**.)

### P1 — `courses.prerequisites_text` is never cleared. **This is what you saw.**

`courses` carries a legacy free-text `prerequisites_text`, seeded from the BAJC PDF
(`app/db/bajc_catalog.py`), *alongside* the structured `course_prerequisites` rows. It is
returned by `GET /courses/{id}/prerequisites` and rendered by
`PrerequisitesDialog.tsx:201-207`.

Removing the last structured prerequisite leaves it untouched:

```
GET /courses/{MATH1210}/prerequisites  ->  {"items": [], "prerequisites_text": "MATH1110"}
                                                   ↑ gone            ↑ still says MATH1110
```

So the Dean deletes the requirement, the dialog **still reads "Prerequisites: MATH1110"**,
and the only reasonable conclusion is that the delete did nothing. It is a display
defect, not an enforcement one — `prerequisites_text` is never read by the gate (verified:
its only non-seed readers are `courses/schemas.py` and `courses/service.py`, both display).
Every course in the catalog has one, so this misleads on all 64 gated courses.

- [x] **FIXED (Phase 3A).** ✅ **Decided: clear it automatically.** `remove_prerequisite`
      now nulls `courses.prerequisites_text` when the LAST structured row goes — removing
      one of two leaves it alone, because the text still describes the requirement that
      remains. The old value is written into the `course_prerequisite.remove` audit row
      (§46 wants the previous value anyway, and this is the one destructive step in the
      module). The dialog's caption now reads *"From the printed course sequence — **not
      enforced**"*.

### P2 — the student picker offers students the gate will refuse, and one bad pick kills the whole batch

`GET /offerings/{id}/enrollable-students` returned **33 students including all 6 the gate
blocks**. There is no eligibility filter and no warning badge. Worse,
`_assert_prerequisites_met` (`offerings/service.py:1146`) loops and raises on the **first**
ineligible student *before any row is written* — deliberately, so a batch cannot half-commit.
The consequence: selecting eight students of whom one is short means **nobody is enrolled**,
and the 409 names only that one. That is the literal *"it isn't allowing to add students in it."*

- [x] **FIXED (Phase 3A).** `enrollable-students` returns `eligible` + `ineligible_reason`
      per student. The picker disables those rows, shows a *"Prerequisite not met"* chip and
      the reason **on the row** (not a tooltip — unreachable by touch and by a screen reader),
      and **sorts eligible students first** so the existing 5-row type-ahead cap cannot fill
      with unusable rows. An early `COUNT` on `course_prerequisites` keeps every ungated
      course at its previous cost.
- [x] **FIXED (Phase 3A).** The 409 now names **every** blocked student and says *"…so none
      were enrolled"*. The single-student wording is unchanged, so `test_prerequisites.py`
      still passes. All-or-nothing behaviour is deliberate and is now pinned by a test.

### P3 — there is no reverse view, so it is easy to edit the wrong course

The dialog answers *"what does this course require?"* Nothing answers *"which courses
require this one?"* To open MATH1206 (Calculus 1) for enrolment, the Dean must remove the
rule stored **on MATH1206**. Opening MATH1210 — the previous class, the one the error
message names — shows *its* prerequisite (MATH1110), and removing that changes nothing.
This is precisely *"not sure which one is for the prerequisites."*

- [x] **FIXED (Phase 3A).** `GET /courses/{id}/prerequisites` returns `required_by`, and
      the dialog renders a read-only **"Required by"** section that says explicitly: to let a
      student into one of these, edit *that* course's own dialog, not this one.

### P4 — the seeder resurrects deleted prerequisites

`app/db/seed_bajc.py::_seed_prerequisites` is idempotent on
`(course_id, prerequisite_course_id, program_id)` — it re-creates any row that is absent.
It is **not** wired into app startup (checked: no lifespan seed hook in `main.py`), so it
only fires when run by hand. But a deliberate Dean deletion is silently undone by the next
catalog re-seed, with no record that it was ever removed.

- [x] **FIXED (Phase 3A).** The removal audit row now records the **pair**
      (`prerequisite_course_id` + `program_id`), and `_seed_prerequisites` skips any pair a
      Dean has deleted, reporting *"prerequisite NOT restored — removed by the Dean: MATH1210
      <- MATH1110"*. Rows written before Phase 3A carry no pair and are correctly not matched.

---

## 4. Phases

Ordered by dependency, not by document order. Each phase is independently shippable.

### Phase 0 — Decisions ✅ COMPLETE (8 Sep 2026)
- [x] **C1, C2, C3 — defer.** Where a blue title contains yellow text, the blue title wins:
      those features somewhat exist but not as full modules. This removes **Phase 6**
      (Academic Standing), the timetable half of **Phase 4**, and the graduation/transcript
      rows from **Phase 9**.
- [x] **C4 — option (a).** Head of Department and Office information go on the **`programs`**
      table. No `departments` table. **Phase 10 is dissolved into Phase 1.**
- [x] **§28 investigated** — see §3a. The freeze and the revision workflow both work; one
      defect found in the gap between them, fixed in Phase 1.
- [ ] **C5, C6, C7 still open** — see "What I still need" at the foot of this document.

---

### Phase 1 — The cheap, self-contained ones ✅ COMPLETE (8 Sep 2026)
No new tables. Migration: `backend/db/mariadb/018_d45_phase1.sql` — **you still need to run it against `sims`.**

- [x] **§28 THE FREEZE DEFECT (§3a item 3b).** Refuse a direct edit of a pre-window grade after the window closes; force it through the revision path. Highest priority in this phase — it is a correctness hole in grade custody, not a feature.
- [x] **§8 / C4 — Head of Department and Office information on `programs`.** *(SQL below.)* `program_heads` already links the HOD; this adds the displayed head and the office text the client asked for.
- [x] **§2 System Administrator role.** Add `Role.SYSADMIN`; define what it reaches (user accounts, permissions, configuration, audit — *not* academic records, per §48 least privilege). No SQL — the DB enum already has it.
- [x] **§9 Widen the requirements columns.** `varchar(100)` -> `text`. *(SQL below.)*
- [x] **§24 Assessment weights must total 100%.** Today `grades/calc.py` deliberately never assumes weights sum to 100 — it normalises by whatever they do sum to. The document asks the system to **verify** the total. Add the check at category save time as a **warning surfaced to the lecturer**, not a hard refusal, so an in-progress gradebook is not un-saveable. Calculation behaviour unchanged.
- [x] **§23 Configurable attendance threshold.** Today `ATTENDANCE_ALERT_THRESHOLD` is a constant in `attendance/service.py`. Move it to `school_profile` so BAJC sets it. *(SQL below.)*
- [x] **§55 Search by Programme and Email**, added to the existing student search.
- [x] **§55 "A lecturer should not automatically receive access to every student merely by searching."** Scope search results to the lecturer's own rosters. *This is a security fix, not a feature — it goes in this phase regardless of the rest.*
- [x] **§40 HOD gap check** — diff the document's 12 HOD functions against the role's actual reach; report, then close the gaps found.
- [x] **§42 / §59 "New Applicants" KPI** and the §59 dashboard cards that are already computable (Total Students, New Applicants, Accepted Students, Active Programmes, Courses Offered, Classes This Semester). *"Students At Risk" needs the attendance threshold above; "Graduation Candidates" is blocked by C2.*

**SQL — Phase 1** (save as `backend/db/mariadb/018_d45_phase1.sql`; run **after** the code merges):

```sql
-- §9 - requirements prose does not fit in 100 characters.
ALTER TABLE `programs`
  MODIFY COLUMN `admission_requirements`  text NULL
    COMMENT 'What an applicant needs to get in. Prose, not rules (D44; widened D45).',
  MODIFY COLUMN `graduation_requirements` text NULL
    COMMENT 'What a student needs to graduate. Prose, not rules (D44; widened D45).';

-- §23 - the attendance warning threshold becomes institutional configuration (§57),
-- not a constant in the source. 80 is the document's own example (§23).
ALTER TABLE `school_profile`
  ADD COLUMN IF NOT EXISTS `attendance_alert_threshold` decimal(5,2) NOT NULL DEFAULT 80.00
    COMMENT 'Attendance % at or below which a student is flagged (D45 §23). BAJC policy.';

-- §8 / C4 - Department Management lands on `programs`. BAJC has no departments table
-- and a programme is the unit it actually organises by (D43); these are the two fields
-- §8 highlighted. `program_heads` already carries WHO the head is, so `head_of_department`
-- here is the displayed name for a programme with no appointed head row yet.
ALTER TABLE `programs`
  ADD COLUMN IF NOT EXISTS `head_of_department` varchar(150) NULL
    COMMENT 'D45 §8. Displayed head. The authoritative link stays `program_heads`.',
  ADD COLUMN IF NOT EXISTS `office_information` text NULL
    COMMENT 'D45 §8 - office location / hours / contact. Free text, the college''s own words.';
```

---

### Phase 2 — The two status vocabularies (§7.5 + §19) ✅ COMPLETE (8 Sep 2026)
Migration: `backend/db/mariadb/019_d45_status_vocabularies.sql` — **you still need to run it against `sims`.**

The document asks for eight statuses. The system has four, and D35 built real GPA meaning
into two of them. **Flattening W-P and W-F into one "Withdrawn" would silently change GPAs.**

**DECIDED (C6): take the document's eight exactly, not the union I proposed.**

⚠️ **Recorded consequence, so nobody rediscovers it in six months.** Collapsing
`withdraw_passing` / `withdraw_failing` into one flat `withdrawn` **removes the D35 rule
that a withdrawal-passing leaves the GPA alone while a withdrawal-failing counts as a
fail.** No data is lost — both values have zero rows today — but the *capability* goes.
Every GPA path that keys off those two values must be re-pointed at a single `withdrawn`,
and how a withdrawal then affects the GPA becomes a **Phase 5 configuration question**,
which is where §29 puts it anyway ("Rules for repeats, withdrawals, incompletes … should
be configurable according to BAJC policy"). Phase 2 must not ship before that is understood.

**§7.5 student statuses (C5) ride in this phase**, because they are the same kind of
change to the same kind of column and splitting them would mean two migrations over the
same screens.

| Document (§19) | Proposal |
|---|---|
| Pre-registered | `pre_registered` — new |
| Registered | `registered` — **renames the current `enrolled`** |
| Added | `added` — new |
| Dropped | `dropped` — new (before add/drop deadline; leaves no transcript trace) |
| Withdrawn | `withdrawn` — **one flat value**, per C6. Replaces `withdraw_passing` + `withdraw_failing`. |
| Completed | `completed` — new |
| Failed | `failed` — new |
| Audit | `audit` — exists |

**§7.5 student statuses (C5) — the mapping, and the one value with no home:**

| Today (D34) | Blueprint §7.5 |
|---|---|
| `Registered` | `Active` |
| `Unregistered` | `Inactive` |
| `DropOut` | `Dropout` |
| `graduated` | `Graduated` |
| `withdrawn` | `Withdrawn` |
| **`transferred`** | ⚠️ **no equivalent in the ten.** |
| — | `Applicant`, `Accepted`, `Suspended`, `Completed`, `Alumni` are all new |

⚠️ **`transferred` must be answered before this phase starts.** The blueprint's ten have
no "transferred" and it is a real state BAJC records today. Map it to `Withdrawn`, keep it
as an eleventh value, or migrate the rows individually — a wrong guess silently rewrites a
student's history.

- [x] C6 decided — the document's eight, flat.
- [x] `transferred` — **kept as an eleventh value** (client, 2026-09-08).
- [x] `enrolled` -> `registered` is a **rename** (client, 2026-09-08) (my recommendation; 393 rows, one enum, mechanical in code) or whether `enrolled` stays as a synonym.
- [x] ~~**Re-derive `enroll_active_flag`.**~~ **NOT NEEDED — checked.** The generated column is `if(unenrolled_at is null, 1, NULL)` and all 33 roster reads filter on `unenrolled_at IS NULL`. Nothing keys a seat off `enrollment_status`, so `uq_enroll_active` is untouched by any of this. A `ROSTER_OCCUPYING_STATUSES` set was written and deleted again — it would have had no callers and would have decided a §20 capacity rule by accident. `uq_enroll_active` depends on which statuses count as "occupying a seat". Adding six statuses changes that answer and it must be decided explicitly, not inherited.
- [x] Updated `EnrollmentStatus`, the GPA rules, the roster UI and the D35 suite.

**SQL — Phase 2** (`019_d45_registration_status.sql`) — **two steps, in this order.**
All 393 current rows are `enrolled`; the other three values have zero rows, so the data
migration is a single safe `UPDATE`.

```sql
-- Step 1 - widen first, so both old and new labels are legal at once.
ALTER TABLE `class_enrollments`
  MODIFY COLUMN `enrollment_status`
    enum('enrolled','audit','withdraw_passing','withdraw_failing',
         'pre_registered','registered','added','dropped','completed','failed')
    NOT NULL DEFAULT 'registered'
    COMMENT 'D45 §19 - transitional: carries the pre-D45 labels and the new ones together.';

-- Step 2 - remap, then narrow. RUN ONLY AFTER STEP 1 AND AFTER THE CODE IS MERGED.
UPDATE `class_enrollments` SET `enrollment_status` = 'registered'
 WHERE `enrollment_status` = 'enrolled';

ALTER TABLE `class_enrollments`
  MODIFY COLUMN `enrollment_status`
    enum('pre_registered','registered','added','dropped',
         'withdraw_passing','withdraw_failing','completed','failed','audit')
    NOT NULL DEFAULT 'registered'
    COMMENT 'D45 §19. `withdrawn` is deliberately TWO values - D35: W-P leaves the GPA alone, W-F counts as a fail.';
```

**Before Step 2, this must return zero rows:**
```sql
SELECT `enrollment_status`, COUNT(*) FROM `class_enrollments`
 WHERE `enrollment_status` = 'enrolled' GROUP BY `enrollment_status`;
```

---

## 4a. Meeting #5 (9 Sep 2026) — what changed

| Change | Effect on this plan |
|---|---|
| **Curriculum Management is removed.** | **Phase 3 is deleted**, not deferred. The `curriculums` / `curriculum_requirements` tables are not being built, `student_program_history` gains no version column, and the 243 `program_courses` rows stay as they are. Anything that depended on it must be re-based on `program_courses` — see Phase 8. |
| **Timetable Management is back in scope**, Dean-only. | It was blue (do-not-build) and deferred with C3. It is now **Phase 10, the last phase**. §5's blue list is corrected below. |
| **Anything that needs, or falls under, timetabling goes in that same phase.** | The §20 *"no timetable conflict exists"* registration check and §18 conflict detection move OUT of Phase 4 and INTO Phase 10, where the editor that creates the conflicts also lives. |
| **"Term" must read "Session" in the UI.** | New **Phase 3A**, with the prerequisite UX defects from §3b. |

Phase numbers are **kept as they are** so every earlier reference in this document, in
`docs/progress-tracker.md` and in commit messages still resolves. Phase 3 stays in place
as a tombstone; **Phase 3A** occupies its slot in the running order.

---

## 4b. Client feedback, 10 Sep 2026 — five items, all done

Five asks arrived after Phase 9 landed. Four are corrections to this cycle's own output;
the fifth is the client checking a rule they could not see working. **Three of the five
turned out to be real defects, and one of those is a hole this document argued shut in
Phase 7 while leaving the older door open.**

| # | The ask | Verdict |
|---|---|---|
| 1 | *"you did audit trail and there is an audit log, what's the difference, if there is not a difference make just one with detailed information"* | ✅ **No real difference — two screens onto ONE table.** Merged. And the difference that did exist was a hole, not a feature: see below. |
| 2 | *"in the audit trail the collapsable show details/hide details doesn't work, it doesn't collapse"* | ✅ **Real defect.** The disclosure was opening onto an empty box on a whole class of row. Fixed, and the class of bug is now impossible to reintroduce. |
| 3 | *"for course nav bar remove the arrow… when i click course, course offering opens below but it shows the courses in the screen"* | ✅ Done. The arrow is gone; the parent link is the disclosure. |
| 4 | *"for now hide college reports, don't delete, it will be shown later"* | ✅ One constant, `SHOW_COLLEGE_REPORTS = false`. Nothing is deleted; the route stays mounted. |
| 5 | *"why can i add students to a course offering if they haven't taken the class it requires before… check if the class was passed or failed"* | ⚠️ **The real backend was already right, including pass-versus-fail. The DEMO was not.** Three parity defects fixed. |
| 6 | *"do the audit trail filter as students (search bar + filters button)… audit trail just the search"* | ✅ Done. Same pattern, same parts, and the toolbar had the same problem the students directory had. |

---

### 6 — the audit trail's filters move into a modal

The toolbar carried **six** controls in one `flex-direction: row`: report, area, person,
from, to and search. At `sm` and up they squeezed below their `minWidth` or wrapped into a
ragged block that pushed the entries below the fold; on a phone they stacked into six
full-width controls the reader had to scroll past **before reaching a single audit entry**.

That is the identical problem D33 solved on the students directory when D32 took its
`FilterBar` from three controls to eight, and this is the identical fix, built from the
same parts on purpose:

* `components/auditFilters.ts` — the value object, its empty form and
  `activeAuditFilterCount`, split out so the dialog file exports only a component (React
  Fast Refresh, the same seam `studentFilters.ts` uses).
* `components/AuditFiltersDialog.tsx` — full screen below `sm`, two columns above,
  **draft-local and committing only on Apply**. Every filter change used to fire its own
  request: pick a report, then a person, and the server answered twice for a question the
  auditor was still in the middle of asking. Batching also makes Cancel mean something.
* The toolbar: search + one badged **Filters** button, with removable chips underneath and
  *Clear all*.

**Search stays out of the modal**, in the toolbar, debounced — putting the one control
people use constantly behind an Apply button makes it the slowest one to use. That is what
*"audit trail just the search"* asks for and it is also `studentFilters.ts`'s own stated
reason for excluding it.

Two details worth keeping: the chips name filters in the **auditor's** words — the report's
name, not its key; the person's name, not their id, because a chip reading
`registration_overrides` explains nothing about why the list is short — and the two dates
**count separately** in the badge, since "from 1 September" and "1–30 September" are
different questions and a reader surprised by a row count needs both ends accounted for.

---

### ⚠️ 1 + the finding — the two audit screens were one table, and the older door was wider

`GET /settings/audit-log` (D43) and `GET /audit` (D45 Phase 7) read **the same
`audit_log` rows**. The only difference was rendering:

| | `/settings/audit-log` (D43) | `/audit` (Phase 7) |
|---|---|---|
| What it showed | `grade.update` · `assessment_grade` · `f84c4f15-…` · `{"entries": 3}` | *"Alicia Cano changed the grade for Fernando Perez (S-25035) on Quiz 1: score 17 to 9."* |
| Module, IP, before/after | ❌ | ✅ |
| **Who could read it** | Dean, Auditor, **System Administrator** | Dean, Auditor |

**That last row is the finding.** Phase 7 refused the System Administrator on `/audit`
deliberately and at length — this trail is *mostly academic records*, grade changes
carrying student names and marks, and §48 is explicit that being an employee is not a
reason to see them. Phase 7's own write-up records the central `technical_role_scope`
guard refusing the role and concludes *"the guard was right and the route was wrong"*.

It was right about `/audit`. Nobody checked the other door. `/settings` is on the
sysadmin's technical allowlist, so the same rows — unrendered, with the ids and the JSON —
stayed reachable at `/settings/audit-log`, and Phase 1 had widened that gate to include
`Role.SYSADMIN`. **Two routes onto one table, and the security decision was applied to
one of them.** `test_d45_sysadmin_role.py` even asserted the sysadmin could read it; that
test is now inverted, with the reasoning written into it, because it was encoding the
contradiction rather than a decision.

**The merge, and what survived it.** Deleting the raw screen would have lost two things
an auditor legitimately used it for, so both moved across, translated:

* **`record`** — WHAT KIND of record it was. `entity_type` raw is `assessment_grades`; the
  screen now says **"Grade"**. Two rows can read as the same sentence and be about
  different kinds of record, so this is real information — it just must never be a table
  name. ⚠️ An unmapped type comes back as a flat **"Record"**, NOT a prettified version of
  itself: `class_enrollments` humanised to "Class enrollments", which is a table name with
  a capital letter on it. The fallback fails closed.
* **`reference`** — **"Entry #4821"**, a handle an auditor can quote in a note. This is the
  legitimate need the old screen was serving badly by showing a UUID. It is the row's own
  autoincrement id and no endpoint accepts one.

And **`details`** is a third thing *neither* screen was showing properly. The raw one
buried it in JSON; the narrative one consumed the two or three `summary` keys its sentence
needed and dropped the rest. So a Dean's prerequisite waiver recorded **which** rule was
waived and **which** requirement — both in `summary`, both in `_HIDDEN_KEYS` — and no
screen ever said. It now reads:

> Rule waived — **Course prerequisite**
> Requirement — **MATH1110 (Taken but not passed (earned F))**

`details` is an ALLOWLIST (`narrative.DETAIL_LABELS`), not the inverse: a summary can hold
whatever a call site put there, and rendering everything unlisted would eventually surface
a key nobody meant an auditor to read. Values go through the same `_render_value` the
before/after table uses, so a bare id becomes "changed" rather than leaking.

**What is gone:** `GET /settings/audit-log`, `settings/service.list_audit_log`,
`AuditLogItem`, the Settings → Audit log screen, `useAuditLog`, the MSW handler and its
`demoAuditRows()` synthesiser. The route answers **404**, not 403 — a 403 would mean it
still exists and the next person to widen a role tuple reopens it. Pinned by a test.

**⚠️ Consequence to be aware of: the System Administrator now has NO audit visibility at
all.** That is the correct reading of §48 and it is what Phase 7 decided; it is also a
reduction from what they had yesterday. If BAJC wants them to see *system activity only* —
accounts, roles, configuration, no academic module — that needs an endpoint filtering
BEFORE the academic rows load, which is already recorded as §7 item 14 and is a small
piece of work. Adding the role back to the surviving gate is **not** the way: it would
hand them every grade change in the college in one screen.

**Observation, not fixed.** With `record` on screen, one existing row now visibly reads
oddly: *"Alicia Mendez — account role changed"* filed under **Programme**. That is
faithful — D43's "appointing a head grants the role" writes the role change against the
programme entity — but the row describes a user and points at a programme. It is a
write-path shape, not a rendering bug, and changing what an audit row stores was outside
this ask.

---

### ⚠️ 2 — the disclosure was opening onto nothing

`EntryCard` offered "Show detail" when:

```ts
entry.changes.length > 0 || Boolean(entry.reason) || Boolean(entry.ip_address)
```

but the **reason is rendered above the collapse**, always visible, and was never inside
it. So on a row whose only extra was a reason — **which is every Dean override**, the most
important row on the screen — the button appeared, opened an empty `Collapse`, and
toggling it changed nothing but its own label. The collapse was working perfectly; there
was nothing in it.

The fix is one expression, and the rule behind it is the part worth keeping: **that
condition must name exactly what the Collapse renders, and nothing else.** It now reads
`changes.length || details.length || ip_address`, which is precisely the three things
inside. A disclosure that can open onto nothing teaches the auditor to stop opening them,
which is worse than not offering one.

The reason stays outside and always visible — it is the *"citing a change request"* half
of §46's example and it should not need a click. `reference` joined it there for the same
reason: an auditor quoting a row should not have to hunt for its handle.

---

### 3 — the Courses group opens itself

The chevron beside **Courses** is gone. Clicking Courses navigates to `/courses` **and**
reveals Course offerings beneath it; clicking Course offerings opens that.

D44's reasoning for a separate control was that clicking the LABEL must still navigate,
and folding the two together would turn a real destination into a toggle. That argument
was sound and the conclusion was still wrong **for this nav**, because Courses has exactly
one child: the arrow existed to reveal a single row that the click was about to make
relevant anyway. It was a control whose only job was to be pressed immediately after the
one beside it.

An open group is now purely a function of the route, so the `Record<path, boolean>`
expansion state is gone too — there is nothing left to get out of step with the URL.
`aria-expanded` / `aria-controls` moved onto the parent link, which is now the disclosure.
The cost: a group cannot be collapsed while you are inside it. Nobody wanted that state,
and there is one line to collapse.

---

### 4 — College reports is hidden, not removed

```ts
const SHOW_COLLEGE_REPORTS = false;   // features/reports/index.tsx
```

Flip it to `true` and the tab returns. Everything behind it is intact and tested — the
screen, four hooks, four API functions, the demo handlers, 80 backend tests. **The route
stays mounted deliberately:** `/reports/college` still resolves for anyone with the link,
so the client can look at it before it is shown. Un-mounting it would have meant a 404 for
whoever asked. The server-side gate is unchanged and is the real boundary either way —
hiding a tab is UX, not access control.

---

### ⚠️ 5 — the rule was enforced; the DEMO was the thing that was not

**The real backend already refuses this, and already tells pass from fail.** Driven
against `sims_test` (a fresh copy of `sims`) through the real HTTP API, the picker for
`MATH1210-01` — which requires `MATH1110` — returned 33 candidates and barred four, with
the distinction the client asked for already in the message:

```
BARRED  S-25020  Colin Gongora       prerequisites :: MATH1110 (Taken but not passed (earned F))
BARRED  S-25013  Shanice Tzul        prerequisites :: MATH1110 (Taken but not passed (earned F))
BARRED  S-25016  Trevaughn Vasquez   prerequisites :: MATH1110 (Taken but not passed (earned F))
BARRED  202608006 Arturo Hernandez   prerequisites :: MATH1110 (Not yet taken)
```

Both doors are gated — `POST /offerings/{id}/enrollments` and the `offering_ids` path on
student create/edit — and every one of the 29 eligible candidates does hold a pass in
`MATH1110`. `POST` was driven for a blocked student and answered 409.

**There are two ways to still see the behaviour the client reported, and one of them is
ours.**

*(a) The Dean can override, by design.* §12/§20, Phase 4: a barred student stays
selectable for a Dean, who must type a reason that is written to `audit_log` as
`enrollment.override`. That is not a bug — it is the feature BAJC asked for — but it does
mean a Dean clicking through a warning and a reason box can add a student who has not
passed, which is exactly what the message describes. Worth knowing it was a waiver.

*(b) In DEMO mode there was no check at all.* Three parity defects, all fixed:

1. **The picker hardcoded `eligible: true` for everybody.** The comment said *"the demo has
   no grade history to judge against, so the FIELDS are what matter"* — the fields did
   render, and the answer was always yes. So every student looked addable to every class,
   including one they had failed the prerequisite for. The premise was wrong too: the demo
   has `assessment_grades` and a grading scale, and `unmetPrerequisites` was **already
   being called on the POST** — the picker simply never asked it. **This is the fifth
   recorded case in this project of the demo certifying behaviour the backend does not
   have.**
2. **The reason was a flat `'not passed'`** for both cases — the one distinction the client
   asked about. `passedCourseIds` returned a `Set` of passes, and a set cannot tell "never
   took it" from "took it and failed". A new `courseResultsFor` keeps the letter and the
   pass flag, and the wording is now the server's verbatim: **"Not yet taken."** /
   **"Taken but not passed (earned F)."** An enrolment with no computable letter yields no
   result rather than a failure, matching the server — an ungraded course in progress must
   not read as a fail.
3. **The demo ignored `override` entirely and had no status rule**, so it refused a waiver
   the server accepts, and let through a graduate the server refuses. Both now mirror the
   server, Dean-only, reason required. The 409 also names **every** blocked student instead
   of returning on the first — the same defect §3b P2 fixed on the server.

#### Verification

* **24/24 through the real HTTP API** against `sims_test` for the audit merge: one door,
  the deleted one 404s for Dean / Auditor / Sysadmin, `/audit` 403s for Sysadmin and
  Registrar, every row carries `record` + `reference`, and the nine banned technical
  tokens plus every UUID are still absent from the raw body.
* **+7 permanent backend tests** (`TestTheTwoScreensMerged`), including the unmapped-type
  fallback, the reason-only override row that exposed the disclosure defect, and an id
  planted in `summary` to prove `details` cannot leak one.
* **The demo prerequisite logic was EXECUTED**, not just typechecked: the demo layer has
  exactly one path alias and it is type-only, so `tsc` to CommonJS and `node` runs it. Over
  all 63 course-to-course gates × every demo student: 2,483 "Not yet taken", 75 "Taken but
  not passed (earned …)", zero occurrences of the old flat wording, and every blocked
  reason matching one of the two server strings.
* Frontend `tsc -b --force` clean, `eslint` 0 errors.
* **Verified by execution after all** — `frontend/scratchpad/probe_d45_dean_and_prereq.mjs`
  (38/38) drives the real MSW handlers: one audit door, the sysadmin and the Registrar
  refused, every row carrying `record` / `reference` / `details`, the waived rule present in
  `details`, and **no entry left in the shape that used to open an empty disclosure**. The
  enrol gate too: the picker bars 3 of 29 with "Taken but not passed (earned F)", the POST
  refuses them, a Registrar's override is refused 403 and the Dean's is honoured.
  ⚠️ What is genuinely not verified is the LOOK of the two screens — that needs eyes on a
  browser, not a runtime. (An earlier version of this section said the machine could not run
  `vite dev` at all. It can; see §0.)

---

### ~~Phase 3 — Curriculum Management (§3 module 5, §10)~~ — ❌ **REMOVED (Meeting #5, 9 Sep 2026)**

Dropped by the client. **Not deferred — removed.** No curriculum-version model will be
built: no `curriculums` table, no `curriculum_requirements`, no version stamp on
`student_program_history`, no migration of `program_courses`.

⚠️ **The consequence, recorded so it is not rediscovered as a bug.** §10's premise was
*"a student admitted under ASIT-2026 should continue to be evaluated according to that
curriculum."* Without versioning, a programme's course list stays **a single moving
target**: editing it re-evaluates every past and present student on that programme at
once. That is now accepted behaviour, not a defect. It also permanently blocks the §10
"Electives ??" question (C7) — there is nothing left for the answer to configure.

---

### Phase 3A — Terminology sweep + the prerequisite UX defects (Meeting #5) ✅ COMPLETE (9 Sep 2026)
No migration. Frontend-heavy; the one backend change is the `enrollable-students` payload.
**This is the phase to start with** — it is small, self-contained and unblocks nothing else.

**(a) "Term" becomes "Session" in user-visible copy.**
Most of this already happened: `TermPicker`'s default label is already `'Session'`, and
`shared/api/errorMessages.ts` already overrides the server's three `midterm_*` messages to
say *"mid-session"*. The stragglers are the ones a grep for a bare `term` hides among the
comments and the `strings.terms.*` i18n namespace (which is *terminology*, not academic
terms — **do not rename that key**).

Confirmed user-visible occurrences still to change:

- [x] `OfferingListPrintDialog.tsx` — the printed column header `Term` → `Session`.
- [x] `GradeRevisionsScreen.tsx` — *"the student's term grade"*, *"the term's
      grade-submission deadline"*.
- [x] `TranscriptDocument.tsx` — *"No recorded grades for this term."*
- [x] `PrerequisitesDialog.tsx` — *"neither is taking it in the same term."*
- [x] ~~`ReportCardScreen.tsx:106`~~ — **correction: that line is a CODE COMMENT, not
      user-visible copy.** Listed in error when this plan was written. Left as it is.
- [x] **Q9 answered — `Semester` → `Session` as well.** `strings.terms.semester/semesters`
      are now `Session`/`Sessions`, and `ReportCardDocument`'s printed row label follows.
- [x] Sweep re-run, skipping comments, the `strings.terms.*` namespace, `search term`,
      `term_type`/`termType` and `term_grade`/`termGrade`. Wire names untouched, so the
      generated API client and the suite are unaffected.

⚠️ **Two residues to be aware of, neither a code change.**
1. **`semesters.name` still holds "Semester 1" / "Semester 2" — that is DATA, not copy.**
   Four rows in `sims`, plus ~133 references across the backend and the demo fixtures. The
   screen therefore reads *Session: **Semester 1***. The **create-year form now defaults new
   ones to "Session 1"/"Session 2"**, so anything created from here on matches. Renaming the
   four existing rows is optional and is a one-liner you run yourself:
   ```sql
   -- OPTIONAL. Display text only; `sequence` and `id` are what anything keys on.
   UPDATE `semesters` SET `name` = REPLACE(`name`, 'Semester', 'Session')
    WHERE `name` LIKE 'Semester %';
   ```
   ⚠️ Backend tests that assert the literal string "Semester 1" would need updating with it,
   which is why this is not bundled into a migration.
2. **Curriculum "blocks" deliberately keep the word.** `ProgramCourseDialog`'s example text
   (*"Summer 1", "Semester 3", "Spring 2"*) names a POSITION IN A PLAN, not a calendar
   session — `ProgramCurriculumScreen` says so explicitly. Renaming it would collapse a
   distinction the curriculum screen depends on.

⚠️ **One decision needed — see §7 item 9.** The dictionary currently says
`strings.terms.semester = 'Semester'`, and that word is on the offerings list header, the
offering form and the report screens. So the UI will still show three words for one thing:
**Semester** (dictionary), **Session** (picker + freeze errors), **Term** (the stragglers
above). Fixing only "term" leaves two. **Should `Semester` become `Session` as well?**

**(b) The §3b prerequisite defects — all four fixed.** P1 (stale `prerequisites_text`),
P2 (picker + batch 409), P3 ("Required by"), P4 (the seeder). Detail and checkboxes are in
§3b.

**Verified by EXECUTION, not by a green typecheck** — 16/16 assertions driven through the
real HTTP API against a fresh `sims_test` copy of `sims` (taken *after* you ran `018` and
`019`; the copy confirmed both are live — `attendance_alert_threshold` present,
`enrollment_status` is the flat 8 with `withdrawn`):

| Check | Result |
|---|---|
| `required_by` reports the reverse edge both ways | ✅ MATH1110 → gates MATH1210; MATH1210 → gates MATH1206 |
| picker flags ineligible students with a reason | ✅ 4 of 33 flagged, *"MATH1110 (Taken but not passed (earned F))"* |
| batch 409 names every blocked student | ✅ *"2 students … so none were enrolled: Trevaughn Vasquez — …; Damian Martinez — …"* |
| `prerequisites_text` cleared on the last removal | ✅ `"MATH1110"` → `null` |
| the cleared text is kept in the audit | ✅ in the `course_prerequisite.remove` summary |
| the same batch enrols once the rule is gone | ✅ 409 → 200 |
| re-running the catalog seeder | ✅ **does not restore it**, and says so |

> 💡 The reverse-view check found the real thing in passing: **MATH1210 Pre-Calculus gates
> MATH1206 Calculus 1.** That is the exact trap P3 exists for — the Dean opens Pre-Calculus
> because the error names it, and removes a requirement that gates nothing.

Permanent regression suite: `backend/tests/test_d45_phase3a_prerequisite_ux.py`.
Frontend: `tsc -b --force` clean.

---

### Phase 4 — Registration validation completion (§20) ✅ COMPLETE (9 Sep 2026)
No migration — the override is a request field and an `audit_log` row, both of which exist.

- [x] ~~**§20 "No timetable conflict exists"** / §18 conflict detection~~ — **MOVED TO PHASE 10** (Meeting #5). C3's loose end (§20 yellow, §18 blue) is resolved by that move.
- [x] **§20 "???" — ANSWERED (BAJC, 9 Sep 2026).** Overridable: **the prerequisite rule and
      the student-status rule.** **Not capacity** — it is warn-only today (the enrol succeeds
      and returns `over_capacity_warning`), so there is nothing to override; making it
      overridable would first mean making it a *refusal*, which is stricter than BAJC asked
      for. **Authority: the Dean alone** (D30 §D14 — the Registrar runs registration, but
      waiving an academic rule is an academic-structure decision).
- [x] **§12 "or require an authorized override", and every override logged.** `POST
      /offerings/{id}/enrollments` takes an optional `override {prerequisites,
      student_status, reason}`. `reason` is REQUIRED (min 5 chars) — a waiver with no stated
      cause is not an audit record, it is a hole with a name on it. Each waiver **actually
      used** writes one `audit_log` row per student per rule (`enrollment.override`), naming
      the rule, the detail, the reason, the student and the offering. An override that
      nothing needed writes nothing.
- [x] **The Registrar gets 403 `override_not_permitted`** but can still enrol normally.
- [x] **The picker can show barred students on request** (`?include_ineligible=true`, Dean
      only, silently ignored for the Registrar). Without this the status override existed
      only for whoever hand-writes the HTTP request — a student filtered out of the list
      cannot be overridden from the UI. Rows carry `ineligible_rule`, so the client waives
      the rule that actually bars them rather than blanket-waiving both.

#### ⚠️ A restriction had to be BUILT before it could be waived — §20 student status

**The status rule was never enforced at the API.** `enrollable_students` filtered the
PICKER to `Active` and everyone (this plan included) assumed that was the rule.
`enroll_students` checked `deleted_at` and nothing else.

Verified by execution against a copy of `sims`:

```
UPDATE student_profiles SET status='Graduated' ...
GET  /offerings/{id}/enrollable-students   ->  student ABSENT from the picker
POST /offerings/{id}/enrollments           ->  200 ENROLLED
```

**A filtered dropdown is not an access rule.** Phase 4 adds the real gate (409
`student_not_enrollable`), at **both** doors — the offerings endpoint and
`students/service.py`'s `offering_ids` path, which enrols without ever touching the
offerings endpoint. The prerequisite gate was already duplicated there for exactly this
reason.

`ENROLLABLE_STATUSES` is **`Active` alone**. `Accepted` was considered and left out: an
accepted applicant becomes `Active` when the Registrar marks the application enrolled, and
*that* step creates the programme placement. Registering earlier produces a roster row for
someone with no programme to be assessed against — so if BAJC wants it, it should be a
deliberate override with a reason, which is exactly what now exists.

#### ⚠️ The line this phase does not cross

`year_archived` and `semester_mismatch` are **not overridable and must never become so.**
They are integrity invariants, not academic policy: an enrolment in an archived year, or in
a term the offering does not run in, produces a row no screen can explain and no report can
attribute. A waiver is for a rule the institution may *choose* to set aside, not for a
contradiction in the record. Pinned by a test.

**Verified by EXECUTION** — 16/16 through the real HTTP API against a fresh `sims_test`,
plus **22 permanent tests** in `backend/tests/test_d45_phase4_registration_override.py`:

| Check | Result |
|---|---|
| a Graduated student is refused (the rule that did not exist) | ✅ 409 `student_not_enrollable` |
| every non-Active status barred (6 parametrised) | ✅ |
| prerequisites still refuse without an override | ✅ 409 |
| the Registrar cannot override | ✅ 403 `override_not_permitted` |
| ...but can still enrol normally | ✅ 200 |
| no reason / a 2-character reason | ✅ 422 |
| the Dean waives the prerequisite for 2 students | ✅ 200, **2 audit rows**, actor = the Dean |
| the rule stays in force for the next student | ✅ 409, and the requirement row is untouched |
| waiving one rule does not waive the other | ✅ `prerequisites:true` still bars a graduate |
| an override nothing needed | ✅ **no waiver logged** |
| `semester_mismatch` with both flags set | ✅ still 409, no waiver |

Frontend: the enrol dialog gives the Dean a barred-students switch, selectable barred rows,
a required reason field and an **"Override and add N students"** submit; the Registrar keeps
the read-only explanation. `tsc -b --force` clean.

> 💡 This closes the loop on the original report. The Dean who *had* decided a student could
> proceed previously had no route but to delete the prerequisite **for the whole college** —
> which is exactly what happened, and is what sent us looking at prerequisites in the first
> place. There is now a route that affects one student and signs it.

---

### Phase 5 — GPA and repeat rules become configurable (§29, §31) — needs C7
- [ ] **§29** Configurable treatment of: repeats, withdrawals, incompletes, transfer courses, failed courses.
- [ ] **§31** The repeat rule specifically — highest attempt, last attempt, or all attempts averaged. *Every attempt is already retained; what is missing is the rule that decides which one counts.*
- [ ] Stored in system settings (§57), not in code — §74: *"Developers should never design academic rules based purely on assumptions."*

⚠️ This phase **changes GPA numbers**. It must not ship in the same release as anything
else, and it needs a before/after comparison across all 46 students on `sims_test`.

---

### Phase 6 — Academic Standing (§30) — ❌ **DEFERRED (C1 answered: blue title wins)**
Good Standing / Warning / Probation / Suspension / Dean's List, configurable, recalculated
after grades are finalised, with history retained. Depends on Phase 5.

---

### Phase 7 — Audit Trail enrichment (§46) + §53 Audit Reports ✅ COMPLETE (9 Sep 2026)
Migration: `backend/db/mariadb/020_d45_audit_trail.sql` — **you still need to run it against `sims`.**

**Your brief, on top of §46:** *"I need a detailed description, not how it is right now.
Who did it, when, and everything an auditor might ask that we can show. They should not
see technical stuff — just academics."* That, not the four columns, is what shaped this
phase.

#### What §46 asked for, and what was actually there

| §46 field | Before | Now |
|---|---|---|
| Who | ✅ `actor_user_id` | ✅ resolved to a **name and a display role** ("Alicia Cano (Lecturer)") |
| When | ✅ `created_at` (UTC) | ✅ rendered **dd/mm/yyyy + time, America/Belize**, server-side |
| Module | ❌ absent | ✅ `module` — the FUNCTIONAL area, distinct from `entity_type` |
| IP address | ❌ absent | ✅ `ip_address`, proxy-aware, NULL when there was no request |
| Previous value | ❌ absent | ✅ `previous_value` |
| New value | ❌ absent | ✅ `new_value` |

#### ⚠️ §46's worked example was NOT reproducible — the real finding

The blueprint's example is *"a final grade going C+ → B, citing a change request"*. The
stored row for the single most important auditable event in a college was:

```
action=grade.update   entity_type=grade   entity_id=f84c4f15-…   summary={"entries": 3}
```

`{"entries": 3}` is the **count of cells touched**. No student, no mark, no previous
value, no way to tell which of the three actually moved. Nobody can audit that — and, more
to the point, nobody can **challenge** it, which is what an audit trail is for.

`upsert_grades` now emits **one row per student whose mark actually moved**, carrying the
score, the letter, the status and the assessment, before and after. Unchanged cells emit
nothing: re-saving a gradebook is the commonest action in the system, and a "change" per
untouched cell would bury the real edits under thousands of rows saying nothing happened.
The batch row is kept too, so "the lecturer saved the gradebook" remains one findable
event rather than only its consequences.

#### How all 83 audit actions got `module` and `ip_address` without 83 edits

A `before_insert` listener on `AuditLog` derives `module` from the action and takes the IP
from a request-scoped `ContextVar` set in the existing outermost middleware. **This was
not a shortcut — it is the only way the columns can be trusted.** A field every caller
must remember to set is a field that is right in most rows and silently absent in the ones
nobody thought about, and an audit trail with holes in it is worse than one without the
column, because the holes are invisible.

`previous_value` / `new_value` are the opposite case and ARE set per call site: only the
writer knows what a value was before it changed.

#### The auditor sees the college, never the database

Every row is rendered server-side (`app/modules/audit/narrative.py`) into a sentence, a
named person, a Belize-local timestamp and a before/after table with a registrar's field
names. **No id, no table name, no dotted action key and no JSON reaches the client** — the
frontend `types.ts` is deliberately unable to express a technical field.

What the auditor actually sees, taken verbatim from the verification run:

> **09/09/2026 at 11:43 PM** · Grades · *Grade changed*
> **Alicia Cano changed the grade for Fernando Perez (S-25035) on Quiz 1: score 17 to 9,
> letter grade B+ to F.**
> Score **17 → 9** · Letter grade **B+ → F** · by Alicia Cano (Lecturer)

and for a Phase 4 override, with the reason §46 calls "citing a change request":

> **Alicia Mendez overrode the prerequisite requirement to register Trevaughn Vasquez
> (S-25016) in Pre-Calculus (MATH1210-01) — MATH1110 (Taken but not passed (earned F)).**
> *Reason given: Sat and passed the August make-up examination.*

- [x] **IP address** (§46, "where appropriate") — NULL outside an HTTP request, deliberately: a fabricated `127.0.0.1` is worse than a blank, because an auditor cannot tell an invented address from a real one.
- [x] **Module**, distinct from `entity_type`. The three `offering.*` registration actions are filed under **Registration**, not Course offerings — seating a student and scheduling a class are different institutional acts with different auditors.
- [x] **Previous / New value** as structured columns, not prose inside `summary`.
- [x] **The §46 worked example is reproducible from the log alone.**
- [x] **§53 Audit Reports** — Grade changes, Student record changes, Registration overrides, System activity. *("Transcript issuance" is §53's fifth and is deliberately absent: transcripts deferred with C2, and a report over an action nobody emits is an empty screen that looks like a fault.)*
- [x] Frontend **Audit trail** screen (Insights → Audit trail): report / area / person / date-range / search filters, expandable before-and-after per entry, the reason shown in full.
- [x] Rows written before this migration have no before/after — the screen **says so** rather than showing an empty change table that reads as "nothing changed".

#### ⚠️ Two access decisions, one of which corrected itself

**The System Administrator is NOT given the audit trail, and the attempt to give it to
them is what settled the question.** The route initially listed `Role.SYSADMIN` on the
reasoning that an audit log is administrative — and Phase 1's central `technical_role_scope`
guard refused it. It was right: this trail is *mostly academic records* (grade changes with
student names and marks, registrations, status changes), and §48 spent Phase 1 keeping that
role out of exactly those. Handing them the whole trail would have returned it in one
screen. The guard was right and the route was wrong.

**The Registrar is also excluded.** They are the most frequent *subject* of this log, and a
subject who can read it is a subject who can see what has been noticed. Worth revisiting
with BAJC — see §7 item 13.

**SQL — Phase 7** (`020_d45_audit_trail.sql`): four nullable columns, four indexes, and a
`module` backfill derived from the action prefix. `previous_value` / `new_value` are **not**
backfilled and cannot be — the information was never captured.

⚠️ **RETENTION — the one thing still open.** The blueprint's own closing note applies:
*"Audit and Historical data will drastically increase database space."* Measured on the
46-student `sims`: a grade-change row is ~400 bytes with both values populated, and
~150 offerings × ~6 assessments × ~30 students, entered and revised, is on the order of
10⁵ rows/year — tens of MB/year. **Not a problem at BAJC's size, and it would be at ten
times the enrolment.** No purge job was created deliberately: an audit trail that deletes
itself on a schedule nobody agreed is worse than one that grows. See §7 item 12.

**Verified by EXECUTION** — 24/24 through the real HTTP API against a fresh `sims_test`
(with `020` applied), plus **36 permanent tests** in
`backend/tests/test_d45_phase7_audit_trail.py`. The test that matters most asserts over the
**raw response body**: no UUID, and none of `entity_type`, `entity_id`, `summary`,
`assessment_grades`, `class_enrollments`, `student_profiles`, `grade.update`, `principal`
or `secretary` appears anywhere in it — so a future field that leaks an id fails in CI
rather than in front of an auditor. `tsc -b --force` clean.

---

### Phase 8 — Dashboards and Program Progress — 🟡 **Dean dashboard DONE (10 Sep 2026)**
- [x] **§3 module 22 / §42 Dean Dashboard** — the full KPI set, minus the items blocked by C1/C2. **No migration.**
- [ ] **§38 Program Progress** on the Student Portal. ~~Depends on Phase 3~~ — **re-based (Meeting #5).** Phase 3 is gone, so progress is measured against the programme's **current** `program_courses` (243 rows; `is_required` already distinguishes core from elective). ⚠️ Say so on the screen: it is progress against the programme **as it stands today**, not against the plan the student was admitted under, and it moves when the Dean edits the programme.
- [x] **§59 Suggested Dashboard** — the Dean's cards. *(The other roles' §59 cards are unchanged and were already in place.)*

#### What §42 asked for, what is now there, and what is deliberately not

| §42 indicator | Status |
|---|---|
| Active students · lecturers · sections · courses · attendance rate · new intake · enrolment by programme · grade distribution · enrolment trend · capacity | ✅ already there |
| **New applicants** · **Students accepted** · **Active programmes** · **Students below the attendance threshold** | ⚠️ **the server was already computing all four and the screen never rendered them** — see below |
| **Graduates** | ✅ added |
| **Outstanding grade submissions** | ✅ added |
| **Course failure rates** | ✅ added — a headline rate and a worst-courses table |
| ~~Students on probation~~ | ❌ **not built.** Needs Academic Standing, deferred with **C1** |
| ~~Graduation candidates~~ | ❌ **not built.** Needs the Graduation Audit, deferred with **C2** |

**The two omissions are asserted, not just skipped.** `test_dashboard.py` pins the exact
set of `stats` keys, and `TestDeanKpiSet::test_probation_and_graduation_candidates_are_absent`
names them. A tile reading 0 for a feature that does not exist is worse than no tile —
it is a number the Dean would believe — and if either module lands, that test is the
thing that says to add the tile.

#### ⚠️ FINDING 1 — four KPIs were being computed and thrown away

`new_applicants`, `accepted_applicants`, `active_programmes` and `students_at_risk` were
added to `AdminStats` in Phase 1 and have been in every `GET /dashboard` response since.
**The frontend never showed them, and could not have:** `AdminDashboard['stats']` in
`features/dashboard/types.ts` did not declare them, so the fields arrived, went unread,
and nothing anywhere failed to say so. The demo handler did not send them either, so the
two implementations agreed — on the wrong thing.

They are now declared **required**, not optional. That is the part that matters: the
existing optional fields (`total_courses`, `student_capacity`, …) are optional for a real
reason — an older server might not send them — but treating a field the server always
sends as optional is how one goes missing for a phase without a single error.

#### ⚠️ FINDING 2 — the "Courses" tile was counting offerings

```python
total_courses = db.scalar(
    select(func.count()).select_from(CourseOffering).where(
        offerings_in_year(year.id),
        CourseOffering.deleted_at.is_(None),
        CourseOffering.deleted_at.is_(None),   # ← three times
        CourseOffering.deleted_at.is_(None),
    )
)
```

The clause repeated three times is the tell-tale of a copy-paste. The tile read
"Courses" with helper text "Across N sections" — **two readings of `course_offerings`,
and neither of them the catalog.** §42 asks for total courses. On live `sims` that is
**125**; the tile was showing **12**. Fixed, and the demo handler had the identical
defect (`liveOfferings.length`), fixed with it.

#### The failure rate, and the two numbers that would have been wrong

**The denominator is RESOLVED TERM GRADES, never enrolments.** A course three weeks into
a session has almost no resolved grades; dividing its failures by its roster reports a
catastrophic failure rate for a class nobody has assessed yet — which is precisely the
figure a Dean would act on first and the one most likely to be wrong. Pinned by
`test_the_denominator_is_resolved_grades_not_enrolments`.

**A letter fails when its BAND says so**, never against a hardcoded mark. BAJC runs two
grading scales whose `D` disagrees about passing — on the active scale `D` is **not**
passing — so the year's own scale is the only authority on which rule is in force. On
live data that is why the college figure is 10.1% and not 8.2%.

**Per COURSE, not per offering:** three sections of MATH1110 are one teaching problem,
and splitting them makes each numerator too small to read. And a course needs at least
five resolved grades before it is RANKED — one graded student at 40% is not a 100%
failure rate, it is one student, and a list sorted by percentage would put it above a
course with thirty students and a real problem. Small courses still count in the
college-wide figure; they are only kept out of the ranking.

**One pass, two readings.** The letter histogram and the failure rates are the same
computation — the most expensive one on this screen, O(students × subjects) if written
badly. `_term_grades_for_year` was extracted so both read it once. Doing it twice would
have doubled the cost *and*, worse, left a second copy of that assembly to eventually
resolve a letter differently from the histogram sitting beside it.
`test_the_histogram_and_the_failure_rate_agree` is what keeps them together.

#### The screen: three labelled bands, not twelve tiles

§42 names a dozen indicators, and twelve equal tiles in one grid is a wall of numbers
nobody reads. They are grouped into three bands that answer three different questions:

* **The college** — students (with seats-filled progress), new intake, courses,
  lecturers, programmes, attendance rate.
* **Needs attention** — applicants waiting, accepted-but-not-enrolled, students below
  the attendance floor, marking outstanding. **Every tile here is a work queue and every
  one links to the screen that clears it**: a KPI you cannot act from is decoration.
* **Outcomes** — graduates to date, this session's failure rate, and the
  worst-courses table beside the charts.

Two labels are carrying weight. **"Applicants waiting"** is a queue, not a running total
of everyone who ever applied — a cumulative count only goes up and tells the Dean nothing
to act on. **"Graduates — to date"** says *to date* because `graduation_date` is NULL on
every graduated row in the register, so there is no year to scope by; scoping on the
column anyway would report 0 for a college that has graduated people, which is the worse
of the two wrong answers.

The worst-courses card is a **table, not a chart**: the number beside the course is the
thing acted on, and a bar chart of eight course codes makes the reader estimate a figure
they were just given exactly.

#### Verification

**By EXECUTION — 20/20 through the real HTTP API** against `sims_test`, with every
headline cross-checked against the same question asked directly in SQL. Live figures:
`total_courses` 125 (was showing 12), failure rate **10.1%** over 159 resolved grades,
8 ranked courses (worst ITEC1104 at 18.2%), 10 assessments still being marked, 4 students
below the attendance floor, 1 graduate.

**+14 permanent tests** (`TestDeanKpiSet`), plus the two contract tests updated to pin the
new key set. **Backend 2161 green.**

**The demo's arithmetic was EXECUTED too**, not just typechecked — `tsc` to CommonJS and
`node` over the real demo dataset (8/8): the catalog count differs from the offering
count, the failure rate agrees with the histogram beside it, the ranking is worst-first
and respects the minimum-results bar. That is the fifth-time-lucky habit from §4b: this
phase's demo changes are the same class of code that has silently disagreed with the
server five times.

Frontend `tsc -b --force` clean, `eslint` 0 errors. The demo payload is verified by
executing the real MSW handler — `probe_d45_dean_and_prereq.mjs`, 38/38 — not by
replicating its arithmetic. ⚠️ What is not verified is the LOOK of the screen; `vite dev`
does run here (see §0), so that is a browser visit rather than an impossibility.

---
### Phase 9 — Reports (§53) ✅ COMPLETE (10 Sep 2026)
**No migration.** Every column these four reports need already exists — `course_offerings.capacity`,
`courses.credits`, `student_profiles.enrollment_load` and `program_id`, `attendance_records`,
`school_profile.attendance_alert_threshold` (Phase 1). This is the first D45 phase with no SQL
for you to run, and that is the finding, not an omission: §53's missing reports were never a
schema gap, they were four queries nobody had written.

Only the yellow ones that are not blocked by C1/C2:
- [x] **New versus returning students** (Enrollment) — `GET /reports/new-vs-returning?academic_year_id=`
- [x] **Overcapacity classes** (Registration) — `GET /reports/overcapacity?semester_id=`
- [x] **Credit load reports** (Registration) — `GET /reports/credit-load?semester_id=`
- [x] **Department attendance report** (Attendance) — `GET /reports/programme-attendance?semester_id=&program_id=`, per-programme per C4
- [x] Frontend **College reports** (Reports → College reports), four tabs, Dean / Registrar / HOD / Auditor
- [ ] ~~**Academic standing** report~~ — **deferred with C1**
- [ ] ~~**Dean's List / Probation list**~~ — **deferred with C1**
- [ ] ~~Graduation reports, Transcript reports~~ — **deferred with C2**

#### The reports are DEFINITIONS, and that is where the work went

A management report is a number with a definition attached, and the definition is the part
that can be quietly wrong. Four were pinned deliberately, each against something that
already existed rather than invented here:

| The question | The answer, and what it is anchored to |
|---|---|
| What does **registered** mean? | `unenrolled_at IS NULL`, and nothing else — **the same predicate `offerings/service.py::_enrolled_counts` uses**, which is the count behind the over-capacity warning the Registrar sees while seating a student. A cleverer rule here would have made the report and the warning disagree about the same class on the same day, and the Registrar would believe the one in front of them. |
| What makes a student **new**? | Their earliest REGISTRATION, never `student_profiles.enrollment_date`. That column is a date somebody typed on the admission record; it moves when a record is corrected, and a student admitted in August who first registers in January is not new twice. |
| What is **full-time**? | BAJC's own application form, already recorded on `EnrollmentLoad`: *"Part Time is under 15 credits a term, Full Time is over 15."* |
| What is **below the attendance floor**? | `school_profile.attendance_alert_threshold` (Phase 1), compared **strictly below** — the same comparison `attendance_alerts` makes, so this report and the alerts screen cannot flag different students from the same configured number. |

Every response carries a `note`: the server's own plain sentence saying what the numbers
mean and what they do not, and **the screen renders it**. A report whose definition lives
only in a service docstring is a report two people read two different ways in the same
meeting.

#### ⚠️ FINDING 1 — under BAJC's own rule, nobody at BAJC is a full-time student

Run against the live data (46 students, 43 registered this session), the credit-load report
flags **36 of 43**:

```
students=43  credits=477  min=9  max=12  avg=11.1  threshold=15  mismatches=36
by declared load:  Full Time  36 students   9–12 credits   36 mismatches
                   Part Time   6 students   9–12 credits    0
                   Transient   1 student    9              0
```

Every one of the 36 declared Full Time at admission and **the heaviest load anyone in the
college carries is 12 credits**, three short of the form's own full-time line. So either
the 15-credit rule on the application form is not what BAJC actually operates, or the
declared load is decorative and nobody has reconciled it since admission. This report
cannot tell you which, and it deliberately does not guess — see §7 item 15.

**Exactly 15 credits is NOT flagged, in either direction.** The form says "under 15" and
"over 15" and therefore says nothing at all about 15 itself. Flagging it would be this
report asserting a boundary the college never set, which is the same mistake in miniature.

#### ⚠️ FINDING 2 — there is no 2025-2026 intake, and the first year in the database can never have one

```
2024-2025 (archived):  new=45  returning=0
2025-2026 (active)  :  new=0   returning=43
```

Zero new students in the active year: all 45 registered students first registered in
2024-2025. If that is right, it is the single most important number on the Dean's intake
screen. If it is an artefact of the demo seed rather than the college's real history, the
report is reading the data correctly and the data is wrong — and either way it is the
report that surfaced it.

The other half is a **floor artefact worth saying out loud on the screen**: the earliest
year in the database shows 45 new / 0 returning, and always will, because nothing can
predate it. That is not a fact about 2024-2025; it is a fact about where the records start.

This is also why the report returns **two readings, not one**. The year-level count answers
"how many students are new to the college this year"; the per-session count answers "how
many of this session's students had never registered in any session before it", under which
a student who started in Session 1 is *returning* in Session 2 of the same year. BAJC uses
both questions, so both are returned rather than one being chosen and the other lost.

#### ⚠️ FINDING 3 — nothing is over capacity, and that sentence needs the other two lists to mean anything

The active session has **no** class over capacity, one exactly full (`ITEC1104-01`, 22/22)
and none with capacity unrecorded. Meanwhile the archived year holds `MATH1110-01` with
**43 registrations and no capacity set at all** — a class that cannot appear on an
over-capacity report, not because it has room, but because nobody said how much room it has.

That is why the report returns three lists and a count:

* **over** — the headline;
* **at capacity** — not a fault, but the state the next registration turns into one;
* **no capacity recorded** — unanswerable, and shown rather than hidden;
* **under capacity** — a COUNT, never a list, because listing every class with room would
  turn an exceptions report into the enrolment report.

An empty "over capacity" list means two completely different things depending on the third
list, and it looks identical either way. The screen says which one it is.

#### ⚠️ FINDING 4 — a wire value no response could ever hold

`OvercapacityBand` was first written as `"over" | "at" | "under" | "unset"`, and `"under"`
was **unreachable**: under-capacity rows are counted, not returned, so nothing could ever
carry that band. A test caught it. It is gone from the type, replaced by
`under_capacity: int` — a value in a wire enum that no response can hold is a value
somebody writes a branch for and never sees taken.

#### ⚠️ FINDING 5 — the attendance floor's docstring disagrees with the shipped code

`settings/models.py` documents `attendance_alert_threshold` as *"At or below it, a class or
a student is flagged"*. The code that has shipped since Phase 1 —
`attendance/service.py::attendance_alerts` — skips a class when `pct_present >= threshold`,
i.e. flags **strictly below**. Phase 9 matched the CODE, because the alternative is two
screens flagging different sets of students from the same configured number, and pinned it
with a test at exactly the boundary (a programme sitting on 25.0% with the floor set to 25
is not flagged). **The docstring is the thing that is wrong**; whether the boundary itself
should be inclusive is a one-word question for BAJC — §7 item 16.

#### Who can read them, and the one role that is scoped rather than admitted

`_institutional` = **Dean, Registrar, Auditor, HOD**. Wider than `_admins` (it adds the
HOD), narrower than `_staff` (it drops the Lecturer).

**The Lecturer is the deliberate exclusion.** They pass `_staff` on every older report
route because printing their own students' report cards is their job. A college-wide list
of who is carrying how many credits is not, and §48 is explicit that being an employee is
not by itself a reason to see something.

**The Head of Department is admitted and then NARROWED**, to the programmes they head, via
the `program_heads` scope D43 built. A role allowlist cannot express "only your own
programmes", so the narrowing is in the service — and **every response says it happened**,
in `scope`, which the screen renders above the numbers. An HOD reading "3 classes over
capacity" must not carry it out of the room as the college total. An HOD who heads nothing
yet sees **nothing**, not everything: `hod_program_ids` returns `[]` for an unappointed
head, and read the other way that would have turned them into a Dean.

Note what the HOD's capacity report contains: scoping runs through `program_courses`, so
the head of Biology sees `ITEC1104-01` — an Information Technology course their students are
required to take. That is correct and intended, not a leak.

**The System Administrator is refused by Phase 1's `technical_role_scope`**, centrally, with
no route change needed. Unlike Phase 7 this was expected rather than discovered; it is
recorded here only so the next reader does not go looking for the guard.

#### What was built

    backend/app/modules/reports/institutional.py   the four reports (new)
    backend/app/modules/reports/schemas.py         +14 wire shapes
    backend/app/modules/reports/router.py          +4 GET routes
    backend/tests/test_d45_phase9_reports.py       80 tests (new)
    frontend/src/features/reports/screens/CollegeReportsScreen.tsx   (new)
    frontend/src/features/reports/{types.ts,api/reportsApi.ts,hooks/useReports.ts,index.tsx}
    frontend/src/shared/api/mocks/handlers/{reports.ts,index.ts}     demo parity

The service is a **separate module from `reports/service.py`** on purpose: that file is the
report-card engine, 1,300 lines whose whole subject is one student's grades. These four
share none of its machinery — no bands, no GPA, no snapshots — and share only the router,
which is the right amount of togetherness.

The frontend is **one tab with four of its own**, not four more tabs on the Reports page.
The Reports tab bar names DOCUMENTS — a report card, a transcript, things printed and handed
to a person. These read the college to find what needs attention. Six top-level tabs mixing
the two kinds would have made the bar the widest thing on the page and taught nobody which
was which. Terminology is **Session** throughout (Meeting #5 / Phase 3A); only the wire
field is still `semester_id`.

#### Verification

**By EXECUTION — 85/85 through the real HTTP API** against a fresh `sims_test` copy of
`sims` taken *after* you ran `020`, exercising all four reports as Dean, Registrar, Auditor
and HOD, with every headline number cross-checked against the same question asked directly
in SQL (the over-capacity classification, the credit total per student, the attendance
record count, the distinct-student intake count). The 403s were driven too: Lecturer,
Student and — through the central guard — System Administrator.

Plus **80 permanent tests** in `backend/tests/test_d45_phase9_reports.py`, hermetic and
rolled back, over a fixture built to be awkward on purpose: two programmes (with one
programme every scoping assertion passes with the filter deleted), a prior year and a
two-session current year, courses of 6/6/3 credits so a load can land exactly on 15 as well
as either side of it, a class over capacity by exactly one, a class exactly full, a class
with no capacity, a student whose only registration was unenrolled, a student registered in
the second session only, and an audited course. **Full suite 2139 green.**

Frontend `tsc -b --force` clean, `eslint` 0 errors. ~~The demo handlers are not
execution-verified~~ — **retracted, see §0.** They ARE, by
`frontend/scratchpad/probe_d45_dean_and_prereq.mjs` (38/38), which bundles the real MSW
handlers with esbuild's Node API and serves them under `msw/node`. What is still owed is a
LOOK at the rendered screens in a browser, which is a different and much smaller claim.

---

### Phase 10 — Timetable Management (§18, §20) — **THE LAST PHASE.** Dean-only.
Added by Meeting #5. Everything that needs, or falls under, timetabling lives here.

**What already exists — this is not a greenfield module.**

| Piece | State |
|---|---|
| `class_meetings` table | **Built.** `offering_id`, `day_of_week` (SmallInt, `CHECK BETWEEN 1 AND 5`), `start_time`, `end_time`, `room` (free text), soft-delete. `CHECK end_time > start_time`. Indexed `(day_of_week, start_time)`. |
| `GET /timetable/me`, `GET /timetable/students/{id}` | **Built, READ-ONLY.** Returns the Mon–Fri week pre-bucketed by day, plus `unscheduled` — offerings the viewer belongs to that have no meeting yet. HOD + Auditor reads were added in Phase 1. |
| `WeekTimetable.tsx` (150 lines) | **Built, read-only.** MUI, responsive: five columns on desktop, day-grouped cards on mobile. Deliberately not time-proportional. |
| `_student_enrol_conflicts` | **Built** — already computes clashes at enrolment and reports them **warn-only** (D-Q6). |
| **Write endpoints** | ❌ **None.** No POST/PATCH/DELETE for `class_meetings` anywhere in the codebase. **This is the phase.** |

**Scope**
- [ ] **Dean-only write endpoints** for `class_meetings` — create, move, resize, delete a
      meeting on an offering. `require_role(Role.PRINCIPAL)` only; the Registrar reads but
      does not write. (`principal` is the wire value; **Dean** is the display label — see
      the warning at the top of `strings.ts`.)
- [ ] **An editable week grid** for the Dean, by extending `WeekTimetable.tsx` — see the
      library note below.
- [ ] **§18 conflict detection**, server-side, on every write: **room** double-booked,
      **lecturer** double-booked, and **cohort** clash (two offerings sharing enrolled
      students). Refuse room and lecturer clashes; keep the cohort clash **warn-only**, to
      match the D-Q6 behaviour already shipped at enrolment.
- [ ] **§20 "No timetable conflict exists"** at registration — moved here from Phase 4.
      `_student_enrol_conflicts` already computes it; this phase decides whether it
      graduates from a warning to a refusal. **That is a policy question (C7), not a code
      question.**
- [ ] **⚠️ Reconcile the two room fields — do this FIRST.** `class_meetings.room` is
      **free text**, while D44 added `course_offerings.classroomid`, a real FK to the
      `classroom` table. Two places name a room and they can disagree. Until one wins,
      room-conflict detection has nothing trustworthy to key on. Recommendation: add
      `class_meetings.classroom_id` (FK) and keep `room` as a display fallback for existing
      rows.
- [ ] **Classroom status becomes real.** `errorMessages.ts` already tells the user:
      *"In-Use, Available and Occupied are worked out from the timetable."* Nothing computes
      them today, because there was no timetable to compute them from. This phase makes that
      sentence true — it is a **promise already shipped to the UI**, not a new feature.
- [ ] Surface the `unscheduled` list the read API already returns, so an offering cannot be
      quietly left off the timetable.

**SQL — Phase 10** (`0XX_d45_timetable.sql`, number assigned when the phase starts).
Deliberately not written yet: it depends on the room-reconciliation decision above.

#### Library research — `npm install @svar-ui/react-calendar`

**Will it install? Yes.** Verified against the npm registry: `@svar-ui/react-calendar@2.6.2`,
**MIT**, peer range `react >=18` / `react-dom >=18`. This project is React **18.3.1**, so
there is **no peer conflict** and the command succeeds. Week view and drag-and-drop are in
the free MIT tier.

**Should we use it? No — the recommendation is to extend `WeekTimetable.tsx` instead.**
Five reasons, in order of weight:

1. **The data model does not fit.** SVAR Calendar is a *dated-event* calendar — events carry
   concrete start/end datetimes, like Google Calendar. `class_meetings` stores a **recurring
   weekly pattern with no date at all**: `day_of_week` 1–5 plus two `time` columns. Using
   SVAR means inventing a fake reference week, projecting meetings onto it, and mapping every
   drag back to `(day_of_week, start_time, end_time)`. That adapter is the bulk of the work,
   and it is where the bugs will be.
2. **The view we actually need is the paid one.** A timetable is judged by *room × time* and
   *lecturer × time* — that is the **Resources / Timeline** view, and it is **PRO (paid)**.
   The free tier gives day/week/month, which is the one shape we already render.
3. **A second design system.** The app is MUI v6 throughout, with the two-tier Card/Paper
   convention from the UI/UX refactor. SVAR ships its own CSS and its own light/dark themes;
   it would have to be fought into looking like the rest of the app, and its dark theme is
   not ours.
4. **We cannot verify it on this machine.** `npm run build` and `npm run dev` **do not run
   here** — esbuild's binary is blocked by policy (RUNBOOK §1). A pure-TSX change can be
   reviewed by reading it; a new dependency that ships a CSS bundle and mounts a non-MUI
   widget is exactly the kind of change that has to be *run* to be trusted — and it cannot
   be run here.
5. **The grid already exists.** `WeekTimetable.tsx` is 150 lines of MUI that already renders
   this exact Mon–Fri shape, responsively, and is already used by the student and lecturer
   views. Making it editable for the Dean is less work than integrating SVAR and then
   constraining it back down to a five-day, date-free grid.

**Alternatives checked** (same registry query): `react-big-calendar@1.20.0` (MIT, react
≥16) and `@schedule-x/react@4.1.0` (MIT, react ≥16). Both are dated-event calendars and
fail on reason 1 exactly as SVAR does. **No calendar library models a date-free recurring
weekly timetable**, because that is a school-timetable shape, not a calendar shape.

**Recommended build:** give `WeekTimetable.tsx` an `editable` mode — click an empty slot to
add, click a block to edit, with a small MUI dialog for day / start / end / room / lecturer.
`@mui/x-date-pickers` is **already a dependency** and supplies the time fields. Drag-and-drop
is a later refinement, not a requirement: with five days and a handful of meetings per
offering, a dialog is faster to use and far cheaper to make accessible. **Net new
dependencies: zero.**

⚠️ **Do not start this phase before C7's override decision** if §20's timetable check is to
refuse rather than warn — the two share the registration path.

---

### ~~Phase 10 (the OLD one) — Department / HOD / office information (§8)~~ — **DISSOLVED**

> ⚠️ Not to be confused with the **new Phase 10, Timetable Management**, above. This slot
> was vacated by C4 long before Meeting #5 reused the number.
C4 answered: two columns on `programs`, folded into **Phase 1**.

---

## 5. Blue (do-not-build) — recorded so it is not built by accident

~~Timetable Management (§3/§18)~~ — **NO LONGER BLUE. Meeting #5 put it back in scope as
Phase 10.** Academic Standing (§3 — *see C1*), Graduation Audit (§3/§33),
Transcript Management (§3/§35/§36/§37), Degree Award (§34), Student Holds (§21), Final Grade
Submission Workflow (§27), Reporting and Analytics (§3/§53 header), Student Portal
Registration (§38), Registrar Graduation/Transcripts/Reports (§41), Two-factor auth (§47),
Document Management (§56), Student/Application/Transcript number *format* configuration (§57),
Email integration (§54), Transcript Data Principle (§68), transcript QR code (§36).

**Red** (§39 student photographs, §43 system activity, §57 "differs from current
configuration & setup", §66 record locking) is not in your legend — tell me what red means.

---

## 6. Progress

| Phase | Blocked by | Status |
|---|---|---|
| 0 Decisions | — | ✅ done |
| 1 Cheap wins | — | ✅ done · **SQL `018` RUN on `sims` (9 Sep 2026)** |
| 2 Status vocabularies | — | ✅ done · **SQL `019` RUN on `sims` (9 Sep 2026)** |
| **3A Terminology + prerequisite UX** | — | ✅ **done (9 Sep 2026)** — no migration |
| ~~3 Curriculum Management~~ | — | ❌ **REMOVED (Meeting #5)** |
| 4 Registration validation | — | ✅ **done (9 Sep 2026)** — no migration |
| 5 GPA / repeat rules | C7 | ☐ |
| 6 Academic Standing | — | ❌ deferred (C1) |
| 7 Audit trail | — | ✅ **done (9 Sep 2026)** · **SQL `020` RUN on `sims` (10 Sep 2026)** |
| 8 Dashboards / Program Progress | ~~Phase 3~~ — re-based on `program_courses` | 🟡 **Dean dashboard done (10 Sep 2026)**; §38 Program Progress left |
| 9 Reports | — | ✅ **done (10 Sep 2026)** — no migration (shrunk by C1/C2) |
| **10 Timetable Management** | C7 (if §20 must refuse) | ☐ **LAST PHASE** |
| ~~10 Department / HOD (the old slot)~~ | — | dissolved into Phase 1 (C4) |

**Suggested order from here:** ~~3A~~ → ~~4~~ → ~~7~~ → ~~9~~ → **8 (Dean dashboard done;
§38 Program Progress left)** → 5 → 10. §38 needs nothing from you — it was re-based on
`program_courses` at Meeting #5. **Phase 5 still needs C7** (§29/§31 — the GPA, repeat and
withdrawal rules), and it changes GPA numbers, so it should not start on an assumption.
Phase 10 is last, as you asked.

⚠️ **Uncommitted work in the tree (as of 10 Sep 2026).** Phases 1, 2, 3A, 4, 7 and 9 are all
complete and **none of them is committed** — ~60 modified files plus `018_d45_phase1.sql`,
`019_d45_status_vocabularies.sql`, `020_d45_audit_trail.sql` and the new test modules, on
branch `tertiary-refactor`. Six phases in one diff is no longer readable phase by phase;
commit it as one D45 commit rather than trying to unpick it retrospectively.

---

## 7. What I still need from you

### To start Phase 1 (everything else in it can begin now)
1. **§24 assessment weights.** The system deliberately does *not* assume weights total 100 —
   it normalises by whatever they add up to, so a gradebook at 90% still computes correctly.
   §24 asks it to **verify** the total. **Warn the lecturer, or refuse the save?** My
   recommendation is warn: a hard refusal makes a half-built gradebook unsaveable mid-setup.
2. **§8 office information** — is this the programme office's *location*, its *hours*, a
   *contact*, or free text for all three? I have specced free text; say if it should be
   structured fields.
3. **§2 System Administrator** — confirm the sysadmin **cannot read student academic
   records** (§48 least privilege). They manage accounts, permissions, configuration and
   backups. If they should also see academic data, say so — it changes the whole role.

### Still open from the contradictions list
4. **C5 — §7.5 Student Status.** It lists 10 values, unhighlighted. Implemented is the 6
   D34 agreed with you. Confirm it is descriptive prose, not a change request.
5. **C6 — §19 registration statuses.** Confirm the union (keep `withdraw_passing` /
   `withdraw_failing` rather than collapsing to one "Withdrawn"), and confirm the
   `enrolled` → `registered` rename. Phase 2 is blocked on this.
6. **C7 — the policy questions BAJC must answer**, not me.
   - ✅ **ANSWERED 9 Sep 2026 — which registration restrictions are overridable (§20):**
     the prerequisite rule and the student-status rule; **not** capacity; **Dean only**.
     Phase 4 is built on this.
   - ☐ **STILL OPEN — how repeats / withdrawals / incompletes / transfers / fails affect
     the GPA (§29, §31).** This blocks **Phase 5**, and Phase 5 changes GPA numbers, so it
     must not ship alongside anything else.
   - ~~what "Electives" means (§10)~~ — **moot.** Phase 3 was removed at Meeting #5, so
     there is nothing left for the answer to configure.

### New from Phase 7 (9 Sep 2026)
12. **Audit retention — how long must the trail be kept?** Nothing is ever deleted today,
    which is the safe default and the reason no purge job was written. At BAJC's size the
    growth is tens of MB/year, so there is no technical pressure — but "keep everything
    forever" should be a decision you made, not one you inherited. A retention period (say,
    seven years for grade changes, shorter for system activity) can be implemented whenever
    you set one.
13. **Should the Registrar see the audit trail?** They are currently excluded because they
    are its most frequent subject. That is defensible and it is also arguable — they run
    registration and may reasonably need to check their own office's history. Say if they
    should have it, and whether scoped to their own actions or to everything.
14. **Should the System Administrator get a "System activity only" view?** They are refused
    the trail entirely today (§48 — it is mostly academic records). A scoped endpoint that
    filters to accounts / roles / configuration *before* academic rows are loaded is
    buildable if you want it; adding the role to the existing gate is not, because that
    would hand them every grade change in the college.

### New from Phase 9 (10 Sep 2026)
15. **Is 15 credits really the full-time line?** Under the application form's own rule
    (Part Time under 15, Full Time over 15) **not one student in the college is full-time**:
    36 of the 43 registered this session declared Full Time and the heaviest load anyone
    carries is 12 credits. Either the form's number is not what you operate, or the declared
    load has not been reconciled with anyone's actual registrations since admission. Tell me
    which and the credit-load report stops flagging 36 people — and if the number itself is
    wrong, say what it should be. ⚠️ Related: the form says "under 15" and "over 15" and so
    says nothing about **exactly 15**. The report treats 15 as consistent with either
    declaration rather than guessing; one word from you closes that.
16. **Is the attendance floor "below 80%" or "80% and below"?** The setting's own
    description says *at or below*; the alerts screen that has shipped since Phase 1 flags
    **strictly below**, so a student sitting on exactly 80.0% is currently not flagged.
    Phase 9 matched the shipped behaviour so the two screens agree. One word settles which
    of the two is right.
17. **Is "no 2025-2026 intake" correct?** The intake report reads 0 new / 43 returning for
    the active year — every registered student first registered in 2024-2025. If BAJC did
    admit students this year, then their registrations are missing from `sims` rather than
    from the report.

### New from Meeting #5 (9 Sep 2026)
9. ~~**Does `Semester` become `Session` too?**~~ ✅ **ANSWERED 9 Sep 2026 — yes, both.**
   *(original question kept below for the record)*
   **Does `Semester` become `Session` too?** You asked for "term" → "session". The
   dictionary (`strings.ts`) currently says `semester: 'Semester'`, and that word is on the
   offerings list, the offering form and the report screens. Changing only "term" leaves the
   UI with **two** words for one thing (Semester and Session); changing both leaves one.
   My recommendation is **rename `Semester` → `Session` as well**, as display copy only —
   the wire names (`semester_id`, `/settings/active-term`, `term_type`) must NOT change, or
   the generated API client and a large share of the test suite break. **Phase 3A is
   blocked on this answer only for the `Semester` half**; the five "term" stragglers can be
   fixed now regardless.
10. **§20 timetable conflict — warn or refuse?** Today a clash at enrolment is warn-only
   (D-Q6) and the enrolment still succeeds. Now that the Dean will own the timetable, should
   a student timetable clash **refuse** the registration? Room and lecturer double-booking
   I intend to refuse outright at the timetable-write endpoint either way; this question is
   only about the student's own clash. Blocks the last item of Phase 10.
11. ~~**Prerequisite free text (§3b P1).**~~ ✅ **ANSWERED 9 Sep 2026 — clear it
   automatically.** The old value is preserved in the audit row rather than lost outright.
   *(original question kept below for the record)*
   **Prerequisite free text (§3b P1).** When the Dean removes the last structured
   prerequisite, should the system **clear** `courses.prerequisites_text` automatically, or
   keep it and relabel it *"from the printed catalog (not enforced)"*? Recommendation: keep
   and relabel, plus an explicit "clear this too?" prompt — the text is catalog provenance
   and silently deleting it loses information.

### Housekeeping
7. **Red highlights** (§39 student photographs, §43 system activity, §57 "differs from
   current configuration & setup", §66 record locking) are not in your legend. What does
   red mean?
8. **`sims_d31`, `sims_d43`, `sims_d44` are still on the server.** `sims_test` is built and
   in use. Drop the three when convenient:
   ```sql
   DROP DATABASE `sims_d31`;
   DROP DATABASE `sims_d43`;
   DROP DATABASE `sims_d44`;
   ```

# D31 — Tertiary offering model: `classes` → `course_offerings`

> **Read this first.** D30 made the catalog and curriculum tertiary but left the *offering* layer
> K-12: `classes` is a homeroom scoped to an academic year, and `class_subjects` is the
> many-to-many that only existed because one homeroom taught seven subjects. D31 removes that
> shape.
>
> **ALL PHASES ARE COMPLETE AND COMMITTED (2026-08-19).** Backend 1415 green / 0 skipped;
> frontend typecheck / lint / both builds clean, demo dataset executes, MSW route parity clean;
> the tertiary demo seed is written, run, and driven through the real API. **`008` is applied to
> `sims_d31` and deliberately still NOT to `sims`.**
>
> **~~What is left is not a phase — it is the `sims` cut-over~~ — THE CUT-OVER IS DONE
> (2026-08-20).** `008` is applied to `sims` (`verify_schema.py --expect 008` -> PASS, every
> migration 001-008 fully applied) and `sims` has been re-seeded from `010_seed_demo.sql`.
> `DATABASE_URL` points at `sims` and the checkout runs against it. The 19 shared-password
> accounts are gone: 19 users, 19 distinct hashes, `must_change_password = 1` on all of them.
> **`sims_d31` is no longer needed as the dev target.**
>
> **Next is Phase 8 QA**, plus one defect this verification turned up — see
> "Audit stamping — two write paths never set `created_by`" below.

---

## STATUS

| | |
|---|---|
| **Phase** | **0 ✅ · 1 ✅ · 2 ✅ · 3 ✅ · 4 ✅ · 5 ✅ · 6 ✅ — ALL PHASES COMPLETE** |
| **Status** | 🟢 **Backend 1415 passed / 0 failed / 0 skipped** (against `sims_d31`; **not yet re-run against the cut-over `sims`**). 🟢 **Frontend `typecheck` + `lint` + both `vite build`s clean, demo dataset executes (21/21), MSW route parity 0 ghosts.** 🟢 **`008` APPLIED to `sims` and re-seeded — cut-over complete 2026-08-20** |
| **Branch** | `tertiary-refactor` — committed on top of `dc4c894` ("tertiary refractor", the D30 commit), which is the rollback point |
| **Last updated** | 2026-08-20 (the `sims` cut-over is complete and verified) |
| **Next action** | **Phase 8 QA.** The cut-over is DONE (2026-08-20) — see "The `sims` cut-over" below, now marked complete. Carry in the follow-ons recorded at the end of this file, plus the `created_by` defect in "Audit stamping" below |
| **Migrations applied** | **`sims`** (the live DB): `sims.sql` → `001` → … → **`008` APPLIED 2026-08-20**. `verify_schema.py --expect 008` -> **PASS**, all 8 migrations fully applied (001 4/4, 002 1/1, 003 1/1, 004 3/3, 005 20/20, 006 2/2, 007 2/2, 008 20/20). Re-seeded from `010_seed_demo.sql`. **`sims_d31`** (the dev copy): same shape, now redundant |
| **Backups** | Full schema + data dump before Phase 0, in the session scratchpad (`d31-backups/pre-d31-full.sql`, 1.8 MB) |
| **Dev database** | **`sims`** — the cut-over is done, so `sims` is the target again and `DATABASE_URL` points at it. `sims_d31` is kept only as a pre-re-seed comparison copy and can be dropped. Both `apply_sql.py` and `verify_schema.py` honour an exported DSN |

**Marking convention**

```
- [x] Task — COMPLETED yyyy-mm-dd
- [ ] Task                                (not started)
- [~] Task — IN PROGRESS
- [!] Task — BLOCKED: <reason>
```

### The `sims` cut-over — ✅ COMPLETE 2026-08-20

`008` deletes the homeroom-era operational data and its header forbids applying it without the
code that expects it. That code is now committed, so the two steps below can be run — but they
must be run **in this order and against `sims`**, and they are the operator's call, not the
refactor's:

```powershell
cd backend
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py --backup pre-008-sims.sql   # snapshot first
.\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\008_course_offerings.sql
.\.venv\Scripts\python.exe db\mariadb\verify_schema.py --expect 008
$env:ENVIRONMENT="local"; $env:SIS_ALLOW_DEMO_SEED="yes-destroy-my-data"
.\.venv\Scripts\python.exe -m db.mariadb.seed_demo                            # re-seed on the new shape
```

Between step 2 and step 5 the database has the new schema and **no** offering data — that window
is why they belong in one sitting. Step 5 is also what finally clears the 19 shared-password
accounts still sitting in `sims`: the seed replaces them with per-account generated passwords and
`must_change_password = true`. Until then, that row of data remains the go-live blocker the
RUNBOOK describes, even though the code that created it is gone.

**Outcome, verified against `sims` on 2026-08-20:**

- [x] **`008` applied to `sims`** — `verify_schema.py --expect 008` -> `RESULT: PASS`, every
      required migration fully applied (`008` 20/20 probes).
- [x] **Re-seeded from `010_seed_demo.sql`** — 22 offerings, 125 courses, 8 programmes, 243
      `program_courses`, 45 student profiles, 393 enrolments, 84 assessments, 1,436 grades, 3,260
      attendance records. The 17 `classes_legacy_pre_d31` rows are retained (renamed, not dropped).
- [x] **The shared-password go-live blocker is CLEARED** — 19 users, **19 distinct password
      hashes**, 0 hashes shared by more than one account, `must_change_password = 1` on all 19.
      Note only 6 of the 45 students have a login (1 principal, 1 secretary, 11 teachers, 6
      students); the rest are profiles without accounts, which is what the seed intends.
- [x] **`DATABASE_URL` re-pointed at `sims`.**
- [x] **`term_grade_snapshots` and `report_card_snapshots` are both 0**, exactly as follow-on 8
      predicted — the frozen-vs-live branch is reachable only by archiving a year through Settings.

Not yet re-run against the cut-over `sims`: the 1415-test backend suite (it was green against
`sims_d31`, which has the same shape). That belongs to Phase 8 QA.

### Audit stamping — two write paths never set `created_by` — ✅ FIXED 2026-08-20

Found on 2026-08-20 while verifying the cut-over, by driving the **real service functions**
against `sims` inside a rolled-back outer transaction. The services `commit()` internally, so the
probe session joins the outer connection transaction as a SAVEPOINT — their commits release the
savepoint and the outer rollback still discards everything. Row counts were re-checked afterwards
and were unchanged. (A first attempt used a plain `Session.rollback()`, which does **not** hold
against a service that commits: it left one `attendance_records` row and one `audit_log` row
behind in `sims`, both since deleted. Worth remembering before writing the next probe.)

Every `AuditMixin` table's `created_at`/`updated_at` self-populates: all 132 timestamp columns
across the 40 audit-carrying tables have a live `DEFAULT current_timestamp()`, so `created_at` is
never NULL. **`created_by` is application-set, not DB-set**, and two paths omit it:

| write path | `created_at` | `created_by` (before) | `created_by` (after fix) |
|---|---|---|---|
| `assessments.create_assessment` -> `assessments` | ✅ stamped | ✅ stamped | ✅ stamped |
| `courses.create_course` -> `courses` | ✅ stamped | ✅ stamped | ✅ stamped |
| `grades.upsert_grades` -> `assessment_grades` | ✅ stamped | ❌ **NULL** | ✅ **stamped** |
| `attendance.upsert_register` -> `attendance_records` | ✅ stamped | ❌ **NULL** | ✅ **stamped** |

Both offenders are upserts (`backend/app/modules/grades/service.py:822`,
`backend/app/modules/attendance/service.py:408`): the insert branch constructs the row without
`created_by`, and the shared tail below it then sets `updated_by = actor.id` on insert and update
alike. So the row records **who last touched a mark, never who first entered it** — the
accountability question a gradebook dispute actually asks. `attendance/service.py:324` already
reads `newest.updated_by or newest.created_by`, so the `created_by` fallback there is dead code.

**FIXED 2026-08-20** — `created_by=actor.id` added to both insert branches, matching the other
22 audit tables. Only the INSERT branch is touched, so re-saving a mark still leaves the original
`created_by` alone and moves only `updated_by`, which is the point. Verified by re-running the
same probe (all four paths now stamp both columns) and the suite: **1415 passed / 0 failed /
0 skipped**.

**Backfill is not possible for the rows that already exist** — `updated_by` is the only
provenance they have, so every pre-2026-08-20 grade and attendance row keeps a NULL `created_by`
permanently. Treat "`created_by IS NULL`" on those two tables as "written before the fix", not as
"written by nobody".

Two non-defects worth recording so they are not "fixed" later: `school_profile` and
`assessment_policies` are singletons the seed creates and the app only ever *updates*, so their
NULL `created_by` is correct; and `student_documents` has no application write path at all.

One seed-vs-app inconsistency, cosmetic: `010_seed_demo.sql` populates `created_by` on all 3,260
`attendance_records` but leaves it NULL on every other audit table — the exact inverse of what the
application does. Seeded data therefore cannot be used to judge app behaviour either way.

---

## Why this refactor exists

Three findings from the D31 review, each verified against the live database rather than the docs:

1. **`classes` is scoped to an academic YEAR, not a semester.** It carries `academic_year_id` and no
   `semester_id`, which is the homeroom assumption in its purest form. A tertiary offering is a
   semester thing: "Programming I — Semester 1 2026" and "Programming I — Semester 2 2026" are two
   offerings, and today they can only be told apart by two same-year rows with different names.
   Meanwhile `class_enrollments`, `assessments` and `term_grade_snapshots` *all* carry `semester_id`,
   so the term is tracked everywhere except on the thing being offered.
2. **`classes.grade_level varchar(50) NOT NULL`** — live values `Form 1`, `Form 2`, `Form 3`, `Form 4`.
   Not nullable, so every offering must declare a Form. Alongside it `section varchar(2)` (the
   homeroom letter), `homeroom_label`, `numStudents int NOT NULL` (a denormalised count) and
   `classStaffID int(11)` (a legacy int FK pointing at nothing).
3. **`class_subjects` is vestigial.** All 17 live classes have more than one course attached (~7 each).
   One offering = one course in a tertiary model, so the join table collapses to a column.

**What is NOT changing:** `program_courses` stays exactly as it is — 243 rows across 8 programmes,
unique on `(program_id, course_id)`, with `term_label`/`term_order` for the curriculum position. The
Programme → Course relationship was reviewed and found correct.

## Phase 0 — Repair the migration chain — ✅ COMPLETE 2026-08-18

- [x] Full schema **and data** backup — `apply_sql.py --backup` plus a `mysqldump` (1.8 MB, 32 INSERT
      blocks), both in the session scratchpad, outside the repo — COMPLETED 2026-08-18
- [x] **Removed the `005` block that reverted `006`** — COMPLETED 2026-08-18. `005_tertiary.sql` §2b
      used to `DROP FOREIGN KEY fk_class_subjects_course` / `fk_term_snapshot_course` — the exact
      names `006` creates — and re-add the `subjects`-targeting ones. Because `005` is idempotent and
      replaying it is encouraged, **`005` silently reverted `006` on every replay, and `005` won**:
      the live database was found with the catalog FKs on `subjects` while the ORM had long since
      moved to `courses`. Six `ALTER TABLE` statements deleted (18 → 12); the section is now a comment
      recording both mistakes. **The fix was removing the DDL, not writing a smarter guard** — a
      migration must never undo a later one.
- [x] **Applied `006_courses_cutover.sql`** — COMPLETED 2026-08-18, **14/14 statements**, after all
      three pre-flight zero-checks returned 0. Both catalog FKs now target `courses`.
- [x] **Guarded `005`'s `full_name` backfill** — COMPLETED 2026-08-18. `007` drops
      `student_profiles.full_name`, so replaying `005` afterwards threw 1054 on two `UPDATE`s and
      reported 47/49. Since `apply_sql.py` continues past failures, that left a reader guessing which
      two mattered. Both are now wrapped in an `information_schema` + `PREPARE` guard, so they run on
      a fresh provision (where `005` precedes `007`) and no-op afterwards. **Replay is now 56/56.**
- [x] **`backend/db/mariadb/verify_schema.py`** — COMPLETED 2026-08-18. Read-only
      `information_schema` fingerprints for `001`–`007`, reporting APPLIED / MISSING / **PARTIAL**.
      PARTIAL is the verdict that matters: `apply_sql.py` continues past a failing statement, so a
      half-applied file was previously invisible. `--verbose` prints every probe, `--expect 007` sets
      the required ceiling, exit code 1 on failure so it works as a CI gate. Output is deliberately
      ASCII — it is printed to a cp1252 console.
- [x] **Regression proof the revert bug is dead** — COMPLETED 2026-08-18. Re-ran `005` *after* `006`
      and both FKs still target `courses`; 45 students, 0 with a null surname.
- [x] **Suite green** — COMPLETED 2026-08-18. **1394 passed, zero skips, zero failures** with the
      cutover live. The 73 failures this same swap caused in D30 did not recur, because the ORM had
      already moved — the database was behind the application, not ahead of it.
- [x] **Functional proof** — COMPLETED 2026-08-18. Attaching `MATH1110 Intermediate Algebra` to an
      offering now **succeeds** (verified with a rolled-back insert). Before Phase 0, **114 of the 125
      `courses` rows could not be attached to anything at all** and 0 of 116 live offerings taught a
      real BAJC course.

## Phase 1 — `008_course_offerings.sql`

```sql
course_offerings (
  id           uuid PK,
  course_id    uuid NOT NULL FK -> courses(id),
  semester_id  uuid NOT NULL FK -> semesters(id),   -- replaces academic_year_id
  section_code varchar(10) NULL,                    -- "01", "02" for parallel sections
  capacity     smallint NULL,
  is_archived  tinyint(1) NOT NULL DEFAULT 0,
  + TimestampMixin / AuditMixin / deleted_at,
  + STORED generated `active_offering` for UNIQUE (course_id, semester_id, section_code)
)
```

- [x] Create `course_offerings` — COMPLETED 2026-08-18. Identity is
      `(course_id, semester_id, section_code)`. **No `name` column** (an offering's label derives from
      course code + section + term; storing it would be a second home for one fact — the same argument
      that keeps `credits` on `courses`) and **no `room`** (room is per *meeting*; one course
      legitimately meets in different rooms on different days).
      `active_section` is a STORED generated column, `if(deleted_at is null, coalesce(section_code,''), NULL)`.
      **The COALESCE is load-bearing**: without it two *unsectioned* offerings of the same course in
      the same term would both be permitted, because unique indexes do not collide on NULL. Proven
      both ways on the rehearsal database.
- [x] Re-point every child from `class_subject_id` → `offering_id` — COMPLETED 2026-08-18:
      `assessments`, `assessment_categories`, `class_teachers`, `class_meetings`,
      `term_grade_snapshots`. Written as ADD-then-DROP rather than `RENAME COLUMN`, because
      ADD/DROP has `IF [NOT] EXISTS` forms and `RENAME COLUMN` does not — so the file is re-runnable
      as written.
- [x] Re-point `class_enrollments.class_id` → `offering_id` — COMPLETED 2026-08-18.
      **The plan was wrong about `enroll_active_flag` needing a rebuild**: it is generated from
      `unenrolled_at`, not from `class_id`, so only the `uq_enroll_active` index had to be rebuilt.
- [x] Re-point `attendance_records.class_id` and `announcements.class_id` → `offering_id` —
      COMPLETED 2026-08-18. **`announcements` had three dependencies on the column, not one, and the
      rehearsal is what found them**: a CHECK constraint, a plain index, and the FK. MariaDB refuses
      `DROP COLUMN` while a CHECK names it (1054 "Unknown column 'class_id' in 'CHECK'").
      `ck_announcements_class_audience` is a **stakeholder rule** — `audience='class'` iff a target is
      set — so it is re-created as `ck_announcements_offering_audience` with identical semantics
      rather than dropped. The `audience` ENUM keeps its `'class'` member: it is a wire value shared
      by the ORM, API and MSW handlers, so changing it belongs with the Phase 3 rename.
- [x] Drop `student_profiles.year_group` — COMPLETED 2026-08-18 (every live row was NULL)
- [x] Quarantine by rename, never `DROP` — COMPLETED 2026-08-18. 7 tables become
      `*_legacy_pre_d31`: `classes`, `class_subjects`, `subjects`, `students`, `staff`, `grades`,
      `cat_assessment`. Each rename is guarded twice — source exists AND target does not — so a
      replay neither errors nor clobbers an existing quarantine.
- [x] Add an `008` fingerprint to `verify_schema.py` — COMPLETED 2026-08-18, 20 probes
- [x] **Rehearsed on a throwaway copy of the live database, not on `sims`** — COMPLETED 2026-08-18.
      `mysqldump` → `sims_d31_probe` → apply. This is what caught the `announcements` CHECK, and a
      second defect on replay: `ADD CONSTRAINT ... CHECK` without `IF NOT EXISTS` dies with 1826
      "Duplicate CHECK constraint name". (`IF NOT EXISTS` goes *after* `ADD CONSTRAINT` for a CHECK —
      the mirror image of the FK rule in `005`'s syntax note.) Both fixed; the file now applies clean
      and replays clean.
- [x] **Destructive section is gated on a PRE-COLLAPSE SENTINEL** — COMPLETED 2026-08-18. Every
      `DELETE` is keyed on `class_subjects` still existing, so a replay *after* the demo data has been
      re-seeded deletes nothing. Proven: seeded an offering, a category and an enrolment into the
      rehearsal database, replayed `008`, and all three survived. That gate is why the deletes are
      safe to ship inside a migration at all.
- [x] **No hardcoded `USE \`sims\`;`** — COMPLETED 2026-08-18, unlike `005`–`007`. A destructive file
      that names its own database ignores the DSN you connected with: you cannot rehearse it on a copy,
      and pointing `DATABASE_URL` at staging would still wipe `sims`. Removing it is what made the
      rehearsal possible. (`005`–`007` keep theirs; changing them is not this migration's business.)
- [x] **Behavioural proof of the D31 goal** — COMPLETED 2026-08-18, on the rehearsal database:
      `MATH1110` §01 and §02 coexist in one term (parallel sections); **`MATH1110` now runs in
      Semester 1 *and* Semester 2**, which the year-scoped model could not express; a duplicate
      (course, term, section) is refused 1062; two unsectioned offerings of one course in one term are
      refused; and a soft-deleted offering releases its slot for a replacement.

**`008` is NOT applied to `sims`.** Its header carries the same rule `006` earned the hard way: apply
it in the same step as the code that expects it. Until Phases 2–4 land, applying it would break every
offering write.

`semester_id` is **kept** on the children rather than dropped. It is now derivable from the offering,
but `term_grade_snapshots` is a frozen record where denormalisation is correct, and removing it from
`assessments` / `class_enrollments` would widen an already-large refactor. Recorded as a follow-on.

## Phase 2 — Backend ORM and services — ✅ COMPLETE 2026-08-19

> The header read 🟡 IN PROGRESS until Phase 4. Phase 2.5 below is the record of it being
> finished — 24 live defects found and fixed, suite green. The `[~]` item at the end of this
> section is what 2.5 closed.

Order is deliberate: the authorization gate moved first, because it decides who may touch
a grade.

- [x] **`core/rbac.py`** — COMPLETED 2026-08-18. `assert_teacher_owns_class_subject` and
      **`assert_teacher_owns_section` MERGED into one** `assert_teacher_owns_offering`; the
      set form `teacher_section_ids` became `teacher_offering_ids`. Those were two different
      questions only while a `classes` row was a homeroom teaching ~7 subjects, so that
      owning one subject granted access to the whole section's register. One course per
      offering makes them the same lookup, and two names for it would imply a distinction
      that no longer exists. 404-not-403 preserved; the set form lost its join entirely.
- [x] **`CourseOffering` replaces `Class` + `ClassSubject`** — COMPLETED 2026-08-18 in
      `app/modules/offerings/models.py` (the directory moved from `modules/classes/`).
      `ClassTeacher` / `ClassEnrollment` / `ClassMeeting` KEEP their names because their
      tables do; an ORM class whose name disagrees with its table is worse than one carrying
      a historical prefix.
- [x] **`Subject` → `Course`** — COMPLETED 2026-08-18, **201 identifiers across 32 files**.
- [x] **New `offerings/labels.py`** — COMPLETED 2026-08-18. `course_offerings` stores no
      `name` (a label derived from course code + section), so the label and the sort order
      are defined ONCE and imported — the `STUDENT_NAME_ORDER` precedent, which exists
      because nine services had independently spelled the same ordering. Ordering is by
      code then section, never by the formatted string ("MATH1110-2" would sort before
      "MATH1110-10").
- [x] **Shared wire refs** — COMPLETED 2026-08-18. `SubjectRef` → **`CourseRef`** (plus
      `credits`, which live only on the catalog), and `ClassRef` + `ClassSubjectRef` →
      **one `OfferingRef`** carrying the server-computed `label`, so the API and the demo
      handlers cannot disagree about how an offering is named.
- [x] **The offerings module rewritten** — COMPLETED 2026-08-18: `models.py`, `labels.py`,
      `schemas.py`, `service.py`, `router.py`. **The module got smaller**: six helpers that
      existed only to hop from a section to its single subject are gone
      (`_offering_of`, `_offering_map`, `_class_subject_items`, `_class_subject_or_404`,
      `_one_class_subject_item`, `_teacher_owned_cs_ids`), and with them
      `attach_subject`/`detach_subject`. **15 endpoints → 12.**
- [x] **Assessment categories re-pathed** — COMPLETED 2026-08-18.
      `/classes/{class_id}/subjects/{offering_id}/categories` →
      `/offerings/{offering_id}/categories`, and `_cs_in_class_or_404` became
      `_offering_or_404`: the old URL threaded a homeroom id AND a class_subject id to reach
      one gradebook.
- [x] **`app.main` imports cleanly and NO `/classes` route survives** — verified 2026-08-18.
      All **1394 tests still COLLECT** (no import errors anywhere).
- [~] **The 8 consumer services** — ~75 broken references left, every one an instance of six
      mechanical patterns:
      1. `.join(CourseOffering, CourseOffering.class_id == CourseOffering.id)` — a self-join
         artifact of the merge; delete it.
      2. `CourseOffering.academic_year_id == X` — join `Semester` and compare
         `Semester.academic_year_id` (an offering stores no year).
      3. `CourseOffering.name` — join `Course` and use `Course.code`, or `offering_label`.
      4. `CourseOffering.grade_level` — **gone with the homeroom.** `dashboard/service.py`
         GROUPs BY it (an enrolment-by-Form breakdown), so that needs a tertiary
         replacement rather than a rename — programme or `year_of_study`. **The one item
         here that is a product decision, not a mechanical fix.**
      5. `CourseOffering.is_active` — was `class_subjects.is_active`; use `is_archived` /
         `deleted_at`.
      6. `CourseOffering.class_id.in_(section_ids)` → `CourseOffering.id.in_(...)`.

      Counts: `dashboard` 19, `offerings` done, `assessments` 9, `grades` 8, `timetable` 6,
      `teachers` 6, `students` 5, `reports` 5, `attendance` 5, `announcements` 3,
      `reports/freeze` 2.

**Measured state (2026-08-18), against `sims_d31`:** the catalog, curriculum and grade-math
layers are already green — `test_subjects` + `test_programs` + `test_gpa_calc` +
`test_grade_calc` + `test_prerequisites` = **187 passed, 18 failed**. Every failure is in
`test_prerequisites`' enrolment gate and one `test_programs` delete case, all of which drive
the OLD create-class-then-attach-subject flow.

## Phase 2.5 — What the 2026-08-19 completion run found ✅

**The doc was wrong about one thing, and it matters more than the tests it was wrong about.**
Phase 2 reported "~75 broken references cleared" and Phase 6 said *"every remaining failure
is test-side."* Neither held. The sweep that produced those claims searched for
`CourseOffering.<attr>` — which matches only CLASS-level (query) references and is blind to
INSTANCE-level reads (`offering.name`) and to constructor kwargs
(`AttendanceRecord(class_id=...)`). It fixed the former and left the latter. SQLAlchemy
raises those at runtime only, and the tests that would have caught them were themselves
broken, so the defects were invisible from both directions.

**24 live backend defects** were found and fixed, every one a 500 or worse on a real
endpoint:

| Kind | Count | Examples |
|---|---|---|
| Instance-level reads of dropped columns | 20 | `section.name`, `.grade_level`, `.homeroom_label`, `cs.subject_id` across reports, attendance, grades, dashboard, timetable, assessments |
| Dead constructor kwargs | 2 | `AttendanceRecord(class_id=)`, `ClassEnrollment(class_id=)` — every register write and student enrolment failed |
| Type mismatches from mechanical substitution | 2 | `year_of_offering(db, semester)` (an offering was expected), `_SubjectResult` missing `fully_released` |

Plus, found by the tests rather than by reading:

- **An access-control leak.** `students/service._apply_teacher_ownership` lost its
  correlation in the D31 rewrite: the EXISTS asked "does this teacher own ANYTHING?"
  rather than "do they own THIS enrolment's offering", so any assigned lecturer could
  read the whole student directory. Fixed by restoring
  `ClassTeacher.offering_id == ClassEnrollment.offering_id`.
- **A 404 that leaked existence.** An unowned-but-real offering answered
  `"Resource not found."` while a nonexistent one answered `"Offering not found."` — the
  difference told a caller which was which, defeating the 404-not-403 rule the code
  documents. `assert_teacher_owns_offering` took a `message` parameter so the two bodies
  are byte-identical.
- **A 500 where a 422 belonged.** `end_time <= start_time` on a meeting was refused only
  by `ck_class_meetings_time_order`, i.e. as an `OperationalError` mid-write. Validated on
  `OfferingMeetingInput` now; the CHECK stays as the backstop.
- **`year_of_study` is `enum('First','Second')`**, not free text. The D30 rename from
  `year_group` carried `Lower 6` / `Form 4` across mechanically, and every affected INSERT
  was failing on truncation.
- **`courses.name` is unique**, which is why test fixtures may not name a course after the
  section that teaches it.

**The lesson, recorded because it will recur:** a grep for `Model.attribute` cannot see
instance-level use. `backend/scratchpad/sweep_dead_refs.py` does both shapes — mapper-exact for
constructor kwargs, heuristic-by-variable-name for attribute reads — and reports clean
over `app/` and `tests/`. Re-run it, not a grep, before declaring a column gone.

## Phase 3 — API surface

**Pulled forward and done on 2026-08-19**, ahead of the test migration rather than after it:
the same ~60 assertions carry both the wire names and the test fixtures, and doing the rename
second would have meant editing those lines twice.

- [x] `/classes` → `/offerings` — COMPLETED. Plus the sub-resources the original plan missed:
      `/grades/class-subjects` → `/grades/offerings`, `/grades/class-subject/{id}` →
      `/grades/offering/{id}`, `/assessments/class-subjects` → `/assessments/offerings`,
      `/attendance/sections` → `/attendance/offerings`, `/reports/class-grades` →
      `/reports/offering-grades`, `/announcements/target-classes` → `/target-offerings`
- [x] **`/subjects` → `/courses`** — COMPLETED (client-approved addition). `modules/subjects/`
      became `modules/courses/`; the URL was the last place the pre-D30 noun survived, after
      `Subject`→`Course` had already renamed 201 identifiers. Carries the nested
      `/courses/{id}/prerequisites` mount with it
- [x] **Full wire consolidation on the shared `OfferingRef`** — COMPLETED (client-approved).
      Five modules each defined their own offering ref — `grades.OfferingRef` (keyed `id`,
      carrying `display_name`), `assessments.OfferingRef` (keyed `offering_id`),
      `AttendanceSectionRef`, `ReportSectionRef`, `ClassGradesClassSubjectRef` — and they
      disagreed about the key, the label field and how much of the homeroom came along. That
      was survivable while the ref wrapped two rows; it is not now that **the label is
      derived**, because five derivations of one string drift and the screens are where the
      drift shows. **`offerings/labels.offering_ref` is the only place it is constructed.**
      What stays module-local is only what is genuinely local: attendance's `teachers[].name`
      and grades' `teachers[].full_name` + `lead_teacher_id`
- [x] Flat fields folded into the ref: `section_name`, `display_name`, `subject_name`,
      `class_id`/`class_name` (timetable), `class_ids` → `offering_ids` (students),
      `TeacherStats.my_sections` + `my_class_subjects` → one `my_offerings` (they were the
      same number once an offering teaches one course), `by_grade`/`by_class` →
      `by_programme`/`by_offering` (reports), error code `class_subject_not_found` →
      `offering_not_found`
- [x] RBAC unchanged and re-confirmed: **Dean-only** for catalog, programmes, curriculum,
      prerequisites, grading scale and deadlines; **Dean or Registrar** for offerings,
      scheduling, lecturer assignment and enrolment
- [x] **`backend/openapi.json` regenerated** — COMPLETED. 77 → **101 paths**; tags now include
      `courses`, `offerings`, `programs`, `prerequisites`, `admissions`. Zero paths containing
      `class` or `/subjects` survive.
- [x] **ADDENDUM, 2026-08-19 (found by Phase 4)** — the "zero paths containing `class`" check
      proved something narrower than it looked: it verified PATH strings only. Four wire names
      and three error codes survived it, all of them things the frontend would have had to
      speak. Fixed with the Phase 4 commit, backend suite still 1405 green:
      * `GET /students?class_id=` → `offering_id`
      * `GET /grades/term?class_id=` — **removed.** It duplicated `offering_id` (identical
        `CourseOffering.id` filter) and bypassed the explicit ownership 404 the named param
        triggers. A dead second door on an authorization check.
      * `StudentDetail.current_classes` → `current_offerings`;
        `StudentListItem.class_count` → `offering_count`
      * `duplicate_subject_name` / `duplicate_subject_code` / `subject_in_use` →
        `duplicate_course_name` / `duplicate_course_code` / `course_in_use`, plus the audit
        `entity_type` (`subject`→`course`) and the three `subject.*` audit actions.
        `tests/test_subjects.py` → `tests/test_courses.py`
      * internal: `students.service.classes_in_year` → `student_offerings_in_year`
- [x] **`npm run generate:api` WAS run** (Phase 4) — the note here said it was forbidden
      because "its input is a stale 21-path snapshot and regenerating deletes hand-authored
      types". Both halves were true and both are now fixed: the spec was refreshed, and
      `orval.transformer.cjs` prunes it to the four generated tags so codegen touches nothing
      else. See Phase 4 finding #5

## Phase 4 — Frontend — ✅ COMPLETE 2026-08-19

**The estimate was 68 files. It was ~110, and the 40 extra were not "more of the same".**

The 68 came from grepping for `classSubject|class_id|/classes|section_name|display_name|
subject_name`. That found every file naming the retired concepts — and missed four whole
modules that spoke the dead contract under *different* names: **attendance** (keyed
`section_id` throughout, including its own `AttendanceSectionRef`), **reports**, **teachers**,
and **dashboard**. Three of those four **typechecked clean the entire time**, because each
declared its own hand-authored wire types and those types still described the old shape. `tsc`
cannot catch a module that is internally consistent about the wrong contract.

That is the Phase 2.5 lesson arriving from the other side. There, a grep for
`Model.attribute` could not see instance-level use. Here, a grep for the *concepts* could not
see a module that had renamed them locally. **What actually found them was a
`grep` for retired FIELD names run AFTER `tsc` was already green** — the sweep below.

- [x] **`features/classes/` → `features/offerings/`** — COMPLETED. All 13 files moved with
      `git mv` (history preserved). `ClassesListPage`→`OfferingsListPage`,
      `ClassDetailPage`→`OfferingDetailPage`, `StudentClassesPage`→`StudentOfferingsPage`,
      `ClassFormDialog`→`OfferingFormDialog`, `useClasses`→`useOfferings`.
      **The module got smaller**: `ClassSubjectItem`, `attach`/`detach` and the Subjects tab
      are gone, and `AssignTeachersDialog` stopped synthesizing a fake `ClassSubjectItem`
      with two invented fields (`assessment_count: 0`, `is_active: true`) to satisfy a shape
      it never read.
- [x] **A shared `OfferingRef` on the CLIENT** — COMPLETED, and this was the find. The
      frontend had the *same five-way drift* Phase 3 fixed server-side:
      `features/grades` alone defined `SectionRef` + `SubjectRef` + `ClassSubjectRef`,
      `features/announcements` had `ClassRef`, `features/assessments` a fourth keyed
      `class_subject_id`, `features/attendance` a fifth (`AttendanceSectionRef`, carrying
      `grade_level`, a division letter AND `homeroom_label`). Two of them built the label
      themselves — `` `${section.name} · ${subject.name}` ``. All now carry one
      `OfferingRef` from `@shared/types/api`, the mirror of `app/common/schemas.py`.
      What stayed local is only what is genuinely local: attendance's `teachers[].name`,
      grades' `teachers[].full_name` + `lead_teacher_id`.
- [x] `shared/auth/permissions.ts` — the `classes` module key became `offerings`;
      capabilities unchanged — COMPLETED
- [x] `app/layout/navConfig.tsx`, `shared/constants/routes.ts`, `i18n/strings.ts` — COMPLETED.
      **`ROUTES.classes: '/classes'` → `ROUTES.offerings: '/offerings'`**: a route path is
      user-visible (bookmarks, the address bar, shared links), so `/classes` under a screen
      titled "Course Offerings" was the one place the retired noun still showed a user.
      `nav.classes`→`nav.offerings`, `nav.myClasses`→`nav.myCourses`.
- [x] **The URL params moved with them** — COMPLETED. `?class_subject_id=` → `?offering_id=`
      across Grades, Assessments and the per-assessment grading page; `?section_id=` →
      `?offering_id=` in Attendance. Attendance's was kept through D29 on the reasoning that
      "it addresses a `classes` row, which is what it always did" — which is exactly why it
      had to change once the row became an offering.
- [x] **MSW: `handlers/classes.ts` → `offerings.ts`, `subjects.ts` → `courses.ts`** —
      COMPLETED. The offerings handler is a rewrite: **15 endpoints → 12** (the three
      `/classes/{id}/subjects*` routes describe a concept that no longer exists, so they were
      DELETED, not renamed), plus the categories family re-pathed from
      `/classes/{class_id}/subjects/{cs_id}/categories` to `/offerings/{id}/categories`.
- [x] **`mocks/demo/` rebuilt on the tertiary shape** — COMPLETED. `DemoSection` +
      `DemoClassSubject` collapsed into one `DemoOffering`; `DemoSubject`→`DemoCourse`;
      every FK renamed. The seed now expresses **both** D31 capabilities as data:
      `MATH1110` has three parallel sections in Semester 1, **and `MATH1110-01` +
      `BIOL1102-01` run again in Semester 2 as separate offerings with their own rosters and
      assessments** — which the year-scoped model could not represent at all.
- [x] **`offeringLabel()` — one derivation, mirroring `offerings/labels.py`** — COMPLETED.
      `DemoOffering` stores no name, exactly like the table, so no handler assembles the
      string itself.
- [x] **The missing `POST /settings/school/logo` MSW handler** — COMPLETED, and it was found
      by tooling rather than by reading (see `check_msw_routes.mjs` below). Validation is
      real and mirrors `validate_logo_upload` (415 / 413); storage stays stubbed and the
      handler returns the CURRENT `logo_url` unchanged, because echoing back a fake uploaded
      URL would certify a feature that does not exist.
- [x] **The generated client regenerated** — COMPLETED. `openapi.json` refreshed to the
      101-path spec, the orval tag filter moved `subjects`→`courses`,
      `generated/subjects/` → `generated/courses/`, and the seven stale `subject*` models
      deleted. See the transformer finding below.

### What Phase 4 found

Nine things, each one invisible to the check that should have caught it.

1. **DEMO MODE WAS DEAD, and had been since D30.** `demo/data.ts` called
   `teacherByCode('MATH')`; `'MATH'` is a **programme** code and `courseName` only knows
   course codes, so it threw `no BAJC course with code MATH` while *constructing the
   dataset*. Every `npm run demo` session died at import. `tsc` and `vite build` both pass on
   it — they only need the module to type-check and bundle. **Only running it finds this**,
   which is why `scratchpad/probe_dataset.mjs` now exists. A second dead line sat beside it:
   `subjectId('GEO')` (also not a BAJC code) silently matched nothing, so the intended
   "give the inactive lecturer a historical assignment" never took effect.
2. **Two query params Phase 3 missed.** `GET /students?class_id=` and
   `GET /grades/term?class_id=`. The second was worse than stale: it was a **duplicate of
   `offering_id`** filtering the identical `CourseOffering.id`, and it **skipped the explicit
   teacher-ownership 404** that `offering_id` triggers. (No leak — the `.in_(owned)` filter
   still applied — but a dead second door on an authorization check.) `/students?class_id`
   → `offering_id`; the `/grades/term` duplicate was **removed**. Phase 3 verified "zero
   paths containing `class`" and never checked param names.
3. **Four response field names Phase 3 missed**: `StudentDetail.current_classes` →
   `current_offerings`, `StudentListItem.class_count` → `offering_count`, plus the internal
   `classes_in_year` → `student_offerings_in_year`.
4. **The three catalog error codes were still `subject_*`** behind a `/courses` path:
   `duplicate_subject_name` / `duplicate_subject_code` / `subject_in_use` →
   `duplicate_course_*` / `course_in_use`, with the audit `entity_type` and the three
   `subject.*` audit actions. This mattered because **a stale key in
   `shared/api/errorMessages.ts` is invisible**: the lookup misses, the server's own sentence
   is shown instead, and nothing warns. Both sides had to move together.
   `tests/test_subjects.py` → `tests/test_courses.py`.
5. **`orval`'s `input.filters.tags` does not prune `components.schemas`.** Refreshing the
   spec from 21 paths to 101 generated **750 model files instead of 90** — a generated type
   for every module that deliberately hand-authors its own, i.e. precisely the
   generated-copy-beside-a-hand-authored-copy drift `orval.config.ts` warns against. Fixed in
   `orval.transformer.cjs`, which now keeps only the tagged operations and the `$ref` closure
   reachable from them: **117 files**, deterministic. This also means `npm run generate:api`
   is safe to run again, so the two hand-written `useCreateSemester` / `useUpdateSemester`
   wrappers (written when those routes were absent from the spec) were switched to the
   generated operations rather than left as a second declaration.
6. **Three schemas publish an EMPTY contract.** `GradebookCell`, `MyGradeAssessment` and
   `GradeCellResult` appear in `openapi.json` as bare `{"type": "object"}` — their Pydantic
   base `_LetterOptional` uses a wrap `@model_serializer` (to drop `letter` when unset), and
   that erases the generated JSON schema. So for these three the spec is **not** the
   contract, and Phase 4's own instruction ("read `openapi.json` for the contract") would
   have produced empty types. Recorded as a follow-on below; the FE types were written
   against `grades/schemas.py` instead.
7. **MSW had no `POST /settings/school/logo` handler.** With
   `onUnhandledRequest: 'bypass'` an unmatched request falls through to the **network**, so in
   demo mode the upload silently hit a server that is not there. A missing route is invisible
   to `tsc` and `eslint` alike, which is what `check_msw_routes.mjs` is for.
8. **Three modules typechecked clean while speaking a dead contract** (reports, teachers,
   and attendance's own ref) — see the note at the top of this section.
9. **Two demo handlers accepted retired param aliases** —
   `url.searchParams.get('class_id') ?? url.searchParams.get('section_id')` in both the
   students list and `/reports/attendance`. A fallback chain like that keeps a rename
   working *and* hides that it never happened.

### Corrections the offering model forced (not renames)

Four places where the mechanical substitution would have been *wrong*:

- **`/grades/offering/{id}` reports the OFFERING's term**, not the school's active one. The
  handler returned `activeSemesterRef()` unconditionally — harmless while every offering sat
  in one year-scoped bucket, and wrong the moment you open the Semester-2 offering of a
  course, which would have printed "Semester 1" above it.
- **An assessment's `semester_id` is read OFF its offering**, never chosen independently. The
  old seed picked a term per assessment TEMPLATE, so one gradebook held both terms' work.
- **An enrolment's term likewise**, and `POST /offerings/{id}/enrollments` now refuses a
  `semester_id` that disagrees (409 `semester_mismatch`) rather than honouring it — writing a
  roster into a term the offering does not run in makes it unreachable from every screen.
- **The transcript is grouped by each offering's own semester.** It used to resolve one flat
  list of "current" offerings and populate only the ACTIVE semester with it, because a
  year-scoped row could not say which term it belonged to — so it showed real grades in one
  term and empty rows in every other.

Two dashboard figures also collapsed: the Lecturer card reported `my_sections` **and**
`my_class_subjects`, which are the same number once a class teaches one subject — one figure
under two names. And `today_classes` iterated sections and picked one class_subject each,
"because attendance is per-section-per-day" — a de-duplication that silently **dropped
offerings** from the list of registers a lecturer owes.

### New verification tooling

Three checks, each covering a gap a green `tsc` left open:

- **`frontend/scratchpad/probe_dataset.mjs`** — bundles and **executes** the demo dataset,
  then asserts 21 invariants: both D31 capabilities present, `(course, semester,
  section_code)` unique, every renamed FK resolves, `enrollment.semester_id ===
  its offering.semester_id`, the Freddy/John scenario intact, and **no retired column name on
  any row** (`class_subject_id`, `section_id`, `grade_level`, `homeroom_label`, `year_group`,
  `numStudents`). This is the check that would have caught finding #1.
- **`frontend/scratchpad/check_msw_routes.mjs`** — diffs the registered MSW routes against
  `openapi.json`. **0 ghost routes**; the only unmocked contract routes are `GET /health` and
  `GET /ready`, liveness probes the SPA never calls. This is the check that found #7.
- **`orval.transformer.cjs`** — now prunes paths AND schemas to the generated tags, so
  regenerating is bounded and repeatable (#5).

## Verification — frontend ✅ (2026-08-19)

1. ✅ `npx tsc -b --noEmit` — **clean**, whole project
2. ✅ `npm run lint` — **0 errors**, 2 warnings, both PRE-EXISTING (`YearContext`
   react-refresh, `AttendanceRegisterScreen` exhaustive-deps). The one warning this work
   introduced was fixed rather than accepted
3. ✅ `vite build` — clean; the code-split chunk is `feature-offerings-*.js`, so the
   role-scoped lazy split survived the module rename
4. ✅ `vite build --mode demo` — clean
5. ✅ `node scratchpad/probe_dataset.mjs` — dataset CONSTRUCTS (the D30-era throw is gone) and
   **all 21 assertions pass**. 114 courses · 22 offerings · 45 students · 392 enrolments ·
   84 assessments · 1,434 grades · 3,260 attendance rows
6. ✅ `node scratchpad/check_msw_routes.mjs` — 140 mock routes, **0 not in the contract**
7. ✅ Backend re-verified after the addendum: **1405 passed, 0 failed, 0 skipped**;
   `sweep_dead_refs.py both` clean; `verify_schema.py --expect 008` passes on `sims_d31`
8. ✅ `openapi.json` regenerated and re-copied to `frontend/` — 101 paths, and zero
   occurrences of `class_id`, `current_classes`, `class_count`, `duplicate_subject_*` or
   `subject_in_use` anywhere in it

**Not run:** no automated frontend test suite exists (there is no vitest/RTL setup in
`package.json`), so the screens are verified by typecheck + lint + build + the two executable
probes, NOT by rendering tests. A human pass through `npm run demo` is the remaining check
Phase 4 cannot make for itself.

## Phase 5 — Seeds and data — ✅ COMPLETE 2026-08-19

- [x] `seed_bajc.py` and `seed_grading_scale.py` are unaffected — COMPLETED 2026-08-19. They own
      the catalog and the scale, and neither touches the offering layer. The demo seed now
      *depends* on the first: it resolves courses and programmes BY CODE and exits with the
      command to run if either is missing, because a demo seed that invents a course is how the
      two datasets drift apart. `courses` / `programs` / `program_courses` /
      `course_prerequisites` are excluded from the clear-sweep for the same reason `010` already
      excluded `courses`: FK checks are off during it, so a `DELETE` there would silently destroy
      the real catalog. Verified after seeding — 125 courses, 8 programmes, 243 curriculum rows
      and 64 prerequisites all survive
- [x] **New tertiary demo seed** — COMPLETED 2026-08-19. `db/mariadb/seed_demo.py` rewritten
      (not renamed: the old file's eight `Form 1A`-style homerooms × 7 `class_subjects` each had
      no equivalent in the new model). **22 offerings** across three terms, **393 enrolments**,
      84 assessments, 1,436 grades, 3,260 attendance records, 19 meetings — and it seeds the two
      scenarios that PROVE the model rather than describing them: `MATH1110` §01/§02/§03 in one
      term, and `MATH1110`/`BIOL1102` running AGAIN in Semester 2 as separate offerings.
      All 45 students are on a real BAJC programme with a **`student_program_history`** row
      (both were empty before: `program_id` NULL on all 45), one of them carrying a CLOSED
      earlier row so the table is a history rather than a copy of `program_id`. `enrollment_load`
      is populated too — it was NULL on all 45, so `StudentDetail.enrollment_load` was an empty
      field on every profile the API served
- [x] **Generated per-account passwords with `must_change_password = true`** — COMPLETED
      2026-08-19 via `app.core.security.generate_temp_password`, 19 distinct Argon2 hashes
      (asserted). **The tracked `010_seed_demo.sql` is deleted**, which is the part that actually
      fixes it: rotating a constant in the script never touched the hash committed in that file.
      The seed now writes `db/mariadb/generated/010_seed_demo.sql` +
      `generated/demo-credentials.txt`, both gitignored
- [x] Close the server-side hole — COMPLETED 2026-08-19. `core/deps.get_current_user` raises
      **403 `password_change_required`** for a flagged account on everything outside
      `_FORCED_CHANGE_EXEMPT`: `GET /auth/me` (how the client LEARNS about the flag — the
      bootstrap is refresh-then-`/me`, so refusing it would strand the screen that clears the
      flag), `PATCH /auth/me/password` (the way out) and `POST /auth/logout` (walking away must
      always work). `/auth/login` and `/auth/refresh` still succeed by design: neither depends on
      `get_current_user`, and the flag reaches the client on their `user` payload.
      `ProtectedRoute.tsx` gained the matching redirect — without it the app would render its
      chrome and then fill every panel with a 403. The characterisation test that pinned the gap
      (`test_a_forced_change_is_NOT_enforced_server_side_yet`) is replaced by three tests that
      assert the enforcement, the exemptions, and that the gate LIFTS on the same token once the
      password is changed

### What Phase 5 found

Seven defects, every one invisible to a typecheck, and five of them **found by running the
seeded data through the real API** rather than by reading it. Three share one root cause worth
naming on its own: **a scope that was correct only because the old model could not express the
thing D31 adds.** A year-scoped answer was indistinguishable from a term-scoped one while a
course could be offered once per year; the moment two terms of one course existed, the same code
started answering a different question:

1. **A student's week showed the same class twice.** `timetable/service.py` scoped to the
   academic YEAR, which was correct while a course could only be offered once per year — so
   scoping to the year happened to select one term. With `MATH1110-01` running in both terms,
   Freddy's Monday 08:00 appeared TWICE, one of them a class that does not start for four
   months. Fixed by `_narrow_to_one_term`: the active semester if the caller holds anything in
   it, else the highest `sequence` they actually hold (which is what makes the archived-year
   switch work without a `semester_id` on the wire). Four tests pin it, and all four were
   confirmed to FAIL with the narrowing disabled. **Letting the client CHOOSE the term is a
   follow-on** — that is a contract change (query parameter + the chosen term on the response)
   and belongs with the API surface
2. **Two of the three second-year course loads were unreachable.** `SECOND_YEAR_LOADS[i % 3]`
   where second-year students are exactly the indices with `i % 3 == 2` — so all 15 got load
   `[2]`, and `SPAN2112-01` was an offering with an EMPTY roster. Fixed by counting within the
   cohort instead of using the raw index
3. **Two offerings were seeded over capacity** (`ENGL1102-01` 30/26, `BIOL1102-01` 25/24).
   Over-capacity enrolment is warn-only (D-Q6) rather than refused, so nothing failed — the
   seed just quietly built a college that breaks its own rule on the screen that shows the
   warning. Capacities raised to 32 and 26; every first-year takes English, so any capacity
   below the intake is over-subscribed by construction
4. **The "parallel section with a different lecturer" had the same lecturer.** `MATH1110-02`
   resolved its lead by course code, and the first active specialist for either MATH code is
   Maria Reyes — who already leads `-01`. Lecturers are NAMED now where the row depends on it
5. **An offering outside the active term had an EMPTY GRADEBOOK.** Same family as finding 1,
   found the same way. `grades/service._semester_for_section` resolved the term from the
   offering's academic YEAR — that year's active semester, else its `sequence=1` term — because
   `classes` carried no semester and the term genuinely had to be guessed. So `BIOL1102-01` in
   Semester 2 resolved to Semester 1, `_assessments_for` then filtered
   `Assessment.semester_id == <Semester 1>`, and the offering's own 2 assessments AND its
   23-student roster both matched nothing: **`0 rows x 0 assessments`, no error, no log**.
   `course_offerings.semester_id` makes the guess unnecessary — an offering belongs to exactly
   one term — so the resolution is now a lookup. The explicit `semester_id` parameter is
   unchanged, so the wire contract is untouched. Four tests, two of which fail with the old
   resolution restored
6. **The demo college had a 37% FAILURE RATE, and its marquee student was failing.** The seed
   centred scores on 75% — correct against the pre-D30 5-band scale where 60 passed and 90 was
   an A. **D30 moved BAJC's pass mark to 70 and put A at 95 without re-centring it**, so the
   same numbers silently started meaning something worse: 36 F's in 159 term grades, and Freddy
   Lopez — the student demo mode LANDS on — holding a D. Re-centred on 84%: median term grade
   83.2 (B), **90% at C or better**, and the distribution still spans A to F so no band is
   untested. Nothing could have caught this: no test asserts that a demo dataset is believable,
   and both halves of the demo agreed with each other while both were wrong
7. **Dead code that had been "fixed" once already.** The MSW dataset's attempt to give the
   inactive lecturer a historical assignment looked up `courseId('THEO2201')`, which
   `offeringSeed` does not offer, so `.find` returned undefined and the push never ran — the
   version before it looked up `subjectId('GEO')` and failed the same way. Replaced with a
   comment stating that an inactive lecturer holds no classes, which is what "inactive" means

Defects 2-4, 6 and 7 existed IDENTICALLY in `frontend/src/shared/api/mocks/demo/data.ts`, because the
seed mirrors it. Both sides were fixed, and the datasets now agree row-for-row on every
generated table — 22 offerings, 19 meetings, 45 students, 393 enrolments, 84 assessments,
1,436 grades, 3,260 attendance records — which is the strongest available evidence that demo
mode and the real backend describe the same college.

### Verification — Phase 5 ✅ (2026-08-19)

1. ✅ Seed runs clean against `sims_d31` — 5,464 rows across 22 tables
2. ✅ **41-check integrity probe.** The inserts run with `FOREIGN_KEY_CHECKS = 0`, so nothing is
   validated by the database: the probe re-checks all 32 FK columns for orphans, then the D31
   invariants (enrolment/assessment/attendance term == its offering's term, grade↔enrolment↔
   assessment agreement, one active year, one active semester, one OPEN programme-history row
   per student, `score` non-null IFF `status='graded'`, `score <= max_score`, no meeting outside
   Mon-Fri, no archived-year meetings, no lecturer-less offering, no over-capacity offering, 19
   distinct password hashes, 0 accounts not forced to change). All pass
3. ✅ **Driven through the REAL API** (`create_app()` + `TestClient` against `sims_d31`), as
   Principal, Lecturer and Student: login → 403 `password_change_required` → change → re-login →
   dashboard, offerings, roster, meetings, gradebook, students, programme history, transcript,
   report card, timetable, attendance, announcements, events, grading scale. This is what found
   the timetable defect
4. ✅ **The scenario renders**: Freddy's week is `MATH1110-01` Mon/Wed 08:00, `BIOL1102-01`
   Tue/Thu 09:00, `CHEM1100-01` Tue 11:00, `ENGL1102-01` Wed 13:00 + Fri 11:00; John's differs
   in exactly the Algebra section and his fourth course; 4 slots shared, no duplicates
5. ✅ **Backend suite: 1,415 passed / 0 failed / 0 skipped** against `sims_d31` (was 1,405 —
   one characterisation test removed, eleven added: three for the forced-change gate, four for
   the one-term timetable, four for the offering's own-term gradebook)
6. ✅ Frontend `typecheck` clean, `lint` 0 errors (2 pre-existing warnings in unrelated files),
   `vite build` and `vite build --mode demo` both succeed, demo-dataset probe 21/21, MSW route
   parity 0 ghosts
7. ⚠️ `npm run build` fails with "Access is denied" on this machine because something holds a
   handle on `frontend/dist/`; building to a fresh `--outDir` succeeds, so it is a local file
   lock and not a code failure

## Phase 6 — Tests and docs — ✅ COMPLETE 2026-08-19

**1405 passed, 0 failed, 0 skipped** against `sims_d31`, in ~100 seconds — note the suite is
**not** the 15–25 minutes older notes claim. Zero skips is the assertion that matters: the DB
fixtures skip *green* when the database is unreachable, so a silent pass was possible.

The nine "root causes" this section used to list were a tally of pytest error strings, not of
defects. The real edit surface was **~30 root causes**, and two of the nine (`NameError: Course`,
`Semester.semester_id`) were already fixed when the run started. The failure counts were mostly
cascade: one gutted helper in `test_classes.py` explained 45 failures on its own, and a single
missing alias line in `test_program_change.py` explained 34.

- [x] **`tests/conftest.py`** — `make_class_subject` → **`make_offering`**, one row instead
      of two, with a random `section_code` because the identity
      `(course_id, semester_id, section_code)` is unique and hand-rolled fixtures collided
      — COMPLETED 2026-08-19
- [x] **A schema guard in `conftest.py`** — COMPLETED 2026-08-19. `backend/.env` names `sims`,
      which is held at `007` on purpose, so the suite only reaches the migrated copy when
      `DATABASE_URL` is exported. Forgetting it ran 1394 tests against the wrong database and
      failed everywhere for the wrong reason. `_assert_d31_schema` probes for
      `course_offerings` and aborts the session with one named error. **`pytest.exit`, not a
      fixture-raised error** — raising from the fixture repeated the message once per test
      (33 identical errors on the first probe) and buried the one line that mattered.
- [x] **`test_classes.py` → `test_offerings.py`** — COMPLETED 2026-08-19, a rewrite rather
      than a migration. The old file documented 15 endpoints; the module has 12, and the three
      that went (`GET`/`POST /classes/{id}/subjects`, `DELETE .../subjects/{cs_id}`) are a
      concept that no longer exists, so those tests were **deleted, not adapted**. 67 tests.
- [x] **Work the failures to zero** — COMPLETED 2026-08-19. Progression:
      890 → 946 (live service defects) → 988 → 1148 (fixture repairs) → 1245 → 1337 → **1405**.
- [x] **Regression tests D31 owed** — COMPLETED 2026-08-19:
      the `(course_id, semester_id, section_code)` unique constraint; **two unsectioned
      offerings of one course in one term refused** (the `COALESCE` in `active_section` is
      load-bearing and was previously proven only in a rehearsal); **the same course in two
      semesters** — the capability the year-scoped model could not express, and the reason
      D31 exists; parallel sections; a soft-deleted offering releasing its slot;
      `assert_teacher_owns_offering` including 404-not-403 with **byte-identical bodies**;
      semester scoping through `offerings_in_year` in both directions.
- [x] **`must_change_password`** — COMPLETED 2026-08-19 as a **characterisation test** in
      `test_auth.py`, deliberately not an `xfail`. It asserts today's behaviour (a flagged
      account gets a working token and can read `/auth/me`) and says in its docstring that it
      is **expected to fail when Phase 5 lands** — the failure is the reminder to rewrite it
      against the intended 403.
- [x] Update `docs/tertiary-refactor-plan.md` §D2/§D3 to point here, and `RUNBOOK.md` §4 —
      COMPLETED 2026-08-19. §D2 gets the correction that matters most: its refinement note
      argued the `subject_id` columns should keep their name to avoid rebuilding
      `class_subjects.cs_active_subject` and its unique index — and D31 dropped both anyway,
      so the reason not to rename evaporated. §D3's two term concepts survive intact; what
      changed is that the OFFERING now names its own calendar term. `RUNBOOK.md` §4 gains
      `008` as step 9, with the pre-collapse-sentinel and no-`USE sims` notes, and the
      `verify_schema.py --expect 008` check. (`004` was already listed as step 5 — that
      omission was fixed in an earlier pass.)

### Helpers added while sweeping the services

Three, each because the same fragment was about to be copied a dozen times — the
`STUDENT_NAME_ORDER` lesson:

- **`offerings/labels.py`** — `offering_label`, `OFFERING_ORDER`. An offering stores no
  name, so the label is derived; ordering is by course code then section, never by the
  formatted string.
- **`offerings/queries.py`** — `offerings_in_year` (a subquery, not a join, so it drops
  into an existing `.where()` without risking a duplicate join of `Semester`),
  `year_of_offering`, `year_id_of_offering`. `classes.academic_year_id` used to answer the
  year with an attribute access in ~15 services; an offering needs a hop.
- **`apply_sql.py` / `verify_schema.py` now honour an exported `DATABASE_URL`** — they read
  only `.env` before, so a migration could only ever be applied to, or verified against,
  the one database named there.

---

## Verification — backend half ✅ (2026-08-19)

1. ✅ `verify_schema.py --expect 008` PASSES against `sims_d31`
2. ✅ `verify_schema.py --expect 007` PASSES against `sims` — **proof `008` never leaked**
3. ✅ `pytest -q` from `backend\` with `DATABASE_URL` on `sims_d31`: **1405 passed, 0 failed,
   0 skipped**, in default (random) order as well as `-p no:randomly`. 1405 collected = 1405
   passed. Zero skips is what makes this meaningful, and `conftest._assert_d31_schema` is what
   makes a wrong-database run impossible to mistake for one.
4. ✅ `python backend/scratchpad/sweep_dead_refs.py both` — clean over `app/` AND `tests/`. This is the check
   that replaces the grep which missed 22 defects.
5. ✅ `openapi.json`: 101 paths, **zero containing `class` or `/subjects`**
6. ✅ Live walk against `sims_d31`, in a rolled-back transaction, using the REAL catalog row
   `MATH1110 Intermediate Algebra` (3 credits):
   * `MATH1110-01` and `MATH1110-02` coexist in Semester 1 — parallel sections
   * `MATH1110-01` **also runs in Semester 2** — impossible in the year-scoped model
   * a duplicate `(course, term, section)` is refused 1062
   * two UNSECTIONED offerings of one course in one term are refused 1062 — the `COALESCE`
     holds
7. ✅ No table has a `grade_level`, `section`, `homeroom_label`, `numStudents` or
   `classStaffID` column
8. ⏸ `npm run typecheck` / `lint` / `vite build` — **Phase 4**, not yet run. The frontend still
   speaks the pre-D31 contract and is expected to fail until it is migrated.

## Follow-ons — deliberate residue, recorded rather than fixed

Each of these was found during Phase 4 and left alone on purpose. None blocks Phase 5.

1. **Three schemas publish an empty contract.** `GradebookCell`, `MyGradeAssessment` and
   `GradeCellResult` serialize to bare `{"type": "object"}` in `openapi.json`, because their
   base `_LetterOptional` uses a wrap `@model_serializer` to drop `letter` when unset and that
   erases the generated JSON schema. **Consequence: for these three the spec is not the
   contract**, so anyone told to "read `openapi.json`" gets nothing, and adding `grades` to
   codegen would emit empty types. The fix is to annotate the serializer's return schema, and
   it needs re-verifying against every letter-carrying model — a backend job, not a rename.
2. **`subject` survives as a wire word in five response models** where it reads as ordinary
   English rather than as the retired table: `StudentAssessmentGroup.subject`,
   `MyGradeSubject` / `by_subject`, `ReportCardSubjectRow`, `TranscriptSubjectRow`,
   `ReportSubjectRef`, and `TeacherProfile.subject_specializations`. A report card listing
   "subjects" is not wrong; `class_subject_id` was. Renaming these is a wire change with no
   reader-facing gain, so the frontend types match the wire and say so where it matters.
3. **`total_sections` on the Dean/Registrar dashboard stats** still carries the old name while
   counting offerings. It is one wire key on a hand-written `oneOf` schema; renaming it means
   touching the dashboard schema, the FE types and both components for a label nobody sees.
4. **`AnnouncementAudience` keeps its `'class'` member.** Deliberate and load-bearing: it is a
   shared enum value across the ORM, the API and the MSW handlers, and the backend CHECK
   constraint `ck_announcements_offering_audience` enforces "audience='class' iff a target is
   set". Renaming an enum member is a migration, not a relabel.
5. **`semester_id` stays denormalised** on `assessments` and `class_enrollments` even though it
   is now derivable from the offering — carried forward from Phase 1's note. `term_grade_
   snapshots` is a frozen record where denormalisation is correct, and the demo probe asserts
   the two never disagree.
6. **No automated frontend tests exist.** `package.json` has no vitest/RTL setup, so Phase 4's
   frontend verification is typecheck + lint + build + two executable probes. The probes cover
   the data layer and route parity; nothing covers rendering. Worth a decision before Phase 8
   QA rather than during it.
7. **The timetable's TERM is not selectable from the wire** (added by Phase 5). The service now
   renders one term's week instead of a year's (see Phase 5's finding 1), but it CHOOSES that
   term — the active semester, else the highest `sequence` the caller holds. That is right for
   both the current and the archived year, and it needed no contract change, but it means a
   student cannot ask for "Semester 2's week" before Semester 2 starts. The fix is a
   `semester_id` query parameter plus the chosen term on `TimetableView`, and a term selector
   beside the existing year switcher — a Phase 3+4 shaped change, deliberately not smuggled into
   a data phase.
8. **No `term_grade_snapshots` and no `report_card_snapshots` are seeded**, so
   `GET /students/{id}/academic-history` answers with 0 entries and every term grade on a
   transcript is computed LIVE rather than read from a frozen record. Deliberate, and the same
   choice the pre-D31 seed made: a snapshot is an artifact the application FREEZES when a year is
   archived, so hand-writing one seeds a frozen record of a computation that never happened —
   and `008` deleted the 290 that existed for exactly that reason. The consequence to know
   before a demo: the frozen-vs-live branch (`is_frozen`) is reachable only by archiving a year
   through Settings, which is a two-click path worth walking once rather than a gap in the data.
   The transcript itself is fully populated (12 credits, per-semester GPA, real BAJC courses).
9. **`GET /auth/me` is exempt from the forced-password-change gate.** Deliberate and argued in
   `_FORCED_CHANGE_EXEMPT`, but worth restating: a flagged account can still read its own
   identity, role and preferences. That is the payload the forced-change screen branches on and
   it carries no school data, so the alternative — refusing it — breaks the flow it exists to
   serve. If that ever needs to change, the client must first stop bootstrapping through `/me`.

## Known risks

- **The demo data is destroyed, not migrated.** Forced, not chosen: `classes` is year-scoped and an
  offering is semester-scoped, so one academic year maps to *two* semesters and nothing in the data
  says which one an offering belongs to. Separately `class_enrollments` points at the homeroom rather
  than a course, so per-course enrolment would have to be invented by fanning each of the 113 rows
  out across its ~7 courses. Cost: 45 students, 454 assessments, 2,888 grades, 290 snapshots, 43
  report cards — all `Form 1A`-era. Backup taken in Phase 0.
- **~~Nothing is committed~~ — COMMITTED 2026-08-19 at the end of Phase 5**, as one commit on
  `tertiary-refactor` covering all of D31. **`dc4c894` ("tertiary refractor") is the D30 commit
  and remains the rollback point.** (An earlier note here claimed D30 had no commit and 177
  files were outstanding; both were wrong.) The risk that replaces it is narrower and stated
  above: the committed code expects `008`, and `sims` has not had it applied yet — so **this
  checkout will not run against `sims` until the cut-over is done.** `sims_d31` is the database
  to point `DATABASE_URL` at until then.
- **§G's 13 open BAJC items are untouched** by D31 and still need the college's answer — including
  `THEO1110-B`, a provisional course code that prints on a report card as it stands.

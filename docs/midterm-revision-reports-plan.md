# D32 — Mid-Term Grading Windows, Report Types, Student Filters & Legacy Cleanup

> **Working plan and tracker.** Read §A (the findings report) before touching anything —
> it records what the audit actually found in the live `sims` database on 2026-08-21,
> including two defects that were not in the brief. §C is the phase-by-phase checklist;
> tick boxes as they land so a fresh session can resume from this file alone.

---

## STATUS

| | |
|---|---|
| **Phase** | **ALL SIX COMPLETE** (0–6) |
| **Status** | 🟢 **D32 COMPLETE** — 2026-08-21 |
| **Branch** | `tertiary-refactor` (continues from D31, commit `5391aa1`) |
| **Started / finished** | 2026-08-21 |
| **Predecessor** | D31 (`docs/tertiary-offerings-refactor-plan.md`) — complete |
| **Backend suite** | **1525 green** (was 1415 — 110 new tests across five files) |
| **Frontend** | `tsc` clean, `eslint` 0 errors / 2 pre-existing warnings, demo dataset probe 21/21, MSW route parity 0 ghosts |
| **Live DB** | `sims`, **migration `009` APPLIED 2026-08-21** (15/15, after `--backup`). `010` is written but deliberately inert |
| **Next action** | **§F** — one judgment call for BAJC to confirm and one authorisation to obtain. Nothing is blocking. |
| **⚠️ Superseded in part** | **D33 (`docs/d33-ux-and-midterm-freeze-plan.md`) added a GRADE-ENTRY FREEZE to the mid-term window.** Everything below describes the window as gating *revision eligibility only* — which is what D32 shipped, and is no longer the whole behaviour. Since D33, `[midterm_submission_start, midterm_submission_end]` also **refuses grade entry** (`409 midterm_frozen`, `grades/service.py::_assert_midterm_not_frozen`). The revision rules in §C Phase 2 are unchanged; read this file for them, and D33 for what the window now does to entry. |

### Client brief this implements

Seven asks, in the client's numbering: (1) mid-term revision workflow redesign,
(2) semester mid-term configuration, (3) student view filters, (4) student registration
permissions / grade visibility, (5) mid-term + end-term report cards, (6) snapshot
saving process, (7) legacy database table review.

### Decisions taken with the client (2026-08-21)

| # | Question | Decision |
|---|---|---|
| D32-1 | How do the mid-term dates relate to the existing `grade_submission_deadline`? | **Add** `midterm_submission_start`/`midterm_submission_end`; **keep** `grade_submission_deadline` and re-document it as the **End-Term** cutoff. Two independent windows per term, zero data migration. |
| D32-2 | Who loses grade visibility? | **Registrar (secretary): permanent, no toggle.** **Student: toggle-gated, default OFF.** Revision status is never exposed to a student either way — they see the resulting score only. |
| D32-3 | How do mid-term snapshots get written (there is no scheduler)? | **Dean button** `POST /settings/semesters/{id}/midterm-freeze` **plus a lazy auto-freeze fallback** on first mid-term report read after the end date. Before the end date → `409 midterm_window_open`. |
| D32-4 | Delivery shape? | **Phased, tracked here with checkboxes.** |

---

## §A — Findings report

### A1. `report_card_snapshots` — structure, and two gaps

Live DDL, `SHOW CREATE TABLE` against `sims` on 2026-08-21:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `student_id` | `uuid NOT NULL` | FK → `student_profiles(id)`, `ON DELETE NO ACTION` (ORM: RESTRICT) |
| `semester_id` | `uuid NOT NULL` | FK → `semesters(id)`, `ON DELETE NO ACTION` |
| `payload` | `longtext` + `CHECK (json_valid(payload))` | the **entire rendered `ReportCard`** pydantic model, `model_dump(mode="json")` |
| `storage_key` | `text NULL` | reserved for a future server-generated PDF (OQ-A / D27); never written |
| `frozen_at` | `datetime NOT NULL DEFAULT current_timestamp()` | |
| `created_at` / `updated_at` | `datetime` | `TimestampMixin` |
| **UNIQUE** | `uq_report_card_snapshot (student_id, semester_id)` | |

**Semester linkage** is direct (`semester_id`), and the academic year is reached through
`semesters.academic_year_id`. **Student linkage** is direct (`student_id` →
`student_profiles`). **Grade storage approach** is *whole-document*, not per-subject: the
payload holds the finished card — subject rows with numeric + letter + credits, term
average, GPA, total credits, attendance summary, school identity and the printed
`period`/`program_code` strings. Per-subject numbers live separately in
`term_grade_snapshots` (student × offering × semester), which is what the transcript
reads.

**Row count in live `sims`: 0.** No year has ever been archived (`docs/progress-tracker.md`
Next Steps #2 already flags this).

> **Gap 1 — the table is WRITE-ONLY.** `backend/app/modules/reports/freeze.py` is the sole
> writer. Nothing reads it back. `reports/service.py::_build_report_card` rebuilds an
> archived year's card from `term_grade_snapshots` via `_subject_results(frozen=True)`,
> so the one artefact that is genuinely frozen — the payload — is discarded on every read.
> Phase 4 gives it its first reader.

> **Gap 2 — the unique key cannot hold two report kinds.** `(student_id, semester_id)`
> means a Mid-Term freeze and the year-archive End-Term freeze for the same term would
> collide on upsert. **This is the one required schema change** for the brief's §5/§6.

### A2. Revision workflow as built (brief §1)

`backend/app/modules/grades/revisions.py` — Lecturer requests on an offering they own,
Dean decides. Approval writes `assessment_grades.makeup_score` and **never overwrites
`score`**; `calc._contribution_for` makes the makeup win on a graded row.

Eligibility **today** is only: the assessment exists and is not soft-deleted; the caller
owns the offering; the student has a `graded` row; the proposed score is within
`max_score` and differs from the current one; no other request is pending. **Nothing is
date-gated at all** — the Revision button renders on every graded cell at any time
(`AssessmentGradingScreen.tsx:290-330`, disabled only when the cell is not graded).

The single deadline that does exist (`grade_submission_deadline`) gates *grade entry*
(`grades/service.py::_assert_grade_window_open`, 409 `grade_window_closed`), and
revision requests are **deliberately allowed through it** — that is the documented point
of the workflow. That behaviour stays; the new rules narrow *which assessments* qualify,
not whether a closed window blocks the request.

Columns that make all four new rules implementable with **no new data**:
`assessments.created_at`, `assessments.semester_id`, `assessment_grades.graded_at`
(with `created_at` as fallback), `semesters.is_active`.

### A3. Grade visibility today (brief §4)

`frontend/src/shared/auth/permissions.ts` — `secretary.grades = 'view-all'`,
`student.grades = 'view-own'`. Server side `grades/router.py` has
`_staff = require_role(TEACHER, PRINCIPAL, SECRETARY)`.

Student-facing grade surfaces that must all be gated:

- `GET /grades/me` (`MyGradesScreen`)
- `GET /reports/report-card/me` (`ReportCardScreen`, student branch)
- `GET /students/me/assessments` (`MyStudentProfilePage`)
- the *Grades & Assessments* tab on `StudentDetailPage.tsx:112`
- the `My Grades` nav entry (`app/layout/navConfig.tsx:102`)

`PERMISSION_MATRIX` is explicitly UX-only (its own header says so) — every one of these
needs a server-side check as well.

Revisions are **already** invisible to students: `revisions.py::list_revisions` 403s
anyone who is not Dean or Lecturer, and nothing in the student payloads carries revision
state. A student sees the resolved score, which after an approval is `makeup_score`.
That satisfies the client's "they just will see the updated or old value" — it needs a
regression test, not a change.

### A4. Students directory (brief §3)

`students/service.py::list_students` already filters on `search`, `status`,
`year_of_study`, `offering_id`, `academic_year_id`, and they already combine.

`StudentProfile` **already carries** `gender`, `religion` (`varchar(100)`, added by
`005_tertiary.sql` §9) and `program_id` — **no schema change is needed for the filters.**

Live data as of 2026-08-21:

- `gender` — 23 `female`, 22 `male` (45 students)
- `religion` — **NULL for all 45.** Only the admissions application collects it
  (`admissions/service.py:263` copies it onto the student on acceptance), and no
  application has been processed yet. The filter is correct but will look empty until
  admissions runs — hence the distinct-values endpoint in Phase 5 rather than a
  hardcoded list.
- `program_id` — fully assigned: AGRI 6, BIOL 6, BMAD 6, EDUC 5, GNST 6, ITEC 6, MATH 5, RELG 5

`shared/components/PrintLayout.tsx` already exists — `@media print` rules injected once,
app chrome and the button hidden in print, `window.print()` on click — and is used by
`ReportCardDocument` and `TranscriptDocument`. **Reuse it; do not build a second print
path.**

### A5. Legacy database table audit (brief §7)

Live `sims` holds **46 tables**. The ORM maps **39** — verified by comparing every
`__tablename__` in `backend/app/modules/*/models.py` against the live list; the sets
match exactly apart from the seven below. The only raw SQL anywhere in `backend/app` is
`SELECT 1` in `db/session.py`, so an ORM sweep is a complete reference sweep. Frontend
and API surfaces reference none of them.

The seven are all D31 quarantine renames (`008_course_offerings.sql` renames rather than
drops, by design). Note the `*_legacy_pre_d30` names mentioned in `005_tertiary.sql` are
**not present** — those quarantine branches did not fire on this database.

| Table | Purpose | References found | Safe to remove |
|---|---|---|---|
| `grades_legacy_pre_d31` (0 rows) | pre-SIS grade rows; superseded by `assessment_grades` | none — ORM, API, service, UI, SQL all clean | ✅ **Safe to remove** |
| `staff_legacy_pre_d31` (0 rows) | pre-SIS staff; superseded by `teacher_profiles` | none | ✅ **Safe to remove** |
| `students_legacy_pre_d31` (0 rows) | pre-SIS students; superseded by `student_profiles` | none | ✅ **Safe to remove** |
| `cat_assessment_legacy_pre_d31` (0 rows) | pre-SIS assessment-category lookup; superseded by `assessment_categories` | none | ✅ **Safe to remove** |
| `subjects_legacy_pre_d31` (11 rows) | pre-D30 catalog; `005_tertiary.sql` copied its rows into `courses`, `006` cut the ORM over | none in code | ✅ **Safe to remove** — *investigation done 2026-08-21:* all 11 rows exist in `courses` under the **same id and the same code** |
| `classes_legacy_pre_d31` (17 rows) | K-12 homerooms; D31 **deleted** the operational data rather than migrating it (a year-scoped homeroom cannot say which semester it taught) | none in code | ⚠️ **Requires a decision** — the only surviving evidence of the homeroom era |
| `class_subjects_legacy_pre_d31` (116 rows) | K-12 offering layer, absorbed by `course_offerings` | none in code | ⚠️ **Requires a decision** — same rationale |

**Depth checks run against the live database (2026-08-21):**

- **No live table holds a foreign key INTO any of the seven.** The only inbound FK is
  legacy→legacy (`class_subjects_legacy_pre_d31.class_id → classes_legacy_pre_d31`),
  which dictates the drop order and nothing else.
- The database contains **0 views, 0 stored routines and 0 triggers**, so there is no
  procedural code referencing them either.
- **Keeping the two populated ones is not free.** They hold OUTBOUND foreign keys onto
  live tables — `classes_legacy_pre_d31 → users, academic_years` and
  `class_subjects_legacy_pre_d31 → users, academic_years, courses`. So a retired 2024-era
  join row can still block the deletion of a live `courses` or `users` row. That is the
  argument for eventually dropping them, and it belongs in front of BAJC.

**Nothing is in the "Cannot remove" category.** Five are unconditionally safe. The two
populated ones are safe *as code* — the only open question is whether BAJC wants the 133
historical rows kept. Recommendation: `--backup`, drop the five, and leave the two
pending an explicit decision. **Phase 6 ships the script commented out; nothing is
dropped in this work without a go-ahead.**

---

## §B — Schema changes required

One migration file, `backend/db/mariadb/009_midterm_windows.sql`, re-runnable in the
house style (`ADD COLUMN IF NOT EXISTS`, `information_schema` + `PREPARE` guards for
index swaps).

| Table | Change | Why |
|---|---|---|
| `semesters` | `+ midterm_submission_start datetime NULL` | brief §2 |
| `semesters` | `+ midterm_submission_end datetime NULL` | brief §2 |
| `semesters` | `grade_submission_deadline` — **comment only**, re-documented as the End-Term cutoff | D32-1; no data change |
| `assessment_policies` | `+ students_can_view_grades tinyint(1) NOT NULL DEFAULT 0` | D32-2, brief §4 |
| `report_card_snapshots` | `+ kind enum('midterm','endterm') NOT NULL DEFAULT 'endterm'` | Gap A1-2 |
| `report_card_snapshots` | drop `uq_report_card_snapshot`, recreate as `(student_id, semester_id, kind)` | Gap A1-2 |

Both `semesters` columns default NULL, so **every existing semester behaves exactly as it
does today** — no mid-term window, no revision gating, no mid-term report. Historical
data is untouched: no row is rewritten by `009`.

---

## §C — Phase checklist

### Phase 0 — Findings + tracker
- [x] Audit live `sims` schema, row counts and `report_card_snapshots` DDL
- [x] Trace the revision workflow and its (absent) date gating
- [x] Trace every student/registrar grade surface
- [x] Confirm `gender` / `religion` / `program_id` already exist on `student_profiles`
- [x] Legacy table audit — ORM `__tablename__` sweep vs live table list
- [x] Write this document

### Phase 1 — Semester mid-term configuration (brief §2) ✅
- [x] `settings/models.py::Semester` — two new columns + `ck_semesters_midterm_window`; `grade_submission_deadline` re-documented as the End-Term cutoff
- [x] `backend/db/mariadb/009_midterm_windows.sql` — all six changes in §B. **Applied to live `sims` 2026-08-21, 15/15 statements**, after `--backup db/mariadb/pre_009_backup.sql` (46 tables)
- [x] `settings/schemas.py` — `SemesterDetail`, `StandaloneSemesterCreateRequest`, `SemesterUpdateRequest`
- [x] `settings/service.py::_assert_midterm_window` + wired into `create_semester` / `update_semester` with merged-value validation and `model_fields_set` presence semantics
- [x] `tests/conftest.py` — the `008` schema guard extended with a D32 **column** probe (`009` adds no tables, so the table-level probe was blind to it)
- [x] `features/settings/components/TermFormDialog.tsx` — "Mid-term opens/closes" fields, client-side both-or-neither mirror of the server rule
- [x] `features/settings/screens/AcademicStructureScreen.tsx` — the window shown on the term row beside the end-term deadline
- [x] `tests/test_midterm_window.py` — **15 passed**

### Phase 2 — Revision eligibility (brief §1) ✅
- [x] `grades/revisions.py::midterm_revision_eligible()` — the four rules + `REVISION_BLOCKED_REASONS`
- [x] Enforced in `create_revision` → `422 revision_not_eligible` carrying the reason code
- [x] `decide_revision` and `withdraw_revision` left ungated — a filed request must stay rulable even after the window moves, or it strands as pending forever
- [x] `grades/schemas.py::GradebookCell` — `can_request_revision`, `revision_blocked_reason`
- [x] `grades/service.py::get_gradebook` — Lecturer-only, one `Semester` load for the whole gradebook (`Session.get` identity map)
- [x] `AssessmentGradingScreen.tsx` — per-cell flag drives the button; the column is **hidden** when nothing is eligible, with a one-line banner naming the shared reason
- [x] **Demo mode mirrored** — `selectors.ts::midtermRevisionEligible`, the mid-term window on `SEM_ACTIVE`, the gate in the `revisions.ts` POST handler, and the non-Lecturer zeroing in `grades.ts`. One deliberate divergence: the fixture has no audit stamps, so `assessment_date` stands in for `created_at`/`graded_at` (documented in the helper)
- [x] `tests/test_midterm_revision_rules.py` — **18 passed**, one case per rule
- [x] `tests/test_grade_revision.py` retro-fitted with `open_midterm_window` / `backdate` helpers — **50 passed**
- [x] OpenAPI regenerated, orval client regenerated (11 files), frontend `tsc` + `eslint` clean, demo dataset probe 21/21
- [x] **Full backend suite: 1448 passed** (was 1415)

### Phase 3 — Grade visibility (brief §4) ✅
- [x] `assessment_policies.students_can_view_grades` (model + `009`, default **false**)
- [x] `common/schemas.py::CurrentUser.students_can_view_grades` + `auth/service.students_can_view_grades()`
- [x] `core/deps.require_student_grade_visibility` → `403 grades_hidden`
- [x] Applied to `GET /grades/me`, `GET /grades/term`, `GET /reports/report-card/me`
- [x] **Registrar removed unconditionally** — `Role.SECRETARY` dropped from every role tuple in `grades/router.py`, and from `GET /students/{id}/assessments` (the grade information on the registration screen)
- [x] `permissions.ts` — `secretary.grades = 'none'`; `student.grades` stays `view-own` because the switch is *runtime config*, not role policy (see the comment there)
- [x] `navConfig.tsx` / `Sidebar.tsx` / `AppShell.tsx` — student Grades item dropped when unpublished; `RoleRoute.tsx` redirects `/grades` to `/forbidden` for the same case
- [x] `StudentDetailPage.tsx` — Grades & Assessments tab hidden from the Registrar; `canNudge` narrowed to the Dean to match
- [x] `AssessmentPolicyScreen.tsx` — "Student visibility" section below a divider (it is not a grading rule)
- [x] Demo mode mirrored: `DemoAssessmentPolicy.students_can_view_grades` (seeded **on**, so the student demo still has screens), the PUT full-replace semantics, and `fixtures.ts`
- [x] `tests/test_student_grade_visibility.py` — **30 passed**, including a blunt substring sweep proving no revision vocabulary reaches a student on any of their three grade endpoints
- [x] **Full backend suite: 1479 passed**; frontend `tsc` + `eslint` clean, dataset probe 21/21, MSW route parity 0 ghosts

> **⚠️ Judgment call for BAJC to confirm.** The brief named the *Grades section*, *grade
> navigation*, and *grade information on the registration screens*. It did **not** name the
> **Reports** module, so the Registrar **keeps report cards and transcripts** — issuing
> those is core registry work and removing it would stop them doing their job. If BAJC
> wants Reports closed to the Register too, it is a one-line change to
> `reports/router.py::_staff` plus `permissions.ts`. Pinned by
> `test_student_grade_visibility.py::test_the_registrar_still_reads_a_report_card`.

### Phase 4 — Mid-Term snapshots + report types (brief §5, §6) ✅
- [x] `ReportCardKind` enum; `report_card_snapshots.kind` + unique key widened to `(student_id, semester_id, kind)` (`009` §3 + `reports/models.py`)
- [x] `freeze_academic_year` scoped to `endterm` on **both** the pre-load and the insert — without that filter it would have picked up and overwritten a mid-term row
- [x] `reports/freeze.py::freeze_midterm()` — idempotent, no commit, reuses `_build_report_card`, writes an `audit_log` row, writes **no** `term_grade_snapshots`
- [x] `POST /settings/semesters/{id}/midterm-freeze` (Dean only) + `service.freeze_midterm_grades`
- [x] `AcademicStructureScreen.tsx` — "Freeze mid-term" per term row, shown only where a window exists; inline success/error
- [x] `kind` query param on `/reports/report-card` and `/report-card/me`, defaulting to `endterm` so every existing caller is unchanged
- [x] `reports/service._midterm_report_card` — reads `payload` **verbatim** via `ReportCard.model_validate`. **This is the first reader `report_card_snapshots` has ever had** (gap A1-1 closed)
- [x] Lazy auto-freeze on first read after the window closes; `409 midterm_window_open` before it, `422 no_midterm_window` with none configured, `404 no_midterm_snapshot` for a student not enrolled in the term
- [x] End-Term path validated unchanged — `test_the_END_TERM_card_DOES_move_when_a_grade_changes` is the contrast case
- [x] `ReportCardScreen.tsx` Mid-Term/End-Term toggle (`kind` is part of the query key — the two are different documents); `ReportCardDocument.tsx` derives its heading from `report_kind` and prints "Grades as recorded on …"
- [x] Demo mode mirrored: an in-memory snapshot store, the lazy freeze, and the freeze endpoint (in `reports.ts`, where `buildReportCard` lives — same split as the server)
- [x] `tests/test_midterm_report.py` — **26 passed**, led by `test_the_frozen_card_does_NOT_move_when_a_grade_changes`
- [x] **Full backend suite: 1505 passed**; frontend `tsc` + `eslint` clean, probes green

### Phase 5 — Student filters + print (brief §3) ✅
- [x] `students/router.py` + `service.py` — `religion`, `gender`, `program_id`, all plain WHERE clauses that AND with every existing filter. **No schema change needed** — all three columns already existed (§A4)
- [x] They filter the STUDENT RECORD, not enrolment, so a graduated student still matches — the same trap the `academic_year_id` filter documents
- [x] `StudentListItem` — `gender`, `religion`, `program_code` (batched, one query per page, not N+1)
- [x] `GET /students/filter-options` — DISTINCT non-null religions, declared before `/{student_id}` so the literal wins
- [x] `StudentsListPage.tsx` — three filters in the existing `FilterBar`, each resetting the page; `hasFilters` extended
- [x] `StudentListPrintDialog.tsx` — prints the **whole filtered set** (re-fetched at `page_size=100`), not the visible page, through the existing `PrintLayout`; the active filters are printed as a caption, and a truncation warning appears if the result exceeds the cap
- [x] Demo mode mirrored, including `DemoStudent.religion` and the acceptance path that populates it
- [x] **Demo data defect found and fixed**: gender was `i % 2` while the programme rotation is `i % 8`, so every programme was single-gender and the brief's headline "Female students in Programme X" filter returned all of Programme X. All 8 programmes are now mixed (22F/23M overall)
- [x] `tests/test_student_filters.py` — **20 passed**, each filter alone, all four worked examples, and a scope test proving the programme filter does not widen a Lecturer's view
- [x] **Full backend suite: 1525 passed**; frontend `tsc` + `eslint` clean (2 pre-existing warnings), route parity 0 ghosts

### Phase 6 — Legacy tables (brief §7) ✅
- [x] Verified all 11 `subjects_legacy_pre_d31` rows against `courses` — same id, same code → verdict upgraded from "requires investigation" to **safe**
- [x] Confirmed **no live table FKs into** any legacy table, and that the DB has 0 views / 0 routines / 0 triggers
- [x] Found and recorded the **cost of keeping** the two populated ones: they hold outbound FKs onto live `users` / `academic_years` / `courses`, so they can block deletes there
- [x] `backend/db/mariadb/010_drop_legacy_pre_d31.sql` — **every DROP commented out**; §1 is a read-only pre-flight (row counts + a re-verification of the subjects claim) and §2/§3 are the drops, split by verdict with the FK-dictated order
- [x] Verified the file is inert: applying it runs **2 statements, both SELECTs**
- [x] Recorded in `backend/db/mariadb/README.md`
- [ ] **Await explicit go-ahead before executing anything** ← the only open item in this phase

### Closing
- [ ] Full backend suite green
- [ ] `009` applied to live `sims` (after `--backup`), suite re-run
- [ ] Manual end-to-end walk (see §D)
- [ ] `docs/database-schema.md`, `docs/api-specification.md`, `docs/progress-tracker.md` updated

---

## §D — Verification

Static checks have hidden real defects in this repo before (see
`docs/progress-tracker.md`), so **every phase ends with something executed.**

1. **Backend suite** — `cd backend && .venv/Scripts/python -m pytest -q`. Run the whole
   thing (~100s for 1415 tests); do not cherry-pick a file.
2. **Migration** — `.venv/Scripts/python db/mariadb/apply_sql.py --backup pre_009.sql`
   **first**, then apply `009`, then `--check` and re-run the suite.
3. **Manual end-to-end** — backend `uvicorn app.main:app --reload` against live `sims`,
   frontend `npm run dev` with `VITE_ENABLE_MOCKS=false`:
   - **Dean** — set a mid-term window on the active term; freeze it.
   - **Lecturer** — the Revision button appears **only** on assessments created before
     the window start, with grades entered before the window start, in the active term,
     and only after the window end has passed.
   - **Dean** — change a mark, then re-open the Mid-Term report: the figure must **not**
     move. Re-open the End-Term report: it **must**.
   - **Registrar** — Grades is gone from nav and `/grades` is route-guarded; the API 403s.
   - **Student** — My Grades hidden by default; flip the Dean toggle and it appears,
     showing the post-revision score with no revision wording anywhere.
4. **Print** — filter the directory to Female + one programme, print, and confirm the
   sheet lists exactly the filtered rows with the active-filter caption.

---

## §F — Open items for the client

Two things, neither blocking. Both are recorded here because they are decisions rather
than work.

1. **The Registrar keeps report cards and transcripts.** The brief named the *Grades
   section*, *grade navigation*, and *grade information on the registration screens* — it
   did not name the **Reports** module, and issuing report cards is core registry work.
   Removing it would stop the Registrar doing their job, so it was left in place. If BAJC
   wants Reports closed to the Register too, it is a one-line change to
   `reports/router.py::_staff` plus `permissions.ts`. The current behaviour is pinned by
   `test_student_grade_visibility.py::test_the_registrar_still_reads_a_report_card`, so
   the change would fail that test loudly rather than silently.

2. **Dropping the legacy tables needs a go-ahead.** `010_drop_legacy_pre_d31.sql` is
   written, audited and **entirely commented out**. Five tables are cleared as safe; the
   two populated ones (133 rows of pre-D31 homeroom history) need someone to say the rows
   are not wanted. Note the cost of keeping them: they hold foreign keys onto live
   `users`, `academic_years` and `courses`, so a retired 2024-era row can block a delete
   on a live one.

Also worth knowing, though it needs no decision: **the Religion filter will look empty
until admissions runs.** Religion is collected only on the admissions application and
copied onto the student on acceptance; all 45 live students have it NULL today. The
filter is correct and the dropdown says "None recorded yet" rather than showing an empty
menu with no explanation.

---

## §E — Deliberately not done

- **No scheduler.** The backend has no in-process timer by design (`app/jobs/purge.py`
  says so explicitly). Mid-term freezing is a Dean action with a lazy fallback (D32-3),
  not a cron job.
- **No server-generated PDF.** Export stays browser-print (D27 / OQ-A).
  `report_card_snapshots.storage_key` remains the additive hook.
- **No table drops executed.** Phase 6 delivers the script; running it is a separate,
  explicitly authorised step.
- **`grade_submission_deadline` is not renamed.** Re-documenting it as the End-Term
  cutoff costs nothing; renaming the column would touch the ORM, both schemas, the
  generated frontend client and three test files for no behavioural gain.

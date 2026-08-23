# D33 — Directory UX, Full Student Record, Notifications & Mid-Term Freeze

> **Working plan and tracker.** Successor to D32 (`docs/midterm-revision-reports-plan.md`).
> Tick the boxes as they land so a fresh session can resume from this file alone.

---

## STATUS

| | |
|---|---|
| **Phase** | **ALL EIGHT COMPLETE** (1–8) |
| **Status** | 🟢 **D33 COMPLETE** — 2026-08-23 |
| **Branch** | `tertiary-refactor` (continues from D32, which is complete but uncommitted) |
| **Started / finished** | 2026-08-23 |
| **Backend suite** | **1565 green** (was 1525 — 40 new tests across two files) |
| **Frontend** | `tsc -b --force` clean; `eslint` 0 errors / 2 pre-existing warnings |
| **Executed** | `scratchpad/probe_d33.mjs` **37/37** (drives the real MSW handlers), dataset probe green, MSW route parity 0 ghosts |
| **Migrations** | **none.** Every column this needed already existed — see Phase 4 |
| **Next action** | nothing blocking. See §Follow-ups. |

### Client brief this implements

1. **Students filter → a button that opens a modal** holding every filter. The current
   eight-control `FilterBar` row is not responsive and looks bad.
2. **Everything mobile friendly.**
3. **Add student = the application form**; **Edit student = the application form
   pre-filled** with the student's existing information.
4. **Student profile displays all information** — no documents, but every field the
   filters can select on.
5. **Students list name column = `Last, First`.**
6. **Notification bell dropdown truncates with `…`** instead of clipping the wording.
7. **Mid-term freeze.** From the mid-term start date until the end date the mid-term is
   frozen and nobody can enter a grade. After the end date a Lecturer sends a
   **revision** to fix a grade that already exists; a **new** grade entered after the end
   date is entered normally, with no revision button.

### Reading taken on ask 7 (stated, not guessed)

The brief says "fix the freezing of the mid term". Nothing in the codebase freezes grade
entry today — `midterm_submission_start/end` (D32 Phase 1) only gate *revision
eligibility*; the sole entry gate is `grade_submission_deadline`, the End-Term cutoff. So
"fix" is read as **make the freeze exist**:

* `[start, end]` → grade entry is **refused** (`409 midterm_frozen`). This is what makes
  the mid-term snapshot stable, which is the point of the window.
* After `end` → entry re-opens. Changing a grade that was entered **before** `start`
  needs a revision (already built, D32 Phase 2). A **new** grade goes in normally with no
  revision button (already built — rules `assessment_after_window` /
  `grade_after_window`).

That reading is self-consistent: with entry frozen during the window, no grade can be
*created* inside it, so every grade is either pre-`start` (revisable) or post-`end`
(normal). The Dean stays exempt, matching `_assert_grade_window_open`.

---

## Phase checklist

### Phase 1 — Notification bell truncation (ask 6) ✅
- [x] `NotificationsBell.tsx` — the cause was `MenuItem`'s own `white-space: nowrap`, which CLIPPED rather than ellipsised: a truncated line was indistinguishable from a complete one
- [x] Title clamped to one line, preview to two, both ending in `…` (`-webkit-line-clamp`)
- [x] Full text on the item's `Tooltip` **and** its `title` attribute, so nothing is only-truncated on touch or to a screen reader
- [x] Popover 380px on desktop, `calc(100vw - 32px)` on mobile, `max-height` bounded
- [x] The `Tooltip` wraps the TEXT, not the `MenuItem` — `Menu` clones its direct children to inject keyboard-nav props

### Phase 2 — `Last, First` in the directory (ask 5) ✅
- [x] `shared/utils/names.ts::surnameFirst()` — degrades rather than emitting a dangling comma for the legacy single-token rows `005_tertiary.sql` §9 parked in `lastname`
- [x] `StudentsListPage` Name column + `StudentListPrintDialog` (the printed register reads the same way as the screen)
- [x] **The sort key is untouched** — still the API's `last_name`, which the server expands to `(last_name, first_name, id)`. Sorting the display string would collate the comma

### Phase 3 — Filters in a modal (asks 1 + 2) ✅
- [x] `StudentFiltersDialog.tsx` — all seven filters, two columns from `sm`, full screen below it, Apply / Cancel / Clear all
- [x] **The draft is local and commits on Apply.** Each filter used to fire its own query; picking a programme then a gender answered twice for a question still being asked. It also makes Cancel mean something
- [x] `components/studentFilters.ts` — the value shape, `EMPTY_STUDENT_FILTERS`, `activeStudentFilterCount`. Split out so the dialog file exports only a component (Fast Refresh), and because the list page needs the counter without the dialog
- [x] The year only counts as a filter once moved OFF the active one — otherwise the badge reads "1" on an unfiltered directory
- [x] `StudentsListPage` — search inline, a badged `Filters` button, and **a removable chip per applied filter**. The chips are what make the modal safe: a filter you cannot see is one you forget you set, and "why is this student missing" is the bug that follows
- [x] `filterSummary` (printed on the sheet) is derived from the same chips, so the two cannot disagree
- [x] `YearSelect` gained `fullWidth` for the grid layout

### Phase 4 — Backend: the full student record (asks 3 + 4) ✅
> **No migration.** Every column already existed (`005_tertiary.sql`), and
> `admissions/service.py` has been copying them onto the student at acceptance all along.
> What was missing was any way to READ or WRITE them outside admissions — so a student
> registered on paper had a permanently blank next of kin, and D32's Religion filter
> selected on a column the Registrar could not see.

- [x] `schemas.py::_AdmissionProfileFields` — the 19 fields declared ONCE and mixed into the read model and both write models, so the three cannot drift
- [x] `extra="forbid"` re-stated on both write models: a subclass's `model_config` REPLACES rather than merges, so inheriting the mixin alone would have stopped rejecting typo'd fields
- [x] `service.py::ADMISSION_PROFILE_FIELDS` — iterated by create and update rather than 19 hand-written lines in each
- [x] `update_student` uses `model_fields_set`, not `is not None`: un-ticking `has_health_condition` has to be writable, and a truthiness check cannot express that for a bool
- [x] `StudentDetail.email` — READ ONLY, derived from the linked `users` row (`student_profiles` has no email column)
- [x] `program_id` on **create only**, and it opens the first `student_program_history` row — the Academic-history panel reads the history, not the column
- [x] **Defect found by the tests:** the programme was validated AFTER `db.flush()`, so an unknown id hit the FK and surfaced as a 500 instead of `404 program_not_found`. Now resolved before the insert, which also stops a bad programme burning a student number
- [x] `tests/test_student_admission_fields.py` — **19 passed**, including a completeness test tying the iterated list to the schema
- [x] `openapi.json` regenerated (schema-only; no new paths)

### Phase 5 — Student form = the application form (ask 3) ✅
- [x] `StudentFormDialog` rebuilt around the wizard's own sections and field order — Personal information · Address · Contact · Family and next of kin · Health · Examinations · Financial information · Programme of study
- [x] **One component for create AND edit**, edit pre-filled from `StudentDetail`
- [x] **Sections, not a wizard.** The application wizard is seven steps because it SAVES AT EVERY STEP — a `draft` application is a real server-side state. A student record has no draft state, so a stepper would add an all-or-nothing gauntlet with none of the interruption-safety that justifies it upstream
- [x] Read-only on edit with the reason stated: programme (Dean-only, moves the history), e-mail (Users module), enrolment (offering roster)
- [x] `StudentDetailPage::handleEdit` also strips `program_id` — belt-and-braces, since `extra="forbid"` would 422 an otherwise valid save
- [x] `District` / `EnrollmentLoad` moved to `@shared/types/enums` (admissions re-exports them) — the student record carries both now, and two copies of a closed enum is how one district gets spelled two ways
- [x] `useProgramsList` gained `options.enabled`, so the picker's query waits for the dialog
- [x] Documents / prior education / credit transfer stay application-only: no file bytes exist anywhere (OQ-DB5), and a transfer is anchored on the application by policy (§D4)

### Phase 6 — Profile shows everything (ask 4) ✅
- [x] `StudentProfileSummary` — Registration · Personal Information · Address · Family & next of kin · Guardian · Health · Prior examinations · Financial information. Every field the directory can filter by is on the card, which is the client's specific test
- [x] Empty sections omit themselves, so a sparse paper registration is not a wall of em-dashes — but `false` is KEPT ("ATLIB exam: No" is an answer; its absence would read as "not asked")
- [x] Documents excluded, as asked

### Phase 7 — Mid-term freeze (ask 7) ✅
- [x] `grades/service.py::midterm_freeze_state` + `_assert_midterm_not_frozen` → `409 midterm_frozen`, wired into `upsert_grades` (the single grade write path). Dean exempt, matching `_assert_grade_window_open`
- [x] Checked AFTER the end-term deadline: if both are shut, "the term is over" is the more useful message than "wait"
- [x] **Both bounds inclusive** — the mirror image of `midterm_revision_eligible`'s `utcnow() <= end`. If one were exclusive there would be a single second in which a mark could neither be entered NOR revised
- [x] `Gradebook.midterm_frozen` + both dates. A THIRD flag, not a synonym for `grade_window_closed`: read-only means "not yours", closed means "file a revision", frozen means "wait, until this date"
- [x] `AssessmentGradingScreen` — chip, banner naming the reopen date, `canEdit` folded, and Save disabled (a draft entered before a refetch flipped the flag would otherwise post into a guaranteed 409)
- [x] Demo mode mirrored: `midtermFreeze()` beside `gradeWindow()`, on both the read and the write path
- [x] **Three strings the freeze made WRONG, all fixed** — each told the user to do the one thing the freeze forbids:
  - `TermFormDialog`: "the period lecturers submit mid-term marks in" → it is a freeze; marks go in *before* it. Labels are now "Freeze starts / ends"
  - `revisions.py::REVISION_BLOCKED_REASONS['midterm_window_open']`: "correct the mark directly while grade entry is still open"
  - `AssessmentGradingScreen::REVISION_BLOCKED_COPY['midterm_window_open']`: the same advice
  - (`freeze.py`: "still open" → "still running" — wording only; D32-3's behaviour is unchanged)
- [x] `tests/test_midterm_freeze.py` — **21 passed**: frozen inside, open before, open after, both boundary instants, per-term not per-year, nothing written while frozen, naive-datetime safety, the end-term deadline winning when both are shut, and the two revision interactions the client's last sentence turns on

### Phase 8 — Mobile sweep (ask 2) ✅
Audited for horizontal overflow at 390px. Fixed at the SHARED level wherever possible, so
one change lands across every call site rather than screen by screen.

- [x] **`FormDialog` is full-screen below `sm`** — ~134 call sites, none changed. A centred paper on a 390px screen wastes its margins on the one device with none to spare. The action bar is sticky, so Save never scrolls out of reach on a long form
- [x] **`PageHeader` actions WRAP.** "Print list" + "Add student" is already ~300px, so a non-wrapping row put the whole page into a horizontal scroll
- [x] **`ProfileLayout` splits at `md`, not `sm`.** At 600px a 35% summary column is ~210px, and the profile card got much denser in Phase 6 — every label/value pair wrapped to three lines
- [x] **`AssessmentGradingScreen`'s sticky save bar stacks and wraps.** The worst find: an Alert, a counter and two buttons in one non-wrapping row overflowed a `position: fixed` element, putting Save off-screen with no way to reach it
- [x] Notification popover viewport-bounded (Phase 1); students toolbar and filters modal built responsive (Phase 3)
- [x] **Audited and already correct** — recorded so the next sweep does not redo it: every `TableContainer` (MUI defaults to `overflow-x: auto`); the bare `<Table>`s in `AcademicStructureScreen`, `GradingScaleScreen` and `ProgramCurriculumScreen` (each already has a card-on-mobile branch); `PageContainer` padding; `DetailTabs` (`variant="scrollable"` + `allowScrollButtonsMobile`); `DataTable` (card-on-mobile, from the UI/UX refactor)

### Closing
- [x] Full backend suite green — **1565 passed**
- [x] `tsc -b --force` clean; `eslint` 0 errors / 2 pre-existing warnings
- [x] `scratchpad/probe_d33.mjs` — **37/37**, driving the real MSW handlers
- [x] Dataset probe green; MSW route parity 0 ghosts
- [x] `openapi.json` regenerated and copied to `frontend/`
- [x] This document

> **Use `tsc -b --force`, not `tsc -b`.** The incremental build reported clean on a file
> holding an undefined identifier (`nextId` in `handlers/students.ts`); only `--force`
> caught it. Worth knowing before trusting a green typecheck here.

> **The probe caught two false PASSes in itself.** It first used the wrong session-cookie
> name, and `sessionRole` DEFAULTS TO `principal` — the Dean, who is exempt from both grade
> windows. Every freeze assertion passed against no enforcement at all. If you extend
> `probe_d33.mjs`, assert the role took effect before asserting what it can do.

---

## Follow-ups (not blocking)

1. **No browser was involved.** `vite dev`/`build` cannot run on this machine (esbuild's
   binary is policy-blocked), so the responsive work is reasoned from the breakpoints and
   the component contracts rather than seen. The Phase 8 items are the ones to eyeball
   first on a real phone, `AssessmentGradingScreen`'s save bar most of all.
2. **`freeze_midterm` could now be allowed DURING the window.** Grade entry is frozen
   throughout it, so the snapshot is already stable — the `409 midterm_window_open` before
   the end date is a D32 decision (D32-3) that the freeze arguably makes unnecessary. Left
   alone because nothing asked for it and 26 tests pin it; worth putting to BAJC.
3. **The two D32 open items are still open** — see
   `docs/midterm-revision-reports-plan.md` §F: whether the Registrar keeps Reports, and
   the go-ahead to execute `010_drop_legacy_pre_d31.sql`.

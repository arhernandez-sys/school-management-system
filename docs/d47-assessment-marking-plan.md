# D47 — Assessment module rework: print, 5-day marking window, one-screen grading

## Context
The lecturer workflow is too heavy today. An assessment is created as `draft`, has to be moved through draft → published → grading → graded with a 3-dot menu, and then **released** separately. Each student also has a 3-dot status menu. Marks count only when the assessment is `graded` **and** released (`grades/calc.py:575-578`). Nothing forces timely marking, and a blank mark simply doesn't count.

The user wants three things:
1. **Print assessments** from the main page (`/grades`, which is the staff assessments page; `/assessments` is now student-only). The Dean can filter by session, course offering, student and lecturer. Lecturers can only print their own offerings.
2. **A 5-day marking window** for each assessment. After it closes, mark entry is locked. A lecturer who needs to enter marks late sends a **reopen request** to the Dean, modelled on grade revision.
3. **Seamless grading.** The lecturer opens an assessment and every student's mark box is already open. They tick "Excused" where it applies and use one Save at the bottom. A saved mark is final and counts toward the grade straight away. When the window closes, blank marks count as **0**.

**Decisions from the user:**
- The window starts on `assessment_date`. If there is no date, it starts on the creation date.
- When the Dean approves a reopen, the Dean chooses how many days it stays open (default 2). When that period ends, blank marks become 0 again.
- The per-student menu becomes an inline **Excused** checkbox. An excused student is not zeroed and doesn't count. Absent is treated as blank.
- Existing data is test data, so the rule applies to everything as-is. No grace period or backfill is needed.

## Design

### Window rule (one helper, used everywhere)
Add to `backend/app/modules/assessments/marking.py`:
- `marking_closes_at(a)`: 23:59:59 America/Belize on `(assessment_date or created_at's school date) + 5 days`, converted to UTC (`core/timeutil.py`).
- `marking_open(a, now)`: `now <= max(marking_closes_at(a), a.reopened_until)`.

The constant `MARKING_WINDOW_DAYS = 5` lives in that module.

### Schema
There is one re-runnable file, `backend/db/mariadb/d47_assessment_marking.sql`, and `sims_final.sql` is re-dumped afterwards. It does two things:
- Adds `assessments.reopened_until DATETIME NULL`.
- Creates a new table `assessment_reopen_requests`, mirroring `grade_revision_requests` (`sims_final.sql:744-768`). Columns:
  - `id`, `assessment_id` (FK, cascade), `requested_by_user_id`, `reason`
  - `status` enum pending/approved/denied
  - `granted_days`, `decided_by_user_id`, `decided_at`, `decision_note`, timestamps
  - The STORED `pending_flag` column plus a unique key on (`assessment_id`, `pending_flag`), so there is only one open request per assessment. Like the original, it is not mapped in the ORM.

The existing `status`, `is_released` and `released_at` columns are **kept but no longer drive anything**:
- New assessments are created as `status='graded'`, `is_released=1`.
- The SQL file updates the existing test rows the same way.

Dropping them would be a separate cleanup.

### Backend changes
1. **The grade calculation** (`grades/calc.py` `compute_term_grade` / `_contribution_for`):
   - Count every non-deleted assessment. Remove the `GRADED` status check and the release filter. The `released_only` parameter becomes a no-op and is then removed from callers: `/grades/me`, dashboard, `list_term_grades`, report-card `released_flags` "pending".
   - Blank or `pending`/`absent` while the window is **open**: excluded.
   - Blank or `pending`/`absent` once the window is **closed**: counts as 0.
   - `excused`: always excluded.
   - The `closed` flag is passed in per assessment so `calc` stays pure.
2. **Saving marks** (`grades/service.upsert_grades`, `grades/service.py:902`):
   - Add a guard `_assert_marking_open` after the ownership check. It returns 409 `marking_closed` and puts `closes_at` in `extra`.
   - The existing mid-term freeze and D45 guards stay.
   - Accepted statuses are reduced to `graded`, `excused` and blank (clearing a mark).
3. **Gradebook response** (`grades/service.py:818-894`). Each assessment gains these fields:
   - `marking_closes_at`, `reopened_until`, `marking_open`, `days_left`
   - `can_request_reopen` and `pending_reopen_request_id`

   Each closed blank cell is flagged `auto_zero: true` so the UI can show "0 (auto)".
4. **Assessments module** (`assessments/router.py`, `service.py`):
   - Remove the `POST /{id}/status`, `/release`, `/unrelease` and `/nudge-release` routes.
   - Delete `release_nudge.py`.
   - `create_assessment` sets graded/released.
   - Students see all of their offering's assessments; the draft filter is removed at `service.py:243-264`.
   - Dashboard: remove `_awaiting_release` and the "ungraded" counters that key off PUBLISHED/GRADING. Replace them with a lecturer count of **"assessments closing in ≤2 days with blank marks"**.
5. **Reopen requests.** New file `assessments/reopen.py`, structured like `grades/revisions.py`.
   - `POST /assessments/{id}/reopen-requests` (TEACHER/HOD, own offering, window closed, no pending request).
   - `GET /assessment-reopen-requests?status=` (Dean and Auditor see all; lecturers see their own).
   - `DELETE /assessment-reopen-requests/{id}` (withdraw).
   - `POST /assessment-reopen-requests/{id}/decision` (Dean only, `{approve, granted_days=2, note}`). Approval sets `assessments.reopened_until = now + granted_days`.
   - Audit actions `assessment_reopen.request|withdraw|approved|denied` are registered in `common/audit_modules.py`.
   - The bell: `announcements/service.unread_count` gains `pending_assessment_reopens` for the Dean.
6. **Print report.** New endpoint `GET /grades/assessment-report?semester_id&offering_id&student_id&teacher_id` (PRINCIPAL, TEACHER, HOD).
   - Lecturers are forced to `rbac.teacher_offering_ids`, and `teacher_id` is ignored. Asking for an offering they don't own returns 404.
   - It returns, per offering: offering code/title, lecturer(s), the assessments (title, category, date, max, closes-at), and per student each mark (or Excused / 0 auto) plus the current %.
   - When `student_id` is given, only that student's rows across the matching offerings are returned.
   - It reuses `compute_term_grade` so the % matches the gradebook.
   - Separately, the ownership hole in `reports/offering-grades` (no lecturer check) is fixed in the same pass, because it exposes the same data.

### Frontend changes
1. **`features/grades/AssessmentGradingScreen.tsx`** (rework):
   - A header banner shows "Marking open — closes dd/mm/yyyy (N days left)" or "Locked since dd/mm/yyyy".
   - While open, every row has a score field and an **Excused** checkbox. One sticky **Save marks** bar at the bottom reuses the existing `saveAll` and Slide bar (`:183-206`, `:452-517`).
   - Release/Unrelease is removed.
   - When locked, the grid is read-only, blank cells show a grey "0 (auto)", and a **Request reopen** button opens `RequestReopenDialog` (a copy of `RequestRevisionDialog`: reason required). If a request is pending, a chip says so instead.
   - The grade revision column stays as it is.
2. **`features/grades/components/GradeCell.tsx`**: remove the `MoreVertIcon` menu and `STATUS_OPTIONS`, and add the Excused checkbox.
3. **`features/grades/OfferingGradesScreen.tsx`**:
   - Remove the 3-dot status menu and `applyStatus`.
   - The Status column becomes **Marking: Open (N days) / Reopened / Locked**.
   - Clicking a row goes straight to grading.
   - Dates use `formatSchoolDate`.
   - `AssessmentFormDialog` stays as it is, with the date field now labelled "Assessment date (marking window starts here)".
4. **Delete:**
   - `features/assessments/statusMeta.ts`
   - The status/release hooks (`useSetAssessmentStatus`, `useSetRelease`, `setAssessmentRelease`)
   - `RemindTeacherButton`
   - The `awaiting_release_items` tile in `TeacherDashboard.tsx`
   - The duplicated status menu in `AssessmentsListScreen.tsx` (student page)

   Also update `types.ts`: `is_editable` becomes `marking_open` plus the new fields.
5. **Reopen queue.** Add a **"Reopen requests"** tab next to "Grade Revision" in `features/grades/index.tsx`. `AssessmentReopenScreen.tsx` is cloned from `GradeRevisionsScreen.tsx`: status filter, cards, Dean Approve (with a days field, default 2) / Deny, and lecturer Withdraw. Hooks go in `hooks/useReopenRequests.ts`, mirroring `useRevisions.ts`. A bell item goes in `app/layout/useNotifications.ts`.
6. **Print on `/grades`** (`GradeAssessmentsScreen.tsx`):
   - Add to the existing Year/Session/Lecturer `FilterBar`: a **Course offering** `SearchableSelect` (from the loaded offering options) and a **Student** picker (`reports/components/StudentPicker.tsx`).
   - The **Dean** sees all four filters. A **lecturer** sees Session and Offering (own only, as the server already scopes).
   - A **Print** button opens `AssessmentReportPrintDialog.tsx`, which follows the `OfferingListPrintDialog` + `PrintLayout` (`window.print()`) pattern with a filter-summary caption. It shows one section per offering with a student × assessment table and Excused/0-auto markers.
   - The button is only visible to the Dean, Lecturer and HOD.
7. **MSW demo** (`shared/api/mocks/handlers/assessments.ts`, `grades.ts`, new `reopens.ts`; `demo/types.ts`, `data.ts`, `selectors.ts`):
   - Mirror every rule above: the window computed from `DEMO_TODAY`, the 409 `marking_closed`, auto-zero in `computeReleasedTermGrade`, reopen endpoints, and the report endpoint.
   - Seed one open, one closing-soon, one locked-with-blanks assessment and one pending reopen request.
   - Fix the `can_edit` HOD gap.
   - No hardcoded fields the backend lacks.

### Docs
- Add `docs/d47-assessment-marking-plan.md` with phase checkboxes.
- Update `docs/api-specification.md` (lifecycle/release sections), `docs/database-schema.md` and `complete-work.md`.
- Mark §27 in `bajc-blueprint-conformance.md` as decided by the client: "save = released, 5-day window".

## Phases (each committed separately)
Tick each box when its commit lands.

- [x] 1. **Backend core:** SQL file, `marking.py`, calc change, `upsert_grades` guard, gradebook fields, removal of status/release/nudge, dashboard counters, tests.
- [x] 2. **Reopen requests:** table, service/routes, bell, audit labels, tests.
- [x] 3. **Print report endpoint** plus the `offering-grades` ownership fix, with tests.
- [x] 4. **Frontend grading rework:** grading screen, GradeCell, offering list, deletions.
- [x] 5. **Frontend reopen queue and print dialog/filters.**
- [x] 6. **MSW demo parity**, then docs.

## Verification
- **Backend:** copy `sims` → `sims_test`, apply the SQL there, then run the full suite with `backend/.venv/Scripts/python.exe -m pytest` (~100 s). Add or replace tests:
  - The window boundary (23:59 Belize on day 5 vs. the next minute) and the no-date fallback.
  - Save refused after close; save allowed after reopen; refused again after `reopened_until`.
  - Auto-zero affects the % only after close; Excused is never zeroed.
  - A student sees a mark immediately after save (no release).
  - Reopen: only the owner can request; one pending at a time; Dean-only decision; `granted_days` honoured; bell count; audit rows.
  - Report scoping: a lecturer can't read another's offering by any filter; the Dean's filters combine; the % equals the gradebook's.
  - The old status/release tests are removed or rewritten.
- **Frontend:** `tsc -b --force`, then `vite --mode demo` headless-Chrome probes (the pattern in `frontend/scratchpad/`) as Dean and as lecturer:
  - Grade with one Save; the locked view shows 0 (auto); request reopen → Dean approves → entry opens.
  - Print preview as lecturer shows only own offerings.
  - Screenshots of the grading and print views.
- **Live `sims`:** the user applies `d47_assessment_marking.sql` there with the deploy. It is never applied by me.

## Progress notes
- **Phase 1 (28 Oct 2026).** Full suite on `sims_test` (with `d47_assessment_marking.sql` applied): 2204 passed, 2 failed. The 2 are the known `test_settings.py` semester tests (`sims_test`'s active year has fewer than two semesters), which also fail without D47.
  - Two guards were added that the plan didn't spell out: an assessment's date can't be moved once its window has closed (moving it would reopen the window), and a closed assessment can't be deleted (that would erase its automatic zeros). A new assessment whose date is more than 5 days back is refused with 422 `marking_window_passed`.
  - The grade write API still accepts the `absent` / `exempt` / makeup statuses. The new UI sends only `graded` / `excused` / blank.
- **Phase 2 (28 Oct 2026).** `assessments/reopen.py` + `assessment_reopen_requests`. Endpoints: `POST /assessments/{id}/reopen-requests`, `GET /assessment-reopen-requests`, `DELETE /assessment-reopen-requests/{id}` (withdraw) and `POST /assessment-reopen-requests/{id}/decision`.
  - An approval opens entry until 23:59 Belize on `today + granted_days` (1–14 days, default 2).
  - `status` reuses the `GradeRevisionStatus` vocabulary (pending / approved / denied).
  - Tests: `test_assessment_reopen.py`, 25 of them.
- **Phase 3 (28 Oct 2026).** `GET /grades/assessment-report` (`grades/assessment_report.py`) is open to the Dean, lecturers and HODs.
  - It is built from `get_gradebook`, so the printed marks and term % are the on-screen ones.
  - With no term, offering or student given, it uses the active session. It returns at most 60 offerings, and `truncated` says when there were more.
  - A lecturer's `teacher_id` is ignored.
  - `GET /reports/offering-grades` now enforces lecturer ownership (it had none).
  - Full suite: 2244 passed, plus the same 2 known `test_settings` failures.
- **Phase 4 (28 Oct 2026).** Grading screen, `GradeCell`, the offering's assessment list, the student tab, the teacher dashboard and My Grades follow D47.
  - Deleted: `statusMeta.ts`, `RemindTeacherButton`, and the status / release / nudge hooks.
  - Shared wording lives in `features/grades/marking.ts`.
  - `tsc -b --force` and eslint are clean. The MSW demo is updated in phase 6.
- **Phase 5 (28 Oct 2026).** A "Reopen Requests" tab under Grades (`AssessmentReopenScreen`), and the bell lists the Dean's pending reopens.
  - The Grades page gains a Course offering filter (everyone), a Student filter (Dean) and a **Print assessments** button (Dean, lecturers, HODs) that opens `AssessmentReportPrintDialog`.
- **Phase 6 (28 Oct 2026).** The MSW demo mirrors D47 (new `handlers/reopens.ts`; the window rule is in `demo/selectors.ts`). The seed on MATH1110-01 has an open assessment, one closing today, a locked one with blanks, one reopened and one pending reopen request.
  - `blank_count` now counts absent-with-no-makeup rows (they are auto-zeroed), in the backend and the mock alike.
  - Verified with `frontend/scratchpad/probe_d47_marking.mjs` (97 checks on the handlers) and `probe_d47_screens.mjs` (real screens, headless Chrome). A save / print / Dean-reopen flow probe passed too.
  - Backend: 2245 passed, plus the 2 known `test_settings` failures.
  - **Not done:** `d47_assessment_marking.sql` has not been run on live `sims`.

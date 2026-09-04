# D42 — Lecturer scoping, login landing, date format, end-deadline removal

**Branch:** `tertiary-refactor` · **Raised:** 2026-08-28 · **Status:** ✅ COMPLETE (2026-08-28)

Seven client asks from one message. They are unrelated to each other, so each phase below
stands alone and can be verified alone; they are grouped only because they shipped together.

Decisions taken with the client before starting (all three offered as options, all three
answered with the recommended one):

- **§2 "year field"** = the academic-YEAR switcher the student profile already has, added to
  the lecturer profile. Not an employment year, not a printed label.
- **§6 date pickers** = a real picker (`@mui/x-date-pickers` + `dayjs`, `en-gb`), not
  display-only formatting and not a hand-rolled mask.
- **§5 end-of-session deadline** = removed from the UI **and no longer enforced**. The
  column stays so historic terms keep their value; nothing reads it.

---

## Phase 1 — Login always lands on the dashboard

**Ask:** "when i login back it is always the dashboard and not the last page i was when i
logout … if the role doesnt have access it states something like access denied which they
shouldnt even see that".

**Cause.** `ProtectedRoute` stores the attempted path in `location.state.from` on the
redirect to `/login`, and `LoginForm` navigates back to it after a successful sign-in. Log
out from `/reports`, sign back in as a Lecturer, and the app returns to `/reports` — which
`RoleRoute` immediately bounces to `/forbidden`. The "Access denied" screen is the return
trip, not a permission bug.

- [x] `LoginForm` navigates to `ROUTES.dashboard` unconditionally (forced password change
      still wins).
- [x] `ProtectedRoute` stops recording `state.from` on the login redirect — nothing reads it
      any more, and leaving it would invite the same bug back.

## Phase 2 — Academic-year switcher on the lecturer profile

**Ask:** "for the lecturers add the year feild in the profile for dean and register (and
lecturer if required)".

Shown for **all three** viewers of the profile. A Lecturer looking at their own record has
the same question as the Dean does ("what did I teach last year?"), and the switcher cannot
widen what they see: the offerings listed are their own either way.

- [x] Backend `GET /teachers/{id}/years` — the academic years this lecturer actually taught
      in, newest first. Mirrors `GET /students/{id}/years`.
- [x] Backend `GET /teachers/{id}?academic_year_id=` scopes `classes_taught` to that year.
- [x] `_classes_taught` now populates `OfferingRef.semester`, which it never did — the
      profile's "Semester 1" line has been blank against the real backend since D31.
- [x] Frontend `useTeacherYears` + `YearSelect` in the `ProfileLayout` toolbar, `?year=` in
      the URL, same shape as `StudentDetailPage`.
- [x] Demo MSW handlers mirror both.

## Phase 3 — A Lecturer sees only their own courses on a student

**Ask:** "lecturer cannot see all the students course and course offering only theirs, they
can only see grades for their courses not for all the student takes."

Already correct: `GET /offerings`, `GET /offerings/{id}` and the whole Grades module scope to
`class_teachers` for a Lecturer caller. The two leaks are both on the STUDENT profile, which
a Lecturer reaches for any student they share one offering with:

- [x] `GET /students/{id}` — `current_offerings` returned every course the student takes.
      Now filtered to the caller's own offerings when the caller is a Lecturer.
- [x] `GET /students/{id}/assessments` — the Grades & Assessments tab grouped EVERY subject
      the student sits. Now filtered the same way.
- [x] `GET /students/{id}/years` — narrowed to the years they taught that student in. An
      unscoped switcher offered a Lecturer years where every tab below is empty.
- [x] `GET /students` — the directory's `offering_count` ("Courses" column) counted every
      course. Found while wiring the profile: left global it printed 2 in the directory and
      1 on the profile of the same student, which reads as a bug rather than as a rule.
- [x] Demo MSW handlers mirror both.
- [x] Backend tests for both.

## Phase 4 — No Academic history tab for a Lecturer

**Ask:** "remove academic history in the student profile only for lecturer role."

`GET /students/{id}/academic-history` is already Dean/Registrar-only, so the tab was
rendering an error panel for a Lecturer rather than leaking anything.

- [x] `StudentDetailPage` builds the Academic history tab only for `principal` / `secretary`.

## Phase 5 — End-of-session grade deadline removed

**Ask:** "in the academic structure remove the end grade submission and only keep mid-session
freeze."

- [x] `TermFormDialog` drops the deadline field and no longer sends it.
- [x] `AcademicStructureScreen` drops the "Grades due …" chip.
- [x] Backend stops enforcing it: `_assert_grade_window_open` is gone from the grade write
      path and the gradebook reports `grade_window_closed: false` always.
- [x] Frontend grading screen drops the now-unreachable "Grading closed" states.
- [x] Demo MSW mirrors it.
- [x] The `semesters.grade_submission_deadline` column and its create/patch schema fields are
      LEFT ALONE — historic terms keep the value, and dropping a column against live `sims`
      is a one-way door for a cosmetic win.

## Phase 6 — dd/mm/yyyy everywhere

**Ask:** "for all date pickers make the date be dd/mm/yyyy."

Native `<input type="date">` renders in the BROWSER's locale and cannot be told otherwise, so
every one of the 22 of them shows mm/dd/yyyy on a US-locale machine. Replaced by one shared
component so the format lives in a single place.

- [x] `@mui/x-date-pickers` + `dayjs` added; `LocalizationProvider` (`adapterLocale="en-gb"`)
      in `AppProviders`.
- [x] `shared/components/DateField.tsx` — a `DatePicker` wrapper keeping the existing
      `value: string /* YYYY-MM-DD */` + `onChange(string)` API so call sites barely change.
- [x] All 22 `type="date"` inputs replaced.
- [x] `DateTimeField` for the two `datetime-local` inputs that survive (mid-session freeze,
      announcement scheduling).
- [x] `formatDate` display helpers switched to dd/mm/yyyy.

## Phase 7 — No Gradebook link on the lecturer's Classes & Subjects tab

**Ask:** "in the lecturer profile remove the link gradebook when in classes & subject (grade
has its on view)."

- [x] `AssignmentsTab` drops the `secondaryAction` link. The Grades tab beside it already
      opens each offering's gradebook.

---

## Verification — all green (2026-08-28)

| Check | Result |
|---|---|
| `backend/.venv/Scripts/python.exe -m pytest` | **1784 passed** (~140s) |
| `frontend` · `npx tsc -b --force` | clean |
| `frontend` · `eslint src` | 0 errors (2 pre-existing warnings) |
| `frontend` · `node scratchpad/probe_d42_scoping.mjs` | **25 passed, 0 failed** |
| `frontend` · `node scratchpad/probe_d42_datefield.mjs` | **8 passed** (ALL PASS) |
| `frontend` · `node scratchpad/check_msw_routes.mjs` | 0 ghost routes |

New/changed tests: `backend/tests/test_d42_lecturer_scoping.py` (25 cases, new);
`test_grade_deadline.py` rewritten to assert the deadline's RETIREMENT rather than its
enforcement; two cases in `test_midterm_freeze.py` / `test_grade_revision.py` reframed onto
the mid-session freeze. `backend/openapi.json` regenerated (108 paths) and copied to
`frontend/` — it had been stale since D38, so the route-parity check was reporting 8 ghosts
before this change and reports 0 after.

### How to run it

Run from `frontend/`: `npx tsc -b --force` (never plain `tsc -b` — the incremental build has
hidden an undefined identifier in this repo before).
Run from `backend/`: `.venv/Scripts/python.exe -m pytest` (the global python silently skips
53 tests). Full suite is ~100s.

`vite build` / `vite dev` cannot run on this machine (esbuild's binary is blocked by
endpoint policy), so the bundle is only proven by CI.

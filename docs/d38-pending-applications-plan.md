# D38 — Pending applications, wizard save model, and directory filters

Status: **complete** · Branch: `tertiary-refactor` · Opened and closed 2026-08-23

Verified: backend suite **1,669 green** (`backend/.venv/Scripts/python.exe -m pytest`), including
36 new tests in `tests/test_pending_applications.py`; `012_application_temp.sql` **applied to live
`sims` 1/1**; frontend `tsc -b --force` and `eslint` clean.

**Not verified by execution:** the MSW demo handlers and every screen. This project has no frontend
test runner, and `vite build`/`dev` cannot run on this machine (esbuild's binary is blocked by
policy), so demo mode and the UI still need a manual pass — see "Left to check by hand" below.

## Why

The admissions wizard saved to `applications` on **every step**. The client asked for the
opposite: nothing touches the database until the Registrar deliberately saves, and an
unsubmitted form lives in a **holding table** that only its author (and the Dean) can see.

Three smaller directory asks ride along in the same pass.

## Decisions (confirmed with the client, 2026-08-23)

1. **`student_profile_temp` duplicates `applications`**, not `student_profiles`. The
   wizard's Sections A–G *are* application data; a `student_profiles` row is still only
   created by `accept_application`, which also issues the login and the `YYYYMM###`.
2. **Sections B and F ride as JSON** (`education_json`, `documents_json`) on the temp row
   rather than in duplicated child tables. One table instead of three; the trade-off is
   that a pending form is not queryable by institution or document.
3. **A separate "Pending" tab**, not a re-pointed Drafts filter. `applications` keeps its
   own `draft` status for legacy rows; pending forms are their own list.

## Scoping rule

| Role | Sees |
|---|---|
| Dean (`PRINCIPAL`) | every pending form |
| Registrar (`SECRETARY`) | only rows where `created_by = self` |
| everyone else | no admissions access at all (unchanged) |

## Save model

| Button | Where | Writes |
|---|---|---|
| **Continue** | every step except the last | **nothing** — advances the step in client state |
| **Back** | every step except the first | nothing |
| **Save and close** | **last step only** (Section G · Agreement) | the whole form to `student_profile_temp`, status `pending` |
| **Save and submit** | last step only | temp row → `applications` (+ child rows), then `SUBMITTED`; temp row deleted |

A failed submit (incomplete form) **must leave the temp row intact** — validation runs
before anything is staged.

## Tasks

### Backend
- [x] `ApplicationTemp` model (`student_profile_temp`) mirroring `Application`'s
      client-writable columns + `education_json` + `documents_json` + `status='pending'`
- [x] `012_application_temp.sql` migration for MariaDB
- [x] Schemas: `PendingApplicationWrite`, `PendingApplicationRead`, `PendingApplicationListItem`
- [x] Service: save / list / get / delete, all creator-scoped except for the Dean
- [x] Service: `submit_pending_application` — validate, promote, expand JSON, delete temp
- [x] `pending_applications_router` at `/pending-applications` (own prefix, so `pending`
      can never be parsed as an application UUID)
- [x] Mount in `app/main.py`
- [x] Tests: scoping, save/round-trip, promotion, failed-submit-keeps-the-row

### Frontend — wizard
- [x] "Save and continue" → **"Continue"**, no network call
- [x] "Save and close" shown on the **last step only**
- [x] One whole-form payload instead of `payloadForStep`
- [x] Wizard opens a pending temp row (`/applications/pending/:tempId/edit`)
- [x] Section B: the CSEC count moves **below** the ATLIB checkbox

### Frontend — pending list
- [x] `PendingApplicationsScreen` + `pending` route
- [x] Tabs on the admissions page: Applications · Pending forms
- [x] MSW handlers for the new endpoints (demo mode)

### Frontend — students directory
- [x] Year filter gains an **All years** option
- [x] Columns added for the filters that had none: Gender, Religion
- [x] "Add student" navigates to Admissions instead of opening the create dialog

### Docs
- [x] `docs/database-schema.md` — the new table
- [x] `docs/progress-tracker.md` — D38 entry

## Left to check by hand

Static checks and the backend suite cover the server completely. These need a browser:

- [ ] `npm run demo` — the Pending forms tab: sign in as the **Registrar** and see ONE row
      (`temp-1`), then as the **Dean** and see TWO. That is the scope rule made visible; `temp-2`
      is seeded against a registrar with no demo login for exactly this check.
- [ ] Walk the wizard on `/applications/new` and confirm the **network tab stays silent** until
      Section G. That is the whole change, and it is the one thing no test here can see.
- [ ] *Save and close* on Section G, then re-open from the Pending tab and confirm every section
      came back — Sections B and F especially, since they are the ones that travel as JSON.
- [ ] *Save and submit* on an INCOMPLETE form: expect the 422 with its reasons, and the form still
      sitting in the Pending list afterwards.
- [ ] Section B — the CSEC count renders BELOW the ATLIB checkbox.
- [ ] Students directory — **All years** in the filter modal, the new Gender/Religion columns, and
      `Add student` landing on Admissions.

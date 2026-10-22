# D46 — Accept is the application only; Enrol creates the student

_Client decision, 6 Oct 2026. Tracked here so a new chat can resume._

## The rule

| Step | What it does now |
|---|---|
| **Accept** | Marks the application `accepted` and stamps the official-use block (date accepted, academic year, comments, decider). **Creates nothing**: no student number, no `student_profiles` row, no login. An accepted applicant isn't in the student list and can't be put on an offering, because no student exists yet. |
| **Enrol** (`POST /applications/{id}/enrolled`) | Does everything Accept used to do: allocates the `YYYYMM###` student number (no dash) **from the enrollment month**, builds `student_profiles` from Sections A–E (status `Active`), opens `student_program_history`, links both FK directions, reports carried-in credit transfers. The **login is optional** here. |
| **Login later** | A student enrolled without a login gets one through Settings → Users: create the user and link it to the student profile (`profile_id`, already built). Only enrolled students have a profile to link, so "login only after enrolment" holds by construction. |

Client answers (6 Oct 2026):
- Login at enrolment is **optional**.
- An **accepted** application can still be backed out: *Applicant withdrew* and *Defer* are allowed from `accepted`. Reject stays a pre-acceptance decision.
- Existing `accepted` rows in `sims` are dummy data. **No migration.**
- The student ID is **`YYYYMM###`, no dash** (client, 6 Oct 2026, reversing D44's `YYYY-NNNNN`), and its year + month are the **enrollment date's**, not the acceptance date's.

Side rules this forces:
- **Duplicate-SSN guard.** `accepted` is "decided", so it used to fall outside the open set, and the student-profile SSN check caught the duplicate. With no profile until enrolment, an accepted applicant would be free to file a second application. The guard now treats `accepted` as blocking too.
- **Delete.** An `accepted` application no longer has a student behind it, so it can be soft-deleted. An `enrolled` one can't.
- **A legacy `accepted` row that already has a student** is refused at enrolment (409 `application_has_student`), so it can't get a second profile. Dummy data only.

## Checklist

### Backend
- [x] `accept_application`: status + official-use block only. `ApplicationAcceptRequest` loses `login_email` / `temporary_password`. Returns `ApplicationDetail` (200).
- [x] `enroll_application` replaces `mark_enrolled`. `ApplicationEnrollRequest` = `enrollment_date?`, `login_email?`, `temporary_password?`, `comments?`. Returns `ApplicationEnrollResponse` (201); `login_email` / `temporary_password` are null when no login was asked for.
- [x] Withdraw + defer allowed from `accepted`; delete allowed on `accepted`, refused on `enrolled`.
- [x] Duplicate-SSN guard blocks on `accepted`.
- [x] Router summaries/docstrings.
- [x] Tests: a shared `admit()` helper (accept + enrol) for tests that need a student. New tests cover accept creating nothing, enrol with and without a login, the number taken from the enrollment date, and backing out of an accepted application.

### Frontend
- [x] `AcceptDialog`: login field removed; date + comments only.
- [x] New `EnrollDialog`: enrollment date, optional login email (+ the one-time password result view).
- [x] Review screen: *Enrol student* on `accepted`; *Applicant withdrew* + *Defer* also on `accepted`; the student link appears once enrolled.
- [x] `useAcceptApplication` stops invalidating students; `useEnrollApplication` does.
- [x] MSW handlers mirror all of the above (and accept now honours `eligible`, as the server always did).

### Verify
- [x] Full backend suite on `sims_test`.
- [x] `tsc -b --force` + eslint.
- [x] Demo handlers executed (accept → enrol flow).

## Outcome (6 Oct 2026)

- **Backend:** 214 admissions/credit-transfer/vocabulary/user-link tests pass. Full suite on `sims_test`: **2205 passed, 2 failed**. The 2 failures are `test_settings.py` semester tests (`test_list_semesters_filter_by_year`, `test_activate_clears_prior_active`). They **fail identically with this change stashed**: the `sims_test` active year has fewer than two semesters. They're unrelated to D46.
- **Frontend:** `tsc -b --force` and eslint clean.
- **Demo layer, executed** (esbuild + `msw/node` against the real handlers and dataset). Checked: accept refuses the old login field, accept creates no student or user, enrol creates the student with the number from the enrollment year, no login when none was asked for, double-enrol is a 409, a legacy accepted row with a student is a 409, and accepted → withdraw / defer both work.
- **Demo drift fixed on the way:** both mock allocators (admissions + students) used TODAY's month; they now use the enrollment date, like `numbering.allocate_student_number`. The mock's accept also refused `eligible`, which the server has always allowed.
- **Demo drift NOT fixed (pre-existing):** the mock has no D44 SSN duplicate guard at all, so neither "an open application blocks a second one" nor the new "an accepted one does too" is certified by demo mode.
- **Not changed:** `StudentStatus.ACCEPTED` / `APPLICANT` still exist on the *student* vocabulary (D45 §7.5) and can be reached by a manual status change. Under D46 no student record should ever carry them. Retiring them needs a client decision and an ENUM migration (go via varchar; see the D45 Phase 2 note).

## Follow-up: student ID back to `YYYYMM###` (6 Oct 2026)

The client confirmed the student ID is `YYYYMM###`, with no dash. That reverses D44's `YYYY-NNNNN` for students only; applications keep `APP-YYYY-NNNNN`.
- `numbering.allocate_student_number` allocates from the `student_ym` scope (keys `YYYYMM`) again. Those are the pre-D44 counters, so numbering resumes where they stopped. The D44 year-keyed `student` scope is retired; the few dashed numbers it issued are kept by the students who hold them. **No schema change**: `seq_key` is already `varchar(10)`.
- The month bucket holds **999**. A 1,000th enrolment in one month is refused (409 `student_number_exhausted`) rather than widening the format.
- Both server paths use the **enrollment** month: enrolment from admissions and direct `POST /students`. Before this, `POST /students` used today's date.
- `test_student_number.py` was rewritten for the new format: the client's example `202603012`, a month restarting at `001`, and the 999 cap.

# D39 — Meeting #2 feedback + the `3tables.sql` reconcile

**Status: complete (2026-08-26).** Branch `tertiary-refactor`.
Source: `Meeting2-Feedback.docx` (ten numbered items + four annotated screenshots) and
`3tables.sql`, the DB person's third schema drop.

Items **3, 4, 5 and 9** were already done before this phase started. Everything else is
below, plus the report-formatting detail dictated verbally at the meeting.

---

## What the meeting asked for, and where it landed

| # | Ask | Phase | Done |
|---|---|---|---|
| 1 | All dates in dd/mm/yyyy | F | ✅ |
| 2 | Student email not tied to a login at registration | G | ✅ |
| 3 | Label *Plan position* → *Session* | — | ✅ (before D39) |
| 4 | Lecturer edit form — check save button | — | ✅ (before D39) |
| 5 | Label *Term* → *Session/Semester* | — | ✅ (before D39) |
| 6 | Grades/online access for a period after graduation (3 months) | G | ✅ |
| 7 | Formatting of report card and transcript; add programme to transcript | A | ✅ |
| 8 | Religion & Gender in the Student List | E | ✅ |
| 9 | Teacher→Lecturer, Term→Session, Kind→Session Type | — | ✅ (before D39) |
| 10 | ss#, IsPresent→IsEmployed, TeacherLicense#, Degree→Academic Qualification | C + D | ✅ |

---

## Phase A — report card & transcript formatting

- [x] Report card: the **GPA label** moves from the far-left cell into the Instructor
      column, so it sits between the two figures it names — `12  GPA  2.63`. It used to
      be separated from them by the whole Course Name column.
- [x] Report card: the **Grade column prints a plain letter**, not a `GradeLetter` chip.
      The chip colour-codes the band, which reads as an on-screen status pill on an
      official document. `GradeLetter` is untouched and still used for *Session average*
      and on the dashboard/gradebook.
- [x] Report card: **letterhead** (address · phone · email) and the **logo**. The Dean
      footer's two hardcoded `bajc.edu.bz` literals now come from `school_profile`.
- [x] Transcript: **Letter and Teacher columns removed.** The D35 registry notation
      (AU / W/P / W/F) moved onto the course name rather than vanishing with the column —
      dropping it would have made an audited course look merely ungraded.
- [x] Transcript: the **per-semester GPA line removed**; it restated the year header
      directly above it.
- [x] Transcript: everything below **Cumulative GPA** removed — the credit-weighting
      explainer, the cumulative average, and the note distinguishing the two.
- [x] Transcript: the **programme is printed** (item 7). `Transcript` gains
      `program_code` + `program_name`; the report card has carried the code since D30.

**Also fixed here:** `settings/service._logo_url_for` returned `None` unconditionally,
waiting on a Supabase bucket the MariaDB pivot cancelled — so a configured logo never
reached either document. It now resolves an absolute or root-relative key.
`upload_logo` still returns `None`, rather than echoing the *previous* logo back at a
no-op upload and implying it saved.

## Phase B — prerequisites dialog

- [x] *Only in this programme (optional)* is **hidden** for a plain course requirement.
      Only hidden, not deleted: the same control is *required* for "every course in the
      programme". The backend still accepts and enforces `program_id`, so this comes back
      by deleting one condition.
- [x] `program_id` is sent as an **explicit `null`**, not `programId || null` — the state
      is not cleared when the Requirement dropdown changes, so a stale selection could
      have silently scoped a requirement to a programme the user could no longer see.
- [x] *+ Add requirement* → a bottom-right **Save**. Semantics stay immediate-commit;
      `prerequisites/router.py` documents deliberately that a prerequisite has no PATCH,
      so there is no pending state for a Save to flush.

## Phase C — `013_meeting2_schema.sql`

Applied to live `sims` after `apply_sql.py --backup pre_013_backup.sql` plus a data-only
`mariadb-dump` of `teacher_profiles`.

- [x] Eight new `teacher_profiles` columns, all NULLable.
- [x] `education` **renamed** to `academic_qualification`, keeping `varchar(255)`.
- [x] `first_name`/`last_name` backfilled from `full_name` (last-space split, as 007 did
      for students); `is_employed` backfilled from `status`.
- [x] `religions` created verbatim in the client's spelling and seeded.
- [x] Staff `096543` deleted — verified first to have no login and no `class_teachers`
      assignments.
- [x] `verify_schema.py` fingerprint added.

**Three dump differences deliberately NOT applied** (each documented in the file header):

1. **`courses.course_status`** — audit/withdrawal is a property of one student's
   *enrolment*, and D35 already models it as `class_enrollments.enrollment_status`.
   A column on `courses` could only mean "BIOL1102 is withdrawn for everybody".
2. **`academic_qualification varchar(30)`** — four live rows hold 31 characters, and the
   dump's own data shows them already truncated (`M.Sc. Introduction to Sociolog`).
3. **`courses` row data** — all 125 rows already match live on `(id, code)`, and the
   dump's nil-UUID `created_by` is not in `users`, so loading it would violate
   `fk_courses_created_by`.

Also not followed, because they would reject existing rows: narrowing `gender` to
`('male','female')`, narrowing `address` to `varchar(350)`, and the dump's `NOT NULL` on
`ssno`/`first_name`/`last_name` (its own INSERT supplies `''` for eleven of twelve rows).

> **Not a truncate-and-reload**, which is the literal reading of "drop the data and use
> the data in this sql". The dump's other twelve rows carry the *same ids* as live, so
> reloading them is an in-place update — while a truncate would have destroyed 23
> `class_teachers` assignments to achieve it.

**Two stale fingerprints fixed while here.** `006` and `008` both asserted the existence
of tables that `008` and `010` later dropped, so `verify_schema.py` had been exiting
FAIL on any up-to-date database regardless of state.

## Phase D — lecturer employment record (item 10)

- [x] ORM, both write schemas, service, form dialog, profile summary, MSW mocks and
      `seed_demo.py` all follow the rename and carry the new fields.
- [x] `is_employed` is **derived, never accepted on the wire.** It is the client's rename
      of `IsPresent`, and `status enum('active','inactive')` already answers that
      question. `_sync_is_employed` is the only writer, running at create and at every
      status change; a test asserts that sending `is_employed` 422s.
- [x] The licence number is validated as **alphanumeric with hyphens** — the client's own
      sample is `OWD-2019-00035`. The MSW handler validates identically.

> Both write schemas set `extra="forbid"`, which this module has fallen into once already:
> a column mapped on the model but missing from the schema turns every save into a 422.

## Phase E — religion becomes a dropdown (item 8)

The Student List already showed Religion and Gender (that landed in the D38 work). What
was left was constraining how religion is *entered*.

- [x] `Religion` model + `GET /settings/religions`. That GET is the **only verb**, and a
      test asserts a POST still 405s — the table keeps the client's non-house shape (int
      PK, `createdby` as a username) only on the understanding that we never write it.
- [x] `StudentFormDialog` and the application wizard use the vocabulary.
- [x] `religionOptions` appends any stored-but-unlisted value as **"(as recorded)"**.

> **Constrains the write path, not the column.** `student_profiles.religion` stays free
> text, so a student imported from the client's previous system keeps a religion this
> list does not carry. Without the "(as recorded)" option the select would open *blank*
> on those students, and saving an unrelated edit would quietly erase their religion.

## Phase F — dd/mm/yyyy (item 1)

- [x] `formatSchoolDate` / `formatSchoolDayMonth` / `formatSchoolDateWithWeekday` in
      `shared/utils/schoolDate.ts`, replacing fifteen private `fmt` helpers that each
      called `toLocaleDateString(undefined, …)` — i.e. the *browser's* locale.

> **The trap:** a date-only `YYYY-MM-DD` parsed with `new Date()` is midnight UTC, which
> is 18:00 the *previous* day in Belize. Routing those through a timezone formatter would
> have printed every date of birth one day early. Date-only strings never touch `Date`.

The weekday is kept where it was already shown (attendance register, calendar): a teacher
marking a register is checking *which day*, and dropping that to satisfy a rule about
digits would cost them information.

## Phase G — registration email (item 2) + post-graduation access (item 6)

- [x] **Item 2 was a wording fix.** The backend was already correct: `submission_issues`
      does not require an email, no `users` row is created at application time, and the
      login is minted only at accept (where the Dean may supply a different address). The
      wizard was the problem — its email field read *"Becomes the student's login when the
      application is accepted"*, promising an account to someone who may be denied.
- [x] **Item 6.** `014` adds `school_profile.post_graduation_access_days` (default 90),
      operator-set so the policy changes without a deployment. Enforced in `core.deps`,
      at the transport layer, so a new student endpoint has to opt *in* to exposure.
      Covers `/grades/me`, `/reports/report-card/me`, `/attendance/me`.

> **Deliberately not `/students/me`.** Closing the record is the ask; closing the door on
> the person who needs to contact the Registrar about it is not.

> **The asymmetry is the point.** A NULL window means *never expires* and a NULL
> `graduation_date` means *the clock has not started* — both leave access OPEN. A missing
> value is an absence of information, and reading absence as "expired" would take a
> **current** student's own grades away on the strength of a NULL. `0` is the spelling for
> "ends on graduation day", and an operator has to type it on purpose.

## Phase H — a new row leaves `updated_at` empty

Follow-on ask: *"make sure when I create something new the `updated_on` isn't populated too."*

- [x] `015_updated_at_null_on_insert.sql` — 36 tables go
      `NOT NULL DEFAULT current_timestamp()` → `NULL DEFAULT NULL ON UPDATE current_timestamp()`.
      The `ON UPDATE` clause is kept: dropping the DEFAULT is what makes an INSERT leave
      the column empty, while `ON UPDATE` still stamps a real edit and backstops
      SQLAlchemy for the chain's hand-run SQL fixes.
- [x] `TimestampMixin.updated_at` becomes `datetime | None`, no `server_default`,
      `onupdate` kept.
- [x] `AuditStamp`, `ApplicationDetail.updated_at` and the frontend types made nullable.

> **`updated_by` already behaved correctly** — always NULLable, and no insert sets it
> (the one exception, promoting a pending application, is documented at the call site).
> So the two halves of the same fact disagreed: `updated_by` said "nobody has edited
> this" while `updated_at` gave a date. They now agree.

**Existing rows are untouched, by decision.** Widening NOT NULL → NULL cannot alter data.
Blanking rows where `updated_at = created_at` was declined, and the reason is worth
keeping: it is an *inference*, not a fact — a row genuinely edited within the same second
as its creation is indistinguishable from one never edited, and once blanked the
difference is gone. Old rows keep reading as edited-on-their-creation-date until someone
edits them.

**One column is deliberately exempt.** `student_number_sequences.updated_at` keeps its
NOT NULL: that table is a counter, not a record — one row per `YYYYMM` whose only purpose
is to be UPDATEd to issue the next student number, so "when was a number last issued" is
real information about a row that is only ever written by being updated.

**Two readers had to change, and one of them would have broken outright:**

- `attendance/service.py` derives `recorded_at` and `last_recorded.at` from `updated_at`.
  A register mark is *recorded by being inserted*, so a fresh mark would have reported
  `recorded_at: null`, and `max(records, key=lambda r: r.updated_at)` would have raised
  `TypeError` on a register that had been partly corrected. New `_touched_at` coalesces
  to `created_at`. **Verified by negative control: reverting it fails two existing tests.**
- The pending-applications list column is labelled **"Last saved"**, and creating a form
  *is* saving it, so the service coalesces there too and the wire field stays non-null.

**And one latent frontend bug this surfaced:** `TeacherProfileSummary.formatDate` did
`new Date(iso)` guarded only by a NaN check. `new Date(null)` is **not** an invalid date
— it is the Unix epoch — so a null `updated_at` would have printed **01/01/1970** rather
than failing visibly. (`new Date(undefined)` *is* NaN; only `null` coerces.) Guarded, and
the demo dataset now seeds no `updated_at` on any lecturer so the null path is exercised
by simply opening a profile.

---

## Verification actually run

| What | Result |
|---|---|
| `pytest -q` (full) | **1705 passed** |
| `apply_sql.py 013` | 19/19, **re-run clean** (idempotent) |
| `apply_sql.py 014` | 3/3 |
| `apply_sql.py 015` | 37/37; existing rows unchanged (courses 125, students 46, teachers 12 still stamped) |
| Phase H | 9 new tests, incl. a schema-wide sweep asserting **all 29 ORM tables** and the live database, so a future table reintroducing the old default is caught. Attendance fallback proven load-bearing by negative control (2 failures without it). Browser: a never-edited lecturer reads "Last updated —", and reads a real date after an edit. |
| `verify_schema.py --expect 015` | **PASS** |
| `tsc -b --force` | clean |
| Live `sims` after 013 | 12 lecturers, `096543` gone, 23 `class_teachers` assignments intact, all four 31-char qualifications intact, `courses` still 125 rows with no `course_status` |
| Live `sims` after the test suite | `religions` still exactly 2 rows — the rollback wrapper held |
| ORM ↔ live | `TeacherDetail` and `SchoolProfileRead` read real rows out of live `sims`. Tests build their own database from metadata, so they could **not** have caught a mapping that disagreed with what 013 created. |
| Date formatters | Table of cases: the date-only timezone trap, a UTC instant that has rolled over while Belize has not, zero padding, null/empty, unparseable input. Weekdays cross-checked against UTC truth. |
| Access window | 13 boundary tests, then **re-run with the check neutered as a negative control — 5 failed**, confirming they catch the regression rather than passing vacuously. Every allowed case asserts `200`, not merely "not 403". |

## Left for the operator / open

- [ ] Run `013` and `014` against any environment other than the local `sims` they were
      applied to.
- [ ] `verify_schema.py` has **no fingerprints for 009–012**. Worth backfilling; not done
      here because guessing a probe for a migration you did not write is how a fingerprint
      comes to assert the wrong thing.
- [ ] Raise `courses.course_status` and the `varchar(30)` truncation with the DB person,
      so the next dump does not reintroduce them.
- [ ] `religions` is client-owned and read-only to this app. If it ever needs editing from
      here, bring it onto house convention (uuid PK, `created_at`/`created_by`) first.

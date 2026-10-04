# Needs your attention

_Everything open, as of 11 September 2026, in the order you can act on it. Extracted from
the per-cycle plan documents before they were deleted — nothing here was lost in the
consolidation._

Three kinds of item:

- 🔴 **Decisions only BAJC can make.** Work is blocked or running on an assumption until
  you answer.
- 🟠 **Operator tasks.** Nobody but you can run these; they touch the live database or the
  server.
- ⚪ **Known gaps.** Understood, deliberate, and waiting on a decision to schedule.

---

## 🔴 Decisions — these are blocking or are running on an assumption

### 1. How do repeats, withdrawals, incompletes and fails affect the GPA? — **blocks the GPA/repeat work**

Blueprint §29 and §31 say these "should be configurable according to BAJC policy". The
configurability can be built; **the policy cannot be invented.** Specifically:

- a repeated course — does the new grade **replace** the old one, or do both count?
- a withdrawal — currently it is dropped from the GPA. That is the safe reading (it
  cannot silently invent a failing grade for a student who was passing) but it is an
  **assumption, not your ruling**. §19 flattened W-P/W-F into one "Withdrawn", which cost
  the distinction D35 had built with you.
- an incomplete, and a transferred credit — same question.

⚠️ This work **changes GPA numbers**, so it must not start on a guess.

### 2. Is 15 credits really the full-time line?

Your own application form says *"Part Time is under 15 credits a term, Full Time is over
15."* Under that rule **not one student in the college is full-time**: 36 of the 43
registered this session declared Full Time, and the heaviest load anyone carries is **12
credits**. So either the form's number is not what you operate, or the declared load has
never been reconciled with anyone's actual registrations.

Tell me which, and the credit-load report stops flagging 36 people. ⚠️ The form also says
nothing about **exactly 15** — the report currently treats 15 as consistent with either
declaration rather than guessing.

### 3. Is "no 2025-2026 intake" correct?

The new-versus-returning report reads **0 new / 43 returning** for the active year — every
registered student first registered in 2024-2025. If BAJC did admit students this year,
their registrations are missing from the database rather than from the report.

### 4. Is the attendance floor "below 80%" or "80% and below"?

The setting's own description says *at or below*; the code that has shipped since D45
Phase 1 flags **strictly below**, so a student sitting on exactly 80.0% is not flagged.
The two screens now agree with each other — one word from you settles which is right.

### 5. Should the Registrar see the audit trail?

They are excluded today because they are its most frequent *subject*, and a subject who
can read it can see what has been noticed. That is defensible and it is also arguable —
they run registration and may reasonably need their own office's history. Say whether
they should have it, and whether scoped to their own actions or to everything.

### 6. Should the System Administrator get a "System activity only" view?

They are refused the trail entirely (§48 — it is mostly academic records). A scoped
endpoint filtering to accounts / roles / configuration **before** academic rows load is
buildable. Adding the role to the existing gate is not — that would hand them every grade
change in the college in one screen.

### 7. How long must the audit trail be kept?

Nothing is ever deleted today, which is the safe default and why no purge job exists. At
BAJC's size the growth is tens of MB a year, so there is no technical pressure — but
"keep everything forever" should be a decision you made rather than one you inherited.

### 8. Should a timetable clash **refuse** a registration, or warn?

Today a clash is warn-only and the enrolment succeeds. Now that the Dean will own the
timetable, this needs an answer. Room and lecturer double-booking will be refused outright
either way; this is only about the student's own clash. **Blocks the last item of the
timetable work.**

### 9. §8 "Office information" — what is it?

Is it the programme office's *location*, its *hours*, a phone number, or free text? It is
stored as free text today because nobody could say.

### 10. §24 assessment weights

The system deliberately does **not** assume weights total 100. Confirm that is right, or
say what the rule should be.

### 11. What does **red** highlighting mean?

§39 student photographs, §43 system activity, §57 "differs from current configuration",
§66 record locking are marked red in the blueprint, and red is not in your legend.



### 13. Run the `application_temp` rename — **the pending-forms screens are broken until you do**

```
backend/db/mariadb/rename_application_temp.sql
```

One statement: `RENAME TABLE student_profile_temp TO application_temp`, guarded so it is
safe to run twice. Run it against **`sims`**.

**Why it is urgent rather than tidy:** the code has already been changed to expect the new
name, exactly as you asked. Until the statement runs, anything that touches Pending forms
answers *"Table 'sims.application_temp' doesn't exist"*. Nothing else in the system is
affected — no other table has a foreign key pointing at this one.

**Why the rename at all:** the table never held a student profile. It holds an application
that has been saved and not yet submitted; the person it describes is an applicant who may
never become a student. Every other name on the table had already drifted to the truth —
the ORM class is `ApplicationTemp`, the constraints are `fk_apptemp_*`, the audit trail
already writes `entity_type = "application_temp"`. The table name was the last holdout.

Rows are preserved; indexes and constraints come across untouched and need no renaming.
`sims_final.sql` has already been hand-edited to match, so a rebuild from the dump creates
`application_temp` directly.

⚠️ It has **not** been run anywhere, including the scratch database — you asked to run it
yourself, so it is unexecuted SQL. Review it before running.

### 14. Keep `sims_final.sql` current

It is now the **only** provisioning artefact — the 20 numbered migrations were deleted on
10 Sep 2026. Re-dump it from HeidiSQL after any schema change, or a fresh environment will
be built from a stale schema.

### 15. Take a real backup

A nightly `mysqldump` off-host is a few lines and does not exist yet.

### 16. One pending form's programme may need re-picking

The programme **was** being saved correctly all along — the bug was that it was never
read back, and reopening a form then showed an empty Programme select. If anyone
reopened a pending form and saved it while the defect was live, that save wrote the empty
value back and the programme is genuinely gone from that row. (The button was *Save and
close* at the time; it has since been replaced by saving on every *Continue*, which means
the same row could now be blanked without anyone pressing anything deliberate — one more
reason to check.)

Only one pending form exists in `sims` and its programme is intact (General Studies).
Worth a glance at the Pending forms list to confirm the column is populated now.

### 17. Look at the redesigned Dean dashboard

`npm run demo`, sign in as the Dean. It was verified by server-rendering and screenshots,
but nobody has clicked it. Worth checking the ledger row at phone width and the
"Nothing needs your attention" state, which the demo dataset may never produce naturally.

---

## ⚪ Known gaps — deliberate, and waiting on scheduling

| Gap | Why it is not built |
|---|---|
| **Academic Standing** (§30) — probation, Dean's List | Deferred with **C1**. The Dean dashboard leaves its two KPI tiles out rather than showing a zero for a feature that does not exist |
| **Graduation Audit, Degree Award, Transcript Management** (§33–§37) | Deferred with **C2**. Graduation and transcript *reports* go with them |
| **Timetable editing** (§18) | The read-only week is built; the Dean-owned editor is the last planned phase, and needs decision 8 above |
| **§38 Program Progress** on the Student Portal | The only remaining piece of the dashboards work. Needs nothing from you — it measures against the programme's current `program_courses`, and the screen will say it is progress against the programme *as it stands today* |
| **Event-driven notifications** (§54) | In-system announcements exist; nothing fires on application received, grade posted, attendance warning. No email integration at all |
| **Curriculum Management** (§10) | **Removed**, not deferred, at Meeting #5 |
| **Students-not-registered / outstanding-grades reports** (§53) | The two remaining institutional reports. Both are "who is MISSING something", a different query shape from the five built |
| **Granular permissions** | Access is role-based; there is no `permissions` / `role_permissions` table |
| **Server-generated PDF** | Printing is browser-side `window.print()` with print stylesheets |
| **A written security review** | `security-review.md` was a 151-byte stub and has been deleted. A real pass is worth doing now that every endpoint exists — the scoping rules are where the risk concentrates |

---

## ⚠️ Two things to be careful of

**`class_meetings.room` and `course_offerings.classroomid` both describe where a class
meets**, and the free-text one is still what the timetable renders. Two columns can
describe one fact for exactly as long as it takes to decide which wins.

**`semesters.semester_status` is storage-only** — it overlaps `is_active` and the year's
archive state, and nothing reads it.

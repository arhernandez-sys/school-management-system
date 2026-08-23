# D34 — Legacy-Table Removal & Client-Schema Reconciliation

> **Working plan and record.** Successor to D33 (`docs/d33-ux-and-midterm-freeze-plan.md`).
> Read §A before touching `student_profiles`: it records what the client's dump actually
> differed by, and most of what *looked* new was a rename the chain had already done.

---

## STATUS

| | |
|---|---|
| **Phase** | **BOTH COMPLETE** |
| **Status** | 🟢 **D34 COMPLETE** — 2026-08-23 |
| **Branch** | `tertiary-refactor` (continues from D33, uncommitted) |
| **Live DB** | `sims`: **46 → 39 tables** (legacy dropped), **migration `011` APPLIED** (26/26) |
| **Backend suite** | **1566 green** (1565 + the new login/contact-email distinction test) |
| **Frontend** | `tsc -b --force` clean; `eslint` 0 errors / 2 pre-existing warnings; `probe_d33.mjs` **55/55** |

### What the operator asked for

1. **Remove all legacy tables** — "it is not needed."
2. A note that they **had not run the database files** — checked; see §B.
3. **Compare their `student_profiles` dump with live**, add what is genuinely new, then
   **fix the frontend and API**.

### Decisions taken (2026-08-23)

| # | Question | Decision |
|---|---|---|
| D34-1 | Adopt the client's `status` vocabulary? | **Yes, fully.** `active`→`Registered`, `inactive`→`Unregistered`, `DropOut` added. |
| D34-2 | Where does `'Summer'` go? | **`enrollment_load`**, beside `Transient`. |
| D34-3 | Add `educationbg_id` / `doc_id` despite not fitting? | **Yes** — mapped for the client's tooling, no FK, no consumer. |

---

## §A — What the diff actually found

The client supplied a HeidiSQL dump of their `student_profiles`, `courses` and `programs`.
It has moved on from the `db/mariadb/sims.sql` this repo was built against.

### A1. Ten columns genuinely absent from live

Verified absent **under any spelling** by querying `information_schema` on live `sims`:

| client column | added as | note |
|---|---|---|
| `studentid_original` | `student_id_original int(8)` | the ID it carried in the system it came from |
| `email` | `email varchar(254)` | **live had NO student email at all** — see A3 |
| `transferedfrom` | `transferred_from varchar(250)` | misspelt in their dump; not cast into a column name |
| `graduationdate` | `graduation_date date` | auto-stamped on `→graduated` |
| `dropoutdate` | `dropout_date datetime` | auto-stamped on `→DropOut` |
| `dropoutreason` | `dropout_reason varchar(250)` | |
| `comments` | `comments text` | Registrar's notes, never shown to the student |
| `origin` | `origin varchar(50)` | where the record came from |
| `educationbg_id` | `educationbg_id uuid` | ⚠️ **no FK, no consumer** — see A4 |
| `doc_id` | `doc_id int(11)` | ⚠️ **no FK, no consumer** — see A4 |

### A2. What looked new but was a RENAME — deliberately NOT re-added

This is the important half of the audit. Re-adding any of these would have created a
second column for a fact the database already held.

| their dump | live (authoritative) | renamed by |
|---|---|---|
| `studentnumber int(8)` | `student_number text` | `001` / `007` — a `YYYYMM###` with a leading zero is not a number |
| `civicstatus` | `civil_status` | `005` |
| `sufferhealth enum('Y','N')` | `has_health_condition tinyint(1)` | `005` |
| `atlibexam enum('Y','N')` | `atlib_exam tinyint(1)` | `005` |
| `mothername` / `fathername` | `mother_name` / `father_name` | `005` |
| `parentphone` / `parentemail` | `guardian_phone` / `guardian_email` | `sims.sql` |
| `ctv` | `city_town_village` | `005` |
| `programid varchar(8)` | `program_id uuid` + FK | `005` — a `varchar(8)` could never have joined `programs.id` |
| `yearofstudy` (6 values) | `year_of_study` + `enrollment_load` | D30 §D11 — one column could answer neither question |
| `createdby/on`, `editedby/on` | `created_by/at`, `updated_by/at` | `sims.sql` |

**Four columns are LIVE-ONLY and were kept**: `address` (printed verbatim on letters and
report cards), `guardian_name`, `health_condition_note`, `application_id`.

### A3. The email finding

D33 documented that `student_profiles` had no email column and derived
`StudentDetail.email` from the linked `users` row. That is NULL for anyone without a
login — so **a student registered on paper had nowhere to record a contact address**, even
when the office held one on the form.

The client's dump has a real `email`. D34 adds it, and **renames the derived field to
`login_email`**, because the two are different facts: one is how the office writes to
them, the other is what they sign in with. Sharing a name is how an address correction
would silently move a login.

### A4. The two columns that do not fit

Added on the operator's instruction (D34-3), with no FK and nothing reading them:

* **`educationbg_id`** — there is no student-level education table to point at. Prior
  education is APPLICATION-scoped (`application_education.application_id`), by design: an
  application is a frozen record of what was declared.
* **`doc_id`** — `student_documents.id` is a **uuid, not an int**, so it cannot be a FK;
  and a student's documents are 1:N (`student_documents.student_id`), so one scalar cannot
  name them.

Both are exposed **read-only** on `StudentDetail` so the client can see what their column
holds, and are absent from `ADMISSION_PROFILE_FIELDS` so nothing writes them.

### A5. `courses` and `programs` — deliberately untouched

Their dump's versions of these two are the **pre-D31 shapes** (`courseid int`,
`coursecode varchar(8)`, and a `coursestatus enum('Audit','Withdraw Passing','Withdraw
Failing')` which is an *enrolment* attribute, not a course one). Live has been on the uuid
`courses` / `programs` model since `006`, with 125 and 8 rows. Reconciling toward the dump
would be a regression, so nothing was changed. **Their `programs` row set also uses
different codes** — see §F.

---

## §B — "I have not run the database files you added"

Checked directly against live `sims` rather than trusting the D32 plan:

* **`009` WAS already applied.** `semesters.midterm_submission_start` / `_end`,
  `assessment_policies.students_can_view_grades`, `report_card_snapshots.kind` and the
  widened `uq_report_card_snapshot (student_id, semester_id, kind)` are all present. So
  **nothing needs running for D32/D33** — the mid-term freeze works against live today.
* **`010` had NOT been run**, correctly: every statement in it was commented out by design.
  D34 executed it — see §C.

---

## §C — Phase 1: the legacy tables ✅

- [x] Backed up **schema AND all 144 rows** of the seven tables first. `apply_sql.py
      --backup` is schema-only, which would have lost the 133 rows of pre-D31 homeroom
      history
- [x] Ran `010` §1's pre-flight and **refused to proceed unless it confirmed**: four tables
      empty, all 11 `subjects_legacy_pre_d31` rows verified present in `courses` under the
      same ids, and **0 live tables holding an FK into any legacy table**
- [x] Dropped all seven, child before parent (`class_subjects_legacy_pre_d31.class_id` is
      an FK onto `classes_legacy_pre_d31`)
- [x] **46 → 39 tables.** 39 is the ORM's own table count, so the database now holds
      exactly what the application models and nothing else
- [x] **A test fired, exactly as `010`'s audit note predicted it would.**
      `test_courses.py::test_the_catalog_row_lives_in_courses_and_subjects_is_retired`
      asserted "the quarantined copy must be KEPT, never dropped". That assertion is now
      inverted to require its absence — the strongest form of the claim

---

## §D — Phase 2: the client-schema reconciliation ✅

### Migration
- [x] `011_client_schema_reconcile.sql` — §1 the ten columns, §2 `'Summer'`, §3 the status
      vocabulary. **Applied to live `sims`, 26/26 statements**, after dumping the 46
      `student_profiles` rows
- [x] The status migration is **three steps and the order is load-bearing**: widen the enum
      to the UNION of both vocabularies → migrate the rows → narrow to the final set.
      Narrowing first fails with "Data truncated for column 'status'"
- [x] Live rows verified after: **42 Registered, 1 Unregistered**, 1 each
      transferred/graduated/withdrawn
- [x] `011` carries a **companion-code warning** that `009` did not need: the moment §3c
      lands, a backend still on `"active"` cannot write a status at all, and every
      `status == 'active'` filter matches ZERO rows *silently* rather than failing

### Backend
- [x] `StudentStatus` — members renamed to track the values (`REGISTERED`, not `ACTIVE`), so
      a reader sees the word the registry uses. ~20 call sites
- [x] `EnrollmentLoad` += `SUMMER`
- [x] The 10 columns on `StudentProfile`; the 8 writable ones added to
      `_AdmissionProfileFields` and `ADMISSION_PROFILE_FIELDS` (one list, so create/update/
      read cannot drift); `educationbg_id` / `doc_id` read-only
- [x] `StudentDetail.email` → `login_email`, with the real `email` beside it
- [x] Transition graph: `DropOut` added as a **terminal** state — a student who left
      mid-programme has stopped, which is what separates it from `Unregistered`
      ("completed the last semester but is not continuing")
- [x] `change_student_status` **stamps `graduation_date` / `dropout_date`**, and copies the
      transition `reason` onto `dropout_reason`. Only when EMPTY and only on the transition
      IN, so a corrected date survives a later status shuffle and re-registering a graduate
      does not erase the graduation. Without this the columns would be permanently NULL —
      the trap D32 found on `report_card_snapshots.storage_key`
- [x] "Only Dean/Registrar may set graduated" — **already true**, no change needed:
      `POST /students/{id}/status` is `require_role(PRINCIPAL, SECRETARY)`

### Frontend
- [x] `StudentStatus` type + `STUDENT_STATUS_LABEL` / `_KIND` / `_OPTIONS`. `DropOut` is
      the only status rendered `error` — it is the one negative outcome on a register
- [x] 18 student-status sites moved, **one exact-string edit each, never a sweep**: these
      files also hold `'active'` for TEACHER and ACADEMIC-YEAR status
- [x] `StudentFormDialog` — Personal e-mail beside the phone, a **Registry** section
      (transferred-from, original ID, origin, the two stamped dates, reason, comments), and
      the login field renamed and read-only
- [x] `StudentProfileSummary` — contact e-mail and login as separate rows; the registry
      columns on the Registration section, each dropped when empty; comments as a Notes
      block
- [x] Demo mode mirrored end to end: `DemoStudent`, the seed (incl. one `DropOut` so the
      register has one to show), create, PATCH, acceptance, and the status stamping
- [x] `openapi.json` regenerated and copied to `frontend/`

---

## §E — Verification

Static checks have hidden real defects in this repo before, so everything below was
**executed**.

1. **Live DB** — `information_schema` diffed before and after; status distribution counted
   both sides of the rewrite.
2. **Backend suite** — **1566 green**. Four tests failed first and all four were correct
   pins of the old behaviour: the legacy-quarantine assertion (§C), the `status` default
   on create, and two D33 assertions about `email` not being writable.
3. **`frontend/scratchpad/probe_d33.mjs` — 55/55**, driving the real MSW handlers. Section
   7 is new: all ten columns on the wire, `email` ≠ `login_email`, no student left on the
   old vocabulary, `DropOut` represented, create round-trip, **both dates stamped
   automatically**, re-registering keeping the graduation date, `'Summer'` accepted.
4. **`probe_dataset.mjs`** — its two `status === 'active'` assertions failed and were
   moved; green after.
5. **`check_msw_routes.mjs`** — 0 ghost routes.
6. **`tsc -b --force`** — located all 18 frontend status sites by itself, which is the
   argument for a string-literal union over a loose `string`.

---

## §F — Open for the client

1. **`programs` row sets disagree.** Their dump has 8 programmes coded
   `BAG/ASM/ASB/REL/IT/BM/GS/EDUC`; live has 8 coded
   `AGRI/BIOL/BMAD/EDUC/GNST/ITEC/MATH/RELG`. Same count and the same programmes by name,
   **different codes** — and the code is what the register and the report card print.
   Nothing was changed. BAJC should say which set is canonical; if theirs, it is a data
   update plus a re-print check, not a schema change.
2. **`educationbg_id` and `doc_id` are inert.** Added as instructed, but nothing reads or
   writes them and neither can be a foreign key (§A4). If the intent is for a student to
   carry prior education of their own, that needs a `student_education` table; if it is to
   name a primary document, `student_documents` already holds them 1:N and the pointer
   would want to be a uuid.
3. **`courses` / `programs` were not reconciled** toward the dump, because their versions
   are the pre-D31 shapes (§A5). Their `courses.coursestatus`
   (`Audit` / `Withdraw Passing` / `Withdraw Failing`) is worth a conversation though:
   those are **enrolment** states, not course attributes, and this system has nowhere to
   record them today.
4. **The two D32 items are still open** — see `docs/midterm-revision-reports-plan.md` §F:
   whether the Registrar keeps the Reports module (the legacy-table authorisation is now
   closed).

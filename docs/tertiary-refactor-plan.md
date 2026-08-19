# SIMS → Tertiary (BAJC) Refactor — Working Plan & Tracker

> **ALL FIVE PHASES ARE COMPLETE (2026-08-18).** Every box in §E is ticked and every gate
> was walked against the live database. **Read §I — the closing report — first**: it says what
> the system can now do, where it is deliberately strict, and what is deliberately not done.
> The outstanding work is §G (13 items to confirm with BAJC) and §F (pre-existing repo
> issues, including a go-live password blocker). §E remains the phase-by-phase record.

---

## STATUS

| | |
|---|---|
| **Phase** | **ALL FIVE PHASES ✅ COMPLETE** (0–5) |
| **Status** | 🟢 **D30 COMPLETE** — Phase 5 gate walked and passed 2026-08-18 (**42/42 against the live database**; request → notify → approve/deny → audit trail complete) |
| **Branch** | `tertiary-refactor` (off `phase7-backend-and-fixes`) — **uncommitted; the client commits after Phase 5** |
| **Last updated** | 2026-08-18 |
| **Next action** | Nothing outstanding in this plan. The remaining work is the **§G open items to confirm with BAJC** (13 of them) and the **pre-existing repo issues in §F** — chiefly the 19 live accounts sharing `SimsDemo2025!` with `must_change_password = false`, which is a go-live blocker inherited from before D30. The closing report is §I. |
| **Backend suite** | **1394 green** |
| **Catalog** | **Seeded from the real 2026/27 sequences**: 114 courses, 8 programmes, 243 curriculum rows, 63 prerequisites, 1 `ALL COURSES` gate. |
| **Grading scale** | **BAJC 8-band, seeded and priced** — A 95-100 (4.00) … C 70-74 (2.00), D 65-69 (1.00, FAIL), F 0-64 (0.00, FAIL); `pass_mark` 70. Defined once in `backend/app/modules/settings/grading_defaults.py`; applied to existing databases by `python -m app.db.seed_grading_scale`. Archived years keep their frozen 5-band scale. |
| **Grade revision** | **Live** — `POST /assessments/{id}/grade-revisions` (Lecturer) + `/grade-revisions/*` (the Dean's queue and ruling). Approval writes `makeup_score` and **never overwrites `score`**; it works through a closed grade-submission deadline, which is the post-deadline path Phase 3's dormant bypass pointed at. The bell count is extended, not duplicated (§D8). |
| **Admissions** | **Live** — `/applications/*` (13 endpoints) + `/credit-transfers/*`. Registrar + Dean file/edit/accept/deny; **credit-transfer decisions and programme changes are Dean-only**. Documents are a checklist, not uploads (§G item 11). Acceptance creates the student + login + `YYYYMM###` in one transaction. |
| **Migrations applied** | `sims.sql` → `001` → `002` → `003` → `004` → `005` → **`006`** → **`007`**. All applied. **Neither Phase 3 nor Phase 4 added a migration** — `005` had already created every column and table they needed (§3/§6/§7 for grading and GPA, §9–§16 for admissions, credit transfer and programme history). |

> **After provisioning, run BOTH reference seeds.** `python -m app.db.seed_bajc` (the
> catalog) and `python -m app.db.seed_grading_scale` (the 8-band scale with grade points).
> Skipping the second is silent: nothing errors, but every GPA prints 0.00 because
> `grade_point` is NULL on a pre-Phase-3 scale. RUNBOOK §4 has the order.

> **Live-database finding (2026-08-13).** The `sims` database this repo points at is the
> **repo-provisioned one, with `001–004` applied** — `class_meetings` exists, and
> `courses` / `programs` / `educational_background` / `documents` are all **absent**.
> 34 tables, ~4,900 rows of demo data (45 students, 11 subjects, 2,888 assessment grades).
> So `sims_bk.sql` was dumped from a **different** database — presumably the machine where
> the tertiary schema work was done in HeidiSQL. This confirms §B1 and simplifies `005`:
> its quarantine guards in §1 are all no-ops here, and the merge is purely additive.

**Marking convention**

```
- [x] Task — COMPLETED yyyy-mm-dd
- [ ] Task                                (not started)
- [~] Task — IN PROGRESS
- [!] Task — BLOCKED: <reason>
```

At the end of a phase: tick every box, change the phase heading to
`### Phase N — ✅ COMPLETED yyyy-mm-dd`, update the STATUS table above, and add a §H change-log entry.

---

## Context

`school-management-system` is a working sixth-form SIMS (React 18 + TS + MUI 6 + TanStack Query;
FastAPI + SQLAlchemy 2 sync; self-hosted **MariaDB 12.3** `sims`). Docs Phases 1–7 complete, Phase 8
QA in progress.

It must become a proper tertiary **Student Management Information System** for **Belize Adventist
Junior College (BAJC)** — real programmes, course sequences, prerequisites, admissions, grading policy
and report layout — **without a rewrite**.

**The repo is further along than the brief assumes.** Decision **D29 (2026-08-06)** already pivoted it
to a university-pattern subject-class model: a `classes` row is already one **subject class**
("Math-1"), a student already holds **many concurrent enrolments**, and `class_meetings` already gives
a weekly timetable. `frontend/src/i18n/strings.ts` already reads `Belize Adventist Junior College`.
**Class → Course is therefore mostly rename + attach credits/curriculum, not a remodel.**

### Decisions taken (2026-08-13, with the client)

| # | Decision |
|---|---|
| 1 | **Schema** — full additive set authorised. **Merge**: keep `001–004`, adopt the tertiary work from `sims_bk.sql`. |
| 2 | **Catalog** — **`courses` becomes the course catalog**; `subjects` is retired into it. *(Recommendation was to extend `subjects`, which is the app's spine while `courses` is wired to nothing. Client chose `courses`. Mitigation in §D2: preserve UUIDs so no grading data is orphaned.)* |
| 3 | **Rename** — **display labels only**. Wire values `principal\|secretary\|teacher\|student`, routes and table names are preserved, per brief §2. |
| 4 | **GPA** — denominator is **all enrolled credits**; ungraded courses contribute 0 quality points. Reproduces the sample report's 2.1. |
| 5 | **Admissions** — the form creates an **application**; acceptance generates the student, the student ID and the login. |
| 6 | **Delivery** — phased, with an approval gate between phases. |

### Source documents

`C:\Users\arhernandez\Downloads\SIMS Documents\`

| File | What it is |
|---|---|
| `sims_bk.sql` | MariaDB dump of `sims`, **structure only, 0 rows**. 30 tables. See §B1 — it is *not* the schema the app runs on. |
| `BAJC ALL PROGRAMME COURSE SEQUENCE 2026.pdf` | 8 pages, one per programme, sequence 26/27. |
| `BAJC MID SEMESTER REPORT TEMPLATE.pdf` | 1 page. Filename says mid-semester; the document is titled **"End of Semester Report"**. |
| `WhatsApp Image ... 9.17.48 PM.jpeg` | Application form **page 1** (`application1`) — Sections A, B. |
| `WhatsApp Image ... 9.18.15 PM.jpeg` | Application form **page 2** (`application2`) — Sections C–G + official-use block. |

**Not supplied:** the **academic-policy image** (its rules are stated verbatim in the brief and are
used as authoritative, but they are sourced from the brief, not an institutional document), and a
**separate mid-term report** layout (only one layout exists).

---

## A. Source-material audit — ✅ COMPLETE

Institution: **Belize Adventist Junior College**, Calcutta, Corozal, Belize. P.O. Box 257.
Tel 423-0068. `dean@` / `academics@` / `admissions@` / `secretary@bajc.edu.bz`. Portal `my.bajc.edu.bz`.

### A1. The 8 programmes

| Award | Programme | Total credits |
|---|---|---|
| Associate of Social Science | Business Management (`BMAD`) | 87 |
| Associate of Social Science | General Studies | 87 |
| Associate of Science | Biology | 88 |
| Associate of Science | Applied Agriculture | 86 |
| Associate of Science | Information Technology | 90 |
| Associate of Science | Mathematics | 87 |
| Associate of Arts | Primary Education | 102 |
| Associate of Arts | Religion | 86 |

**Term blocks are not uniform and not 1–2:**

- 7 programmes: `Summer 1 · Semester 1 · Semester 2 · Semester 3 · Semester 4`
- Primary Education: `Summer 1 · Sem 1 · Sem 2 · **Spring 1** · Sem 3 · Sem 4 · **Spring 2** · **Semester 5**`

A programme's block is a **curriculum position**, not a calendar term. Both are modelled — §D3.

Course attributes in the source: `Course Code`, `Course Name`, `Component` ∈ {GEC, SEC, CEC},
`Pre-requisites`, `Credits` ∈ {1, 2, 3, 4, 6, 9}.

**Prerequisites are multi-valued and can be long:**

- `AGRI2118` ← `AGRI1108, AGRI1109`
- `EDUC1210` ← `EDUC1102, EDUC1104`
- `EDUC2305` ← `EDUC1210, 2226, 2228, 2330, 2334, 2336` (six)
- `THEO2224` ← `THEO1104, THEO2114`
- `EDUC3101` ← `EDUC1210, SPAN2112`
- `EDUC3201` (Internship) ← **`ALL COURSES`** — a whole-programme gate, not a course list

Lab courses are separate courses with their own code, credit and prerequisite
(`BIOL1204L` ← `BIOL1102L`).

### A2. Report template — one layout, not two

Header: BAJC logo, "BAJC / A Christian Institution", then
`Belize Adventist Junior College / Calcutta, Corozal / Belize C.A. PO Box 257 / Tel: 4230068 Email: secretary@bajc.edu.bz`.

Label block: **Student ID · Student Name · Program · Semester · Period · Block**
(sample: `2506842`, `Presley Rancharan`, `BMAD`, ``, `Summer, July 2026 - August 2026`, `-`).
`Program` prints the programme **code**; `Period` is `"<TermName>, <Month Year> - <Month Year>"`.

Title: **End of Semester Report**

Table: `Course Code | Course Name | Credits | Instructor | Grade` — grade is a **letter**, blank when
ungraded. Then a spacer row and a **GPA** row.

Footer: Dean signature image, `Dean`, `Email: dean@bajc.edu.bz`,
`Website: http://www.bajc.edu.bz`, page footer `my.bajc.edu.bz | <page> | <timestamp>`.

**GPA in the sample confirms decision #4:** 5 courses × 3 cr, three graded (B 3.00, A- 3.75, A- 3.75),
two blank. Printed GPA **2.1** = `(3.00+3.75+3.75)×3 ÷ 15 = 31.5/15`. Graded-only would give 3.50.

### A3. Application form — the registration source of truth

- **Header** — School year; passport-size photo.
- **Section A · Personal Information** — Last Name, First Name, Middle Name; Street, Village/Town/City,
  District; Date of Birth (D/M/Y), Age, Social Security No.; Gender (M/F); Civic Status; health or
  learning condition (No/Yes + attach medical certificate); Religion, Personal telephone, Personal
  e-mail; Next of kin for emergency (Name, Relationship, Telephone); Name of Parents (Mother, Father).
- **Section B · Educational Background** *(handwritten note on the form: "Add New Tab")* — credit-transfer
  notice (CTA + original transcript + course outlines), then a **repeating table**: Name of Institution |
  Education level (High school or tertiary) | Graduated? (Yes/No) | Graduation date. Then Examinations:
  ATLIB Exam (Yes/No); Number of CSEC Exams (1–8+).
- **Section C · Financial Information** — who will finance your study: Name, Telephone, e-mail.
- **Section D · Recommendation** — BAJC Character and Academic Recommendation Form, completed by a high
  school teacher.
- **Section E · Programme of Study** — the 8 programmes as checkboxes; **Year of study: First / Second**;
  and **separately** Part Time (<15 crs) / Full Time (>15 crs) / Transient.
- **Section F · Documents to submit** *(handwritten note: "add documents")* — Passport size photograph;
  Copy of HS diploma; BAJC recommendation Form; Copy of a valid Social Security card; Course outlines
  (only if transferring credits).
- **Section G · Agreement** — applicant signature + date; parent/guardian signature (required only if
  the applicant is under 18).
- **FOR OFFICIAL USE ONLY** — Date Accepted | Academic Year | Programme of Study | Enrolment Status |
  Student Code; plus Comments/Observations.

---

## B. Database audit — ✅ COMPLETE

### B1. The blocking conflict (resolved by decision #1)

**`sims_bk.sql` is not the schema the application runs on.** It is the repo's pre-`001` base dump plus
new tertiary work, and is missing everything `backend/db/mariadb/001–004*.sql` added:

| Missing from `sims_bk.sql` | Consequence if used as-is |
|---|---|
| `login_attempts.attempted_at` default | MariaDB ERROR 1364 — **every login fails** |
| `audit_log.id` not AUTO_INCREMENT | every audit write fails |
| `subjects.is_active` still a GENERATED column | ERROR 1906 — every subject write fails |
| `classes.className`, `subjects.subjectName` | ORM expects `name` |
| `student_profiles.full_name` absent | students module breaks |
| `refresh_sessions.token_hash varbinary(50)` | truncates the 64-char SHA-256 hex |
| `created_at`/`updated_at`/`created_by`/`updated_by` on ~25 tables | every mixin write fails |
| `class_meetings`, `student_profiles.year_group` | D29 timetable gone |
| `assesment_categories` never renamed | duplicate of `assessment_categories` |
| `announcement_reads` PK on `announcement_id` alone | one read per announcement across all users |

Conversely it **adds** genuinely new tertiary work worth keeping: `courses`, `programs`,
`educational_background`, `documents`, and the tertiary columns on `student_profiles` — split
`firstname`/`middlename`/`lastname`, `ssno`, `district`, `programid`, `yearofstudy`, `atlibexam`,
`num_csec`, `nok_*`, `finance_*`, `street`, `ctv`, `religion`, `civicstatus`, `sufferhealth`,
`mothername`/`fathername`.

→ **`005_tertiary.sql` lands the merge.** `001–004` stay; the tertiary additions are applied on top and
the ORM is updated to match.

### B2. Grade audit (brief §19 and §28-B) — answered

**Does the database contain a column/table for storing grades? Yes — in three places.**

| Level | Table | Column | Type | How it is used |
|---|---|---|---|---|
| Per assessment | `assessment_grades` | `score` | `Numeric(6,2)` | Raw score, **not** a percentage. Paired with `assessments.max_score` and `status` enum(`pending`,`graded`,`absent`,`excused`,`exempt`). A CHECK forces `score` non-null **iff** `status='graded'`. |
| Per assessment, 2nd attempt | `assessment_grades` | `makeup_score` | `Numeric(6,2)` | Substitutes for `score` when the resolved policy has `allow_makeup`. |
| Frozen term grade | `term_grade_snapshots` | `numeric_grade`, `letter_grade` | `Numeric(6,2)`, `Text` | Per (student, class_subject, semester). Also `weight_base_used`, `effective_policy` JSON. |
| Legacy, orphaned | `grades` | `grade` | `int` | Int FKs to nothing. Ignore. |

Letter derivation is real and centralised in **`backend/app/modules/grades/calc.py`** (497 lines,
deliberately pure — no Session, no ORM, no I/O). `letter_for()` is half-open on `min_score`
(`max_score` is never consulted); `resolve_policy()` is a 4-level most-specific-wins chain
(assessment → category → academic_year → `assessment_policies` singleton); rounding is
`ROUND_HALF_UP` to 2dp. Grades, Reports, Dashboard and the archival freeze **all** call in — nothing
recomputes locally.

**Supported today:** assessment grades ✅ · final/term course grades ✅ · letter-grade bands ✅ ·
per-assessment second-attempt *score* ✅ (partial) · generic audit trail (`audit_log`) ✅ ·
frozen report-card payloads ✅

**Not supported when this was written (2026-08-13). Struck through as the phases closed it:**

- ~~❌ **Grade points**~~ → ✅ `grading_scale_bands.grade_point`, seeded with the BAJC
  8-band scale (Phase 3)
- ~~❌ **Quality points**~~ → ✅ `calc.quality_points`, plus a frozen
  `term_grade_snapshots.quality_points` (Phase 3)
- ~~❌ **Credit-weighted GPA**~~ → ✅ `calc.compute_gpa`, on the report card, transcript
  and student dashboard (Phase 3). The chain that made it possible was closed by `006`
- ~~❌ **Programme-specific pass mark**~~ → ✅ `programs.min_passing_grade_point`, read by
  `calc.meets_grade_point` (Phase 2C seeded it, Phase 3 gave it real grade points to
  compare)
- ❌ **Course retakes** — `uq_enroll_active` still has no attempt/sequence column. Outside
  the brief; see §G item 5. **The only item on this list D30 did not close.**
- ~~❌ **Grade revision workflow**~~ → ✅ `grade_revision_requests` carries the reason, the
  requester, the approval status, the decision and the original-vs-revised pair; approval
  writes `makeup_score` and leaves `score` untouched (Phase 5, §D7)

`docs/database-schema.md:1035` records the omission as deliberate: *"Cumulative / GPA fields
(deliberately not stored)… Were a credit-weighted GPA introduced later, the natural home is a
`subjects.credit_hours` column feeding the §10.6 union — an additive change, not a remodel."*
This plan is exactly that additive change.

> **That note is now SUPERSEDED (Phase 3, 2026-08-17).** The GPA exists and is computed on
> read by `calc.compute_gpa`; its inputs (`grade_point`, `credits`, `quality_points`) are
> frozen onto `term_grade_snapshots` at archival. The prediction was right about it being
> additive and slightly wrong about the home: the credits landed on `courses`, not on
> `subjects`, because `006` moved the catalog there. `docs/database-schema.md` has not been
> rewritten — it still describes PostgreSQL throughout (§F).

### B3. The structural blocker

The graded chain is `assessment_grades → assessments → class_subjects → subjects`.

- `subjects` = `(id, name, code, category, elective, is_active)` — **no credits**
- `courses` = `(courseid, coursecode, coursename, component, prerequisites, credits, coursestatus, …)`
  — has credits, but is **completely disconnected**: nothing references it and it references nothing

**So today no stored grade can reach a credit value.** That single fact makes credit-weighted GPA,
quality points, credits-earned and credits-remaining all impossible. §D2 fixes it.

### B4. Other confirmed gaps and defects

| Area | Finding |
|---|---|
| Roles | `users.role enum('principal','secretary','teacher','student')` — no dean/registrar/lecturer |
| Programme ↔ course | No join table. `programs` and `courses` have no relationship. The PDF's whole course-sequence structure has nowhere to live. |
| Curriculum term block | No structure for `Summer 1 / Semester 1..5 / Spring 1..2` per programme |
| Calendar semester | `semesters.sequence CHECK IN (1,2)` + `UNIQUE(academic_year_id, sequence)` → **max 2 terms per year**. BAJC runs Summer and Spring blocks too. `POST /settings/academic-years` hard-creates exactly two; there is deliberately no `POST /settings/semesters`. |
| Prerequisites | Only `courses.prerequisites varchar(50)` — free text, unstructured, unqueryable, no FK, too short for the real 6-course lists, cannot express `ALL COURSES` |
| Student ↔ programme | `student_profiles.programid varchar(8)` vs `programs.programid uuid` — **type mismatch, no FK** |
| Student ↔ education bg | ~~single-valued `educationbg_id` against a table with no `student_id`~~ → ✅ `application_education`, a proper repeating table owned by the application (Phase 4) |
| Student ↔ documents | `student_profiles.doc_id int` vs `documents.docid uuid` — mismatch. (`student_documents` is the sound one and already has `student_id`.) |
| Year of study | ~~one column conflating year and load~~ → ✅ split by `005` §9 into `year_of_study` and `enrollment_load`, both mapped and both asked separately by the wizard's Section E (Phase 4) |
| Applications | ~~**No applicant entity.**~~ → ✅ `applications` + `application_education` + `application_documents`, with the official-use block on the application and `ApplicationStatus` distinct from the student lifecycle (Phase 4) |
| Credit transfer / CTA | ~~**Nothing.**~~ → ✅ `credit_transfer_requests` with the ≥75% floor, the tertiary-institution rule, admission-only filing and the Dean's decision (Phase 4) |
| Notifications | **No notifications table.** `announcements` + `announcement_reads` are broadcast-only. |
| Settings | `assessment_policies` (singleton), `academic_years` policy columns, `school_profile`, `user_preferences`. **No grade-submission deadline anywhere.** |
| Programme change | ~~No structure~~ → ✅ `student_program_history` with one-open-row enforced by the database, plus the derived academic history's five buckets (Phase 4) |
| Student ID | ~~No generation logic~~ → ✅ `students/numbering.py` allocates `YYYYMM###` server-side (Phase 1), and acceptance is what issues it (Phase 4) |

---

## C. Codebase map — what to reuse

| Concern | Reuse this | Path |
|---|---|---|
| All grade math | `calc.py` — pure, single source of truth. **Never duplicate grade logic into a service.** | `backend/app/modules/grades/calc.py` |
| Coarse role gate | `require_role(*roles)` FastAPI dependency | `backend/app/core/deps.py:67` |
| Fine ownership gate | `assert_teacher_owns_class_subject`, `assert_teacher_owns_section` — deny with **404, not 403** | `backend/app/core/rbac.py` |
| Module shape | `models.py` + `schemas.py` + `service.py` + `router.py`. **Routers never touch the DB.** | `backend/app/modules/*` |
| Settings architecture | 3 layers: env (`config.py`), DB singletons + per-year rows, code defaults. **No generic key/value table — do not add one.** | `backend/app/modules/settings/` |
| Notification precedent | a release nudge **is an `audit_log` row**, no new table | `backend/app/modules/assessments/release_nudge.py:19` |
| Archive freeze | `freeze_academic_year` — **must run before** `academic_years.archived_at` is set | `backend/app/modules/reports/freeze.py:19` |
| Migrations | hand-run SQL in numeric order. **Alembic does not work** — its one revision is Postgres-only. | `backend/db/mariadb/` |
| Permission matrix (FE) | `PERMISSION_MATRIX` | `frontend/src/shared/auth/permissions.ts` |
| Navigation | `buildSections(role)` | `frontend/src/app/layout/navConfig.tsx` |
| Shared UI | `DataTable`, `PageContainer`, `PageHeader`, `StatCard`, `FormDialog`, `ProfileParts`, `PrintLayout`, `useScrollToTop` | `frontend/src/shared/components/` |
| Strings | `strings.ts` — a shell-only stub imported by just 6 files | `frontend/src/i18n/strings.ts` |

**Rename hazards.** `Class` collides with `className` (MUI/emotion), CSS classes like `sis-print-hide`,
and `class_subject_id` wire fields. `Grade` collides with `grade_level` (year-group meaning) vs letter
grade. There are **four duplicated role→label maps** — `RoleChip.tsx`, `UserMenu.tsx`, `LoginForm.tsx`,
`UserFormDialog.tsx` — consolidate them **before** sweeping labels.

---

## D. Design

### D1. Terminology — display-only (decision #3)

Consolidate the four role-label maps into one, expand `frontend/src/i18n/strings.ts` into a real term
dictionary (`terms.dean`, `terms.registrar`, `terms.lecturer`, `terms.course`, …), then sweep the
hardcoded labels.

Principal → **Dean** · Secretary → **Registrar** · Teacher → **Lecturer** · Class → **Course** ·
"School Management Information System" → "**Student Management Information System**" (acronym **SIMS**
unchanged; also `frontend/index.html` `<title>` and meta description).

Wire values, routes, table and column names are untouched.

### D2. `courses` becomes the catalog — without orphaning anything (decision #2)

`subjects.id` is already `uuid`, and `courses.id` will be. So:

1. **Reshape `courses`** to the house style: `id uuid PK` (replacing the non-auto-increment
   `courseid int`), plus TimestampMixin / AuditMixin / SoftDelete, `code`, `name`, `credits smallint`,
   `component enum('GEC','SEC','CEC')`, `description`, `is_active`.
   *Changing this PK is necessary (brief §29): the table is empty and every FK that must reach it is `uuid`.*
2. **Copy `subjects` into `courses` preserving each row's UUID.** Every existing
   `class_subjects.subject_id` and `term_grade_snapshots.subject_id` value then already points at a
   valid `courses.id` — nothing is orphaned.
3. **Re-point the FK constraints** on `class_subjects.subject_id` and
   `term_grade_snapshots.subject_id` from `subjects` to `courses`. Retire `subjects` (keep the table,
   stop using it) alongside the other dormant legacy tables.

   > **Refinement made while authoring `005` (2026-08-13): the columns keep the name `subject_id`.**
   > Renaming them to `course_id` would force a rebuild of the STORED generated column
   > `class_subjects.cs_active_subject` (which is derived from `subject_id`) together with its unique
   > index `uq_class_subjects_class_subject`, and would churn the ORM and a large share of the test
   > suite — for a cosmetic gain. Decision #3 (display-label-only rename, preserve technical
   > identifiers) applies here too: only the FK target moves.
4. `courses.coursestatus enum('Audit','Withdraw Passing','Withdraw Failing')` is an **enrolment**
   status sitting on the catalog — move it to `class_enrollments.enrollment_status`.

Result: `assessment_grades → assessments → class_subjects → courses.credits` — the chain that makes
GPA possible. `classes` (the D29 subject class) becomes the **course offering/section**;
`class_enrollments` is already the student↔offering link.

### D3. Two term concepts

- **Calendar term** — the existing `semesters` table. Drop `CHECK (sequence IN (1,2))` and the
  2-per-year unique; add `term_type enum('summer','semester','spring')` and
  **`grade_submission_deadline datetime NULL`**. Replace the hard-coded two-semester creation in
  `POST /settings/academic-years` with a real `POST /settings/semesters` (Dean-only).
- **Curriculum position** — new `program_courses (id, program_id, course_id, term_label,
  term_order smallint, is_required)`. `term_label` = `'Summer 1'` … `'Semester 5'`, `'Spring 1/2'`;
  `term_order` drives display order. Unique `(program_id, course_id)`.

### D4. Prerequisites

New `course_prerequisites (id, course_id, prerequisite_course_id NULL, program_id NULL,
requirement_type enum('course','all_program_courses'))`. A NULL prerequisite with
`all_program_courses` expresses `EDUC3201 ← ALL COURSES`. `courses.prerequisites` text is kept as the
human-readable source, but **validation reads the relation**.

Validation on enrolment must confirm the prerequisite was **successfully completed**, not merely
taken: a passing `term_grade_snapshots` row (or live term grade) **or** an approved credit transfer,
judged against the *programme's* pass mark (§D5). A blocked enrolment returns 409 naming the missing
course(s) and the grade actually earned.

### D5. Grading, quality points, GPA

- `grading_scale_bands` **+= `grade_point decimal(3,2)`**. Seed the official BAJC scale:

  | Letter | Numerical | Grade point |
  |---|---|---|
  | A | 95–100 | 4.00 |
  | A- | 90–94 | 3.75 |
  | B+ | 85–89 | 3.50 |
  | B | 80–84 | 3.00 |
  | C+ | 75–79 | 2.50 |
  | C | 70–74 | 2.00 |
  | D | 65–69 | 1.00 |
  | F | 0–64 | 0.00 |

  *(The contiguity validator at `settings/service.py:576` already tolerates the 1.0 gaps.)*

- `programs` **+= `min_passing_grade_point decimal(3,2) NOT NULL DEFAULT 2.50`** → **Primary Education
  = 2.00 (C)**, all other programmes **2.50 (C+)**. This is the only correct home: the pass mark is
  per-programme, while `grading_scales.pass_mark` is per-academic-year.
- New **pure** functions in `calc.py` (never in a service): `grade_point_for(letter, bands)`,
  `quality_points(grade_point, credits)`, `compute_gpa(entries)`.
- **Quality Points = Grade Point × Course Credits.**
- **GPA = Total Quality Points ÷ Total Credits**, over **all enrolled credits**, ungraded contributing
  0 quality points (decision #4). Exposed identically in the transcript, report card, dashboards and
  academic history — one implementation, no unweighted percentage mean anywhere.
- `term_grade_snapshots` **+= `grade_point`, `credits`, `quality_points`**, frozen at archive time.

### D6. Grade submission deadline (brief §18)

Dean-only `PUT /settings/semesters/{id}` sets `grade_submission_deadline`. Enforced in
`grades/service.py::upsert_grades` — the single grade write path — returning 409
`grade_window_closed`. The Dean bypasses it. The gradebook UI shows a closed-window banner and
disables the save bar.

### D7. Grade revision / second opportunity (brief §20) — **partially supported; building the missing half**

The database **does** already carry the second-attempt *score*: `assessment_grades.makeup_score` plus
the `allow_makeup` policy chain. What is missing is the **request, reason, approval and history**.
Under the authorised additive set (decision #1):

```
grade_revision_requests (
  id, assessment_grade_id FK, requested_by_user_id, reason text,
  original_score, proposed_score,
  status enum('pending','approved','denied'),
  decided_by_user_id, decided_at, decision_note, created_at
)
```

Flow: Lecturer identifies student + assessment → requests with a description/reason and the new result
→ Dean sees it in a queue → **approve** writes `makeup_score` and appends an `audit_log` row; **deny**
records the decision. **The original score is never overwritten** — it is preserved on the request row
and in `audit_log`.

### D8. Notifications (brief §21) — extend, do not duplicate

No generic notifications table. The Dean's queue **is** `GET /grade-revisions?status=pending`, and the
existing bell count (`GET /announcements/unread-count` → `useUnreadCount`) is extended to include
pending revisions. The notification identifies student, course, assessment, lecturer, request date,
reason and current status.

This also fixes real dead UI: `NotificationsBell` is currently rendered with only `count` and no
`items`, so its popover always reads "No new notifications".

### D9. Student ID `YYYYMM###` (brief §10)

New `student_number_sequences (year_month char(6) PK, last_seq int)`. Allocation is
`INSERT … ON DUPLICATE KEY UPDATE last_seq = last_seq + 1` inside the caller's transaction — the row
lock makes concurrent registrations safe. The existing partial-unique index on `student_number` is the
backstop; a collision retries. **Server-side only** — no frontend generation. IDs are issued **on
acceptance**, and the field stays disabled on edit (already true in `StudentFormDialog.tsx`).

### D10. Names and ordering (brief §11)

Adopt the split names from `sims_bk.sql`: replace `student_profiles.full_name` with
`firstname` / `middlename` / `lastname` plus a computed display property. Sort listings **ascending by
`lastname`, then `firstname`** — never by a combined display string. Touches the students
list/search/detail, gradebook rows, report card and transcript.

### D11. Admissions and credit transfer (brief §9, §13)

New `applications` — all of Sections A–G plus the official-use block (`date_accepted`,
`academic_year_id`, `program_id`, `enrolment_status`, `student_code`, `comments`); plus
`application_education` (the repeating institution rows — this is what fixes the
`educational_background` no-`student_id` gap) and `application_documents` (reusing the `documents` type
lookup and the `student_documents` storage pattern).

```
credit_transfer_requests (
  id, application_id, external_institution, external_course_code, external_course_name,
  external_credits, target_course_id FK courses, content_equivalency_pct decimal(5,2),
  cta_document_id, transcript_document_id, outline_document_id,
  status, decided_by, decided_at, note
)
```

Policy enforced: studied and passed at another **recognised tertiary institution**; **≥75% content
equivalency**; equivalent in knowledge and skills; applied for **only at entrance/admission**;
requires CTA + original transcript + course outlines; **assessed and decided by the Dean**.

Full-screen route `/applications/new` — **not a dialog** — as a sectioned workflow mirroring A–G.
Acceptance is the single action that creates `student_profiles` + `users` + the student ID.

### D12. Programme change and academic history (brief §12, §27)

`student_profiles.programid` becomes a proper `uuid` FK to `programs`. New
`student_program_history (id, student_id, program_id, started_at, ended_at, reason)` so a programme
change **never destroys history**.

Everything else is **derived, not duplicated** — from `class_enrollments` + `term_grade_snapshots` +
approved `credit_transfer_requests` + `program_courses`: current programme, current semester, courses
enrolled / completed / failed / passed / transferred, courses required by the new programme, courses
still to complete, credits earned, credits remaining, GPA, prerequisite eligibility.

A programme change re-runs that derivation against the **new** programme's `program_courses` and
reports which completed courses actually carry over. It does **not** assume every previous course is
transferable.

### D13. Reports (brief §22)

Extend `ReportCard` / `ReportCardDocument.tsx` rather than building new. Add: programme **code**, the
`Period` string, `Block`, and per-row `Course Code / Credits / Instructor / letter Grade`, plus the GPA
row and the Dean signature + footer block. One template with a `Mid-Semester` / `End of Semester`
variant on the heading.

### D14. Permissions (brief §3, §6)

**Dean-only** (tightened from the current Principal/Secretary): create, edit and delete **courses**,
**programmes/studies**, **semesters**; grading scale; grade-submission deadlines; grade-revision
decisions; credit-transfer decisions.

**Registrar** keeps students, applications, enrolment, announcements and reports — but none of the
Dean's academic authority.

**Lecturer** keeps assigned courses, assessments and grade entry, and may **request** revisions.

Enforced server-side with `require_role(Role.PRINCIPAL)` and mirrored in `PERMISSION_MATRIX`.

---

## E. Phase checklists

### Phase 0 — Foundation & sign-off — ✅ COMPLETED 2026-08-13

- [x] Create branch `tertiary-refactor` off `phase7-backend-and-fixes` — COMPLETED 2026-08-13
- [x] Write `docs/tertiary-refactor-plan.md` (this document) — COMPLETED 2026-08-13
- [x] Register this document in `docs/progress-tracker.md` (D30 entry) and `docs/project-overview.md`
      (Documentation Map) — COMPLETED 2026-08-13
- [x] Author `backend/db/mariadb/005_tertiary.sql` — full DDL, idempotent, re-runnable, **not executed**
      — COMPLETED 2026-08-13
- [x] **GATE: client approved the DDL (2026-08-13).** It has still not been executed —
      see the Phase 1 blocker.

**What `005_tertiary.sql` contains** — 16 sections, additive only, nothing dropped:

| § | Change |
|---|---|
| 1 | Quarantine the four legacy tertiary tables from `sims_bk.sql` — `courses`, `programs`, `educational_background`, `documents` → `*_legacy_pre_d30`. **Renamed, never dropped**; guarded by `information_schema` so it is a no-op on a repo-provisioned DB. |
| 2 | **`courses`** — the catalog. Closes the grade→credit chain. Copies every `subjects` row in **preserving its UUID**, then re-points the `class_subjects` and `term_grade_snapshots` FKs. |
| 3 | **`programs`** — the 8 studies, with `min_passing_grade_point` (the per-programme pass mark). |
| 4 | **`program_courses`** — the curriculum: programme → `term_label` + `term_order` → course. Free-text label, so Primary Education's Spring 1/2 and Semester 5 fit. |
| 5 | **`course_prerequisites`** — a real relation, with `requirement_type = all_program_courses` for `EDUC3201 ← ALL COURSES`. |
| 6 | **`semesters`** — drops `CHECK (sequence IN (1,2))`, adds `term_type` and `grade_submission_deadline`. Keeps the one-active-term invariant. |
| 7 | **`grading_scale_bands.grade_point`**, plus `grade_point` / `credits` / `quality_points` frozen on `term_grade_snapshots`. |
| 8 | **`class_enrollments.enrollment_status`** — moves `coursestatus` off the catalog, where it never belonged. |
| 9 | **`student_profiles`** — split names (backfilled from `full_name`) + the full application-form column set. `yearofstudy` is split into `year_of_study` and `enrollment_load`; `program_id` becomes a real uuid FK. |
| 10 | **`student_number_sequences`** — concurrency-safe `YYYYMM###` allocation. |
| 11–13 | **`applications`**, **`application_education`**, **`application_documents`** — the admission record and Section B's repeating table. |
| 14 | **`credit_transfer_requests`** — CTA, with the ≥75% floor enforced only on *approval*. |
| 15 | **`student_program_history`** — programme changes without data loss. |
| 16 | **`grade_revision_requests`** — the missing half of the second-opportunity workflow. |

**Not done by `005`, deliberately:** no `DROP TABLE`; `student_profiles.full_name` is kept until the
Phase 1 ORM cut-over (**`007_student_names.sql`** drops it — `005`'s own header says "`006`", written
before `006` was claimed by the catalog cutover); no seeding (Phases 2–3 own that, through the existing
`settings/service.py` and `db/seed.py` lifecycles); no change to course **retakes** — see §G item 5.

### Phase 1 — Terminology, roles, identity — ✅ COMPLETED 2026-08-16

- [x] Apply `005_tertiary.sql` to `sims` — **COMPLETED 2026-08-14, 55/55 statements.**
      Verified afterwards: 11 subjects carried into `courses` with UUIDs preserved, **0**
      orphans across 116 `class_subjects` and 290 `term_grade_snapshots` rows, 11/11 new
      tables, all altered columns present, `ck_semesters_sequence` dropped, 45/45 students
      name-split with no NULL surname.
- [x] Add `backend/db/mariadb/apply_sql.py` — a terminal runner for these files (reads
      `DATABASE_URL` from `.env`, per-statement reporting, `--check` / `--backup`). The
      repo had no non-GUI way to apply a migration because Alembic is dead — COMPLETED 2026-08-14

> **Two corrections made while applying `005`. Both are worth knowing before writing `007`.**
>
> 1. **`ADD CONSTRAINT IF NOT EXISTS … FOREIGN KEY` is a 1064 syntax error in MariaDB.**
>    `IF NOT EXISTS` goes **after `FOREIGN KEY`**: `ADD CONSTRAINT x FOREIGN KEY IF NOT
>    EXISTS (col) REFERENCES …`. It *is* valid after `ADD CONSTRAINT` for a CHECK, which
>    is why the CHECK statements passed and the four FK statements failed.
>    `001_missing_fields.sql:552` already had the correct form.
>
> 2. **The catalog FK swap was mis-sequenced into `005` and has been moved to `006`.**
>    Re-pointing `class_subjects.subject_id` / `term_grade_snapshots.subject_id` at
>    `courses` applied cleanly and then failed **73 tests** with 1452
>    *"a foreign key constraint fails"*. Copying the existing rows into `courses` is only
>    half the job: every write path still creates a subject in `subjects` only, so a
>    newly-created subject had nothing for the FK to resolve against. **Re-pointing the FK
>    without moving the writes puts the database ahead of the application.**
>    `005` now *ensures* both FKs point at `subjects` — which also repairs a database where
>    the earlier version already moved them — and the swap lives in
>    `006_courses_cutover.sql`, to be applied **in the same step** as the Phase 2 ORM
>    change. `courses` is created and populated by `005` and simply sits unused until then.
- [x] Fix `RUNBOOK.md` §4 provisioning order — added the missing `004` **and** `005`
      — COMPLETED 2026-08-13
- [x] Consolidate the duplicated role→label maps into one — new
      `frontend/src/shared/auth/roleLabels.ts` (`ROLE_LABEL`, `roleLabel()`,
      `ROLE_OPTIONS`). **There were FIVE, not four:** the audit missed the role filter in
      `features/settings/screens/UsersScreen.tsx` — COMPLETED 2026-08-13
- [x] Expand `frontend/src/i18n/strings.ts` into a real term dictionary (`terms`, `roles`)
      — COMPLETED 2026-08-13
- [x] Sweep display labels — Principal→Dean, Secretary→Registrar, Teacher→Lecturer,
      Subject→Course, Class→Course offering — COMPLETED 2026-08-13
- [x] Update `frontend/index.html` `<title>` + meta, and the FastAPI `title` in
      `backend/app/main.py`, to "Student Management Information System" — COMPLETED 2026-08-13
- [x] Tighten permissions per D14 — the **course catalog is now Dean-only to write**
      (`subjects/router.py` P/S → `require_role(PRINCIPAL)`), mirrored by a new `courses`
      key in `PERMISSION_MATRIX` and by an `assertDean` gate in the MSW subjects handler
      — COMPLETED 2026-08-13
- [x] Split `student_profiles.full_name` → firstname/middlename/lastname + display property (D10)
      — COMPLETED 2026-08-16. **The column is dropped** (`007_student_names.sql`); the parts are the
      only stored truth. `full_name` survives as a **`hybrid_property`** on `StudentProfile`, which is
      what kept the change cheap: because the property KEPT THE NAME, every serialisation site and the
      whole wire contract (`StudentListItem.full_name`, roster entries, gradebook rows, report card,
      transcript) went on working, and only the write paths and the ordering sites had to change.
      Being a *hybrid* also means `StudentProfile.full_name.ilike(...)` still compiles — to a
      `CONCAT_WS` the database can filter on — so searching a name typed in full still matches.
      Python names are `first_name`/`middle_name`/`last_name`; the DB columns keep the unprefixed
      spelling `005` created them with (decision #3).
- [x] Sort student listings ascending by `lastname`, `firstname` — COMPLETED 2026-08-16.
      One shared `STUDENT_NAME_ORDER` in `students/models.py` replaced nine independent
      `.order_by(StudentProfile.full_name)` calls across reports / grades / dashboard / classes /
      attendance / students. `_STUDENT_SORT_FIELDS` now maps each key to a TUPLE of columns, because
      "sort by name" is two columns and not one; `full_name` and `name` are accepted spellings of the
      same surname-first ordering, so the old display-string order is no longer reachable at all.
- [x] Student ID `YYYYMM###` generation + `student_number_sequences` (D9) — COMPLETED 2026-08-16.
      New `app/modules/students/numbering.py`; `student_number` is now OPTIONAL on
      `POST /students` and omitting it allocates. Server-side only.
- [x] Add `backend/tests/test_student_number.py` incl. concurrent allocation — COMPLETED 2026-08-16,
      11 cases. The concurrency one opens a second real connection with
      `innodb_lock_wait_timeout = 1` and asserts it TIMES OUT while the first transaction holds the
      row: a lock-wait timeout is the pass condition, because it is the proof the second registration
      was made to wait rather than handed the same number. Both sessions roll back, so the suite stays
      hermetic.
- [x] **Interim gate met: 1039 backend tests green** (1037 + 2 new Dean-only guards);
      typecheck clean, lint at its pre-existing 2-warning baseline, build clean
- [x] **GATE: full Phase 1 — MET 2026-08-16.** 1051 backend tests green after the name split and the
      ID generator; typecheck clean, lint at its 2-warning baseline, build clean.

#### Terminology decisions made during the sweep

BAJC has **two** real concepts where the old app had one, so a single "Course" label
would have made the Dean's catalog screen and the offerings list read identically:

| Concept | Schema | UI label |
|---|---|---|
| Catalog entry — code, name, credits, component, prerequisites | `subjects` → `courses` after `005` | **Course** (Settings → *Course Catalog*) |
| A scheduled instance in a term — one lecturer, room, weekly times ("Math-1") | `classes` + `class_subjects` | **Course offering** (staff nav: *Course Offerings*) |
| A student's own enrolled offerings | `class_enrollments` | **My Courses** — a student never sees the word "offering" |

Permission split that follows from it: the **Dean** owns the catalog; the **Registrar**
still schedules offerings and enrols students. That is the narrowest reading of brief §6
that does not strip the Registrar of administrative work the brief explicitly leaves them.

### Phase 2 — Courses, programmes, terms, prerequisites

- [x] Reshape `courses` to UUID PK + mixins + credits/component (D2 step 1) — done by `005`
- [x] Copy `subjects` → `courses` **preserving UUIDs** (D2 step 2) — done by `005`, 11 rows, 0 orphans
- [x] **Apply `006_courses_cutover.sql` TOGETHER WITH the code change below** (D2 step 3) —
      COMPLETED 2026-08-16, 14/14 statements, after the two zero-checks in the file header both
      returned 0. `Subject.__tablename__` is `courses`; the model gained `credits`, `component`,
      `description`, `prerequisites_text` and `AuditMixin`, and `code` became NOT NULL.
      **The class is still called `Subject` and the columns are still `subject_id`** — the same
      reasoning already recorded for `subject_id` in the `006` header: decision #3 renames display
      labels, not technical identifiers, and renaming the class would churn 14 modules for a
      cosmetic gain. `courses.code NOT NULL` was reconciled by making `code` a required request
      field, so a code-less create is a 422 naming the field rather than a 500 from the database.
- [x] Move `coursestatus` off the catalog to `class_enrollments.enrollment_status` (D2 step 4) —
      COMPLETED 2026-08-16. Mapped on `ClassEnrollment` with a new `EnrollmentStatus` enum. It had
      been sitting on the CATALOG in `sims_bk.sql`, where marking one student as auditing would have
      marked every student taking the course.
- [x] N-term `semesters`: drop the `IN (1,2)` check, add `term_type`, add Dean-only `POST /settings/semesters`
      — COMPLETED 2026-08-16. `005` §6 had already dropped `ck_semesters_sequence`; what was still
      capping the calendar was the APPLICATION — `SemesterCreateRequest.sequence` was
      `le=2`, `AcademicYearCreateRequest` demanded exactly two terms with sequences
      `[1, 2]`, and there was no endpoint to add a third. Now: one or more terms, distinct
      sequences, and **the LOWEST sequence is the one activated** (`sequence == 1` was no
      longer a safe stand-in for "the first term" — a year whose terms started at 2 would
      have been created with no active term at all). Added Dean-only
      `POST /settings/semesters` and `PATCH /settings/semesters/{id}`; there is
      deliberately no DELETE, because a term anchors every enrolment, assessment,
      attendance record and frozen snapshot inside it and those FKs are RESTRICT.
      **A term is NOT validated as falling inside its year's dates** — BAJC's Summer block
      legitimately sits outside it, and the sample report card prints exactly that.
- [x] `program_courses` curriculum table + Dean UI (programme → term block → course)
      — COMPLETED 2026-08-16. New `app/modules/programs/` (models, schemas, service, router)
      with 8 endpoints; Dean-only writes per §D14, reads open to every role because a
      programme's plan is published prospectus material and Phase 4's academic history reads
      it. The three curriculum writes return the WHOLE programme, since each changes the
      block's credit total and the programme's total.
      Frontend: Settings → **Programmes** tab plus a nested `/settings/programs/:id`
      curriculum builder. `curriculum_credits` vs the declared `total_credits` is shown as a
      running comparison, because the gap is exactly how a data-entry slip in an 87-credit
      sequence gets noticed.
- [x] `course_prerequisites` relation incl. `all_program_courses` (D4) — COMPLETED 2026-08-16.
      New `app/modules/prerequisites/` slice, mounted on the EXISTING catalog prefix
      (`/subjects/{id}/prerequisites`) rather than a new `/courses` one: the entity already has a
      route, and two spellings for one entity is worse than the single legacy name. Dean-only to
      write. `courses.prerequisites_text` is returned alongside the relation as the PDF source it
      came from — **documentation, never the rule**.
      Added beyond the design: a **cycle guard**. `ck_course_prereq_not_self` catches A→A but not
      A→B→A, and the consequence is not cosmetic — both courses become permanently un-enrollable,
      each 409ing about the other, a deadlock the Registrar meets at registration and the Dean never
      sees. There is no PATCH: a requirement's three fields ARE its identity (`uq_course_prereq` is
      the whole tuple), so editing one is removing it and adding another.
- [x] Prerequisite validation on enrolment — checks **successful completion**; 409 names the missing
      courses — COMPLETED 2026-08-16. Wired into **both** enrolment doors:
      `POST /classes/{id}/enrollments` and `POST /students` with `class_ids` — gating only the first
      would have left the rule enforceable from one and not the other.
      Checked for every student in a batch BEFORE anything is written, because that endpoint takes a
      list and a mid-loop failure would half-enrol it. Blocking, not warn-only: unlike a timetable
      clash (D-Q6), a missing prerequisite is not fixed by the next edit.
- [x] Seed all 8 BAJC programmes and their full course sequences from the PDF — COMPLETED
      2026-08-16. `pypdf` was installed into the session scratchpad (never into
      `backend/.venv` — it is a one-off extraction, not a project dependency) and all 8 pages
      extracted cleanly as text. The transcription is checked in as
      `backend/app/db/bajc_catalog.py` rather than parsed at run time, so the seed is
      reproducible without the PDF and every departure from the source shows in a diff.
      **Verified by arithmetic, not by eye**: every one of the 43 term blocks sums to its
      printed `Total Credits` and every programme to its printed `Total Programme Credits`.
      That check is what CAUGHT the `AGR12110` typo — Applied Agriculture's Semester 3 came
      to 18 against a printed 21 until the malformed code was resolved.
      Loaded by `python -m app.db.seed_bajc` (idempotent, `--dry-run` supported):
      **114 courses, 8 programmes, 243 curriculum rows, 63 prerequisites, 1 `ALL COURSES`
      gate.** A second run reports everything unchanged.
- [x] Rebuild the demo dataset against the BAJC programmes (SQL seed **and** MSW) — COMPLETED
      2026-08-16. The MSW dataset now carries the real catalog wholesale, generated into
      `demo/bajcCatalog.ts` from the SAME parsed source as the Python twin — demo mode and
      the backend cannot disagree about what the college offers. The ten demo classes teach
      real courses, students are registered on real programmes, and `MATH1210 ← MATH1110` is
      a genuine 26/27 rule, so the prerequisite block fires in demo mode on a real
      requirement rather than an invented one.
      **A hazard introduced in 2A was closed here.** `010_seed_demo.sql` had been updated to
      `DELETE FROM courses` when the catalog moved — with FK checks off during that sweep,
      re-seeding the demo would have silently destroyed all 114 BAJC courses and every
      curriculum hanging off them. The demo seed no longer owns or clears the catalog: it
      REFERENCES it by code and fails loudly if `seed_bajc` has not been run.
      `seed_demo.py`'s pre-D29 homeroom shape is untouched and remains the separate,
      pre-existing gap already recorded in §F.
- [x] Add `backend/tests/test_prerequisites.py` — COMPLETED 2026-08-16, 34 cases covering CRUD and
      Dean guards, the satisfied/unsatisfied paths, `ALL COURSES`, the concurrent-enrolment
      exclusion, the per-programme pass mark, the credit-transfer arm, batch atomicity, and the pure
      grade-point helpers.
- [x] **GATE: Dean builds a programme end to end; the prerequisite block fires correctly.**
      **MET 2026-08-16 — 22/22, walked through the HTTP API against the live database**, not
      through the ORM, so what is proved is the shipped behaviour. The walk: the 8 seeded
      programmes read back with curricula whose credits match their declared totals;
      Primary Education returns its eight blocks in plan order with Spring 1 between
      Semester 2 and Semester 3 (and explicitly NOT alphabetical); `EDUC3201` carries the
      `all_program_courses` gate scoped to Primary Education; `AGRI2118` requires both
      `AGRI1108` and `AGRI1109`; the Dean creates a programme, places two courses in two
      blocks and the credits roll up; and enrolling a student into Pre-Calculus without
      Intermediate Algebra is refused with a 409 naming `MATH1110` and saying "Not yet
      taken". The walk cleans up after itself.

> **Phase 2 delivered in four stages (client-approved split), all closed 2026-08-16.** The staging
> existed because the catalog cutover is the one step that breaks every course write if it is
> mis-sequenced — and had already done so once.
>
> **2C's gate was inert school-wide until 2D seeded the sequences**, and deliberately so: a course
> with no prerequisites never reaches the check. It is live now — 63 real prerequisites and the
> Internship's `ALL COURSES` gate.
>
> **One Phase 3 item was pulled forward**, because §D4 depends on it: `calc.grade_point_for` and
> `calc.meets_grade_point`, plus `grade_point` on `BandInput`. §D4 says a prerequisite is judged
> against the PROGRAMME's pass mark, and that mark is a grade point — there is no way to honour the
> rule without them. `quality_points`, `compute_gpa` and the GPA wiring remain Phase 3.
>
> **The two term concepts are now both real, and both named on screen** (§D3):
> Settings → *Academic structure* holds CALENDAR terms (`semesters`, with `term_type`), and
> Settings → *Programmes* holds CURRICULUM positions (`program_courses.term_label`). Keeping them
> apart is what lets Primary Education's plan run Summer 1 · Sem 1 · Sem 2 · **Spring 1** · Sem 3 ·
> Sem 4 · **Spring 2** · Semester 5 without any of those being a dated term.

### Phase 3 — Grading, GPA, deadlines, reports — ✅ COMPLETED 2026-08-17

**No migration.** `005_tertiary.sql` §3/§6/§7 had already created `grade_point`,
`min_passing_grade_point`, `grade_submission_deadline` and the three snapshot columns.
Phase 3 is the application catching up to schema that had been sitting unused — the same
shape as Phases 2B and 2C.

- [x] `grading_scale_bands.grade_point` + seed the BAJC 8-band scale (D5) — COMPLETED
      2026-08-17. **The scale now has ONE definition**,
      `app/modules/settings/grading_defaults.py`, imported by both `db/seed.py` and
      `POST /settings/academic-years`; it had been written out twice and kept in step by
      hand. Ceilings are the integers BAJC prints (A- is 90-94), not the old `.99`
      dressing — safe because `letter_for` is half-open on `min_score` and the contiguity
      validator tolerates the 1.0 steps.
      **Client decision: D and F are BOTH non-passing and `pass_mark` moved 60 → 70.**
      D is priced 1.00, below every programme's `min_passing_grade_point`, so leaving it
      "passing" would have made `calc.is_passing` and `calc.meets_grade_point` disagree
      about the same result. C (2.00) is now the lowest pass in the system and the numeric
      threshold says so too.
      Existing rows are re-banded by `python -m app.db.seed_grading_scale` (idempotent,
      `--dry-run`): 1 scale re-banded, **2 skipped because frozen**. Archived years keep
      the 5-band scale that was in force then — schema §10.4, not an omission.
      `GradingBand` gained `grade_point` on the WRITE side too, or the Dean's editor would
      have posted the seeded bands back stripped of their points and silently un-seeded
      the scale.
- [x] `programs.min_passing_grade_point` — Primary Education 2.00, all others 2.50 —
      **ALREADY CORRECT from the 2D seed**, verified against the live database
      2026-08-17. This box needed verification, not work.
- [x] `calc.py`: `grade_point_for`, `quality_points`, `compute_gpa` — pure, no service
      logic — COMPLETED 2026-08-17. `grade_point_for` was pulled forward by 2C; Phase 3
      added `GpaEntry`, `GpaResult`, `quality_points` and `compute_gpa`, still with no
      Session, no ORM and no I/O.
- [x] Wire GPA into transcript, report card, dashboards and academic history — one
      implementation — COMPLETED 2026-08-17. `credits` now travels on
      `reports/service._SubjectResult`, the single supplier of per-subject figures to the
      report card, transcript, class-grades report and the archival freeze; `_gpa_entries`
      is the only assembly step and `calc.compute_gpa` the only arithmetic. `_bands` in
      **reports and dashboard** were building `BandInput` WITHOUT `grade_point` — only
      `grades/service` passed it — so the GPA would have been weightless on exactly the
      two surfaces that print it. Academic history is Phase 4 §D12 and calls the same
      function.
- [x] `term_grade_snapshots` += grade_point / credits / quality_points, frozen at archive
      — COMPLETED 2026-08-17. Mapped on `TermGradeSnapshot` and written by
      `reports/freeze.py` from the band in force AT FREEZE TIME. Frozen mode reads credits
      back from the snapshot, so re-crediting a course from 3 to 9 cannot move a report
      card already issued. An unpriced scale freezes NULL, never 0.00 — 0.00 is an F.
- [x] `semesters.grade_submission_deadline` + enforcement in `upsert_grades` (409
      `grade_window_closed`), Dean bypass — COMPLETED 2026-08-17. Set through the
      Dean-only `POST`/`PATCH /settings/semesters` built in 2B.
      **`grade_submission_deadline` is the one PATCH field where omitted and `null`
      differ**: `null` reopens a closed window, so the service reads `model_fields_set`
      rather than checking for None — otherwise renaming a term would silently reopen it.
      **The Dean bypass is coded but dormant, by decision.** The route is
      `require_role(TEACHER)` and `assert_teacher_owns_class_subject` would 404 a Dean
      anyway, so no Dean can enter a grade at all today; the intended post-deadline path
      is Phase 5's grade-revision workflow (§D7), where the Dean approves rather than
      types. Tested at the service level so the rule cannot rot before then.
- [x] Gradebook UI: closed-window banner, disabled save bar — COMPLETED 2026-08-17.
      `Gradebook` gained `grade_window_closed` + `grade_submission_deadline`, reported to
      EVERY viewer (a Registrar asked why the lecturer cannot save needs the same answer)
      and kept SEPARATE from `can_edit`, which still means "your role and ownership permit
      writing here" — otherwise a shut deadline is indistinguishable from a read-only view.
- [x] Report layout (D13) — programme code, Period, Block, Course
      Code/Credits/Instructor/letter, GPA row, Dean footer — COMPLETED 2026-08-17.
      `ReportCardDocument` was rebuilt from `Subject | Score | Letter | Teacher` to BAJC's
      `Course Code | Course Name | Credits | Instructor | Grade`, with the labelled header
      block, a spacer row, the GPA row and the Dean signature/contact footer. The grade
      column is the LETTER ONLY, blank when ungraded — and ungraded courses are still
      LISTED, because they are what makes the GPA denominator right.
      `program_code` is wired but prints blank: every `student_profiles.program_id` is NULL
      and assigning programmes needs `student_program_history` (Phase 4 §D12). `block` is
      always blank — its meaning is unconfirmed (§G item 3) and the sample prints `-`.
      The Dean's signature IMAGE is deliberately NOT reproduced: there is no asset for it
      and generating one would be forging a signature onto an official document.
- [x] Add `backend/tests/test_gpa_calc.py` (pure, no DB) and `test_grade_deadline.py` —
      COMPLETED 2026-08-17. **30 + 24 cases**, plus 6 report-card GPA tests, 3 freeze
      tests, 2 grading-scale round-trip tests and 1 transcript regression. Suite 1147 →
      **1213**.
- [x] **GATE: GPA reproduces the sample report's 2.1. — MET 2026-08-17, 39/39 walked
      through the HTTP API against the live database**, not through the ORM, so what is
      proved is shipped behaviour. The walk: the 8 BAJC bands read back priced with
      `pass_mark` 70 and D/F non-passing; the Dean adds a term with no deadline; a student
      on five 3-credit courses with three graded to B, A-, A- gets **GPA 2.10 over 15
      credits**, the two ungraded courses listed with a blank grade and the `Period` label
      correct; the transcript agrees at term, year and cumulative level; a past deadline
      refuses the Lecturer's save with **409 `grade_window_closed`** naming the date,
      writes nothing, and shows closed on the gradebook read; clearing it lets the same
      save through; renaming the term does NOT reopen it; the GPA then moves to 2.60 on
      the new C+; and the Registrar and Lecturer are both 403 on the deadline. It creates
      its own term (sequence 90) rather than touching the live active one, and cleans up
      after itself.
      **The walk found a defect the suite had missed** — see the change log.

### Phase 4 — Admissions, credit transfer, programme change — ✅ COMPLETED 2026-08-17

**No migration.** `005_tertiary.sql` §11–§16 had already created `applications`,
`application_education`, `application_documents`, `credit_transfer_requests` and
`student_program_history`, and §9 had already made `student_profiles.program_id` a real
uuid FK. Every table was verified present and empty in `sims` before a line was written —
the third phase running to that shape.

#### Decisions taken with the client

| # | Decision |
|---|---|
| 1 | **Registrar accepts; programme CHANGE is Dean-only.** Filing, editing, submitting, accepting and denying an application are Registrar + Dean — admission is administration, and §D14 leaves the Registrar students, applications and enrolment. Moving a student BETWEEN programmes re-derives their degree plan and rules on what carries over, which is academic authority. Credit-transfer decisions stay Dean-only either way (brief §13). |
| 2 | **Documents are a CHECKLIST, no file bytes.** Object storage is not provisioned (TODO(OQ-DB5), the same reason the school-logo upload is still a stub), and Section F on the paper form IS a tick-list. `application_documents.received` is the load-bearing column; real uploads are additive later. |
| 3 | **`/applications/new` is a SEVEN-STEP WIZARD**, one step per Section A–G, each step saving before it advances. |

- [x] `applications` + `application_education` + `application_documents` (D11) — COMPLETED
      2026-08-17. New `app/modules/admissions/` (models, schemas, service, router) with **13
      endpoints** across two routers: `/applications/*` and `/credit-transfers/*`. The second
      exists because the Dean works a transfer QUEUE across applications and should not need
      to know which application a request came from to rule on it — the same pattern as
      `assessment_grades_router`.
      `applications` is deliberately WIDE rather than normalised per section: the sections are
      one document filled in one sitting, and splitting them would mean six joins to render
      one form. The two genuinely repeating parts are their own tables.
      **`application_education` fixes a real defect** (§B4): the source dump had a
      single-valued `student_profiles.educationbg_id` against a table with no student
      reference at all, so an applicant who attended two institutions could not be recorded
      either way round.
- [x] Full-screen `/applications/new` sectioned workflow (Sections A–G) — **a seven-step
      wizard** (client decision 3) — COMPLETED 2026-08-17. **Step A files a `draft` from the
      applicant's NAMES ALONE** — the only fields the server requires — and every later step
      PATCHes it, so a closed tab loses at most the step in progress. The URL becomes
      `/applications/{id}/edit` via `replace`, so Back cannot land on an empty form and file a
      second draft. Sections B and F save through their own whole-set `PUT` endpoints because
      they are repeating tables, not fields.
- [x] Acceptance flow → creates `student_profiles` + `users` + issues the student ID —
      COMPLETED 2026-08-17. **ONE transaction** (decision #5): allocate the `YYYYMM###`
      inside it so a failure burns no number, create the login with
      `must_change_password` and return a generated temporary password ONCE, build the student
      **FROM Sections A–E** — never from fields on the accept request, so an accept cannot
      quietly disagree with the form — open the first `student_program_history` row, and fill
      in the official-use block. **Order is load-bearing**: the user precedes the student
      (`student_profiles.user_id`), the student precedes `applications.student_id`. The pair is
      circular in the schema and only one transaction makes it safe.
- [x] `credit_transfer_requests` + CTA rules (≥75% equivalency, admission-only, Dean decides)
      — COMPLETED 2026-08-17. Every clause of brief §13 has a home and a test:
      **≥75% equivalency** refused as a 422 that names the rule and the value, with
      `ck_cta_approval_requires_75` as the database's own backstop (asserted by going round
      the API); a **recognised TERTIARY institution** required on Section B, checkable from the
      form and the exact thing the policy exists to prevent; **admission only** — 409 once the
      application is decided; **the Dean decides** — 403 for the Registrar.
      Beyond the design: **a PENDING transfer BLOCKS acceptance.** The transfers decide which
      courses the student arrives holding, so accepting first would enrol them against a plan
      the Dean has not finished ruling on — and policy makes afterwards too late to ask.
- [x] `student_profiles.programid` → proper uuid FK; add `student_program_history` — **the FK
      was already done by `005` §9**; verified 2026-08-17. `StudentProgramHistory` is now
      mapped, and **the database allows only ONE OPEN row per student**: `open_flag` is a
      STORED generated column `IF(ended_at IS NULL, 1, NULL)` under
      `uq_student_program_open (student_id, open_flag)`. So the service closes the outgoing row
      BEFORE opening the new one — the reverse order trips the index, and there is a test that
      bypasses the API to prove the index is real.
- [x] Derived academic history — COMPLETED 2026-08-17. `GET /students/{id}/academic-history`
      in the new `app/modules/students/academics.py`. **Nothing is stored**: every figure is
      recomputed from `class_enrollments` + `term_grade_snapshots` + approved
      `credit_transfer_requests` + `program_courses` on each read, so a corrected grade shows
      at once rather than leaving a cached total to drift. Reuses
      `grades_service.completed_course_results` (2C) and `calc.compute_gpa` (3) — no grade math
      is reimplemented (plan §C).
      Every course lands in exactly one bucket: `transferred`, `completed`, `failed`,
      `in_progress`, `remaining`. **`completed` is judged against the PROGRAMME's pass mark**
      (§D5), so the same letter can be a pass on one programme and a fail on another — there is
      a test that turns on exactly that. **A transferred course is EXCLUDED from the GPA**:
      a transfer grants credit, not a grade point, and scoring it 0 would punish the student
      for transferring while 4.00 would invent a grade nobody at BAJC awarded.
- [x] Programme change re-derives against the new programme; history preserved — COMPLETED
      2026-08-17. Dean-only `PUT /students/{id}/program`, the single writer of
      `student_profiles.program_id` outside acceptance and therefore the single place that
      keeps the history in step with it. The outgoing row closes the day BEFORE the new one
      opens, so the periods are contiguous with neither overlap nor gap. Moving to the SAME
      programme is 409, not a silent no-op: a Dean who meant to change something wants to know
      they did not, and another row for the same programme would read as a change that never
      happened.
      **A change does NOT assume everything carries over** (§D12): work the new award does not
      require keeps its grade and stops counting toward it, which the screen shows as "outside
      the curriculum" rather than hiding.
- [x] Add `backend/tests/test_credit_transfer.py` and `test_program_change.py` — COMPLETED
      2026-08-17, plus `test_admissions.py`. **53 + 38 + 34 = 125 new cases.** Suite 1213 →
      **1338**. The Phase 2C credit-transfer reader in `prerequisites/service.py` was
      re-pointed from raw SQL at the now-mapped model, and its 34 tests still pass unchanged.
- [x] **GATE: file → transfer → accept → change programme, with history intact. — MET
      2026-08-17, 62/62 walked through the HTTP API against the live database.** The walk:
      the Registrar files a draft from names alone and it appears in the Drafts filter while a
      Lecturer is 403 on the whole module; three per-section PATCHes each leave the others
      intact; Section B holds two institutions with `sort_order` renumbered server-side;
      submit passes with nothing outstanding; a transfer is filed against a real seeded course
      and **blocks acceptance** while pending; the Registrar is 403 on deciding it and the Dean
      is refused at 74% before being accepted at 90%; acceptance issues `202608003`, returns a
      one-time password, reports the transferred course, links both FK directions and opens the
      programme history on day one; a second accept and a post-acceptance transfer are both
      refused; the academic history derives ITEC's 90 required credits and reports the transfer
      as credit-without-a-grade-point; the Registrar and the Lecturer are both 403 on the
      programme change while the Dean's succeeds, leaving TWO history rows and exactly ONE
      open; and the derivation re-runs against BMAD's 87. It cleans up after itself.
      **The walk corrected two of its own assumptions** — see the change log.

### Phase 5 — Grade revision, notifications, final report — ✅ COMPLETED 2026-08-18

**No migration.** `005_tertiary.sql` §16 had already created `grade_revision_requests`,
with a generated `pending_flag` under `uq_grade_revision_open` and two CHECKs. Verified
present and empty in `sims` first — the fourth phase in a row to run that way.

#### Decisions taken with the client

| # | Decision |
|---|---|
| 1 | **A makeup on a GRADED row is an approved revision and wins.** `score` keeps what the student first earned; `makeup_score` holds the revised mark; `calc._contribution_for` prefers the makeup on a graded row. Safe because `upsert_grades` REFUSES a makeup on a graded result (422 `makeup_not_allowed`), so nothing else can put one there. Honours §D7's "never overwritten" exactly, rather than overwriting `score` and keeping the original only on the request row. |
| 2 | **Approval writes through a CLOSED grade window.** The deadline stops Lecturers editing freely; a revision is the sanctioned exception and the Dean is the one approving it. Blocking it after the cutoff would kill the workflow exactly when it is needed. This is the post-deadline path Phase 3 recorded its dormant Dean bypass as pointing at. |
| 3 | **The closing report is written from the plan's own audit**, not from the brief's §28 wording — the brief was pasted into a chat on 2026-08-13 and is not a file in the repo. §I says so explicitly so it can be corrected. |

- [x] `grade_revision_requests` table (D7) — **already existed** (`005` §16); mapped as
      `GradeRevisionRequest` in `grades/models.py` 2026-08-18, with a new
      `GradeRevisionStatus` enum. `pending_flag` is left UNMAPPED on purpose: it is a STORED
      generated column, and an ORM that thought it could write one produces a MariaDB 3105
      on every insert.
- [x] Lecturer request flow (reason + proposed result) — COMPLETED 2026-08-18.
      `POST /assessments/{id}/grade-revisions`, assessment-first and student-identified
      exactly as brief §20 describes the flow. **Requesting writes no grade**, which is why
      it is allowed after the submission deadline while `upsert_grades` is not.
      Guards: the Lecturer must OWN the offering (404, not 403 — no existence leak); the
      student must already HAVE a `graded` result (an absent one already has a makeup path,
      and giving one situation two mechanisms that write the same column would be a bug
      waiting to happen); the mark must be within `max_score` and must DIFFER from the
      current one; and only ONE pending request per grade.
      A Lecturer may withdraw their own pending request. The **Dean may not file one** — a
      self-approved revision would leave the audit trail with no independent authority in it.
- [x] Dean review queue — approve writes `makeup_score` + `audit_log`; deny records the
      decision — COMPLETED 2026-08-18. `GET /grade-revisions?status=pending` IS the queue
      (§D8 — a filtered read, not a new table), oldest first.
      **`id` is a tiebreaker on that ORDER BY, and it is not decoration**: `created_at` is a
      MariaDB `DATETIME` with precision 0, so two requests filed in the same second are
      indistinguishable by it and ordering on it alone lets rows shuffle between reads —
      which matters for a queue somebody pages through and decides from. Found by the tests,
      pinned by `test_the_order_is_STABLE_within_one_second`.
      A decided request cannot be re-decided; a fresh request is the supported way to change
      course, and the unique index permits it because the first row is no longer pending.
- [x] Original score never overwritten — verified by test — COMPLETED 2026-08-18.
      **THREE independent records of the pair** — the grade row (`score` + `makeup_score`),
      `grade_revision_requests` (`original_score` + `proposed_score`) and `audit_log` — and a
      test that reconciles all three, plus one proving `score` still holds the FIRST mark
      after a SECOND approved revision.
- [x] Extend the bell count with pending revisions; fix the dead `NotificationsBell`
      popover (D8) — COMPLETED 2026-08-18.
      `GET /announcements/unread-count` gained `unread_announcements` and
      `pending_grade_revisions`, with `unread_count` as the **SUM** — so every existing
      client kept working and simply started counting revisions too. The revision component
      is what awaits the CALLER's decision, so it is non-zero only for the Dean: a badge
      counting a Lecturer's own pending request would nag them about work only the Dean can
      do. They still see their own requests and outcomes in the queue.
      **The popover is fixed.** `NotificationsBell` was rendered with only `count` and no
      `items`, so it always read "No new notifications" however high the badge went. New
      `app/layout/useNotifications.ts` composes the list from unread announcements plus
      pending revisions and wires `onSelect` to the right screen.
- [x] Add `backend/tests/test_grade_revision.py` — COMPLETED 2026-08-18, **50 cases**, plus
      6 added to `test_grade_calc.py` for the graded-row makeup arm. Suite 1338 → **1394**.
- [x] Write the final brief-§28 A–F audit report — COMPLETED 2026-08-18 as **§I** of this
      document rather than §G (§G is the open-items list and is referenced from it).
      **Written from the plan's own audit, not the brief's §28 wording** — see the note at
      the head of §I.
- [x] **GATE: request → notify → approve/deny → audit trail complete. — MET 2026-08-18,
      42/42 walked through the HTTP API against the live database.** The walk: the Dean, the
      Registrar and a non-owning Lecturer are each refused a request in the right way; a
      same-mark and an over-max request are refused; the owning Lecturer files one and it
      touches NO grade; the Dean's bell count includes it and is the sum of its parts while
      the Lecturer's does not; the queue is scoped so another Lecturer cannot see it and the
      Registrar gets 403; **the deadline is then shut** and the Lecturer's direct save is
      refused 409 while the workflow keeps working; the Dean denies (touching no grade),
      cannot re-decide, and a fresh request is accepted; the Dean **approves through the
      closed window**, `score` still reads 60, `makeup_score` reads 91, the term grade moves
      to 91 and the badge falls back; and all three audit actions are present with the
      original-and-revised pair reconciling against the grade row. It restores the live
      term's deadline and cleans up after itself.

---

## F. Verification

Run per phase. From `backend\` — the `.env` load path is **relative**, so starting anywhere else
silently points at the wrong database:

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe -m pytest -q                       # full suite, ~56s, must stay green
.\.venv\Scripts\python.exe -m pytest -m "not requires_db" -q  # DB-free subset
```

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\frontend
npm run typecheck; npm run lint; npm run build
```

New test modules: `test_prerequisites.py` ✅, `test_student_number.py` ✅ (including
concurrent allocation), `test_programs.py` ✅, **`test_gpa_calc.py` ✅** (pure, no DB —
mirrors `test_grade_calc.py`; run it with `DATABASE_URL` unset to prove the GPA functions
have no I/O), **`test_grade_deadline.py` ✅**, **`test_admissions.py` ✅**,
**`test_credit_transfer.py` ✅**, **`test_program_change.py` ✅**. Still to come:
`test_grade_revision.py` (Phase 5).

**Reference data is applied by seed scripts, not migrations** — after provisioning, run
both:

```powershell
cd C:\Users\arhernandez\source\repos\school-management-system\backend
.\.venv\Scripts\python.exe -m app.db.seed_bajc            # 114 courses, 8 programmes
.\.venv\Scripts\python.exe -m app.db.seed_grading_scale   # the BAJC 8-band scale
```

Both are idempotent and support `--dry-run`. `seed_grading_scale` SKIPS frozen scales, so
an archived year keeps the bands that were in force when it ran.

**End-to-end**, both modes (RUNBOOK §1–2): `npm run demo` (MSW, no backend or DB) and `npm run dev`
plus uvicorn against `sims`. Manual walk: Dean builds a programme → adds courses to terms → sets
prerequisites → an application is filed and accepted → student enrols (prerequisite block fires) →
Lecturer grades → deadline closes → report card renders with the correct GPA.

⚠️ **Do not run `npm run generate:api`** — `frontend/openapi.json` is stale (covers 4 of 14 modules).

**Pre-existing issues inherited from the repo — not caused by this work:**

- Demo-mode grades deliberately differ from backend grades (`selectors.ts::computeTermGrade` is a flat
  mean that ignores category weights and drop-lowest). Documented in RUNBOOK §1. Not a bug.
- `RUNBOOK.md` §4 omits `004_subject_class_model.sql` from the provisioning order.
- The SQL demo seed (`010_seed_demo.sql`, `seed_demo.py`) is pre-D29 — 16 homerooms, no `year_group`,
  no `class_meetings`. Only the frontend MSW dataset was rebuilt for D29.
- `docs/database-schema.md` and `docs/architecture.md` still describe PostgreSQL.
- **`docs/api-specification.md` does not cover any D30 module** — not `programs` (2B), not
  `prerequisites` (2C), not `admissions` or the programme/academic-history endpoints (4). It was
  never extended when those modules landed, so this plan's §E is the record of the D30 API
  surface. Not introduced by Phase 4; noted because a reader looking for the endpoints there
  will not find them.
- `docs/database-schema.md:1035`'s "Cumulative / GPA fields (deliberately not stored)" note
  is **superseded by Phase 3** — see §B3.
- `docs/roles-access-and-flows.md` is stale (pre-D29 homeroom model).
- `docs/security-review.md` is still a stub.

---

## G. Open items to confirm with BAJC

Do not block on these; they are flagged in the final report.

1. **`THEO1110` is used for two different courses** on the Religion sequence — "Life & Teaching of
   Jesus" (GEC, 3 cr) and "Science & Religion" (CEC, 3 cr). A genuine data conflict; one code must
   change. **Seeded 2026-08-16 with the GEC course keeping `THEO1110`** (it appears in all eight
   programmes) and Science & Religion under the deliberately provisional **`THEO1110-B`**, chosen so
   it cannot be mistaken for a real BAJC code. **BAJC must assign a real one** — it will print on a
   report card as it stands.
2. **Source typos — ✅ corrected and seeded 2026-08-16**, every one listed in
   `backend/app/db/bajc_catalog.py`: `AGR12110` → `AGRI2110` (three letters and five digits where
   every other code is four and four; the block total is the proof — Semester 3 summed to 18 against
   a printed 21 without it), `ITEC 2118` → `ITEC2118` (stray space), `Pinciples of Accounting 1` →
   `Principles of Accounting 1` (misspelled on two of the three pages it appears on; the Religion
   page has it right), `Life & Teachings of Jesus` → `Life & Teaching of Jesus` (seven of eight
   pages use the singular).
3. **"Block"** on the report header — meaning unknown; the sample prints `-`. **Surfaced
   as a real but always-empty field** by Phase 3 (`ReportCard.block`), so BAJC's answer
   becomes a one-line change rather than a schema and contract change. An empty labelled
   field is honest; guessing what a block is would not be.
4. **Mid-term vs final report** — only one layout was supplied. Confirm whether they differ
   beyond the heading. Phase 3 built **one template with a heading variant**
   (`ReportCardDocument`'s `variant` prop: `Mid-Semester` / `End of Semester`), which is
   the narrowest thing that can be true of both. Note the source PDF's filename says "mid
   semester" while the document inside is titled "End of Semester Report".
5. **Retakes** — a repeated course cannot currently be represented (`uq_enroll_active` has no
   attempt column). Outside the brief's scope, but prerequisite and GPA logic will eventually
   need it. **Now concrete after Phase 3:** a retake must decide whether the GPA counts both
   attempts' credits or replaces the first, and BAJC has to say which. Today the question
   cannot even be asked of the data — a second enrolment in the same course is refused.
6. **Demo data — ✅ rebuilt against the BAJC programmes 2026-08-16** (MSW carries the real 114-course
   catalog and all 8 programmes; the SQL seed now references the catalog instead of inventing one).
   Its pre-D29 homeroom shape is a separate, pre-existing gap recorded in §F.
8. **`component` is a PER-PROGRAMME fact, and the schema stores it per COURSE.** Found while seeding:
   **9 of the 114 courses carry different components in different programmes.** `MATH1110` is SEC in
   five programmes and CEC in Mathematics; `MGMT1106` is CEC, SEC and GEC depending on the plan;
   `EDUC1104` is all three. That is what the word means — a course's role WITHIN a programme — so
   `courses.component` (§D2) is the wrong home for it. It currently holds the MAJORITY value, and the
   minority is wrong on screen for those 9 courses. **The natural fix is additive**:
   `program_courses.component`, falling back to the course when unset. Raised rather than taken,
   because it is a design change and not a seeding decision. Every divergence is listed in
   `COMPONENT_DIVERGENCES` in `backend/app/db/bajc_catalog.py`.
9. **Four Mathematics courses carry a `*` footnote whose legend is not on the page** — `MATH1103`,
   `MATH1208`, `MATH2214`, `MATH2216`. They are seeded as ordinary required courses, because guessing
   that the marker means "elective" or "not offered every year" would be inventing a rule.
10. **`EDUC1214` requires `EDUC1210`, and both sit in Primary Education Semester 2.** A prerequisite
    cannot be met in the same term as the course it gates (§D4, and there is a test for it), so as the
    sequence is written that course is un-enrollable in its own block. Either the requirement or the
    placement needs to move.
7. **Go-live blocker inherited from the repo** — 19 live accounts share the password `SimsDemo2025!`
   with `must_change_password = false`.
11. **Admission documents are a CHECKLIST, with no file upload** (Phase 4, client decision).
    `application_documents` carries `received` plus optional file metadata, and Section F on the
    paper form is a tick-list, so nothing is lost today. But **credit transfer policy requires a
    CTA, an original transcript and course outlines**, and the Dean currently rules on a request
    while looking at three ticks rather than three documents. Closing it means provisioning
    object storage — the same TODO(OQ-DB5) that still stubs the school-logo upload — and is an
    additive change: the columns are already there. **Confirm with BAJC whether ruling on ticks
    is acceptable for go-live**, or whether the Dean must see the papers in the system.
12. **What should happen to a student's enrolments when their programme changes?** (Phase 4.)
    Today: nothing. The change re-derives what counts toward the new award and leaves every
    existing `class_enrollments` row alone, which is right — a student mid-term is still sitting
    those courses, and silently un-enrolling them would destroy attendance and grades. But it
    means a student can be part-way through courses their new programme does not require, and
    nobody is prompted about it. The academic-history screen shows them as "outside the
    curriculum"; **confirm whether the Registrar should also be prompted to adjust the current
    term's enrolments.**
13. **A denied credit transfer can be re-filed for the same course, and an approved one cannot
    be revoked** (Phase 4). Both are deliberate — a re-application with better evidence must be
    possible, and a Dean's ruling is a record rather than a toggle. The gap is the middle case:
    an approval made on a transcript that later turns out to be wrong has no undo. **Confirm
    whether BAJC needs a reversal path**, which would be a new decision row rather than an edit
    to the existing one (the same shape as §D7's revision workflow).

---

## H. Change log

Newest first.

### 2026-08-18 — Phase 5: grade revision, notifications; **PHASE 5 COMPLETE — D30 DONE**

**Gate met: 42/42, walked through the HTTP API against the live database.** Suite 1338 →
**1394 green**, typecheck clean, lint at its 2-warning baseline, `vite build` clean.

**No migration — the fourth phase running.** `005_tertiary.sql` §16 had already created
`grade_revision_requests` with its generated `pending_flag`, its unique index and both
CHECKs. Verified present and empty in `sims` before a line was written.

#### The one thing §D7 could not have worked without

§D7 says approval writes `makeup_score` and never overwrites the original. But
`calc._contribution_for` only ever consulted `makeup_score` on an **ABSENT** row — so for a
normally-graded student, writing it would have changed *nothing*. The workflow would have
recorded decisions and moved no grades: theatre.

The client chose the fix that keeps §D7's wording true: **a makeup on a GRADED row is an
approved revision and wins.** That is safe for a specific, checkable reason —
`upsert_grades` refuses a makeup on a graded result outright (422 `makeup_not_allowed`), so
nothing in the system except an approved revision can produce that state. `score` keeps what
the student first earned, which is where any reader looks for it.

`allow_makeup` is deliberately **not** consulted on the new arm. That policy governs second
SITTINGS for an absence; a Dean's approved revision is an authority decision, and a category
that happens to disable makeups must not silently discard it. Six cases in
`test_grade_calc.py` pin the arm, including a revision DOWNWARD (a transcription error
corrected is the same workflow, and the engine must not quietly keep the higher of the two)
and a revision to **zero** (a truthiness test there would drop a real mark).

The full suite stayed green through that change, which is itself the evidence that no
fixture anywhere had ever put a makeup on a graded row.

#### Requesting and deciding are deliberately different hands

  * **The Lecturer requests**, on an offering they own — 404 rather than 403 for one they do
    not, the same existence-leak discipline as the gradebook.
  * **The Dean decides**, and *cannot request*. A self-approved revision would leave the
    audit trail with no independent authority in it, which is the one thing this table exists
    to provide.
  * The Registrar does neither: §D14 gives them no grade authority.

A revision needs a recorded **graded** result. An absent one already has a first-class second
attempt through `makeup_score` + `allow_makeup`, and routing it through an approval workflow
as well would give one situation two mechanisms writing the same column.

#### Requesting after the deadline; approving through it

Phase 3 shipped `grade_submission_deadline` with the Dean's direct-entry bypass dormant, on
the recorded note that Phase 5 would be the real post-deadline path. It is:

  * **Requesting is allowed after the cutoff** — it writes no grade, and asking the Dean to
    look at something is exactly what should still be possible once the window shuts.
  * **Approval writes THROUGH a closed window** (client decision). The deadline stops
    Lecturers editing freely; a revision is the sanctioned exception and the Dean is the one
    approving it. Blocking it after the cutoff would kill the workflow precisely when
    revisions surface. The gate walk shuts the window, watches the direct save take a 409,
    and then watches the approval land anyway.

#### The original is recorded three times, and they reconcile

`assessment_grades` (`score` + `makeup_score`), `grade_revision_requests` (`original_score` +
`proposed_score`) and `audit_log` (both, plus `applied_to`). Any two reconcile, and the audit
entry alone answers "what did this student originally get?" years later without the grade
row. There is a test for the three-way reconciliation, and another proving `score` still
holds the FIRST mark after a SECOND approved revision — the intermediate value is not lost,
it is on the first request row and in the trail.

#### A defect the tests found: the queue could shuffle

`created_at` is a MariaDB `DATETIME` with **precision 0**. Two requests filed in the same
second are indistinguishable by it, so `ORDER BY created_at` alone let queue rows reorder
between reads — which matters a great deal for a list somebody pages through and clicks
Approve on: the row they meant to hit moves. Fixed with `id` as a tiebreaker; the uuid is not
chronological, so the order within a second is arbitrary, but it is **stable**, which is the
property that matters. Pinned by `test_the_order_is_STABLE_within_one_second`, and the two
tests that first exposed it now stamp distinct timestamps so they test ordering rather than
the tiebreaker.

#### Notifications: extended, and a dead popover fixed

`GET /announcements/unread-count` now returns `unread_announcements` and
`pending_grade_revisions` with `unread_count` as their **SUM** — so no existing client
changed, and the badge simply started counting revisions too. §D8 rules out a notifications
table, and none was added: the count reaches the revision queue through
`grades.revisions.pending_for_actor` rather than reimplementing the rule.

The revision component is scoped to **what awaits the caller's decision**, so it is non-zero
only for the Dean. A badge counting a Lecturer's own pending request would nag them about
work only the Dean can do; they still see their requests and their outcomes in the queue.

**And the popover was genuinely dead.** `NotificationsBell` was rendered with `count` and no
`items`, so it always read "No new notifications" however high the badge went — the plan
flagged it as a real defect, not a missing feature. New `app/layout/useNotifications.ts`
composes the list from unread announcements plus pending revisions, puts revisions first
(they are the only entry somebody is waiting on), and navigates to the right screen on
click. A student and a Registrar never issue the revision query at all, because the endpoint
answers 403 for them.

#### Frontend

The Lecturer requests from the per-assessment grading screen — a per-row action that stays
available when the save bar is locked, which is the whole point. `/grades/revisions` is the
queue, mounted under Grades rather than as its own nav module because a revision is a grade
decision and both roles arrive at it from the gradebook. One screen, two audiences: the Dean
gets approve/deny, the Lecturer gets withdraw, and the server decides which by scoping the
query rather than the UI hiding rows.

MSW mirrors all four endpoints plus the extended count, including every refusal, the
one-pending rule, `score` being left alone on approval, and approval working while the window
is closed. One pending request is seeded — found by searching the dataset for a graded,
released result on the demo Lecturer's own offering, so the seed cannot become invalid as the
data changes.

### 2026-08-17 — Phase 4: admissions, credit transfer, programme change; **PHASE 4 COMPLETE**

**Gate met: 62/62, walked through the HTTP API against the live database.** Suite 1338 green
(1213 + 125), typecheck clean, lint at its 2-warning baseline, `vite build` clean with
`feature-admissions` as its own lazy chunk.

**No migration — the third phase running.** `005_tertiary.sql` §11–§16 had already created
`applications`, `application_education`, `application_documents`,
`credit_transfer_requests` and `student_program_history`, and §9 had already made
`student_profiles.program_id` a real uuid FK. Every table and every column the ORM now maps
was reconciled against `information_schema` BEFORE any code was written; the only two
columns the DB has that the ORM does not are the generated ones (`open_flag`,
`is_active_number`), left unmapped on purpose because an ORM that thought it could write a
generated column produces a MariaDB 3105 on every insert.

#### Three decisions taken with the client

1. **Registrar accepts; programme CHANGE is Dean-only.** Filing, editing, submitting,
   accepting and denying an application are Registrar + Dean — §D14 leaves the Registrar
   students, applications and enrolment, and admission is administration. Moving a student
   BETWEEN programmes re-derives their degree plan and rules on which completed courses
   carry over, which is academic authority. Credit-transfer decisions are Dean-only either
   way (brief §13).
2. **Documents are a CHECKLIST, not files.** Object storage is not provisioned
   (TODO(OQ-DB5) — the same reason `POST /settings/school/logo` validates and then stubs the
   byte write), and Section F on the paper form IS a tick-list. `received` is the
   load-bearing column; `file_name` / `content_type` / `size_bytes` are metadata for when
   uploads land. Adding bytes later is additive; pretending they exist would not be.
3. **The A–G form is a seven-step WIZARD**, not one long page.

#### The applicant entity, and why it had to exist

The audit (§B4) found there was none: the paper form's "FOR OFFICIAL USE ONLY" block —
date accepted, academic year, programme, enrolment status, student code — had nowhere to
live, and `student_profiles.status` was being asked to double as an admission status when
it is a student LIFECYCLE enum. An applicant is not a student, and decision #5 makes
acceptance the single action that turns one into the other.

- `applications` is deliberately WIDE rather than normalised per section: A–G is one
  document filled in one sitting, and splitting it would mean six joins to render one form
  and six inserts to save it. The two genuinely repeating parts are their own tables.
- **`application_education` fixes a real defect.** `sims_bk.sql` carried
  `student_profiles.educationbg_id`, SINGLE-valued, pointing at an `educational_background`
  table with no student reference at all — an applicant who attended two institutions could
  not be recorded either way round. There is a test named for exactly that.
- Almost every column is nullable, and that is what a `draft` MEANS rather than laxity.
  Completeness is asserted at the SUBMIT and ACCEPT transitions, where it is knowable and
  where refusing is useful — and a refusal lists EVERY missing thing at once, so the
  Registrar does not submit six times to discover six omissions.

#### The wizard is interruption-safe, and that shaped the API

Step A files a `draft` from the applicant's NAMES ALONE — the only fields the server
requires to create one — and every later step PATCHes it. A closed tab, a flat battery or a
phone call loses at most the step in progress, and the half-finished form is waiting in the
Drafts filter.

- **The PATCH applies only the keys PRESENT**, via `model_fields_set`. A body carrying
  Section C must not blank Sections A, B and D, and `null` still has to work for clearing a
  mis-typed field. There is a test that fills Section A, patches Section E, and asserts
  Section A survived — the regression that matters most in this phase.
- **The URL changes after step A**: `/applications/new` becomes `/applications/{id}/edit`
  via `replace`, so Back cannot land on an empty form and file a SECOND draft.
- Sections B and F save through their own whole-set `PUT`s, because they are repeating
  tables rather than fields. `sort_order` is renumbered server-side so the client never has
  to keep it consistent while inserting and removing rows.
- **The under-18 guardian-signature rule lives in the service, and could not live anywhere
  else.** "A guardian must sign IF the applicant is under 18" is a statement about their AGE
  AT SIGNING; no column constraint can express it, and the form makes it conditional rather
  than always-required.

#### Acceptance is one transaction (decision #5)

Allocate the `YYYYMM###` INSIDE it, so a failure rolls the sequence back and burns no
number; create the login with `must_change_password` and return a generated temporary
password ONCE; build the student **FROM Sections A–E**, never from fields on the accept
request, so an accept cannot quietly disagree with the form it came from; open the first
`student_program_history` row so the programme has a history from day one rather than from
the first change; fill in the official-use block.

**Order is load-bearing.** The user is inserted before the student
(`student_profiles.user_id` references it) and the student before
`applications.student_id`. The pair is circular in the schema and only a single transaction
makes it safe — there is a test that takes a duplicate-email 409 on the LAST step and
asserts no student, no burnt number and no half-decided application are left behind.

#### Credit transfer — the policy IS the feature

Every clause of brief §13 has a home and a test:

- **≥75% content equivalency** — a 422 that names the rule AND the value, so the Dean gets a
  sentence instead of a driver error. `ck_cta_approval_requires_75` stays the backstop, and
  there is a test that goes round the API entirely to prove the CHECK is real: the rule has
  to be true of the data even if a future writer forgets.
- **A recognised TERTIARY institution** — checked against Section B's rows. Passing
  high-school study off as transfer credit is the exact thing the policy exists to prevent,
  and it is checkable from the form.
- **Admission only** — 409 once the application is decided. By then there is a student and
  the moment to ask has passed.
- **The Dean decides** — 403 for the Registrar, who files what the applicant claims.

Two things were added beyond the design:

- **A pending transfer BLOCKS acceptance.** The transfers decide which courses the student
  arrives already holding, so accepting first would enrol them against a plan the Dean has
  not finished ruling on — and policy makes afterwards too late to ask.
- **Section F cannot silently strip a transfer of its papers.** The three document FKs are
  `ON DELETE SET NULL`, so the checklist replace reconciles BY ID and answers 409
  `document_in_use` rather than quietly detaching a CTA the Registrar thinks they removed.

The 2C reader in `prerequisites/service.py` was re-pointed from raw SQL at the now-mapped
model, and its status comparison is against the enum rather than the string `'approved'` —
which makes a renamed member a type error instead of a query that silently matches nothing.
All 34 of its tests still pass unchanged, and the arm that returned nothing for the whole
school now returns real rows.

#### Programme change never destroys history

`student_program_history` keeps every registration, and **the database allows only ONE OPEN
row per student**: `open_flag` is a STORED generated column `IF(ended_at IS NULL, 1, NULL)`
under `uq_student_program_open (student_id, open_flag)`, and NULLs do not collide in a
unique index. So the service closes the outgoing row BEFORE opening the new one — the
reverse order trips the index, and there is a test that bypasses the API to prove that.

- The outgoing row closes the day BEFORE the new one opens, so the periods are contiguous
  with neither an overlap nor a gap. `ck_student_program_dates` permits
  `ended_at == started_at`, which is what a same-day correction produces.
- Moving to the SAME programme is **409, not a silent no-op**: a Dean who meant to change
  something wants to know they did not, and another row for the same programme would read as
  a change that never happened.

#### Academic history is derived, never stored

`GET /students/{id}/academic-history`, in a new `students/academics.py` kept out of the
students CRUD service for the same reason `numbering.py` is. Every figure is recomputed
from `class_enrollments` + `term_grade_snapshots` + approved `credit_transfer_requests` +
`program_courses` on each read; a stored copy would be a second source of truth that starts
drifting the first time a grade is corrected. It reuses
`grades_service.completed_course_results` (2C) and `calc.compute_gpa` (3) — no grade math is
reimplemented (plan §C).

- **`completed` is judged against the PROGRAMME's pass mark** (§D5), so the same letter can
  be a pass on one programme and a fail on another. That is the sharpest test in the suite:
  a C is `failed` at C+ and `completed` at C, and the only thing that changed is which
  programme the student is on.
- **A transferred course is EXCLUDED from the GPA.** A transfer grants credit, not a grade
  point: scoring it 0 would punish the student for transferring and 4.00 would invent a
  grade nobody at BAJC awarded. It counts toward the award and not toward the GPA, which is
  also standard practice.
- **`remaining` needs a course with no OFFERING to be reachable at all**, because a student
  enrolled in a section is sitting every course it offers. That was the author's own wrong
  expectation, caught by the first test run and now pinned as
  `test_enrolment_is_what_separates_in_progress_from_remaining`.

#### The gate walk corrected two of its own assumptions

Both are worth recording, because both looked like passing tests.

1. **`ITEC1104` is in all EIGHT BAJC programmes.** The walk first used it to prove that a
   course stops counting after a programme change — which it never could, because that
   course legitimately carries over. Re-pointed at `ITEC1208`, which a query confirms
   belongs to Information Technology alone.
2. **"credits_remaining changed" passed by arithmetic accident.** ITEC needs 90 with 3
   transferred (87 owed) and BMAD needs 87 with the transfer no longer counting — the two
   remainders coincide at 87. The real rule is that the transfer is **not revoked, it stops
   counting toward THIS award**, so the assertion is now that remaining equals the new
   programme's FULL requirement while the credits the student holds are unchanged. Pinned as
   `test_a_transfer_is_not_revoked_by_a_programme_change`.

#### Demo-mode parity

All 13 admissions endpoints plus the two students ones are mirrored in MSW, including the
completeness rules sentence for sentence, the under-18 condition, the presence-not-None-ness
PATCH semantics, the ≥75% floor, the tertiary-institution requirement, the admission-only
409, the Dean-only 403 and the one-time temporary password. Four applications are seeded so
every state a screen has to render is reachable without touching anything: a half-typed
draft, a submitted-and-acceptable one, an under-review one blocked by a pending transfer,
and an accepted one linked to a demo student. Every demo student's programme history opens
on their enrolment date, the same thing acceptance does.

`Math.random()` is never used in the new handlers — the dataset is deterministic by design,
so ids come from counters and the student number from `DEMO_TODAY` plus a sequence.

### 2026-08-17 — Phase 3: grading scale, GPA, deadlines, BAJC report layout; **PHASE 3 COMPLETE**

**Gate met: 39/39, walked through the HTTP API against the live database.** Suite
1147 → **1213 green**, typecheck clean, lint at its 2-warning baseline, `vite build`
clean.

**No migration.** `005_tertiary.sql` had already added `grading_scale_bands.grade_point`
(§7), `programs.min_passing_grade_point` (§3), `semesters.grade_submission_deadline` (§6)
and `term_grade_snapshots.grade_point / credits / quality_points` (§7). Every one of them
was verified present in `sims` before a line was written. Phase 3 is the application
catching up to schema that had been sitting unused — the third time this refactor has had
that shape, and the reason the plan's phases keep landing without DDL surprises.

**One checkbox was already done.** `programs.min_passing_grade_point` was correct from the
2D seed — 2.00 for Primary Education, 2.50 for the other seven. It needed verification,
not work, and saying so is more useful than re-deriving it.

#### Three decisions taken with the client

1. **D and F are both non-passing; `pass_mark` moved 60 → 70.** D is priced 1.00, which
   fails every programme's `min_passing_grade_point` (2.00 for Primary Education, 2.50
   elsewhere). Leaving `is_passing` true on D while the programme rule rejected it would
   have made `calc.is_passing` and `calc.meets_grade_point` give opposite answers about
   the same result. C (2.00) is now the lowest pass in the system and the numeric
   threshold agrees.
2. **The Dean's deadline bypass is coded but dormant.** `PUT /assessments/{id}/grades` is
   `require_role(TEACHER)` and `assert_teacher_owns_class_subject` would 404 a Dean
   regardless, so no Dean can enter a grade today — the "bypass" §D6 asks for had nowhere
   to run. It is written where the rule lives rather than left in a comment, and tested at
   the service level; the real post-deadline path is Phase 5's revision workflow (§D7),
   where the Dean APPROVES rather than types.
3. **The report card's programme code is wired but prints blank.** All 45 students have
   `program_id = NULL`; assigning a programme needs `student_program_history` so a change
   never destroys history, and that is Phase 4 §D12. The label fills itself in the moment
   Phase 4 lands, rather than the printed document quietly lacking a field.

#### The grading scale now has ONE definition

`app/modules/settings/grading_defaults.py` holds the bands and the pass mark; `db/seed.py`
and `POST /settings/academic-years` both import it. They had each carried their own copy,
kept in step by hand — the same duplication this project has already paid for twice
between demo mode and the backend.

- **Ceilings are the integers BAJC prints** (A 95-100, A- 90-94, … F 0-64), not the old
  `.99` dressing. Safe because `letter_for` is half-open on `min_score` and never consults
  `max_score` (OQ-DB2), and because the contiguity validator flags a gap only above 1.0.
- **`GradingBand` gained `grade_point` on the WRITE side, not just the read.** The PUT
  replaces the whole band set, so a form that displayed the points without round-tripping
  them would have silently un-seeded the scale on the Dean's first unrelated edit —
  sending `calc.meets_grade_point` back to its lenient fallback school-wide. Omitted stays
  NULL rather than becoming 0.00, because NULL means "this scale cannot price this letter"
  and 0.00 is an F.
- `python -m app.db.seed_grading_scale` (idempotent, `--dry-run`) re-bands existing rows:
  **1 scale re-banded, 2 SKIPPED because frozen.** The skip is the point — an archived
  year keeps the rules that were in force when it ran (schema §10.4), so 2024-2025 and
  2025-2026 keep their 5-band scale and their NULL grade points, and a prerequisite judged
  on one of their results still travels `meets_grade_point`'s lenient arm by design.

#### GPA — one implementation, and a wiring gap that would have made it weightless

`calc.py` gained `GpaEntry`, `GpaResult`, `quality_points` and `compute_gpa`, still pure:
no Session, no ORM, no I/O. **GPA = total quality points ÷ ALL enrolled credits**
(decision #4), `ROUND_HALF_UP` to 2dp.

- `credits` now travels on `reports/service._SubjectResult` — the single supplier of
  per-subject figures to the report card, the transcript, the class-grades report AND the
  archival freeze. `_gpa_entries` is the only assembly step; the arithmetic is never
  reimplemented in a service (plan §C).
- **`_bands` in reports and dashboard were building `BandInput` WITHOUT `grade_point`.**
  Only `grades/service._bands_for_section` passed it (2C added it there for the
  prerequisite gate). Left alone, the GPA would have been weightless on exactly the two
  surfaces that print it, with every letter pricing to None — a bug that produces a
  plausible 0.00 rather than an error.
- `test_gpa_calc.py` asserts the gate case AND the wrong answer: five 3-credit courses
  with three graded prints **2.10**, and the 3.50 a graded-only denominator gives is
  pinned as the figure it must not be. It is not a rounding detail; it is the rule.

#### Frozen GPA inputs

`TermGradeSnapshot` maps `grade_point`, `credits` and `quality_points`, written by
`reports/freeze.py` from the band in force AT FREEZE TIME. Frozen mode reads credits back
from the snapshot, so re-crediting a course from 3 to 9 after archival cannot move a
report card already issued — there is a test that does exactly that. An unpriced scale
freezes NULL, never a guessed 0.00, because that would record an F the student never
earned and would be indistinguishable from a real one forever.

#### The grade-submission deadline

Enforced in `upsert_grades` — the single grade write path — as
`_assert_grade_window_open`, returning 409 `grade_window_closed` with the deadline in the
body. A Lecturer an hour late and one a month late are different conversations, and a bare
"window closed" cannot tell them apart.

- **`ensure_aware` is load-bearing.** A MariaDB `DATETIME` comes back timezone-NAIVE
  through pymysql, and comparing it with `utcnow()` raises `TypeError` — a 500 on the save
  path rather than a clean 409. There is a test that stores a naive value explicitly.
- **Inbound datetimes are normalised to UTC** (`settings/service._to_utc`). A Dean in
  Belize sends `...T17:00:00-06:00`; SQLAlchemy drops the offset on the way into a
  `DATETIME`, which would have stored 17:00 as though it were UTC and moved the real cutoff
  six hours earlier. Asserted behaviourally rather than by inspecting stored bytes.
- **`grade_submission_deadline` is the ONE PATCH field where omitted and `null` differ.**
  Every other field treats None as "leave alone", but reopening a closed window is a real
  Dean action and it is spelled `null`. The service reads `model_fields_set`; without that,
  renaming a term would have silently reopened it, with no audit trail and no intent.
  There is a test named for exactly that.
- `Gradebook` gained `grade_window_closed` and `grade_submission_deadline`, reported to
  EVERY viewer rather than only writers, and kept **separate from `can_edit`**. Folding
  them together would make a shut deadline indistinguishable from a Registrar's read-only
  view, and the Lecturer needs to know which one they are looking at to know whom to ask.

#### The BAJC report layout (§D13)

`ReportCardDocument` was rebuilt from `Subject | Score | Letter | Teacher` to
`Course Code | Course Name | Credits | Instructor | Grade`, over the sample's labelled
header block (Student ID · Name · Program · Semester · Period · Block), closing on a
spacer row, the GPA row and the Dean signature block.

- **The grade column is the letter only, blank when ungraded — and the ungraded courses
  are still LISTED.** They are what makes the GPA denominator right, so hiding them would
  print a figure nobody could check by adding up the rows.
- `GradeLetter` **stripped modifiers**: its exact-match switch sent every new `A-`, `B+`
  and `C+` to the grey `neutral` default, so a 92 and a 71 would have printed the same
  chip. D stays `warning` and F `error` even though both now fail, because they are
  different conversations and §7.10 makes the letter the authoritative signal.
- **The Dean's signature IMAGE is not reproduced.** There is no asset for it in the repo
  and generating one would be forging a signature onto an official document; the signature
  LINE is printed so the Dean signs the sheet. The two email/website literals come from
  the source document and are flagged in code for when `school_profile` gains office
  contacts.
- The transcript gained GPA at term, year and cumulative level, each **recomputed from its
  own credits** rather than averaged from the level below — averaging would weight a
  6-credit summer block the same as an 18-credit semester.

#### The gate walk found a defect this suite had missed

The report card read 2.10 and the term's own transcript figure read 2.10, but the
**cumulative GPA came back 1.05 over 30 credits**. Two pre-existing behaviours combined:
the transcript keeps the CURRENT term even with no graded rows, and `_classes_for` falls
back to the student's whole enrolment history for a term they hold no enrolment in. So an
unmarked in-progress term handed over the student's full course load at 0 quality points
and halved the figure.

The fix: a term contributes credits to the year and cumulative GPA only once at least one
of its courses has resolved to a grade. That is not a softening of decision #4 — inside a
term that has started being marked, every enrolled credit still counts and the ungraded
ones still earn nothing. It excludes only the term where nothing is marked yet, and it has
to: otherwise registering for next term would halve a student's cumulative GPA before a
single mark existed. The report card keeps 0.00 for a fully unmarked term, where the
row-by-row breakdown is on the page; a cumulative GPA cannot be checked against the page,
which is why an unexplainable denominator there is a defect rather than a curiosity.

Pinned as `test_an_unmarked_term_does_not_dilute_the_cumulative_gpa`, and **verified to
fail without the fix** (`assert 1.0 == 2.0`) rather than merely passing with it. Its setup
had to be rebuilt once: the first version put the graded term in the current slot and so
proved nothing.

#### Demo-mode parity

This project has twice paid for demo mode certifying a screen the real backend answered
differently, so all of it is mirrored:

- `demo/data.ts` carries the BAJC 8 bands with grade points and `pass_mark` 70; the
  ARCHIVED year deliberately keeps the pre-D30 5-band scale with NULL points, which is the
  state that exercises `meets_grade_point`'s fallback exactly as the real database does.
- **`letterFor` was half-open-ified.** It matched `min <= v && v <= max`, and with the
  BAJC scale's integer ceilings every fractional value between bands — a 94.5, an 89.7 —
  matched NO band and rendered blank where a letter belongs. It now mirrors
  `calc.letter_for`.
- New `gpaFor` / `gradePointFor` mirror `calc.compute_gpa` / `calc.grade_point_for`,
  including the all-enrolled-credits denominator; the reports, dashboard, settings and
  grades handlers all round-trip the new fields, and the grades handler mirrors both the
  409 and the closed-window flag.
- The active demo term carries a deadline in the FUTURE relative to `DEMO_TODAY`. That is
  deliberate: it makes the feature visible without turning the marquee gradebook read-only
  for the whole demo. Moving it behind `DEMO_TODAY` from Settings → Academic structure
  shows the banner and the disabled save bar, which is a better demo than a permanently
  locked one.

**Generated models were hand-edited again** (`gradingBand`, `semesterUpdateRequest`,
`standaloneSemesterCreateRequest`), each with a header saying so — `npm run generate:api`
remains forbidden while `openapi.json` covers 4 of 14 modules.

**Four contract-shape tests moved**, and only four: `test_reports.py`'s report-card and
transcript key sets, its year/semester nesting, and `test_dashboard.py`'s student stats
keys. `conftest.make_grading_scale` keeps a PRIVATE copy of the old 5-band scale rather
than importing the shipped default — importing it would have re-lettered the arithmetic in
every letter assertion across the Grades, Reports and Dashboard suites, which are tests
about weighting and release filtering and have nothing to say about BAJC's boundaries. The
shipped default is asserted where it belongs, in `test_settings.py`.

### 2026-08-16 — Phase 2D: the real BAJC catalog seeded; **PHASE 2 COMPLETE**

**Gate met: 22/22, walked through the HTTP API against the live database.** Suite 1147 green,
typecheck clean, lint at its 2-warning baseline, `vite build` clean.

**Extraction.** `pypdf` installed into the session scratchpad with `pip install --target` —
never into `backend/.venv`, because this is a one-off extraction and not a project
dependency. All 8 pages came out as clean text; no rendering was needed after all.

**The transcription is CHECKED IN, not parsed at run time** (`backend/app/db/bajc_catalog.py`),
so the seed is reproducible without the PDF and every departure from the source is visible in
a diff. Its docstring is the single record of the corrections; the TypeScript twin points at
it rather than repeating them.

**Verified by arithmetic rather than by eye.** Every one of the 43 term blocks is summed
against its printed `Total Credits`, and every programme against its printed `Total Programme
Credits`. That is what CAUGHT the `AGR12110` typo: Applied Agriculture's Semester 3 came to 18
against a printed 21, because the regex refused a code with three letters and five digits
where every other code has four and four. A transcription that does not reconcile is a
transcription that is wrong, and this one now does.

**Corrections applied, all flagged for BAJC (§G):**
- `AGR12110` → `AGRI2110`; `ITEC 2118` → `ITEC2118`; `Pinciples of Accounting 1` →
  `Principles of Accounting 1`; `Life & Teachings of Jesus` → `Life & Teaching of Jesus`.
- **`THEO1110` names two different courses** — Life & Teaching of Jesus (GEC, all eight
  programmes) and Science & Religion (CEC, Religion only). `courses.code` is unique, so the
  GEC course keeps the code and Science & Religion is seeded under the deliberately
  provisional **`THEO1110-B`** — chosen so nobody mistakes it for a real BAJC code. It will
  print on a report card as it stands; BAJC must assign a real one.

**Three findings that were not in the brief**, all raised in §G rather than silently handled:
- **`component` is a per-PROGRAMME fact and the schema stores it per COURSE.** 9 of the 114
  courses carry different components in different programmes — `MATH1110` is SEC in five
  programmes and CEC in Mathematics; `MGMT1106` is CEC, SEC and GEC depending on the plan.
  That is what the word means. `courses.component` holds the majority value and the minority
  is wrong on screen for those 9. The natural fix is additive — `program_courses.component`
  falling back to the course — but that is a design change, not a seeding decision, so it is
  raised. Every divergence is listed in `COMPONENT_DIVERGENCES`.
- **Four Mathematics courses carry a `*` whose legend is not on the page.** Seeded as ordinary
  required courses: guessing the marker means "elective" would be inventing a rule.
- **`EDUC1214` requires `EDUC1210` and both sit in Primary Education Semester 2.** §D4 forbids
  meeting a prerequisite in the same term as the course it gates, so as written that course is
  un-enrollable in its own block.

**The seed.** `python -m app.db.seed_bajc`, idempotent by NATURAL KEY (courses by code,
programmes by code, curriculum by programme+course) with `--dry-run`. **114 courses, 8
programmes, 243 curriculum rows, 63 prerequisites, 1 `ALL COURSES` gate.** A second run
reports every row unchanged. It deliberately leaves alone the 11 carried-over demo courses
that are not in the sequences — they have live offerings and grades behind them — and reports
them rather than deleting them.

**A hazard introduced in 2A, closed here.** When the catalog moved to `courses`,
`010_seed_demo.sql`'s clear-sweep was updated with it — to `DELETE FROM courses`, with FK
checks off. Re-seeding the demo would therefore have silently destroyed all 114 BAJC courses
and every programme curriculum hanging off them. **The demo seed no longer owns or clears the
catalog**: `courses` is out of its table list entirely, and it resolves course ids by code from
what `seed_bajc` loaded, failing loudly with the command to run if they are absent. Reference
data and demo data now have one owner each.

**Demo rebuild (§G item 6, closed).** `demo/bajcCatalog.ts` is generated from the SAME parsed
source as the Python twin, so demo mode and the backend cannot disagree about what the college
offers — the failure mode this project has already paid for twice. The MSW dataset carries all
114 courses and 8 programmes with their full curricula; the ten demo classes teach real courses
and students are registered on real programmes, Primary Education among them so the
per-programme pass mark is exercised rather than merely stored. `MATH1210 ← MATH1110` is a
genuine 26/27 rule, so the demo's prerequisite block fires on a real requirement.
`seed_demo.py`'s pre-D29 homeroom shape is untouched — a separate, pre-existing gap (§F).

**One test-fixture defect the seed exposed.** `test_prerequisites.py` built its fixtures with
literal BAJC codes (`EDUC3201`, `BIOL1204L`, …) which now really exist, so six tests failed on
`uq_courses_code`. The fixtures take a `like=` parameter now: the real code stays visible as
the case a test is about, and a unique suffix is always appended. A test that depends on seeded
reference data is not hermetic anyway.

**The gate walk** ran through the HTTP API as the Dean rather than through the ORM, so what is
proved is shipped behaviour: the 8 programmes read back with curricula matching their declared
credits; Primary Education returns its eight blocks in plan order with Spring 1 between
Semester 2 and Semester 3 and explicitly not alphabetical; `EDUC3201` carries the
`all_program_courses` gate; `AGRI2118` requires both `AGRI1108` and `AGRI1109`; the Dean builds
a programme end to end; and enrolling a student into Pre-Calculus without Intermediate Algebra
is refused with a 409 naming `MATH1110`. It cleans up after itself.

### 2026-08-16 — Phase 2C: prerequisites and the enrolment gate

**Suite: 1147 green** (1113 + 34 `test_prerequisites.py`), with **no existing test changed** —
the gate is inert where no prerequisites exist, which is the whole school until 2D seeds them.
Typecheck clean, lint at its 2-warning baseline, `vite build` clean. **No migration** — `005` §5
created `course_prerequisites` back in August; this is the application catching up again.

**The relation (§D4).** New `app/modules/prerequisites/` slice: model, schemas, service, router.
Mounted on the EXISTING catalog prefix `/subjects/{id}/prerequisites` rather than a new `/courses`
one — the entity already has a route, and giving one entity two spellings would be worse than the
single legacy name decision #3 preserves anyway. Dean-only to write (§D14); reads open, because a
course's prerequisites are prospectus material a student needs when choosing what to take next.

- `courses.prerequisites_text` is returned alongside the relation and labelled as the PDF source it
  came from. **It is documentation; the gate reads the relation**, and there is a test asserting that
  text alone gates nothing.
- **A cycle guard was added beyond the design.** `ck_course_prereq_not_self` catches A→A. It cannot
  catch A→B→A, and that is not a cosmetic gap: a cycle makes both courses permanently un-enrollable,
  each 409ing about the other — a deadlock a Registrar discovers at registration and the Dean who
  created it never sees. A BFS over the existing graph refuses it at creation time.
- **No PATCH.** A requirement's three fields ARE its identity (`uq_course_prereq` is the whole
  tuple), so "editing" one is removing it and adding another; doing that silently would hide the
  change from anyone reading the requirement.

**The gate.** A prerequisite is satisfied only by SUCCESSFUL COMPLETION, and every clause of that is
enforced and tested:

- **Not by prior enrolment.** Sat-and-failed is a 409 that says so, naming the grade earned.
- **Not by concurrent enrolment.** The term being enrolled INTO is excluded from the student's
  results, so a course cannot satisfy its own prerequisite by being taken alongside it. Without that
  a Registrar could enrol a student into MATH1 and MATH2 in one term and the gate would wave it
  through.
- **Judged against the PROGRAMME's pass mark** (§D5) — Primary Education at C (2.00), everything
  else at C+ (2.50). Two students with the same grade get different answers, and there is a test that
  turns on exactly that.
- **An approved credit transfer counts** (brief §13), reached student → `student_profiles`
  `.application_id` → `applications` → `credit_transfer_requests`, because by policy a transfer is
  anchored on the APPLICATION: it can only be requested at admission, when no student exists yet.
  Written with raw SQL rather than a model — `credit_transfer_requests` is Phase 4's to own (§D11)
  and mapping it here would fix its shape before that module is designed. It returns nothing for the
  whole school today, which is precisely why it is written and tested now rather than remembered
  later. A PENDING transfer does not count.

**Wired into BOTH enrolment doors** — `POST /classes/{id}/enrollments` and `POST /students` with
`class_ids`. The second enrols without ever touching the first, so gating only there would have left
the rule enforceable from one door and not the other. Checked for every student in a batch BEFORE
anything is written: that endpoint takes a list, and a mid-loop failure would commit the students
before the blocked one and reject the ones after, leaving a half-enrolled batch nobody can see.
Blocking rather than warn-only — unlike a timetable clash (D-Q6), a missing prerequisite is not
fixed by the next edit.

**The 409 names the missing courses AND the grade actually earned.** A bare "prerequisite not met"
leaves the Registrar unable to tell a student who is one course short from one who sat it and failed,
which are different conversations.

**`ALL COURSES` (`EDUC3201`).** Expands at check time to every REQUIRED course in the programme —
electives a student legitimately did not choose are not missing requirements — so the gate keeps
meaning "everything the programme requires" as the curriculum changes. A fixed list of course ids
could never do that. It applies only to students on the programme, and the gated course excludes
itself.

**Grade points, pulled forward from Phase 3.** §D4 judges against a grade-point pass mark, so
`calc.grade_point_for` and `calc.meets_grade_point` had to exist; `BandInput` gained an optional
`grade_point`. `grading_scale_bands.grade_point` is **NULL on all 15 bands** in the database — Phase
3 seeds the BAJC 8-band scale — so `meets_grade_point` has two arms: compare grade points when they
are known, fall back to the band's `is_passing` when they are not. The fallback is deliberately
lenient; treating unknown as a failure would block every prerequisite-gated enrolment in the school
on data nobody has entered yet. It tightens automatically the moment Phase 3 lands, and one test
seeds the points to prove the real arm works. `quality_points`, `compute_gpa` and the GPA wiring stay
in Phase 3.

**`completed_course_results` lives in the GRADES module, not here** (plan §C: never duplicate grade
logic into a service). It merges frozen `term_grade_snapshots` with live computation — live is not
optional, because snapshots only exist after a year is archived, so without it every prerequisite in
the school would be unsatisfiable until July. Frozen wins over live for the same course; between two
live results the higher numeric wins, as a transcript reads a repeated course. Bands are resolved per
offering, so a later scale edit cannot silently change whether an old result satisfied a
prerequisite.

**Frontend.** A Prerequisites dialog on the course catalog, reachable read-only by the Registrar —
knowing why an enrolment was refused is administration, not academic authority. Demo mode mirrors the
gate in `POST /classes/{id}/enrollments`, including the all-or-nothing batch behaviour, and seeds two
prerequisites (one plain, one `all_program_courses`) so the block is demonstrable rather than
theoretical. That parity is not decoration: this project has already paid twice for demo mode
certifying a screen the real backend answered differently.

### 2026-08-16 — Phase 2B: programmes, curriculum, N calendar terms

**Suite: 1113 green** (1057 → +38 `test_programs.py` → +18 N-term semester cases).
Typecheck clean, lint at its 2-warning baseline, `vite build` clean. **No migration** —
`005_tertiary.sql` had already created `programs`, `program_courses` and the `semesters`
changes; this stage is the application catching up to schema that had been sitting unused.

**N calendar terms per year (§D3).**
- The schema cap was gone since `005` §6, but **the application was still the cap**:
  `SemesterCreateRequest.sequence` was `le=2`, `AcademicYearCreateRequest` demanded exactly
  two terms with sequences `[1, 2]`, and there was no endpoint to add a third. All three are
  now lifted — one or more terms, distinct sequences, `term_type` on each.
- **The LOWEST sequence is the term activated**, not `sequence == 1`. With N terms the old
  rule was no longer a safe stand-in for "the first one": a year whose terms started at 2
  would have been created with no active term at all.
- New Dean-only `POST /settings/semesters` and `PATCH /settings/semesters/{id}`. There is
  deliberately **no DELETE** — a term anchors every enrolment, assessment, attendance record
  and frozen snapshot inside it, and those FKs are RESTRICT; correcting a term is the
  supported operation, removing one is a data-migration decision.
- **A term is NOT validated as falling inside its academic year's dates, on purpose.**
  BAJC's Summer block legitimately sits outside it — the sample report card prints
  `Summer, July 2026 - August 2026` for a year that begins in August. Rejecting that would
  reject the institution's own calendar. There is a test asserting it is allowed, so the
  "missing" validation cannot be added later as a well-meaning fix.
- `PATCH` validates against the **merged** dates: moving only `start_date` past the stored
  `end_date` is caught as a 422 naming the field, rather than reaching
  `ck_semesters_dates` at the driver as a 500.

**Programmes and the curriculum (§D3).**
- New `app/modules/programs/` — `Program` and `ProgramCourse` models, schemas, service,
  router; 8 endpoints. Registered in `main.py`.
- **Dean-only to write** (§D14, brief §6); reads open to every authenticated role, which is
  wider than `courses` — a programme's plan is published prospectus material and Phase 4's
  student academic-history screens read it. Every write path is tested against Registrar,
  Lecturer and student, because the catalog's own Dean-only gate was originally missed on
  one of its four endpoints.
- **`term_label` is a curriculum POSITION, never a calendar term.** The blocks come back
  ordered by an explicit `term_order`, and there is a test built on the fact that "Spring 1"
  sorts before "Summer 1" alphabetically — Primary Education's plan puts Spring 1 *between*
  Semester 2 and Semester 3, so the label can never be the ordering key. The label stays
  free text so a new block never needs a migration.
- The three curriculum writes return the WHOLE programme rather than the touched row: each
  changes the block's credit total and the programme's total, and a builder that had to
  re-fetch after every edit would flicker.
- `curriculum_credits` is summed by joining `courses` — **reachable only because `006` moved
  the catalog there.** On `subjects` there was no credits column to add up (plan §B3). This
  is the first place the Phase 2A cutover actually pays out.
- `DELETE /programs/{id}` refuses with 409 `program_in_use` while students are registered,
  steering the Dean to retire it instead. Necessary because
  `student_profiles.program_id` is `ON DELETE SET NULL` — a hard delete would silently
  orphan those students rather than fail. `program_id` is mapped on `StudentProfile` for
  that guard; **nothing sets it yet**, and it is on no student schema, because assigning a
  student to a programme (with `student_program_history` so a change never destroys history)
  is Phase 4 §D12.
- A curriculum row is a HARD delete, unlike everything else in the module: it says "this
  programme requires this course" and carries no history of its own. What a student actually
  took lives in `class_enrollments` and `term_grade_snapshots` and is untouched.
- Curriculum rows are looked up **scoped to the programme in the path**. By id alone,
  `/programs/{A}/courses/{row-belonging-to-B}` would have edited B's curriculum through A's
  URL; there is a test for both PATCH and DELETE.

**Frontend.**
- New `features/programs/` — a Programmes list and a nested `/settings/programs/:id`
  curriculum builder (a page, not a dialog: a Dean part-way through an 87-credit sequence
  needs a URL to come back to). The list shows `curriculum_credits / total_credits` and
  turns amber while they disagree, because that gap is how a data-entry slip gets noticed.
- Academic structure was rebuilt for N terms: the create-year dialog is a term LIST with
  add/remove, and each year gains "Add term" plus a per-term edit.
- New `programs` key in `PERMISSION_MATRIX`, mirrored by a Dean gate in the MSW handler.
- **Two MSW gaps closed while here.** `POST /settings/academic-years` had no handler at
  all, so demo mode 404'd on the "New academic year" button while the real backend answered
  201 — the mirror image of the defect this project already paid for once in the other
  direction. And `GET /settings/semesters` was emitting a term shape without `term_type`.
- Generated models were **hand-edited** again (`semesterDetail`, `semesterCreateRequest`,
  `academicYearCreateRequest`, new `termType` / `semesterUpdateRequest` /
  `standaloneSemesterCreateRequest`), each with a header saying so — `npm run generate:api`
  remains forbidden. `features/programs` is hand-written throughout, like Students.

### 2026-08-16 — Phase 1 closed; Phase 2A (catalog cutover) done

**Suite: 1057 green** (1039 → 1051 after Phase 1 → 1057 after 2A). Typecheck clean, lint at its
pre-existing 2-warning baseline, `vite build` clean.

**Migrations applied:** `007_student_names.sql` (17/17) and `006_courses_cutover.sql` (14/14). Both
were applied **in the same step as their code**, which is the rule the mis-sequenced first attempt at
`005` established. A structure snapshot was taken before each, and the 45 student names were dumped to
CSV before `full_name` was dropped.

**Phase 1 — the name split (D10), as a full replacement.**
- `007` drops `student_profiles.full_name` and tightens `lastname` to NOT NULL. **`firstname` stays
  nullable on purpose**: `005` §9 deliberately parks a single-token legacy name in `lastname` with a
  NULL given name, because the surname is what listings sort on, and making `firstname` NOT NULL would
  have contradicted that. The API requires both, so nothing NEW can be created that way — strict where
  data enters, permissive where old data already lives.
- `full_name` became a **`hybrid_property`**. Keeping the NAME is what made the change cheap: the ~10
  serialisation sites and the entire wire contract were untouched. Making it a *hybrid* rather than a
  plain property is what kept free-text search working — `StudentProfile.full_name.ilike(...)` still
  compiles, to a `CONCAT_WS` the database can filter on.
- One shared `STUDENT_NAME_ORDER` replaced nine independent `.order_by(full_name)` calls, and
  `_STUDENT_SORT_FIELDS` now maps a key to a TUPLE of columns — "sort by name" is two columns, and the
  old single-column shape could not express the rule at all.
- `tests/conftest.py` gained a `split_name()` helper; 14 fixture sites across 12 test files build
  students from a display string and now split it the same way the migration did.
- `test_reports.py::test_students_sorted_by_name` **asserted the wrong thing** and was the single
  failure after the split — it compared the result to `sorted(names)`, i.e. the display-string order
  the brief rules out. Rewritten as `test_students_sorted_by_surname` with three names chosen so the
  two orders disagree, and it now asserts `names != sorted(names)` explicitly.

**Phase 1 — student ID `YYYYMM###` (D9).**
- New `app/modules/students/numbering.py`. `student_number` is now optional on `POST /students`.
- **`YEAR_MONTH` is a RESERVED WORD in MariaDB** (it is an INTERVAL unit), so raw SQL against
  `student_number_sequences.year_month` is a 1064 unless it is backticked. The allocator is built with
  the MySQL dialect's `insert(...).on_duplicate_key_update(...)` so the quoting is right by
  construction rather than by remembering; the tests that do use raw SQL backtick it.
- The month comes from `school_today()`, not UTC — Belize is UTC-6, so after 18:00 local on the last
  day of a month `utcnow()` would open the next month's sequence a day early.
- `test_student_number.py` (11 cases) proves format, monotonicity, month rollover, stepping over a
  legacy ID that squats on a generated number, the bounded give-up, and **concurrency**: a second real
  connection with `innodb_lock_wait_timeout = 1` is asserted to TIME OUT while the first transaction
  holds the row. A lock-wait timeout is the pass condition. Both sessions roll back.

**Phase 2A — the catalog cutover (D2).**
- `Subject.__tablename__` is now `courses`; the model gained `credits`, `component`, `description`,
  `prerequisites_text` and `AuditMixin`, and `code` became NOT NULL. Both FKs (`class_subjects` and
  `term_grade_snapshots`) now point at `courses` — verified, with 0 orphans across all three checks.
- **The class is still `Subject` and the columns are still `subject_id`**, for the reason already
  recorded in the `006` header: decision #3 renames display labels, not technical identifiers.
- `courses.code NOT NULL` was reconciled by making `code` a REQUIRED request field. The service
  previously wrote `None`, which against `courses` is a 500; now it is a 422 naming the field. `PATCH`
  cannot clear it either.
- `coursestatus` moved off the catalog to `class_enrollments.enrollment_status`, with a new
  `EnrollmentStatus` enum. On the catalog it would have applied to every student at once.
- `test_subjects.py` gained a `TestCourseCatalogCutover` class, including the **regression for the
  failure this cutover caused the first time**: create a course through the API, then immediately
  attach it to a class. That is the exact path that produced 73 × MariaDB 1452, and it fails loudly if
  the model is ever pointed back at `subjects`.
- Frontend: the catalog form now takes a required code, credits and a GEC/SEC/CEC component, and the
  table shows credits and component. The generated `subject*` models were **hand-edited** (with a
  header saying so) because `npm run generate:api` is forbidden — `openapi.json` covers 4 of 14
  modules. MSW mirrors the required code and the 422, so demo mode cannot certify a create the real
  backend rejects.

**Documentation.** `RUNBOOK.md` §4 and `backend/db/mariadb/README.md` now list `006` and `007` as
applied, with the apply-with-the-code warning on both. The stale line in §E Phase 0 saying "`006`
drops `full_name`" is corrected to `007` — `006` was claimed by the catalog cutover after `005` was
written.

**Environment note.** `npm run build` fails here with "Access is denied" running `vite.cmd`; the same
build via `node node_modules/vite/bin/vite.js build` succeeds. It is a restriction on executing `.cmd`
shims in this shell, not a defect in the build.

### 2026-08-14 — `005` applied and verified; catalog swap deferred to `006`
- **`005_tertiary.sql` applied to `sims`: 55/55.** Verified independently — 11 subjects in
  `courses` with UUIDs preserved, 0 orphans across 116 `class_subjects` + 290
  `term_grade_snapshots` rows, 11/11 new tables, all altered columns present,
  `ck_semesters_sequence` gone, 45/45 students name-split, 0 NULL surnames.
- **Suite green against the migrated schema: 1039.**
- Added `backend/db/mariadb/apply_sql.py` so these files can be applied from a terminal
  with per-statement reporting; documented in RUNBOOK §4 and the `db/mariadb` README.
- **Correction 1 — MariaDB FK syntax.** `ADD CONSTRAINT IF NOT EXISTS … FOREIGN KEY` is a
  1064 error; `IF NOT EXISTS` belongs after `FOREIGN KEY`. Four statements failed on the
  first run. `001:552` already had the right form.
- **Correction 2 — the catalog FK swap was mis-sequenced** into `005` and caused 73 test
  failures (1452). Moved to `006_courses_cutover.sql`, to be applied with the Phase 2 ORM
  change; `005` now repairs the FKs back to `subjects`. Full reasoning in the Phase 1 note.

### 2026-08-13 — Phase 1 opened: terminology + Dean-only catalog
- **Confirmed against the live DB** that `sims` is the repo-provisioned schema (001–004
  applied, no tertiary tables). `sims_bk.sql` came from a different machine. See the
  status note above.
- New `frontend/src/shared/auth/roleLabels.ts` collapses **five** duplicated role→label
  maps into one (the audit found four; `UsersScreen.tsx` was the fifth).
- `strings.ts` is now a real term dictionary (`terms`, `roles`), and ~30 hardcoded display
  strings across 22 files were swept to Dean / Registrar / Lecturer / Course /
  Course offering.
- Also removed a second hardcoded copy of the announcement audience labels
  (`dashboard/components/AnnouncementsList.tsx` now reuses the announcements feature map).
- **Course catalog is Dean-only to write** — `subjects/router.py` moved from P/S to
  `require_role(PRINCIPAL)`, mirrored in `PERMISSION_MATRIX` (new `courses` key) and in
  the MSW handler, so demo mode cannot certify a screen the real backend would 403.
  `tests/test_subjects.py::test_create_by_secretary_201` became
  `test_create_by_secretary_403`, and PATCH/DELETE Registrar guards were added.
- `RUNBOOK.md` §4 provisioning table now lists `004` (which it had always omitted) and `005`.
- Suite: **1039 green**. Frontend: typecheck clean, lint at its 2-warning baseline, build clean.
- ⚠️ `005_tertiary.sql` still needs to be run by hand — the agent's execution attempt was
  refused by the environment's permission classifier.

### 2026-08-13 — Phase 0: `005_tertiary.sql` authored, awaiting sign-off
- Wrote `backend/db/mariadb/005_tertiary.sql` — 16 sections, additive only, idempotent, **not executed**.
- Legacy tertiary tables are **quarantined by rename**, never dropped, behind `information_schema`
  guards so the file is safe on both a repo-provisioned DB and the stakeholder's live one.
- **Refined D2 step 3:** `class_subjects.subject_id` and `term_grade_snapshots.subject_id` keep their
  names; only the FK target moves to `courses`. Renaming would have forced a rebuild of the STORED
  generated column `cs_active_subject` and its unique index for no functional gain.
- Registered the plan in `docs/progress-tracker.md` (D30) and `docs/project-overview.md`.

### 2026-08-13 — Phase 0 opened
- Audited all five source documents (SQL dump, 2 PDFs rendered to images, 2 application-form images).
- Audited the backend, frontend and docs/DB-script layers.
- Recorded six client decisions (see Context).
- **Found and escalated the schema conflict**: `sims_bk.sql` is not the schema the app runs on
  (§B1). Resolved as a merge.
- **Answered the grade audit** (§B2) and identified the structural blocker — no stored grade can
  reach a credit value (§B3).
- Created branch `tertiary-refactor`; authored this document.

---

## I. Closing report — SIMS → BAJC tertiary SIMS

> **How this report was written, and its one limitation.** The brief asked for an audit
> answering its §28 A–F. The brief was pasted into a chat on 2026-08-13 and is **not a file
> in this repository**, so its §28 wording is not available to quote against. Only **§28-B**
> (the grade audit) was captured verbatim at the time, in §B2.
>
> This report is therefore written from **the audit already in this plan** — §A source
> material, §B database, §B2 grade audit, §C codebase map, §D design, §E delivery, §G open
> items — and organised the way a reader of the brief would expect. **If BAJC's §28 asks
> something this does not answer, paste §28 A–F and it will be answered directly.**

### I1. What was asked, and what it became

`school-management-system` was a working **sixth-form SIMS**: React 18 + TS + MUI 6 +
TanStack Query, FastAPI + SQLAlchemy 2 (sync), self-hosted MariaDB 12.3. It had to become a
**tertiary Student Management Information System for Belize Adventist Junior College** —
real programmes, course sequences, prerequisites, admissions, grading policy and report
layout — **without a rewrite**.

It did not need one, and the reason is worth stating: decision **D29** had already pivoted
the app to a university-shaped model. A `classes` row was already one *subject class*, a
student already held *many concurrent enrolments*, and `class_meetings` already gave a weekly
timetable. So Class → Course was largely **rename plus attach credits and curriculum**, and
the refactor was additive throughout.

**Five phases, five gates, all walked over the HTTP API against the live database** rather
than through the ORM, so what each gate proves is shipped behaviour:

| Phase | Gate | Result |
|---|---|---|
| 0 | Client approves the DDL | ✅ 2026-08-13 |
| 1 | Terminology, roles, identity | ✅ 1051 tests |
| 2 | Dean builds a programme end to end; the prerequisite block fires | ✅ **22/22** |
| 3 | GPA reproduces the sample report card's 2.1 | ✅ **39/39** |
| 4 | File → transfer → accept → change programme, history intact | ✅ **62/62** |
| 5 | Request → notify → approve/deny → audit trail complete | ✅ **42/42** |

**Backend suite: 380 → 1394 green.** Frontend typecheck clean, lint at its pre-existing
2-warning baseline, `vite build` clean.

### I2. The two findings that shaped everything

**The supplied dump was not the schema the application runs on** (§B1). `sims_bk.sql` was the
repo's pre-`001` base plus new tertiary work, and it was missing everything migrations
`001–004` had added — `login_attempts.attempted_at`'s default (every login would fail),
`audit_log.id`'s AUTO_INCREMENT, `subjects.is_active` still generated (every subject write
would fail), the timestamp/audit columns on ~25 tables, `class_meetings` entirely. Adopting
it as-is would have broken the running system. Resolved as a **merge**: keep `001–004`, adopt
the genuinely new tertiary tables on top. That decision is why `005_tertiary.sql` quarantines
the four legacy tables **by rename, never by drop**.

**No stored grade could reach a credit value** (§B3). The graded chain was
`assessment_grades → assessments → class_subjects → subjects`, and `subjects` had no credits;
`courses` had credits and was wired to nothing at all. That single fact made credit-weighted
GPA, quality points, credits-earned and credits-remaining *impossible*. `006_courses_cutover`
closed the chain, and `docs/database-schema.md:1035` — which recorded the GPA's absence as
deliberate and predicted the fix would be additive — was right about that and slightly wrong
about where the credits would live.

### I3. What BAJC can now do that it could not

- **Eight real programmes** with their 2026/27 course sequences: 114 courses, 243 curriculum
  rows, 63 prerequisites and the Internship's `ALL COURSES` gate — transcribed from the PDF,
  checked in as code, and **verified by arithmetic**: every one of the 43 term blocks sums to
  its printed total. That check is what caught the `AGR12110` typo.
- **Prerequisites that are enforced**, judged on *successful completion* against the
  **programme's own** pass mark, at both enrolment doors, with a 409 that names the missing
  course and the grade actually earned.
- **A credit-weighted GPA** on the report card, the transcript and the dashboard, from one
  implementation, reproducing the sample document's 2.1 exactly.
- **BAJC's own grading scale** — eight bands with grade points, D and F both failing,
  `pass_mark` 70 — defined in one place and seeded.
- **A grade-submission deadline** the Dean sets and the system enforces, with the
  grade-revision workflow as its sanctioned exception.
- **The BAJC report card layout**, with programme code, Period, credits, instructor, the GPA
  row and the Dean's signature block.
- **Admissions end to end**: the A–G application as an interruption-safe wizard, credit
  transfer under the full CTA policy, and an acceptance that creates the student, the login
  and the `YYYYMM###` in one transaction.
- **Programme changes that never destroy history**, with an academic history derived on every
  read rather than cached.
- **A grade-revision workflow** in which the original mark is never overwritten and the trail
  records it three times over.

### I4. Where the system is deliberately strict

Recorded here because each looks like a missing feature until you know why:

- **A pending credit transfer blocks acceptance.** The transfers decide which courses the
  student arrives holding, and policy allows the request only at admission.
- **Approval of a credit transfer needs ≥75% equivalency AND a tertiary institution on
  Section B.** Enforced in the API *and* by a database CHECK.
- **Programme changes are Dean-only**; admission is the Registrar's.
- **A course a new programme does not require stops counting** toward that award — the grade
  is untouched, but nothing is assumed to carry over.
- **Transferred credit counts toward the award and not toward the GPA.** A transfer grants
  credit, not a grade point.
- **A decided credit transfer or grade revision cannot be re-decided.** A fresh request is the
  way to change course; reversing a ruling in place would leave no record of the reversal.
- **The Dean cannot request a grade revision**, only decide one.
- **An archived year keeps the grading scale, credits and grade points that were in force
  then.** A later edit cannot re-letter a document already issued.

### I5. What is NOT done

- **Course retakes** (§G item 5). `uq_enroll_active` has no attempt column, so a repeated
  course cannot be represented. Outside the brief's scope, and the only gap from §B2's
  original list that D30 did not close. Prerequisite and GPA logic will need it eventually,
  and BAJC must first say whether a retake replaces the first attempt in the GPA or joins it.
- **Document uploads** (§G item 11). Admission documents are a checklist; object storage is
  not provisioned (OQ-DB5, the same reason the school-logo upload is still a stub). The
  columns exist, so adding bytes is additive.
- **`THEO1110` names two different courses** (§G item 1). Science & Religion is seeded under
  the deliberately provisional `THEO1110-B`. **It will print on a report card as it stands —
  BAJC must assign a real code.**
- **`component` is a per-PROGRAMME fact stored per COURSE** (§G item 8). Nine of the 114
  courses carry different components in different programmes; the catalog holds the majority
  value and the minority reads wrong on screen for those nine. The fix is additive —
  `program_courses.component` falling back to the course — but it is a design change and was
  raised rather than taken.
- **`EDUC1214` requires `EDUC1210` and both sit in Primary Education Semester 2** (§G item
  10). A prerequisite cannot be met in the same term as the course it gates, so as the
  sequence is written that course is un-enrollable in its own block. Either the requirement or
  the placement must move.
- **13 open items in §G** in total, all flagged rather than guessed.
- **Pre-existing repo issues in §F**, not introduced by D30 — chiefly **19 live accounts
  sharing the password `SimsDemo2025!` with `must_change_password = false`**. That is a
  **go-live blocker** and should be dealt with before anyone signs in for real.
- **`docs/database-schema.md` and `docs/architecture.md` still describe PostgreSQL**, and
  `docs/api-specification.md` covers no D30 module. This plan's §D and §E are the record of
  the tertiary schema and API surface. (`api-specification.md` belongs to the earlier
  high-school system and is out of scope by the client's instruction, 2026-08-18.)

### I6. Operating it

```powershell
cd backend
.\.venv\Scripts\python.exe -m app.db.seed                 # bootstrap: profile, policy, year, scale, Dean
.\.venv\Scripts\python.exe -m app.db.seed_bajc            # 114 courses, 8 programmes, curriculum, prerequisites
.\.venv\Scripts\python.exe -m app.db.seed_grading_scale   # the BAJC 8-band scale with grade points
```

Both reference seeds are idempotent and support `--dry-run`. **Skipping the grading-scale seed
is silent** — nothing errors, but every GPA prints 0.00 because `grade_point` is NULL on a
pre-Phase-3 scale. `seed_grading_scale` deliberately skips FROZEN scales, so archived years
keep the bands that were in force then. RUNBOOK §4 has the full provisioning order.

Migrations are hand-run in numeric order via `backend/db/mariadb/apply_sql.py` — **Alembic
does not work in this repo**, its single revision being Postgres-only. `sims.sql` → `001` →
`002` → `003` → `004` → `005` → `006` → `007`, all applied. **Phases 3, 4 and 5 added no
migration at all**: `005_tertiary.sql` had already created every column and table they
needed.

Two rules learned the hard way and worth keeping:

1. **Apply a migration in the same step as the code that needs it.** The first attempt at
   `005` re-pointed the catalog FKs without moving the writes and broke 73 tests with MariaDB
   1452 — the database was ahead of the application.
2. **`ADD CONSTRAINT IF NOT EXISTS … FOREIGN KEY` is a 1064 syntax error in MariaDB.**
   `IF NOT EXISTS` goes *after* `FOREIGN KEY`.

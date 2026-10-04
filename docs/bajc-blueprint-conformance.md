# BAJC SIMS — Blueprint Conformance and Gap Analysis

**Source document:** `BAJC Student Information Management System.docx` — *System Requirements
and Design Blueprint, Version 1.0* (77 sections).
**Audited against:** this repository, branch `tertiary-refactor`, commit `01ac60f` (2026-09-03).
**Method:** every one of the blueprint's 77 sections was read and checked against the actual
code — SQLAlchemy models (41 tables), the live route table (110 paths / 156 operations in
`backend/openapi.json`), the frontend feature modules, and `RUNBOOK.md`. Nothing below is
inferred from the planning docs; where a doc and the code disagreed, **the code won**.

> **How to read the status marks**
>
> | Mark | Meaning |
> |---|---|
> | ✅ | Built and exercised by tests. Nothing outstanding. |
> | 🟡 | Built, but narrower than the blueprint asks. The delta is stated. |
> | 🔴 | Not built. No table, no endpoint, no screen. |
> | ⚪ | Deliberately built differently. Needs a client decision, not code. |

---

## 0. Headline

**Roughly 70% of the blueprint exists and works.** The *application → registration → attendance
→ gradebook → GPA → report card / transcript* spine is complete, tested (1,831 backend tests),
role-scoped and running. What is missing is concentrated in **four coherent blocks** at the two
ends of the lifecycle, plus operations:

| Block | Blueprint sections | Status |
|---|---|---|
| **Curriculum versioning** | §10, §52 | 🔴 Not built — and it is the prerequisite for graduation audit |
| **Graduation, degree award, official transcripts** | §33–§37 | 🔴 Not built |
| **Academic standing + student holds** | §21, §30 | 🔴 Not built |
| **Registration windows, credit-load rules, applicant self-service** | §5.1, §14, §19, §20 | 🟡/🔴 Partly built |
| **Operations: backups, CI, notifications** | §49, §54 | 🔴 Not built — backups are the single largest risk |

The MVP defined in blueprint §70 is **14 of 17 items complete**. See §4 below.

---

## 1. Module scorecard (blueprint §3 — the 25 named modules)

| # | Module | Status | Where it lives |
|---|---|---|---|
| 1 | User Management and Security | ✅ | `modules/auth`, `modules/users`, `modules/settings` |
| 2 | Application and Admissions | 🟡 | `modules/admissions` — no applicant self-service account |
| 3 | Student Records | ✅ | `modules/students` |
| 4 | Departments and Programmes | ⚪ | `modules/programs` — **no `departments` table**; the programme is the unit |
| 5 | Curriculum Management | 🔴 | `program_courses` is one *current* plan, not versioned curricula |
| 6 | Course Catalog | ✅ | `modules/courses`, `modules/prerequisites` |
| 7 | Academic Year and Semester | 🟡 | `modules/settings` — no registration / add-drop / withdrawal dates |
| 8 | Class Sections | ✅ | `modules/offerings` (`course_offerings`) |
| 9 | Student Registration | 🟡 | staff-mediated enrolment; no student self-registration, no holds |
| 10 | Timetable Management | 🟡 | `modules/timetable` — conflict detection real, no `rooms` table |
| 11 | Attendance | ✅ | `modules/attendance` |
| 12 | Gradebook | ✅ | `modules/assessments`, `modules/grades` |
| 13 | Final Grade Submission | 🟡 | freeze-based, not the submit→approve→post chain of §27 |
| 14 | Academic Records and GPA | ✅ | `modules/grades/calc.py`, `term_grade_snapshots` |
| 15 | Academic Standing | 🔴 | — |
| 16 | Graduation Audit | 🔴 | — |
| 17 | Transcript Management | 🟡 | transcript *generates*; no numbering, request workflow or issuance log |
| 18 | Student Portal | ✅ | `/students/me`, `/grades/me`, `/attendance/me`, `/timetable/me`, `/reports/report-card/me` |
| 19 | Lecturer Portal | ✅ | offerings / roster / attendance / gradebook, ownership-scoped |
| 20 | HOD Portal | ✅ | `program_heads`, D43 |
| 21 | Registrar Portal | 🟡 | everything except graduation, transcript workflow, holds |
| 22 | Dean Dashboard | ✅ | the full §42 KPI set except the two blocked by C1/C2 (D45 Phase 8) |
| 23 | Reporting and Analytics | 🟡 | 15 reports of the ~40 named in §53 (D45 Phases 7 + 9) |
| 24 | Audit Trail | ✅ | `audit_log` + `GET /audit` — the ONE door (D45 Phase 7; `/settings/audit-log` deleted 10 Sep 2026) |
| 25 | System Configuration | 🟡 | `school_profile`, grading scale, assessment policy — no number-format or threshold config |

---

## 2. Section-by-section conformance (§1–§77)

### Lifecycle and identity

- [x] **§4 Student lifecycle** — ✅ application → review → decision → student ID → profile →
  programme → enrolment → timetable → attendance → gradebook → grades → GPA is complete and
  connected through one `student_profiles` row (§77's central principle holds).
- [x] **§6 Student Identification Number** — 🟡 built, **but the format differs**. Blueprint asks
  `YYYY-NNNNN`; the system issues **`YYYYMM###`** (year + month + 3-digit sequence), allocated
  from `student_number_sequences` inside the creating transaction so a failed registration never
  burns a number. It is permanent, never reused, and survives programme change. ⚪ **Decision
  needed: keep `YYYYMM###` or migrate to `YYYY-NNNNN`.** Migrating means re-numbering live rows.
- [x] **§7 Student Master Record** — ✅ **Exceeds the blueprint.** `student_profiles` carries all
  of §7.1–§7.4 plus BAJC's paper-form fields (SSNo, religion, civil status, ATLIB, CSEC count,
  mother/father, next-of-kin, financier, health condition, district/street/town). Photograph is
  the one §7.1 field absent.
- [x] **§7.5 Student Status** — ⚪ built with the **client's own vocabulary**, not the
  blueprint's: `Registered / Unregistered / DropOut / transferred / graduated / withdrawn`
  (adopted verbatim from the client's dump in D34). Historical status changes are captured in
  `student_program_history` for programme moves; **a general status-history table does not
  exist** — §7.5's "every status change must be stored historically" is 🟡 partial.

### Admissions

- [ ] **§5.1 Applicant account** — 🔴 **Not built.** Applicants cannot self-register or log in.
  The Registrar transcribes the paper form through a wizard. No `APP-YYYY-NNNNN` reference
  number is issued.
- [x] **§5.2 Application information** — ✅ complete, plus `application_education` (previous
  institutions) and `application_documents`.
- [x] **§5.3 Application status** — 🟡 six states (`draft / submitted / under_review / accepted /
  denied / withdrawn`) against the blueprint's ten. Missing: `Documents Pending`, `Eligible`,
  `Deferred`, `Enrolled` (the last is implicit — acceptance creates the student).
- [x] **§5.4 Admissions decision** — ✅ decision, date, comments, deciding officer, programme
  and academic year all recorded; `POST /applications/{id}/accept` performs the
  applicant → student conversion. Conditions-of-admission is not a distinct field.
- [x] **§56 Document management** — ✅ `application_documents` + `student_documents` with type,
  content type and size. ⚠️ **Byte storage is stubbed** — validation is real, the upload needs an
  object-storage bucket (`TODO(OQ-DB5)`). Same for the school logo.

### Academic structure

- [ ] **§8 Department Management** — ⚪ **Deliberately absent.** There is no `departments` table;
  `programs` is the unit BAJC actually operates, and the HOD role scopes through `program_heads`.
  If the college wants BUS/EDU/IT/SCI as first-class records above programmes, that is new work.
- [x] **§9 Programme Management** — 🟡 `programs` has code, name, award, total credits, minimum
  passing grade point, active flag. **Missing:** normal duration, admission requirements text,
  graduation requirements text, and the department link.
- [ ] **§10 Curriculum Management** — 🔴 **Not built, and this is the most consequential gap.**
  `program_courses` holds one *current* course sequence per programme (243 rows, 8 programmes).
  There are no `curriculums` / `curriculum_requirements` tables, no `ASIT-2024` vs `ASIT-2026`
  versions, and `student_profiles` has no curriculum-version pin. A student is therefore always
  evaluated against today's plan. **Graduation audit (§33) cannot be built correctly without
  this** — an audit against a moving plan is not an audit.
- [x] **§11 Course Catalog** — ✅ `courses` with code, title, description, credits, component
  (GEC/SEC/CEC), prerequisite text, active flag; historical courses are deactivated, never
  deleted. **Missing:** course level, lecture hours, lab hours, co-requisites.
- [x] **§12 Course Prerequisites** — ✅ `course_prerequisites` with cycle detection, an
  `all_program_courses` requirement type (for `EDUC3201` Internship, whose prerequisite is
  literally "ALL COURSES"), minimum-grade-point checks, and approved transfer credits counting
  toward satisfaction. Enforced as a **hard 409 at enrolment**. 🟡 **No override mechanism** —
  §12 asks for an authorised override that is logged; today the gate simply refuses.
- [x] **§13 Academic Year Management** — ✅ `academic_years` with active/archived status.
- [x] **§14 Semester Management** — 🟡 `semesters` has code, year, name, `term_type`
  (summer/semester/spring), sequence, start/end, midterm window. **Missing: registration opening
  date, registration closing date, add/drop deadline, withdrawal deadline.** The grade-submission
  deadline column exists but was **retired from enforcement in D42** at the client's request.
  Semester status is a boolean `is_active`, not the six-state lifecycle of §14.
- [ ] **§17 Classroom Management** — 🔴 **No `rooms` table.** `class_meetings.room` is free text.
  Room-conflict detection works, but on the string — two spellings of the same room do not clash,
  and there is no capacity or room-type record.

### Sections, timetable, registration

- [x] **§15 Class Section Management** — ✅ `course_offerings` = course + semester + section code
  + capacity + archive flag. Multiple parallel sections in one term are supported and seeded
  (`MATH1110` §01/§02/§03), as is the same course re-offered in a later term.
- [x] **§16 Lecturer Assignment** — ✅ `class_teachers` with a lead flag; Dean/Registrar assign.
  Lecturer double-booking is detected.
- [x] **§18 Timetable Management** — ✅ student, lecturer **and** room conflict detection;
  personal timetables for both students (`/timetable/me`, `/timetable/students/{id}`) and
  lecturers, correctly narrowed to one term (a D31 defect fix).
- [x] **§19 Registration Module** — 🟡 `class_enrollments` records student, offering, semester,
  status and timestamps, and history is preserved (unenrolment sets `unenrolled_at`, it does not
  delete). **Two gaps:** (a) students cannot register themselves — Dean/Registrar enrol them;
  (b) the status vocabulary is `enrolled / audit / withdraw_passing / withdraw_failing`, so
  `Pre-registered`, `Added`, `Dropped`, `Completed` and `Failed` have no representation.
- [x] **§20 Registration Validation** — 🟡 **4 of 8 checks implemented.** ✅ prerequisites (hard
  409), ✅ duplicate registration, ✅ timetable conflict (reported), 🟡 capacity (**warn-only** by
  decision D-Q6). 🔴 registration period open (no dates to check), 🔴 credit-load limits, 🔴
  registration holds, 🔴 authorised override with logging.
- [ ] **§21 Student Holds** — 🔴 **Not built at all.** No hold type, no blocking of registration,
  reports, transcripts or graduation clearance.

### Attendance

- [x] **§22 Attendance Module** — ✅ roster-driven, with exactly the four statuses of §22
  (`present / absent / late / excused`). 🟡 **No `attendance_sessions` entity** — a record is
  keyed on (offering, student, date), so there is no per-session time or topic, and a course
  meeting twice on one day is one attendance row.
- [x] **§23 Attendance Monitoring** — 🟡 percentages are computed and shown to students,
  lecturers, HODs, the Registrar and the Dean (`/attendance/summary`, `/reports/attendance`).
  🔴 **No configurable threshold and no alert generation** — the "below 80% = Warning" rule of
  §23 does not exist as a setting or a notification.

### Gradebook and grades

- [x] **§24 Gradebook Module** — ✅ every offering gets categories and assessments; lecturers own
  their own. 🟡 **The 100% weighting check of §24 is not implemented.** Instead the term grade is
  *normalised* by the participating weight (`weight_base_used`), which is more robust against a
  half-graded term but means the system never warns that a gradebook's weights sum to 90%.
- [x] **§25 Assessment Records** — ✅ name, type, max score, weight, date, category, offering;
  per-student scores in `assessment_grades` with `pending / graded / absent / excused / exempt`,
  makeup scores, drop-lowest and absent-as-zero policies at three levels (school → year →
  category), and controlled release to students.
- [x] **§26 Grading Scale** — ✅ **fully configurable, per academic year, exactly as §26 asks.**
  `grading_scales` (pass mark, freeze flag) + `grading_scale_bands` (letter, min, max, grade
  point, passing flag). Nothing is hard-coded.
- [ ] **§27 Final Grade Submission Workflow** — 🟡 **the mechanism differs from the blueprint.**
  There is no per-offering `Draft → Submitted → HOD Approved → Registrar Approved → Posted`
  chain. What exists is: per-assessment release to students, a **mid-term freeze window**
  (D33 — blocks grade *entry*, not just revision), and an **academic-year archive freeze** that
  writes `term_grade_snapshots` and locks the year. Locking (§66) is therefore real, but it is
  time-and-term based, not an approval workflow, and the Dean has no explicit "post grades"
  action. ⚪ **Client decision needed:** is the freeze model acceptable, or is the four-stage
  approval chain required?
- [x] **§28 Grade Changes** — ✅ `grade_revision_requests` records student, grade, original score,
  proposed score, reason, requester, decision, decider and decision note. **Dean-only approval.**
  One open request per grade, enforced by a unique index. Decided requests are never deleted.
  🟡 The audit log records the action; the *previous → new value* pair is on the request row
  rather than in `audit_log`.
- [x] **§29 GPA Calculation** — ✅ `Quality Points = Credits × Grade Points`, `GPA = ΣQP ÷ ΣCredits`,
  semester **and** cumulative, on a 4.00 scale. The denominator is **all enrolled credits**
  (decision D30 #4), so a failed course drags the GPA — which is what BAJC's printed transcripts
  do. 🔴 Repeat / withdrawal / incomplete / transfer treatment is **not configurable** (see §31).
- [ ] **§30 Academic Standing** — 🔴 **Not built.** No Good Standing / Warning / Probation /
  Suspension / Dean's List, no `academic_standing_history`, no rules engine.
- [x] **§31 Repeating Courses** — 🟡 every attempt is retained (each enrolment is its own row and
  nothing is deleted), so the *data* requirement of §31 holds. 🔴 There is **no repeat policy** —
  the system does not know that a second `IT101` replaces or averages with the first, and both
  attempts currently count in the GPA.
- [x] **§32 Transfer Credits** — ✅ `credit_transfer_requests`: previous institution, external
  course code/name/credits/grade, BAJC target course, content-equivalency percentage, three
  supporting documents, decision, decider, date. Approved transfers satisfy prerequisites.

### Graduation and transcripts

- [ ] **§33 Graduation Audit** — 🔴 **Not built.** No comparison of a student's history against a
  curriculum, no eligible/not-eligible verdict, no outstanding-requirements list. **Blocked on
  §10 (curriculum versioning).**
- [ ] **§34 Degree Award** — 🔴 **Not built.** `student_profiles.graduation_date` and a
  `graduated` status exist; there is no `degrees_awarded` record with award, honours, degree
  status or award date.
- [x] **§35 Transcript Management** — 🟡 `GET /reports/transcript` **generates a real transcript**
  from the academic record (§68's principle is honoured — no separate typed copy): college
  identity, legal name, student number, programme, semester-by-semester history with course code,
  title, credits, grade, grade points, semester GPA and cumulative GPA, and course-status
  notations for audit and withdrawal (D35). 🔴 **Missing:** transfer-credit block, academic
  honours, award received, graduation date, and the official/unofficial distinction.
- [ ] **§36 Official Transcript Security** — 🔴 **Not built.** No `TR-YYYY-NNNNNN` number, no QR
  code, no verification page.
- [ ] **§37 Transcript Request Workflow** — 🔴 **Not built.** No `transcript_requests`,
  `transcripts` or `transcript_issuance_log`. Nothing records that a transcript was produced.

### Portals and access

- [x] **§38 Student Portal** — ✅ dashboard, profile, programme info, current courses, timetable,
  attendance, released gradebook results, term grades, semester + cumulative GPA, academic
  history, report card. Students see **only** their own data, enforced server-side. 🔴 Missing:
  self-registration, programme-progress view, transcript request, unofficial transcript download.
- [x] **§39 Lecturer Portal** — ✅ teaching timetable, assigned offerings, rosters, attendance,
  gradebooks, assessment setup, grade-revision requests, academic-year switcher. Lecturers cannot
  modify permanent student information. **D42 closed the scoping hole** where one shared offering
  exposed a student's whole record. 🔴 Student photographs on the roster.
- [x] **§40 HOD Portal** — ✅ D43. An HOD keeps every lecturer power on offerings they are
  assigned to (by *ownership*, not role) and additionally reads their programme's students,
  courses, offerings and colleagues. Appointing a head grants the role; removing the last
  appointment revokes it, and a head who still runs another programme is not demoted.
- [x] **§41 Registrar Portal** — 🟡 admissions, student records, academic structure, years,
  semesters, sections, enrolment, grades, academic history, transfer credits, reports — all
  present. 🔴 Student holds, graduation, transcript workflow.
- [x] **§42 Dean Dashboard** — ✅ **institution-wide, and the KPI set is complete except for
  the two indicators whose modules are deferred** (D45 Phase 8). Grouped into three bands:
  *the college* (active students with seats-filled progress, new intake, **courses — now the
  CATALOG**, lecturers, programmes, attendance rate), *needs attention* (new applicants,
  students accepted but not enrolled, students below the attendance floor, outstanding grade
  submissions — every one a work queue linking to the screen that clears it), and *outcomes*
  (graduates to date, session failure rate, and a worst-courses table). Plus enrolment by
  programme, grade distribution and enrolment trend.
  ⏸️ **Deliberately absent, not missing:** *students on probation* needs Academic Standing
  (deferred with C1) and *graduation candidates* needs the Graduation Audit (C2). Neither is
  faked with a zero, and a test pins their absence.
  ⚠️ **Two defects found building it.** Four of these KPIs had been computed by the server
  since Phase 1 and the frontend type could not express them, so the screen silently dropped
  them. And `total_courses` was counting `course_offerings` — 12 where the catalog holds 125 —
  with `deleted_at IS NULL` written three times over.
  🟡 Filtering by academic year works; by department / programme / course / level does not.
- [x] **§43 Auditor Role** — ✅ D43. Read-everything, write-nothing, enforced **centrally in
  `get_current_user`** — the one dependency every authenticated route passes through — so an
  endpoint written next year is read-only for an Auditor without its author knowing the role
  exists. Three argued exemptions (logout, own password, own preferences).
- [x] **§44 Role-Based Access Control** — ✅ **every server request verifies authorisation**;
  page visibility is a payload measure only, and the RUNBOOK says so explicitly. 🟡 Permissions
  are **role-based, not granular** — there is no `permissions` / `role_permissions` table, so
  §44's "roles should contain permissions" is satisfied in effect but not in structure. Adding a
  seventh role today means code, not configuration.
- [ ] **§45 Permission Matrix** — ⚪ **the blueprint's §45 is blank** (it reads "AS DISCUSSED").
  `docs/roles-access-and-flows.md` documents what was built. **The client still owes a signed
  matrix**, and until it exists there is nothing to verify the implementation against.

### Security, audit, operations

- [x] **§46 Audit Trail** — ✅ `audit_log` records actor, action, entity type, entity id, summary,
  timestamp, **module, IP address and an explicit previous/new value pair** (D45 Phase 7,
  migration `020`), and is surfaced at **`GET /audit`** — rendered server-side into sentences,
  named people and Belize-local timestamps, with no id, table name or JSON reaching the client.
  §53's four audit reports sit on the same endpoint.
  ⚠️ **`GET /settings/audit-log` (D43) is DELETED** (10 Sep 2026). It was a second door onto the
  same table, showing the rows raw — and its gate had grown to include the System Administrator,
  whom Phase 7 deliberately refused on `/audit` because the trail is mostly academic records
  (§48). One table, one reader. See `complete-work.md` §4b.
  🟡 **Still open:** retention (§7 item 12), and whether the Registrar should read it (item 13).
  ✅ Audit records are not editable through the application, and there is no write endpoint.
- [x] **§47 Login and Security** — ✅ Argon2id hashing (tuned time/memory/parallelism, with a
  production floor asserted at boot), account lockout (5 failures → 423, then 429 rate-limit),
  30-minute idle session timeout, refresh-session rotation with revocation, forced password
  change enforced server-side, `login_attempts` history, password policy (10-char minimum),
  HTTPS + HSTS documented. 🔴 **Two-factor authentication for privileged users is not built.**
- [x] **§48 Data Protection** — ✅ least privilege is real and tested: 1,831 backend tests
  including 47 dedicated role-scoping tests, mutation-checked (D42, D43).
- [ ] **§49 Backup Requirements** — 🔴 **NOTHING IS SCHEDULED AND NO RESTORE HAS EVER BEEN
  TESTED.** The RUNBOOK names this as the largest remaining production risk, and for a system of
  record holding student academic history that assessment is correct. A nightly off-host
  `mysqldump` is a few lines of work; the untested-restore part is the real gap.
- [x] **§50 Core Database Tables** — 🟡 **41 of the ~55 tables the blueprint names.** Present in
  spirit or name: users, login history, audit logs, applications + documents + education +
  decisions, students + guardians (inline) + documents + programme history, programs, courses +
  prerequisites, academic years, semesters, class sections, section lecturers, timetable entries
  (`class_meetings`), registrations (`class_enrollments`), attendance records, assessment
  categories + assessments + scores, grading scales, grade change requests, transfer credits.
  🔴 **Absent:** `roles`, `permissions`, `user_roles`, `role_permissions` (role is a column),
  `curriculums`, `curriculum_requirements`, `student_status_history`, `student_holds`, `rooms`,
  `attendance_sessions`, `academic_standing_history`, `transfer_institutions`,
  `graduation_audits`, `graduation_applications`, `degrees_awarded`, `transcript_requests`,
  `transcripts`, `transcript_issuance_log`, `departments`.
- [x] **§51 / §52 Entity relationships** — ✅ every relationship §52 lists is implemented and
  enforced with foreign keys, **except** the two that depend on curricula.
- [x] **§53 Reports** — 🟡 **15 built of the ~40 named.** Built: report card (+ own), transcript,
  student list/directory, enrolment, attendance, offering grades, audit log, the four **audit
  reports** (grade changes, student record changes, registration overrides, system activity —
  D45 Phase 7), and the four **institutional reports** (new versus returning, over-capacity
  classes, credit load, per-programme attendance — D45 Phase 9). 🔴 Not built: all admissions
  reports, students-not-registered, grade distribution as a *report*, pass/fail rates,
  incomplete/outstanding grades. ⏸️ Deferred with their modules: Dean's List and probation list
  (C1, Academic Standing), every graduation report and every transcript report (C2), and §53's
  "transcript issuance" audit report with them.
- [x] **§54 Notifications** — 🟡 in-system **announcements** exist (audience all / students /
  lecturers / one class, read tracking, unread count) plus a calendar of events. 🔴 **No
  event-driven notifications at all** — nothing fires on application received, admission
  accepted, missing documents, registration opened, grade posted, attendance warning or
  transcript ready. No email integration.
- [x] **§55 Search Function** — 🟡 student search matches full name, first name, last name and
  student number, and **results obey permissions** (a lecturer sees only their own students —
  D42). 🔴 Search by programme, email or application number is not offered.
- [x] **§57 System Settings** — 🟡 college name, logo, address, contact, academic calendar,
  grading scale, GPA scale and assessment policy are all configurable. 🔴 Attendance thresholds,
  maximum / minimum credit load, transcript formatting, and the student / application /
  transcript **number formats** are hard-coded.
- [x] **§58 Main Navigation** — 🟡 the Lecturer, Student and HOD menus match §58. The Registrar
  and Dean menus are missing their Curriculum, Graduation and Transcripts entries because those
  modules do not exist.
- [x] **§59 Dashboard cards** — see §42.

### Architecture and non-functional

- [x] **§60 Technology architecture** — ✅ web-based, browser-only for the user, clean
  frontend → API → relational database separation.
- [x] **§61 Technology stack** — ⚪ **React + TypeScript + MUI / Vite** frontend (blueprint: React
  ✅), **FastAPI + SQLAlchemy (Python 3.12)** backend (blueprint suggested Laravel or ASP.NET
  Core), **MariaDB 12.3** self-hosted (blueprint suggested PostgreSQL). Git ✅. Server-generated
  PDF is 🟡 — printing is browser-side `window.print()` with print stylesheets, not a server PDF
  engine. The stack divergence is **settled and not worth revisiting**; the blueprint's own
  wording is "recommended option", and none of its architectural properties are lost.
- [x] **§62 Responsive Design** — ✅ desktop, laptop, tablet and phone. Tables collapse to cards
  on mobile; lecturers can take attendance from a phone.
- [x] **§63 Performance** — 🟡 indexes exist on student number, course code, semester and the FK
  columns. 🔴 No load testing has been done and no performance budget is asserted anywhere.
- [x] **§64 Data Integrity** — ✅ unique student number, unique course code, unique
  (course, semester, section) offering, no duplicate enrolment, attendance requires a real
  enrolment, every offering belongs to a semester. Enforced at **both** application and database
  level.
- [x] **§65 Historical Data Principle** — ✅ soft deletes (`deleted_at`), archive flags,
  `unenrolled_at`, `student_program_history`, decided revision requests never removed, courses
  deactivated not deleted, `term_grade_snapshots` frozen at year end. This principle is well
  honoured.
- [x] **§66 Record Locking** — 🟡 see §27. Locking is real (midterm freeze + year archive freeze)
  but not the submitted → approved → posted → LOCKED chain.
- [ ] **§67 Semester Closing** — 🟡 **archiving an academic YEAR** freezes its grades and writes
  snapshots. 🔴 There is no *semester* closing operation and no pre-closure verification of
  outstanding grade submissions, unapproved grades or registration inconsistencies.
- [x] **§68 Transcript Data Principle** — ✅ the transcript is generated from the academic record.
  No parallel typed copy exists.

### Governance

- [x] **§69 Implementation Phases** — mapped in section 3 below.
- [x] **§70 Minimum Viable Product** — see section 4 below.
- [x] **§71 Future Modules** — ✅ none of them have been mixed into version 1.
- [ ] **§72 Business Rules to Finalize** — 🟡 **8 of 18 approved.** See section 6.
- [x] **§73 Project Governance** — ⚪ client-side, not a code matter. The Registrar's involvement
  is visible throughout D33–D43, which are almost all client-driven.
- [x] **§74 Development Rule** — 🟡 mostly honoured — the grading scale, pass mark, GPA scale and
  assessment policy all come from BAJC data rather than assumptions. The unapproved rules in §72
  are where assumption still fills a gap.
- [x] **§75 Development Sequence** — ✅ `docs/requirements.md`, `docs/database-schema.md` and the
  built frontend all exist. ⚠️ `database-schema.md`, `architecture.md` and
  `api-specification.md` **still describe PostgreSQL** and are stale since the MariaDB pivot.
- [x] **§76 System Name** — ✅ BAJC SIMS.
- [x] **§77 Overall Architectural Principle** — ✅ **fully honoured.** One student, one permanent
  record; attendance, grading, registration and transcript all resolve through the same
  `student_profiles` / `semesters` / `course_offerings` / `class_enrollments` chain. No module
  keeps its own copy of anything.

---

## 3. The blueprint's own phases (§69) vs. reality

| Phase | Blueprint scope | Status |
|---|---|---|
| **1 — System Foundation** | users, roles, permissions, departments, programmes, catalog, years, semesters, config, audit | 🟡 **90%** — no departments, no granular permission table |
| **2 — Admissions** | applicant portal, applications, documents, review, decisions, conversion | 🟡 **75%** — everything but the applicant-facing portal |
| **3 — Student Records** | master record, contacts, guardians, status, programme, curriculum, documents | 🟡 **85%** — no curriculum assignment, no status-history table |
| **4 — Course Registration** | sections, lecturer assignments, rooms, registration, prerequisites, credit load, holds | 🟡 **60%** — no rooms, no credit load, no holds |
| **5 — Timetable** | scheduling, room + lecturer + student conflicts, personal timetables | ✅ **95%** — conflicts and timetables done; rooms are strings |
| **6 — Attendance** | sessions, entry, calculations, warnings, reports | 🟡 **75%** — no session entity, no warnings |
| **7 — Gradebook** | categories, assessments, scores, calculations, lecturer gradebook | ✅ **100%** |
| **8 — Official Grades** | submission, HOD approval, Registrar posting, changes, GPA, standing | 🟡 **55%** — GPA ✅ and grade changes ✅; no approval chain, no standing |
| **9 — Graduation and Transcript** | audit, approval, degree award, official/unofficial transcript, issuance log | 🔴 **20%** — transcript generation only |
| **10 — Analytics** | Dean + HOD dashboards, enrolment / attendance / grade analytics, institutional reports | 🟡 **45%** — dashboards ✅, most institutional reports missing |

---

## 4. MVP checklist (blueprint §70)

- [x] User Management
- [x] ~~Departments~~ → Programmes (⚪ departments deliberately not modelled)
- [x] Programmes
- [x] Courses
- [x] Academic Years
- [x] Semesters
- [x] Student Records
- [x] Class Sections
- [x] Registration *(staff-mediated)*
- [x] Timetable
- [x] Attendance
- [x] Gradebook
- [x] Final Grades *(freeze-based, not the §27 approval chain)*
- [x] GPA
- [x] Transcript *(generates; no official/unofficial split, number or issuance log)*
- [x] Basic Reports *(7 of them)*
- [x] Audit Logging

**14 of 17 fully met, 3 partially.** The blueprint adds: *"building admissions early is
preferable if the goal is a true application-to-transcript system"* — that was done, and it is
the single biggest thing this build got right relative to the plan.

---

## 5. What is left — prioritised

### P0 — Do before this holds real student records

- [ ] **Automated backups with a tested restore** (§49). Nightly off-host `mysqldump`, encrypted,
      plus one documented, actually-executed restore. *Nothing else on this list matters if the
      database is lost.*
- [ ] **Re-seed the live `sims` database** — 19 accounts still share `SimsDemo2025!`, a password
      that is in this repository's git history. The code cause is fixed; the rows survive.
- [ ] **Schedule `python -m app.jobs.purge`** — `login_attempts` and `audit_log` grow unbounded.
- [ ] **Get §45's permission matrix signed** and verify the implementation against it. Right now
      there is nothing authoritative to check against.
- [ ] **Approve the nine open business rules** in §72 (section 6) before more grade logic is
      written.

### P1 — Completes the lifecycle the blueprint is built around

- [ ] **Curriculum versioning** (§10) — `curriculums` + `curriculum_requirements`, a
      curriculum-version pin on `student_profiles`, and requirement categories (general
      education / major / elective / internship). *Everything else in P1 depends on this.*
- [ ] **Graduation audit** (§33) — evaluate a student against their pinned curriculum; produce
      eligible / not-eligible with an outstanding-requirements list.
- [ ] **Degree award** (§34) — `degrees_awarded` with award, programme, graduation date, honours,
      status.
- [ ] **Official transcripts** (§35–§37) — transcript numbering (`TR-YYYY-NNNNNN`), official vs
      unofficial, request workflow, issuance log, transfer-credit and honours blocks on the
      document. QR verification is a v2 item, per the blueprint's own wording.
- [ ] **Student holds** (§21) — hold type, reason, dates, blocking action; enforced at
      registration, report generation, transcript issuance and graduation clearance.
- [ ] **Academic standing** (§30) — configurable rules producing Good Standing / Warning /
      Probation / Suspension / Dean's List, with `academic_standing_history`.

### P2 — Closes the named gaps in modules that already exist

- [ ] **Registration windows** (§14, §20) — registration open/close, add/drop and withdrawal
      deadlines on `semesters`, and enforcement at enrolment.
- [ ] **Credit-load limits** (§20, §57) — configurable minimum and maximum, checked at enrolment.
- [ ] **Authorised prerequisite override, logged** (§12, §20).
- [ ] **Rooms table** (§17) — code, building, capacity, type, status; move `class_meetings.room`
      onto a foreign key so conflict detection stops depending on spelling.
- [ ] **Attendance thresholds and warnings** (§23) — a configurable percentage, a
      students-below-threshold view for Dean / HOD / Registrar, and an alert.
- [ ] **Repeat-course policy** (§31) — configurable replace-vs-average, applied in `compute_gpa`.
- [ ] **Semester closing** (§67) — a controlled operation with pre-closure verification.
- [ ] **The §27 decision** — either build the four-stage grade approval chain, or record in
      writing that the freeze model replaces it.
- [ ] **Event-driven notifications** (§54) — the ten triggers named in §54, in-system first.
- [ ] **Missing Dean dashboard indicators** (§42) — applicants, accepted, below-threshold,
      failure rates, probation, graduation candidates, outstanding grade submissions.
- [x] **The institutional report set** (§53) — 🟡 **partly done.** Over-capacity classes, the
      grade-change audit report, new-versus-returning, credit load and per-programme
      attendance all landed in D45 Phases 7 and 9. **Still open: students-not-registered and
      outstanding/incomplete grades** — both are "who is MISSING something" reports, which is
      a different query shape from the five above and was deliberately out of Phase 9's scope.

### P3 — Nice to have, or explicitly deferred by the blueprint

- [ ] **Applicant self-service portal** (§5.1) with `APP-YYYY-NNNNN` reference numbers.
- [ ] **Student self-registration** (§19) — the blueprint implies it; BAJC may not want it.
- [ ] **Two-factor authentication for Dean / Registrar / Administrator** (§47).
- [ ] **Student photographs** (§7.1, §39) — needs the same object storage as document upload.
- [ ] **Attendance sessions** (§22) — per-session records rather than per-day.
- [ ] **Server-generated PDF / Excel** (§61) — currently browser print.
- [ ] **Granular permissions** (§44) — `permissions` + `role_permissions` tables.
- [ ] **Object storage** — unblocks document bytes, the school logo and photographs.
- [ ] **Reconcile the stale docs** — `database-schema.md`, `architecture.md` and
      `api-specification.md` still say PostgreSQL.
- [ ] **CI, a Dockerfile, and a production process manager.**

---

## 6. Open business rules (blueprint §72)

| Rule | Status |
|---|---|
| Student ID numbering | ⚪ **Divergent** — `YYYYMM###` built, blueprint says `YYYY-NNNNN`. Needs a ruling. |
| Academic year structure | ✅ Approved and built |
| Semester naming | ✅ Approved and built (`summer` / `semester` / `spring`) |
| Credit limits | 🔴 **Open** — nothing built |
| Course prerequisites | ✅ Approved and built |
| Course repeats | 🔴 **Open** — attempts retained, no policy |
| Course withdrawals | ✅ Approved and built (D35 — a withdrawal keeps the roster row; `W`/`W-P` leave the GPA, `W/F` counts as a fail) |
| Incomplete grades | 🔴 **Open** |
| Grade scale | ✅ Approved and built (configurable, per year) |
| GPA calculation | ✅ Approved and built (all enrolled credits in the denominator, D30 #4) |
| Academic probation | 🔴 **Open** |
| Dean's List | 🔴 **Open** |
| Attendance thresholds | 🔴 **Open** |
| Transfer credits | 🟡 Workflow built; the *credit treatment* policy is open |
| Graduation requirements | 🔴 **Open** |
| Transcript issuance | 🔴 **Open** |
| Grade changes | ✅ Approved and built (Dean-only, D30 §D7) |
| Semester closing | 🔴 **Open** |

**8 approved, 1 divergent, 9 open.** Blueprint §74 — *"developers should never design academic
rules based purely on assumptions"* — makes those nine a gating item, not a backlog item.

---

## 7. Deliberate divergences needing a client ruling

These are not bugs and not omissions. Each was decided during D30–D43 with a reason on record;
each contradicts the blueprint and should be either accepted in writing or reversed.

1. **No `departments` table** (§8). The programme is the operational unit; the HOD scopes through
   `program_heads`. Reversing this is a schema change touching programmes, courses and the HOD
   role.
2. **Student number `YYYYMM###`, not `YYYY-NNNNN`** (§6). Reversing means re-numbering live rows.
3. **Student status vocabulary** (§7.5) — `Registered / Unregistered / DropOut / …` taken verbatim
   from the client's own dump rather than the blueprint's ten-state list.
4. **Grade locking is freeze-based, not an approval chain** (§27, §66).
5. **Capacity is warn-only, not blocking** (§20, decision D-Q6).
6. **Assessment weights are normalised, not validated to 100%** (§24).
7. **MariaDB, not PostgreSQL; FastAPI, not Laravel / ASP.NET Core** (§61). Settled — the
   blueprint says "recommended option" and no architectural property is lost.
8. **Registration is staff-mediated** (§19) — no student self-service.

---

## 8. What this audit did not check

- **Performance under load** (§63). No load test has ever been run.
- **The eight manual UAT scripts** in `docs/testing-plan.md` §5 have not been executed against a
  live deployment.
- **The live `sims` database** was not touched — every verification in this repository runs
  against a scratch copy, never the live registry.

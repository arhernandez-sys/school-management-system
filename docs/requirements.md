# Requirements Specification — School Management System (SIS)

> **Phase 1 — Requirements Analysis.** Owner: business-analyst. This document defines *what* the system must do for v1 and the rules that govern it. It does **not** define architecture, database, UI, or API design — those are owned by later phases. It honors the fixed constraints in `project-now.md` (4 roles, 11 modules, fixed frontend stack) and flags open issues from `complete-work.md` (O1, O2).

> **Phase 4.5 reconciliation (2026-06-26):** Updated to reflect confirmed stakeholder decisions. **D23 — Class = multi-subject SECTION/homeroom:** a "class" is a section (e.g. "Form 1A") with one roster and many subjects taught within it, each subject having its own teacher(s) and gradebook; a student enrolls in one section. Terminology and FRs in Classes (§3.5), Assessments (§3.6), Grades (§3.7), Attendance (§3.8), and Reports (§3.10) clarified accordingly. **D24 — Multi-year transcript is a v1 feature:** new Transcript requirement set (FR-TRN-01..07) and acceptance criteria (§5.8) added. **D26 — Transcript visibility = Principal/Secretary ONLY** (resolves OQ-TRN; reverses the earlier teacher-scope assumption): Teachers and Students have no compiled-transcript access; US-PRIN-10/US-SEC-10 retained, US-STD-10 removed. **D25 — Grade exclusions are teacher-controlled & persisted** (resolves OQ-DB7): excused = always excluded (distinct from absent); teacher-configured, stored drop-lowest applied automatically (FR-GRD-05, FR-GRD-11). Authoritative model: `database-schema.md` (class_subjects, §10.6 transcript assembly; DB-14 grading policy).

> **D29 — SIXTH-FORM SUBJECT-CLASS MODEL (2026-08-06). Supersedes D23.** The school is a
> **sixth form**, which works like a university rather than a secondary school. A "class" is
> now a **SUBJECT CLASS** ("Math-1"): one subject, one teacher set, one room and weekly slot,
> one gradebook, one roster. The office creates subject classes and enrolls each student into
> the ones they take, so a student holds **many** concurrent enrollments and two students in
> the same year group can sit different Math classes while sharing Biology.
>
> What this changed: **A-SECTION-MODEL → A-SUBJECT-CLASS-MODEL** and **A-K12-SECONDARY →
> A-SIXTH-FORM** (§8); Classes FRs rewritten (§3.5, FR-CLS-01..09); **new Timetable &
> Scheduling requirement set (§3.5a, FR-SCH-01..06)**; attendance is now taken **per subject
> class** rather than once per day per homeroom (§3.8, D-Q4's per-day granularity is
> unchanged); a student's level moved from their homeroom onto their own record as
> `year_group`; and enrolling a student is **purely additive** — the old transfer-on-enroll
> silently withdrew them from their other class, which under this model is data loss.
> Authoritative model: `database-schema.md` (`class_meetings`, `student_profiles.year_group`).

_Last updated: 2026-08-06_

---

## 1. Introduction & Scope

### 1.1 Purpose
The School Management System (SIS) centralizes the academic and administrative operations of a single school: student records, teaching staff, classes, assessments, grading, attendance, school-wide and class-level communication, and reporting. It serves four roles — **Principal**, **Secretary**, **Teacher**, and **Student** — each with a role-aware experience.

### 1.2 In Scope (v1)
- Role-based authentication and authorization for the four roles.
- Role-aware dashboards summarizing the data relevant to each role.
- Student records management (enrollment, profile, status, **section** assignment).
- Teacher records management (profile, status, **(section, subject)** assignment).
- **Section** setup (a "class" = a section/homeroom), including the **subjects taught within each section**, per-(section, subject) teacher assignment, term association, and the section's student roster.
- Assessment creation and management (quizzes, tests, exams, assignments) scoped to a **(section, subject) offering**.
- Grade entry per student per assessment, with automatic letter-grade derivation and **per-subject** term aggregation.
- Attendance recording **per section per day**, with daily and historical views.
- Announcements: school-wide (Principal/Secretary) and class/section-level (Teacher), targeted by audience.
- Reports: student report cards (all subjects in the section), **multi-year transcripts** (full academic history across all years — D24), subject grade summaries, attendance summaries, and enrollment counts, with charts.
- Settings: school profile, academic year/term configuration, grading scale, and per-user account/profile settings.
- Single school, single academic year active at a time (see Assumptions).

### 1.3 Out of Scope (v1) — explicitly excluded
- **Billing, fees, tuition, payments, and financial accounting.**
- **Timetabling / automated scheduling engine** (manual class scheduling only; no conflict-solving algorithm).
- **Parent/Guardian portal and parent accounts** (parents are recorded as contact data on the student profile, not as logins).
- **Messaging / chat / direct messaging** between users (announcements are one-way broadcasts only).
- **Library, transport, hostel, cafeteria, health/clinic, and disciplinary modules.**
- **Multi-school / multi-tenant operation** (see Open Question Q1; v1 assumes one school).
- **Mobile native apps** (responsive web only).
- **Learning Management System features**: file/assignment submission upload, online quizzes/auto-grading, course content/LMS, plagiarism checks.
- **Email/SMS/push delivery of announcements** to external channels (announcements are shown in-app only in v1).
- **Bulk data import/export tooling** beyond what is explicitly listed under Reports (no SIS-to-SIS migration tooling).
- **Audit-log UI / e-signature / formal records-retention workflows** (basic activity logging may exist at the backend level but is not a v1 user-facing feature).
- **Offline mode.**

---

## 2. Roles & Permissions Matrix

Capability levels:
- **Full** — create, read, update, delete, and configure (administrative control).
- **Create-Edit** — create and edit records, but not delete or configure system-level settings.
- **View-all** — read access across the whole school, no edit.
- **View-own** — read access limited to records that belong to the user (their classes, their students, their own data).
- **None** — no access; module/feature is hidden.

| Module | Principal | Secretary | Teacher | Student | HOD | Auditor |
|--------|-----------|-----------|---------|---------|-----|---------|
| **1. Authentication** | Full (own session) | Full (own session) | Full (own session) | Full (own session) | Full (own session) | Full (own session) |
| **2. Dashboard** | View-all (school-wide) | View-all (admin) | View-own (their classes) | View-own (their data) | View-own (their own teaching) | View-all (school-wide) |
| **3. Students** | Full | Full | View-own (students in their classes) | View-own (own profile, read-only) | View-all (their programme) | View-all |
| **4. Teachers** | Full | Create-Edit | View-all (directory, read-only) | None | View-all (lecturers in their programme) | View-all |
| **5. Classes** | Full | Create-Edit | View-own ((section, subject) offerings they teach) | View-own (their one enrolled section + its subjects) | View-all (their programme) + Create-Edit on offerings they teach | View-all |
| **6. Assessments** | View-all | View-all | Full (own classes) | View-own (their classes) | Full (own classes) | View-all |
| **7. Grades** | View-all | View-all | Create-Edit (own classes) | View-own (own grades) | Create-Edit (own classes) · View-all (their programme) | View-all |
| **8. Attendance** | View-all | View-all | Create-Edit (own classes) | View-own (own attendance) | Create-Edit (own classes) · View-all (their programme) | View-all |
| **9. Announcements** | Full (school-wide) | Full (school-wide) | Create-Edit (own classes) | View-own (targeted to them) | Create-Edit (own classes) | View-all (reads; never authors) |
| **10. Reports** | View-all (incl. any student's transcript) | View-all (incl. any student's transcript) | View-own (their (section, subject) gradebooks/students; **no transcript access**) | View-own (own report card + own grades; **no transcript**) | View-all (their programme's gradebooks; **no transcript**) | View-all (incl. any transcript) |
| **11. Settings** | Full (school + academic config) | Create-Edit (limited admin config) | View-own (account/profile) | View-own (account/profile) | View-own (account) + View-all (catalog) | View-all (read-only) |
| **12. Audit trail** (Insights) | View-all | ✗ | ✗ | ✗ | ✗ | View-all |

### 2.1 Permission clarifications (what each role specifically can and cannot do)

**Principal**
- Can do everything an administrator does; has school-wide read access to every module.
- Owns school-level Settings: academic year/term setup, grading scale, school profile, and user-role management.
- Can post and delete school-wide announcements.
- Does **not** routinely enter grades/attendance (that is the Teacher's job) but **can** view all of them.

**Secretary**
- Manages enrollment and the day-to-day records: creates/edits students, teachers, and classes.
- Can post school-wide announcements.
- **Cannot** delete teacher records or change another user's role (reserved to Principal). **Cannot** change the grading scale or close/open an academic term.
- Has View-all on grades and attendance for administrative reporting but does not enter them.

**Teacher**
- Full control over **their own** assessments; Create-Edit on grades and attendance for **their own** classes only.
- Can view the profiles of students enrolled in their classes and the teacher directory.
- Can post and edit announcements scoped to **their own** classes.
- **Cannot** see other teachers' classes' grades/attendance, edit student enrollment, or access Settings beyond their own profile.

**Student**
- Read-only consumer of **their own** academic data: schedule/classes, assessments, grades, attendance, report card, and announcements targeted to them.
- **Cannot** see other students' data, edit any academic record, or access administrative modules.

**HOD — Head of Department** *(added D43)*
- **Is a Lecturer first.** Every lecturer power is unchanged: they teach, and they enter grades, assessments and attendance for the offerings they are actually assigned to. Being promoted does not take away the gradebook they had the day before.
- **Adds a programme-wide READ.** They see every student reading for the programme(s) they head, every course in its curriculum, every offering of those courses, and every lecturer teaching them — read-only.
- **Cannot edit another lecturer's grades.** This is enforced by *ownership*, per offering, not by the role: the gradebook returns `can_edit=false` for a colleague's offering and the server refuses the write with a 404.
- Sees nothing of a programme they do not head. Reports reach their programme's gradebooks; **no transcripts**.
- The link is the `program_heads` table, and **appointing a head grants the role automatically** — the account becomes `hod` on appointment and returns to `teacher` when the last appointment is removed. Three guards: only a plain lecturer is promoted (an administrator who also teaches is never changed), only an `hod` is demoted, and a head who still runs another programme keeps the role. Every change is audited as `user.role_change`.

**Auditor** *(added D43)*
- **Reads everything, writes nothing.** Sees all students, lecturers, courses, offerings, grades, attendance, applications, reports (including transcripts) and settings, plus the **Audit trail** (Insights → Audit trail, `GET /audit`) — the sensitive-action record, which no other screen exposes. ⚠️ It used to be reachable from Settings → Audit log as well; that second screen was deleted on 10 Sep 2026 (see `complete-work.md` §4b).
- The write ban is not a matter of which routes they are listed on: **every** POST/PUT/PATCH/DELETE is refused with `403 read_only_role` in `get_current_user`, the one dependency every authenticated route passes through. A route added in future is read-only for them by default.
- The three exceptions act on their own account, not on school data: log out, change their own password, set their own preferences.
- **Cannot** author announcements, decide grade revisions, or be given any capability above `View-all`.

---

## 3. Functional Requirements per Module

> Requirement IDs follow `FR-<MODULE>-NN`. "Authorized role(s)" reflect the matrix in §2.

### 3.1 Authentication (AUTH)
Secure, role-based sign-in that establishes the session and the role-aware experience.

- **FR-AUTH-01:** The system shall allow a user to log in with a unique identifier (email or username) and password.
- **FR-AUTH-02:** The system shall authenticate credentials and reject invalid combinations with a non-enumerating error message ("invalid credentials").
- **FR-AUTH-03:** On successful login, the system shall establish an authenticated session and resolve the user's single role (Principal, Secretary, Teacher, or Student).
- **FR-AUTH-04:** The system shall route the user to the dashboard appropriate to their role after login.
- **FR-AUTH-05:** The system shall allow a user to log out, terminating their session.
- **FR-AUTH-06:** The system shall enforce authorization on every protected route/action so that a user cannot access a module or record outside their permission level (per §2), regardless of how the URL is reached.
- **FR-AUTH-07:** The system shall lock or throttle an account after a configurable number of consecutive failed login attempts to mitigate brute-force attacks.
- **FR-AUTH-08:** The system shall provide a password-reset mechanism (assumption: admin-initiated reset or self-service via registered email — see Q5).
- **FR-AUTH-09:** The system shall require passwords to meet a minimum strength policy (length and complexity) at creation/change time.
- **FR-AUTH-10:** The system shall expire idle sessions after a configurable timeout and require re-authentication.

### 3.2 Dashboard (DASH)
A role-aware landing page summarizing the most relevant information and quick actions for the signed-in user.

- **FR-DASH-01:** The system shall present a dashboard whose content and widgets are determined by the user's role.
- **FR-DASH-02 (Principal):** The dashboard shall summarize school-wide metrics — total students, total teachers, number of classes, overall attendance rate (current term), and recent school-wide announcements — using charts (Recharts).
- **FR-DASH-03 (Secretary):** The dashboard shall surface administrative tasks — recent enrollments, students/classes needing setup, and quick links to add a student/teacher/class.
- **FR-DASH-04 (Teacher):** The dashboard shall show the teacher's classes, today's attendance status per class (recorded / not recorded), upcoming/recent assessments, and quick links to record attendance or enter grades.
- **FR-DASH-05 (Student):** The dashboard shall show the student's current classes, recent grades, attendance summary, upcoming assessments, and announcements targeted to them.
- **FR-DASH-06:** All dashboard data shall be scoped to the active academic year/term and to the user's permission level.

### 3.3 Students (STU)
Management of the student record and lifecycle.

- **FR-STU-01:** Authorized roles (Principal, Secretary) shall create a student record capturing at minimum: full name, unique student ID, date of birth, gender, enrollment date, status, guardian/contact details, and assigned class/section.
- **FR-STU-02:** The system shall enforce a unique student ID per student within the school.
- **FR-STU-03:** Authorized roles shall edit an existing student record.
- **FR-STU-04:** Authorized roles shall change a student's status (e.g., Active, Inactive, Transferred, Graduated, Withdrawn) rather than hard-deleting, to preserve historical academic records.
- **FR-STU-05:** The system shall support enrolling/assigning a student to **exactly one section** for the active term; that enrollment grants membership in all subjects taught in the section (D23). (Mid-term re-assignment to a different section is supported, but a student belongs to one section at a time.)
- **FR-STU-06:** The system shall provide a searchable, filterable, paginated list of students (by name, ID, class/section, status).
- **FR-STU-07:** The system shall display a student detail view aggregating profile, enrolled classes, grades, attendance, and assessments.
- **FR-STU-08:** Teachers shall view (read-only) the profiles of students enrolled in their own classes only.
- **FR-STU-09:** A student shall view their own profile (read-only) and shall not see other students' records.
- **FR-STU-10:** The system shall prevent deletion of a student who has associated grades or attendance records; such students may only be deactivated.

### 3.4 Teachers (TCH)
Management of teaching staff records.

- **FR-TCH-01:** Authorized roles shall create a teacher record capturing at minimum: full name, unique staff ID, email, subject specialization(s), status, and contact details.
- **FR-TCH-02:** The system shall enforce a unique staff ID and unique login email per teacher.
- **FR-TCH-03:** Authorized roles shall edit a teacher record; only the Principal shall deactivate/delete a teacher record or change their role.
- **FR-TCH-04:** The system shall support assigning a teacher to one or more **(section, subject) offerings** for the active academic year (a teacher may teach multiple subjects and/or multiple sections).
- **FR-TCH-05:** The system shall provide a searchable, filterable teacher directory.
- **FR-TCH-06:** The system shall prevent deletion of a teacher who is the assigned teacher of any active class; reassignment must occur first, or the teacher is deactivated.
- **FR-TCH-07:** Teachers shall view the teacher directory (read-only); Students shall have no access to the Teachers module.

### 3.5 Classes (CLS)
Setup and management of **sections** (a "class" = a SECTION/homeroom, e.g. "Form 1A"), the **subjects taught within each section**, the per-(section, subject) teacher assignments, and the section roster.

> **Terminology (D29 — subject-class model; supersedes D23).** A **class** in this system is a **SUBJECT CLASS**: one named group (e.g. "Math-1") teaching **exactly one subject**, scoped to one academic year, with **its own teacher(s)**, **its own room and weekly meeting times**, **its own gradebook/assessments** and **its own roster**. Two parallel classes of the same subject (Math-1, Math-2) are two separate classes with different teachers and timetable slots.
>
> A **student enrolls in EACH subject class individually** and therefore holds **many** concurrent enrollments — Freddy takes Math-1, Biology-10 and English-5; John takes Math-2, Biology-10 and English-5. They meet in Biology and English and never in Math. Enrolling a student into one class **never** removes them from another.
>
> The phrase "their classes" means **the subject classes they teach** for a Teacher, and **every subject class they are enrolled in** for a Student. A student's own level is `year_group` on their record ("Lower 6"), which is distinct from a class's `grade_level` (the level the class is *for*).

- **FR-CLS-01:** Authorized roles (Principal, Secretary) shall create a **subject class** capturing at minimum: class name (e.g. "Math-1"), **its subject (required)**, the year group it is for, academic year, and optionally a capacity, its teacher(s) and its weekly meeting times. A class without a subject cannot be graded, scheduled or enrolled into and shall be rejected.
- **FR-CLS-01a:** A subject class teaches **exactly one subject**, fixed at creation. The subject is not re-assignable afterwards — changing it would silently reinterpret every existing assessment and grade under the class; a different subject means a different class.
- **FR-CLS-02:** The system shall support enrolling and withdrawing students **per subject class**. A student holds **many** concurrent enrollments, one per class they take, and enrolling into one class shall **never** withdraw them from another.
- **FR-CLS-03:** The system shall support assigning one or more teachers (lead and/or co-teachers) to a **subject class**. All assigned teachers have full grade/attendance/assessment edit rights for that class (D-Q9).
- **FR-CLS-04:** The system shall display a **subject class** detail view: its roster, its subject and assigned teacher(s), its weekly schedule, and its assessment/grade/attendance summaries.
- **FR-CLS-05:** The system shall warn when a class roster exceeds the configured capacity but shall not hard-block (configurable — see Q6).
- **FR-CLS-06:** The system shall scope classes to the active academic year and prevent editing of classes belonging to a closed/archived academic year.
- **FR-CLS-07:** A Teacher shall see only the **subject classes they teach**; a Student shall see **every subject class they are enrolled in**.
- **FR-CLS-08:** The system shall prevent deletion of a class that has recorded grades or attendance; such classes may be archived instead.
- **FR-CLS-09:** The system shall record a student's own **year group** (e.g. "Lower 6") on their record, independent of the classes they take, and support filtering the student directory by it.

### 3.5a Timetable & Scheduling (SCH)
Weekly meeting times for each subject class, and the Mon–Fri timetable they produce (**D29**).

> A subject class meets at one or more **weekly slots**: an ISO weekday (Mon–Fri), a start and end time, and a room. Times are **free-form**, not slots in a fixed period grid — no bell schedule has to be configured before a class can be scheduled (stakeholder decision, 2026-08-06). A student's timetable is assembled from the classes they are enrolled in; a teacher's from the classes they teach.

- **FR-SCH-01:** The system shall display the weekly schedule of a subject class (day, start time, end time, room) to anyone who can read that class.
- **FR-SCH-02:** Authorized roles (Principal, Secretary) shall set a class's weekly schedule, replacing it as a whole so a retimed week cannot half-apply. An empty schedule is valid and means the class is not yet timetabled.
- **FR-SCH-03:** A Student shall see a **Mon–Fri timetable** assembled from every subject class they are enrolled in, showing subject, class name, teacher, room and times.
- **FR-SCH-04:** A Teacher shall see a **Mon–Fri timetable** of the classes they teach.
- **FR-SCH-05:** Principal and Secretary shall be able to view any student's timetable.
- **FR-SCH-06:** The system shall **report** scheduling conflicts — a teacher or room double-booked, or a student enrolled into a class that overlaps one they already sit — as **warnings that do not block the write**, consistent with the warn-only treatment of over-capacity enrollment (Q6). A class that is enrolled in but not yet timetabled shall be listed explicitly rather than omitted from the timetable.

### 3.6 Assessments (ASMT)
Creation and management of graded activities (quiz, test, exam, assignment) per **subject class**.

> An assessment belongs to exactly one **subject class** (D29), which already determines both the class and its subject. Math-1's gradebook is independent of Math-2's, even though both teach Mathematics.

- **FR-ASMT-01:** A Teacher shall create an assessment for a **(section, subject) offering they are assigned to teach**, capturing: title, type (quiz/test/exam/assignment), the offering (which fixes both section and subject), maximum score, weight/contribution to the term grade, and due/assessment date.
- **FR-ASMT-02:** The system shall validate that maximum score is a positive number and that weight values are non-negative.
- **FR-ASMT-03:** A Teacher shall edit or delete their own assessments, subject to FR-ASMT-07.
- **FR-ASMT-04:** The system shall list assessments per **(section, subject) offering** with status (e.g., Draft, Published, Grading, Graded).
- **FR-ASMT-05:** The system shall associate an assessment with exactly one **(section, subject) offering** and one academic term.
- **FR-ASMT-06:** Students shall view assessments for the subjects taught in their enrolled section (title, type, date, max score, and — once released — their own score).
- **FR-ASMT-07:** The system shall prevent deletion of an assessment that already has grades entered unless the grades are explicitly cleared first; the action shall require confirmation.
- **FR-ASMT-08:** Principal and Secretary shall view all assessments (read-only) for oversight.

### 3.7 Grades (GRD)
Entry and aggregation of student scores against assessments, with per-subject term grades.

> Grades are entered per **(section, subject) offering**: each subject taught in a section has its own gradebook. A student's term grade is computed **per subject within their section**; their report card lists one term grade per subject (D23).

- **FR-GRD-01:** A Teacher shall enter or update a score for each student in a **(section, subject) offering they are assigned to teach**, against a given assessment.
- **FR-GRD-02:** The system shall validate that an entered score is numeric, ≥ 0, and ≤ the assessment's maximum score.
- **FR-GRD-03:** The system shall derive a letter grade and/or percentage from the numeric score using the school's configured grading scale (Settings).
- **FR-GRD-04:** The system shall compute a per-student, **per-subject** term grade for each subject in the student's section, by aggregating that subject's assessment scores according to their weights.
- **FR-GRD-05:** The system shall let a **Teacher** mark an individual grade with a status — *pending (not yet graded), graded, absent, excused, or exempt* — for an assessment in a (section, subject) offering they teach, without forcing a zero. These markers are teacher-set and **persisted** with the grade. Their effect on aggregation (D25, reconciles OQ-DB7):
  - **Excused** → **always excluded** from the student's average (removed from both numerator and weight base), distinct from absent.
  - **Exempt** and **pending** → always excluded from the average (exempt removed from the weight base; pending not yet counted).
  - **Absent** → counts per the configured grading policy (e.g., as zero or excluded), resolved at compute time.
- **FR-GRD-11:** The system shall let a **Teacher** enable and configure **"drop-lowest"** (drop the N lowest scored results) for a (section, subject) offering they teach — per subject and/or per assessment category. This setting is **stored in the database** and **applied automatically** by the term-grade calculation. Excused/exempt/pending results are excluded before drop-lowest is applied. *(D25 — this is a teacher decision on offerings they own, not an admin-only setting.)*
- **FR-GRD-06:** The system shall record who entered/last modified a grade and when (auditing at the data level).
- **FR-GRD-07:** A Student shall view their own grades per assessment and their term grade once released, and shall not see other students' grades.
- **FR-GRD-08:** Principal and Secretary shall view grades across all classes (read-only).
- **FR-GRD-09:** The system shall support a grade-release control so a Teacher can enter grades privately and then release them to students.
- **FR-GRD-10:** The system shall prevent a Teacher from entering grades for a **(section, subject) offering** they are not assigned to teach.

### 3.8 Attendance (ATT)
Recording and reviewing student attendance per **section** per day.

> Attendance is taken **per subject class**, once per day (D-Q4), against that class's roster (**D29**). Each teacher records the register for the classes they teach, so a student can be present in Biology and absent in Math on the same day. It used to be taken once per day at the homeroom level; with no homeroom, the subject class is the only roster there is.

- **FR-ATT-01:** A Teacher shall record attendance for each student in a **section** for a given date, choosing a status (e.g., Present, Absent, Late, Excused).
- **FR-ATT-02:** The system shall default all students to "Present" on a fresh attendance sheet, allowing the teacher to mark exceptions.
- **FR-ATT-03:** The system shall prevent duplicate attendance records for the same student, section, and date; re-recording shall update the existing record.
- **FR-ATT-04:** The system shall allow editing of a previously recorded attendance entry, recording who changed it and when.
- **FR-ATT-05:** The system shall not allow recording attendance for a future date.
- **FR-ATT-06:** The system shall compute attendance summaries (e.g., % present) per student, per section, and per term.
- **FR-ATT-07:** A Student shall view their own attendance history and summary; Principal and Secretary shall view attendance across all sections.
- **FR-ATT-08:** The system shall indicate on the Teacher dashboard which of the teacher's sections still need attendance recorded for the current day.
- **FR-ATT-09:** The system shall prevent a Teacher from recording attendance for a section they are not assigned to (i.e., a section in which they teach no subject).

### 3.9 Announcements (ANN)
One-way broadcast communication, school-wide or class-scoped.

- **FR-ANN-01:** Principal and Secretary shall create school-wide announcements with a title, body, target audience (all, students, teachers, or a specific class/grade), and publish date.
- **FR-ANN-02:** A Teacher shall create announcements scoped to their own class(es) only.
- **FR-ANN-03:** The system shall display to each user only the announcements targeted to their role/class/self, ordered most-recent-first.
- **FR-ANN-04:** The author (and Principal) shall edit or delete an announcement they are authorized over.
- **FR-ANN-05:** The system shall support an optional expiry date after which an announcement is no longer shown.
- **FR-ANN-06:** The system shall timestamp each announcement and display the author.
- **FR-ANN-07:** A Teacher shall not create a school-wide announcement; a Student shall not create any announcement.

### 3.10 Reports (RPT)
Aggregated, chart-supported reporting and printable outputs.

- **FR-RPT-01:** The system shall generate a per-student **report card** for a selected term: the student's **section**, **all subjects taught in that section** with each subject's assessment scores and per-subject term grade (numeric + letter), the section-level attendance summary, and school identity (Settings).
- **FR-RPT-02:** The system shall generate a **subject grade summary** report for a **(section, subject) offering**: per-student term grades and the offering's class average, with a chart (Recharts).
- **FR-RPT-03:** The system shall generate an **attendance summary** report per class and per term.
- **FR-RPT-04:** The system shall generate **enrollment/headcount** reports (students per class/grade, totals) for Principal and Secretary.
- **FR-RPT-05:** Report scope shall respect role permissions: a Teacher sees only their classes/students; a Student sees only their own report card; Principal/Secretary see school-wide.
- **FR-RPT-06:** The system shall support printing/exporting a report card to a print-friendly format (assumption: browser print / PDF — see Q8).
- **FR-RPT-07:** Reports shall be filterable by academic year and term.

#### Transcript (TRN) — multi-year academic record (D24; visibility per D26)
A **transcript** compiles a student's **complete academic record across ALL academic years**, assembled from archived-year snapshots plus the current (live) year. It is distinct from a single-term report card (FR-RPT-01): a report card is one term; a transcript is the student's full history.

> **Visibility (D26 — resolves OQ-TRN).** The compiled multi-year transcript is an **administrative artifact available to Principal and Secretary ONLY**. **Teachers** have **no** transcript access (they see only the grades in their own (section, subject) gradebook). **Students** do **not** receive the compiled transcript in v1 — they keep their own per-term report card (FR-RPT-01) and their own grades (FR-GRD-07). A student-facing transcript is a possible later enhancement.

- **FR-TRN-01:** The system shall generate a per-student **multi-year transcript** spanning all academic years in which the student has a record, assembled from **archived-year frozen snapshots** plus the **current/active year computed live**.
- **FR-TRN-02:** The transcript shall be organized by **academic year → semester → subject**, listing for each (year, semester, subject) the **per-subject term grade (numeric + letter)** as recorded under the grading scale/policy **in force at that time** (archived years reflect their frozen scale; the live year reflects the current scale).
- **FR-TRN-03:** The transcript shall present, per academic year and/or overall, a summary line (e.g., overall average across subjects) computed consistently with the per-subject term grades shown.
- **FR-TRN-04:** Transcript subject identity shall remain stable across years even if a subject is later renamed/retired or a section/offering is archived or soft-deleted, so that historical transcript lines never become unresolvable.
- **FR-TRN-05:** Transcript visibility is restricted to administrators (D26), consistent with the §2 matrix:
  - **Principal and Secretary** may view the transcript of **any** student (school-wide, read-only).
  - A **Teacher** shall have **no** access to the compiled transcript — neither their own students' nor anyone else's. Teachers see only the grades in the (section, subject) gradebooks they are assigned to (FR-GRD-01, FR-GRD-08 scope).
  - A **Student** shall have **no** access to the compiled multi-year transcript in v1; the system shall not expose a transcript endpoint/screen to students. Students retain their own report card (FR-RPT-01) and own grades (FR-GRD-07).
- **FR-TRN-06:** The system shall support printing/exporting the transcript to a print-friendly format (browser print / PDF), consistent with FR-RPT-06, Q8, and OQ-A.
- **FR-TRN-07:** A transcript generated for a student with **no archived years yet** shall still render from the current/active year alone (graceful single-year transcript), and an empty transcript (no records at all) shall show a clear empty state rather than an error.

### 3.11 Settings (SET)
School-level configuration and per-user account settings.

- **FR-SET-01:** The Principal shall configure the **school profile**: name, logo, address, contact details, used in report headers and branding.
- **FR-SET-02:** The Principal shall configure the **academic structure**: academic year, terms/semesters, and the active term.
- **FR-SET-03:** The Principal shall configure the **grading scale**: numeric thresholds mapped to letter grades and pass/fail boundaries.
- **FR-SET-04:** The Principal shall manage user accounts and role assignments; the Secretary shall have a limited subset of administrative configuration (no role changes, no grading-scale changes).
- **FR-SET-05:** Every user shall manage their own account settings: change password, update contact info, and set display preferences (e.g., language — see §6).
- **FR-SET-06:** Changes to the grading scale shall apply to grade derivation going forward and shall warn the administrator about effects on already-displayed grades (assumption: re-derivation behavior to confirm — see Q7).
- **FR-SET-07:** The system shall prevent deletion/closure of the active academic year while it is in use; closing a year shall archive its classes, grades, and attendance read-only.

### 3.12 Calendar / Events (CAL)

> **Scope addition, 2026-07.** Not part of the original 11-module charter. Added because
> the shipped frontend already contained a full calendar and the `events` table already
> existed in the database — see `project-now.md` §4 for the provenance. Documented
> here so the module has requirements like every other one.

- **FR-CAL-01:** The Principal and Secretary shall create, edit and delete school
  calendar events, each with a title, optional description, category
  (holiday / exam / meeting / activity / other), location, and an inclusive date range.
- **FR-CAL-02:** An event shall be either **all-day** or **timed**; a timed event shall
  require a start time, and an end time (when given) shall be after the start time.
  Switching an event to all-day shall clear its clock times.
- **FR-CAL-03:** Each event shall carry a **visibility**: `global` events are visible to
  every role; `internal` events are visible to staff only (Principal, Secretary,
  Teacher) and shall be hidden from Students — including by direct lookup.
- **FR-CAL-04:** Teachers and Students shall **read** the shared school calendar but
  shall not create, edit or delete events.
- **FR-CAL-05:** The calendar feed shall report a server-side **reference date** in the
  school's local timezone (`America/Belize`), so the month view opens on the correct
  month independently of the client clock (see OQ-TZ1 in the progress tracker).

**Roles × Calendar:** Principal `full` · Secretary `full` · Teacher `view-all` ·
Student `view-all` (global-visibility events only). Matches the frontend's
`PERMISSION_MATRIX.calendar`.

---

## 4. User Stories

> Format: `US-<ROLE>-NN: As a <role>, I want <capability> so that <benefit>.`

### 4.1 Principal (PRIN)
- **US-PRIN-01:** As a Principal, I want a school-wide dashboard with key metrics and charts so that I can monitor the school's health at a glance.
- **US-PRIN-02:** As a Principal, I want to configure the academic year, terms, and grading scale so that the whole system operates on consistent academic rules.
- **US-PRIN-03:** As a Principal, I want to manage user accounts and assign roles so that staff and students have the correct access.
- **US-PRIN-04:** As a Principal, I want to view all students', teachers', classes', grades', and attendance data so that I have full oversight without editing operational records.
- **US-PRIN-05:** As a Principal, I want to post and remove school-wide announcements so that I can communicate with the whole school.
- **US-PRIN-11:** As a Principal or Secretary, I want to set each subject class's weekly meeting times and room, and be warned (not blocked) when a teacher, room or student is double-booked, so that the timetable is workable. *(D29 — FR-SCH-02/05/06.)*
- **US-PRIN-06:** As a Principal, I want to generate school-wide reports (enrollment, grade summaries, attendance) so that I can make informed decisions and report to stakeholders.
- **US-PRIN-07:** As a Principal, I want to configure the school profile and logo so that reports and the system reflect our school's identity.
- **US-PRIN-08:** As a Principal, I want to deactivate (not delete) staff and students so that historical academic records are preserved.
- **US-PRIN-09:** As a Principal, I want to view any student's report card so that I can address academic concerns.
- **US-PRIN-10:** As a Principal, I want to view and print any student's multi-year transcript so that I can review their full academic history (e.g., for promotion, references, or graduation).

### 4.2 Secretary (SEC)
- **US-SEC-01:** As a Secretary, I want to enroll new students with their full profile so that they are registered and assignable to classes.
- **US-SEC-02:** As a Secretary, I want to create and edit teacher records so that staff are correctly registered.
- **US-SEC-03:** As a Secretary, I want to set up classes/sections and assign teachers and subjects so that the term is ready to operate.
- **US-SEC-04:** As a Secretary, I want to assign and move students between classes so that rosters stay accurate.
- **US-SEC-05:** As a Secretary, I want to search and filter students and teachers so that I can quickly find and update a record.
- **US-SEC-06:** As a Secretary, I want to post school-wide announcements so that I can broadcast administrative notices.
- **US-SEC-07:** As a Secretary, I want to view grades and attendance across the school so that I can produce administrative reports.
- **US-SEC-08:** As a Secretary, I want to update a student's status (transfer, withdraw, graduate) so that records reflect reality without losing history.
- **US-SEC-09:** As a Secretary, I want an admin dashboard highlighting setup tasks so that I know what still needs attention.
- **US-SEC-10:** As a Secretary, I want to view and print any student's multi-year transcript so that I can produce official academic records on request.

### 4.3 Teacher (TCH)
- **US-TCH-01:** As a Teacher, I want to see my classes and today's outstanding tasks on my dashboard so that I know what to do first.
- **US-TCH-02:** As a Teacher, I want to record daily attendance for my class so that absences are tracked accurately.
- **US-TCH-03:** As a Teacher, I want to correct a previously recorded attendance entry so that mistakes can be fixed with an audit trail.
- **US-TCH-04:** As a Teacher, I want to create assessments (quizzes, tests, exams, assignments) for my class so that I can grade student work.
- **US-TCH-05:** As a Teacher, I want to enter and update scores per student per assessment so that grades are captured.
- **US-TCH-06:** As a Teacher, I want term grades to be auto-calculated from weighted assessments so that I don't compute them by hand.
- **US-TCH-07:** As a Teacher, I want to enter grades privately and then release them so that students only see finalized results.
- **US-TCH-08:** As a Teacher, I want to view the profiles of students in my classes so that I have context on whom I'm teaching.
- **US-TCH-09:** As a Teacher, I want to post announcements to my class so that I can communicate with my students.
- **US-TCH-10:** As a Teacher, I want a Mon–Fri timetable of the classes I teach, with room and time, so that I know where to be. *(D29 — FR-SCH-04.)*
- **US-TCH-10:** As a Teacher, I want to view grade and attendance summaries for my classes so that I can identify struggling students.
- **US-TCH-11:** As a Teacher, I want to print/export report data for my students so that I can share results.

### 4.4 Student (STD)
- **US-STD-01:** As a Student, I want to log in securely so that only I can see my academic data.
- **US-STD-02:** As a Student, I want a dashboard summarizing my grades, attendance, upcoming assessments, and announcements so that I stay informed.
- **US-STD-03:** As a Student, I want to view every subject class I am enrolled in — with its teacher, room and times — so that I know my courses. *(D29 — a student now takes several classes, not one homeroom.)*
- **US-STD-03a:** As a Student, I want a **Mon–Fri timetable** built from my subject classes so that I know where to be each day. *(D29 — FR-SCH-03.)*
- **US-STD-04:** As a Student, I want to view my grades per assessment and my term grade so that I can track my performance.
- **US-STD-05:** As a Student, I want to view my attendance history and summary so that I can monitor my attendance.
- **US-STD-06:** As a Student, I want to view upcoming and past assessments for my classes so that I can prepare.
- **US-STD-07:** As a Student, I want to read announcements targeted to me so that I don't miss school or class notices.
- **US-STD-08:** As a Student, I want to view and print my report card so that I have a record of my results.
- **US-STD-09:** As a Student, I want to update my password and contact info so that my account stays secure and current.

> _US-STD-10 (student multi-year transcript) was removed per D26 — the compiled multi-year transcript is Principal/Secretary-only in v1. Students retain their own per-term report card (US-STD-08) and grades (US-STD-04)._

---

## 5. Acceptance Criteria (Core Flows)

> Given/When/Then format, grouped under the story IDs they validate.

### 5.1 Authentication / Login — validates US-STD-01 (and login for all roles), FR-AUTH-01..10
- **Given** a registered user with valid credentials, **When** they submit the correct identifier and password, **Then** a session is established and they land on the dashboard matching their role.
- **Given** a user submits an incorrect password, **When** they attempt to log in, **Then** access is denied with a generic "invalid credentials" message that does not reveal whether the identifier exists.
- **Given** a user has failed login N consecutive times (N = configured threshold), **When** they attempt again, **Then** the account is temporarily locked/throttled and the user is informed.
- **Given** an authenticated Student, **When** they manually navigate to an admin-only URL (e.g., Settings or another student's record), **Then** access is denied/redirected and no protected data is returned.
- **Given** an authenticated session left idle beyond the timeout, **When** the user performs an action, **Then** they are required to re-authenticate.
- **Given** a logged-in user, **When** they choose log out, **Then** the session is terminated and protected pages are no longer accessible without logging in again.

### 5.2 Recording Attendance — validates US-TCH-02, US-TCH-03, FR-ATT-01..09
- **Given** a Teacher assigned to a class, **When** they open the attendance sheet for today, **Then** every enrolled student is listed and defaulted to "Present."
- **Given** the attendance sheet is open, **When** the Teacher marks some students Absent/Late/Excused and saves, **Then** the records are persisted with the correct statuses, date, class, and recording teacher.
- **Given** attendance was already recorded for that class and date, **When** the Teacher saves again, **Then** the existing records are updated (no duplicates) and the change is timestamped with the editor's identity.
- **Given** a Teacher selects a future date, **When** they try to record attendance, **Then** the system blocks the action and explains that future dates are not allowed.
- **Given** a Teacher is not assigned to a class, **When** they attempt to record that class's attendance, **Then** the action is denied.
- **Given** attendance exists for a term, **When** a summary is requested, **Then** the system shows an accurate percent-present per student and per class.

### 5.3 Creating an Assessment — validates US-TCH-04, FR-ASMT-01..07
- **Given** a Teacher on one of their classes, **When** they create an assessment with title, type, max score, weight, and date, **Then** the assessment is saved and linked to that class, subject, and the active term.
- **Given** the Teacher enters a non-positive maximum score or a negative weight, **When** they submit, **Then** validation blocks the save with a clear field-level message.
- **Given** an assessment has no grades yet, **When** the Teacher deletes it, **Then** it is removed after a confirmation prompt.
- **Given** an assessment already has grades entered, **When** the Teacher attempts to delete it, **Then** the system blocks deletion until the grades are explicitly cleared.
- **Given** a Teacher tries to create an assessment for a class they do not teach, **When** they submit, **Then** the action is denied.

### 5.4 Entering Grades — validates US-TCH-05, US-TCH-06, US-TCH-07, FR-GRD-01..11
- **Given** a published assessment with max score M, **When** the Teacher enters a score S for a student where 0 ≤ S ≤ M, **Then** the score is saved and a letter grade/percentage is derived from the configured grading scale.
- **Given** the Teacher enters a score greater than M or a negative/non-numeric value, **When** they submit, **Then** validation blocks the entry with a clear message.
- **Given** multiple weighted assessments exist for a class, **When** scores are entered, **Then** the student's term grade is recalculated according to assessment weights.
- **Given** a Teacher marks a grade **"excused"** on an assessment, **When** the term grade is computed, **Then** that result is **always excluded** from the student's average (removed from numerator and weight base), regardless of grading policy (D25, FR-GRD-05).
- **Given** a student is marked **"exempt"** (or a result is still **"pending"**) on an assessment, **When** the term grade is computed, **Then** that assessment is excluded from the average (exempt removed from the weight base; pending not yet counted) (FR-GRD-05).
- **Given** a Teacher has enabled **drop-lowest = N** for their (section, subject) offering/category, **When** the term grade is computed, **Then** the stored setting is applied automatically — the N lowest scored results are dropped after excused/exempt/pending are excluded (FR-GRD-11).
- **Given** a Teacher enters grades with release turned off, **When** a Student views the assessment, **Then** the score is not visible until the Teacher releases it.
- **Given** a Teacher modifies a saved grade, **When** the change is saved, **Then** the system records who changed it and when.

### 5.5 Viewing a Report Card — validates US-STD-08, US-PRIN-09, US-TCH-11, FR-RPT-01, FR-RPT-05, FR-RPT-06
- **Given** a Student with released grades for the selected term, **When** they open their report card, **Then** it shows their classes/subjects, assessment scores, term grades (numeric + letter), attendance summary, and the school's identity/branding.
- **Given** a Student views report cards, **When** they request the page, **Then** only their own report card is accessible and no other student's data is reachable.
- **Given** a Teacher, **When** they open report cards, **Then** only students in their own classes are listed.
- **Given** any authorized viewer, **When** they choose print/export, **Then** a print-friendly version of the report card is produced (browser print/PDF per Q8).
- **Given** grades for the selected term have not been released, **When** the Student opens the report card, **Then** unreleased items are hidden or marked "pending" rather than shown.

### 5.6 Posting an Announcement — validates US-PRIN-05, US-SEC-06, US-TCH-09, FR-ANN-01..07
- **Given** a Principal or Secretary, **When** they create an announcement with a title, body, and target audience (all/students/teachers/specific class), **Then** it is published and visible only to the targeted users, most-recent-first.
- **Given** a Teacher, **When** they create an announcement, **Then** they may only target their own class(es), and the option to broadcast school-wide is unavailable.
- **Given** an announcement has an expiry date, **When** that date passes, **Then** the announcement no longer appears to recipients.
- **Given** a Student, **When** they open Announcements, **Then** they see only announcements targeted to them and cannot create one.
- **Given** an author or the Principal, **When** they edit or delete an announcement they own, **Then** the change takes effect for all recipients.

### 5.7 Enrolling a Student — validates US-SEC-01, US-PRIN-08, FR-STU-01..05, FR-STU-10
- **Given** a Secretary or Principal, **When** they create a student with the required fields and a unique student ID, **Then** the record is saved with status "Active" and is assignable to classes.
- **Given** a student ID that already exists, **When** the user submits, **Then** the system blocks the save and reports the duplicate.
- **Given** a new student, **When** the user assigns them to one or more classes for the active year, **Then** the student appears on those class rosters.
- **Given** a student with existing grades or attendance, **When** a user attempts to delete them, **Then** deletion is blocked and only a status change (e.g., Withdrawn/Transferred) is permitted.
- **Given** a class roster at or above capacity, **When** the user adds another student, **Then** the system warns about the over-capacity condition (and allows or blocks per Q6).

### 5.8 Viewing a Multi-Year Transcript — validates US-PRIN-10, US-SEC-10, FR-TRN-01..07
- **Given** a student with records spanning multiple academic years (some archived, plus the current year), **When** a Principal or Secretary opens that student's transcript, **Then** it lists every academic year → semester → subject with the per-subject term grade (numeric + letter), pulling archived years from their frozen snapshots and the current year from live computation.
- **Given** a subject was renamed or retired, or a past section/offering was archived/soft-deleted, **When** an older transcript line for that subject is rendered, **Then** the line still resolves to the subject identity and grade as recorded then (FR-TRN-04), and is not dropped or shown as broken.
- **Given** a Principal or Secretary, **When** they open any student's transcript, **Then** the full school-wide multi-year record is shown read-only.
- **Given** a Teacher, **When** they attempt to reach any transcript (UI or direct URL), **Then** access is denied — Teachers have no transcript access (D26, FR-TRN-05).
- **Given** a Student, **When** they attempt to reach a transcript (UI or direct URL), **Then** access is denied — the compiled transcript is not exposed to students in v1 (D26); their report card (§5.5) and grades remain available.
- **Given** a student who has only a current/active year (no archived years yet), **When** the transcript is requested by an admin, **Then** it renders from the live year alone without error; a student with no records at all shows a clear empty state.
- **Given** a Principal or Secretary, **When** they choose print/export, **Then** a print-friendly version of the transcript is produced (browser print/PDF per Q8/OQ-A).

---

## 6. Non-Functional Requirements (NFR)

- **NFR-USE-01 (Usability):** Common role tasks (record attendance, enter grades, enroll a student) shall be completable in a small number of steps with clear navigation; the UI shall follow consistent MUI patterns.
- **NFR-USE-02 (Feedback & errors):** Every action shall give clear success/error feedback; destructive actions shall require confirmation; validation errors shall be field-level and human-readable.
- **NFR-USE-03 (Empty states):** Lists and dashboards shall present helpful empty states (e.g., "No assessments yet — create one").
- **NFR-PERF-01 (Performance):** Typical list and dashboard views shall load within ~2 seconds for a school of up to ~2,000 students and ~150 staff on a normal broadband connection (target, to be validated in Phase 8).
- **NFR-PERF-02 (Pagination):** Large lists (students, attendance history) shall be paginated/virtualized; the system shall not load entire datasets into the browser at once.
- **NFR-PERF-03 (Responsiveness of data):** Server-state caching/invalidation (TanStack Query) shall keep views fresh after writes without full page reloads.
- **NFR-A11Y-01 (Accessibility):** The UI shall target **WCAG 2.1 Level AA**: keyboard navigability, sufficient color contrast, focus indicators, form labels, and screen-reader-friendly semantics.
- **NFR-A11Y-02:** Charts (Recharts) shall have accessible text/table equivalents for non-visual users.
- **NFR-SEC-01 (Authorization):** Authorization shall be enforced server-side on every protected action; client-side hiding of controls is a UX aid, not a security boundary.
- **NFR-SEC-02 (Student data privacy):** Student records and grades are sensitive PII; access shall follow least privilege per §2, data shall be encrypted in transit (HTTPS) and at rest (Phase 2), and student data shall not be exposed across student boundaries.
- **NFR-SEC-03 (Credentials):** Passwords shall be stored only as salted hashes; no plaintext credentials in logs or storage.
- **NFR-SEC-04 (Auditability):** Grade and attendance mutations shall record actor and timestamp.
- **NFR-COMP-01 (Browser support):** The application shall support current versions of evergreen browsers (Chrome, Edge, Firefox, Safari); IE is not supported.
- **NFR-RESP-01 (Responsive):** The UI shall be responsive and usable on desktop, tablet, and mobile-web viewports (teachers may record attendance on a tablet/phone).
- **NFR-LOC-01 (Localization):** The system shall support a localizable UI (externalized strings) with English as the default; date, number, and grade formatting shall be locale-aware. Multi-language content authoring is out of scope for v1 but the architecture should not preclude it.
- **NFR-MAINT-01 (Maintainability):** Code shall adhere to the fixed stack (React + TypeScript + MUI + React Router + TanStack Query + Recharts) and be typed end-to-end.

---

## 7. Assumptions

> Each is confirmable yes/no. Items that materially affect later phases are flagged **[architecture-impacting]**.

1. **A-SINGLE-SCHOOL [architecture-impacting]:** v1 serves a **single school** (one tenant). Multi-school/multi-tenant is out of scope. *(See Q1.)*
2. **A-ONE-ROLE:** Each user has exactly **one** role. A person who is both (e.g., a teacher who is also a parent) is not modeled; no multi-role users in v1.
3. **A-ACADEMIC-STRUCTURE:** The academic calendar is structured as one **academic year** divided into **terms/semesters** (e.g., 3 terms or 2 semesters, configurable). One academic year and one term are "active" at a time.
4. **A-GRADING-SCALE:** Grading uses a **numeric score with a derived letter grade** (e.g., A/B/C/D/F) via configurable thresholds, plus a pass/fail boundary. Default scale to be confirmed.
5. **A-WEIGHTED-GRADES:** Term grades are computed as a **weighted aggregate** of assessment scores; weights are set per assessment.
6. **A-SUBJECT-CLASS-MODEL [architecture-impacting]:** A **"class" is a SUBJECT CLASS** (e.g. "Math-1"): one subject, its own teacher(s), room, weekly meeting times, gradebook and roster. The office creates subject classes and **enrolls each student into the ones they take**, so two students in the same year group can sit different Math classes while sharing Biology. *(Confirmed — **D29**; supersedes A-SECTION-MODEL / D23, which modelled a class as a homeroom teaching many subjects with one roster.)*
7. **A-SIXTH-FORM:** The target is a **sixth form / junior college** operating on the university pattern above — students move between rooms per subject. *(Confirmed — D29; supersedes A-K12-SECONDARY.)*
8. **A-NO-PARENT-PORTAL:** Parents/guardians are **contact data on the student record**, not system users. No parent logins in v1.
9. **A-IN-APP-ANNOUNCEMENTS:** Announcements are **shown in-app only**; no email/SMS/push delivery in v1.
10. **A-SOFT-DELETE:** Students, teachers, and sections with academic history are **deactivated/archived, not hard-deleted**, to preserve records.
11. **A-GRADE-EXEMPT:** "Exempt" and "excused" assessment markers are **removed from the weight base** when computing term grades (rather than scored as zero); these markers are **teacher-set and persisted**, and "drop-lowest" is a **teacher-configured, stored** per-(section, subject)/category setting applied automatically by the grade calculation. *(Confirmed — D25; supersedes Q7/OQ-DB7.)*
12. **A-ATTENDANCE-DAILY:** Attendance is recorded **per section per day** by default; per-period attendance is a possible later enhancement, not assumed in v1 unless confirmed. *(See Q4.)*
13. **A-ACCOUNT-PROVISIONING [architecture-impacting]:** User accounts (including student/teacher logins) are **provisioned by administrators** (Principal/Secretary); there is no public self-registration.
14. **A-PRINT-PDF:** Report-card and transcript "export" is satisfied by a **print-friendly view / browser PDF** in v1; server-generated PDF is a possible enhancement. *(See Q8.)*
15. **A-DATA-PRIVACY-PENDING [architecture-impacting]:** The data-residency/compliance regime (e.g., Belize student-data rules) is **not yet confirmed**; v1 assumes general best-practice PII handling until confirmed. *(Open Issue O2 → Q2.)*
16. **A-TRANSCRIPT-MULTI-YEAR [architecture-impacting]:** A **multi-year transcript is a v1 feature** (D24), assembled from archived-year frozen snapshots plus the current year, organized by year → semester → subject. *(Confirmed — D24.)*
17. **A-TRANSCRIPT-ADMIN-ONLY:** The compiled multi-year transcript is **visible to Principal and Secretary only** (D26). **Teachers** have no transcript access (only their own gradebooks); **Students** do not get the compiled transcript in v1 (they keep their report card + grades). *(Confirmed — D26; resolves OQ-TRN, reverses the earlier teacher-scope assumption.)*

---

## 8. Open Questions for Stakeholder

> Blocking items should be answered before Phase 2 (Architecture) locks decisions.

- **Q1 (Blocking) — Single-school vs. multi-tenant:** Will this system ever host **more than one school** (district / SaaS model), or is it strictly **single-school**? This decision drives data isolation, the data model, and auth design in Phase 2. *(Relates to assumption A-SINGLE-SCHOOL.)*
- **Q2 (Blocking) — Data residency & compliance (Open Issue O2):** What **data-privacy/compliance regime** governs student data (e.g., Belize national requirements, data-residency/hosting location, retention rules, consent)? This affects hosting region, encryption, retention, and audit requirements in Phase 2. *(Carries forward progress-tracker Open Issue O2.)*
- **Q3 (Blocking) — Academic structure & grading scale:** Confirm the **number of terms/semesters** per year and the **exact grading scale** (numeric ranges → letter grades, pass mark, GPA vs. percentage). Needed for Grades, Reports, and Settings.
- **Q4 (Non-blocking) — Attendance granularity:** Is attendance **once per day per class**, or **per period/subject**? Affects the Attendance and Classes data model.
- **Q5 (Non-blocking) — Password reset flow:** Should password reset be **self-service via email** or **admin-initiated only**? Email self-service implies an email-delivery dependency.
- **Q6 (Non-blocking) — Class capacity enforcement:** When a class exceeds capacity, should the system **warn-only** or **hard-block** enrollment?
- **Q7 (Non-blocking) — Grade re-derivation & exemptions:** When the **grading scale changes**, should already-entered grades be **re-derived**? And confirm the handling of **exempt/absent** markers in term-grade aggregation (assumption A-GRADE-EXEMPT).
- **Q8 (Non-blocking) — Report export format:** Is a **browser-printable / PDF** report card sufficient for v1, or is **server-generated, official PDF** (with signatures/letterhead) required?
- **Q9 (Non-blocking) — Co-teachers & shared classes:** Can a class have **multiple teachers** (co-teaching / subject teachers), and if so, do all of them get grade/attendance edit rights? *(Resolved — D-Q9: yes, all assigned teachers of a (section, subject) offering get full edit rights.)*
- **OQ-TRN — ✅ RESOLVED (D26): Transcript is Principal/Secretary-only.** Teachers have no transcript access; Students do not get the compiled transcript in v1. *(See A-TRANSCRIPT-ADMIN-ONLY, FR-TRN-05.)*

---

_End of Phase 1 requirements. Next: Orchestrator review → update `complete-work.md` → Phase 2 (Architecture). Per orchestration principles, do not build ahead._

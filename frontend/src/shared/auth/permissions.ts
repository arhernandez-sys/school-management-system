/**
 * Central permission map — mirrors the requirements §2 role × module matrix
 * (architecture.md §3.2, ui-design-system.md §3.2).
 *
 * ⚠️ SECURITY BOUNDARY NOTE: This map is for UX ONLY — it hides nav items and
 * controls a user cannot use. It is NOT the security boundary. The server
 * re-checks role + ownership on EVERY protected call (NFR-SEC-01). Never rely on
 * this map to protect data; it only shapes what the SPA renders.
 */

import type { Role } from '../types/enums';

/** The functional modules (+ the student-only "My Profile") that gate navigation. */
export type ModuleKey =
  | 'dashboard'
  | 'students'
  | 'teachers'
  /** Scheduled COURSE OFFERINGS (D31, was `classes`) — see `courses` below. */
  | 'offerings'
  /**
   * The COURSE CATALOG (D30) — course code, name, credits, component, prerequisites.
   * Distinct from `offerings`, which is a scheduled offering OF a catalog course.
   *
   * Dean-only to write, per brief §6: "Only the Dean should have permission to create,
   * edit, or delete academic courses." The Registrar still schedules offerings and
   * enrols students; they just cannot change the catalog itself.
   *
   * D44 — this IS a nav module now. It was the Settings → Courses tab; it is now the
   * "Courses" group in the main menu, which collapses to reveal Course Offerings.
   *
   * ⚠️ It also gates PROGRAMMES, which looks arbitrary and is not: `programs` below is
   * `'view-all'` for EVERY role, so gating the Programmes nav entry on its own module
   * would put it in front of Lecturers and Students. `courses` is `'none'` for exactly
   * those two, which is the line actually wanted.
   */
  | 'courses'
  /**
   * PROGRAMMES / STUDIES and their curriculum (D30 §D3) — the eight BAJC
   * Associate-degree programmes and the course sequence each prescribes.
   *
   * Dean-only to write, same authority as `courses` and for the same reason: what a
   * programme REQUIRES is academic structure, not administration. The Registrar still
   * enrols students and schedules offerings.
   *
   * Reading is open wider than `courses` is — a programme's plan is published
   * prospectus material, and Phase 4's student academic-history screens read it.
   */
  | 'programs'
  /**
   * ADMISSIONS (D30 §D11) — the application record, Sections A–G, and the decision that
   * turns an applicant into a student.
   *
   * **Registrar + Dean**, confirmed with the client: filing, editing, accepting and
   * denying an application is administration, and §D14 leaves the Registrar students,
   * applications and enrolment. Approving a CREDIT TRANSFER inside it is Dean-only
   * (brief §13) — enforced server-side, and the panel hides the decision controls.
   *
   * A Lecturer and a student have NO access: an application is another person's PII and
   * a Lecturer has no reason to read one.
   */
  | 'applications'
  /** Student / teacher Mon–Fri week (D29). Staff have no personal timetable. */
  | 'timetable'
  | 'assessments'
  | 'grades'
  | 'attendance'
  | 'announcements'
  | 'calendar'
  | 'reports'
  | 'settings'
  // D43 — the sensitive-action trail. Its own key rather
  // than a corner of `settings`, because its readers are not the settings writers: the
  // Registrar administers the school and is one of the people the log is ABOUT.
  | 'audit'
  | 'profile';

/** Capability level a role has within a module (requirements §2 legend). */
export type Capability = 'full' | 'create-edit' | 'view-all' | 'view-own' | 'none';

/**
 * role → module → capability. `'none'` means hidden + route-guarded.
 * Source of truth: requirements.md §2 matrix.
 */
export const PERMISSION_MATRIX: Record<Role, Record<ModuleKey, Capability>> = {
  principal: {
    dashboard: 'view-all',
    students: 'full',
    teachers: 'full',
    offerings: 'full',
    courses: 'full', // the Dean owns the catalog…
    programs: 'full', //  …and the studies (D30 §D14)
    applications: 'full', // the Dean may admit too, and decides every credit transfer
    // No PERSONAL timetable for staff: they neither take nor teach a course, and
    // `GET /timetable/me` correctly answers an empty week for them. Meeting times are
    // managed per offering (Course Offerings → Schedule tab), which `offerings: 'full'`
    // already covers.
    timetable: 'none',
    // Product decision (2026-07): Assessments are folded into Grades (subject cards →
    // drill-down). Staff manage assessments there, so the standalone nav is hidden.
    assessments: 'none',
    grades: 'view-all',
    attendance: 'view-all',
    announcements: 'full',
    calendar: 'full', // owns the shared school calendar
    reports: 'view-all',
    settings: 'full',
    audit: 'view-all', // the Dean reads the trail; nobody writes it
    profile: 'none', // Principal has no student "My Profile"; account is under Settings
  },
  secretary: {
    dashboard: 'view-all',
    students: 'full',
    teachers: 'create-edit',
    offerings: 'create-edit', // Registrar schedules offerings…
    courses: 'view-all', //  …but cannot edit the catalog (D30, brief §6)
    programs: 'view-all', //  …nor define what a programme requires
    applications: 'full', // the Registrar owns admissions (D30 §D14)
    timetable: 'none', // see the principal note
    assessments: 'none', // folded into Grades (see principal note)
    /**
     * D32 (brief §4) — **the Register lost grades outright**, and unconditionally: there
     * is no Dean toggle for this the way there is for students, because the client asked
     * for the removal rather than for a switch. `Role.SECRETARY` is absent from every
     * grade route in `grades/router.py`, so this is the nav catching up with the server.
     *
     * Deliberately NOT extended to `reports`: the brief named the Grades section, grade
     * navigation and grade information on the registration screens. Issuing report cards
     * is core registry work, and taking it away would stop the Registrar doing their job.
     * Flagged for BAJC in `docs/midterm-revision-reports-plan.md`.
     */
    grades: 'none',
    attendance: 'view-all',
    announcements: 'full',
    calendar: 'full', // secretary can add/edit school events too
    reports: 'view-all',
    settings: 'create-edit',
    audit: 'none', // the log records what the Registrar did
    profile: 'none',
  },
  teacher: {
    dashboard: 'view-own',
    students: 'view-own',
    // Product decision (2026-07): teachers do NOT browse the staff directory. This
    // intentionally tightens requirements.md §2 (which allowed read-only View-all).
    teachers: 'none',
    offerings: 'view-own',
    // The catalog tab lives under Settings, which a lecturer cannot open. Course
    // details reach them through their own offerings instead.
    courses: 'none',
    // Read-only: a lecturer may need to see which programmes require the course they
    // teach. Nothing gates a screen on it yet — Phase 4's academic history will.
    programs: 'view-all',
    // No admissions access: an application is another person's PII, and neither a
    // Lecturer nor a student has any reason to read one (D30 §D11).
    applications: 'none',
    timetable: 'view-own', // the offerings they teach, Mon-Fri
    assessments: 'none', // folded into Grades — teachers author inside the Grades drill-down
    grades: 'create-edit',
    attendance: 'create-edit',
    announcements: 'create-edit',
    calendar: 'view-all', // read-only school calendar
    // Product decision (2026-07): the Reports module is hidden from teachers (nav item
    // removed + /reports/* route-guarded). The server remains authoritative (NFR-SEC-01).
    reports: 'none',
    settings: 'view-own', // account only
    audit: 'none',
    // 'view-own' surfaces the teacher "My Profile" (/me → own TeacherProfileView).
    // Ownership (a teacher may only reach their OWN profile) and the student
    // course-scoping rule are enforced CLIENT-SIDE for UX only — the server remains
    // authoritative on every /teachers/{id} call (NFR-SEC-01).
    profile: 'view-own',
  },
  student: {
    dashboard: 'view-own',
    students: 'none', // own profile via "My Profile" instead
    teachers: 'none',
    offerings: 'view-own',
    courses: 'none',
    // A student may read their own programme's plan — it is the prospectus.
    programs: 'view-all',
    // No admissions access: an application is another person's PII, and neither a
    // Lecturer nor a student has any reason to read one (D30 §D11).
    applications: 'none',
    timetable: 'view-own', // the offerings they are enrolled in, Mon-Fri
    assessments: 'view-own',
    /**
     * D32 (brief §4) — a student's grades are published by the DEAN, not by their role.
     *
     * The capability stays `view-own` because that is still what the role permits; what
     * changed is that permission alone is no longer sufficient. `navSectionsForRole` takes
     * `studentsCanViewGrades` and drops this item when the Dean has grades hidden, and the
     * server answers 403 `grades_hidden` regardless (`require_student_grade_visibility`).
     *
     * Encoding the switch as `'none'` here instead would have been wrong: this map is
     * static role policy, and the flag is runtime configuration that can change between
     * two loads of the same page.
     */
    grades: 'view-own',
    attendance: 'view-own',
    announcements: 'view-own',
    calendar: 'view-all', // read-only school calendar (same events everyone sees)
    // Product decision (2026-07): the Reports module is hidden from students (nav item
    // removed + /reports/* route-guarded). The server remains authoritative (NFR-SEC-01).
    reports: 'none',
    settings: 'view-own', // account only
    audit: 'none',
    profile: 'view-own',
  },
  /**
   * D43 — Head of Department: a Lecturer's row, widened to `view-all` wherever the role
   * adds departmental oversight.
   *
   * **`Capability` gained no "view-all-within-my-programme" level, on purpose.** Adding
   * one would put a scoping rule in a map whose own header says it is UX-only and that
   * the server re-checks every call — and the frontend has no way to evaluate it anyway,
   * since which programme a head runs is a server fact. So `view-all` here means "this
   * screen is REACHABLE", and the server decides which rows come back. An HOD opening
   * Students sees the same page a Dean does, filled with their programme.
   *
   * `create-edit` on grades / assessments / attendance is the LECTURER half of the role.
   * It does not mean they may edit a colleague's work: ownership decides that, per
   * offering, and the API already returns `can_edit` / `actionable_by_caller` per row for
   * the UI to honour. Setting these to `view-all` instead would have removed the
   * gradebook from a lecturer the day they were promoted.
   */
  hod: {
    dashboard: 'view-own', // their own teaching, like a lecturer's
    students: 'view-all', // every student reading for their programme
    // Unlike a plain lecturer, who is denied the directory outright: seeing the staff
    // under them is the point of the role.
    teachers: 'view-all',
    offerings: 'view-all', // their programme's, plus their own
    // Read-only reach into the catalog. The Courses tab lives under Settings, which is
    // why `features/settings/index.tsx` had to stop gating its tabs on write access.
    courses: 'view-all',
    programs: 'view-all',
    applications: 'none', // admissions is the Registrar's; a head has no part in it
    timetable: 'view-own', // the offerings they personally teach
    assessments: 'none', // folded into Grades, as for every other staff role
    grades: 'create-edit', // own offerings only — server-enforced per offering
    attendance: 'create-edit',
    announcements: 'create-edit',
    calendar: 'view-all',
    // Their programme's gradebooks and report cards. NOT transcripts — the server keeps
    // those on the `_admins` gate, which an HOD is deliberately not on.
    reports: 'view-all',
    settings: 'view-own', // account only; the Courses tab comes from `courses` above
    audit: 'none', // a head oversees a programme, not the school's audit trail
    profile: 'view-own', // they have a lecturer profile
  },
  /**
   * D43 — Auditor: reads everything, writes nothing.
   *
   * Every entry is `view-all` or `view-own`. **There must never be a `full` or
   * `create-edit` here** — not because this map enforces anything (it does not; the
   * server refuses every mutating verb centrally in `get_current_user`), but because
   * `canWrite()` drives whether edit buttons render, and offering an auditor a Save
   * button that always 403s is a worse experience than not offering one.
   *
   * `settings: 'view-all'` is what makes the read-only Audit Log screen reachable. An
   * auditor with no audit log is not an auditor.
   */
  auditor: {
    dashboard: 'view-all',
    students: 'view-all',
    teachers: 'view-all',
    offerings: 'view-all',
    courses: 'view-all',
    programs: 'view-all',
    applications: 'view-all',
    // No personal timetable: an auditor neither teaches nor takes a course, so
    // `GET /timetable/me` would honestly answer an empty week. Same reasoning as the
    // Dean's row.
    timetable: 'none',
    assessments: 'none', // folded into Grades
    grades: 'view-all',
    attendance: 'view-all',
    announcements: 'view-all', // reads the feed; `_authors` does not include them
    calendar: 'view-all',
    reports: 'view-all', // including transcripts — they are on the server's `_admins` gate
    settings: 'view-all', // read-only, and the way to the Audit Log
    audit: 'view-all', // the reason the role exists
    profile: 'none', // no student or lecturer profile to own
  },
  /**
   * D45 §2 — the System Administrator. The MIRROR IMAGE of the Auditor above.
   *
   * The Auditor reads every academic module and writes nothing. This account writes
   * configuration and reads no academic module at all: blueprint §2 gives it "user
   * accounts, permissions, backups, configuration and technical maintenance", and §48
   * says sensitive information must not be accessible "simply because the user is an
   * employee" — which makes the sysadmin the employee with the least academic reason to
   * read a transcript.
   *
   * ⚠️ THIS MAP IS NAVIGATION, NOT SECURITY. The enforcement is
   * `_is_out_of_technical_scope` in `core/deps.py`, a central ALLOWLIST every
   * authenticated route passes through, so a module added next year is refused to this
   * role by default rather than open until someone remembers it. This row exists to stop
   * the shell rendering links that would 403, and it must stay in step with that
   * allowlist — if the two ever disagree, the server is right.
   */
  sysadmin: {
    dashboard: 'none', // the dashboards are enrolment, grades and attendance
    students: 'none',
    teachers: 'none',
    offerings: 'none',
    courses: 'none',
    programs: 'none',
    applications: 'none',
    timetable: 'none',
    assessments: 'none',
    grades: 'none',
    attendance: 'none',
    announcements: 'none',
    calendar: 'none',
    reports: 'none',
    // Accounts, roles and institutional configuration — the job itself.
    settings: 'full',
    // D45 Phase 7 — 'none', NOT 'view-all', and the attempt to make it 'view-all' is
    // what settled it. The audit trail is mostly ACADEMIC records: grade changes with
    // student names and marks, registrations, status changes. §48 keeps this role out of
    // exactly those, and the server enforces it centrally as `technical_role_scope` — it
    // refused the route while this said 'view-all'. Leaving it would render a nav item
    // that always 403s, which is the trap the auditor row above warns about.
    //
    // ⚠️ A "System activity only" view for this role is a reasonable future ask, but it
    // needs a scoped endpoint that filters BEFORE academic rows are loaded — not this
    // flag flipped back.
    audit: 'none',
    profile: 'none',
  },
};

/** Does `role` have ANY access to `module`? (i.e. capability !== 'none'). */
export function canAccessModule(role: Role, module: ModuleKey): boolean {
  return PERMISSION_MATRIX[role][module] !== 'none';
}

/** The capability `role` has within `module`. */
export function capabilityFor(role: Role, module: ModuleKey): Capability {
  return PERMISSION_MATRIX[role][module];
}

/** Can `role` create/edit within `module`? (full or create-edit). */
export function canWrite(role: Role, module: ModuleKey): boolean {
  const cap = PERMISSION_MATRIX[role][module];
  return cap === 'full' || cap === 'create-edit';
}

/**
 * Roles that ARE a lecturer — they carry a `teacher_profiles` row, can be assigned to an
 * offering, and therefore hold lecturer powers on the offerings they own (D43).
 *
 * Mirrors `LECTURER_ROLES` in `backend/app/common/enums.py`. It exists because `role ===
 * 'teacher'` was written in ~20 places to mean "is this person a lecturer", and every one
 * of them silently answered "no" for a Head of Department — who is one. Promoting a
 * lecturer must not remove their register, their gradebook or their own profile page.
 *
 * Use this for "is a lecturer". Do NOT use it for "may edit THIS thing": ownership is
 * per-offering and only the server can answer it — honour `can_edit` /
 * `actionable_by_caller` on the row instead.
 */
export function isLecturerRole(role: Role | undefined | null): boolean {
  return role === 'teacher' || role === 'hod';
}

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
   * Not a nav module yet — it renders as the Settings → Courses tab, alongside
   * Programmes and Academic structure.
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
    profile: 'view-own',
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

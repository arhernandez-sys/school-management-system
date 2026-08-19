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
  | 'classes'
  /**
   * The COURSE CATALOG (D30) — course code, name, credits, component, prerequisites.
   * Distinct from `classes`, which is a scheduled OFFERING of a course.
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
    classes: 'full',
    courses: 'full', // the Dean owns the catalog…
    programs: 'full', //  …and the studies (D30 §D14)
    applications: 'full', // the Dean may admit too, and decides every credit transfer
    // No PERSONAL timetable for staff: they neither take nor teach classes, and
    // `GET /timetable/me` correctly answers an empty week for them. Class times are
    // managed per class (Classes → Schedule tab), which `classes: 'full'` already covers.
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
    classes: 'create-edit', // Registrar schedules offerings…
    courses: 'view-all', //  …but cannot edit the catalog (D30, brief §6)
    programs: 'view-all', //  …nor define what a programme requires
    applications: 'full', // the Registrar owns admissions (D30 §D14)
    timetable: 'none', // see the principal note
    assessments: 'none', // folded into Grades (see principal note)
    grades: 'view-all',
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
    classes: 'view-own',
    // The catalog tab lives under Settings, which a lecturer cannot open. Course
    // details reach them through their own offerings instead.
    courses: 'none',
    // Read-only: a lecturer may need to see which programmes require the course they
    // teach. Nothing gates a screen on it yet — Phase 4's academic history will.
    programs: 'view-all',
    // No admissions access: an application is another person's PII, and neither a
    // Lecturer nor a student has any reason to read one (D30 §D11).
    applications: 'none',
    timetable: 'view-own', // the classes they teach, Mon-Fri
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
    // subject-scoping rule are enforced CLIENT-SIDE for UX only — the server remains
    // authoritative on every /teachers/{id} call (NFR-SEC-01).
    profile: 'view-own',
  },
  student: {
    dashboard: 'view-own',
    students: 'none', // own profile via "My Profile" instead
    teachers: 'none',
    classes: 'view-own',
    courses: 'none',
    // A student may read their own programme's plan — it is the prospectus.
    programs: 'view-all',
    // No admissions access: an application is another person's PII, and neither a
    // Lecturer nor a student has any reason to read one (D30 §D11).
    applications: 'none',
    timetable: 'view-own', // the classes they are enrolled in, Mon-Fri
    assessments: 'view-own',
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

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
    classes: 'create-edit',
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

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

/** The 11 functional modules (+ the student-only "My Profile") that gate navigation. */
export type ModuleKey =
  | 'dashboard'
  | 'students'
  | 'teachers'
  | 'classes'
  | 'assessments'
  | 'grades'
  | 'attendance'
  | 'announcements'
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
    assessments: 'view-all',
    grades: 'view-all',
    attendance: 'view-all',
    announcements: 'full',
    reports: 'view-all',
    settings: 'full',
    profile: 'none', // Principal has no student "My Profile"; account is under Settings
  },
  secretary: {
    dashboard: 'view-all',
    students: 'full',
    teachers: 'create-edit',
    classes: 'create-edit',
    assessments: 'view-all',
    grades: 'view-all',
    attendance: 'view-all',
    announcements: 'full',
    reports: 'view-all',
    settings: 'create-edit',
    profile: 'none',
  },
  teacher: {
    dashboard: 'view-own',
    students: 'view-own',
    teachers: 'view-all', // read-only directory
    classes: 'view-own',
    assessments: 'full', // full on OWN classes (server enforces ownership)
    grades: 'create-edit',
    attendance: 'create-edit',
    announcements: 'create-edit',
    reports: 'view-own',
    settings: 'view-own', // account only
    profile: 'none',
  },
  student: {
    dashboard: 'view-own',
    students: 'none', // own profile via "My Profile" instead
    teachers: 'none',
    classes: 'view-own',
    assessments: 'view-own',
    grades: 'view-own',
    attendance: 'view-own',
    announcements: 'view-own',
    reports: 'view-own', // own report card only — NO transcript (D26)
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

/**
 * The single source of truth for how a role is NAMED in the UI (D30).
 *
 * Before this file there were FOUR independent role→label maps — `RoleChip.tsx`,
 * `UserMenu.tsx`, `LoginForm.tsx` and `settings/components/UserFormDialog.tsx` — which
 * meant renaming Principal→Dean touched four places and could drift between them.
 *
 * ⚠️ LABELS ONLY. The wire value is unchanged: the API, the MariaDB `users.role` enum
 * and every permission check still use `principal | secretary | teacher | student`.
 * BAJC is a junior college, so those principals are DISPLAYED as Dean, Registrar and
 * Lecturer. See decision #3 in docs/tertiary-refactor-plan.md.
 *
 * `Record<Role, string>` is deliberate: adding a role to the enum without giving it a
 * label becomes a type error rather than a blank chip.
 */

import type { Role } from '@shared/types/enums';
import { strings } from '@i18n/strings';

export const ROLE_LABEL: Record<Role, string> = {
  principal: strings.roles.principal,
  secretary: strings.roles.secretary,
  teacher: strings.roles.teacher,
  student: strings.roles.student,
  hod: strings.roles.hod,
  auditor: strings.roles.auditor,
};

/** Display name for a role, e.g. `roleLabel('principal') === 'Dean'`. */
export function roleLabel(role: Role): string {
  return ROLE_LABEL[role];
}

/**
 * Role options for a `<Select>`, in administrative seniority order. Used by the
 * Users-admin screen and the demo role picker so both offer the same list in the same
 * order.
 */
export const ROLE_OPTIONS: ReadonlyArray<{ value: Role; label: string }> = [
  { value: 'principal', label: ROLE_LABEL.principal },
  { value: 'secretary', label: ROLE_LABEL.secretary },
  // D43 — an HOD sits with the lecturers (they are one) and the Auditor last, as an
  // oversight account rather than a rank. This order also drives the demo login buttons.
  { value: 'hod', label: ROLE_LABEL.hod },
  { value: 'teacher', label: ROLE_LABEL.teacher },
  { value: 'student', label: ROLE_LABEL.student },
  { value: 'auditor', label: ROLE_LABEL.auditor },
];

export default ROLE_LABEL;

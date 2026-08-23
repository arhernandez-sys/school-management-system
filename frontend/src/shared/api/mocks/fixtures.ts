import type { CurrentUser } from '@shared/types/api';
import type { Role } from '@shared/types/enums';

/**
 * Dev-only mock fixtures. Four canned users, one per role, so login → shell →
 * role-aware navigation can be exercised WITHOUT a backend. NOT shipped behavior —
 * gated behind VITE_ENABLE_MOCKS (see mocks/browser.ts + main.tsx).
 */

function makeUser(role: Role, overrides: Partial<CurrentUser> = {}): CurrentUser {
  const names: Record<Role, string> = {
    principal: 'Alicia Mendez',
    secretary: 'Sofia Castillo',
    teacher: 'Maria Reyes',
    student: 'Ana Lopez',
  };
  return {
    id: `mock-${role}`,
    email: `${role}@example.school`,
    username: role,
    full_name: names[role],
    role,
    must_change_password: false,
    is_active: true,
    ...(role === 'student' ? { student_profile_id: 'mock-student-profile' } : {}),
    ...(role === 'teacher' ? { teacher_profile_id: 'mock-teacher-profile' } : {}),
    preferences: { locale: 'en', theme: 'light', default_page_size: 25 },
    // D32 - the canned fixture users predate the switch and exist to exercise the shell;
    // published so the nav renders the full set (see the demo seed comment for the
    // opposite default and why).
    students_can_view_grades: true,
    ...overrides,
  };
}

/**
 * Login is keyed by the identifier so a tester can choose a role by typing
 * `principal`, `secretary`, `teacher`, or `student` (any password). Defaults to
 * principal for any other identifier.
 */
export const MOCK_USERS: Record<string, CurrentUser> = {
  principal: makeUser('principal'),
  secretary: makeUser('secretary'),
  teacher: makeUser('teacher'),
  student: makeUser('student'),
};

export function resolveMockUser(identifier: string): CurrentUser {
  const key = identifier.trim().toLowerCase().split('@')[0] ?? '';
  return MOCK_USERS[key] ?? MOCK_USERS.principal!;
}

export const MOCK_ACCESS_TOKEN = 'mock-access-token';

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canAccessModule, type ModuleKey } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';

/**
 * Role-based route guard (architecture §3.2). Mirrors the permission map so a role
 * without access to `module` is redirected to /forbidden.
 *
 * ⚠️ UX ONLY: this prevents accidental navigation and matches the AC ("a Student
 * visiting an admin URL is redirected and gets no data"). It is NOT the security
 * boundary — the server re-checks every call (NFR-SEC-01). Assumes it is nested
 * inside <ProtectedRoute>, so the user is already authenticated here.
 */
export function RoleRoute({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to={ROUTES.login} replace />;
  }

  if (!canAccessModule(user.role, module)) {
    return <Navigate to={ROUTES.forbidden} replace />;
  }

  return <>{children}</>;
}

export default RoleRoute;

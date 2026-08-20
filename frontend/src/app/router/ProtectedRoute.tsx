import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { LoadingState } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';

/**
 * Auth guard (architecture §3.1, §10.1). While the bootstrap silent refresh is in
 * flight, render a full-screen loading state (NOT a redirect) so a hard reload of an
 * authenticated session does NOT flash the login screen. Once resolved:
 *   - authenticated → render children
 *   - anonymous     → redirect to /login, preserving the attempted path for return
 *   - must_change_password → redirect to the forced-change screen
 *
 * The forced-change branch is not cosmetic. The server refuses every request from a
 * flagged account with 403 `password_change_required` (`core/deps.py`), so without
 * this the app would render its chrome and then fill every panel with an error — a
 * deep link or a reloaded tab used to skip the change entirely, and now it would hit
 * a wall instead. `ROUTES.changePassword` is a PUBLIC route (see routes.tsx), so this
 * redirect leaves the guard rather than looping through it.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'bootstrapping') {
    return <LoadingState variant="page" label="Restoring your session" />;
  }

  if (status === 'anonymous') {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  if (user?.must_change_password) {
    return <Navigate to={ROUTES.changePassword} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;

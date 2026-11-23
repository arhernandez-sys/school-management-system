import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { LoadingState } from '@shared/components';
import { ROUTES } from '@shared/constants/routes';

/**
 * Auth guard (architecture §3.1, §10.1). While the bootstrap silent refresh is in
 * flight, render a full-screen loading state (NOT a redirect) so a hard reload of an
 * authenticated session does NOT flash the login screen. Once resolved:
 *   - authenticated → render children
 *   - anonymous     → redirect to /login
 *   - must_change_password → redirect to the forced-change screen
 *
 * **D42 §1 — the attempted path is deliberately NOT preserved.** It used to ride along as
 * `state.from` so LoginForm could return to it, but logging out is an anonymous redirect
 * too: signing back in as a different role replayed the previous session's route and the
 * user landed on "Access denied". Every sign-in now goes to the dashboard.
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

  if (status === 'bootstrapping') {
    return <LoadingState variant="page" label="Restoring your session" />;
  }

  if (status === 'anonymous') {
    return <Navigate to={ROUTES.login} replace />;
  }

  if (user?.must_change_password) {
    return <Navigate to={ROUTES.changePassword} replace />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;

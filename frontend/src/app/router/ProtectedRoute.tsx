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
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'bootstrapping') {
    return <LoadingState variant="page" label="Restoring your session" />;
  }

  if (status === 'anonymous') {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;

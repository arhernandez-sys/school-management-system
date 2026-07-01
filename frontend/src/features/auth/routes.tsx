import { Navigate } from 'react-router-dom';
import { LoginForm } from './components/LoginForm';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { useAuth } from './hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { LoadingState } from '@shared/components';

/** Public login route. Authenticated users are bounced to the dashboard. */
export function LoginPage() {
  const { status } = useAuth();
  if (status === 'bootstrapping') return <LoadingState variant="page" label="Loading" />;
  if (status === 'authenticated') return <Navigate to={ROUTES.dashboard} replace />;
  return <LoginForm />;
}

/**
 * Forced / self-service password change (api-spec §2.3, PATCH /auth/me/password).
 * Requires an authenticated session (the user just logged in with
 * must_change_password=true). Anonymous visitors are bounced to /login; while the
 * bootstrap refresh is in flight we show a loading state instead of flashing /login.
 */
export function ChangePasswordPage() {
  const { status } = useAuth();
  if (status === 'bootstrapping') return <LoadingState variant="page" label="Loading" />;
  if (status === 'anonymous') return <Navigate to={ROUTES.login} replace />;
  return <ChangePasswordForm />;
}

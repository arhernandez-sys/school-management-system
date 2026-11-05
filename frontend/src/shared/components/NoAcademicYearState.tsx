import { useNavigate } from 'react-router-dom';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { NO_ACADEMIC_YEAR_MESSAGE, NO_ACADEMIC_YEAR_TITLE } from '@shared/api/setupState';
import { EmptyState } from './EmptyState';

/** Settings → Academic Structure (`features/settings/index.tsx`, route `academic`). */
const ACADEMIC_STRUCTURE_PATH = `${ROUTES.settings}/academic`;

/**
 * The "no academic year yet" empty state, worded for who is looking.
 *
 * Who can FIX it is decided by the server: `POST /settings/academic-years` is
 * `require_role(Role.PRINCIPAL)` (settings/router.py). So:
 *   - Dean (`principal`) → told to create one, with a button to the screen that does it.
 *   - System Admin       → can open that screen but the create is refused server-side, so
 *                          no button that leads to a 403; they're pointed at the Dean.
 *   - everyone else      → "Please contact administration."
 *
 * Kept out of `ErrorState` itself so the router/auth hooks only run when this state is
 * actually shown.
 */
export function NoAcademicYearState() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;

  if (role === 'principal') {
    return (
      <EmptyState
        icon={<EventBusyIcon fontSize="inherit" />}
        title={NO_ACADEMIC_YEAR_TITLE}
        description="No academic year has been created yet. Create one and activate its session in Settings → Academic Structure."
        variant="page"
        action={{
          label: 'Go to Academic Structure',
          onClick: () => navigate(ACADEMIC_STRUCTURE_PATH),
        }}
      />
    );
  }

  return (
    <EmptyState
      icon={<EventBusyIcon fontSize="inherit" />}
      title={NO_ACADEMIC_YEAR_TITLE}
      description={
        role === 'sysadmin'
          ? 'No academic year has been created yet. The Dean creates academic years in Settings → Academic Structure.'
          : NO_ACADEMIC_YEAR_MESSAGE
      }
      variant="page"
    />
  );
}

export default NoAcademicYearState;

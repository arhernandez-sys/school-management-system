import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { OfferingsListPage } from './OfferingsListPage';
import { OfferingDetailPage } from './OfferingDetailPage';
import { StudentOfferingsPage } from './StudentOfferingsPage';

/**
 * Offerings feature module (Phase 7, **D31**). Mounted at `${ROUTES.offerings}/*` (see
 * app/router/routes.tsx) so it owns its nested routes, mirroring features/settings:
 *  - index → the offering list.
 *  - :offeringId → the offering detail (Roster · Schedule · Overview tabs).
 *
 * A COURSE OFFERING is one course, in one semester, with an optional section code:
 * "MATH1110-01 · Semester 1". It has its own lecturer(s), weekly meetings, gradebook and
 * roster. All data comes from the shared axios client + TanStack Query hooks
 * (features/offerings/hooks); the server enforces scope.
 *
 * A STUDENT takes MANY offerings, so they get a dedicated list of their own instead of the
 * admin list. The per-offering detail exposes the roster, so it is not theirs to browse and
 * unknown sub-paths redirect back to their page.
 */
export function OfferingsPage() {
  const { user } = useAuth();

  if (user?.role === 'student') {
    return (
      <Routes>
        <Route index element={<StudentOfferingsPage />} />
        <Route path="*" element={<Navigate to={ROUTES.offerings} replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route index element={<OfferingsListPage />} />
      <Route path=":offeringId" element={<OfferingDetailPage />} />
      {/* Unknown sub-path → the list. */}
      <Route path="*" element={<OfferingsListPage />} />
    </Routes>
  );
}

export default OfferingsPage;

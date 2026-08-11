import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { ClassesListPage } from './ClassesListPage';
import { ClassDetailPage } from './ClassDetailPage';
import { StudentClassesPage } from './StudentClassesPage';

/**
 * Classes feature module (Phase 7, **D29**). Mounted at `${ROUTES.classes}/*` (see
 * app/router/routes.tsx) so it owns its nested routes, mirroring features/settings:
 *  - index → the subject-class list.
 *  - :classId → the class detail (Roster · Schedule · Overview tabs).
 *
 * A "class" here is one SUBJECT CLASS ("Math-1"): one subject, its own teacher(s), room,
 * weekly times, gradebook and roster. All data comes from the shared axios client +
 * TanStack Query hooks (features/classes/hooks); the server enforces scope.
 *
 * A STUDENT takes MANY subject classes (D29 — they used to belong to exactly one homeroom),
 * so they get a dedicated "My Classes" list of all of them instead of the admin list. The
 * per-class detail exposes the roster, so it is still not theirs to browse and redirects
 * back to their page.
 */
export function ClassesPage() {
  const { user } = useAuth();

  if (user?.role === 'student') {
    return (
      <Routes>
        <Route index element={<StudentClassesPage />} />
        <Route path="*" element={<Navigate to={ROUTES.classes} replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route index element={<ClassesListPage />} />
      <Route path=":classId" element={<ClassDetailPage />} />
      {/* Unknown sub-path → the list. */}
      <Route path="*" element={<ClassesListPage />} />
    </Routes>
  );
}

export default ClassesPage;

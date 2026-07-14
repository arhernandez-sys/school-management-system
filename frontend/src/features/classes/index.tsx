import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { ClassesListPage } from './ClassesListPage';
import { ClassDetailPage } from './ClassDetailPage';
import { StudentClassesPage } from './StudentClassesPage';

/**
 * Classes feature module (Phase 7, D23). Mounted at `${ROUTES.classes}/*` (see
 * app/router/routes.tsx) so it owns its nested routes, mirroring features/settings:
 *  - index → the sections (classes) list.
 *  - :classId → the section detail (Roster · Subjects · Overview tabs).
 *
 * A "class" here is a multi-subject SECTION/homeroom: one roster, many `class_subjects`,
 * each with its own teacher(s) and gradebook. All data comes from the shared axios
 * client + TanStack Query hooks (features/classes/hooks); the server enforces scope.
 *
 * A STUDENT belongs to exactly one section and never roams (FR-CLS-07), so instead of
 * the admin sections list they get a dedicated "My Classes" view of that single
 * homeroom and its subjects — and the per-section detail (which exposes the roster) is
 * not theirs to browse, so it redirects back to their page.
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

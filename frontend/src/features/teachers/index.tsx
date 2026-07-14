import { Route, Routes } from 'react-router-dom';
import { TeachersListPage } from './TeachersListPage';
import { TeacherDetailPage } from './TeacherDetailPage';

/**
 * Teachers feature module (Phase 7, Module 4). Mounted at `${ROUTES.teachers}/*` (see
 * app/router/routes.tsx) so it owns its nested routes, mirroring features/classes:
 *  - index → the searchable staff directory.
 *  - :teacherId → the teacher detail (Profile · Assignments).
 *
 * All data comes from the shared axios client + TanStack Query hooks
 * (features/teachers/hooks); the server enforces scope. The route is role-guarded
 * upstream (students have no access; teachers get a read-only directory).
 */
export function TeachersPage() {
  return (
    <Routes>
      <Route index element={<TeachersListPage />} />
      <Route path=":teacherId" element={<TeacherDetailPage />} />
      {/* Unknown sub-path → the directory. */}
      <Route path="*" element={<TeachersListPage />} />
    </Routes>
  );
}

export default TeachersPage;

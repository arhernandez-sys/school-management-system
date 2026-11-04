import { Route, Routes } from 'react-router-dom';
import { TeachersListPage } from './TeachersListPage';
import { TeacherDetailPage } from './TeacherDetailPage';
import { TeacherFormScreen } from './screens/TeacherFormScreen';

/**
 * Teachers feature module (Phase 7, Module 4). Mounted at `${ROUTES.teachers}/*` (see
 * app/router/routes.tsx) so it owns its nested routes, mirroring features/classes:
 *  - index → the searchable staff directory.
 *  - new → the full-page lecturer form, create mode (D40).
 *  - :teacherId → the teacher detail (Profile · Assignments).
 *  - :teacherId/edit → the same form, edit mode.
 *
 * **`new` is declared BEFORE `:teacherId`**, or React Router matches the literal as a
 * teacher id and the form becomes a 404 detail page — the same ordering rule the
 * admissions module records for `new` and `pending`.
 *
 * All data comes from the shared axios client + TanStack Query hooks
 * (features/teachers/hooks); the server enforces scope. The route is role-guarded
 * upstream (students have no access; teachers get a read-only directory), and the form
 * re-checks write permission itself — the module gate admits a lecturer, who may read
 * the directory but not edit it.
 */
export function TeachersPage() {
  return (
    <Routes>
      <Route index element={<TeachersListPage />} />
      <Route path="new" element={<TeacherFormScreen />} />
      <Route path=":teacherId/edit" element={<TeacherFormScreen />} />
      <Route path=":teacherId" element={<TeacherDetailPage />} />
      {/* Unknown sub-path → the directory. */}
      <Route path="*" element={<TeachersListPage />} />
    </Routes>
  );
}

export default TeachersPage;

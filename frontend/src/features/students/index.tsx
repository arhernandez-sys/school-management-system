import { Route, Routes } from 'react-router-dom';
import { StudentsListPage } from './StudentsListPage';
import { StudentDetailPage } from './StudentDetailPage';

/**
 * Students feature module (Phase 7, Module 3). Mounted at `${ROUTES.students}/*` (see
 * app/router/routes.tsx) so it owns its nested routes, mirroring features/classes:
 *  - index → the searchable student directory.
 *  - :studentId → the student detail (Profile · Enrollment · Grades & Assessments).
 *
 * All data comes from the shared axios client + TanStack Query hooks
 * (features/students/hooks); the server enforces scope (teacher = own sections). The
 * route is role-guarded upstream (a student reaches their own record via "My Profile").
 */
export function StudentsPage() {
  return (
    <Routes>
      <Route index element={<StudentsListPage />} />
      <Route path=":studentId" element={<StudentDetailPage />} />
      {/* Unknown sub-path → the directory. */}
      <Route path="*" element={<StudentsListPage />} />
    </Routes>
  );
}

export default StudentsPage;

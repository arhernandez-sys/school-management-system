import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { GradebookScreen } from './GradebookScreen';
import { MyGradesScreen } from './MyGradesScreen';

/**
 * Grades module (Phase 7) — a nested-routed container mounted at `/grades/*`
 * (mirrors features/settings/index.tsx). Role-shaped:
 *  - Student → "My Grades" (own released grades, read-only).
 *  - Teacher → the Gradebook for subjects they own (grade entry + release).
 *  - Principal / Secretary → the Gradebook, view-all read-only.
 *
 * The gradebook selection is URL-persisted via `?class_subject_id=` so links from the
 * Classes › Subjects tab and the Assessments list open the right grid directly (M4).
 * Route visibility is UX-only; the server (mocked here) is authoritative on every call.
 */
export function GradesPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  return (
    <Routes>
      <Route index element={isStudent ? <MyGradesScreen /> : <GradebookScreen />} />
      {/* Explicit sub-paths keep deep links stable if a viewer role changes. */}
      <Route path="me" element={<MyGradesScreen />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

export default GradesPage;

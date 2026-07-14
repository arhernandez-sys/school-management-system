import { Navigate, Route, Routes } from 'react-router-dom';
import { AssessmentsListScreen } from './AssessmentsListScreen';

/**
 * Assessments module (Module 6) — mounted at `/assessments/*` and rendered inside a
 * nested <Routes> (mirrors features/settings/index.tsx). The landing route is the
 * class-subject-scoped assessments list, which URL-persists the chosen offering via
 * `?class_subject_id=`. Grade entry / gradebook navigation belongs to the Grades module.
 *
 * Route access is guarded upstream (RoleRoute) and the server is authoritative on every
 * call; this module only shapes what the SPA renders.
 */
export function AssessmentsPage() {
  return (
    <Routes>
      <Route index element={<AssessmentsListScreen />} />
      {/* Unknown sub-path → back to the list. */}
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

export default AssessmentsPage;

import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import { GradeAssessmentsScreen } from './GradeAssessmentsScreen';
import { AssessmentGradingScreen } from './AssessmentGradingScreen';
import { MyGradesScreen } from './MyGradesScreen';
import { GradeRevisionsScreen } from './GradeRevisionsScreen';

/**
 * Grades module (Phase 7) — a nested-routed container mounted at `/grades/*`
 * (mirrors features/settings/index.tsx). Role-shaped:
 *  - Student → "My Grades" (own released grades, read-only).
 *  - Lecturer / Dean / Registrar → a grid of COURSE OFFERINGS; opening one lists its
 *    assessments, and opening an assessment grades everyone enrolled in that offering.
 *
 * The offering selection is URL-persisted via `?offering_id=` and the year via `?year=`.
 * Route visibility is UX-only; the server (mocked here) is authoritative.
 */
export function GradesPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  return (
    <Routes>
      <Route index element={isStudent ? <MyGradesScreen /> : <GradeAssessmentsScreen />} />
      {/* Per-assessment class grading page (teacher/P·S). */}
      <Route path="assessment/:assessmentId" element={<AssessmentGradingScreen />} />
      {/* D30 §D7/§D8 — the revision queue. Mounted UNDER /grades rather than as its own
          nav module: a revision is a grade decision, and the Dean and the Lecturer both
          arrive at it from the gradebook. A student never sees it. */}
      <Route
        path="revisions"
        element={isStudent ? <Navigate to=".." replace /> : <GradeRevisionsScreen />}
      />
      {/* Explicit sub-paths keep deep links stable if a viewer role changes. */}
      <Route path="me" element={<MyGradesScreen />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

export default GradesPage;

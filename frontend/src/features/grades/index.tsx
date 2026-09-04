import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { GradeAssessmentsScreen } from './GradeAssessmentsScreen';
import { AssessmentGradingScreen } from './AssessmentGradingScreen';
import { MyGradesScreen } from './MyGradesScreen';
import { GradeRevisionsScreen } from './GradeRevisionsScreen';

/**
 * Grades module (Phase 7) — a tabbed, nested-routed container mounted at `/grades/*`
 * (mirrors features/settings/index.tsx and features/reports/index.tsx). Role-shaped:
 *  - Student → "My Grades" (own released grades, read-only), no sub-tabs.
 *  - Lecturer / Dean / Registrar → a grid of COURSE OFFERINGS; opening one lists its
 *    assessments, and opening an assessment grades everyone enrolled in that offering.
 *  - Lecturer / Dean ALSO get the **Grade Revision** tab.
 *
 * The offering selection is URL-persisted via `?offering_id=` and the year via `?year=`.
 * Route visibility is UX-only; the server (mocked here) is authoritative.
 */
interface GradesTab {
  label: string;
  /** Path segment under /grades. `''` is the module index. */
  path: string;
}

export function GradesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = user?.role;
  const isStudent = role === 'student';
  // Only the Dean and the Lecturer may LIST revisions — `GET /grade-revisions` answers
  // 403 for the Registrar (§D14 gives them no grade authority) and for students. The tab
  // is hidden rather than left to fail, and the route below redirects for the same set.
  // D43 — the HOD and the Auditor join them. The server was widened to match: a head
  // lists their own requests plus their programme's, an auditor lists all. Neither can
  // DECIDE one — `POST /grade-revisions/{id}/decision` stays Dean-only.
  const canSeeRevisions =
    role === 'principal' || role === 'teacher' || role === 'hod' || role === 'auditor';

  const tabs = useMemo<GradesTab[]>(() => {
    if (isStudent) return [];
    const base: GradesTab[] = [{ label: 'Gradebook', path: '' }];
    if (canSeeRevisions) base.push({ label: 'Grade Revision', path: 'revisions' });
    return base;
  }, [isStudent, canSeeRevisions]);

  // Derive the active tab from the URL (…/grades/<segment>); the index tab is `''`.
  const activeSegment =
    location.pathname.replace(ROUTES.grades, '').replace(/^\//, '').split('/')[0] ?? '';
  // `/grades/assessment/:id` is a drill-down, not a tab — nothing is highlighted there.
  const activeTab = tabs.some((t) => t.path === activeSegment) ? activeSegment : false;

  const goToTab = (value: string) =>
    navigate(value === '' ? ROUTES.grades : `${ROUTES.grades}/${value}`);

  return (
    <Box>
      {tabs.length > 1 && (
        <Tabs
          value={activeTab}
          onChange={(_, value: string) => goToTab(value)}
          aria-label="Grades sections"
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          // `main` supplies the horizontal padding but no top padding — each screen
          // brings its own. The tab bar sits above them, so it brings its own too.
          sx={{ pt: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((t) => (
            <Tab key={t.path || 'index'} value={t.path} label={t.label} />
          ))}
        </Tabs>
      )}

      <Routes>
        <Route index element={isStudent ? <MyGradesScreen /> : <GradeAssessmentsScreen />} />
        {/* Per-assessment class grading page (teacher/P·S). */}
        <Route path="assessment/:assessmentId" element={<AssessmentGradingScreen />} />
        {/* D30 §D7/§D8 — the revision queue. Mounted UNDER /grades rather than as its own
            nav module: a revision is a grade decision, and the Dean and the Lecturer both
            arrive at it from the gradebook. A student and the Registrar never see it. */}
        <Route
          path="revisions"
          element={canSeeRevisions ? <GradeRevisionsScreen /> : <Navigate to=".." replace />}
        />
        {/* Explicit sub-paths keep deep links stable if a viewer role changes. */}
        <Route path="me" element={<MyGradesScreen />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </Box>
  );
}

export default GradesPage;

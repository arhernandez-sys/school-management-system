import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { canWrite } from '@shared/auth/permissions';
import { ROUTES } from '@shared/constants/routes';
import { SubjectsPage } from './SubjectsPage';
import { ProgramsScreen } from '@features/programs/ProgramsScreen';
import { ProgramCurriculumScreen } from '@features/programs/ProgramCurriculumScreen';
import { SchoolProfileScreen } from './screens/SchoolProfileScreen';
import { AcademicStructureScreen } from './screens/AcademicStructureScreen';
import { GradingScaleScreen } from './screens/GradingScaleScreen';
import { AssessmentPolicyScreen } from './screens/AssessmentPolicyScreen';
import { UsersScreen } from './screens/UsersScreen';
import { AccountScreen } from './screens/AccountScreen';

/**
 * Settings module (Phase 7.2) — a tabbed, nested-routed container mounted at
 * `/settings/*`. Sub-navigation is role-aware:
 *  - Dean / Registrar: school, academic structure, courses, programmes, grading scale,
 *    assessment policy, users, account. (Within each screen, Dean-only writes are
 *    further gated; the server is authoritative — the Registrar sees Courses and
 *    Programmes read-only, per D30 §D14.)
 *  - Teacher / Student: account only (their sole Settings capability, permissions map).
 *
 * Nav visibility is UX-only; every route is still role-guarded upstream and the server
 * enforces on each call. Each screen owns its data via the generated Settings hooks.
 */
interface SettingsTab {
  label: string;
  /** Path segment under /settings. */
  path: string;
}

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const canManage = user ? canWrite(user.role, 'settings') : false;

  const tabs = useMemo<SettingsTab[]>(
    () =>
      canManage
        ? [
            { label: 'School', path: 'school' },
            { label: 'Academic structure', path: 'academic' },
            { label: 'Courses', path: 'subjects' },
            // D30 §D3 — the studies and the course sequence each one requires. Sits
            // next to Courses because a programme is built OUT of catalog courses.
            { label: 'Programmes', path: 'programs' },
            { label: 'Grading scale', path: 'grading' },
            { label: 'Assessment policy', path: 'policy' },
            { label: 'Users', path: 'users' },
            { label: 'My account', path: 'account' },
          ]
        : [{ label: 'My account', path: 'account' }],
    [canManage],
  );

  const defaultPath = canManage ? 'school' : 'account';

  // Derive the active tab from the URL (…/settings/<segment>).
  const activeSegment = location.pathname.replace(`${ROUTES.settings}/`, '').split('/')[0] || defaultPath;
  const activeTab = tabs.some((t) => t.path === activeSegment) ? activeSegment : false;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={activeTab}
        onChange={(_, value: string) => navigate(`${ROUTES.settings}/${value}`)}
        aria-label="Settings sections"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map((t) => (
          <Tab key={t.path} value={t.path} label={t.label} />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route index element={<Navigate to={defaultPath} replace />} />
          <Route path="account" element={<AccountScreen />} />
          {canManage && (
            <>
              <Route path="school" element={<SchoolProfileScreen />} />
              <Route path="academic" element={<AcademicStructureScreen />} />
              <Route path="subjects" element={<SubjectsPage />} />
              <Route path="programs" element={<ProgramsScreen />} />
              {/* The curriculum builder is a nested route rather than a dialog: a
                  programme's plan is a page-sized thing, and a Dean part-way through
                  entering an 87-credit sequence needs a URL they can come back to. */}
              <Route path="programs/:programId" element={<ProgramCurriculumScreen />} />
              <Route path="grading" element={<GradingScaleScreen />} />
              <Route path="policy" element={<AssessmentPolicyScreen />} />
              <Route path="users" element={<UsersScreen />} />
            </>
          )}
          {/* Unknown sub-path → back to the section landing. */}
          <Route path="*" element={<Navigate to={defaultPath} replace />} />
        </Routes>
      </Box>
    </Box>
  );
}

export default SettingsPage;

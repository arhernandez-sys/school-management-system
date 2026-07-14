import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { ReportCardScreen } from './screens/ReportCardScreen';
import { TranscriptScreen } from './screens/TranscriptScreen';

/**
 * Reports module (Phase 7 / demo) — a tabbed, nested-routed container mounted at
 * `/reports/*`, mirroring the Settings module. Sub-navigation is role-aware:
 *  - All roles: Report card (student → own via /me; P/S/teacher → pick a student).
 *  - Principal / Secretary ONLY: Transcript (D26 — teachers/students have no entry
 *    point, and the route + handler both refuse them).
 *
 * Nav visibility is UX-only; the transcript route is also role-guarded and the server
 * enforces on every call.
 */
interface ReportTab {
  label: string;
  /** Path segment under /reports. */
  path: string;
}

export function ReportsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const canViewTranscript = user?.role === 'principal' || user?.role === 'secretary';

  const tabs = useMemo<ReportTab[]>(
    () =>
      canViewTranscript
        ? [
            { label: 'Report card', path: 'report-card' },
            { label: 'Transcript', path: 'transcript' },
          ]
        : [{ label: 'Report card', path: 'report-card' }],
    [canViewTranscript],
  );

  const defaultPath = 'report-card';

  // Derive the active tab from the URL (…/reports/<segment>).
  const activeSegment =
    location.pathname.replace(`${ROUTES.reports}/`, '').split('/')[0] || defaultPath;
  const activeTab = tabs.some((t) => t.path === activeSegment) ? activeSegment : false;

  return (
    <Box sx={{ pt: 3 }}>
      <Tabs
        value={activeTab}
        onChange={(_, value: string) => navigate(`${ROUTES.reports}/${value}`)}
        aria-label="Report sections"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        className="sis-print-hide"
        sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map((t) => (
          <Tab key={t.path} value={t.path} label={t.label} />
        ))}
      </Tabs>

      <Routes>
        <Route index element={<Navigate to={defaultPath} replace />} />
        <Route path="report-card" element={<ReportCardScreen />} />
        {canViewTranscript && <Route path="transcript" element={<TranscriptScreen />} />}
        {/* Unknown / disallowed sub-path → back to the report card. */}
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Box>
  );
}

export default ReportsPage;

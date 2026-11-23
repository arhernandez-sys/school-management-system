import { useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Box, Tab, Tabs } from '@mui/material';
import { useAuth } from '@features/auth/hooks/useAuth';
import { ROUTES } from '@shared/constants/routes';
import { ReportCardScreen } from './screens/ReportCardScreen';
import { TranscriptScreen } from './screens/TranscriptScreen';
import { CollegeReportsScreen } from './screens/CollegeReportsScreen';

/**
 * Reports module (Phase 7 / demo) — a tabbed, nested-routed container mounted at
 * `/reports/*`, mirroring the Settings module. Sub-navigation is role-aware:
 *  - All roles: Report card (student → own via /me; P/S/teacher → pick a student).
 *  - Principal / Secretary ONLY: Transcript (D26 — teachers/students have no entry
 *    point, and the route + handler both refuse them).
 *  - Principal / Secretary / HOD / Auditor: College reports — the four institutional
 *    reports of §53 (D45 Phase 9). A DIFFERENT KIND of thing from the two above: those
 *    are documents about one student, printed and handed over; these read the college to
 *    find what needs attention. They sit behind one tab with four of their own rather
 *    than adding four here, so this bar keeps naming documents.
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
  // The same four roles the server's `_institutional` gate admits. A Head of Department
  // is included and then NARROWED by the server to the programmes they head — which the
  // screen states, so an HOD does not read their own figures as the college's.
  /**
   * ⚠️ HIDDEN, NOT REMOVED (Sep 2026, client request: "for now hide college reports,
   * don't delete, it will be shown later").
   *
   * Flip this one constant to `true` to bring the tab back. Everything behind it is
   * intact and tested: `CollegeReportsScreen`, the four hooks, the four API functions,
   * the demo handlers, and 80 backend tests. The ROUTE is left mounted deliberately —
   * `/reports/college` still resolves for anyone who has the link — so the only thing
   * this hides is the tab. Deleting the route instead would have meant a 404 for the
   * client if they wanted to look at it before it is shown.
   *
   * The server-side gate is unchanged and is the real boundary either way: hiding a tab
   * is UX, not access control.
   */
  const SHOW_COLLEGE_REPORTS = false;

  const canViewCollegeReports =
    SHOW_COLLEGE_REPORTS &&
    (user?.role === 'principal' ||
      user?.role === 'secretary' ||
      user?.role === 'hod' ||
      user?.role === 'auditor');

  const tabs = useMemo<ReportTab[]>(() => {
    const list: ReportTab[] = [{ label: 'Report card', path: 'report-card' }];
    if (canViewTranscript) list.push({ label: 'Transcript', path: 'transcript' });
    if (canViewCollegeReports) list.push({ label: 'College reports', path: 'college' });
    return list;
  }, [canViewTranscript, canViewCollegeReports]);

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
        {/* Mounted even while the TAB is hidden — see `SHOW_COLLEGE_REPORTS`. The
            server gate is what actually restricts this, so a reachable route is not a
            hole; an unreachable one would just be a 404 for whoever asked to see it. */}
        <Route path="college" element={<CollegeReportsScreen />} />
        {/* Unknown / disallowed sub-path → back to the report card. */}
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Box>
  );
}

export default ReportsPage;

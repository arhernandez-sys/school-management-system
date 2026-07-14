import { Route, Routes } from 'react-router-dom';
import { Box } from '@mui/material';
import { AnnouncementsFeedScreen } from './AnnouncementsFeedScreen';

/**
 * Announcements feature module (Phase 7, api-spec §5 Module 9). Mounted at
 * `${ROUTES.announcements}/*` and mirrors the nested-<Routes> shape used by Settings
 * so the module owns its own sub-routing. v1 is a single targeted feed; the detail and
 * compose/edit surfaces are dialogs over the feed (no separate routes needed yet), so
 * any unknown sub-path falls back to the feed.
 *
 * The route is already role-guarded upstream (RoleRoute). Within the feed, compose /
 * edit / delete controls are role-gated (UX only); the server re-checks on every call.
 *
 * NOTE: the exported page component name is `AnnouncementsPage` — the exact name the
 * router imports (app/router/routes.tsx). Do not rename.
 */
export function AnnouncementsPage() {
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Routes>
        <Route index element={<AnnouncementsFeedScreen />} />
        <Route path="*" element={<AnnouncementsFeedScreen />} />
      </Routes>
    </Box>
  );
}

export default AnnouncementsPage;

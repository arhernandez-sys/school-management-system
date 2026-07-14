/**
 * DEFERRED component stubs. The design-system §5 inventory lists 23 shared
 * components. The shell-critical ones are implemented for real (LoadingState,
 * EmptyState, ErrorState, PageHeader, plus AppShell/Sidebar/TopBar/UserMenu/
 * SemesterSwitcher/NotificationsBell/ProtectedRoute in their own files).
 *
 * The remaining stub below is a typed placeholder so feature work has a target to
 * fill in. It renders a visible "not implemented" marker rather than failing silently.
 *
 * PROMOTED to real implementations (own files, exported from ./index):
 *   Phase 7.2 — DataTable, ConfirmDialog, FormDialog, FilterBar, StatusBadge,
 *               RoleChip, PasswordField.
 *   Demo foundation — StatCard, ChartWithTable, CollapsibleSection, PrintLayout,
 *               DetailTabs.
 * Still stubbed (promote when a module first needs it): FormPage.
 */

import { Alert } from '@mui/material';

function NotImplemented({ name }: { name: string }) {
  return (
    <Alert severity="info" variant="outlined" sx={{ my: 1 }}>
      <code>{name}</code> is a Phase 7 component (stubbed in foundation).
    </Alert>
  );
}

// #9 FormPage — full-page form scaffold. Promote when a module first needs it.
export function FormPage(_props: unknown) {
  return <NotImplemented name="FormPage" />;
}

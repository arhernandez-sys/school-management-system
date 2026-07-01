/**
 * DEFERRED component stubs (Phase 7). The design-system §5 inventory lists 23 shared
 * components. The shell-critical ones are implemented for real (LoadingState,
 * EmptyState, ErrorState, PageHeader, plus AppShell/Sidebar/TopBar/UserMenu/
 * SemesterSwitcher/NotificationsBell/ProtectedRoute in their own files).
 *
 * The remaining data/feature-composition components are STUBBED here with their
 * intended prop contracts so feature work in Phase 7 has typed placeholders to fill
 * in. Each renders a visible "not implemented" marker rather than failing silently.
 *
 * Do NOT build real functionality here in Phase 6.
 */

import { Alert } from '@mui/material';

function NotImplemented({ name }: { name: string }) {
  return (
    <Alert severity="info" variant="outlined" sx={{ my: 1 }}>
      <code>{name}</code> is a Phase 7 component (stubbed in foundation).
    </Alert>
  );
}

// NOTE (Phase 7.2): DataTable, ConfirmDialog, FormDialog, FilterBar, StatusBadge,
// RoleChip, and PasswordField have been PROMOTED to real implementations in their own
// files (exported from ./index). The remaining entries below are still stubbed and
// will be promoted by the modules that first need them.

// #5 ChartWithTable — accessible Recharts wrapper + data-table equivalent.
export function ChartWithTable(_props: unknown) {
  return <NotImplemented name="ChartWithTable" />;
}

// #7 StatCard — dashboard metric tile.
export function StatCard(_props: unknown) {
  return <NotImplemented name="StatCard" />;
}

// #9 FormPage — full-page form scaffold.
export function FormPage(_props: unknown) {
  return <NotImplemented name="FormPage" />;
}

// #18 DetailTabs — tabbed detail container.
export function DetailTabs(_props: unknown) {
  return <NotImplemented name="DetailTabs" />;
}

// #21 PrintLayout — print-optimized report wrapper.
export function PrintLayout(_props: unknown) {
  return <NotImplemented name="PrintLayout" />;
}

// #23 CollapsibleSection — accessible expand/collapse (transcript year-blocks).
export function CollapsibleSection(_props: unknown) {
  return <NotImplemented name="CollapsibleSection" />;
}

// Foundation (implemented) shared components.
export { LoadingState } from './LoadingState';
export { EmptyState } from './EmptyState';
export { ErrorState } from './ErrorState';
export { PageHeader } from './PageHeader';

// Promoted for Phase 7.2 (Settings + Subjects). Real implementations.
export { DataTable } from './DataTable';
export type { DataTableColumn, DataTableProps } from './DataTable';
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';
export { FormDialog } from './FormDialog';
export type { FormDialogProps } from './FormDialog';
export { FilterBar } from './FilterBar';
export type { FilterBarProps } from './FilterBar';
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps, StatusKind } from './StatusBadge';
export { RoleChip } from './RoleChip';
export type { RoleChipProps } from './RoleChip';
export { PasswordField } from './PasswordField';
export type { PasswordFieldProps } from './PasswordField';

// Deferred Phase 7 stubs (typed placeholders) — promoted per module as needed.
export {
  ChartWithTable,
  StatCard,
  FormPage,
  DetailTabs,
  PrintLayout,
  CollapsibleSection,
} from './stubs';

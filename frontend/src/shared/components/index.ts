// Foundation (implemented) shared components.
export { LoadingState } from './LoadingState';
export { EmptyState } from './EmptyState';
export { ErrorState } from './ErrorState';
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';
export { PageContainer } from './PageContainer';
export type { PageContainerProps } from './PageContainer';

// Promoted for Phase 7.2 (Settings + Subjects). Real implementations.
export { DataTable } from './DataTable';
export type { DataTableColumn, DataTableProps } from './DataTable';
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';
export { FormDialog } from './FormDialog';
export type { FormDialogProps } from './FormDialog';
export { FilterBar } from './FilterBar';
export type { FilterBarProps } from './FilterBar';
export { YearSelect, ALL_YEARS } from './YearSelect';
export type { YearSelectProps } from './YearSelect';
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps, StatusKind } from './StatusBadge';
export { RoleChip } from './RoleChip';
export type { RoleChipProps } from './RoleChip';
export { PasswordField } from './PasswordField';
export type { PasswordFieldProps } from './PasswordField';

// Promoted for the client demo foundation. Real implementations.
export { StatCard } from './StatCard';
export type { StatCardProps, StatCardColor } from './StatCard';
export { ChartWithTable } from './ChartWithTable';
export type { ChartWithTableProps, ChartDatum } from './ChartWithTable';
export { CollapsibleSection } from './CollapsibleSection';
export type { CollapsibleSectionProps } from './CollapsibleSection';
export { SearchableSelect } from './SearchableSelect';
export type { SearchableSelectProps, SearchableSelectOption } from './SearchableSelect';
export { PrintLayout } from './PrintLayout';
export type { PrintLayoutProps } from './PrintLayout';
export { DetailTabs } from './DetailTabs';
export type { DetailTabsProps, DetailTab } from './DetailTabs';
export { ProfileLayout } from './ProfileLayout';
export type { ProfileLayoutProps } from './ProfileLayout';
export { LabeledProgress } from './LabeledProgress';
export type { LabeledProgressProps } from './LabeledProgress';
export { ProfileAvatar, ProfileSectionHeading, ProfileStatTile } from './ProfileParts';
export type {
  ProfileAvatarProps,
  ProfileSectionHeadingProps,
  ProfileStatTileProps,
} from './ProfileParts';
export { avatarInitials, avatarAccent, PROFILE_ACCENTS } from './profileIdentity';
// D42 §6 — the app's only date controls. A native `<input type="date">` renders in the
// browser's locale and cannot be told to use dd/mm/yyyy, so every one of them was replaced
// by these two.
export { DateField, DateTimeField } from './DateField';
export type { DateFieldProps, DateTimeFieldProps } from './DateField';

// Deferred Phase 7 stub (typed placeholder) — promote when a module needs it.
export { FormPage } from './stubs';

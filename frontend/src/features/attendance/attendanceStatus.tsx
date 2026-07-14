/**
 * Attendance status vocabulary — the single source of truth for how each status reads
 * (label + palette color + icon). Per design-system §7.6 / §9.1 attendance statuses use
 * "label + color + icon, never color alone" (WCAG 1.4.1). Reused by the register control
 * and the summary chips so the four statuses look identical everywhere.
 */
import type { ReactElement } from 'react';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import type { AttendanceStatus } from '@shared/types/enums';

export interface AttendanceStatusMeta {
  value: AttendanceStatus;
  label: string;
  /** MUI palette color used for the toggle + chip. */
  color: 'success' | 'error' | 'warning' | 'info';
  icon: ReactElement;
}

export const ATTENDANCE_STATUS_META: readonly AttendanceStatusMeta[] = [
  { value: 'present', label: 'Present', color: 'success', icon: <CheckCircleOutlineIcon fontSize="small" /> },
  { value: 'absent', label: 'Absent', color: 'error', icon: <CancelOutlinedIcon fontSize="small" /> },
  { value: 'late', label: 'Late', color: 'warning', icon: <AccessTimeIcon fontSize="small" /> },
  { value: 'excused', label: 'Excused', color: 'info', icon: <EventBusyOutlinedIcon fontSize="small" /> },
];

export const attendanceStatusMeta = (status: AttendanceStatus): AttendanceStatusMeta =>
  ATTENDANCE_STATUS_META.find((m) => m.value === status) ?? ATTENDANCE_STATUS_META[0]!;

/** FR-ATT-02: unrecorded rows default to Present in the UI. */
export const DEFAULT_STATUS: AttendanceStatus = 'present';

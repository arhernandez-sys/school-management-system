import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import type { AttendanceStatus } from '@shared/types/enums';
import { ATTENDANCE_STATUS_META } from '../attendanceStatus';

export interface AttendanceStatusToggleProps {
  value: AttendanceStatus;
  onChange: (next: AttendanceStatus) => void;
  disabled?: boolean;
  /** Accessible group label (e.g. the student name) so SR users know what this sets. */
  ariaLabel: string;
}

/**
 * Tablet-first segmented control for one student's attendance (design-system §7.6, #19).
 * Full-width `ToggleButtonGroup` with ≥44px touch targets; each option carries an icon +
 * label (never color alone). Selecting an option is a single tap; the group is arrow-key
 * navigable (MUI ToggleButtonGroup default) for keyboard users.
 */
export function AttendanceStatusToggle({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: AttendanceStatusToggleProps) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      onChange={(_e, next: AttendanceStatus | null) => {
        // Ignore deselection (null) — a student always has exactly one status.
        if (next) onChange(next);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      fullWidth
      size="small"
      sx={{ flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
    >
      {ATTENDANCE_STATUS_META.map((meta) => (
        <ToggleButton
          key={meta.value}
          value={meta.value}
          color={meta.color}
          aria-label={meta.label}
          sx={{
            minHeight: 44,
            minWidth: { xs: '25%', sm: 88 },
            gap: 0.5,
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          {meta.icon}
          {meta.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export default AttendanceStatusToggle;

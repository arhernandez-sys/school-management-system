import { MenuItem, Stack, TextField } from '@mui/material';
import { DEMO_TODAY } from '@shared/api/mocks/demo/dataset';
import type { AttendanceSectionsResponse } from '../types';

export interface AttendanceToolbarProps {
  sections: AttendanceSectionsResponse['items'];
  sectionId: string | null;
  onSectionChange: (sectionId: string) => void;
  /** Date controls only appear on the register (summary is window-wide). */
  date?: string;
  onDateChange?: (date: string) => void;
  showDate?: boolean;
  disabled?: boolean;
}

/**
 * Section + date pickers for attendance. Section is required; date defaults to "today"
 * (DEMO_TODAY) and is capped at today so future dates cannot be chosen (FR-ATT-05) — the
 * server also rejects them. Both selections are lifted to the parent, which persists them
 * to the URL (?section_id=&date=).
 */
export function AttendanceToolbar({
  sections,
  sectionId,
  onSectionChange,
  date,
  onDateChange,
  showDate = true,
  disabled = false,
}: AttendanceToolbarProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ mb: 3, alignItems: { sm: 'flex-end' } }}
    >
      <TextField
        select
        label="Class / homeroom"
        value={sectionId ?? ''}
        onChange={(e) => onSectionChange(e.target.value)}
        disabled={disabled || sections.length === 0}
        sx={{ minWidth: 240 }}
        helperText={sections.length === 0 ? 'No classes available' : ' '}
      >
        {sections.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name} · {s.enrolled_count} students
          </MenuItem>
        ))}
      </TextField>

      {showDate && onDateChange && (
        <TextField
          label="Date"
          type="date"
          value={date ?? DEMO_TODAY}
          onChange={(e) => onDateChange(e.target.value)}
          disabled={disabled}
          inputProps={{ max: DEMO_TODAY }}
          InputLabelProps={{ shrink: true }}
          helperText="Future dates are disabled"
          sx={{ minWidth: 200 }}
        />
      )}
    </Stack>
  );
}

export default AttendanceToolbar;

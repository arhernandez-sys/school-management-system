import { MenuItem, Stack, TextField } from '@mui/material';
import { DEMO_TODAY } from '@shared/api/mocks/demo/dataset';
import { YearSelect } from '@shared/components';
import type { YearOption } from '@shared/hooks';
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
  /** Optional academic-year picker (shown when year props are supplied). */
  years?: YearOption[];
  yearId?: string;
  activeYearId?: string;
  onYearChange?: (yearId: string) => void;
  yearsLoading?: boolean;
}

/**
 * Year + section (+ optional date) pickers for attendance. Section is required; date
 * defaults to "today" (DEMO_TODAY) and is capped at today so future dates cannot be chosen
 * (FR-ATT-05) — the server also rejects them. Selections are lifted to the parent, which
 * persists them to the URL (?section_id=&date=).
 *
 * Teacher / Form / Section narrowing filters used to live here for principal/secretary;
 * they now belong to the Grades module. The summary is scoped by Year + Class/homeroom only.
 *
 * All controls use `size="small"` and top-align so the year picker lines up with the
 * class/homeroom field regardless of which fields reserve a helper-text row.
 */
export function AttendanceToolbar({
  sections,
  sectionId,
  onSectionChange,
  date,
  onDateChange,
  showDate = true,
  disabled = false,
  years,
  yearId,
  activeYearId,
  onYearChange,
  yearsLoading = false,
}: AttendanceToolbarProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ mb: 3, alignItems: { sm: 'flex-start' }, flexWrap: 'wrap' }}
    >
      {years && onYearChange && (
        <YearSelect
          value={yearId}
          onChange={onYearChange}
          years={years}
          activeYearId={activeYearId}
          isLoading={yearsLoading}
        />
      )}

      <TextField
        select
        size="small"
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
          size="small"
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

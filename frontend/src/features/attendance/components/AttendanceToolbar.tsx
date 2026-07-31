import { MenuItem, Stack, TextField } from '@mui/material';
import { schoolToday } from '@shared/utils/schoolDate';
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
 * defaults to the school-local today (`schoolToday()`, America/Belize — matching the
 * backend's `school_today()`) and is capped there so future dates cannot be chosen
 * (FR-ATT-05) — the server also rejects them with `future_date_not_allowed`. Selections
 * are lifted to the parent, which persists them to the URL (?section_id=&date=).
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
  // Resolved once per render: both the fallback value and the `max` cap must be the
  // REAL school-local today. This used to be the demo dataset's fixed 2025-10-15,
  // which capped the picker in the past and made the current day unselectable.
  const today = schoolToday();

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
          value={date ?? today}
          onChange={(e) => onDateChange(e.target.value)}
          disabled={disabled}
          inputProps={{ max: today }}
          InputLabelProps={{ shrink: true }}
          helperText="Future dates are disabled"
          sx={{ minWidth: 200 }}
        />
      )}
    </Stack>
  );
}

export default AttendanceToolbar;

import { MenuItem, Stack, TextField } from '@mui/material';
import { schoolToday } from '@shared/utils/schoolDate';
import { YearSelect } from '@shared/components';
import type { YearOption } from '@shared/hooks';
import type { AttendanceOfferingsResponse } from '../types';

export interface AttendanceToolbarProps {
  offerings: AttendanceOfferingsResponse['items'];
  offeringId: string | null;
  onOfferingChange: (offeringId: string) => void;
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
 * Year + offering (+ optional date) pickers for attendance. The offering is required; date
 * defaults to the school-local today (`schoolToday()`, America/Belize — matching the
 * backend's `school_today()`) and is capped there so future dates cannot be chosen
 * (FR-ATT-05) — the server also rejects them with `future_date_not_allowed`. Selections
 * are lifted to the parent, which persists them to the URL (?offering_id=&date=).
 *
 * The register is per OFFERING, so this picker lists the offerings the caller teaches. A
 * student can be present in Biology and absent in Algebra on the same day.
 *
 * **D31 renamed the param**: `?section_id=` became `?offering_id=`. The old name was kept
 * through D29 on the reasoning that "it addresses a `classes` row, which is what it always
 * did" — and that is precisely why it had to change once the row became an offering.
 *
 * The option label is the offering's SERVER-DERIVED `label` (course code + section). It
 * previously printed the homeroom's `name`, a column that no longer exists.
 *
 * Lecturer / Form / Section narrowing filters used to live here for the Dean and Registrar;
 * they now belong to the Grades module. The summary is scoped by Year + Offering only.
 *
 * All controls use `size="small"` and top-align so the year picker lines up with the
 * offering field regardless of which fields reserve a helper-text row.
 */
export function AttendanceToolbar({
  offerings,
  offeringId,
  onOfferingChange,
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
        label="Course offering"
        value={offeringId ?? ''}
        onChange={(e) => onOfferingChange(e.target.value)}
        disabled={disabled || offerings.length === 0}
        sx={{ minWidth: 260 }}
        helperText={offerings.length === 0 ? 'No course offerings available' : ' '}
      >
        {offerings.map((o) => (
          <MenuItem key={o.offering.id} value={o.offering.id}>
            {o.offering.label} · {o.enrolled_count} students
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

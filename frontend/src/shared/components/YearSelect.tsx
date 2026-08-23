import { MenuItem, TextField } from '@mui/material';
import type { YearOption } from '@shared/hooks/useYearFilter';

/**
 * YearSelect — a compact academic-year picker shown beside a module's search bar.
 *
 * Presentational: the caller owns the selected value + change handler (see
 * `useYearFilter`). Renders each year with an "· active" hint so the current year is
 * obvious. Kept intentionally small so it sits inline in the FilterBar filters slot.
 */
export interface YearSelectProps {
  value: string | undefined;
  onChange: (yearId: string) => void;
  years: YearOption[];
  activeYearId?: string | undefined;
  isLoading?: boolean;
  label?: string;
  /** Stretch to the container. For grid/stacked layouts (D33 — the filters modal). */
  fullWidth?: boolean;
}

export function YearSelect({
  value,
  onChange,
  years,
  activeYearId,
  isLoading = false,
  label = 'Year',
  fullWidth = false,
}: YearSelectProps) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading || years.length === 0}
      fullWidth={fullWidth}
      sx={fullWidth ? undefined : { minWidth: 150 }}
    >
      {years.map((y) => (
        <MenuItem key={y.id} value={y.id}>
          {y.name}
          {y.id === activeYearId ? ' · active' : ''}
        </MenuItem>
      ))}
    </TextField>
  );
}

export default YearSelect;

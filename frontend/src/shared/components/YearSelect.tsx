import { MenuItem, TextField } from '@mui/material';
import type { YearOption } from '@shared/hooks/useYearFilter';

/**
 * The value that means "do not scope by year at all" (D38).
 *
 * A sentinel rather than `''` or `undefined`: both of those already mean "nothing chosen
 * yet" to `useYearFilter`, which resolves them to the ACTIVE year. "All years" is a
 * deliberate choice that has to survive that resolution, so it needs a value of its own.
 * Callers translate it to an absent `academic_year_id` on the query.
 */
export const ALL_YEARS = 'all';

/**
 * YearSelect — a compact academic-year picker shown beside a module's search bar.
 *
 * Presentational: the caller owns the selected value + change handler (see
 * `useYearFilter`). Renders each year with an "· active" hint so the current year is
 * obvious. Kept intentionally small so it sits inline in the FilterBar filters slot.
 *
 * **`allowAll` is opt-in, not the default.** Most modules are year-scoped for a reason —
 * a timetable or a grade sheet across every year at once is not a view anyone wants — so
 * only the callers for which "all years" is a real question offer it (D38: the students
 * directory, where the client asked to be able to see the whole register).
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
  /** Offer an "All years" option, whose value is `ALL_YEARS`. Off by default. */
  allowAll?: boolean;
}

export function YearSelect({
  value,
  onChange,
  years,
  activeYearId,
  isLoading = false,
  label = 'Year',
  fullWidth = false,
  allowAll = false,
}: YearSelectProps) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      // With `allowAll` there is still something to pick even before the years arrive, so
      // an empty list is only a reason to disable when "All years" is not on offer.
      disabled={isLoading || (years.length === 0 && !allowAll)}
      fullWidth={fullWidth}
      sx={fullWidth ? undefined : { minWidth: 150 }}
    >
      {allowAll && (
        <MenuItem value={ALL_YEARS}>
          <em>All years</em>
        </MenuItem>
      )}
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

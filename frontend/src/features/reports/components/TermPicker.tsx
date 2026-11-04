import { useMemo } from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useSemesters } from '../hooks/useReports';
import { useAcademicYears } from '@features/settings/hooks/useSettings';

/**
 * TermPicker — semester selector for the report card (FR-RPT-07).
 *
 * ⚠️ WITHOUT `academicYearId` THIS LISTS EVERY TERM OF EVERY YEAR. `GET
 * /settings/semesters` only filters when `academic_year_id` is supplied, and
 * `ReportCardScreen` renders this picker without it — deliberately, so staff can print
 * an archived year's report card (the backend serves those from frozen snapshots).
 *
 * That made the options ambiguous the moment a second year existed. Terms are named per
 * year, so the list read:
 *
 *     Semester 1 / Semester 2 / Semester 1 (active) / Semester 2
 *
 * with no way to tell which year each belonged to — and in an order derived from
 * `ORDER BY academic_year_id`, i.e. by UUID, so not even chronological. Picking the
 * wrong "Semester 1" prints the wrong year's report card, which on an official document
 * is a serious error and an easy one to miss.
 *
 * Fixed here rather than in the API: the semester payload carries `academic_year_id` but
 * not the year's NAME, and adding a field would diverge from the MSW handler that is the
 * binding contract for this endpoint. The years are already cached app-wide
 * (`useAcademicYears`, 5-minute staleTime), so joining client-side costs no extra
 * request in practice.
 *
 * Ordering matches the rest of the app's year affordances: newest year first (by name
 * descending, the same convention `useYearFilter` uses), then term sequence ascending.
 */
export interface TermPickerProps {
  value: string;
  onChange: (semesterId: string) => void;
  /** Restrict to a single academic year's semesters (default: ALL years). */
  academicYearId?: string;
  label?: string;
}

export function TermPicker({ value, onChange, academicYearId, label = 'Session' }: TermPickerProps) {
  const { data: semesters = [], isLoading } = useSemesters(academicYearId);
  const yearsQuery = useAcademicYears();

  const options = useMemo(() => {
    const yearNameById = new Map<string, string>(
      (yearsQuery.data?.items ?? []).map((y) => [y.id, y.name]),
    );
    return semesters
      .map((s) => {
        const yearName = yearNameById.get(s.academic_year_id);
        return {
          id: s.id,
          sequence: s.sequence,
          isActive: s.is_active,
          yearName,
          // Fall back to the bare term name if the year is not in the cache yet, so a
          // slow/failed years request degrades to the old label instead of "undefined".
          label: yearName ? `${s.name} · ${yearName}` : s.name,
          sortKey: yearName ?? '',
        };
      })
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || a.sequence - b.sequence);
  }, [semesters, yearsQuery.data]);

  const handleChange = (e: SelectChangeEvent) => onChange(e.target.value);

  return (
    <FormControl sx={{ minWidth: 260 }} size="small" disabled={isLoading}>
      <InputLabel id="report-term-label">{label}</InputLabel>
      <Select labelId="report-term-label" label={label} value={value} onChange={handleChange}>
        {options.map((o) => (
          <MenuItem key={o.id} value={o.id}>
            {o.label}
            {o.isActive ? ' (active)' : ''}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default TermPicker;

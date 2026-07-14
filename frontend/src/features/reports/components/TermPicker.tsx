import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useSemesters } from '../hooks/useReports';

/**
 * TermPicker — semester selector for the report card (FR-RPT-07). Lists the terms of
 * the active academic year; the caller controls the selected value and default.
 */
export interface TermPickerProps {
  value: string;
  onChange: (semesterId: string) => void;
  /** Restrict to a single academic year's semesters (default: active year). */
  academicYearId?: string;
  label?: string;
}

export function TermPicker({ value, onChange, academicYearId, label = 'Term' }: TermPickerProps) {
  const { data: semesters = [], isLoading } = useSemesters(academicYearId);

  const handleChange = (e: SelectChangeEvent) => onChange(e.target.value);

  return (
    <FormControl sx={{ minWidth: 220 }} size="small" disabled={isLoading}>
      <InputLabel id="report-term-label">{label}</InputLabel>
      <Select
        labelId="report-term-label"
        label={label}
        value={value}
        onChange={handleChange}
      >
        {semesters.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name}
            {s.is_active ? ' (active)' : ''}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default TermPicker;

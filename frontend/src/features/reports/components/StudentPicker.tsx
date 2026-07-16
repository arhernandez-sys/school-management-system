import { useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { useDebounce } from '@shared/hooks';
import { useReportStudents } from '../hooks/useReports';
import type { StudentRef } from '../types';

/**
 * StudentPicker — debounced, server-searched Autocomplete for choosing the report's
 * subject student (P/S: any; teacher: own students — the server scopes the result).
 * Fully keyboard-operable via MUI Autocomplete with a labelled input.
 */
export interface StudentPickerProps {
  value: StudentRef | null;
  onChange: (student: StudentRef | null) => void;
  label?: string;
}

export function StudentPicker({ value, onChange, label = 'Student' }: StudentPickerProps) {
  const [input, setInput] = useState('');
  const search = useDebounce(input, 300);
  const { data, isLoading } = useReportStudents({ search: search || undefined, page_size: 5 });

  const options = data?.items ?? [];

  return (
    <Autocomplete<StudentRef>
      value={value}
      onChange={(_, next) => onChange(next)}
      inputValue={input}
      onInputChange={(_, next) => setInput(next)}
      options={options}
      loading={isLoading}
      getOptionLabel={(o) => `${o.full_name} (${o.student_number})`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      // The server already filters; don't re-filter the fetched page client-side.
      filterOptions={(opts) => opts}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Search by name or student number"
          size="small"
          fullWidth
        />
      )}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          {option.full_name} · {option.student_number}
          {option.section_name ? ` · ${option.section_name}` : ''}
        </li>
      )}
      sx={{ width: { xs: '100%', sm: 360 } }}
    />
  );
}

export default StudentPicker;

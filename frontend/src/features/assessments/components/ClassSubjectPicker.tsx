import {
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Skeleton,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import type { ClassSubjectRef } from '../hooks/useAssessments';

export interface ClassSubjectPickerProps {
  options: ClassSubjectRef[];
  /** Selected class_subject_id, or '' when none chosen. */
  value: string;
  onChange: (classSubjectId: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

/**
 * Class-subject picker for the Assessments list. Presentational: the parent owns the
 * selected id (URL-persisted via `?class_subject_id=`) and the option source (scoped
 * to the caller's owned offerings for teachers, all for P/S).
 *
 * Accessibility: a labeled MUI Select; the label is associated via the FormControl so
 * screen readers announce the control's purpose.
 */
export function ClassSubjectPicker({
  options,
  value,
  onChange,
  isLoading = false,
  disabled = false,
}: ClassSubjectPickerProps) {
  if (isLoading) {
    return <Skeleton variant="rounded" width={320} height={40} aria-label="Loading class subjects" />;
  }

  const handleChange = (e: SelectChangeEvent) => onChange(e.target.value);

  return (
    <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 320 } }} disabled={disabled}>
      {/* `shrink` keeps the label floated even while the empty-state placeholder shows
          (displayEmpty), and the notched OutlinedInput opens the matching gap — without
          both, the label overlaps the "Select a class subject…" text. */}
      <InputLabel id="class-subject-picker-label" shrink>
        Class subject
      </InputLabel>
      <Select
        labelId="class-subject-picker-label"
        value={value}
        onChange={handleChange}
        displayEmpty
        input={<OutlinedInput notched label="Course offering" />}
      >
        <MenuItem value="">
          <em>Select a class subject…</em>
        </MenuItem>
        {options.map((opt) => (
          <MenuItem key={opt.class_subject_id} value={opt.class_subject_id}>
            {opt.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default ClassSubjectPicker;

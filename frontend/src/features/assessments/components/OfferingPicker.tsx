import {
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Skeleton,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import type { OfferingRef } from '../hooks/useAssessments';

export interface OfferingPickerProps {
  options: OfferingRef[];
  /** Selected offering_id, or '' when none chosen. */
  value: string;
  onChange: (offeringId: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

/**
 * Offering picker for the Assessments list. Presentational: the parent owns the selected id
 * (URL-persisted via `?offering_id=`) and the option source (scoped SERVER-side to the
 * caller's own offerings for a lecturer, all for the Dean and Registrar).
 *
 * **D31** — the option label is the server-computed `offering.label`, and the term rides
 * along after it. The term is not decoration: the same course can be offered in Semester 1
 * and again in Semester 2, and those are two different sets of assessments.
 *
 * Accessibility: a labeled MUI Select; the label is associated via the FormControl so
 * screen readers announce the control's purpose.
 */
export function OfferingPicker({
  options,
  value,
  onChange,
  isLoading = false,
  disabled = false,
}: OfferingPickerProps) {
  if (isLoading) {
    return (
      <Skeleton variant="rounded" width={320} height={40} aria-label="Loading course offerings" />
    );
  }

  const handleChange = (e: SelectChangeEvent) => onChange(e.target.value);

  return (
    <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 320 } }} disabled={disabled}>
      {/* `shrink` keeps the label floated even while the empty-state placeholder shows
          (displayEmpty), and the notched OutlinedInput opens the matching gap — without
          both, the label overlaps the "Select a course offering…" text. */}
      <InputLabel id="offering-picker-label" shrink>
        Course offering
      </InputLabel>
      <Select
        labelId="offering-picker-label"
        value={value}
        onChange={handleChange}
        displayEmpty
        input={<OutlinedInput notched label="Course offering" />}
      >
        <MenuItem value="">
          <em>Select a course offering…</em>
        </MenuItem>
        {options.map((opt) => (
          <MenuItem key={opt.id} value={opt.id}>
            {[opt.label, opt.semester?.name].filter(Boolean).join(' · ')}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default OfferingPicker;

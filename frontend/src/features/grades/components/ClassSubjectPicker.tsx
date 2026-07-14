import { Autocomplete, Box, Chip, TextField, Typography } from '@mui/material';
import type { ClassSubjectOption } from '../types';

/**
 * The gradebook selector. A searchable Autocomplete (one gradebook per section·subject,
 * D23) whose choice is URL-persisted by the parent (`?class_subject_id=`). Teachers see
 * only their own offerings; P/S see every active offering (read-only downstream).
 */
export interface ClassSubjectPickerProps {
  options: ClassSubjectOption[];
  value: ClassSubjectOption | null;
  onChange: (option: ClassSubjectOption | null) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function ClassSubjectPicker({
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
}: ClassSubjectPickerProps) {
  return (
    <Autocomplete<ClassSubjectOption>
      options={options}
      value={value}
      loading={loading}
      disabled={disabled}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={(o) => o.display_name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      sx={{ maxWidth: 480 }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Gradebook"
          placeholder="Select a class · subject…"
          size="small"
        />
      )}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                {option.subject?.name ?? 'Subject'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {option.section?.name ?? 'Class'}
                {option.teachers.length > 0 ? ` · ${option.teachers[0]!.full_name}` : ''}
              </Typography>
            </Box>
            <Chip
              size="small"
              variant="outlined"
              label={`${option.assessment_count} assessment${option.assessment_count === 1 ? '' : 's'}`}
              sx={{ ml: 1, flexShrink: 0 }}
            />
          </Box>
        );
      }}
    />
  );
}

export default ClassSubjectPicker;

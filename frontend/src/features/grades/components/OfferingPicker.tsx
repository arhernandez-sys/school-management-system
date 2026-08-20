import { Autocomplete, Box, Chip, TextField, Typography, createFilterOptions } from '@mui/material';
import type { OfferingOption } from '../types';

// Type-ahead is capped to the top 5 matches so the dropdown stays scannable.
const filterOptions = createFilterOptions<OfferingOption>({
  limit: 5,
  // Match on what the reader can see AND on the course code, which is how staff actually
  // search ("MATH1110"). The default stringify would only see the object's toString.
  stringify: (o) =>
    [o.offering.label, o.offering.course.name, o.offering.course.code, o.offering.semester?.name]
      .filter(Boolean)
      .join(' '),
});

/**
 * The gradebook selector. A searchable Autocomplete (one gradebook per offering) whose
 * choice is URL-persisted by the parent (`?offering_id=`). Lecturers see only their own
 * offerings; the Dean and Registrar see every active offering (read-only downstream).
 *
 * **D31** — the option is an OFFERING, and its display name comes from the server
 * (`offering.label`). The predecessor took a `display_name` the API assembled for this
 * screen alone; the label is now derived in one place and shared by every screen, so the
 * gradebook and the offerings list cannot name the same thing differently.
 *
 * The term is shown beneath the label because it is now load-bearing: the same course can
 * have a gradebook in Semester 1 and another in Semester 2, and those are different books.
 */
export interface OfferingPickerProps {
  options: OfferingOption[];
  value: OfferingOption | null;
  onChange: (option: OfferingOption | null) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function OfferingPicker({
  options,
  value,
  onChange,
  loading = false,
  disabled = false,
}: OfferingPickerProps) {
  return (
    <Autocomplete<OfferingOption>
      options={options}
      value={value}
      loading={loading}
      disabled={disabled}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={(o) => o.offering.label}
      filterOptions={filterOptions}
      isOptionEqualToValue={(a, b) => a.offering.id === b.offering.id}
      // Grow to fill the row (and go full-width when stacked) but never collapse so
      // narrow that the selected offering label is clipped.
      sx={{ flex: 1, width: '100%', minWidth: { xs: '100%', sm: 280 }, maxWidth: 480 }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Gradebook"
          placeholder="Select a course offering…"
          size="small"
        />
      )}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                {option.offering.course.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {[
                  option.offering.label,
                  option.offering.semester?.name,
                  option.teachers[0]?.full_name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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

export default OfferingPicker;

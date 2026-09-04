import { Autocomplete, TextField } from '@mui/material';
import type { AutocompleteProps } from '@mui/material';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional second line — a code, a staff number, a term. Also searched. */
  hint?: string;
}

export interface SearchableSelectProps {
  label: string;
  /** `''` means nothing selected. */
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  /** Adds an explicit "all"/"none" entry at the top, returning `''`. */
  allOption?: string;
  placeholder?: string;
  helperText?: string;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  sx?: AutocompleteProps<SearchableSelectOption, false, false, false>['sx'];
}

/**
 * A dropdown you can TYPE into (D43-b).
 *
 * **Why not just a `<Select>`.** The theme now caps every menu at 40vh so nothing runs
 * off the screen, and for a list of six that is the whole fix. It is not the fix for the
 * course picker: scrolling 114 courses to find `MATH1210` is a worse job than scrolling
 * a menu that was too tall, just a quieter one. Above roughly a dozen options the useful
 * control is one that filters as you type, which is what this is.
 *
 * Deliberately shaped like the `<TextField select>` it replaces — `value` / `onChange`
 * carry a plain string id, not an option object — so converting a picker is a local edit
 * and the surrounding form state does not change. That is why this exists at all rather
 * than each screen growing its own `<Autocomplete>`: five hand-rolled ones would drift.
 *
 * `hint` is searched as well as shown, so typing a course CODE finds the row even though
 * the primary label is the course name.
 */
export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  allOption,
  placeholder,
  helperText,
  error,
  required,
  disabled,
  loading,
  fullWidth,
  size = 'small',
  sx,
}: SearchableSelectProps) {
  const items: SearchableSelectOption[] = allOption
    ? [{ value: '', label: allOption }, ...options]
    : options;

  const selected = items.find((o) => o.value === value) ?? null;

  return (
    <Autocomplete
      options={items}
      value={selected}
      size={size}
      disabled={disabled}
      loading={loading}
      fullWidth={fullWidth}
      sx={sx}
      // Selecting nothing (the clear button, or the "all" row) means the empty string,
      // which is what every caller's filter state already uses for "no choice".
      onChange={(_, option) => onChange(option?.value ?? '')}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      // Match on the label AND the hint: someone looking for a course types its code.
      filterOptions={(opts, { inputValue }) => {
        const q = inputValue.trim().toLowerCase();
        if (!q) return opts;
        return opts.filter(
          (o) =>
            o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
        );
      }}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest}>
            {o.hint ? `${o.hint} — ${o.label}` : o.label}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
          required={required}
        />
      )}
    />
  );
}

export default SearchableSelect;

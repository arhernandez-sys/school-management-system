import { Box, Paper, Stack, TextField } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * FilterBar — search + filters row above a list (design-system §5 #10).
 *
 * Promoted from the Phase-6 stub for the Subjects + Users lists (Settings 7.2). It is
 * a presentational layout shell: the caller owns the search value (debounced upstream)
 * and renders any additional filter controls (e.g. role / active selects) as children.
 * URL-sync of filter state is the caller's concern, kept out of the shared component so
 * each list owns its own query-key scoping.
 *
 * Accessibility: the search field is a labeled text input with type="search".
 */
export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Additional filter controls (selects, toggles) rendered to the right of search. */
  filters?: ReactNode;
  /** Trailing actions (e.g. a "show retired" toggle). */
  trailing?: ReactNode;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  searchLabel = 'Search',
  filters,
  trailing,
}: FilterBarProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' } }}
      >
        <TextField
          label={searchLabel}
          type="search"
          size="small"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          sx={{ minWidth: { sm: 240 }, flexShrink: 0 }}
        />
        {filters}
        <Box sx={{ flexGrow: 1 }} />
        {trailing}
      </Stack>
    </Paper>
  );
}

export default FilterBar;

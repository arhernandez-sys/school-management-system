import { Box, Chip, Tooltip, Typography } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import { useGetActiveTermApiV1SettingsActiveTermGet } from '@shared/api/generated/settings/settings';
import { ApiError } from '@shared/api/client';

/**
 * Global active-term display in the app bar (design-system §5 #14, §3.1).
 *
 * Slice A: read-only. Consumes GET /settings/active-term and shows the active academic
 * year + semester. When the backend returns 409 no_active_semester (fresh install, or
 * the only active year was just archived) it degrades to the uniform "no active term"
 * setup-prompt affordance rather than crashing — this is the same 409 code every module
 * keys on (api-spec §5.11). Activation UI (changing the term) is Slice B.
 *
 * Accessibility: the chip carries a descriptive label; the no-term state uses an icon +
 * text (never color alone) and a tooltip explaining the next step.
 */
export function SemesterSwitcher() {
  const { data, error, isLoading, isError } = useGetActiveTermApiV1SettingsActiveTermGet({
    query: {
      staleTime: 5 * 60 * 1000, // reference data — changes rarely
      retry: false, // a 409 is a stable state, not a transient failure
    },
  });

  if (isLoading) {
    return (
      <Typography variant="body2" color="inherit" sx={{ opacity: 0.8 }}>
        Loading term…
      </Typography>
    );
  }

  const noActiveTerm = isError && error instanceof ApiError && error.code === 'no_active_semester';

  if (noActiveTerm) {
    return (
      <Tooltip title="No active academic term. An administrator must create and activate one.">
        <Chip
          icon={<EventBusyIcon />}
          label="No active term"
          color="warning"
          size="small"
          variant="filled"
          aria-label="No active academic term is set"
        />
      </Tooltip>
    );
  }

  // Any other error (or missing data) degrades quietly — the shell must still render.
  if (isError || !data) {
    return null;
  }

  const label = `${data.academic_year.name} · ${data.semester.name}`;

  return (
    <Tooltip title="Active academic term">
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'inherit' }}
        aria-label={`Active term: ${label}`}
      >
        <CalendarMonthIcon fontSize="small" aria-hidden />
        <Typography variant="body2" component="span" noWrap sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export default SemesterSwitcher;

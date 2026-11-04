import { MenuItem, TextField } from '@mui/material';
import type { SessionOption } from '@shared/hooks/useSessionFilter';

/** The value of the optional "all sessions" entry (see `allLabel`). */
export const ALL_SESSIONS = 'all';

/**
 * SessionSelect — the session picker shown beside `<YearSelect>`.
 *
 * Presentational, like `YearSelect`: the caller owns the value via `useSessionFilter`.
 * The active session is marked "· active"; every other session is read-only, and is
 * marked so here so nobody mistakes browsing a past session for editing it.
 */
export interface SessionSelectProps {
  value: string | undefined;
  onChange: (sessionId: string) => void;
  sessions: SessionOption[];
  isLoading?: boolean;
  label?: string;
  fullWidth?: boolean;
  /**
   * Offer an "all sessions" entry with this label, valued `ALL_SESSIONS`. Off by default:
   * only the student directory offers it, so admin roles keep the full register.
   */
  allLabel?: string;
}

export function SessionSelect({
  value,
  onChange,
  sessions,
  isLoading = false,
  label = 'Session',
  fullWidth = false,
  allLabel,
}: SessionSelectProps) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading || (sessions.length === 0 && !allLabel)}
      fullWidth={fullWidth}
      sx={fullWidth ? undefined : { minWidth: 180 }}
    >
      {allLabel && (
        <MenuItem value={ALL_SESSIONS}>
          <em>{allLabel}</em>
        </MenuItem>
      )}
      {sessions.map((s) => (
        <MenuItem key={s.id} value={s.id}>
          {s.name}
          {s.isActive ? ' · active' : ' · read-only'}
        </MenuItem>
      ))}
    </TextField>
  );
}

export default SessionSelect;

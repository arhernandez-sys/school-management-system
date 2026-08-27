import { Button, Tooltip, Typography } from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import type { StudentAssessmentLine } from '../types';

/**
 * "Remind teacher" — the principal/secretary nudge on an unreleased-but-graded
 * assessment line (`POST /assessments/{id}/nudge-release`).
 *
 * The cooldown is enforced server-side (429), but the button computes it locally
 * from `last_nudged_at` + the server-supplied window so the user sees "Reminded
 * 2h ago" and a disabled control instead of clicking into an error. The server
 * remains the authority; this is only the affordance.
 */

// The three helpers below are module-private on purpose: only this component uses
// them, and exporting non-component values from a component file breaks Fast
// Refresh (react-refresh/only-export-components). Their `now` parameters stay for
// deterministic behaviour at the call site rather than for external testing.

/** True when the line is marked but students still cannot see it. */
function isAwaitingRelease(line: StudentAssessmentLine): boolean {
  return line.status === 'graded' && !line.is_released;
}

/**
 * Coarse "2h ago" formatting. Deliberately coarse: the exact minute is noise for
 * a 4-hour cooldown, and rounding down never claims more time has passed than
 * really has (which would be the failure that re-enables the button too early).
 */
function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Seconds still to wait before this assessment may be nudged again; 0 if free. */
function cooldownRemaining(
  lastNudgedAt: string | null,
  cooldownSeconds: number,
  now: number = Date.now(),
): number {
  if (!lastNudgedAt) return 0;
  const then = new Date(lastNudgedAt).getTime();
  if (Number.isNaN(then)) return 0;
  const elapsed = (now - then) / 1000;
  return Math.max(0, Math.ceil(cooldownSeconds - elapsed));
}

export interface RemindTeacherButtonProps {
  line: StudentAssessmentLine;
  cooldownSeconds: number;
  onNudge: (assessmentId: string) => void;
  pending: boolean;
}

export function RemindTeacherButton({
  line,
  cooldownSeconds,
  onNudge,
  pending,
}: RemindTeacherButtonProps) {
  // Released or unmarked rows have nothing to chase.
  if (!isAwaitingRelease(line)) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }

  const waiting = cooldownRemaining(line.last_nudged_at, cooldownSeconds);
  const isCoolingDown = waiting > 0;
  const label = isCoolingDown
    ? `Reminded ${formatTimeAgo(line.last_nudged_at as string)}`
    : 'Remind lecturer';

  const button = (
    <span>
      <Button
        size="small"
        variant={isCoolingDown ? 'text' : 'outlined'}
        startIcon={<NotificationsActiveOutlinedIcon />}
        disabled={isCoolingDown || pending}
        onClick={() => onNudge(line.id)}
      >
        {label}
      </Button>
    </span>
  );

  // The disabled button cannot own a tooltip, hence the wrapping <span> above.
  return isCoolingDown ? (
    <Tooltip title="You can remind this lecturer again once the reminder window has passed.">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export default RemindTeacherButton;

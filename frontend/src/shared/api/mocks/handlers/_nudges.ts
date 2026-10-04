/**
 * Demo-only store for release nudges (`POST /assessments/{id}/nudge-release`).
 *
 * The real backend has no nudge column — a nudge IS an `audit_log` row, and
 * "last nudged at" is derived by reading the most recent one back
 * (`backend/app/modules/assessments/release_nudge.py`). The demo has no audit
 * table, so this in-memory map plays that part: same derived semantics, same
 * cooldown, no persistence beyond the page session.
 *
 * It lives in its own module because two handlers need it and neither owns it:
 * `grades.ts` WRITES a nudge (next to release/unrelease, where the rest of the
 * release workflow is mocked), and `students.ts` READS it back to stamp
 * `last_nudged_at` on each assessment line so the Grades tab can render
 * "Reminded 2h ago" and disable the control.
 */

/** Assessment id → ISO-8601 UTC timestamp of the most recent nudge. */
const nudgeLog = new Map<string, string>();

/**
 * Must match `NUDGE_COOLDOWN` in `backend/app/modules/assessments/release_nudge.py`.
 * Served to the SPA in the assessments envelope rather than hardcoded there, so the
 * demo exercises the same "server owns the window" path the real API uses.
 */
export const NUDGE_COOLDOWN_SECONDS = 4 * 60 * 60;

export function lastNudgedAt(assessmentId: string): string | null {
  return nudgeLog.get(assessmentId) ?? null;
}

/** Records a nudge at `now` and returns the stored ISO timestamp. */
export function recordNudge(assessmentId: string, now: Date = new Date()): string {
  const at = now.toISOString();
  nudgeLog.set(assessmentId, at);
  return at;
}

/**
 * Seconds still to wait before this assessment may be nudged again, or 0 when it
 * is outside the cooldown (or was never nudged). Mirrors the backend's 429
 * `retry_after_seconds`.
 */
export function nudgeRetryAfter(assessmentId: string, now: Date = new Date()): number {
  const last = nudgeLog.get(assessmentId);
  if (!last) return 0;
  const elapsed = (now.getTime() - new Date(last).getTime()) / 1000;
  return elapsed >= NUDGE_COOLDOWN_SECONDS ? 0 : Math.ceil(NUDGE_COOLDOWN_SECONDS - elapsed);
}

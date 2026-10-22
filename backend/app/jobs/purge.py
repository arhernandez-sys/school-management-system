"""Data-retention purge (OQ-DB6). Run: `python -m app.jobs.purge [--dry-run]`.

WHY
───────────────────────────────────────────────────────────────────────────────
Three tables are append-only and had NO reaper, so they grow for the life of the
deployment. `login_attempts` is the worst of them: every failed sign-in — including
every unknown-identifier miss from a password spray — inserts a row, so its growth
rate is set by attackers rather than by the school.

OQ-DB6 documents the intended windows; this is their implementation.

  * `login_attempts`   — older than RETENTION_LOGIN_ATTEMPTS_DAYS (90).
                         Nothing reads them beyond the current lockout window
                         (900s); the rest is forensic tail.
  * `audit_log`        — older than RETENTION_AUDIT_LOG_DAYS (365), WITH the
                         exception described under "the nudge trap" below.
  * `refresh_sessions` — expired more than RETENTION_REFRESH_SESSION_GRACE_DAYS
                         (7) ago. An expired session is already unusable: every
                         read path filters on `expires_at`/`is_revoked`, so
                         deleting one cannot log anybody out. Revoked-but-unexpired
                         rows are LEFT ALONE — they are what makes "this token was
                         revoked" distinguishable from "this token never existed".

THE NUDGE TRAP — read before changing anything about `audit_log`
───────────────────────────────────────────────────────────────────────────────
`audit_log` stopped being purely forensic. `assessments/release_nudge.py` stores a
nudge AS an audit row (`action='grade.release_nudge'`) and derives the 4-hour
re-nudge cooldown by reading the most recent one back — there is no other copy of
that state. Delete the row and the cooldown silently resets: a principal who was
correctly being told "wait, you just reminded them" can immediately nudge again,
and the teacher gets the nagging the cooldown exists to prevent. Nothing would
fail, log, or alert; the feature would just quietly stop working.

The 365-day default is nowhere near a 4-hour cooldown, so in normal operation this
cannot happen. It becomes reachable the moment somebody sets
`RETENTION_AUDIT_LOG_DAYS` low — testing the job, tidying a bloated table, a typo
of `1` for `100`. So the guard is UNCONDITIONAL rather than conditional on the
configured window: a `grade.release_nudge` row newer than the cooldown is excluded
from deletion no matter what the retention setting says, and the job reports how
many rows that protected. Correctness of a live feature outranks the retention
policy, and the exempted rows are collected on the next run anyway.

SCHEDULING IS OUT OF SCOPE
───────────────────────────────────────────────────────────────────────────────
This module provides no scheduler, timer, or in-process background task, because
the deployment target is undecided and the right answer differs for each: cron or
a systemd timer when self-hosted, the platform's scheduled-job feature on a PaaS,
a CronJob on Kubernetes. Wire it up with whatever the target provides — the
command is idempotent and safe to run repeatedly, including concurrently with the
live app (batched deletes, no long-held locks). Nightly, off-peak, is the intent.

BATCHING
───────────────────────────────────────────────────────────────────────────────
Deletes run in bounded batches (PURGE_BATCH_SIZE, default 1000) with a commit per
batch, rather than one statement per table. A single `DELETE` covering a year of
`audit_log` would hold row locks and grow the InnoDB undo log for the whole
duration, stalling concurrent writers on a table ~45 call sites write to. Batching
also means an interrupted run leaves consistent, already-committed progress
instead of rolling back everything.

Each batch selects primary keys first and then deletes by key: MariaDB supports
`DELETE ... LIMIT`, but SQLAlchemy Core has no portable spelling for it, and the
two-step form works identically on both engines this codebase has targeted.
"""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, delete, func, not_, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.timeutil import utcnow
from app.db.session import SessionLocal
from app.modules.assessments.release_nudge import NUDGE_ACTION, NUDGE_COOLDOWN
from app.modules.auth.models import LoginAttempt, RefreshSession
from app.modules.settings.models import AuditLog

logger = logging.getLogger("sis.jobs.purge")

#: Names accepted by `--only`, in execution order.
TARGETS = ("login_attempts", "audit_log", "refresh_sessions")

#: Hard stop on the batch loop. Only reachable if a DELETE reports success while
#: leaving rows matched (a FK/trigger refusing the delete), which would otherwise
#: spin forever. Bounds a single run at batch_size * this many rows per table.
_MAX_BATCHES = 10_000


@dataclass(frozen=True, slots=True)
class TableResult:
    table: str
    #: Rows deleted (or, under --dry-run, rows that WOULD be deleted).
    rows: int
    #: Human-readable description of the window applied.
    window: str
    #: Rows matching the window but deliberately spared. Currently only the
    #: in-cooldown nudge rows on `audit_log`.
    protected: int = 0


@dataclass(frozen=True, slots=True)
class PurgeReport:
    dry_run: bool
    results: tuple[TableResult, ...]

    @property
    def total(self) -> int:
        return sum(r.rows for r in self.results)


def _count(db: Session, model: Any, where: Any) -> int:
    return db.scalar(select(func.count()).select_from(model).where(where)) or 0


def _purge_batched(
    db: Session,
    model: Any,
    pk_column: Any,
    where: Any,
    *,
    batch_size: int,
    dry_run: bool,
) -> int:
    """Delete rows matching `where` in bounded batches. Returns the row count.

    Under `dry_run` NOTHING is written — it counts and returns. That is why the
    dry-run path is a `COUNT(*)` and not a rolled-back delete: a rolled-back
    delete would still take the locks and do the work this job is trying to keep
    off a live database.
    """
    if dry_run:
        return _count(db, model, where)

    total = 0
    for _ in range(_MAX_BATCHES):
        keys = list(db.scalars(select(pk_column).where(where).limit(batch_size)))
        if not keys:
            break
        result = db.execute(delete(model).where(pk_column.in_(keys)))
        db.commit()
        deleted = result.rowcount or 0
        total += deleted
        if deleted == 0:
            # Rows matched but nothing went away: something is refusing the
            # delete. Stop rather than loop on the same batch forever.
            logger.error(
                "purge_stalled table=%s matched=%s deleted=0", model.__tablename__, len(keys)
            )
            break
        if len(keys) < batch_size:
            break
    else:
        logger.error(
            "purge_batch_cap_reached table=%s batches=%s", model.__tablename__, _MAX_BATCHES
        )
    return total


def run_purge(
    db: Session,
    settings: Settings | None = None,
    *,
    dry_run: bool = False,
    batch_size: int | None = None,
    only: tuple[str, ...] | None = None,
) -> PurgeReport:
    """Apply every retention window. Safe to call repeatedly.

    Takes an explicit Session so the job is testable inside the suite's
    rolled-back transaction; `main()` supplies a real one.
    """
    settings = settings or get_settings()
    batch = batch_size or settings.purge_batch_size
    wanted = set(only or TARGETS)
    now = utcnow()
    results: list[TableResult] = []

    # ── login_attempts ────────────────────────────────────────────────────────
    if "login_attempts" in wanted:
        cutoff = now - timedelta(days=settings.retention_login_attempts_days)
        results.append(
            TableResult(
                table="login_attempts",
                rows=_purge_batched(
                    db,
                    LoginAttempt,
                    LoginAttempt.id,
                    LoginAttempt.attempted_at < cutoff,
                    batch_size=batch,
                    dry_run=dry_run,
                ),
                window=f"attempted_at < {cutoff.isoformat()} "
                f"({settings.retention_login_attempts_days}d)",
            )
        )

    # ── audit_log (see "THE NUDGE TRAP" in the module docstring) ──────────────
    if "audit_log" in wanted:
        cutoff = now - timedelta(days=settings.retention_audit_log_days)
        nudge_floor = now - NUDGE_COOLDOWN
        # A nudge row still inside its cooldown is LOAD-BEARING STATE, not
        # history. Excluded unconditionally, whatever the retention window says.
        nudge_in_cooldown = and_(
            AuditLog.action == NUDGE_ACTION,
            AuditLog.created_at >= nudge_floor,
        )
        aged_out = AuditLog.created_at < cutoff
        protected = _count(db, AuditLog, and_(aged_out, nudge_in_cooldown))
        if protected:
            # Only reachable with a retention window shorter than the 4h cooldown,
            # i.e. a misconfiguration. Say so loudly rather than silently sparing.
            logger.warning(
                "purge_protected_nudge_rows count=%s retention_days=%s cooldown_hours=%s "
                "— RETENTION_AUDIT_LOG_DAYS is shorter than the release-nudge cooldown",
                protected,
                settings.retention_audit_log_days,
                NUDGE_COOLDOWN.total_seconds() / 3600,
            )
        results.append(
            TableResult(
                table="audit_log",
                rows=_purge_batched(
                    db,
                    AuditLog,
                    AuditLog.id,
                    and_(aged_out, not_(nudge_in_cooldown)),
                    batch_size=batch,
                    dry_run=dry_run,
                ),
                window=f"created_at < {cutoff.isoformat()} "
                f"({settings.retention_audit_log_days}d), "
                f"excluding {NUDGE_ACTION} rows newer than {nudge_floor.isoformat()}",
                protected=protected,
            )
        )

    # ── refresh_sessions ──────────────────────────────────────────────────────
    if "refresh_sessions" in wanted:
        cutoff = now - timedelta(days=settings.retention_refresh_session_grace_days)
        results.append(
            TableResult(
                table="refresh_sessions",
                rows=_purge_batched(
                    db,
                    RefreshSession,
                    RefreshSession.id,
                    RefreshSession.expires_at < cutoff,
                    batch_size=batch,
                    dry_run=dry_run,
                ),
                window=f"expires_at < {cutoff.isoformat()} "
                f"({settings.retention_refresh_session_grace_days}d past expiry)",
            )
        )

    return PurgeReport(dry_run=dry_run, results=tuple(results))


def _print_report(report: PurgeReport) -> None:
    verb = "would delete" if report.dry_run else "deleted"
    print()
    for result in report.results:
        print(f"  {result.table:<18} {verb} {result.rows:>8}")
        print(f"  {'':<18} window: {result.window}")
        if result.protected:
            print(
                f"  {'':<18} PROTECTED {result.protected} in-cooldown "
                f"{NUDGE_ACTION} row(s): retention window is shorter than the "
                "release-nudge cooldown; fix RETENTION_AUDIT_LOG_DAYS."
            )
    print()
    print(f"  TOTAL {verb}: {report.total}")
    if report.dry_run:
        # ASCII only: this is operator-facing output and a Windows console at
        # cp1252 renders anything else as mojibake.
        print("  (dry run - nothing was written)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.jobs.purge",
        description="Apply data-retention windows to login_attempts, audit_log "
        "and refresh_sessions. Scheduling is the deployment's responsibility.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report the row counts that WOULD be deleted and write nothing.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Rows per DELETE statement (default: PURGE_BATCH_SIZE).",
    )
    parser.add_argument(
        "--only",
        action="append",
        choices=TARGETS,
        default=None,
        help="Limit the run to one table. Repeatable.",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    print("SIS retention purge" + (" (DRY RUN)" if args.dry_run else ""))

    db = SessionLocal()
    try:
        report = run_purge(
            db,
            settings,
            dry_run=args.dry_run,
            batch_size=args.batch_size,
            only=tuple(args.only) if args.only else None,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    _print_report(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())

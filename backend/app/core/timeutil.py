"""Time helpers: engine portability + the school-local calendar date.

**Storage is always UTC.** Every stored timestamp is UTC and every *instant*
comparison uses `utcnow()`. That does not change.

**Calendar dates are school-local** (OQ-TZ1, resolved 2026-07-27). A "date" in this
domain — the attendance date on a register, the calendar's reference day — is a
local calendar concept, not a UTC instant. The school runs in Belize (UTC-6, no
DST), so from 18:00 local onward `utcnow().date()` is already *tomorrow*. Using it
to validate an attendance date would let a teacher marking the register at 18:30
submit for what is, locally, the next day. Use `school_today()` for anything a
human would call "today"; keep `utcnow()` for timestamps and expiry windows.

MariaDB `DATETIME` columns come back timezone-NAIVE through pymysql, whereas the
former Supabase Postgres `timestamptz` columns came back AWARE. Comparing a naive
value read from the DB against an aware `now` raises
`TypeError: can't compare offset-naive and offset-aware datetimes`.

`ensure_aware()` normalizes any stored datetime to aware-UTC so comparisons behave
identically on both engines. Use it on any datetime READ BACK FROM THE DB before
comparing it with `utcnow()`.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

#: The school's civil timezone. Belize is UTC-6 year-round (no DST), which keeps
#: date arithmetic here free of spring-forward/fall-back edge cases.
#: Requires the `tzdata` package on Windows — declared in pyproject.
SCHOOL_TIMEZONE = ZoneInfo("America/Belize")


def utcnow() -> datetime:
    """Timezone-aware current UTC time. Use for stored timestamps and instants."""
    return datetime.now(tz=timezone.utc)


def school_now() -> datetime:
    """Current time in the school's timezone (aware)."""
    return datetime.now(tz=SCHOOL_TIMEZONE)


def school_today() -> date:
    """Today's date as the school would write it on a register.

    NOT `utcnow().date()` — see the module docstring. This is the correct clock for
    attendance-date validation and any user-facing "today".
    """
    return school_now().date()


def to_school_date(dt: datetime | None) -> date | None:
    """Convert a stored (UTC) timestamp to the school-local calendar date."""
    aware = ensure_aware(dt)
    return None if aware is None else aware.astimezone(SCHOOL_TIMEZONE).date()


def ensure_aware(dt: datetime | None) -> datetime | None:
    """Coerce a possibly-naive datetime to aware-UTC (naive values are assumed UTC).

    Naive → attach UTC; aware → convert to UTC; None → None."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

"""The assessment MARKING WINDOW (D47).

Every assessment gets `MARKING_WINDOW_DAYS` to be marked, counted in school-local
calendar days from the day it was held (`assessment_date`), or from the day it was
created when no date was set. The window ends at 23:59:59 America/Belize on the
last day. After that:

* mark entry is refused (409 `marking_closed`) — `grades.service.upsert_grades`;
* a blank mark counts as **0** in the term grade — `grades.calc`.

A Dean can extend it by approving a reopen request (`assessments.reopen`), which
sets `assessments.reopened_until`. The window is open while `now` is before the
LATER of the two instants, so a reopen never shortens a window that is still open.

Nothing here is stored or swept by a job: the state is computed on every read
and write, the same way the mid-term freeze is (`grades.service.midterm_freeze_state`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.core.timeutil import SCHOOL_TIMEZONE, ensure_aware, to_school_date, utcnow
from app.modules.assessments.models import Assessment

#: Calendar days a lecturer has to mark an assessment.
MARKING_WINDOW_DAYS = 5

_END_OF_DAY = time(23, 59, 59)


def marking_start_date(assessment: Assessment) -> date | None:
    """The school-local day the window counts from."""
    if assessment.assessment_date is not None:
        return assessment.assessment_date
    return to_school_date(assessment.created_at)


def marking_closes_at(assessment: Assessment) -> datetime | None:
    """The (aware, UTC) instant the ORIGINAL window ends, ignoring any reopen.

    `None` only for an unsaved row with neither a date nor a `created_at`, which
    is treated as open.
    """
    start = marking_start_date(assessment)
    if start is None:
        return None
    last_day = start + timedelta(days=MARKING_WINDOW_DAYS)
    return ensure_aware(datetime.combine(last_day, _END_OF_DAY, tzinfo=SCHOOL_TIMEZONE))


def effective_closes_at(assessment: Assessment) -> datetime | None:
    """When entry actually locks: the later of the window end and `reopened_until`."""
    closes = marking_closes_at(assessment)
    reopened = ensure_aware(assessment.reopened_until)
    if closes is None or reopened is None:
        return closes
    return max(closes, reopened)


def is_marking_open(assessment: Assessment, now: datetime | None = None) -> bool:
    closes = effective_closes_at(assessment)
    if closes is None:
        return True
    return (now or utcnow()) <= closes


@dataclass(frozen=True)
class MarkingState:
    """Everything a screen needs to explain the window."""

    open: bool
    closes_at: datetime | None
    """The original window end."""
    reopened_until: datetime | None
    effective_closes_at: datetime | None
    days_left: int | None
    """Whole school-local days until `effective_closes_at` (0 = closes today);
    `None` once closed."""


def marking_state(assessment: Assessment, now: datetime | None = None) -> MarkingState:
    now = now or utcnow()
    effective = effective_closes_at(assessment)
    is_open = effective is None or now <= effective
    days_left: int | None = None
    if is_open and effective is not None:
        today = to_school_date(now)
        last = to_school_date(effective)
        if today is not None and last is not None:
            days_left = (last - today).days
    return MarkingState(
        open=is_open,
        closes_at=marking_closes_at(assessment),
        reopened_until=ensure_aware(assessment.reopened_until),
        effective_closes_at=effective,
        days_left=days_left,
    )

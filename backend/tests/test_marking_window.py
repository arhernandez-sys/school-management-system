"""D47 — the assessment marking window (`app/modules/assessments/marking.py`).

Pure: builds unsaved `Assessment` objects and passes `now` explicitly, so no
database and no clock. The boundary is 23:59:59 America/Belize on the fifth day
after the assessment date — Belize is UTC-6 all year, so that is 05:59:59 UTC the
following calendar day.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.modules.assessments.marking import (
    MARKING_WINDOW_DAYS,
    effective_closes_at,
    is_marking_open,
    marking_closes_at,
    marking_state,
)
from app.modules.assessments.models import Assessment

UTC = timezone.utc


def _a(*, on: date | None = None, created: datetime | None = None, reopened=None) -> Assessment:
    a = Assessment(assessment_date=on, reopened_until=reopened)
    a.created_at = created
    return a


def test_the_window_is_five_days() -> None:
    assert MARKING_WINDOW_DAYS == 5


def test_closes_at_end_of_day_five_belize_time() -> None:
    a = _a(on=date(2026, 10, 1))
    # 6 Oct 23:59:59 in Belize (UTC-6) == 7 Oct 05:59:59 UTC.
    assert marking_closes_at(a) == datetime(2026, 10, 7, 5, 59, 59, tzinfo=UTC)


def test_open_on_the_last_second_and_closed_one_second_later() -> None:
    a = _a(on=date(2026, 10, 1))
    last = datetime(2026, 10, 7, 5, 59, 59, tzinfo=UTC)
    assert is_marking_open(a, last) is True
    assert is_marking_open(a, last + timedelta(seconds=1)) is False


def test_a_late_evening_utc_rollover_does_not_shorten_the_window() -> None:
    """At 02:00 UTC on 7 Oct it is still 6 Oct in Belize — still open."""
    a = _a(on=date(2026, 10, 1))
    assert is_marking_open(a, datetime(2026, 10, 7, 2, 0, tzinfo=UTC)) is True


def test_no_date_falls_back_to_the_creation_day_in_belize() -> None:
    # 1 Oct 03:00 UTC is still 30 Sep in Belize, so the window counts from 30 Sep.
    a = _a(created=datetime(2026, 10, 1, 3, 0, tzinfo=UTC))
    assert marking_closes_at(a) == datetime(2026, 10, 6, 5, 59, 59, tzinfo=UTC)


def test_a_naive_created_at_is_read_as_utc() -> None:
    """MariaDB hands DATETIME back naive; it is stored UTC."""
    a = _a(created=datetime(2026, 10, 1, 12, 0))
    assert marking_closes_at(a) == datetime(2026, 10, 7, 5, 59, 59, tzinfo=UTC)


def test_a_future_date_keeps_the_window_open_until_after_it() -> None:
    a = _a(on=date(2026, 12, 1))
    assert is_marking_open(a, datetime(2026, 11, 1, tzinfo=UTC)) is True


def test_a_reopen_extends_a_closed_window() -> None:
    reopened = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
    a = _a(on=date(2026, 10, 1), reopened=reopened)
    assert effective_closes_at(a) == reopened
    assert is_marking_open(a, datetime(2026, 10, 15, tzinfo=UTC)) is True
    assert is_marking_open(a, reopened + timedelta(seconds=1)) is False


def test_a_reopen_never_shortens_a_window_that_is_still_open() -> None:
    a = _a(on=date(2026, 10, 1), reopened=datetime(2026, 10, 2, tzinfo=UTC))
    assert effective_closes_at(a) == marking_closes_at(a)


def test_state_counts_days_left_in_school_days() -> None:
    a = _a(on=date(2026, 10, 1))
    state = marking_state(a, datetime(2026, 10, 3, 18, 0, tzinfo=UTC))  # 3 Oct noon Belize
    assert (state.open, state.days_left) == (True, 3)
    last_day = marking_state(a, datetime(2026, 10, 6, 18, 0, tzinfo=UTC))
    assert last_day.days_left == 0
    closed = marking_state(a, datetime(2026, 10, 8, tzinfo=UTC))
    assert (closed.open, closed.days_left) == (False, None)


def test_an_unsaved_row_with_no_dates_is_open() -> None:
    a = _a()
    assert marking_closes_at(a) is None
    assert is_marking_open(a, datetime(2030, 1, 1, tzinfo=UTC)) is True

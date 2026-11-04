"""Calendar events service (Module 12).

Owns DB access + transactions for the 4 calendar endpoints; the router is thin.

Authorization has two independent axes, matching the finished frontend:
  * **Manage** (create/edit/delete) — principal + secretary only. Enforced by the
    router's role dependency.
  * **See** — `global` events reach every role; `internal` events are staff-only
    and hidden from students. Enforced here, in `_visibility_clause`, so a student
    cannot reach an internal event by guessing its id either.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.core.errors import NotFound, ValidationError
from app.core.timeutil import school_today
from app.modules.events.models import Event, EventVisibility
from app.modules.events.schemas import (
    EventCreateRequest,
    EventListResponse,
    EventUpdateRequest,
    EventView,
)
from app.modules.settings.models import AuditLog
from app.modules.users.models import User


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _audit(
    db: Session,
    *,
    actor: User,
    action: str,
    entity_id: uuid.UUID | None = None,
    summary: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="event",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _visibility_clause(viewer: User) -> ColumnElement[bool]:
    """Students see `global` only; staff see everything."""
    if viewer.role == Role.STUDENT:
        return Event.visibility == EventVisibility.GLOBAL
    return Event.visibility.in_([EventVisibility.GLOBAL, EventVisibility.INTERNAL])


def _view(event: Event, author: User | None) -> EventView:
    return EventView(
        id=event.id,
        title=event.title,
        description=event.description,
        category=event.category,
        visibility=event.visibility,
        start_date=event.start_date,
        end_date=event.end_date,
        all_day=event.all_day,
        start_time=event.start_time,
        end_time=event.end_time,
        location=event.location,
        created_by={
            "id": event.created_by_user_id,
            # A RESTRICT FK means the author row always resolves; the fallback is
            # for the soft-deleted case, where the join still succeeds.
            "full_name": author.full_name if author is not None else "Unknown",
        },
        created_at=event.created_at,
    )


def _event_or_404(db: Session, event_id: uuid.UUID, *, viewer: User) -> Event:
    """Load a visible event or 404.

    An `internal` event is a 404 (not a 403) for a student — same 404-vs-403
    discipline as the rest of the API: a hidden row must not confirm it exists.
    """
    event = db.scalar(
        select(Event).where(Event.id == event_id, _visibility_clause(viewer))
    )
    if event is None:
        raise NotFound("Event not found.", code="not_found")
    return event


def _validate_dates_and_times(
    *,
    start_date: date,
    end_date: date | None,
    all_day: bool,
    start_time: object,
    end_time: object,
) -> None:
    """Cross-field rules the frontend's `EventFormDialog` also enforces."""
    fields: dict[str, list[str]] = {}

    if end_date is not None and end_date < start_date:
        fields["end_date"] = ["End date must be on or after the start date."]

    if not all_day:
        if start_time is None:
            fields["start_time"] = ["A start time is required for a timed event."]
        elif end_time is not None and end_time <= start_time:
            fields["end_time"] = ["End time must be after the start time."]

    if fields:
        raise ValidationError("Please fix the highlighted fields.", fields=fields)


def _clean(value: str | None) -> str | None:
    """Trim, and collapse an empty string to NULL so blank input reads as absent."""
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def list_events(
    db: Session,
    *,
    viewer: User,
    date_from: date | None = None,
    date_to: date | None = None,
) -> EventListResponse:
    """GET /events (all roles, visibility-scoped).

    `from`/`to` select events whose inclusive span *overlaps* the window — a
    multi-day event straddling the boundary must still appear, so this compares
    the event's end against `from` and its start against `to`, not just its start.
    """
    stmt = (
        select(Event, User)
        .outerjoin(User, User.id == Event.created_by_user_id)
        .where(_visibility_clause(viewer))
    )

    if date_from is not None:
        # COALESCE(end_date, start_date) is the event's effective last day.
        stmt = stmt.where(
            or_(
                Event.end_date.is_(None) & (Event.start_date >= date_from),
                Event.end_date >= date_from,
            )
        )
    if date_to is not None:
        stmt = stmt.where(Event.start_date <= date_to)

    stmt = stmt.order_by(Event.start_date.asc(), Event.start_time.asc(), Event.id.asc())

    return EventListResponse(
        items=[_view(event, author) for event, author in db.execute(stmt).all()],
        # School-local, not UTC — this anchors which month the calendar opens on, and
        # after 18:00 Belize time the UTC date would open next month a day early.
        reference_date=school_today(),
    )


def create_event(
    db: Session, *, actor: User, payload: EventCreateRequest
) -> EventView:
    """POST /events (P/S)."""
    _validate_dates_and_times(
        start_date=payload.start_date,
        end_date=payload.end_date,
        all_day=payload.all_day,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )

    event = Event(
        title=payload.title.strip(),
        description=_clean(payload.description),
        category=payload.category,
        visibility=payload.visibility,
        start_date=payload.start_date,
        end_date=payload.end_date,
        all_day=payload.all_day,
        # An all-day event carries no clock times, whatever the client sent.
        start_time=None if payload.all_day else payload.start_time,
        end_time=None if payload.all_day else payload.end_time,
        location=_clean(payload.location),
        created_by_user_id=actor.id,
    )
    db.add(event)
    db.flush()
    _audit(db, actor=actor, action="event.create", entity_id=event.id)
    db.commit()
    return _view(event, actor)


def update_event(
    db: Session, *, actor: User, event_id: uuid.UUID, payload: EventUpdateRequest
) -> EventView:
    """PATCH /events/{id} (P/S). Partial update; cross-field rules re-checked
    against the MERGED state, so clearing `all_day` on an existing event still
    requires a start time."""
    event = _event_or_404(db, event_id, viewer=actor)
    provided = payload.model_dump(exclude_unset=True)

    def merged(name: str):  # noqa: ANN202 - heterogeneous field types
        return provided[name] if name in provided else getattr(event, name)

    all_day = merged("all_day")
    _validate_dates_and_times(
        start_date=merged("start_date"),
        end_date=merged("end_date"),
        all_day=all_day,
        start_time=merged("start_time"),
        end_time=merged("end_time"),
    )

    if "title" in provided:
        event.title = provided["title"].strip()
    if "description" in provided:
        event.description = _clean(provided["description"])
    if "category" in provided:
        event.category = provided["category"]
    if "visibility" in provided:
        event.visibility = provided["visibility"]
    if "start_date" in provided:
        event.start_date = provided["start_date"]
    if "end_date" in provided:
        event.end_date = provided["end_date"]
    if "location" in provided:
        event.location = _clean(provided["location"])
    if "all_day" in provided:
        event.all_day = provided["all_day"]

    if event.all_day:
        # Flipping an event to all-day drops its stale clock times.
        event.start_time = None
        event.end_time = None
    else:
        if "start_time" in provided:
            event.start_time = provided["start_time"]
        if "end_time" in provided:
            event.end_time = provided["end_time"]

    _audit(db, actor=actor, action="event.update", entity_id=event.id)
    db.commit()

    author = db.scalar(select(User).where(User.id == event.created_by_user_id))
    return _view(event, author)


def delete_event(db: Session, *, actor: User, event_id: uuid.UUID) -> None:
    """DELETE /events/{id} (P/S). A HARD delete — the table has no `deleted_at`,
    and a calendar entry anchors no academic history that needs to survive."""
    event = _event_or_404(db, event_id, viewer=actor)
    _audit(
        db,
        actor=actor,
        action="event.delete",
        entity_id=event.id,
        summary={"title": event.title, "start_date": event.start_date.isoformat()},
    )
    db.delete(event)
    db.commit()

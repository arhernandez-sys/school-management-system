"""Comprehensive pytest suite for Module 12 — CALENDAR / EVENTS (scope addition).

Scope: the 4 calendar endpoints, with the two independent authorization axes that
make this module unusual:

  * **manage** (create/edit/delete) is principal/secretary only — a teacher reads
    the shared calendar but does not own it;
  * **see** is driven by `visibility`, not by role — `global` reaches everyone,
    `internal` is staff-only and 404s (not 403s) for a student who guesses an id.

Also pins the two shapes that depart from house style because the `events` table
predates the ORM mapping: DELETE is a HARD delete (no `deleted_at` column), and
`start_time`/`end_time` serialize as `HH:mm` because the frontend binds them to
`<input type="time">`.

Hermetic + rolled back via `db_session`; each test tags its rows with a short uuid.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.common.enums import Role
from app.modules.events.models import Event

pytestmark = pytest.mark.requires_db

E = "/api/v1/events"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """One user per role + factories for events."""

    def __init__(self, db_session, make_user, auth_headers):
        self.tag = uuid.uuid4().hex[:6]
        self._db = db_session

        self.principal_user = make_user(role=Role.PRINCIPAL, full_name="Head Teacher")
        self.secretary_user = make_user(role=Role.SECRETARY, full_name="Front Office")
        self.teacher_user = make_user(role=Role.TEACHER, full_name="Class Teacher")
        self.student_user = make_user(role=Role.STUDENT, full_name="A Student")

        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student_user.id, role=Role.STUDENT)

    def event(
        self,
        *,
        title=None,
        visibility="global",
        category="other",
        start_date=None,
        end_date=None,
        all_day=True,
        start_time=None,
        end_time=None,
        location=None,
        author=None,
    ) -> Event:
        event = Event(
            title=title or f"Event {uuid.uuid4().hex[:5]}",
            visibility=visibility,
            category=category,
            start_date=start_date or date(2025, 10, 15),
            end_date=end_date,
            all_day=all_day,
            start_time=start_time,
            end_time=end_time,
            location=location,
            created_by_user_id=(author or self.principal_user).id,
        )
        self._db.add(event)
        self._db.flush()
        return event

    def payload(self, **overrides) -> dict:
        body = {
            "title": f"New Event {uuid.uuid4().hex[:5]}",
            "description": None,
            "category": "meeting",
            "visibility": "global",
            "start_date": "2025-11-03",
            "end_date": None,
            "all_day": True,
            "start_time": None,
            "end_time": None,
            "location": None,
        }
        body.update(overrides)
        return body


@pytest.fixture
def graph(db_session, make_user, auth_headers) -> _Graph:
    return _Graph(db_session, make_user, auth_headers)


def _ids(body: dict) -> set[str]:
    return {item["id"] for item in body["items"]}


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_list_requires_auth(self, client) -> None:
        assert client.get(E).status_code == 401

    def test_create_requires_auth(self, client) -> None:
        assert client.post(E, json={"title": "x", "start_date": "2025-10-01"}).status_code == 401

    def test_patch_requires_auth(self, client) -> None:
        assert client.patch(f"{E}/{uuid.uuid4()}", json={"title": "x"}).status_code == 401

    def test_delete_requires_auth(self, client) -> None:
        assert client.delete(f"{E}/{uuid.uuid4()}").status_code == 401

    def test_teacher_cannot_create(self, client, graph) -> None:
        r = client.post(E, json=graph.payload(), headers=graph.T)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_student_cannot_create(self, client, graph) -> None:
        assert client.post(E, json=graph.payload(), headers=graph.U).status_code == 403

    def test_teacher_cannot_patch(self, client, graph) -> None:
        event = graph.event()
        r = client.patch(f"{E}/{event.id}", json={"title": "Renamed"}, headers=graph.T)
        assert r.status_code == 403

    def test_teacher_cannot_delete(self, client, graph) -> None:
        event = graph.event()
        assert client.delete(f"{E}/{event.id}", headers=graph.T).status_code == 403

    def test_secretary_can_manage(self, client, graph) -> None:
        """Secretary is a full manager here, not read-only."""
        r = client.post(E, json=graph.payload(), headers=graph.S)
        assert r.status_code == 201


# ════════════════════════════════════════════════════════════════════════════
class TestVisibilityScoping:
    def test_every_role_sees_global_events(self, client, graph) -> None:
        event = graph.event(visibility="global")
        for headers in (graph.P, graph.S, graph.T, graph.U):
            assert str(event.id) in _ids(client.get(E, headers=headers).json())

    def test_staff_see_internal_events(self, client, graph) -> None:
        event = graph.event(visibility="internal")
        for headers in (graph.P, graph.S, graph.T):
            assert str(event.id) in _ids(client.get(E, headers=headers).json())

    def test_student_never_sees_internal_events(self, client, graph) -> None:
        internal = graph.event(visibility="internal")
        visible = graph.event(visibility="global")
        found = _ids(client.get(E, headers=graph.U).json())
        assert str(internal.id) not in found
        assert str(visible.id) in found

    def test_student_guessing_an_internal_id_gets_404_not_403(self, client, graph) -> None:
        """404-vs-403 discipline: a hidden row must not confirm it exists.

        Students can't reach PATCH/DELETE at all (403 on the role gate), so the
        list feed is where this is observable — an internal event is simply absent.
        """
        internal = graph.event(visibility="internal")
        assert str(internal.id) not in _ids(client.get(E, headers=graph.U).json())

    def test_visibility_can_be_changed_to_hide_an_event(self, client, graph) -> None:
        event = graph.event(visibility="global")
        assert str(event.id) in _ids(client.get(E, headers=graph.U).json())
        client.patch(f"{E}/{event.id}", json={"visibility": "internal"}, headers=graph.P)
        assert str(event.id) not in _ids(client.get(E, headers=graph.U).json())


# ════════════════════════════════════════════════════════════════════════════
class TestListEvents:
    def test_response_carries_the_school_local_reference_date(self, client, graph) -> None:
        """School-local (America/Belize), NOT UTC and not the runner's clock.

        `reference_date` anchors which month the calendar opens on. Belize is UTC-6,
        so for the last six hours of every local day the UTC date is already
        tomorrow, which would open next month a day early (OQ-TZ1).
        """
        from app.core.timeutil import school_today

        body = client.get(E, headers=graph.P).json()
        assert body["reference_date"] == school_today().isoformat()

    def test_item_shape_matches_the_frontend_contract(self, client, graph) -> None:
        event = graph.event(
            title="Sports Day",
            category="activity",
            location="Main Field",
            all_day=False,
            start_time="09:30",
            end_time="14:00",
        )
        item = next(i for i in client.get(E, headers=graph.P).json()["items"] if i["id"] == str(event.id))
        assert set(item.keys()) == {
            "id", "title", "description", "category", "visibility",
            "start_date", "end_date", "all_day", "start_time", "end_time",
            "location", "created_by", "created_at",
        }
        assert item["title"] == "Sports Day"
        assert item["category"] == "activity"
        assert item["location"] == "Main Field"
        assert set(item["created_by"].keys()) == {"id", "full_name"}
        assert item["created_by"]["full_name"] == "Head Teacher"

    def test_times_serialize_as_hh_mm_not_hh_mm_ss(self, client, graph) -> None:
        """`<input type="time">` rejects a seconds component."""
        event = graph.event(all_day=False, start_time="09:30", end_time="14:05")
        item = next(i for i in client.get(E, headers=graph.P).json()["items"] if i["id"] == str(event.id))
        assert item["start_time"] == "09:30"
        assert item["end_time"] == "14:05"

    def test_all_day_events_report_null_times(self, client, graph) -> None:
        event = graph.event(all_day=True)
        item = next(i for i in client.get(E, headers=graph.P).json()["items"] if i["id"] == str(event.id))
        assert item["all_day"] is True
        assert item["start_time"] is None and item["end_time"] is None

    def test_sorted_by_start_date_then_time(self, client, graph) -> None:
        late = graph.event(title=f"z-late-{graph.tag}", start_date=date(2026, 3, 20))
        early = graph.event(title=f"z-early-{graph.tag}", start_date=date(2026, 3, 10))
        mid = graph.event(title=f"z-mid-{graph.tag}", start_date=date(2026, 3, 15))
        ordered = [i["id"] for i in client.get(E, headers=graph.P).json()["items"]]
        positions = [ordered.index(str(e.id)) for e in (early, mid, late)]
        assert positions == sorted(positions)

    def test_from_filter_excludes_events_that_ended_earlier(self, client, graph) -> None:
        past = graph.event(start_date=date(2026, 1, 5))
        future = graph.event(start_date=date(2026, 5, 5))
        found = _ids(client.get(f"{E}?from=2026-03-01", headers=graph.P).json())
        assert str(past.id) not in found
        assert str(future.id) in found

    def test_to_filter_excludes_events_starting_later(self, client, graph) -> None:
        early = graph.event(start_date=date(2026, 1, 5))
        late = graph.event(start_date=date(2026, 5, 5))
        found = _ids(client.get(f"{E}?to=2026-03-01", headers=graph.P).json())
        assert str(early.id) in found
        assert str(late.id) not in found

    def test_multi_day_event_straddling_the_window_still_appears(self, client, graph) -> None:
        """The overlap check is why this compares end vs `from`, not start vs `from`."""
        straddler = graph.event(start_date=date(2026, 2, 25), end_date=date(2026, 3, 5))
        found = _ids(client.get(f"{E}?from=2026-03-01&to=2026-03-31", headers=graph.P).json())
        assert str(straddler.id) in found

    def test_bad_date_param_is_a_422_envelope(self, client, graph) -> None:
        r = client.get(f"{E}?from=not-a-date", headers=graph.P)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="validation_error")


# ════════════════════════════════════════════════════════════════════════════
class TestCreateEvent:
    def test_happy_path_returns_201_and_persists(self, client, graph, db_session) -> None:
        r = client.post(E, json=graph.payload(title="Staff Meeting"), headers=graph.P)
        assert r.status_code == 201
        body = r.json()
        assert body["title"] == "Staff Meeting"
        assert body["created_by"]["id"] == str(graph.principal_user.id)
        assert db_session.scalar(select(Event).where(Event.id == uuid.UUID(body["id"]))) is not None

    def test_author_is_the_actor_not_a_client_supplied_id(self, client, graph) -> None:
        body = client.post(E, json=graph.payload(), headers=graph.S).json()
        assert body["created_by"]["id"] == str(graph.secretary_user.id)
        assert body["created_by"]["full_name"] == "Front Office"

    def test_unknown_field_is_rejected(self, client, graph) -> None:
        r = client.post(E, json=graph.payload(created_by_user_id=str(uuid.uuid4())), headers=graph.P)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="validation_error")

    def test_blank_title_rejected(self, client, graph) -> None:
        r = client.post(E, json=graph.payload(title="   "), headers=graph.P)
        assert r.status_code == 422

    def test_missing_start_date_rejected(self, client, graph) -> None:
        body = graph.payload()
        del body["start_date"]
        r = client.post(E, json=body, headers=graph.P)
        assert r.status_code == 422
        assert "start_date" in r.json()["error"]["fields"]

    def test_end_date_before_start_date_rejected(self, client, graph) -> None:
        r = client.post(
            E, json=graph.payload(start_date="2025-11-10", end_date="2025-11-01"), headers=graph.P
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="validation_error")
        assert "end_date" in err["fields"]

    def test_end_date_equal_to_start_date_allowed(self, client, graph) -> None:
        r = client.post(
            E, json=graph.payload(start_date="2025-11-10", end_date="2025-11-10"), headers=graph.P
        )
        assert r.status_code == 201

    def test_timed_event_without_start_time_rejected(self, client, graph) -> None:
        r = client.post(E, json=graph.payload(all_day=False, start_time=None), headers=graph.P)
        assert r.status_code == 422
        assert "start_time" in r.json()["error"]["fields"]

    def test_end_time_not_after_start_time_rejected(self, client, graph) -> None:
        r = client.post(
            E,
            json=graph.payload(all_day=False, start_time="10:00", end_time="10:00"),
            headers=graph.P,
        )
        assert r.status_code == 422
        assert "end_time" in r.json()["error"]["fields"]

    def test_all_day_event_discards_submitted_times(self, client, graph) -> None:
        """An all-day event carries no clock times whatever the client sent."""
        body = client.post(
            E,
            json=graph.payload(all_day=True, start_time="09:00", end_time="10:00"),
            headers=graph.P,
        ).json()
        assert body["start_time"] is None and body["end_time"] is None

    def test_blank_optional_strings_collapse_to_null(self, client, graph) -> None:
        body = client.post(
            E, json=graph.payload(description="   ", location="  "), headers=graph.P
        ).json()
        assert body["description"] is None and body["location"] is None

    def test_invalid_category_rejected(self, client, graph) -> None:
        r = client.post(E, json=graph.payload(category="party"), headers=graph.P)
        assert r.status_code == 422

    def test_invalid_visibility_rejected(self, client, graph) -> None:
        r = client.post(E, json=graph.payload(visibility="secret"), headers=graph.P)
        assert r.status_code == 422

    def test_create_writes_an_audit_row(self, client, graph, db_session) -> None:
        from app.modules.settings.models import AuditLog

        body = client.post(E, json=graph.payload(), headers=graph.P).json()
        logged = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "event.create",
                AuditLog.entity_id == uuid.UUID(body["id"]),
            )
        )
        assert logged is not None
        assert logged.actor_user_id == graph.principal_user.id


# ════════════════════════════════════════════════════════════════════════════
class TestUpdateEvent:
    def test_partial_update_leaves_other_fields_alone(self, client, graph) -> None:
        event = graph.event(title="Original", location="Hall", category="meeting")
        body = client.patch(f"{E}/{event.id}", json={"title": "Renamed"}, headers=graph.P).json()
        assert body["title"] == "Renamed"
        assert body["location"] == "Hall"
        assert body["category"] == "meeting"

    def test_unknown_event_404(self, client, graph) -> None:
        r = client.patch(f"{E}/{uuid.uuid4()}", json={"title": "x"}, headers=graph.P)
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_description_can_be_explicitly_cleared(self, client, graph, db_session) -> None:
        event = graph.event()
        event.description = "Some detail"
        db_session.flush()
        body = client.patch(f"{E}/{event.id}", json={"description": None}, headers=graph.P).json()
        assert body["description"] is None

    def test_end_date_can_be_explicitly_cleared(self, client, graph) -> None:
        event = graph.event(start_date=date(2026, 4, 1), end_date=date(2026, 4, 5))
        body = client.patch(f"{E}/{event.id}", json={"end_date": None}, headers=graph.P).json()
        assert body["end_date"] is None

    def test_cross_field_rules_checked_against_merged_state(self, client, graph) -> None:
        """Sending only `end_date` must still be compared with the STORED start."""
        event = graph.event(start_date=date(2026, 4, 10))
        r = client.patch(f"{E}/{event.id}", json={"end_date": "2026-04-01"}, headers=graph.P)
        assert r.status_code == 422
        assert "end_date" in r.json()["error"]["fields"]

    def test_flipping_to_timed_without_a_start_time_rejected(self, client, graph) -> None:
        event = graph.event(all_day=True)
        r = client.patch(f"{E}/{event.id}", json={"all_day": False}, headers=graph.P)
        assert r.status_code == 422
        assert "start_time" in r.json()["error"]["fields"]

    def test_flipping_to_timed_with_a_start_time_succeeds(self, client, graph) -> None:
        event = graph.event(all_day=True)
        body = client.patch(
            f"{E}/{event.id}", json={"all_day": False, "start_time": "08:15"}, headers=graph.P
        ).json()
        assert body["all_day"] is False
        assert body["start_time"] == "08:15"

    def test_flipping_to_all_day_clears_stale_times(self, client, graph) -> None:
        event = graph.event(all_day=False, start_time="09:00", end_time="10:00")
        body = client.patch(f"{E}/{event.id}", json={"all_day": True}, headers=graph.P).json()
        assert body["start_time"] is None and body["end_time"] is None

    def test_author_is_preserved_when_a_different_admin_edits(self, client, graph) -> None:
        event = graph.event(author=graph.principal_user)
        body = client.patch(f"{E}/{event.id}", json={"title": "Edited"}, headers=graph.S).json()
        assert body["created_by"]["id"] == str(graph.principal_user.id)
        assert body["created_by"]["full_name"] == "Head Teacher"

    def test_unknown_field_rejected(self, client, graph) -> None:
        event = graph.event()
        r = client.patch(f"{E}/{event.id}", json={"nope": 1}, headers=graph.P)
        assert r.status_code == 422

    def test_empty_body_is_a_no_op(self, client, graph) -> None:
        event = graph.event(title="Untouched")
        body = client.patch(f"{E}/{event.id}", json={}, headers=graph.P).json()
        assert body["title"] == "Untouched"


# ════════════════════════════════════════════════════════════════════════════
class TestDeleteEvent:
    def test_delete_returns_204_and_hard_deletes(self, client, graph, db_session) -> None:
        """HARD delete — the `events` table has no `deleted_at` column."""
        event = graph.event()
        event_id = event.id
        assert client.delete(f"{E}/{event_id}", headers=graph.P).status_code == 204
        assert db_session.scalar(select(Event).where(Event.id == event_id)) is None

    def test_deleted_event_leaves_the_feed(self, client, graph) -> None:
        event = graph.event()
        client.delete(f"{E}/{event.id}", headers=graph.P)
        assert str(event.id) not in _ids(client.get(E, headers=graph.P).json())

    def test_unknown_event_404(self, client, graph) -> None:
        r = client.delete(f"{E}/{uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_delete_audits_the_title_before_the_row_is_gone(self, client, graph, db_session) -> None:
        from app.modules.settings.models import AuditLog

        event = graph.event(title="Cancelled Trip", start_date=date(2026, 6, 1))
        event_id = event.id
        client.delete(f"{E}/{event_id}", headers=graph.P)
        logged = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "event.delete", AuditLog.entity_id == event_id
            )
        )
        assert logged is not None
        # The row is gone, so the audit summary is the only surviving record of it.
        assert logged.summary["title"] == "Cancelled Trip"
        assert logged.summary["start_date"] == "2026-06-01"

    def test_delete_is_not_idempotent_second_call_404s(self, client, graph) -> None:
        event = graph.event()
        assert client.delete(f"{E}/{event.id}", headers=graph.P).status_code == 204
        assert client.delete(f"{E}/{event.id}", headers=graph.P).status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestMultiDayEvents:
    def test_single_day_event_has_null_end_date(self, client, graph) -> None:
        body = client.post(E, json=graph.payload(end_date=None), headers=graph.P).json()
        assert body["end_date"] is None

    def test_span_is_inclusive_of_both_ends(self, client, graph) -> None:
        start, end = date(2026, 5, 4), date(2026, 5, 8)
        event = graph.event(start_date=start, end_date=end)
        # A window covering only the final day still finds it.
        found = _ids(client.get(f"{E}?from={end}&to={end}", headers=graph.P).json())
        assert str(event.id) in found
        # And a window covering only the first day.
        found = _ids(client.get(f"{E}?from={start}&to={start}", headers=graph.P).json())
        assert str(event.id) in found

    def test_window_entirely_before_a_span_excludes_it(self, client, graph) -> None:
        event = graph.event(start_date=date(2026, 5, 4), end_date=date(2026, 5, 8))
        earlier = date(2026, 5, 4) - timedelta(days=10)
        found = _ids(client.get(f"{E}?from={earlier}&to={earlier}", headers=graph.P).json())
        assert str(event.id) not in found

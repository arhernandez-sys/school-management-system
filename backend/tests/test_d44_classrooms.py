"""D44 — classrooms, and the room an offering meets in.

Oracle: `app/modules/classrooms/`, `017_sims10_reconcile.sql` §8-§9.

Before D44 the system had no idea any room existed: `class_meetings.room` was free text
typed per meeting, so "Room A", "room a" and "A" were three rooms, none capacity-checked
and none listable. The client's own dump brought a `classroom` table, and this pins the
three decisions taken while adopting it:

  1. **OCCUPANCY IS NOT ENTERED.** The column accepts `In-Use`/`Available`/`Occupied`
     because the client's data does, but the API refuses to SET them. A room marked
     `Occupied` on Monday morning is wrong by Monday afternoon, and `class_meetings`
     already knows the truth.

  2. **DELETING A ROOM IN USE IS REFUSED.** The FK is `ON DELETE SET NULL`, so the
     database would happily unroom eight scheduled classes without comment. A 409 that
     names the count is the point.

  3. **AN UNKNOWN ROOM IS A 422, NOT A 500.** Left to the FK it would surface as a driver
     error; `_validated_room_id` turns it into a field error like every other reference on
     that payload.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid

import pytest

from app.common.enums import Role
from app.modules.classrooms.models import Classroom
from app.modules.offerings.models import Course, CourseOffering
from app.modules.settings.models import AcademicYear, Semester

pytestmark = pytest.mark.requires_db

ROOMS = "/api/v1/classrooms"
OFFERINGS = "/api/v1/offerings"


@pytest.fixture
def actors(make_user, auth_headers):
    dean = make_user(role=Role.PRINCIPAL)
    registrar = make_user(role=Role.SECRETARY)
    lecturer = make_user(role=Role.TEACHER)
    return {
        "P": auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        "S": auth_headers(user_id=registrar.id, role=Role.SECRETARY),
        "T": auth_headers(user_id=lecturer.id, role=Role.TEACHER),
    }


def _body(**overrides) -> dict:
    body = {
        "room_code": f"R-{uuid.uuid4().hex[:6]}",
        "building": "Main Block",
        "capacity": 30,
        "room_type": "Lecture",
    }
    body.update(overrides)
    return body


class TestCrud:
    def test_create_and_read_back(self, client, actors) -> None:
        body = _body()
        created = client.post(ROOMS, headers=actors["S"], json=body)
        assert created.status_code == 201, created.text
        room = created.json()
        assert room["room_code"] == body["room_code"]
        assert room["status"] == "Active"
        assert room["label"] == f"{body['room_code']} · Main Block"
        assert room["edited_on"] is None  # the 015 convention

        got = client.get(f"{ROOMS}/{room['id']}", headers=actors["T"])
        assert got.status_code == 200, got.text
        assert got.json()["capacity"] == 30

    def test_a_partial_patch_does_not_blank_what_it_omits(self, client, actors) -> None:
        room = client.post(ROOMS, headers=actors["S"], json=_body()).json()
        patched = client.patch(
            f"{ROOMS}/{room['id']}", headers=actors["S"], json={"capacity": 45}
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["capacity"] == 45
        assert patched.json()["room_type"] == "Lecture"
        assert patched.json()["building"] == "Main Block"
        assert patched.json()["edited_on"] is not None

    def test_the_room_code_is_unique(self, client, actors) -> None:
        body = _body()
        assert client.post(ROOMS, headers=actors["S"], json=body).status_code == 201
        dup = client.post(ROOMS, headers=actors["S"], json=_body(room_code=body["room_code"]))
        assert dup.status_code == 409
        assert dup.json()["error"]["code"] == "duplicate_room_code"

    def test_the_code_check_is_case_insensitive(self, client, actors) -> None:
        """`A-101` and `a-101` are the same door."""
        code = f"CS-{uuid.uuid4().hex[:5]}"
        client.post(ROOMS, headers=actors["S"], json=_body(room_code=code.lower()))
        dup = client.post(ROOMS, headers=actors["S"], json=_body(room_code=code.upper()))
        assert dup.status_code == 409, dup.text


class TestOccupancyIsNotEntered:
    @pytest.mark.parametrize("status", ["In-Use", "Available", "Occupied"])
    def test_the_three_occupancy_values_are_refused_on_write(
        self, client, actors, status
    ) -> None:
        resp = client.post(ROOMS, headers=actors["S"], json=_body(status=status))
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "classroom_status_not_settable"

    @pytest.mark.parametrize("status", ["Active", "Inactive"])
    def test_the_two_service_values_are_accepted(self, client, actors, status) -> None:
        resp = client.post(ROOMS, headers=actors["S"], json=_body(status=status))
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == status

    def test_a_room_that_closes_is_set_inactive(self, client, actors) -> None:
        """The alternative to deleting it. Pinned because it is what the 409 on delete
        points people towards."""
        room = client.post(ROOMS, headers=actors["S"], json=_body()).json()
        resp = client.patch(
            f"{ROOMS}/{room['id']}", headers=actors["S"], json={"status": "Inactive"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "Inactive"


class TestPermissions:
    def test_a_lecturer_may_read(self, client, actors) -> None:
        """A room code is on every timetable; there is nothing private about it."""
        assert client.get(ROOMS, headers=actors["T"]).status_code == 200

    def test_a_lecturer_may_not_write(self, client, actors) -> None:
        assert client.post(ROOMS, headers=actors["T"], json=_body()).status_code == 403

    def test_the_dean_may_write(self, client, actors) -> None:
        assert client.post(ROOMS, headers=actors["P"], json=_body()).status_code == 201

    def test_unauthenticated_is_401(self, client) -> None:
        assert client.get(ROOMS).status_code == 401


class TestTheRoomOnAnOffering:
    @pytest.fixture
    def offering_ctx(self, db_session, archive_seeded_active_year):
        # `uq_academic_years_one_active` permits exactly one active year, and the seeded
        # database already has one. Same fixture the attendance suite uses.
        from datetime import date

        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        year = AcademicYear(
            name=f"RoomYear {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 6, 30),
        )
        db_session.add(year)
        db_session.flush()
        sem = Semester(
            academic_year_id=year.id,
            name="Semester 1",
            sequence=1,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 1, 31),
        )
        course = Course(name=f"Room Course {tag}", code=f"RC{tag.upper()}")
        db_session.add_all([sem, course])
        db_session.flush()
        return sem, course

    def test_an_offering_can_be_given_and_then_cleared_a_room(
        self, client, actors, offering_ctx, db_session
    ) -> None:
        sem, course = offering_ctx
        room = client.post(ROOMS, headers=actors["S"], json=_body()).json()

        created = client.post(
            OFFERINGS,
            headers=actors["S"],
            json={
                "course_id": str(course.id),
                "semester_id": str(sem.id),
                "classroom_id": room["id"],
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["classroom"]["id"] == room["id"]
        assert created.json()["classroom"]["label"] == room["label"]

        # An EXPLICIT null unassigns; the field is in `model_fields_set` either way.
        cleared = client.patch(
            f"{OFFERINGS}/{created.json()['id']}",
            headers=actors["S"],
            json={"classroom_id": None},
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["classroom"] is None

    def test_an_offering_without_a_room_is_fine(
        self, client, actors, offering_ctx
    ) -> None:
        """The state all 19 pre-D44 offerings are in."""
        sem, course = offering_ctx
        created = client.post(
            OFFERINGS,
            headers=actors["S"],
            json={"course_id": str(course.id), "semester_id": str(sem.id)},
        )
        assert created.status_code == 201, created.text
        assert created.json()["classroom"] is None

    def test_an_unknown_room_is_a_422_not_a_500(
        self, client, actors, offering_ctx
    ) -> None:
        sem, course = offering_ctx
        resp = client.post(
            OFFERINGS,
            headers=actors["S"],
            json={
                "course_id": str(course.id),
                "semester_id": str(sem.id),
                "classroom_id": str(uuid.uuid4()),
            },
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "classroom_not_found"

    def test_deleting_a_room_in_use_is_refused(
        self, client, actors, offering_ctx
    ) -> None:
        """The FK would SET NULL and silently unroom the class. 409 with the count
        instead, and a pointer at the Inactive alternative."""
        sem, course = offering_ctx
        room = client.post(ROOMS, headers=actors["S"], json=_body()).json()
        client.post(
            OFFERINGS,
            headers=actors["S"],
            json={
                "course_id": str(course.id),
                "semester_id": str(sem.id),
                "classroom_id": room["id"],
            },
        )

        resp = client.delete(f"{ROOMS}/{room['id']}", headers=actors["S"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"]["code"] == "classroom_in_use"
        assert "1 course offering" in resp.json()["error"]["message"]

    def test_an_unused_room_deletes(self, client, actors, db_session) -> None:
        room = client.post(ROOMS, headers=actors["S"], json=_body()).json()
        assert client.delete(f"{ROOMS}/{room['id']}", headers=actors["S"]).status_code == 204
        # HARD delete — a room carries no history worth keeping.
        assert db_session.get(Classroom, uuid.UUID(room["id"])) is None

    def test_the_offering_count_is_reported(
        self, client, actors, offering_ctx
    ) -> None:
        sem, course = offering_ctx
        room = client.post(ROOMS, headers=actors["S"], json=_body()).json()
        client.post(
            OFFERINGS,
            headers=actors["S"],
            json={
                "course_id": str(course.id),
                "semester_id": str(sem.id),
                "classroom_id": room["id"],
            },
        )
        got = client.get(f"{ROOMS}/{room['id']}", headers=actors["S"]).json()
        assert got["offering_count"] == 1

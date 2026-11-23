"""D41 — `PATCH /offerings/{id}` gets its first caller, and presence vs. null starts to matter.

The endpoint has existed since D31 and **nothing called it** — `useOfferings.ts` carried a
note saying so. That is why the bug below survived: every field on `OfferingUpdateRequest`
is `X | None`, and the service read an explicit `null` as "not supplied". Both nullable
fields are ones the offerings list's new Edit button can legitimately CLEAR:

  * `capacity = null` means **no limit**, which is not 0 and is the state a new offering
    starts in;
  * `section_code = null` means **the only section**, which is what the unique index's
    `COALESCE` is built around.

Under the old rule a Dean would blank either field, press Save, get a 200, and watch the
old value come back with nothing to explain it. `model_fields_set` is what separates the
two cases — the same arm `update_student` already uses.

The MSW handler was ALREADY correct (`body.x !== undefined`), so demo mode would have
certified a screen the real API silently refused. That asymmetry is the reason these are
pinned server-side rather than left to the mock.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid

import pytest

from app.common.enums import Role
from app.modules.offerings.models import Course, CourseOffering

pytestmark = pytest.mark.requires_db

OFFERINGS = "/api/v1/offerings"


@pytest.fixture
def staff_headers(make_user, auth_headers):
    user = make_user(role=Role.PRINCIPAL)
    return auth_headers(user_id=user.id, role=Role.PRINCIPAL)


@pytest.fixture
def course(db_session):
    tag = uuid.uuid4().hex[:6]
    c = Course(name=f"Course {tag}", code=f"C{tag.upper()}", credits=3)
    db_session.add(c)
    db_session.flush()
    return c


@pytest.fixture
def offering(db_session, make_offering, course):
    """One offering with BOTH nullable fields populated, so each has something to clear."""
    return make_offering(course.id, section_code="01", capacity=30)


def _patch(client, headers, offering_id, body):
    return client.patch(f"{OFFERINGS}/{offering_id}", headers=headers, json=body)


class TestExplicitNullClears:
    def test_null_capacity_clears_the_limit(self, client, staff_headers, offering) -> None:
        r = _patch(client, staff_headers, offering.id, {"capacity": None})
        assert r.status_code == 200, r.text
        assert r.json()["capacity"] is None

    def test_null_section_code_clears_it(self, client, staff_headers, offering) -> None:
        r = _patch(client, staff_headers, offering.id, {"section_code": None})
        assert r.status_code == 200, r.text
        assert r.json()["section_code"] is None

    def test_blank_section_code_also_clears_it(self, client, staff_headers, offering) -> None:
        """`""` and `null` are the same instruction — the form sends whichever its state
        produced, and both mean "this is the only section"."""
        r = _patch(client, staff_headers, offering.id, {"section_code": "   "})
        assert r.status_code == 200, r.text
        assert r.json()["section_code"] is None


class TestAbsenceStillMeansLeaveAlone:
    def test_omitted_fields_are_untouched(self, client, staff_headers, offering) -> None:
        """The whole point of a PATCH. Editing the capacity must not blank the section."""
        r = _patch(client, staff_headers, offering.id, {"capacity": 25})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["capacity"] == 25
        assert body["section_code"] == "01"
        assert body["is_archived"] is False

    def test_empty_body_changes_nothing(self, client, staff_headers, offering) -> None:
        r = _patch(client, staff_headers, offering.id, {})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["capacity"] == 30
        assert body["section_code"] == "01"


class TestArchive:
    """The Edit dialog is the ONLY write path to `is_archived` anywhere in the app — the
    list has printed an Active/Archived badge since D31 with nothing able to set it."""

    def test_archiving_is_not_a_one_way_door(self, client, staff_headers, offering) -> None:
        """THE REGRESSION. `_assert_year_writable` runs before the payload is read and
        used to refuse any write on an archived offering — so the PATCH that would clear
        the flag was refused *because the flag was set*. An offering archived by mistake
        could not be restored by any route in the system, and nothing noticed because
        nothing called this endpoint until the list got an Edit button."""
        assert _patch(client, staff_headers, offering.id, {"is_archived": True}).status_code == 200
        restored = _patch(client, staff_headers, offering.id, {"is_archived": False})
        assert restored.status_code == 200, restored.text
        assert restored.json()["is_archived"] is False

    def test_an_archived_offering_can_still_have_its_capacity_edited(
        self, client, staff_headers, offering
    ) -> None:
        """Follows from the exemption above, and is the right behaviour: correcting a
        typo on a retired offering should not require un-retiring it first."""
        _patch(client, staff_headers, offering.id, {"is_archived": True})
        r = _patch(client, staff_headers, offering.id, {"capacity": 12})
        assert r.status_code == 200, r.text
        assert r.json()["capacity"] == 12
        assert r.json()["is_archived"] is True

    def test_archive_then_restore(self, client, staff_headers, offering) -> None:
        assert _patch(client, staff_headers, offering.id, {"is_archived": True}).json()[
            "is_archived"
        ]
        assert not _patch(client, staff_headers, offering.id, {"is_archived": False}).json()[
            "is_archived"
        ]

    def test_explicit_null_is_archived_is_left_alone(
        self, client, staff_headers, offering
    ) -> None:
        """The column is NOT NULL, so a null cannot be honoured. Read as "leave alone"
        rather than flushed as NULL and 500'ing."""
        _patch(client, staff_headers, offering.id, {"is_archived": True})
        r = _patch(client, staff_headers, offering.id, {"is_archived": None})
        assert r.status_code == 200, r.text
        assert r.json()["is_archived"] is True


class TestArchivedYearStillRefuses:
    def test_a_closed_year_refuses_even_a_restore(
        self, client, staff_headers, db_session, offering, archive_seeded_active_year
    ) -> None:
        """The exemption is for the OFFERING flag only. A closed year is a school-wide
        close-out, and restoring an offering inside one is still a write into a sealed
        year — which is what `allow_archived_offering` deliberately does not cover.

        **`archived_at` is stamped explicitly**, and that is not belt-and-braces.
        `archive_seeded_active_year` flips `status` and deactivates the term but leaves
        `archived_at` NULL, while `_assert_year_writable` reads `archived_at` — the real
        `archive_year` endpoint sets both (`settings/service.py`), so the fixture alone
        would let this test pass against no guard at all.
        """
        from datetime import datetime, timezone

        _patch(client, staff_headers, offering.id, {"is_archived": True})
        year = archive_seeded_active_year()
        assert year is not None
        year.archived_at = datetime.now(tz=timezone.utc)
        db_session.flush()

        r = _patch(client, staff_headers, offering.id, {"is_archived": False})
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "year_archived"


class TestIdentityIsNotEditable:
    """`course_id` and `semester_id` are the offering's identity: changing either would
    silently move every assessment, grade and enrolment attached to it. The form renders
    them read-only; this is the server half of that promise."""

    @pytest.mark.parametrize("field", ["course_id", "semester_id"])
    def test_rejected_outright(self, client, staff_headers, offering, field) -> None:
        r = _patch(client, staff_headers, offering.id, {field: str(uuid.uuid4())})
        # `extra="forbid"` — not silently dropped.
        assert r.status_code == 422, r.text


class TestSectionCodeCollision:
    def test_clearing_onto_an_existing_blank_section_is_409(
        self, client, staff_headers, db_session, offering
    ) -> None:
        """The `COALESCE` unique index in action. Two "only section" offerings of the same
        course in the same term is the exact case it exists to refuse, and clearing a
        section code is now a way to reach it.

        Built directly rather than through `make_offering`: that factory substitutes a
        RANDOM section code for a `None`, on purpose, so several tests can put two
        offerings of one course in one term without colliding. Here the `None` IS the
        test.
        """
        sibling = CourseOffering(
            course_id=offering.course_id,
            semester_id=offering.semester_id,
            section_code=None,
        )
        db_session.add(sibling)
        db_session.flush()
        r = _patch(client, staff_headers, offering.id, {"section_code": None})
        assert r.status_code == 409, r.text

    def test_renaming_onto_a_sibling_section_is_409(
        self, client, staff_headers, offering, make_offering
    ) -> None:
        make_offering(
            offering.course_id, semester_id=offering.semester_id, section_code="02"
        )
        r = _patch(client, staff_headers, offering.id, {"section_code": "02"})
        assert r.status_code == 409, r.text

    def test_setting_its_own_section_code_again_is_fine(
        self, client, staff_headers, offering
    ) -> None:
        """The uniqueness check excludes the row itself; without that, saving the dialog
        without touching the section code would 409 against the offering being edited."""
        r = _patch(client, staff_headers, offering.id, {"section_code": "01"})
        assert r.status_code == 200, r.text
        assert r.json()["section_code"] == "01"


class TestAuthGate:
    def test_lecturer_cannot_update(self, client, make_user, auth_headers, offering) -> None:
        """`actionable_by_caller` on the list row is a LECTURER's roster/grade scope, not
        permission to edit the offering — which is why the list's Edit button is gated on
        `canWrite`, not on that flag."""
        teacher = make_user(role=Role.TEACHER)
        headers = auth_headers(user_id=teacher.id, role=Role.TEACHER)
        r = _patch(client, headers, offering.id, {"capacity": 5})
        assert r.status_code == 403, r.text

    def test_student_cannot_update(self, client, make_user, auth_headers, offering) -> None:
        student = make_user(role=Role.STUDENT)
        headers = auth_headers(user_id=student.id, role=Role.STUDENT)
        assert _patch(client, headers, offering.id, {"capacity": 5}).status_code == 403

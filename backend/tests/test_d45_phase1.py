"""D45 Phase 1 — the self-contained items from the revised blueprint.

  §8   Department Management on `programs` (client decision C4)
  §9   the requirements columns hold a paragraph
  §23  the attendance threshold is configuration, not a constant
  §24  the system VERIFIES that category weighting totals 100%
  §40  the HOD reach audit — a head can read their own student's timetable
  §42  the Dean Dashboard's admissions tiles
  §55  search by Programme and Email, and the lecturer scope that must survive it

The freeze fix (§28) lives in `test_midterm_freeze.py::TestTheClosedWindowLock` and the
System Administrator role (§2) in `test_d45_sysadmin_role.py`.
"""

from __future__ import annotations

import uuid

import pytest

from app.common.enums import Role

pytestmark = pytest.mark.requires_db

PROGRAMS = "/api/v1/programs"
SETTINGS = "/api/v1/settings"
STUDENTS = "/api/v1/students"


# ════════════════════════════════════════════════════════════════════════════
class TestDepartmentManagementOnTheProgramme:
    """§8. The blueprint assumes a Departments table; BAJC organises by PROGRAMME and
    D43 built the HOD link on `program_heads`. Asked directly, the client chose to put
    the two highlighted fields here rather than re-parent every programme and course."""

    @staticmethod
    def _create(client, H, **extra):
        body = {
            "code": f"D{uuid.uuid4().hex[:4].upper()}",
            "name": f"Programme {uuid.uuid4().hex[:6]}",
            "total_credits": 60,
        }
        body.update(extra)
        return client.post(PROGRAMS, headers=H, json=body)

    def test_both_fields_round_trip_on_create(
        self, client, make_user, auth_headers
    ) -> None:
        """D40's lesson: a field added to the schema and forgotten in the SERVICE is a
        silent drop on create — the 422 that `extra="forbid"` gives you on a typo never
        fires, because the payload is valid. Asserted by reading it back."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        r = self._create(
            client,
            H,
            head_of_department="Dr. A. Flores",
            office_information="Admin Block, Room 4. Mon-Thu 09:00-15:00. ext. 210",
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["head_of_department"] == "Dr. A. Flores"
        assert body["office_information"].startswith("Admin Block")

        got = client.get(f"{PROGRAMS}/{body['id']}", headers=H).json()
        assert got["head_of_department"] == "Dr. A. Flores"

    def test_an_explicit_null_CLEARS_them(self, client, make_user, auth_headers) -> None:
        """Free text, so the same explicit-null-clears rule the D44 fields carry: a box
        you can fill and never empty again is a defect, not a safeguard."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        pid = self._create(client, H, head_of_department="Dr. A. Flores").json()["id"]

        r = client.patch(
            f"{PROGRAMS}/{pid}", headers=H, json={"head_of_department": None}
        )
        assert r.status_code == 200, r.text
        assert r.json()["head_of_department"] is None

    def test_omitting_them_LEAVES_them_alone(
        self, client, make_user, auth_headers
    ) -> None:
        """The other half of the same rule, and the one a `is not None` idiom gets
        wrong."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        pid = self._create(client, H, head_of_department="Dr. A. Flores").json()["id"]

        r = client.patch(f"{PROGRAMS}/{pid}", headers=H, json={"name": "Renamed"})
        assert r.status_code == 200, r.text
        assert r.json()["head_of_department"] == "Dr. A. Flores"

    def test_it_does_NOT_become_the_access_link(
        self, client, make_user, auth_headers
    ) -> None:
        """`head_of_department` is a DISPLAYED name. `program_heads` stays authoritative —
        it is a real FK to a teacher and it is what the HOD role's scoping reads. Typing a
        name into a text box must never grant anybody anything."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        outsider = make_user(role=Role.HOD, full_name="Dr. A. Flores")
        self._create(client, H, head_of_department="Dr. A. Flores")

        OH = auth_headers(user_id=outsider.id, role=Role.HOD)
        # Heads nothing (no `program_heads` row), so the directory is empty for them —
        # the name on the programme bought no reach at all.
        body = client.get(STUDENTS, headers=OH).json()
        assert body["total"] == 0


# ════════════════════════════════════════════════════════════════════════════
class TestTheRequirementsColumnsHoldAParagraph:
    """§9. Both were `varchar(100)` — a sentence fragment, for a field every prospectus
    prints as a paragraph. The column was never big enough for the thing it names."""

    def test_a_real_paragraph_survives_the_round_trip(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        prose = (
            "Applicants must hold a high school diploma with passes in English and "
            "Mathematics, submit two letters of recommendation, provide an official "
            "transcript from the issuing institution, and attend an interview with the "
            "programme coordinator. Applicants over 21 may substitute documented work "
            "experience for the Mathematics requirement at the Dean's discretion."
        )
        assert len(prose) > 100
        r = client.post(
            PROGRAMS,
            headers=H,
            json={
                "code": f"R{uuid.uuid4().hex[:4].upper()}",
                "name": "Requirements Test",
                "admission_requirements": prose,
            },
        )
        assert r.status_code == 201, r.text
        assert r.json()["admission_requirements"] == prose


# ════════════════════════════════════════════════════════════════════════════
class TestTheAttendanceThresholdIsConfiguration:
    """§23 + §57 — "important institutional rules should be configurable rather than
    placed directly in programming code"."""

    def test_it_is_reported_on_the_school_profile(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        body = client.get(f"{SETTINGS}/school", headers=H).json()
        assert body["attendance_alert_threshold"] == 80.0

    def test_changing_it_changes_what_the_alerts_endpoint_uses(
        self, client, make_user, auth_headers
    ) -> None:
        """THE POINT. Before D45 the alerts endpoint defaulted its `threshold` parameter
        to a module constant — evaluated at IMPORT time, so no configured value could ever
        have reached it however the column was filled in."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        current = client.get(f"{SETTINGS}/school", headers=H).json()

        r = client.put(
            f"{SETTINGS}/school",
            headers=H,
            json={
                "name": current["name"],
                "address": current["address"],
                "contact_email": current["contact_email"],
                "contact_phone": current["contact_phone"],
                "post_graduation_access_days": current["post_graduation_access_days"],
                "attendance_alert_threshold": 65.0,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["attendance_alert_threshold"] == 65.0

        alerts = client.get("/api/v1/attendance/alerts", headers=H)
        assert alerts.status_code == 200, alerts.text
        assert alerts.json()["threshold"] == 65.0

    def test_an_explicit_query_override_still_wins(
        self, client, make_user, auth_headers
    ) -> None:
        """The Dean asking "who is under 90?" is a question, not a policy change."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        r = client.get("/api/v1/attendance/alerts?threshold=90", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["threshold"] == 90.0

    def test_it_is_bounded_to_a_percentage(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        current = client.get(f"{SETTINGS}/school", headers=H).json()
        r = client.put(
            f"{SETTINGS}/school",
            headers=H,
            json={
                "name": current["name"],
                "post_graduation_access_days": None,
                "attendance_alert_threshold": 140.0,
            },
        )
        assert r.status_code == 422

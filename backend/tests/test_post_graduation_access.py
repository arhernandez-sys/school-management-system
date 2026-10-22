"""D39 / Meeting #2 item 6 — the post-graduation access window.

    "Set Availability of Grades/online access to students after graduation, for a
     period, recommended time is 3 months."

A graduate keeps their login and needs it: transcripts, references and outstanding
results all matter most in the weeks right after they finish. What the school did not
want is that access lasting forever.

**These tests exist because getting the boundary wrong is silent, and severe in one
direction.** Too generous and an alumnus reads their grades a month longer than policy
allows. Too strict and a CURRENT student is locked out of their own results — which is
why the two "absence" cases below (no policy set, no graduation date) are asserted to
leave access OPEN. The rule is enforced in `core.deps.assert_student_access_window`, at
the transport layer, so a new student endpoint has to opt IN to exposure rather than
remember to opt out.

Hermetic + rolled back via `db_session`. Builds on `test_grades.py::_Graph`.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.common.enums import Role, StudentStatus
from app.core.timeutil import school_today
from app.modules.settings.models import SchoolProfile
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

REPORTS = "/api/v1/reports"
ATTENDANCE = "/api/v1/attendance"
STUDENTS = "/api/v1/students"
GRADES = "/api/v1/grades"


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
) -> _Graph:
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


@pytest.fixture(autouse=True)
def _grades_published(student_grades_visible):
    """Publish grades for every test in this module.

    `students_can_view_grades` defaults to OFF, and the deps checker tests it BEFORE the
    access window — deliberately, so a student inside their window still gets the more
    specific `grades_hidden` message when grades are simply unpublished. Without this
    fixture every assertion here would be reading that switch rather than the window, and
    the suite would pass whether or not the window worked at all.
    """
    return student_grades_visible


def _set_window(db_session, days: int | None) -> None:
    profile = db_session.scalar(select(SchoolProfile).limit(1))
    profile.post_graduation_access_days = days
    db_session.commit()


def _graduate(db_session, student, *, days_ago: int) -> None:
    """Mark the student graduated, with graduation `days_ago` days in the past."""
    student.status = StudentStatus.GRADUATED
    student.graduation_date = school_today() - timedelta(days=days_ago)
    db_session.commit()


def _me(client, headers):
    return client.get(f"{REPORTS}/report-card/me", headers=headers)


class TestTheBoundary:
    """90 days means the WHOLE of the third month: day 90 in, day 91 out."""

    def test_day_90_of_a_90_day_window_is_still_allowed(
        self, client, graph, db_session, auth_headers
    ) -> None:
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=90)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert _me(client, h).status_code == 200, _me(client, h).text

    def test_day_91_of_a_90_day_window_is_refused(
        self, client, graph, db_session, auth_headers
    ) -> None:
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=91)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        resp = _me(client, h)
        assert resp.status_code == 403, resp.text
        assert resp.json()["error"]["code"] == "access_expired"

    def test_the_message_names_the_date_and_the_window(
        self, client, graph, db_session, auth_headers
    ) -> None:
        """A graduate who is refused must be told WHY, so they contact the Registrar
        instead of assuming a bug. dd/mm/yyyy, matching D39 item 1."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=200)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        message = _me(client, h).json()["error"]["message"]
        expected = (s.graduation_date + timedelta(days=90)).strftime("%d/%m/%Y")
        assert expected in message
        assert "90 days after graduation" in message
        assert "Registrar" in message

    def test_a_zero_day_window_closes_the_day_after_graduation(
        self, client, graph, db_session, auth_headers
    ) -> None:
        """`0` is the spelling for "access ends on graduation day" — distinguishable
        from NULL, and something an operator has to type on purpose."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 0)
        _graduate(db_session, s, days_ago=0)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert _me(client, h).status_code == 200, _me(client, h).text

        _graduate(db_session, s, days_ago=1)
        assert _me(client, h).status_code == 403


class TestAbsenceLeavesAccessOpen:
    """The asymmetry that matters: a MISSING value must never lock anyone out.

    A missing policy or a missing graduation date is an absence of information. Reading
    absence as "expired" would take a current student's own grades away on the strength
    of a NULL, which is far worse than an alumnus keeping access too long.
    """

    def test_a_null_window_never_expires(
        self, client, graph, db_session, auth_headers
    ) -> None:
        s, _ = graph.student(with_login=True)
        _set_window(db_session, None)
        _graduate(db_session, s, days_ago=10_000)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert _me(client, h).status_code == 200, _me(client, h).text

    def test_a_graduate_with_no_graduation_date_keeps_access(
        self, client, graph, db_session, auth_headers
    ) -> None:
        """The clock has not started. `change_student_status` stamps the date, but a row
        migrated in from the client's previous system may carry the status without it."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        s.status = StudentStatus.GRADUATED
        s.graduation_date = None
        db_session.commit()
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert _me(client, h).status_code == 200, _me(client, h).text

    def test_a_currently_registered_student_is_never_affected(
        self, client, graph, db_session, auth_headers
    ) -> None:
        """The single most important case. A window of 0 days must not touch someone who
        has not graduated."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 0)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert _me(client, h).status_code == 200, _me(client, h).text

    def test_a_withdrawn_student_is_not_covered(
        self, client, graph, db_session, auth_headers
    ) -> None:
        """Only GRADUATED. What happens to a withdrawn student's access is a separate
        decision the school has not made, and inventing an expiry here would lock people
        out on a rule nobody agreed to."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 0)
        s.status = StudentStatus.WITHDRAWN
        s.graduation_date = school_today() - timedelta(days=500)
        db_session.commit()
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert _me(client, h).status_code == 200, _me(client, h).text


class TestStaffAreUnaffected:
    def test_the_registrar_can_still_pull_an_expired_graduates_transcript(
        self, client, graph, db_session
    ) -> None:
        """The whole point of telling the graduate to contact the Registrar."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=400)
        resp = client.get(f"{REPORTS}/transcript?student_id={s.id}", headers=graph.P)
        assert resp.status_code == 200, resp.text

    def test_the_dean_can_still_read_the_report_card(
        self, client, graph, db_session
    ) -> None:
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=400)
        resp = client.get(
            f"{REPORTS}/report-card?student_id={s.id}&semester_id={graph.sem.id}",
            headers=graph.P,
        )
        assert resp.status_code == 200, resp.text


class TestTheWindowCoversEveryStudentRecordSurface:
    """The rule is "the record closes", not "one endpoint closes"."""

    def test_attendance_me_is_covered(
        self, client, graph, db_session, auth_headers
    ) -> None:
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=400)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        resp = client.get(f"{ATTENDANCE}/me", headers=h)
        assert resp.status_code == 403, resp.text
        assert resp.json()["error"]["code"] == "access_expired"

    def test_grades_me_is_covered(
        self, client, graph, db_session, auth_headers
    ) -> None:
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=400)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        resp = client.get(f"{GRADES}/me", headers=h)
        assert resp.status_code == 403, resp.text
        assert resp.json()["error"]["code"] == "access_expired"

    def test_the_own_profile_stays_readable(
        self, client, graph, db_session, auth_headers
    ) -> None:
        """Deliberately NOT covered. Closing the record is the ask; closing the door on
        the person who needs to ask the Registrar about it is not."""
        s, _ = graph.student(with_login=True)
        _set_window(db_session, 90)
        _graduate(db_session, s, days_ago=400)
        h = auth_headers(user_id=s._login.id, role=Role.STUDENT)
        assert client.get(f"{STUDENTS}/me", headers=h).status_code == 200

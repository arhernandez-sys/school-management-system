"""D44 — `GET /attendance/alerts`, the 80% floor.

Oracle: `app/modules/attendance/service.get_alerts` and
`docs/d44-sims10-and-meeting3.md`.

Four things are pinned, and three of them are about what the endpoint deliberately does
NOT do:

  1. THE THRESHOLD IS A FLOOR, NOT A CEILING. Strictly below is flagged; exactly at 80 is
     not. An off-by-one here means every compliant class shows up as a problem, which is
     how an alert list becomes something people close without reading.

  2. AN UNMARKED CLASS IS NOT A FAILING CLASS. Zero records is a register nobody has
     opened, and reporting it at 0% would bury the classes genuinely in trouble.

  3. THE DENOMINATOR TRAVELS WITH THE NUMBER. `sessions_recorded` is on every row because
     `_summarize` divides by records WRITTEN, not sessions scheduled — a class marked
     twice with one absence reads 50% and is fine.

  4. SCOPE IS INHERITED, NOT REIMPLEMENTED. The alert list is built on `list_offerings`,
     so a lecturer cannot be alerted about a colleague's class. Pinned because a
     second scoping rule written here is exactly the kind of thing that drifts.

LATE COUNTS AS PRESENT, as everywhere else in this module (`_summarize`). The percentages
below are computed on that basis and the tests say so where it matters.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from tests.test_attendance import _Graph  # noqa: F401  (the fixture builds on it)

pytestmark = pytest.mark.requires_db

ALERTS = "/api/v1/attendance/alerts"


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year)


#: `attendance_records` is unique on (offering, student, date), so every call has to land
#: on days no earlier call used. Tracked per (student, offering) rather than globally:
#: two students in one class are marked on the SAME days, which is what a register is.
_NEXT_DAY: dict[tuple, int] = {}

START = date(2025, 10, 1)


def _mark(graph, student, enr, pattern: str, *, section=None) -> None:
    """Write one record per character of `pattern`, on consecutive days.

    `p`resent, `a`bsent, `l`ate, `e`xcused — so a test states the shape of the register
    it is asserting about on one line, instead of five `graph.record(...)` calls whose
    ratio the reader has to work out.

    Successive calls for the same student CONTINUE the register rather than restarting
    it, so a test can add "one more absence" and get a new day instead of a duplicate-key
    error on a day already marked.
    """
    kinds = {"p": "present", "a": "absent", "l": "late", "e": "excused"}
    key = (student.id, (section or graph.section).id)
    offset = _NEXT_DAY.get(key, 0)
    for char in pattern:
        graph.record(
            student,
            enr,
            status=kinds[char],
            on=START + timedelta(days=offset),
            section=section,
        )
        offset += 1
    _NEXT_DAY[key] = offset


@pytest.fixture(autouse=True)
def _reset_day_cursor():
    """`_NEXT_DAY` is module state; the rolled-back session is not. Cleared per test so
    one test's register length cannot shift another's dates."""
    _NEXT_DAY.clear()
    yield
    _NEXT_DAY.clear()


class TestTheFloor:
    def test_a_class_below_80_is_flagged(self, client, graph) -> None:
        student, enr = graph.student()
        _mark(graph, student, enr, "ppppppppaa")  # 8/10 present … and 2 absent = 80%

        # 80.0 exactly is NOT below the floor.
        body = client.get(ALERTS, headers=graph.P).json()
        assert [o["offering"]["offering"]["id"] for o in body["offerings"]] == []

        # One more absence takes it to 8/11 = 72.7%.
        _mark(graph, student, enr, "a")
        body = client.get(ALERTS, headers=graph.P).json()
        flagged = body["offerings"]
        assert len(flagged) == 1
        assert flagged[0]["offering"]["offering"]["id"] == str(graph.cs.id)
        assert flagged[0]["pct_present"] == 72.7

    def test_late_counts_as_present(self, client, graph) -> None:
        """The module-wide rule. Six lates and four absences is 60%, not 0%."""
        student, enr = graph.student()
        _mark(graph, student, enr, "llllllaaaa")
        body = client.get(ALERTS, headers=graph.P).json()
        assert body["offerings"][0]["pct_present"] == 60.0

    def test_the_threshold_is_echoed_back(self, client, graph) -> None:
        """So the UI states the rule it is showing instead of holding a second copy of
        the number that can disagree with this one."""
        assert client.get(ALERTS, headers=graph.P).json()["threshold"] == 80.0

    def test_the_threshold_is_overridable(self, client, graph) -> None:
        """So the Dean can ask "who is under 90?" without a deploy."""
        student, enr = graph.student()
        _mark(graph, student, enr, "ppppppppa")  # 8/9 = 88.9%

        # Above the 80 floor, so silent by default.
        assert client.get(ALERTS, headers=graph.P).json()["offerings"] == []

        strict = client.get(f"{ALERTS}?threshold=90", headers=graph.P).json()
        assert strict["threshold"] == 90.0
        assert len(strict["offerings"]) == 1
        assert strict["offerings"][0]["pct_present"] == 88.9

    def test_an_out_of_range_threshold_is_422(self, client, graph) -> None:
        assert client.get(f"{ALERTS}?threshold=150", headers=graph.P).status_code == 422


class TestAnUnmarkedClassIsNotAFailingClass:
    def test_no_records_means_no_alert(self, client, graph) -> None:
        """A register nobody has opened is not a class at 0% attendance, and showing it as
        one would bury the classes that are genuinely in trouble."""
        graph.student()  # enrolled, never marked
        body = client.get(ALERTS, headers=graph.P).json()
        assert body["offerings"] == []
        assert body["students"] == []


class TestTheDenominatorTravels:
    def test_sessions_recorded_is_on_every_row(self, client, graph) -> None:
        """Two marked days and one absence reads 50% — and is not a crisis. The count is
        what lets a reader see that."""
        student, enr = graph.student()
        _mark(graph, student, enr, "pa")

        body = client.get(ALERTS, headers=graph.P).json()
        offering = body["offerings"][0]
        assert offering["pct_present"] == 50.0
        assert offering["sessions_recorded"] == 2
        assert offering["enrolled_count"] == 1

        student_row = body["students"][0]
        assert student_row["sessions_recorded"] == 2


class TestPerStudentPerClass:
    def test_a_student_is_flagged_in_the_class_they_are_absent_from(
        self, client, graph
    ) -> None:
        """Per (student, offering), not per student: being diligent in three courses and
        absent from a fourth must not average away the fourth."""
        good, good_enr = graph.student()
        bad, bad_enr = graph.student()
        _mark(graph, good, good_enr, "pppppppppp")
        _mark(graph, bad, bad_enr, "paaaaaaaaa")

        body = client.get(ALERTS, headers=graph.P).json()
        flagged = {s["student"]["id"] for s in body["students"]}
        assert flagged == {str(bad.id)}

    def test_worst_first(self, client, graph) -> None:
        """The top of an alert list is the point of it."""
        mid, mid_enr = graph.student()
        worst, worst_enr = graph.student()
        _mark(graph, mid, mid_enr, "ppppppaaaa")  # 60%
        _mark(graph, worst, worst_enr, "paaaaaaaaa")  # 10%

        body = client.get(ALERTS, headers=graph.P).json()
        assert [s["pct_present"] for s in body["students"]] == [10.0, 60.0]


class TestScopeIsInherited:
    def test_a_lecturer_is_only_alerted_about_their_own_class(
        self, client, graph
    ) -> None:
        """Built on `list_offerings`, so this rule is not written twice."""
        mine, mine_enr = graph.student()
        theirs, theirs_enr = graph.student(section=graph.other_cs)
        _mark(graph, mine, mine_enr, "paaaa")
        _mark(graph, theirs, theirs_enr, "paaaa", section=graph.other_cs)

        dean = client.get(ALERTS, headers=graph.P).json()
        assert {o["offering"]["offering"]["id"] for o in dean["offerings"]} == {
            str(graph.cs.id),
            str(graph.other_cs.id),
        }

        lecturer = client.get(ALERTS, headers=graph.H).json()
        assert {o["offering"]["offering"]["id"] for o in lecturer["offerings"]} == {
            str(graph.cs.id)
        }
        assert {s["student"]["id"] for s in lecturer["students"]} == {str(mine.id)}

    def test_a_student_cannot_read_the_alerts(self, client, graph) -> None:
        student, _enr = graph.student(with_login=True)
        resp = client.get(ALERTS, headers=graph.student_headers(student))
        assert resp.status_code == 403

    def test_unauthenticated_is_401(self, client) -> None:
        assert client.get(ALERTS).status_code == 401

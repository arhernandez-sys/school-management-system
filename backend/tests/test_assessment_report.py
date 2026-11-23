"""D47 — `GET /grades/assessment-report`, the printable assessment report.

Who may print what is the whole point: the Dean filters by session, offering, student
and lecturer; a lecturer gets only the offerings they teach, and no filter value can
widen that. Also covers the ownership hole closed on `GET /reports/offering-grades`.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.common.enums import Role
from app.core.timeutil import school_today
from app.modules.offerings.models import ClassEnrollment
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

REPORT = "/api/v1/grades/assessment-report"


def _days_ago(n: int) -> date:
    return school_today() - timedelta(days=n)


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


@pytest.fixture
def marked(graph, db_session):
    """Two offerings (mine + another lecturer's), each with one marked student, plus one
    closed assessment left blank in mine."""
    a = graph.assessment(max_score="100", assessment_date=_days_ago(1), title="Quiz 1")
    missed = graph.assessment(max_score="100", assessment_date=_days_ago(6), title="Quiz 0")
    s, e = graph.student(name="Ana Report")
    graph.grade(a, s, e, score="80")

    b = graph.assessment(max_score="50", cs_id=graph.other_cs.id, assessment_date=_days_ago(1))
    other, _e = graph.student(name="Ben Other", enroll=False)
    enr = ClassEnrollment(offering_id=graph.other_cs.id, student_id=other.id, semester_id=graph.sem.id)
    db_session.add(enr)
    db_session.flush()
    graph.grade(b, other, enr, score="40")
    return a, missed, s, b, other


def _ids(body) -> set[str]:
    return {o["offering"]["offering"]["id"] for o in body["offerings"]}


class TestWhoMayPrint:
    def test_the_registrar_and_auditor_cannot(self, client, graph, make_user, auth_headers) -> None:
        assert client.get(REPORT, headers=graph.S).status_code == 403
        aud = make_user(role=Role.AUDITOR)
        assert client.get(REPORT, headers=auth_headers(user_id=aud.id, role=Role.AUDITOR)).status_code == 403

    def test_a_student_cannot(self, client, graph) -> None:
        s, _ = graph.student(with_login=True)
        assert client.get(REPORT, headers=graph.student_headers(s)).status_code == 403

    def test_the_dean_sees_both_offerings(self, client, graph, marked) -> None:
        body = client.get(REPORT, params={"semester_id": str(graph.sem.id)}, headers=graph.P).json()
        assert {str(graph.cs.id), str(graph.other_cs.id)} <= _ids(body)

    def test_a_lecturer_sees_only_their_own(self, client, graph, marked) -> None:
        body = client.get(REPORT, params={"semester_id": str(graph.sem.id)}, headers=graph.H).json()
        assert _ids(body) == {str(graph.cs.id)}

    def test_a_lecturer_cannot_widen_it_with_teacher_id(self, client, graph, marked) -> None:
        body = client.get(
            REPORT,
            params={"semester_id": str(graph.sem.id), "teacher_id": str(graph.other_teacher.id)},
            headers=graph.H,
        ).json()
        assert _ids(body) == {str(graph.cs.id)}

    def test_a_lecturer_naming_someone_elses_offering_gets_404(self, client, graph, marked) -> None:
        r = client.get(REPORT, params={"offering_id": str(graph.other_cs.id)}, headers=graph.H)
        assert r.status_code == 404

    def test_a_lecturer_filtering_by_another_offerings_student_gets_nothing(
        self, client, graph, marked
    ) -> None:
        _a, _m, _s, _b, other = marked
        body = client.get(REPORT, params={"student_id": str(other.id)}, headers=graph.H).json()
        assert body["offerings"] == []


class TestDeanFilters:
    def test_by_offering(self, client, graph, marked) -> None:
        body = client.get(REPORT, params={"offering_id": str(graph.other_cs.id)}, headers=graph.P).json()
        assert _ids(body) == {str(graph.other_cs.id)}

    def test_by_lecturer(self, client, graph, marked) -> None:
        body = client.get(
            REPORT,
            params={"semester_id": str(graph.sem.id), "teacher_id": str(graph.other_teacher.id)},
            headers=graph.P,
        ).json()
        assert _ids(body) == {str(graph.other_cs.id)}

    def test_by_student_keeps_only_that_students_rows(self, client, graph, marked) -> None:
        _a, _m, s, _b, _o = marked
        graph.student(name="Zed Classmate")  # same offering, must not print
        body = client.get(REPORT, params={"student_id": str(s.id)}, headers=graph.P).json()
        assert _ids(body) == {str(graph.cs.id)}
        assert [r["student"]["id"] for r in body["offerings"][0]["rows"]] == [str(s.id)]

    def test_filters_combine(self, client, graph, marked) -> None:
        body = client.get(
            REPORT,
            params={"offering_id": str(graph.cs.id), "teacher_id": str(graph.other_teacher.id)},
            headers=graph.P,
        ).json()
        assert body["offerings"] == []


class TestContent:
    def test_marks_auto_zero_and_term_match_the_gradebook(self, client, graph, marked) -> None:
        a, missed, s, _b, _o = marked
        body = client.get(REPORT, params={"offering_id": str(graph.cs.id)}, headers=graph.H).json()
        section = body["offerings"][0]
        columns = {c["id"]: c for c in section["assessments"]}
        assert columns[str(missed.id)]["marking_open"] is False
        assert columns[str(a.id)]["title"] == "Quiz 1"
        row = next(r for r in section["rows"] if r["student"]["id"] == str(s.id))
        cells = {c["assessment_id"]: c for c in row["cells"]}
        assert cells[str(a.id)]["score"] == 80.0
        assert cells[str(missed.id)]["auto_zero"] is True

        book = client.get(f"/api/v1/grades/offering/{graph.cs.id}", headers=graph.H).json()
        book_row = next(r for r in book["rows"] if r["student"]["id"] == str(s.id))
        assert row["term_numeric"] == book_row["term_numeric"] == 40.0

    def test_report_envelope(self, client, graph, marked) -> None:
        body = client.get(REPORT, params={"offering_id": str(graph.cs.id)}, headers=graph.P).json()
        assert set(body) == {"generated_at", "total_offerings", "truncated", "offerings"}
        assert body["total_offerings"] == 1 and body["truncated"] is False


class TestOfferingGradesOwnership:
    """The hole this phase closed: any lecturer could read any course's marks here."""

    def test_a_lecturer_cannot_read_anothers_offering(self, client, graph, marked) -> None:
        r = client.get(
            "/api/v1/reports/offering-grades",
            params={"offering_id": str(graph.other_cs.id)},
            headers=graph.H,
        )
        assert r.status_code == 404

    def test_a_lecturer_still_reads_their_own(self, client, graph, marked) -> None:
        r = client.get(
            "/api/v1/reports/offering-grades",
            params={"offering_id": str(graph.cs.id)},
            headers=graph.H,
        )
        assert r.status_code == 200, r.text

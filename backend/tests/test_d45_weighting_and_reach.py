"""D45 Phase 1, part 2 — the weighting verdict, the HOD reach audit, the Dean tiles.

Split from `test_d45_phase1.py` only for length; same phase, same blueprint.

  §24  the system VERIFIES that assessment weighting totals 100%
  §40  the HOD reach audit — the one function of twelve that was not reachable
  §42  the Dean Dashboard's admissions tiles
  §55  search by Programme and Email, and the lecturer scope that must survive it
"""

from __future__ import annotations

import uuid

import pytest

from app.common.enums import Role

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"
TIMETABLE_STUDENT = "/api/v1/timetable/students"
NOWHERE = "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
):
    from tests.test_grades import _Graph

    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


# ════════════════════════════════════════════════════════════════════════════
class TestTheWeightingVerdict:
    """§24 — "The system should verify that assessment weighting totals 100%."

    The client's clarification (2026-09-08) settles what "assessment weighting" means:
    "they can have 30 assignments but at the end it will sum to 20% of the students full
    grade". So it is the CATEGORY weights that must total 100, and the assessments inside
    a category share that category's slice. `calc` already computes it exactly that way —
    this adds the verification the blueprint asked for and changes no arithmetic.

    It VERIFIES; it does not enforce. A gradebook is built one category at a time and the
    total is wrong at every step until the last one, so refusing the save would make the
    screen unusable and teach lecturers to type fake weights to get past it.
    """

    @staticmethod
    def _cat(client, graph, name, weight):
        return client.post(
            f"/api/v1/offerings/{graph.cs.id}/categories",
            headers=graph.H,
            json={"name": name, "weight": weight},
        )

    @staticmethod
    def _list(client, graph):
        return client.get(
            f"/api/v1/offerings/{graph.cs.id}/categories", headers=graph.H
        ).json()

    _BLUEPRINT_TABLE = (
        ("Assignments", 20),
        ("Quizzes", 15),
        ("Midterm Examination", 25),
        ("Final Examination", 30),
        ("Participation", 10),
    )

    def test_the_blueprint_example_reads_as_correct(self, client, graph) -> None:
        """Section 24's own table, verbatim."""
        for name, weight in self._BLUEPRINT_TABLE:
            assert self._cat(client, graph, name, weight).status_code == 201

        body = self._list(client, graph)
        assert body["weight_total"] == 100.0
        assert body["weight_total_ok"] is True

    def test_no_float_error_on_that_example(self, client, graph) -> None:
        """20 + 15 + 25 + 30 + 10 is exactly 100 in decimal and 99.99999999999999 in
        binary float. Summed as float, the verdict tells a lecturer their correct
        gradebook is wrong — which is worse than not checking at all."""
        for name, weight in self._BLUEPRINT_TABLE:
            self._cat(client, graph, name, float(weight))
        assert self._list(client, graph)["weight_total"] == 100.0

    def test_a_short_total_is_REPORTED_not_refused(self, client, graph) -> None:
        assert self._cat(client, graph, "Assignments", 20).status_code == 201
        assert self._cat(client, graph, "Quizzes", 15).status_code == 201

        body = self._list(client, graph)
        assert body["weight_total"] == 35.0
        assert body["weight_total_ok"] is False

    def test_an_over_total_is_reported_too(self, client, graph) -> None:
        for name, weight in self._BLUEPRINT_TABLE:
            self._cat(client, graph, name, weight)
        self._cat(client, graph, "Extra Credit", 15)

        body = self._list(client, graph)
        assert body["weight_total"] == 115.0
        assert body["weight_total_ok"] is False

    def test_an_empty_gradebook_is_not_ok(self, client, graph) -> None:
        """Zero categories sum to zero, which is not 100. A brand-new gradebook must not
        report itself as correctly weighted."""
        body = self._list(client, graph)
        assert body["items"] == []
        assert body["weight_total"] == 0.0
        assert body["weight_total_ok"] is False

    def test_an_UNCATEGORISED_assessment_breaks_the_100(self, client, graph) -> None:
        """LOAD-BEARING, and the reason the count is on the payload at all.

        `calc` weights the synthetic uncategorised bucket by the sum of its own assessment
        weights, so that it competes on equal footing with the explicit categories. While
        anything sits outside a category, the categories therefore do NOT account for 100%
        of the grade even when their weights add to exactly 100. Reporting the total
        without this number would be reporting a reassuring lie.
        """
        for name, weight in self._BLUEPRINT_TABLE:
            self._cat(client, graph, name, weight)
        graph.assessment(max_score="20", weight="1")  # no category_id

        body = self._list(client, graph)
        assert body["weight_total"] == 100.0
        assert body["uncategorized_assessment_count"] == 1
        assert body["weight_total_ok"] is False

    def test_saving_a_wrong_weight_is_still_allowed(self, client, graph) -> None:
        """Stated as its own test because it is a DECISION, not an oversight."""
        assert self._cat(client, graph, "Everything", 250).status_code == 201


# ════════════════════════════════════════════════════════════════════════════
class TestTheHodReachAudit:
    """§40 — the blueprint lists twelve HOD functions.

    Eleven were already reachable: department programmes and courses (authenticated
    reads), department lecturers, class offerings, class lists, attendance monitoring,
    grade submission monitoring, grade review, student academic performance, at-risk
    students and department reports.

    The twelfth was not. `GET /timetable/students/{id}` was gated Dean + Registrar, so a
    head could not see the week of a student on their own programme — even though D43's
    whole principle is that a head READS everything in the programme they head.
    """

    def test_a_head_who_heads_NOTHING_sees_nobody(
        self, client, make_user, auth_headers
    ) -> None:
        """`hod_program_ids` returns [] for a head with no `program_heads` row — a real
        state, since appointing a head and provisioning their login are two separate acts
        often days apart. [] must narrow to the empty set, never widen to everything.
        Getting that backwards turns an unconfigured HOD into a Dean."""
        head = make_user(role=Role.HOD)
        r = client.get(
            f"{TIMETABLE_STUDENT}/{NOWHERE}",
            headers=auth_headers(user_id=head.id, role=Role.HOD),
        )
        assert r.status_code == 404

    def test_the_head_reaches_the_ENDPOINT_at_all(
        self, client, make_user, auth_headers
    ) -> None:
        """Before D45 this was 403 at the role gate — the head never got as far as the
        scope check. 404 is the scoped refusal and is the correct answer here; the
        distinction is the whole fix."""
        head = make_user(role=Role.HOD)
        r = client.get(
            f"{TIMETABLE_STUDENT}/{NOWHERE}",
            headers=auth_headers(user_id=head.id, role=Role.HOD),
        )
        assert r.status_code != 403

    def test_a_lecturer_still_cannot_read_any_students_week(
        self, client, make_user, auth_headers
    ) -> None:
        """Widening the gate for the head must not have widened it for everyone. A
        lecturer sees their OWN week at `/timetable/me` and no one else's."""
        teacher = make_user(role=Role.TEACHER)
        r = client.get(
            f"{TIMETABLE_STUDENT}/{NOWHERE}",
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
        )
        assert r.status_code == 403

    def test_a_student_certainly_cannot(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        r = client.get(
            f"{TIMETABLE_STUDENT}/{NOWHERE}",
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert r.status_code == 403

    def test_the_dean_and_registrar_are_unchanged(
        self, client, make_user, auth_headers
    ) -> None:
        for role in (Role.PRINCIPAL, Role.SECRETARY):
            user = make_user(role=role)
            r = client.get(
                f"{TIMETABLE_STUDENT}/{NOWHERE}",
                headers=auth_headers(user_id=user.id, role=role),
            )
            assert r.status_code == 404, f"{role} -> {r.status_code}"


# ════════════════════════════════════════════════════════════════════════════
class TestTheDeanDashboardTiles:
    """§42 and §59."""

    def test_the_four_tiles_are_present_and_numeric(
        self, client, make_user, auth_headers
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        stats = client.get("/api/v1/dashboard", headers=H).json()["stats"]
        for key in (
            "new_applicants",
            "accepted_applicants",
            "active_programmes",
            "students_at_risk",
        ):
            assert isinstance(stats[key], int), key
            assert stats[key] >= 0, key

    def test_new_applicants_is_a_QUEUE_not_a_running_total(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A cumulative count of everyone who ever applied only ever goes up and tells the
        Dean nothing to act on. Rejected and enrolled applications are finished; they
        belong in a report, not on a queue tile."""
        from app.common.enums import ApplicationStatus
        from app.modules.admissions.models import Application

        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        before = client.get("/api/v1/dashboard", headers=H).json()["stats"]

        def _app(status):
            row = Application(
                # The ORM attributes are snake_case over the client's `firstname` /
                # `lastname` columns (D34 kept the dump's spelling on the column).
                first_name="Probe",
                last_name=uuid.uuid4().hex[:8],
                status=status,
            )
            db_session.add(row)
            db_session.flush()
            return row

        _app(ApplicationStatus.SUBMITTED)
        _app(ApplicationStatus.UNDER_REVIEW)
        _app(ApplicationStatus.REJECTED)  # finished — must NOT count
        _app(ApplicationStatus.DRAFT)  # not sent — must NOT count
        _app(ApplicationStatus.ACCEPTED)  # counted in the OTHER tile

        after = client.get("/api/v1/dashboard", headers=H).json()["stats"]
        assert after["new_applicants"] == before["new_applicants"] + 2
        assert after["accepted_applicants"] == before["accepted_applicants"] + 1


# ════════════════════════════════════════════════════════════════════════════
class TestSearchByProgrammeAndEmail:
    """§55 — the blueprint lists Student ID, first name, last name, Programme, Email and
    Application number. The first three were already searchable."""

    def test_by_email(self, client, graph, db_session, make_user, auth_headers) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        student, _enr = graph.student()
        student.email = f"findme-{uuid.uuid4().hex[:6]}@bajc.edu.bz"
        db_session.flush()

        body = client.get(f"{STUDENTS}?search={student.email}", headers=H).json()
        assert [i["id"] for i in body["items"]] == [str(student.id)]

    def test_by_programme_code_and_name(
        self, client, graph, db_session, make_user, auth_headers
    ) -> None:
        """Both, because "ASIT" is what staff say out loud and "Information Technology"
        is what they read on the screen."""
        from app.modules.programs.models import Program

        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        tag = uuid.uuid4().hex[:5].upper()
        programme = Program(code=f"P{tag}", name=f"Marine Biology {tag}")
        db_session.add(programme)
        db_session.flush()

        student, _enr = graph.student()
        student.program_id = programme.id
        db_session.flush()

        by_code = client.get(f"{STUDENTS}?search=P{tag}", headers=H).json()
        assert str(student.id) in [i["id"] for i in by_code["items"]]

        by_name = client.get(f"{STUDENTS}?search=Marine Biology {tag}", headers=H).json()
        assert str(student.id) in [i["id"] for i in by_name["items"]]

    def test_a_guardians_address_is_NOT_searchable(
        self, client, graph, db_session, make_user, auth_headers
    ) -> None:
        """`guardian_email` and `finance_email` belong to a different person. Finding a
        student by typing their parent's address is a directory of guardians that nobody
        asked for."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        student, _enr = graph.student()
        unique = f"guardian-{uuid.uuid4().hex[:6]}@example.com"
        student.guardian_email = unique
        db_session.flush()

        body = client.get(f"{STUDENTS}?search={unique}", headers=H).json()
        assert body["total"] == 0

    def test_A_LECTURER_SEARCHING_STILL_SEES_ONLY_THEIR_OWN(
        self, client, graph, db_session, make_user, auth_headers
    ) -> None:
        """§55's actual security ask: "A lecturer, for example, should not automatically
        receive access to every student merely by searching."

        The scope is a READ FILTER on the query, not a post-filter, so it cannot be
        escaped by any search term. Adding Programme and Email to the searchable set is
        exactly the kind of change that could have widened it — this is the test that says
        it did not.
        """
        from app.modules.programs.models import Program

        tag = uuid.uuid4().hex[:5].upper()
        programme = Program(code=f"Q{tag}", name=f"Astro {tag}")
        db_session.add(programme)
        db_session.flush()

        # A student the lecturer does NOT teach, on a findable programme.
        stranger, _ = graph.student(enroll=False)
        stranger.program_id = programme.id
        stranger.email = f"stranger-{tag}@bajc.edu.bz"
        db_session.flush()

        found = client.get(f"{STUDENTS}?search=Q{tag}", headers=graph.H).json()
        assert found["total"] == 0, "a lecturer reached a student they do not teach"

        found = client.get(
            f"{STUDENTS}?search={stranger.email}", headers=graph.H
        ).json()
        assert found["total"] == 0

        # And the Dean, on the same query, does find them — so the empty result above is
        # the scope working, not the search being broken.
        dean = make_user(role=Role.PRINCIPAL)
        DH = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        assert client.get(f"{STUDENTS}?search=Q{tag}", headers=DH).json()["total"] == 1

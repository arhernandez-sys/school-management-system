"""The grade-submission deadline (D30 §D6, brief §18).

A Dean sets `semesters.grade_submission_deadline`; once it passes, the Lecturer's
grade write is refused with 409 `grade_window_closed`, and the gradebook read says so
in advance instead of letting them type forty marks into a doomed form.

Reuses `test_grades.py::_Graph` rather than rebuilding a year + section + offering +
owning teacher: this suite is about ONE rule layered onto that graph, and a second
copy of the fixture would drift from the first.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.common.enums import Role
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

G = "/api/v1/grades"
A = "/api/v1/assessments"
SEMESTERS = "/api/v1/settings/semesters"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) <= {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


def _save(client, graph, assessment, student, *, headers=None, score="15"):
    return client.put(
        f"{A}/{assessment.id}/grades",
        headers=headers or graph.H,
        json={"entries": [{"student_id": str(student.id), "status": "graded", "score": score}]},
    )


def _set_deadline(db_session, graph, when) -> None:
    """Write the deadline directly. The Dean-only endpoint is covered separately;
    here it is a precondition, not the thing under test."""
    graph.sem.grade_submission_deadline = when
    db_session.flush()


# ════════════════════════════════════════════════════════════════════════════
# Enforcement in upsert_grades — the single grade write path
# ════════════════════════════════════════════════════════════════════════════
class TestEnforcement:
    def test_no_deadline_never_blocks(self, client, graph) -> None:
        """NULL is the state of every term in the school today; it must stay open."""
        assert graph.sem.grade_submission_deadline is None
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_future_deadline_allows_the_save(self, client, graph, db_session) -> None:
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) + timedelta(days=7))
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_past_deadline_is_409_grade_window_closed(self, client, graph, db_session) -> None:
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="grade_window_closed")

    def test_409_names_the_deadline(self, client, graph, db_session) -> None:
        """The date is the actionable part: a Lecturer an hour late and one a month late
        are different conversations, and a bare 'window closed' cannot tell them apart."""
        deadline = datetime.now(tz=timezone.utc) - timedelta(days=3)
        _set_deadline(db_session, graph, deadline)
        a = graph.assessment()
        student, _enr = graph.student()
        body = _save(client, graph, a, student).json()
        assert "grade_submission_deadline" in body["error"]
        assert body["error"]["grade_submission_deadline"] is not None

    def test_nothing_is_written_when_the_window_is_closed(
        self, client, graph, db_session
    ) -> None:
        """The check runs BEFORE any mutation, so a refused batch leaves the gradebook
        exactly as it was — the same all-or-nothing discipline as the validation errors."""
        from sqlalchemy import func, select

        from app.modules.grades.models import AssessmentGrade

        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(hours=1))
        a = graph.assessment()
        student, _enr = graph.student()
        _save(client, graph, a, student)
        count = db_session.scalar(
            select(func.count()).select_from(AssessmentGrade).where(
                AssessmentGrade.assessment_id == a.id
            )
        )
        assert count == 0

    def test_reopening_the_window_lets_the_same_save_through(
        self, client, graph, db_session
    ) -> None:
        """Clearing the deadline is the Dean's escape hatch, and it must take effect
        without any other change — the guard reads the column on every write."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 409
        _set_deadline(db_session, graph, None)
        assert _save(client, graph, a, student).status_code == 200

    def test_the_deadline_is_per_TERM_not_per_year(self, client, graph, db_session) -> None:
        """A closed Semester 1 must not close Semester 2. BAJC runs up to eight blocks
        in a plan and they finish at different times."""
        from datetime import date

        from app.modules.settings.models import Semester

        other = Semester(
            academic_year_id=graph.year.id, name="Semester 2", sequence=2,
            start_date=date(2026, 2, 1), end_date=date(2026, 6, 30), is_active=False,
        )
        db_session.add(other)
        db_session.flush()
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))

        student, _enr = graph.student()
        closed = graph.assessment()
        assert _save(client, graph, closed, student).status_code == 409

        # The student's enrolment is in Semester 1, so enrol them into the second term
        # too — otherwise the save fails on provenance rather than on the window.
        from app.modules.offerings.models import ClassEnrollment

        db_session.add(
            ClassEnrollment(
                offering_id=graph.section.id, student_id=student.id, semester_id=other.id
            )
        )
        db_session.flush()
        open_term = graph.assessment(semester_id=other.id)
        assert _save(client, graph, open_term, student).status_code == 200

    def test_a_deadline_seconds_in_the_future_is_still_open(
        self, client, graph, db_session
    ) -> None:
        """The comparison is `now > deadline`, so the boundary is inclusive of the
        deadline instant itself — a save landing exactly on time is accepted."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) + timedelta(seconds=30))
        a = graph.assessment()
        student, _enr = graph.student()
        assert _save(client, graph, a, student).status_code == 200

    def test_a_naive_stored_deadline_does_not_500(self, client, graph, db_session) -> None:
        """MariaDB `DATETIME` comes back timezone-NAIVE through pymysql, and comparing
        that with an aware `utcnow()` raises TypeError. `ensure_aware` is what keeps this
        a clean 409 rather than an internal error on the save path — assert the naive
        case explicitly, because the ORM sometimes hands back what was just written."""
        _set_deadline(db_session, graph, datetime.now() - timedelta(days=1))  # noqa: DTZ005
        db_session.expire(graph.sem)
        a = graph.assessment()
        student, _enr = graph.student()
        resp = _save(client, graph, a, student)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="grade_window_closed")


class TestDeanBypass:
    def test_the_dean_arm_skips_the_check(self, graph, db_session) -> None:
        """The Dean is exempt from the deadline (§D6) — asserted at the SERVICE level,
        because the arm is unreachable over HTTP by design.

        `PUT /assessments/{id}/grades` is `require_role(TEACHER)`, and
        `assert_teacher_owns_offering` would 404 a Dean regardless, so no Dean can
        enter a grade at all today. The intended post-deadline path is Phase 5's
        grade-revision workflow (§D7): the Dean APPROVES a Lecturer's request rather
        than typing the mark. The rule is tested here so it cannot rot before then.
        """
        from app.modules.grades.service import _assert_grade_window_open

        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        a = graph.assessment()

        # A Lecturer is refused...
        with pytest.raises(Exception) as exc:
            _assert_grade_window_open(db_session, a, graph.teacher_user)
        assert getattr(exc.value, "code", None) == "grade_window_closed"

        # ...and the Dean is not. No raise is the assertion.
        assert graph.principal_user.role == Role.PRINCIPAL
        _assert_grade_window_open(db_session, a, graph.principal_user)

    def test_the_registrar_is_not_exempt(self, graph, db_session) -> None:
        """Only the Dean bypasses. The Registrar keeps administrative work but none of
        the Dean's academic authority (§D14), and academic deadlines are that authority."""
        from app.modules.grades.service import _assert_grade_window_open

        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        a = graph.assessment()
        with pytest.raises(Exception) as exc:
            _assert_grade_window_open(db_session, a, graph.secretary_user)
        assert getattr(exc.value, "code", None) == "grade_window_closed"


# ════════════════════════════════════════════════════════════════════════════
# The gradebook read reports the window
# ════════════════════════════════════════════════════════════════════════════
class TestGradebookReportsTheWindow:
    def _book(self, client, graph, headers=None):
        return client.get(
            f"{G}/offering/{graph.cs.id}", headers=headers or graph.H
        ).json()

    def test_open_window_reports_false_and_null(self, client, graph) -> None:
        body = self._book(client, graph)
        assert body["grade_window_closed"] is False
        assert body["grade_submission_deadline"] is None

    def test_closed_window_reports_true_and_the_date(self, client, graph, db_session) -> None:
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        body = self._book(client, graph)
        assert body["grade_window_closed"] is True
        assert body["grade_submission_deadline"] is not None

    def test_future_deadline_is_reported_but_not_closed(
        self, client, graph, db_session
    ) -> None:
        """The date is surfaced while the window is still OPEN, which is the point:
        a Lecturer should see the cutoff coming, not discover it on save."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) + timedelta(days=5))
        body = self._book(client, graph)
        assert body["grade_window_closed"] is False
        assert body["grade_submission_deadline"] is not None

    def test_can_edit_is_not_overwritten_by_a_closed_window(
        self, client, graph, db_session
    ) -> None:
        """`can_edit` keeps meaning 'your role and ownership permit writing here'.

        Folding the closed window into it would make a shut deadline indistinguishable
        from a Registrar's read-only view, and the Lecturer needs to know which one they
        are looking at to know whom to ask.
        """
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        book = self._book(client, graph)
        assert book["can_edit"] is True
        assert book["grade_window_closed"] is True

    def test_the_dean_sees_the_same_closed_window(
        self, client, graph, db_session
    ) -> None:
        """Someone asked "why can't the lecturer enter these?" must be able to see the
        answer, so the flag is reported for every viewer rather than only writers.

        **This used to assert it for the REGISTRAR.** D32 (brief §4) removed the Registrar
        from every grade route outright, so the Dean is now the non-writing viewer who
        still needs the explanation. The behaviour under test is unchanged — reported for
        readers as well as writers — only who can be a reader is."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        book = self._book(client, graph, headers=graph.P)
        assert book["can_edit"] is False
        assert book["grade_window_closed"] is True

    def test_the_registrar_cannot_read_the_gradebook_at_all(
        self, client, graph, db_session
    ) -> None:
        """D32, brief §4 — unconditional, no toggle. See `grades/router.py`."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=2))
        resp = client.get(f"{G}/offering/{graph.cs.id}", headers=graph.S)
        assert resp.status_code == 403, resp.text


# ════════════════════════════════════════════════════════════════════════════
# The Dean-only setter
# ════════════════════════════════════════════════════════════════════════════
class TestDeanOnlySetter:
    def test_dean_sets_the_deadline_via_patch(self, client, graph) -> None:
        when = (datetime.now(tz=timezone.utc) + timedelta(days=10)).replace(microsecond=0)
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.P,
            json={"grade_submission_deadline": when.isoformat()},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["grade_submission_deadline"] is not None

    def test_dean_clears_the_deadline_with_explicit_null(self, client, graph, db_session) -> None:
        """`null` REOPENS the window. This is why the service consults
        `model_fields_set` instead of checking for None — see `SemesterUpdateRequest`."""
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.P,
            json={"grade_submission_deadline": None},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["grade_submission_deadline"] is None

    def test_a_patch_that_omits_the_field_leaves_it_alone(
        self, client, graph, db_session
    ) -> None:
        """THE REGRESSION THIS FILE EXISTS FOR: renaming a term must not reopen it.

        Every other field on `SemesterUpdateRequest` treats None as 'leave alone', so a
        naive `if payload.x is not None` would have silently cleared the deadline on any
        unrelated edit — reopening a closed term with no audit trail and no intent.
        """
        _set_deadline(db_session, graph, datetime.now(tz=timezone.utc) - timedelta(days=1))
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}", headers=graph.P, json={"name": "Renamed Term"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Renamed Term"
        assert body["grade_submission_deadline"] is not None

    def test_the_registrar_may_not_set_it(self, client, graph) -> None:
        """Grade-submission deadlines are Dean-only academic authority (§D14)."""
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.S,
            json={"grade_submission_deadline": None},
        )
        assert resp.status_code == 403

    def test_a_lecturer_may_not_set_it(self, client, graph) -> None:
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.H,
            json={"grade_submission_deadline": None},
        )
        assert resp.status_code == 403

    def test_post_semesters_accepts_a_deadline_at_creation(self, client, graph) -> None:
        when = (datetime.now(tz=timezone.utc) + timedelta(days=60)).replace(microsecond=0)
        resp = client.post(
            SEMESTERS,
            headers=graph.P,
            json={
                "academic_year_id": str(graph.year.id),
                "name": "Summer 1",
                "term_type": "summer",
                "sequence": 9,
                "start_date": "2026-07-01",
                "end_date": "2026-08-31",
                "grade_submission_deadline": when.isoformat(),
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["grade_submission_deadline"] is not None

    def test_post_semesters_defaults_to_no_deadline(self, client, graph) -> None:
        """A term created without one never closes — the safe default. A guessed cutoff
        would lock lecturers out of a term nobody has finished teaching."""
        resp = client.post(
            SEMESTERS,
            headers=graph.P,
            json={
                "academic_year_id": str(graph.year.id),
                "name": "Spring 1",
                "term_type": "spring",
                "sequence": 8,
                "start_date": "2026-03-01",
                "end_date": "2026-04-30",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["grade_submission_deadline"] is None

    def test_an_offset_deadline_is_stored_as_utc(self, client, graph, db_session) -> None:
        """A Dean in Belize sends `...-06:00`. The column is a naive MariaDB DATETIME,
        so without normalising first the offset is dropped and the real cutoff moves six
        hours earlier — 17:00 Belize stored as 17:00 UTC.

        Asserted through behaviour rather than the stored bytes: a deadline of
        23:00-06:00 today is 05:00 UTC TOMORROW, so the window must still be OPEN even
        though the naive reading (23:00 "UTC") is already in the past by mid-evening.
        """
        from sqlalchemy import select

        from app.core.timeutil import ensure_aware
        from app.modules.settings.models import Semester

        when = datetime.now(tz=timezone.utc) + timedelta(hours=6)
        resp = client.patch(
            f"{SEMESTERS}/{graph.sem.id}",
            headers=graph.P,
            # Same instant, expressed in Belize civil time.
            json={"grade_submission_deadline": when.astimezone(
                timezone(timedelta(hours=-6))
            ).isoformat()},
        )
        assert resp.status_code == 200, resp.text

        db_session.expire_all()
        stored = ensure_aware(
            db_session.scalar(
                select(Semester.grade_submission_deadline).where(
                    Semester.id == graph.sem.id
                )
            )
        )
        # Within a second of the intended instant, not six hours off it.
        assert abs((stored - when).total_seconds()) < 2

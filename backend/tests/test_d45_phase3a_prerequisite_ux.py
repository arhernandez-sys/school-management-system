"""D45 Phase 3A — the four prerequisite UX defects from the §3b investigation.

The ENFORCEMENT gate was never broken. Driving the real API against a copy of `sims`
showed a blocked student going 409 -> 200 the moment the requirement was deleted, so
`test_prerequisites.py` — which covers the gate itself — needed no change at all.

What was broken was everything the Dean SAW around it, and each defect below is the
reason the client reported "I removed the prerequisite but it didn't help":

  P1  `courses.prerequisites_text` survived the delete and kept printing the removed
      requirement, so a successful delete looked like a no-op.
  P2  the picker offered students the gate refuses, and because the enrol endpoint
      validates the whole batch before writing, ONE such pick refused every other
      student in the selection — with a message naming only the first.
  P3  nothing answered "which courses require this one", so the natural move was to
      edit the PREVIOUS course (the one the error names) and change nothing.
  P4  the catalog seeder re-created any requirement a Dean deleted on purpose.

Hermetic + rolled-back via `db_session`, following `test_prerequisites.py`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.common.enums import (
    AcademicYearStatus,
    PrerequisiteType,
    Role,
    StudentStatus,
)
from app.modules.offerings.models import Course, CourseOffering
from app.modules.prerequisites.models import CoursePrerequisite
from app.modules.settings.models import (
    AcademicYear,
    AuditLog,
    GradingScale,
    GradingScaleBand,
    Semester,
)
from app.modules.students.models import StudentProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

COURSES = "/api/v1/courses"
OFFERINGS = "/api/v1/offerings"


# ──────────────────────────────────────────────────────────────────────────────
# Builders (deliberately the same shapes as test_prerequisites.py)
# ──────────────────────────────────────────────────────────────────────────────
def _course(db_session, *, like=None, text=None) -> Course:
    tag = uuid.uuid4().hex[:8].upper()
    c = Course(
        code=f"{like}-{tag}" if like else f"C{tag}",
        name=f"Course {tag}",
        credits=3,
        prerequisites_text=text,
    )
    db_session.add(c)
    db_session.flush()
    return c


def _require(db_session, *, course, prerequisite) -> CoursePrerequisite:
    row = CoursePrerequisite(
        course_id=course.id,
        prerequisite_course_id=prerequisite.id,
        requirement_type=PrerequisiteType.COURSE,
    )
    db_session.add(row)
    db_session.flush()
    return row


def _student(db_session) -> StudentProfile:
    s = StudentProfile(
        student_number=f"S-{uuid.uuid4().hex[:8]}",
        **split_name(f"Stu {uuid.uuid4().hex[:5]}"),
        date_of_birth=date(2007, 5, 1),
        enrollment_date=date(2025, 9, 1),
        status=StudentStatus.ACTIVE,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _year_with_terms(db_session, archive_seeded_active_year):
    archive_seeded_active_year()
    tag = uuid.uuid4().hex[:6]
    year = AcademicYear(
        name=f"PY {tag}",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 6, 30),
        status=AcademicYearStatus.ACTIVE,
    )
    db_session.add(year)
    db_session.flush()
    current = Semester(
        academic_year_id=year.id, name="Session 2", sequence=2,
        start_date=date(2026, 1, 19), end_date=date(2026, 6, 30), is_active=True,
    )
    db_session.add(current)
    db_session.flush()
    scale = GradingScale(academic_year_id=year.id, pass_mark=Decimal("60.00"))
    db_session.add(scale)
    db_session.flush()
    db_session.add(
        GradingScaleBand(
            grading_scale_id=scale.id, letter="F", min_score=Decimal("0"),
            max_score=Decimal("69.99"), is_passing=False, sort_order=1,
        )
    )
    db_session.flush()
    return year, current


def _offering(db_session, course, semester) -> CourseOffering:
    o = CourseOffering(
        course_id=course.id,
        semester_id=semester.id,
        section_code=uuid.uuid4().hex[:6],
    )
    db_session.add(o)
    db_session.flush()
    return o


# ════════════════════════════════════════════════════════════════════════════
class TestP1TheFreeTextIsClearedWithTheLastRule:
    """§3b P1. `prerequisites_text` is prose seeded from the BAJC PDF and is NEVER read
    by the gate — but it is rendered right beside the enforced list, so leaving it
    behind after the last delete is what made the delete look like it had failed."""

    def test_removing_the_last_requirement_clears_the_text(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        required = _course(db_session, like="MATH1110")
        gated = _course(db_session, like="MATH1210", text="MATH1110")
        row = _require(db_session, course=gated, prerequisite=required)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        before = client.get(f"{COURSES}/{gated.id}/prerequisites", headers=H).json()
        assert before["prerequisites_text"] == "MATH1110"

        resp = client.delete(
            f"{COURSES}/{gated.id}/prerequisites/{row.id}", headers=H
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["items"] == []
        # The whole point: the screen must not go on naming a requirement that is gone.
        assert body["prerequisites_text"] is None

    def test_removing_ONE_of_two_leaves_the_text_alone(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The text describes the whole requirement set, so it is only meaningless once
        the set is empty. Clearing it on the first of two deletes would throw away a
        still-accurate description of the requirement that remains."""
        a = _course(db_session)
        b = _course(db_session)
        gated = _course(db_session, text="A and B")
        row_a = _require(db_session, course=gated, prerequisite=a)
        _require(db_session, course=gated, prerequisite=b)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        body = client.delete(
            f"{COURSES}/{gated.id}/prerequisites/{row_a.id}", headers=H
        ).json()
        assert len(body["items"]) == 1
        assert body["prerequisites_text"] == "A and B"

    def test_the_cleared_text_and_the_pair_are_recorded_in_the_audit(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Clearing the text is the one destructive step in this module, and P4 depends
        on the removed PAIR being recoverable from the log."""
        required = _course(db_session)
        gated = _course(db_session, text="the printed wording")
        row = _require(db_session, course=gated, prerequisite=required)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        client.delete(f"{COURSES}/{gated.id}/prerequisites/{row.id}", headers=H)

        entry = db_session.scalar(
            select(AuditLog)
            .where(
                AuditLog.action == "course_prerequisite.remove",
                AuditLog.entity_id == gated.id,
            )
            .order_by(AuditLog.created_at.desc())
        )
        assert entry is not None
        assert entry.summary["cleared_prerequisites_text"] == "the printed wording"
        assert entry.summary["prerequisite_course_id"] == str(required.id)
        assert entry.summary["requirement_type"] == "course"

    def test_a_course_with_no_text_is_not_disturbed(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """No text to clear must not mean an audit row claiming one was cleared."""
        required = _course(db_session)
        gated = _course(db_session)  # prerequisites_text is NULL
        row = _require(db_session, course=gated, prerequisite=required)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        body = client.delete(
            f"{COURSES}/{gated.id}/prerequisites/{row.id}", headers=H
        ).json()
        assert body["prerequisites_text"] is None
        entry = db_session.scalar(
            select(AuditLog)
            .where(
                AuditLog.action == "course_prerequisite.remove",
                AuditLog.entity_id == gated.id,
            )
            .order_by(AuditLog.created_at.desc())
        )
        assert "cleared_prerequisites_text" not in entry.summary


# ════════════════════════════════════════════════════════════════════════════
class TestP3TheReverseView:
    """§3b P3. A requirement is stored on the course it BLOCKS. Without a reverse view
    the Dean's only lead is the error message, which names the course they already
    passed — so they open that one and remove a requirement that gates nothing."""

    def test_a_course_reports_what_it_gates(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        pre = _course(db_session, like="MATH1210")
        calc1 = _course(db_session, like="MATH1206")
        _require(db_session, course=calc1, prerequisite=pre)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        body = client.get(f"{COURSES}/{pre.id}/prerequisites", headers=H).json()
        # Pre-Calculus requires nothing, but Calculus 1 depends on it — and THAT is the
        # course the Dean actually has to edit.
        assert body["items"] == []
        assert [c["code"] for c in body["required_by"]] == [calc1.code]

    def test_a_course_that_gates_nothing_reports_an_empty_list(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        leaf = _course(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        body = client.get(f"{COURSES}/{leaf.id}/prerequisites", headers=H).json()
        assert body["required_by"] == []

    def test_the_two_directions_do_not_bleed_into_each_other(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A -> B -> C. B both requires and is required, and the two lists must not
        swap: reading them backwards is precisely the mistake this prevents."""
        a = _course(db_session)
        b = _course(db_session)
        c = _course(db_session)
        _require(db_session, course=b, prerequisite=a)
        _require(db_session, course=c, prerequisite=b)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        body = client.get(f"{COURSES}/{b.id}/prerequisites", headers=H).json()
        assert [i["prerequisite_course"]["code"] for i in body["items"]] == [a.code]
        assert [x["code"] for x in body["required_by"]] == [c.code]

    def test_reading_is_open_to_any_authenticated_role(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Prospectus material. A student deciding what to take next needs to see which
        doors a course opens, which is exactly what `required_by` says."""
        pre = _course(db_session)
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=pre)
        teacher = make_user(role=Role.TEACHER)
        H = auth_headers(user_id=teacher.id, role=Role.TEACHER)
        body = client.get(f"{COURSES}/{pre.id}/prerequisites", headers=H).json()
        assert [x["code"] for x in body["required_by"]] == [gated.code]


# ════════════════════════════════════════════════════════════════════════════
class TestP2ThePickerAndTheBatchRefusal:
    """§3b P2. The gate is unchanged and remains the authority; what changes is that
    the Dean can now see the refusal before submitting, and that a refusal accounts for
    every student rather than the first one the loop happened to reach."""

    @staticmethod
    def _enrol(client, H, offering_id, student_ids, semester_id):
        return client.post(
            f"{OFFERINGS}/{offering_id}/enrollments",
            headers=H,
            json={"student_ids": [str(s) for s in student_ids],
                  "semester_id": str(semester_id)},
        )

    def test_the_picker_flags_a_student_the_gate_will_refuse(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _year, current = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="MATH1110")
        gated = _course(db_session, like="MATH1210")
        _require(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, current)
        student = _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        rows = client.get(
            f"{OFFERINGS}/{offering.id}/enrollable-students", headers=H
        ).json()["items"]
        mine = [r for r in rows if r["id"] == str(student.id)]
        assert mine, "the student must still be LISTED — hiding them loses the reason"
        assert mine[0]["eligible"] is False
        # The reason has to name the course, or it is no better than a bare refusal.
        assert required.code in mine[0]["ineligible_reason"]

    def test_an_ungated_course_marks_everyone_eligible(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The overwhelmingly common case, and the one the early exit protects: no
        prerequisite rows means no per-student grade reads at all."""
        _year, current = _year_with_terms(db_session, archive_seeded_active_year)
        course = _course(db_session)
        offering = _offering(db_session, course, current)
        _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        rows = client.get(
            f"{OFFERINGS}/{offering.id}/enrollable-students", headers=H
        ).json()["items"]
        assert rows, "fixture should leave at least one active student"
        assert all(r["eligible"] is True for r in rows)
        assert all(r["ineligible_reason"] is None for r in rows)

    def test_a_batch_refusal_names_EVERY_blocked_student(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The defect: `assert_eligible` raised on the first student, so the Dean
        learned about the others one failed submission at a time."""
        _year, current = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="MATH1110")
        gated = _course(db_session, like="MATH1210")
        _require(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, current)
        one, two = _student(db_session), _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        resp = self._enrol(client, H, offering.id, [one.id, two.id], current.id)
        assert resp.status_code == 409, resp.text
        msg = resp.json()["error"]["message"]
        assert one.full_name in msg
        assert two.full_name in msg
        # And it must say the batch was refused WHOLESALE, because it was.
        assert "none were enrolled" in msg

    def test_a_single_blocked_student_still_reads_naturally(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The plural rewrite must not make the ordinary one-student case ungrammatical
        — `test_prerequisites.py` pins this wording."""
        _year, current = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="MATH1110")
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, current)
        student = _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        resp = self._enrol(client, H, offering.id, [student.id], current.id)
        assert resp.status_code == 409
        msg = resp.json()["error"]["message"]
        assert msg.startswith(f"{student.full_name} has not met the prerequisites:")
        assert "Not yet taken" in msg
        assert "none were enrolled" not in msg

    def test_nothing_is_written_when_one_of_the_batch_is_blocked(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """All-or-nothing is DELIBERATE and must survive the message change: a partial
        commit would leave the Dean unable to tell who got in."""
        from app.modules.offerings.models import ClassEnrollment

        _year, current = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session)
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, current)
        blocked, other = _student(db_session), _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        self._enrol(client, H, offering.id, [blocked.id, other.id], current.id)

        rows = db_session.scalars(
            select(ClassEnrollment).where(ClassEnrollment.offering_id == offering.id)
        ).all()
        assert rows == []

    def test_removing_the_requirement_lets_the_same_batch_through(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The reported scenario, end to end: the thing the client said did not work."""
        _year, current = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session)
        gated = _course(db_session, text="the printed wording")
        row = _require(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, current)
        one, two = _student(db_session), _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        assert self._enrol(
            client, H, offering.id, [one.id, two.id], current.id
        ).status_code == 409

        client.delete(f"{COURSES}/{gated.id}/prerequisites/{row.id}", headers=H)

        resp = self._enrol(client, H, offering.id, [one.id, two.id], current.id)
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["enrolled"]) == 2
        # ...and the screen no longer contradicts the outcome.
        after = client.get(f"{COURSES}/{gated.id}/prerequisites", headers=H).json()
        assert after["items"] == []
        assert after["prerequisites_text"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestP4TheSeederHonoursADeliberateDeletion:
    """§3b P4. `seed_bajc._seed_prerequisites` is idempotent on the (course,
    prerequisite, programme) tuple, so it re-creates anything ABSENT — including a
    requirement a Dean deleted on purpose.

    `run_seed()` opens its own `SessionLocal` and so cannot see this test's rolled-back
    transaction; the seeder's end-to-end behaviour was verified by execution against a
    copy of `sims`. What is pinned here is the thing that behaviour depends on — that a
    removal leaves durable, matchable evidence of intent in the audit log.
    """

    def test_a_removal_is_matchable_by_pair(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        from app.db.seed_bajc import _seed_prerequisites  # noqa: F401  (import guard)

        required = _course(db_session)
        gated = _course(db_session)
        row = _require(db_session, course=gated, prerequisite=required)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        client.delete(f"{COURSES}/{gated.id}/prerequisites/{row.id}", headers=H)

        # This is exactly the lookup `deliberately_removed()` performs.
        summaries = db_session.scalars(
            select(AuditLog.summary).where(
                AuditLog.action == "course_prerequisite.remove",
                AuditLog.entity_id == gated.id,
            )
        ).all()
        assert any(
            s.get("prerequisite_course_id") == str(required.id)
            and s.get("program_id") is None
            for s in summaries
            if isinstance(s, dict)
        )

    def test_an_unrelated_removal_does_not_match(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The predicate matches on the PAIR, not the course: two requirements on one
        course must not make each other look deleted."""
        a = _course(db_session)
        b = _course(db_session)
        gated = _course(db_session)
        row_a = _require(db_session, course=gated, prerequisite=a)
        _require(db_session, course=gated, prerequisite=b)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        client.delete(f"{COURSES}/{gated.id}/prerequisites/{row_a.id}", headers=H)

        summaries = [
            s
            for s in db_session.scalars(
                select(AuditLog.summary).where(
                    AuditLog.action == "course_prerequisite.remove",
                    AuditLog.entity_id == gated.id,
                )
            ).all()
            if isinstance(s, dict)
        ]
        assert any(s.get("prerequisite_course_id") == str(a.id) for s in summaries)
        assert not any(s.get("prerequisite_course_id") == str(b.id) for s in summaries)

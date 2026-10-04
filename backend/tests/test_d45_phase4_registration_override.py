"""D45 Phase 4 — §12/§20 the authorized registration override.

BAJC answered §20's "???" on 2026-09-09: **the prerequisite rule and the student-status
rule are overridable; capacity is not; the Dean alone may authorise.**

Capacity was excluded deliberately. It is warn-only today — the enrol succeeds and
returns `over_capacity_warning` — so there is nothing to override, and making it
overridable would first mean making it a refusal.

⚠️ `year_archived` and `semester_mismatch` are NOT overridable and must never become so.
They are integrity invariants, not academic policy: an enrolment in an archived year, or
in a term the offering does not run in, produces a row no screen can explain. There is a
test below that pins this.

**A rule that had to be built before it could be waived.** The status rule was enforced
only in the PICKER (`enrollable_students` filtered to `Active`); this endpoint checked
`deleted_at` and nothing else. Verified by execution against a copy of `sims`: a student
forced to `Graduated` disappeared from the picker and was still enrolled with a `200` by a
direct call. A filtered dropdown is not an access rule.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.common.enums import AcademicYearStatus, PrerequisiteType, Role, StudentStatus
from app.modules.offerings.models import ClassEnrollment, Course, CourseOffering
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

OFFERINGS = "/api/v1/offerings"


# ──────────────────────────────────────────────────────────────────────────────
def _course(db_session) -> Course:
    tag = uuid.uuid4().hex[:8].upper()
    c = Course(code=f"C{tag}", name=f"Course {tag}", credits=3)
    db_session.add(c)
    db_session.flush()
    return c


def _student(db_session, *, status=StudentStatus.ACTIVE) -> StudentProfile:
    s = StudentProfile(
        student_number=f"S-{uuid.uuid4().hex[:8]}",
        **split_name(f"Stu {uuid.uuid4().hex[:5]}"),
        date_of_birth=date(2007, 5, 1),
        enrollment_date=date(2025, 9, 1),
        status=status,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _year(db_session, archive_seeded_active_year):
    archive_seeded_active_year()
    year = AcademicYear(
        name=f"PY {uuid.uuid4().hex[:6]}",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 6, 30),
        status=AcademicYearStatus.ACTIVE,
    )
    db_session.add(year)
    db_session.flush()
    term = Semester(
        academic_year_id=year.id, name="Session 2", sequence=2,
        start_date=date(2026, 1, 19), end_date=date(2026, 6, 30), is_active=True,
    )
    db_session.add(term)
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
    return year, term


def _offering(db_session, course, term) -> CourseOffering:
    o = CourseOffering(
        course_id=course.id, semester_id=term.id, section_code=uuid.uuid4().hex[:6]
    )
    db_session.add(o)
    db_session.flush()
    return o


def _gate(db_session, *, course, prerequisite) -> None:
    db_session.add(
        CoursePrerequisite(
            course_id=course.id,
            prerequisite_course_id=prerequisite.id,
            requirement_type=PrerequisiteType.COURSE,
        )
    )
    db_session.flush()


def _enrol(client, H, offering_id, ids, term_id, override=None):
    body = {
        "student_ids": [str(i) for i in ids],
        "semester_id": str(term_id),
    }
    if override is not None:
        body["override"] = override
    return client.post(f"{OFFERINGS}/{offering_id}/enrollments", headers=H, json=body)


def _waivers(db_session, offering_id):
    return db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == "enrollment.override",
            AuditLog.entity_id == offering_id,
        )
    ).all()


# ════════════════════════════════════════════════════════════════════════════
class TestTheStatusRuleIsNowEnforced:
    """§20. This is a NEW restriction, not just a new override — before Phase 4 the rule
    lived in the picker's WHERE clause and the endpoint honoured nothing."""

    def test_a_graduated_student_is_refused(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [grad.id], term.id)
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "student_not_enrollable"
        # The message must say the status AND that a way forward exists.
        assert "Graduated" in r.json()["error"]["message"]
        assert "override" in r.json()["error"]["message"].lower()

    def test_an_active_student_is_unaffected(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The ordinary path must not have become harder."""
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        student = _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        assert _enrol(client, H, offering.id, [student.id], term.id).status_code == 200

    @pytest.mark.parametrize(
        "status",
        [
            StudentStatus.INACTIVE,
            StudentStatus.SUSPENDED,
            StudentStatus.WITHDRAWN,
            StudentStatus.DROPOUT,
            StudentStatus.ALUMNI,
            StudentStatus.APPLICANT,
        ],
    )
    def test_every_non_active_status_is_barred(
        self, client, make_user, auth_headers, db_session,
        archive_seeded_active_year, status,
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        student = _student(db_session, status=status)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [student.id], term.id)
        assert r.status_code == 409, f"{status} should be barred: {r.text}"
        assert r.json()["error"]["code"] == "student_not_enrollable"


# ════════════════════════════════════════════════════════════════════════════
class TestOnlyTheDeanMayOverride:
    """D30 §D14 — the Registrar runs registration, but waiving an academic rule is an
    academic-structure decision. The Registrar sees the refusal and escalates."""

    def test_the_registrar_is_refused(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        registrar = make_user(role=Role.SECRETARY)
        H = auth_headers(user_id=registrar.id, role=Role.SECRETARY)

        r = _enrol(client, H, offering.id, [grad.id], term.id,
                   {"student_status": True, "reason": "self-authorised"})
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "override_not_permitted"

    def test_the_registrar_can_still_enrol_normally(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The 403 is about the OVERRIDE, not the endpoint — a blanket refusal here
        would take registration away from the office that does it."""
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        student = _student(db_session)
        registrar = make_user(role=Role.SECRETARY)
        H = auth_headers(user_id=registrar.id, role=Role.SECRETARY)

        assert _enrol(client, H, offering.id, [student.id], term.id).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestAReasonIsRequired:
    """§12/§20 — every override is logged. A waiver with no stated cause is not an audit
    record, it is a hole with a name on it."""

    def test_an_override_with_no_reason_is_a_422(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [grad.id], term.id, {"student_status": True})
        assert r.status_code == 422, r.text

    def test_a_token_reason_is_a_422(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [grad.id], term.id,
                   {"student_status": True, "reason": "ok"})
        assert r.status_code == 422, r.text


# ════════════════════════════════════════════════════════════════════════════
class TestTheOverrideWorksAndIsLogged:

    def test_the_dean_can_waive_the_prerequisite(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _gate(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, term)
        one, two = _student(db_session), _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        assert _enrol(client, H, offering.id, [one.id, two.id], term.id).status_code == 409

        r = _enrol(client, H, offering.id, [one.id, two.id], term.id,
                   {"prerequisites": True, "reason": "Both sat the August make-up exam."})
        assert r.status_code == 200, r.text
        assert len(r.json()["enrolled"]) == 2

        # One row per student per rule — "this student was let into this course despite
        # this rule" is the question the log has to answer afterwards.
        rows = _waivers(db_session, offering.id)
        assert len(rows) == 2
        assert {r.summary["student_id"] for r in rows} == {str(one.id), str(two.id)}
        assert all(r.summary["rule"] == "prerequisites" for r in rows)
        assert all("make-up exam" in r.summary["reason"] for r in rows)
        assert all(r.actor_user_id == dean.id for r in rows)

    def test_the_dean_can_waive_the_status_rule(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [grad.id], term.id,
                   {"student_status": True,
                    "reason": "Returning graduate taking one course for credit."})
        assert r.status_code == 200, r.text
        rows = _waivers(db_session, offering.id)
        assert len(rows) == 1
        assert rows[0].summary["rule"] == "student_status"
        assert "Graduated" in rows[0].summary["detail"]

    def test_the_rule_stays_in_force_for_everyone_else(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The whole reason an override exists. Before Phase 4 the only way through was
        to DELETE the requirement, which lifted it for the entire college — and that is
        exactly what happened in practice."""
        _y, term = _year(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _gate(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, term)
        waived, other = _student(db_session), _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        assert _enrol(client, H, offering.id, [waived.id], term.id,
                      {"prerequisites": True, "reason": "Dean approved this student."}
                      ).status_code == 200
        # The next student hits the same wall.
        r = _enrol(client, H, offering.id, [other.id], term.id)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "prerequisite_not_met"
        # ...and the requirement row is untouched.
        assert db_session.scalar(
            select(CoursePrerequisite).where(CoursePrerequisite.course_id == gated.id)
        ) is not None

    def test_an_override_nothing_needed_writes_no_waiver(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """A waiver that never happened must not appear in the audit trail — it would
        accuse the Dean of setting aside a rule that never fired."""
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        student = _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [student.id], term.id,
                   {"prerequisites": True, "student_status": True,
                    "reason": "belt and braces, nothing was actually blocked"})
        assert r.status_code == 200, r.text
        assert _waivers(db_session, offering.id) == []

    def test_waiving_one_rule_does_not_waive_the_other(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`prerequisites: true` must not let a graduated student through."""
        _y, term = _year(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _gate(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [grad.id], term.id,
                   {"prerequisites": True, "reason": "only the prerequisite is waived"})
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "student_not_enrollable"


# ════════════════════════════════════════════════════════════════════════════
class TestIntegrityInvariantsAreNotOverridable:
    """The line this phase must not cross. A waiver is for a rule the institution may
    choose to set aside — not for a contradiction in the record."""

    def test_semester_mismatch_survives_an_override(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        other_term = Semester(
            academic_year_id=_y.id, name="Session 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 15), is_active=False,
        )
        db_session.add(other_term)
        db_session.flush()
        offering = _offering(db_session, _course(db_session), term)
        student = _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = _enrol(client, H, offering.id, [student.id], other_term.id,
                   {"prerequisites": True, "student_status": True,
                    "reason": "trying to force a term the offering does not run in"})
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "semester_mismatch"
        assert _waivers(db_session, offering.id) == []


# ════════════════════════════════════════════════════════════════════════════
class TestThePicker:

    def test_barred_students_are_hidden_by_default_and_shown_on_request(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The status override is unreachable from the UI if the student cannot be seen,
        so the Dean can ask for them — flagged, and out of the ordinary path."""
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        default = client.get(
            f"{OFFERINGS}/{offering.id}/enrollable-students", headers=H
        ).json()["items"]
        assert str(grad.id) not in [s["id"] for s in default]

        widened = client.get(
            f"{OFFERINGS}/{offering.id}/enrollable-students?include_ineligible=true",
            headers=H,
        ).json()["items"]
        row = next(s for s in widened if s["id"] == str(grad.id))
        assert row["eligible"] is False
        assert row["ineligible_rule"] == "student_status"
        assert "Graduated" in row["ineligible_reason"]

    def test_the_registrar_cannot_widen_the_picker(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Ignored rather than a 403: the Registrar cannot override anyway, so the only
        effect would be to show them students they can do nothing about."""
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        registrar = make_user(role=Role.SECRETARY)
        H = auth_headers(user_id=registrar.id, role=Role.SECRETARY)

        rows = client.get(
            f"{OFFERINGS}/{offering.id}/enrollable-students?include_ineligible=true",
            headers=H,
        ).json()["items"]
        assert str(grad.id) not in [s["id"] for s in rows]

    def test_the_prerequisite_rule_is_named_on_the_row(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """So the client waives the rule that actually bars them, not both."""
        _y, term = _year(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _gate(db_session, course=gated, prerequisite=required)
        offering = _offering(db_session, gated, term)
        student = _student(db_session)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        rows = client.get(
            f"{OFFERINGS}/{offering.id}/enrollable-students", headers=H
        ).json()["items"]
        row = next(s for s in rows if s["id"] == str(student.id))
        assert row["eligible"] is False
        assert row["ineligible_rule"] == "prerequisites"


# ════════════════════════════════════════════════════════════════════════════
class TestTheOtherDoor:
    """`POST /students` with `offering_ids` enrols without touching the offerings
    endpoint. A rule enforced at one entrance only is not enforced — the prerequisite
    gate was already duplicated here for exactly this reason, and the status rule now
    is too. There is deliberately NO override on this path: a waiver needs a reason,
    and this is student creation, where the answer is to fix the status first."""

    def test_a_graduated_student_cannot_be_enrolled_through_student_registration(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        _y, term = _year(db_session, archive_seeded_active_year)
        offering = _offering(db_session, _course(db_session), term)
        grad = _student(db_session, status=StudentStatus.GRADUATED)
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        r = client.patch(
            f"/api/v1/students/{grad.id}",
            headers=H,
            json={"offering_ids": [str(offering.id)]},
        )
        # Either the field is not accepted on PATCH (422) or the gate refuses it (409) —
        # what must NOT happen is a 200 that quietly seats a graduate.
        assert r.status_code in (409, 422), r.text
        if r.status_code == 409:
            assert r.json()["error"]["code"] == "student_not_enrollable"
        assert db_session.scalars(
            select(ClassEnrollment).where(ClassEnrollment.offering_id == offering.id)
        ).all() == []

"""Course prerequisites and the enrolment gate — D30 Phase 2C (§D4, brief §17).

Oracle: `docs/tertiary-refactor-plan.md` §D4/§D5 and `005_tertiary.sql` §5.

WHAT THIS REPLACES. `courses.prerequisites varchar(50)` — free text, no FK,
unqueryable, and too short for the real values. `AGRI2118 ← AGRI1108, AGRI1109` fitted;
`EDUC2305 ← EDUC1210, 2226, 2228, 2330, 2334, 2336` did not, and
`EDUC3201 ← ALL COURSES` could not be expressed at all.

THE RULE, and every clause of it is tested below:

    A prerequisite is satisfied only by SUCCESSFUL COMPLETION — a passing term grade
    (frozen or live) or an approved credit transfer — judged against the student's
    PROGRAMME pass mark. Prior enrolment is never enough. Sitting the prerequisite in
    the same term as the course it gates is never enough. A block is a 409 that names
    the missing courses AND the grade actually earned.

Hermetic + rolled-back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.common.enums import (
    AcademicYearStatus,
    PrerequisiteType,
    Role,
    StudentStatus,
)
from app.modules.offerings.models import CourseOffering, ClassEnrollment, CourseOffering, Course
from app.modules.grades.models import TermGradeSnapshot
from app.modules.prerequisites.models import CoursePrerequisite
from app.modules.programs.models import Program, ProgramCourse
from app.modules.settings.models import (
    AcademicYear,
    GradingScale,
    GradingScaleBand,
    Semester,
)
from app.modules.students.models import StudentProfile
from app.modules.users.models import User  # noqa: F401 — FK target for the flushes
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

COURSES = "/api/v1/courses"


def _prereq_path(course_id) -> str:  # noqa: ANN001
    return f"{COURSES}/{course_id}/prerequisites"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# Graph builders
# ──────────────────────────────────────────────────────────────────────────────
def _course(db_session, *, like=None, name=None, credits=3) -> Course:
    """A catalog course.

    `like` echoes a REAL BAJC code so a test reads as the case it is about
    ("EDUC3201 <- ALL COURSES"), but a unique suffix is always appended: since Phase 2D
    seeded the actual 26/27 catalog, a fixture using the literal code would collide on
    `uq_courses_code` — and a test that depends on seeded reference data is not
    hermetic anyway.
    """
    tag = uuid.uuid4().hex[:8].upper()
    c = Course(
        code=f"{like}-{tag}" if like else f"C{tag}",
        name=name or f"Course {tag}",
        credits=credits,
    )
    db_session.add(c)
    db_session.flush()
    return c


def _program(db_session, *, min_gp="2.50") -> Program:
    tag = uuid.uuid4().hex[:6].upper()
    p = Program(
        code=f"P{tag}"[:10],
        name=f"Program {tag}",
        min_passing_grade_point=Decimal(min_gp),
    )
    db_session.add(p)
    db_session.flush()
    return p


def _student(db_session, *, program_id=None) -> StudentProfile:
    s = StudentProfile(
        student_number=f"S-{uuid.uuid4().hex[:8]}",
        **split_name(f"Stu {uuid.uuid4().hex[:5]}"),
        date_of_birth=date(2007, 5, 1),
        enrollment_date=date(2025, 9, 1),
        status=StudentStatus.ACTIVE,
        program_id=program_id,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _year_with_terms(db_session, archive_seeded_active_year):
    """A writable active year with TWO terms — the second is the one enrolled into,
    so results earned in the first are 'previously completed'."""
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
    past = Semester(
        academic_year_id=year.id, name="Semester 1", sequence=1,
        start_date=date(2025, 9, 1), end_date=date(2026, 1, 15), is_active=False,
    )
    current = Semester(
        academic_year_id=year.id, name="Semester 2", sequence=2,
        start_date=date(2026, 1, 19), end_date=date(2026, 6, 30), is_active=True,
    )
    db_session.add_all([past, current])
    db_session.flush()

    # A grading scale for the year, so letters resolve. `grade_point` is left NULL,
    # which is the state of every scale in the database until Phase 3 seeds the BAJC
    # 8-band scale — so these tests exercise the `is_passing` fallback arm by default.
    scale = GradingScale(academic_year_id=year.id, pass_mark=Decimal("60.00"))
    db_session.add(scale)
    db_session.flush()
    db_session.add_all(
        [
            GradingScaleBand(grading_scale_id=scale.id, letter="A", min_score=Decimal("90"),
                             max_score=Decimal("100"), is_passing=True, sort_order=1),
            GradingScaleBand(grading_scale_id=scale.id, letter="C", min_score=Decimal("70"),
                             max_score=Decimal("89.99"), is_passing=True, sort_order=2),
            GradingScaleBand(grading_scale_id=scale.id, letter="F", min_score=Decimal("0"),
                             max_score=Decimal("69.99"), is_passing=False, sort_order=3),
        ]
    )
    db_session.flush()
    return year, past, current, scale


def _offering(db_session, year_id, course, *, semester=None):
    """One offering of `course`, in a term of `year_id`.

    D31 made this ONE row where it used to be two (a section, then the subject attached
    to it). Both return values are the same object now; the pair is kept so the ~20 call
    sites reading `section, cs = _offering(...)` still say what they mean.

    `semester` defaults to the year's ACTIVE term — the one enrolments name. An offering
    is semester-scoped now, so it can no longer be created from a year id alone (which is
    the whole point of D31), and enrolling into an offering that runs in a different term
    is a `semester_mismatch` 409. Pass `semester=past` for the PRIOR-term offerings that
    stand in for previously-completed courses.
    """
    from app.modules.settings.models import Semester

    if semester is None:
        semester = db_session.scalar(
            select(Semester)
            .where(
                Semester.academic_year_id == year_id,
                Semester.is_active.is_(True),
            )
        ) or db_session.scalar(
            select(Semester)
            .where(Semester.academic_year_id == year_id)
            .order_by(Semester.sequence.asc())
            .limit(1)
        )
    offering = CourseOffering(
        course_id=course.id,
        semester_id=semester.id,
        # Unique on (course, semester, section), and several tests put two offerings of
        # the same course in one term.
        section_code=uuid.uuid4().hex[:6],
    )
    db_session.add(offering)
    db_session.flush()
    return offering, offering


def _snapshot(db_session, *, student, cs, semester, course, letter, numeric):
    """A FROZEN term result — what the archive freeze writes."""
    snap = TermGradeSnapshot(
        student_id=student.id,
        offering_id=cs.id,
        semester_id=semester.id,
        subject_id=course.id,
        numeric_grade=Decimal(numeric),
        letter_grade=letter,
        weight_base_used=Decimal("100"),
        frozen_at=_now(),
    )
    db_session.add(snap)
    db_session.flush()
    return snap


def _require(db_session, *, course, prerequisite=None, program=None, kind=PrerequisiteType.COURSE):
    row = CoursePrerequisite(
        course_id=course.id,
        prerequisite_course_id=prerequisite.id if prerequisite else None,
        program_id=program.id if program else None,
        requirement_type=kind,
    )
    db_session.add(row)
    db_session.flush()
    return row


# ════════════════════════════════════════════════════════════════════════════
# CRUD
# ════════════════════════════════════════════════════════════════════════════
class TestPrerequisiteCrud:
    def test_any_authenticated_role_can_read(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Prospectus material — a student deciding what to take next needs it."""
        course = _course(db_session)
        for role in (Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.STUDENT):
            user = make_user(role=role)
            resp = client.get(
                _prereq_path(course.id), headers=auth_headers(user_id=user.id, role=role)
            )
            assert resp.status_code == 200, f"{role}: {resp.text}"
            assert resp.json()["items"] == []

    def test_dean_adds_a_course_requirement(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        gated = _course(db_session, like="BIOL1204L")
        required = _course(db_session, like="BIOL1102L")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _prereq_path(gated.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"prerequisite_course_id": str(required.id)},
        )
        assert resp.status_code == 201, resp.text
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["requirement_type"] == "course"
        assert items[0]["prerequisite_course"]["code"].startswith("BIOL1102L-")
        assert items[0]["program"] is None

    def test_a_course_can_have_many_requirements(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`EDUC2305 ← EDUC1210, 2226, 2228, 2330, 2334, 2336` — six rows. The old
        `varchar(50)` could not hold that string, let alone query it."""
        gated = _course(db_session, like="EDUC2305")
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        for code in ("EDUC1210", "EDUC2226", "EDUC2228", "EDUC2330", "EDUC2334", "EDUC2336"):
            required = _course(db_session, like=code)
            resp = client.post(
                _prereq_path(gated.id), headers=H,
                json={"prerequisite_course_id": str(required.id)},
            )
            assert resp.status_code == 201, resp.text
        assert len(resp.json()["items"]) == 6

    def test_all_program_courses_requirement(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`EDUC3201` (Internship) ← literally "ALL COURSES" on the sequence."""
        gated = _course(db_session, like="EDUC3201")
        program = _program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _prereq_path(gated.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"requirement_type": "all_program_courses", "program_id": str(program.id)},
        )
        assert resp.status_code == 201, resp.text
        item = resp.json()["items"][0]
        assert item["requirement_type"] == "all_program_courses"
        assert item["prerequisite_course"] is None
        assert item["program"]["code"] == program.code

    def test_all_program_courses_needs_a_programme_422(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """"Every course in the programme" is meaningless without saying which."""
        gated = _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _prereq_path(gated.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"requirement_type": "all_program_courses"},
        )
        assert resp.status_code == 422, resp.text
        assert "program_id" in resp.json()["error"]["fields"]

    def test_all_program_courses_cannot_also_name_a_course_422(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Two different requirements in one row — `ck_course_prereq_shape` forbids
        it at the database, and this catches it as a 422 rather than a 500."""
        gated = _course(db_session)
        other = _course(db_session)
        program = _program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _prereq_path(gated.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "requirement_type": "all_program_courses",
                "program_id": str(program.id),
                "prerequisite_course_id": str(other.id),
            },
        )
        assert resp.status_code == 422, resp.text

    def test_course_requirement_needs_a_course_422(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        gated = _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _prereq_path(gated.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"requirement_type": "course"},
        )
        assert resp.status_code == 422, resp.text

    def test_a_course_cannot_require_itself_422(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        course = _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _prereq_path(course.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"prerequisite_course_id": str(course.id)},
        )
        assert resp.status_code == 422, resp.text

    def test_a_cycle_is_refused_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`ck_course_prereq_not_self` catches A→A. It cannot catch A→B→A, and the
        consequence is not cosmetic: both courses become permanently un-enrollable,
        each 409ing about the other — a deadlock the Registrar meets at registration
        and the Dean never sees."""
        a, b, c = _course(db_session), _course(db_session), _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        assert client.post(_prereq_path(b.id), headers=H,
                           json={"prerequisite_course_id": str(a.id)}).status_code == 201
        assert client.post(_prereq_path(c.id), headers=H,
                           json={"prerequisite_course_id": str(b.id)}).status_code == 201
        # a → c would close a → c → b → a.
        resp = client.post(_prereq_path(a.id), headers=H,
                           json={"prerequisite_course_id": str(c.id)})
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="circular_prerequisite")

    def test_duplicate_409(self, client, make_user, auth_headers, db_session) -> None:
        gated, required = _course(db_session), _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        body = {"prerequisite_course_id": str(required.id)}
        assert client.post(_prereq_path(gated.id), headers=H, json=body).status_code == 201
        resp = client.post(_prereq_path(gated.id), headers=H, json=body)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_prerequisite")

    def test_the_same_pair_can_be_global_and_programme_scoped(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`uq_course_prereq` is the whole tuple including `program_id`, which is what
        lets a Dean say "generally X, and in this programme also X" — the only way to
        express a requirement one programme adds and another does not."""
        gated, required = _course(db_session), _course(db_session)
        program = _program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        assert client.post(_prereq_path(gated.id), headers=H,
                           json={"prerequisite_course_id": str(required.id)}).status_code == 201
        resp = client.post(
            _prereq_path(gated.id), headers=H,
            json={"prerequisite_course_id": str(required.id), "program_id": str(program.id)},
        )
        assert resp.status_code == 201, resp.text
        assert len(resp.json()["items"]) == 2

    def test_remove(self, client, make_user, auth_headers, db_session) -> None:
        gated, required = _course(db_session), _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        created = client.post(_prereq_path(gated.id), headers=H,
                              json={"prerequisite_course_id": str(required.id)}).json()
        row_id = created["items"][0]["id"]
        resp = client.delete(f"{_prereq_path(gated.id)}/{row_id}", headers=H)
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []

    def test_a_requirement_cannot_be_reached_through_another_course(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        a, b, required = _course(db_session), _course(db_session), _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        created = client.post(_prereq_path(b.id), headers=H,
                              json={"prerequisite_course_id": str(required.id)}).json()
        row_id = created["items"][0]["id"]
        assert client.delete(f"{_prereq_path(a.id)}/{row_id}", headers=H).status_code == 404

    def test_prerequisites_text_is_returned_but_is_not_the_rule(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The PDF string survives as documentation so the Dean can check the relation
        against what the source actually said. It is never consulted by the gate."""
        course = _course(db_session)
        course.prerequisites_text = "EDUC1210, 2226, 2228, 2330, 2334, 2336"
        db_session.flush()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _prereq_path(course.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["prerequisites_text"] == "EDUC1210, 2226, 2228, 2330, 2334, 2336"
        assert resp.json()["items"] == []  # text alone gates nothing

    def test_writes_are_dean_only(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """§D14 — what a course requires is academic structure, not administration."""
        gated, required = _course(db_session), _course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        created = client.post(
            _prereq_path(gated.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"prerequisite_course_id": str(required.id)},
        ).json()
        row_id = created["items"][0]["id"]

        for role in (Role.SECRETARY, Role.TEACHER, Role.STUDENT):
            user = make_user(role=role)
            H = auth_headers(user_id=user.id, role=role)
            assert client.post(
                _prereq_path(gated.id), headers=H,
                json={"prerequisite_course_id": str(_course(db_session).id)},
            ).status_code == 403, role
            assert client.delete(
                f"{_prereq_path(gated.id)}/{row_id}", headers=H
            ).status_code == 403, role


# ════════════════════════════════════════════════════════════════════════════
# THE GATE
# ════════════════════════════════════════════════════════════════════════════
class TestEnrolmentGate:
    """`POST /offerings/{id}/enrollments` with a prerequisite in the way."""

    def _enrol(self, client, headers, section_id, student_id, semester_id):  # noqa: ANN001
        return client.post(
            f"/api/v1/offerings/{section_id}/enrollments",
            headers=headers,
            json={"student_ids": [str(student_id)], "semester_id": str(semester_id)},
        )

    def test_no_prerequisites_means_no_gate(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The overwhelmingly common case, and the one that must stay cheap."""
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        section, _cs = _offering(db_session, year.id, _course(db_session))
        student = _student(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 200, resp.text

    def test_a_student_who_never_took_it_is_blocked(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="MATH1101")
        gated = _course(db_session, like="MATH2201")
        _require(db_session, course=gated, prerequisite=required)
        section, _cs = _offering(db_session, year.id, gated)
        student = _student(db_session)
        principal = make_user(role=Role.PRINCIPAL)

        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 409, resp.text
        err = _assert_envelope(resp.json(), code="prerequisite_not_met")
        # The 409 NAMES the course and says what is wrong — a bare "not met" leaves
        # the Registrar unable to tell one course short from sat-and-failed.
        assert required.code in err["message"]
        assert "Not yet taken" in err["message"]

    def test_a_passing_frozen_result_satisfies_it(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session)
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=required)

        prev_section, prev_cs = _offering(db_session, year.id, required)
        db_session.add(
            ClassEnrollment(offering_id=prev_section.id, student_id=(student := _student(db_session)).id,
                            semester_id=past.id)
        )
        db_session.flush()
        _snapshot(db_session, student=student, cs=prev_cs, semester=past,
                  course=required, letter="A", numeric="95")

        section, _cs = _offering(db_session, year.id, gated)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 200, resp.text

    def test_taken_and_failed_is_not_completed(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The clause the whole rule turns on: having SAT the course is not enough."""
        year, past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="CHEM1101")
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=required)

        prev_section, prev_cs = _offering(db_session, year.id, required)
        student = _student(db_session)
        db_session.add(
            ClassEnrollment(offering_id=prev_section.id, student_id=student.id, semester_id=past.id)
        )
        db_session.flush()
        _snapshot(db_session, student=student, cs=prev_cs, semester=past,
                  course=required, letter="F", numeric="41")

        section, _cs = _offering(db_session, year.id, gated)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 409, resp.text
        err = _assert_envelope(resp.json(), code="prerequisite_not_met")
        # The grade ACTUALLY EARNED is in the message — that is the half a bare
        # "prerequisite not met" leaves out.
        assert required.code in err["message"]
        assert "earned F" in err["message"]

    def test_sitting_it_in_the_same_term_does_not_count(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """A course cannot satisfy its own prerequisite by being taken alongside it.

        The student holds a passing snapshot for the required course — but in the term
        being enrolled INTO, so it is excluded. Without that exclusion a Registrar
        could enrol a student into MATH1 and MATH2 in one term and the gate would wave
        it through.
        """
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="MATH1101")
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=required)

        same_section, same_cs = _offering(db_session, year.id, required)
        student = _student(db_session)
        db_session.add(
            ClassEnrollment(offering_id=same_section.id, student_id=student.id, semester_id=current.id)
        )
        db_session.flush()
        _snapshot(db_session, student=student, cs=same_cs, semester=current,
                  course=required, letter="A", numeric="95")

        section, _cs = _offering(db_session, year.id, gated)
        principal = make_user(role=Role.PRINCIPAL)
        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="prerequisite_not_met")

    def test_a_programme_scoped_requirement_only_applies_to_that_programme(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session)
        gated = _course(db_session)
        program = _program(db_session)
        _require(db_session, course=gated, prerequisite=required, program=program)

        section, _cs = _offering(db_session, year.id, gated)
        on_program = _student(db_session, program_id=program.id)
        elsewhere = _student(db_session, program_id=_program(db_session).id)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        assert self._enrol(client, H, section.id, on_program.id, current.id).status_code == 409
        assert self._enrol(client, H, section.id, elsewhere.id, current.id).status_code == 200

    def test_the_pass_mark_is_the_programmes(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """§D5 — Primary Education passes at C (2.00), every other programme at C+
        (2.50). Two students with the SAME grade get different answers.

        This is also the only test that exercises the grade-point arm rather than the
        `is_passing` fallback, by seeding `grade_point` on the bands the way Phase 3
        will for the whole school.
        """
        year, past, current, scale = _year_with_terms(db_session, archive_seeded_active_year)
        for band in db_session.scalars(
            select(GradingScaleBand).where(GradingScaleBand.grading_scale_id == scale.id)
        ).all():
            band.grade_point = {"A": Decimal("4.00"), "C": Decimal("2.00"),
                                "F": Decimal("0.00")}[band.letter]
        db_session.flush()

        required, gated = _course(db_session), _course(db_session)
        _require(db_session, course=gated, prerequisite=required)
        lenient = _program(db_session, min_gp="2.00")   # Primary Education
        strict = _program(db_session, min_gp="2.50")    # everything else

        prev_section, prev_cs = _offering(db_session, year.id, required)
        section, _cs = _offering(db_session, year.id, gated)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        results = {}
        for label, program in (("lenient", lenient), ("strict", strict)):
            student = _student(db_session, program_id=program.id)
            db_session.add(
                ClassEnrollment(offering_id=prev_section.id, student_id=student.id,
                                semester_id=past.id)
            )
            db_session.flush()
            # A C is 2.00 — clears Primary Education's bar, misses everyone else's.
            _snapshot(db_session, student=student, cs=prev_cs, semester=past,
                      course=required, letter="C", numeric="72")
            results[label] = self._enrol(client, H, section.id, student.id, current.id)

        assert results["lenient"].status_code == 200, results["lenient"].text
        assert results["strict"].status_code == 409, results["strict"].text

    def test_an_approved_credit_transfer_satisfies_it(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Brief §13 — a transfer is anchored on the APPLICATION, not the student,
        because by policy it can only be requested at admission when no student record
        exists yet. The gate reaches it student → application → transfer.

        Rows are inserted directly: `applications` and `credit_transfer_requests` are
        Phase 4's to own (§D11), and nothing creates them yet. Writing the arm now and
        proving it works is what stops it from being remembered later.
        """
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _require(db_session, course=gated, prerequisite=required)
        section, _cs = _offering(db_session, year.id, gated)
        student = _student(db_session)

        application_id = str(uuid.uuid4())
        db_session.execute(
            text(
                "INSERT INTO applications (id, status, firstname, lastname) "
                "VALUES (:id, 'accepted', 'Transfer', 'Student')"
            ),
            {"id": application_id},
        )
        db_session.execute(
            text("UPDATE student_profiles SET application_id = :aid WHERE id = :sid"),
            {"aid": application_id, "sid": str(student.id)},
        )
        db_session.execute(
            text(
                "INSERT INTO credit_transfer_requests "
                "(id, application_id, external_institution, external_course_name, "
                " target_course_id, content_equivalency_pct, status) "
                "VALUES (:id, :aid, 'Other College', 'Equivalent Course', :cid, 80.00, 'approved')"
            ),
            {"id": str(uuid.uuid4()), "aid": application_id, "cid": str(required.id)},
        )
        db_session.flush()

        principal = make_user(role=Role.PRINCIPAL)
        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 200, resp.text

    def test_a_pending_transfer_does_not_satisfy_it(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """Only an APPROVED transfer counts — a filed request is a claim, not a grant."""
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _require(db_session, course=gated, prerequisite=required)
        section, _cs = _offering(db_session, year.id, gated)
        student = _student(db_session)

        application_id = str(uuid.uuid4())
        db_session.execute(
            text(
                "INSERT INTO applications (id, status, firstname, lastname) "
                "VALUES (:id, 'submitted', 'Pending', 'Student')"
            ),
            {"id": application_id},
        )
        db_session.execute(
            text("UPDATE student_profiles SET application_id = :aid WHERE id = :sid"),
            {"aid": application_id, "sid": str(student.id)},
        )
        db_session.execute(
            text(
                "INSERT INTO credit_transfer_requests "
                "(id, application_id, external_institution, external_course_name, "
                " target_course_id, status) "
                "VALUES (:id, :aid, 'Other College', 'Equivalent Course', :cid, 'pending')"
            ),
            {"id": str(uuid.uuid4()), "aid": application_id, "cid": str(required.id)},
        )
        db_session.flush()

        principal = make_user(role=Role.PRINCIPAL)
        resp = self._enrol(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            section.id, student.id, current.id,
        )
        assert resp.status_code == 409, resp.text

    def test_nothing_is_written_when_one_student_in_a_batch_is_blocked(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """The endpoint takes a LIST. Checking mid-loop would commit the students
        before the blocked one and reject the ones after — a half-enrolled batch the
        Registrar has no way to see."""
        year, past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required, gated = _course(db_session), _course(db_session)
        _require(db_session, course=gated, prerequisite=required)

        prev_section, prev_cs = _offering(db_session, year.id, required)
        eligible = _student(db_session)
        db_session.add(
            ClassEnrollment(offering_id=prev_section.id, student_id=eligible.id, semester_id=past.id)
        )
        db_session.flush()
        _snapshot(db_session, student=eligible, cs=prev_cs, semester=past,
                  course=required, letter="A", numeric="95")
        blocked = _student(db_session)

        section, _cs = _offering(db_session, year.id, gated)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"/api/v1/offerings/{section.id}/enrollments",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "student_ids": [str(eligible.id), str(blocked.id)],
                "semester_id": str(current.id),
            },
        )
        assert resp.status_code == 409, resp.text
        # The ELIGIBLE student was not enrolled either.
        n = db_session.scalar(
            select(ClassEnrollment).where(
                ClassEnrollment.offering_id == section.id,
                ClassEnrollment.student_id == eligible.id,
            )
        )
        assert n is None

    def test_the_gate_also_applies_when_registering_a_student(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`POST /students` with `class_ids` enrols without ever touching the Classes
        endpoint. Gating only there would leave the rule enforceable from one door and
        not the other."""
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        required = _course(db_session, like="MATH1101")
        gated = _course(db_session)
        _require(db_session, course=gated, prerequisite=required)
        section, _cs = _offering(db_session, year.id, gated)
        assert current.is_active  # `_enroll_into_section` uses the ACTIVE semester

        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            "/api/v1/students",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "first_name": "Blocked",
                "last_name": "Registrant",
                "date_of_birth": "2007-05-05",
                "enrollment_date": "2026-01-19",
                "offering_ids": [str(section.id)],
            },
        )
        assert resp.status_code == 409, resp.text
        err = _assert_envelope(resp.json(), code="prerequisite_not_met")
        assert required.code in err["message"]


# ════════════════════════════════════════════════════════════════════════════
# ALL COURSES — the Internship gate
# ════════════════════════════════════════════════════════════════════════════
class TestAllProgramCoursesGate:
    def test_every_required_course_in_the_programme_must_be_passed(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """`EDUC3201 ← ALL COURSES`. The gate keeps meaning "everything in the
        programme" as the curriculum changes, which a fixed list of course ids could
        never do."""
        year, past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        program = _program(db_session)
        internship = _course(db_session, like="EDUC3201")
        a = _course(db_session, like="EDUC1102")
        b = _course(db_session, like="EDUC1104")
        for course in (internship, a, b):
            db_session.add(
                ProgramCourse(program_id=program.id, course_id=course.id,
                              term_label="Semester 1", term_order=1)
            )
        db_session.flush()
        _require(db_session, course=internship, program=program,
                 kind=PrerequisiteType.ALL_PROGRAM_COURSES)

        student = _student(db_session, program_id=program.id)
        section, _cs = _offering(db_session, year.id, internship)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        def enrol():  # noqa: ANN202
            return client.post(
                f"/api/v1/offerings/{section.id}/enrollments",
                headers=H,
                json={"student_ids": [str(student.id)], "semester_id": str(current.id)},
            )

        # Nothing passed → both named.
        resp = enrol()
        assert resp.status_code == 409, resp.text
        message = resp.json()["error"]["message"]
        assert a.code in message and b.code in message

        # Pass one → only the other is named.
        for course in (a,):
            prev_section, prev_cs = _offering(db_session, year.id, course)
            db_session.add(
                ClassEnrollment(offering_id=prev_section.id, student_id=student.id,
                                semester_id=past.id)
            )
            db_session.flush()
            _snapshot(db_session, student=student, cs=prev_cs, semester=past,
                      course=course, letter="A", numeric="95")
        resp = enrol()
        assert resp.status_code == 409, resp.text
        message = resp.json()["error"]["message"]
        assert b.code in message and a.code not in message

        # Pass the rest → through. The internship itself is excluded from its own gate.
        prev_section, prev_cs = _offering(db_session, year.id, b)
        db_session.add(
            ClassEnrollment(offering_id=prev_section.id, student_id=student.id, semester_id=past.id)
        )
        db_session.flush()
        _snapshot(db_session, student=student, cs=prev_cs, semester=past,
                  course=b, letter="A", numeric="92")
        assert enrol().status_code == 200

    def test_electives_do_not_gate_the_internship(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        """"ALL COURSES" means everything the programme REQUIRES. An elective the
        student legitimately did not choose is not a missing requirement."""
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        program = _program(db_session)
        internship = _course(db_session, like="EDUC3201")
        elective = _course(db_session, like="SPAN2112")
        db_session.add_all(
            [
                ProgramCourse(program_id=program.id, course_id=internship.id,
                              term_label="Semester 5", term_order=8),
                ProgramCourse(program_id=program.id, course_id=elective.id,
                              term_label="Semester 1", term_order=1, is_required=False),
            ]
        )
        db_session.flush()
        _require(db_session, course=internship, program=program,
                 kind=PrerequisiteType.ALL_PROGRAM_COURSES)

        student = _student(db_session, program_id=program.id)
        section, _cs = _offering(db_session, year.id, internship)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"/api/v1/offerings/{section.id}/enrollments",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"student_ids": [str(student.id)], "semester_id": str(current.id)},
        )
        assert resp.status_code == 200, resp.text

    def test_a_student_on_another_programme_is_unaffected(
        self, client, make_user, auth_headers, db_session, archive_seeded_active_year
    ) -> None:
        year, _past, current, _scale = _year_with_terms(db_session, archive_seeded_active_year)
        program = _program(db_session)
        internship = _course(db_session, like="EDUC3201")
        required = _course(db_session)
        db_session.add_all(
            [
                ProgramCourse(program_id=program.id, course_id=internship.id,
                              term_label="Semester 5", term_order=8),
                ProgramCourse(program_id=program.id, course_id=required.id,
                              term_label="Semester 1", term_order=1),
            ]
        )
        db_session.flush()
        _require(db_session, course=internship, program=program,
                 kind=PrerequisiteType.ALL_PROGRAM_COURSES)

        outsider = _student(db_session, program_id=_program(db_session).id)
        section, _cs = _offering(db_session, year.id, internship)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            f"/api/v1/offerings/{section.id}/enrollments",
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"student_ids": [str(outsider.id)], "semester_id": str(current.id)},
        )
        assert resp.status_code == 200, resp.text


# ════════════════════════════════════════════════════════════════════════════
# The pure grade-point helpers (D30 §D5)
# ════════════════════════════════════════════════════════════════════════════
class TestGradePointHelpers:
    """`calc.grade_point_for` / `calc.meets_grade_point` — no DB, no session."""

    def _bands(self, *, with_points: bool):  # noqa: ANN202
        from app.modules.grades import calc

        return [
            calc.BandInput(letter="A", min_score=Decimal("90"), is_passing=True,
                           grade_point=Decimal("4.00") if with_points else None),
            calc.BandInput(letter="C", min_score=Decimal("70"), is_passing=True,
                           grade_point=Decimal("2.00") if with_points else None),
            calc.BandInput(letter="F", min_score=Decimal("0"), is_passing=False,
                           grade_point=Decimal("0.00") if with_points else None),
        ]

    def test_grade_point_lookup(self) -> None:
        from app.modules.grades import calc

        bands = self._bands(with_points=True)
        assert calc.grade_point_for("A", bands) == Decimal("4.00")
        assert calc.grade_point_for("F", bands) == Decimal("0.00")
        assert calc.grade_point_for("B+", bands) is None
        assert calc.grade_point_for(None, bands) is None

    def test_lookup_is_case_and_space_insensitive(self) -> None:
        """Letters are free text on the band; "A " typed with a trailing space would
        otherwise silently score zero quality points."""
        from app.modules.grades import calc

        bands = self._bands(with_points=True)
        assert calc.grade_point_for(" a ", bands) == Decimal("4.00")

    def test_unseeded_grade_points_fall_back_to_is_passing(self) -> None:
        """Every scale in the database has NULL grade points until Phase 3 seeds the
        BAJC scale. Treating unknown as a failure would block every
        prerequisite-gated enrolment in the school on data nobody has entered yet."""
        from app.modules.grades import calc

        bands = self._bands(with_points=False)
        assert calc.meets_grade_point("A", bands, Decimal("2.50")) is True
        assert calc.meets_grade_point("C", bands, Decimal("2.50")) is True  # lenient arm
        assert calc.meets_grade_point("F", bands, Decimal("2.50")) is False

    def test_seeded_grade_points_apply_the_programme_bar(self) -> None:
        from app.modules.grades import calc

        bands = self._bands(with_points=True)
        # C = 2.00: clears Primary Education's 2.00, misses everyone else's 2.50.
        assert calc.meets_grade_point("C", bands, Decimal("2.00")) is True
        assert calc.meets_grade_point("C", bands, Decimal("2.50")) is False
        assert calc.meets_grade_point("A", bands, Decimal("2.50")) is True

    def test_no_letter_is_never_a_pass(self) -> None:
        from app.modules.grades import calc

        assert calc.meets_grade_point(None, self._bands(with_points=True), Decimal("2.50")) is False

"""Programmes / studies and their curriculum — D30 Phase 2B (§D3, §D14).

Oracle: `docs/tertiary-refactor-plan.md` §D3 (two term concepts), §D14 (Dean-only
academic authority), and `005_tertiary.sql` §3–§4.

WHAT THIS MODULE EXISTS TO FIX. Before D30 `programs` and `courses` had **no
relationship at all**, so the entire structure of BAJC's course-sequence PDF — eight
programmes, each a list of courses grouped into term blocks, each block carrying
credits — had nowhere to live. `program_courses` is that structure.

TWO THINGS THE TESTS BELOW GUARD PARTICULARLY:

  1. **`term_label` is a CURRICULUM POSITION, not a calendar term.** "Semester 1" in a
     programme's plan is not any dated row in `semesters`. The blocks are neither
     uniform across programmes nor limited to two — Primary Education runs
     Summer 1 · Sem 1 · Sem 2 · Spring 1 · Sem 3 · Sem 4 · Spring 2 · Semester 5 —
     which is why `term_label` is free text ordered by `term_order` rather than an
     enum.

  2. **Writes are DEAN-ONLY.** Brief §6 reserves academic structure to the Dean; the
     Registrar keeps students, enrolment and offerings. Every write path is checked
     against Registrar, Lecturer and student here, because the catalog's own Dean-only
     gate was originally missed on one of its four endpoints.

Hermetic + rolled-back via the `db_session` transactional rollback.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.common.enums import Role
from app.modules.offerings.models import Course
from app.modules.programs.models import Program, ProgramCourse
from app.modules.settings.models import AuditLog
from app.modules.users.models import User  # noqa: F401 — FK target for the flushes below

pytestmark = pytest.mark.requires_db

PROGRAMS = "/api/v1/programs"


def _program_path(program_id) -> str:  # noqa: ANN001
    return f"{PROGRAMS}/{program_id}"


def _courses_path(program_id) -> str:  # noqa: ANN001
    return f"{PROGRAMS}/{program_id}/courses"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


def _make_course(db_session, *, code=None, name=None, credits=3, is_active=True) -> Course:
    """A catalog course, direct in the rolled-back session."""
    tag = uuid.uuid4().hex[:8].upper()
    c = Course(
        code=code or f"C{tag}",
        name=name or f"Course {tag}",
        credits=credits,
        is_active=is_active,
    )
    db_session.add(c)
    db_session.flush()
    return c


def _make_program(db_session, *, code=None, name=None, **over) -> Program:
    tag = uuid.uuid4().hex[:6].upper()
    p = Program(
        code=code or f"P{tag}"[:10],
        name=name or f"Program {tag}",
        award="Associate of Science",
        total_credits=90,
        **over,
    )
    db_session.add(p)
    db_session.flush()
    return p


# ════════════════════════════════════════════════════════════════════════════
# GET /programs
# ════════════════════════════════════════════════════════════════════════════
class TestListPrograms:
    def test_any_authenticated_role_can_read(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Reading is open: a programme's code, name and sequence are the college's
        own published prospectus material, and Phase 4's student academic-history
        screens read it."""
        _make_program(db_session)
        for role in (Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.STUDENT):
            user = make_user(role=role)
            resp = client.get(PROGRAMS, headers=auth_headers(user_id=user.id, role=role))
            assert resp.status_code == 200, f"{role}: {resp.text}"

    def test_page_shape(self, client, make_user, auth_headers, db_session) -> None:
        _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            PROGRAMS, headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"items", "total", "page", "page_size", "total_pages"} <= set(body.keys())
        item = body["items"][0]
        assert {
            "id", "code", "name", "award", "total_credits",
            "min_passing_grade_point", "is_active",
            "course_count", "curriculum_credits",
        } == set(item.keys())

    def test_requires_auth(self, client) -> None:
        assert client.get(PROGRAMS).status_code == 401

    def test_default_hides_retired(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Same rule as the course catalog: the common caller is a picker, and a
        retired programme in it is a way to enrol a student onto a study the college
        no longer runs."""
        live = _make_program(db_session)
        retired = _make_program(db_session, is_active=False)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        ids = {i["id"] for i in client.get(PROGRAMS, headers=H, params={"page_size": 100}).json()["items"]}
        assert str(live.id) in ids
        assert str(retired.id) not in ids

        ids = {
            i["id"]
            for i in client.get(
                PROGRAMS, headers=H, params={"is_active": "false", "page_size": 100}
            ).json()["items"]
        }
        assert str(retired.id) in ids

    def test_search_matches_code_name_and_award(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        tag = uuid.uuid4().hex[:6].upper()
        _make_program(db_session, code=f"BM{tag}"[:10], name=f"Business Mgmt {tag}")
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        for term in (tag, "Business", "Associate of Science"):
            resp = client.get(PROGRAMS, headers=H, params={"search": term, "page_size": 100})
            assert resp.status_code == 200, resp.text
            assert resp.json()["total"] >= 1, term

    def test_unknown_sort_field_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            params={"sort": "not_a_column"},
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="invalid_sort_field")


# ════════════════════════════════════════════════════════════════════════════
# POST /programs — Dean only
# ════════════════════════════════════════════════════════════════════════════
class TestCreateProgram:
    def _payload(self, **over) -> dict:
        tag = uuid.uuid4().hex[:6].upper()
        body = {
            "code": f"BM{tag}"[:10],
            "name": f"Business Management {tag}",
            "award": "Associate of Social Science",
            "total_credits": 87,
        }
        body.update(over)
        return body

    def test_dean_creates_201_and_audits(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["is_active"] is True
        assert body["curriculum"] == []
        assert body["course_count"] == 0
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "program.create",
                AuditLog.entity_id == uuid.UUID(body["id"]),
            )
        )
        assert n_audit == 1

    def test_pass_mark_defaults_to_c_plus(
        self, client, make_user, auth_headers
    ) -> None:
        """2.50 (C+) is right for seven of the eight BAJC programmes."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(),
        )
        assert resp.status_code == 201, resp.text
        assert float(resp.json()["min_passing_grade_point"]) == 2.50

    def test_the_pass_mark_is_per_programme(
        self, client, make_user, auth_headers
    ) -> None:
        """The brief's most easily-missed rule (§D5). Primary Education passes at C
        (2.00) while everything else passes at C+ (2.50), and that cannot live on
        `grading_scales.pass_mark`, which is one number per ACADEMIC YEAR — a
        year-level number cannot say two different things about two programmes running
        inside it at once."""
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        primary_ed = client.post(
            PROGRAMS, headers=H, json=self._payload(min_passing_grade_point="2.00")
        )
        other = client.post(PROGRAMS, headers=H, json=self._payload())
        assert primary_ed.status_code == 201, primary_ed.text
        assert other.status_code == 201, other.text
        assert float(primary_ed.json()["min_passing_grade_point"]) == 2.00
        assert float(other.json()["min_passing_grade_point"]) == 2.50

    def test_pass_mark_above_the_scale_422(self, client, make_user, auth_headers) -> None:
        """`ck_programs_pass_gp` is 0–4; the schema says 422, not a driver error."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(min_passing_grade_point="4.50"),
        )
        assert resp.status_code == 422, resp.text

    def test_duplicate_code_409(self, client, make_user, auth_headers, db_session) -> None:
        existing = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(code=existing.code),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_program_code")

    def test_duplicate_name_case_insensitive_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        existing = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._payload(name=existing.name.upper()),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_program_name")

    def test_missing_code_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        payload = self._payload()
        del payload["code"]
        resp = client.post(
            PROGRAMS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=payload,
        )
        assert resp.status_code == 422, resp.text

    def test_create_is_dean_only(self, client, make_user, auth_headers) -> None:
        """§D14, brief §6 — the Registrar and Lecturer cannot define studies."""
        for role in (Role.SECRETARY, Role.TEACHER, Role.STUDENT):
            user = make_user(role=role)
            resp = client.post(
                PROGRAMS,
                headers=auth_headers(user_id=user.id, role=role),
                json=self._payload(),
            )
            assert resp.status_code == 403, f"{role}: {resp.text}"
            _assert_envelope(resp.json(), code="forbidden")


# ════════════════════════════════════════════════════════════════════════════
# PATCH / DELETE /programs/{id} — Dean only
# ════════════════════════════════════════════════════════════════════════════
class TestUpdateAndDeleteProgram:
    def test_dean_updates(self, client, make_user, auth_headers, db_session) -> None:
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _program_path(program.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"award": "Associate of Arts", "total_credits": 102},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["award"] == "Associate of Arts"
        assert resp.json()["total_credits"] == 102

    def test_retire_via_is_active_false(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _program_path(program.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"is_active": False},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is False

    def test_patch_to_a_taken_code_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        a = _make_program(db_session)
        b = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _program_path(b.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"code": a.code},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_program_code")

    def test_patch_to_its_own_code_is_fine(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _program_path(program.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"code": program.code.lower()},
        )
        assert resp.status_code == 200, resp.text

    def test_patch_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _program_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"award": "Ghost"},
        )
        assert resp.status_code == 404, resp.text

    def test_delete_unused_204(self, client, make_user, auth_headers, db_session) -> None:
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _program_path(program.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 204, resp.text

    def test_delete_with_students_on_it_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`student_profiles.program_id` is `ON DELETE SET NULL`, so a hard delete
        would silently orphan those students rather than fail. The guard turns that
        into a 409 that steers the Dean to retire the programme instead — which stops
        new enrolments while leaving every existing student's record intact."""
        from datetime import date

        from tests.conftest import split_name
        from app.modules.students.models import StudentProfile

        program = _make_program(db_session)
        db_session.add(
            StudentProfile(
                student_number=f"P{uuid.uuid4().hex[:9]}",
                **split_name("Enrolled Student"),
                date_of_birth=date(2007, 1, 1),
                enrollment_date=date(2025, 9, 1),
                status="active",
                program_id=program.id,
            )
        )
        db_session.flush()

        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _program_path(program.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="program_in_use")

    def test_a_curriculum_does_not_block_deletion(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`program_courses` cascades from the programme and means nothing without it
        — unlike a student, it is not evidence that anyone relied on the programme."""
        program = _make_program(db_session)
        course = _make_course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        client.post(
            _courses_path(program.id),
            headers=H,
            json={"course_id": str(course.id), "term_label": "Semester 1", "term_order": 1},
        )
        assert client.delete(_program_path(program.id), headers=H).status_code == 204

    def test_update_and_delete_are_dean_only(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        for role in (Role.SECRETARY, Role.TEACHER, Role.STUDENT):
            user = make_user(role=role)
            H = auth_headers(user_id=user.id, role=role)
            assert client.patch(
                _program_path(program.id), headers=H, json={"award": "X"}
            ).status_code == 403, role
            assert client.delete(
                _program_path(program.id), headers=H
            ).status_code == 403, role


# ════════════════════════════════════════════════════════════════════════════
# The curriculum — programme → term block → course
# ════════════════════════════════════════════════════════════════════════════
class TestCurriculum:
    def _add(self, client, H, program_id, course, **over):  # noqa: ANN001
        body = {
            "course_id": str(course.id),
            "term_label": "Semester 1",
            "term_order": 1,
        }
        body.update(over)
        return client.post(_courses_path(program_id), headers=H, json=body)

    def test_dean_places_a_course_in_a_block(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        course = _make_course(db_session, credits=4)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        resp = self._add(client, H, program.id, course)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert len(body["curriculum"]) == 1
        block = body["curriculum"][0]
        assert block["term_label"] == "Semester 1"
        assert block["credits"] == 4
        assert block["courses"][0]["course"]["code"] == course.code
        assert block["courses"][0]["is_required"] is True

    def test_credits_roll_up_per_block_and_per_programme(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The number that was impossible before D30. `courses.credits` is only
        reachable at all because `006` moved the catalog there — on `subjects` there
        was no credits column to add up (plan §B3)."""
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        self._add(client, H, program.id, _make_course(db_session, credits=3),
                  term_label="Summer 1", term_order=1)
        self._add(client, H, program.id, _make_course(db_session, credits=1),
                  term_label="Summer 1", term_order=1)
        resp = self._add(client, H, program.id, _make_course(db_session, credits=9),
                         term_label="Semester 4", term_order=2)

        assert resp.status_code == 201, resp.text
        body = resp.json()
        by_label = {b["term_label"]: b for b in body["curriculum"]}
        assert by_label["Summer 1"]["credits"] == 4
        assert by_label["Semester 4"]["credits"] == 9
        assert body["curriculum_credits"] == 13
        assert body["course_count"] == 3

    def test_blocks_come_back_in_term_order_not_alphabetically(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The whole reason `term_order` exists (§D3).

        Primary Education runs Summer 1 · Sem 1 · Sem 2 · **Spring 1** · Sem 3, and
        "Spring 1" sorts before "Summer 1" alphabetically — so the label can never be
        the ordering key. It is free text precisely so a new block does not need a
        migration.
        """
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        plan = [
            ("Summer 1", 1), ("Semester 1", 2), ("Semester 2", 3),
            ("Spring 1", 4), ("Semester 3", 5),
        ]
        for label, order in plan:
            self._add(
                client, H, program.id, _make_course(db_session),
                term_label=label, term_order=order,
            )

        resp = client.get(_program_path(program.id), headers=H)
        assert resp.status_code == 200, resp.text
        labels = [b["term_label"] for b in resp.json()["curriculum"]]
        assert labels == [label for label, _ in plan]
        assert labels != sorted(labels)  # alphabetical order, explicitly not this

    def test_the_same_course_cannot_be_added_twice(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`uq_program_courses (program_id, course_id)`. A repeated course is a RETAKE
        — enrolment history, not curriculum (plan §G item 5)."""
        program = _make_program(db_session)
        course = _make_course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)

        assert self._add(client, H, program.id, course).status_code == 201
        resp = self._add(client, H, program.id, course, term_label="Semester 2", term_order=2)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="course_already_in_program")

    def test_the_same_course_can_sit_in_two_different_programmes(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A GEC course appears across most of the eight sequences — the uniqueness is
        per programme, not global."""
        a, b = _make_program(db_session), _make_program(db_session)
        course = _make_course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        assert self._add(client, H, a.id, course).status_code == 201
        assert self._add(client, H, b.id, course).status_code == 201

    def test_a_retired_course_cannot_be_added_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        course = _make_course(db_session, is_active=False)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        resp = self._add(client, H, program.id, course)
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="course_retired")

    def test_unknown_course_404(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _courses_path(program.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"course_id": str(uuid.uuid4()), "term_label": "Semester 1", "term_order": 1},
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="course_not_found")

    def test_term_order_must_be_positive_422(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`ck_program_courses_term_order` is `> 0`."""
        program = _make_program(db_session)
        course = _make_course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        resp = self._add(client, H, program.id, course, term_order=0)
        assert resp.status_code == 422, resp.text

    def test_a_course_can_be_moved_between_blocks(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        course = _make_course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        created = self._add(client, H, program.id, course).json()
        pc_id = created["curriculum"][0]["courses"][0]["id"]

        resp = client.patch(
            f"{_courses_path(program.id)}/{pc_id}",
            headers=H,
            json={"term_label": "Spring 2", "term_order": 7, "is_required": False},
        )
        assert resp.status_code == 200, resp.text
        block = resp.json()["curriculum"][0]
        assert block["term_label"] == "Spring 2"
        assert block["term_order"] == 7
        assert block["courses"][0]["is_required"] is False

    def test_removing_a_course_recomputes_the_totals(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """DELETE returns the whole programme rather than 204 — the caller is a
        curriculum builder that needs the recomputed credit totals."""
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        first = self._add(client, H, program.id, _make_course(db_session, credits=3)).json()
        self._add(client, H, program.id, _make_course(db_session, credits=4),
                  term_label="Semester 2", term_order=2)
        pc_id = first["curriculum"][0]["courses"][0]["id"]

        resp = client.delete(f"{_courses_path(program.id)}/{pc_id}", headers=H)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["course_count"] == 1
        assert body["curriculum_credits"] == 4

    def test_a_curriculum_row_cannot_be_reached_through_another_programme(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Looking the row up by id alone would let `/programs/{A}/courses/{row-of-B}`
        edit B's curriculum through A's URL. It is scoped to the path's programme, and
        a mismatch is a 404 — not a 403, per the module's no-existence-leak rule."""
        a, b = _make_program(db_session), _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        in_b = self._add(client, H, b.id, _make_course(db_session)).json()
        pc_id = in_b["curriculum"][0]["courses"][0]["id"]

        assert client.patch(
            f"{_courses_path(a.id)}/{pc_id}", headers=H, json={"term_order": 9}
        ).status_code == 404
        assert client.delete(
            f"{_courses_path(a.id)}/{pc_id}", headers=H
        ).status_code == 404

    def test_curriculum_writes_are_dean_only(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        program = _make_program(db_session)
        course = _make_course(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        created = self._add(
            client, auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            program.id, course,
        ).json()
        pc_id = created["curriculum"][0]["courses"][0]["id"]

        for role in (Role.SECRETARY, Role.TEACHER, Role.STUDENT):
            user = make_user(role=role)
            H = auth_headers(user_id=user.id, role=role)
            assert self._add(
                client, H, program.id, _make_course(db_session)
            ).status_code == 403, role
            assert client.patch(
                f"{_courses_path(program.id)}/{pc_id}", headers=H, json={"term_order": 2}
            ).status_code == 403, role
            assert client.delete(
                f"{_courses_path(program.id)}/{pc_id}", headers=H
            ).status_code == 403, role

    def test_the_curriculum_survives_as_rows(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Belt and braces: what the API reports is what is actually stored."""
        program = _make_program(db_session)
        principal = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        for i in range(3):
            self._add(
                client, H, program.id, _make_course(db_session),
                term_label=f"Semester {i + 1}", term_order=i + 1,
            )
        n = db_session.scalar(
            select(func.count()).select_from(ProgramCourse).where(
                ProgramCourse.program_id == program.id
            )
        )
        assert n == 3


# ════════════════════════════════════════════════════════════════════════════
# GET /programs/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestGetProgram:
    def test_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            _program_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")

    def test_a_student_can_read_a_programme_plan(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Phase 4's academic-history screens read this, and it is prospectus
        material — there is nothing here to withhold."""
        program = _make_program(db_session)
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            _program_path(program.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 200, resp.text

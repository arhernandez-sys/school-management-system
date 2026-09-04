"""D43 — what a Head of Department sees, and what they still may not touch.

The client's sentence: *"they are lecturers that have this role and they can see all the
teachers under their program, all courses and all students. they cant edit grades but
they have that extra view where they can see all."*

Read carefully that is TWO scopes on one person, and every test here exists to keep them
apart:

  * the **lecturer** scope they already had — their own offerings, where they may write;
  * the **programme** scope the role adds — everything in the programme they head, read
    only.

So the interesting assertions are never "can an HOD see X". They are the seams:

  * a head sees a colleague's offering but gets `can_edit=false` on it;
  * a head sees their OWN offering with `can_edit=true`, because being promoted must not
    take away the gradebook they had yesterday;
  * a head sees NOTHING of the programme next door;
  * a head who teaches a shared course outside their programme still reaches those
    students, because their teaching is not confined to their department.

**Two programmes is the whole experiment.** A single-programme fixture would pass every
assertion here with the scope filter deleted, since one programme is indistinguishable
from "everything". `_TwoDepartments` therefore builds a second, fully-populated
programme that no test's HOD heads, and the leak tests all point at it.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.offerings.models import (
    ClassEnrollment,
    ClassTeacher,
    Course,
    CourseOffering,
)
from app.modules.programs.models import Program, ProgramCourse, ProgramHead
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"
TEACHERS = "/api/v1/teachers"
OFFERINGS = "/api/v1/offerings"


def _assert_envelope(body: dict, *, code: str) -> None:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]


class _Department:
    """One programme, with its own course, offering, lecturer and student."""

    def __init__(self, db, make_user, *, tag: str, sem_id, label: str):
        self.program = Program(
            code=f"{label}{tag[:4]}".upper()[:10],
            name=f"{label} Programme {tag}",
            award="Associate of Science",
        )
        db.add(self.program)
        db.flush()

        self.course = Course(name=f"{label} Course {tag}", code=f"{label[:2]}{tag[:6]}".upper())
        db.add(self.course)
        db.flush()
        db.add(
            ProgramCourse(
                program_id=self.program.id,
                course_id=self.course.id,
                term_label="Semester 1",
                term_order=1,
            )
        )

        self.offering = CourseOffering(
            course_id=self.course.id,
            semester_id=sem_id,
            section_code=uuid.uuid4().hex[:6],
        )
        db.add(self.offering)
        db.flush()

        # A rank-and-file lecturer of this programme — NOT the head.
        self.lecturer_user = make_user(role=Role.TEACHER, full_name=f"{label} Lecturer")
        self.lecturer = TeacherProfile(
            user_id=self.lecturer_user.id,
            staff_number=f"{label[:1]}L-{tag}",
            full_name=f"{label} Lecturer",
            status=TeacherStatus.ACTIVE,
        )
        db.add(self.lecturer)
        db.flush()
        db.add(
            ClassTeacher(
                offering_id=self.offering.id, teacher_id=self.lecturer.id, is_lead=True
            )
        )

        self.student = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            **split_name(f"{label} Student"),
            date_of_birth=date(2005, 1, 1),
            enrollment_date=date(2025, 9, 1),
            status="Registered",
            program_id=self.program.id,
        )
        db.add(self.student)
        db.flush()
        db.add(
            ClassEnrollment(
                offering_id=self.offering.id,
                student_id=self.student.id,
                semester_id=sem_id,
            )
        )
        db.flush()


class _TwoDepartments:
    """Two fully-populated programmes, and one HOD who heads exactly the first.

    The head also TEACHES an offering of their own, so the suite can tell "sees it
    because they run the department" apart from "sees it because they teach it" —
    which is the distinction `can_edit` turns on.
    """

    def __init__(self, db, make_user, auth_headers, archive_seeded_active_year):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db

        self.year = AcademicYear(
            name=f"HodYear {tag}",
            start_date=date(2025, 9, 1),
            end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db.add(self.year)
        db.flush()
        self.sem = Semester(
            academic_year_id=self.year.id,
            name="Semester 1",
            sequence=1,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 1, 31),
            is_active=True,
        )
        db.add(self.sem)
        db.flush()

        self.mine = _Department(db, make_user, tag=tag, sem_id=self.sem.id, label="Mine")
        self.theirs = _Department(
            db, make_user, tag=tag, sem_id=self.sem.id, label="Theirs"
        )

        # ── the head ──────────────────────────────────────────────────────────
        self.hod_user = make_user(role=Role.HOD, full_name="Head Of Mine")
        self.hod = TeacherProfile(
            user_id=self.hod_user.id,
            staff_number=f"H-{tag}",
            full_name="Head Of Mine",
            status=TeacherStatus.ACTIVE,
        )
        db.add(self.hod)
        db.flush()
        db.add(ProgramHead(program_id=self.mine.program.id, teacher_id=self.hod.id))

        # …who also teaches a course of their own programme.
        self.hod_course = Course(name=f"Head Course {tag}", code=f"HC{tag[:6]}".upper())
        db.add(self.hod_course)
        db.flush()
        db.add(
            ProgramCourse(
                program_id=self.mine.program.id,
                course_id=self.hod_course.id,
                term_label="Semester 1",
                term_order=2,
            )
        )
        self.hod_offering = CourseOffering(
            course_id=self.hod_course.id,
            semester_id=self.sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db.add(self.hod_offering)
        db.flush()
        db.add(
            ClassTeacher(
                offering_id=self.hod_offering.id, teacher_id=self.hod.id, is_lead=True
            )
        )
        db.flush()

        self.principal_user = make_user(role=Role.PRINCIPAL)
        self.HOD = auth_headers(user_id=self.hod_user.id, role=Role.HOD)
        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self._make_user = make_user
        self._auth_headers = auth_headers


@pytest.fixture
def dept(db_session, make_user, auth_headers, archive_seeded_active_year):
    return _TwoDepartments(db_session, make_user, auth_headers, archive_seeded_active_year)


def _ids(body) -> set[str]:
    return {row["id"] for row in body["items"]}


class TestHodSeesTheirOwnProgramme:
    def test_students_are_scoped_to_the_programme(self, client, dept) -> None:
        resp = client.get(f"{STUDENTS}?page_size=200", headers=dept.HOD)
        assert resp.status_code == 200, resp.text
        ids = _ids(resp.json())
        assert str(dept.mine.student.id) in ids, "head cannot see their own student"
        assert str(dept.theirs.student.id) not in ids, "LEAK: another programme's student"

    def test_lecturers_are_scoped_to_the_programme(self, client, dept) -> None:
        """"All the teachers under their program" — derived from who teaches its courses."""
        resp = client.get(f"{TEACHERS}?page_size=200", headers=dept.HOD)
        assert resp.status_code == 200, resp.text
        ids = _ids(resp.json())
        assert str(dept.mine.lecturer.id) in ids, "head cannot see their own lecturer"
        assert str(dept.theirs.lecturer.id) not in ids, "LEAK: another programme's lecturer"

    def test_offerings_are_scoped_to_the_programme(self, client, dept) -> None:
        resp = client.get(f"{OFFERINGS}?page_size=200", headers=dept.HOD)
        assert resp.status_code == 200, resp.text
        ids = _ids(resp.json())
        assert str(dept.mine.offering.id) in ids, "head cannot see a colleague's offering"
        assert str(dept.hod_offering.id) in ids, "head cannot see their OWN offering"
        assert str(dept.theirs.offering.id) not in ids, "LEAK: another programme's offering"

    def test_a_colleagues_student_detail_is_reachable(self, client, dept) -> None:
        """Reachability, not just the list: the head opens the profile too."""
        resp = client.get(f"{STUDENTS}/{dept.mine.student.id}", headers=dept.HOD)
        assert resp.status_code == 200, resp.text


class TestHodSeesNothingNextDoor:
    """The tests that would pass with the scope filter deleted if there were only one
    programme. They are the reason the fixture builds two."""

    def test_another_programmes_student_is_404_not_403(self, client, dept) -> None:
        """404, never 403 — a 403 confirms the student exists (§3.3)."""
        resp = client.get(f"{STUDENTS}/{dept.theirs.student.id}", headers=dept.HOD)
        assert resp.status_code == 404, resp.text
        _assert_envelope(resp.json(), code="not_found")

    def test_another_programmes_offering_is_404(self, client, dept) -> None:
        resp = client.get(f"{OFFERINGS}/{dept.theirs.offering.id}", headers=dept.HOD)
        assert resp.status_code == 404, resp.text


class TestHodCanEditOnlyTheirOwnTeaching:
    """The client's "they cant edit grades", stated precisely."""

    def test_own_offering_is_actionable(self, client, dept) -> None:
        resp = client.get(f"{OFFERINGS}?page_size=200", headers=dept.HOD)
        rows = {r["id"]: r for r in resp.json()["items"]}
        assert rows[str(dept.hod_offering.id)]["actionable_by_caller"] is True, (
            "promotion to HOD took away the gradebook they had as a lecturer"
        )

    def test_a_colleagues_offering_is_visible_but_not_actionable(
        self, client, dept
    ) -> None:
        resp = client.get(f"{OFFERINGS}?page_size=200", headers=dept.HOD)
        rows = {r["id"]: r for r in resp.json()["items"]}
        row = rows[str(dept.mine.offering.id)]
        assert row["actionable_by_caller"] is False, (
            "head may act on a colleague's offering — 'they cant edit grades' is broken"
        )

    def test_gradebook_picker_marks_only_their_own_editable(self, client, dept) -> None:
        """`can_edit` per row is what the UI hangs the edit affordance on."""
        resp = client.get(
            f"/api/v1/grades/offerings?academic_year_id={dept.year.id}",
            headers=dept.HOD,
        )
        assert resp.status_code == 200, resp.text
        # The picker nests the ref: `{offering: {id, ...}, can_edit, ...}`.
        rows = {r["offering"]["id"]: r for r in resp.json()["items"]}
        assert rows[str(dept.hod_offering.id)]["can_edit"] is True, (
            "head cannot grade their own class"
        )
        assert rows[str(dept.mine.offering.id)]["can_edit"] is False, (
            "head is offered an edit affordance on a colleague's gradebook"
        )
        assert str(dept.theirs.offering.id) not in rows, "LEAK: other programme in picker"

    def test_grade_write_on_a_colleagues_offering_is_refused(
        self, client, dept, db_session
    ) -> None:
        """The end-to-end version: ownership, not the role tuple, is the wall.

        An HOD IS in `require_role(TEACHER, HOD)` on this route — it has to be, or they
        could not grade their own class — so this 404 comes from
        `assert_teacher_owns_offering` and nowhere else. That is the check the whole
        "keeps teaching, cannot edit others' grades" design rests on.
        """
        from decimal import Decimal

        from app.modules.assessments.models import Assessment

        a = Assessment(
            offering_id=dept.mine.offering.id,   # the COLLEAGUE's offering
            semester_id=dept.sem.id,
            title="Colleague quiz",
            type="quiz",
            max_score=Decimal("20"),
            weight=Decimal("1.00"),
            status="graded",
        )
        db_session.add(a)
        db_session.flush()

        resp = client.put(
            f"/api/v1/assessments/{a.id}/grades",
            json={
                "entries": [
                    {
                        "student_id": str(dept.mine.student.id),
                        "status": "graded",
                        "score": 19,
                    }
                ]
            },
            headers=dept.HOD,
        )
        # A VALID payload matters here: a 422 would also be "not a 200" and would let
        # this test pass while proving nothing about authorization. The body must be
        # good enough to reach the ownership check, and the refusal must come from there.
        assert resp.status_code == 404, (
            f"head wrote a grade on a colleague's assessment: {resp.status_code} {resp.text}"
        )


class TestUnconfiguredHodSeesNothingExtra:
    def test_a_head_with_no_appointment_does_not_become_a_dean(
        self, client, dept, make_user, auth_headers
    ) -> None:
        """The failure mode that would matter most, asserted directly.

        Every scope helper returns `[]` for a head with no `program_heads` row, and `[]`
        must narrow to the empty set. If any of them were written so that "no programmes"
        meant "do not filter", this user would see the whole college.
        """
        orphan = make_user(role=Role.HOD, full_name="Unappointed Head")
        headers = auth_headers(user_id=orphan.id, role=Role.HOD)

        resp = client.get(f"{STUDENTS}?page_size=200", headers=headers)
        assert resp.status_code == 200, resp.text
        ids = _ids(resp.json())
        assert str(dept.mine.student.id) not in ids
        assert str(dept.theirs.student.id) not in ids, (
            "an HOD with no appointment is seeing the whole college"
        )

        resp = client.get(f"{OFFERINGS}?page_size=200", headers=headers)
        assert resp.status_code == 200, resp.text
        assert _ids(resp.json()) == set(), "unappointed head sees offerings"


class TestTeachingOutsideTheDepartment:
    def test_a_head_still_reaches_students_they_teach_elsewhere(
        self, client, dept, db_session
    ) -> None:
        """A shared course is the realistic case, and the one a naive rule breaks.

        If reachability were "is this student in my programme" ALONE, promoting a
        lecturer would have removed their access to students they teach every week in
        another programme's course. Being made a head must not cost you your own class.
        """
        db_session.add(
            ClassTeacher(
                offering_id=dept.theirs.offering.id, teacher_id=dept.hod.id
            )
        )
        db_session.flush()

        resp = client.get(f"{STUDENTS}/{dept.theirs.student.id}", headers=dept.HOD)
        assert resp.status_code == 200, (
            "head lost access to a student they personally teach: " + resp.text
        )


class TestOtherRolesAreUnchanged:
    def test_the_dean_still_sees_both_programmes(self, client, dept) -> None:
        """The regression guard: none of the scoping above may narrow anybody else."""
        resp = client.get(f"{STUDENTS}?page_size=200", headers=dept.P)
        assert resp.status_code == 200, resp.text
        ids = _ids(resp.json())
        assert {str(dept.mine.student.id), str(dept.theirs.student.id)} <= ids

    def test_a_plain_lecturer_is_still_offering_scoped(
        self, client, dept, auth_headers
    ) -> None:
        headers = auth_headers(
            user_id=dept.mine.lecturer_user.id, role=Role.TEACHER
        )
        resp = client.get(f"{OFFERINGS}?page_size=200", headers=headers)
        assert resp.status_code == 200, resp.text
        ids = _ids(resp.json())
        assert ids == {str(dept.mine.offering.id)}, (
            "D42 lecturer scoping changed: " + str(ids)
        )


class TestProgramHeadsEndpoint:
    """PUT/GET /programs/{id}/heads — how an appointment is actually made."""

    def test_dean_sets_and_reads_back_the_heads(self, client, dept) -> None:
        url = f"/api/v1/programs/{dept.theirs.program.id}/heads"
        assert client.get(url, headers=dept.P).json()["items"] == []

        resp = client.put(
            url, json={"teacher_ids": [str(dept.theirs.lecturer.id)]}, headers=dept.P
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert [i["teacher_id"] for i in items] == [str(dept.theirs.lecturer.id)]
        # Appointing PROMOTES: the response already reports the new role, so the screen
        # never shows a head who looks appointed but is still a lecturer.
        assert items[0]["role"] == "hod", (
            f"appointing a head did not promote them: {items[0]}"
        )

    def test_appointing_promotes_the_lecturer(self, client, dept, db_session) -> None:
        """The appointment and the access are one action (client ask, 2026-09-02)."""
        from app.modules.users.models import User

        client.put(
            f"/api/v1/programs/{dept.theirs.program.id}/heads",
            json={"teacher_ids": [str(dept.theirs.lecturer.id)]},
            headers=dept.P,
        )
        db_session.expire_all()
        promoted = db_session.get(User, dept.theirs.lecturer_user.id)
        assert promoted.role == Role.HOD, (
            f"appointing a head left their login role at {promoted.role}"
        )

    def test_removing_the_last_appointment_demotes_them(
        self, client, dept, db_session
    ) -> None:
        """The mirror. A head of nothing is a lecturer again."""
        from app.modules.users.models import User

        url = f"/api/v1/programs/{dept.mine.program.id}/heads"
        assert len(client.get(url, headers=dept.P).json()["items"]) == 1

        resp = client.put(url, json={"teacher_ids": []}, headers=dept.P)
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"] == []

        db_session.expire_all()
        demoted = db_session.get(User, dept.hod_user.id)
        assert demoted.role == Role.TEACHER, (
            f"un-appointing left the account at {demoted.role} with no programme to head"
        )

    def test_a_two_programme_head_removed_from_ONE_keeps_the_role(
        self, client, dept, db_session
    ) -> None:
        """The edge that makes automatic demotion safe — and the one that would hurt.

        Someone running two programmes who is taken off one is still a Head of
        Department. Demoting on any removal would revoke their access to the department
        they still run, and the only symptom would be a head reporting that their screens
        went empty.
        """
        from app.modules.users.models import User

        # Give them a second programme.
        second = f"/api/v1/programs/{dept.theirs.program.id}/heads"
        client.put(second, json={"teacher_ids": [str(dept.hod.id)]}, headers=dept.P)
        db_session.expire_all()
        assert db_session.get(User, dept.hod_user.id).role == Role.HOD

        # Take them off the FIRST one only.
        client.put(
            f"/api/v1/programs/{dept.mine.program.id}/heads",
            json={"teacher_ids": []},
            headers=dept.P,
        )
        db_session.expire_all()
        still = db_session.get(User, dept.hod_user.id)
        assert still.role == Role.HOD, (
            "a head who still runs another programme was demoted — they have just lost "
            "access to a department they are responsible for"
        )

    def test_appointing_a_dean_does_not_change_their_role(
        self, client, dept, db_session, make_user
    ) -> None:
        """Rule 1. Promotion is for lecturers; nobody is silently DEMOTED to one.

        A Dean who also runs a programme is a real arrangement at a small college, and
        this endpoint must not be a way to strip their administrator account.
        """
        from app.modules.teachers.models import TeacherProfile
        from app.modules.users.models import User
        from app.common.enums import TeacherStatus

        dean_user = make_user(role=Role.PRINCIPAL, full_name="Teaching Dean")
        profile = TeacherProfile(
            user_id=dean_user.id,
            staff_number=f"D-{dept.tag}",
            full_name="Teaching Dean",
            status=TeacherStatus.ACTIVE,
        )
        db_session.add(profile)
        db_session.flush()

        client.put(
            f"/api/v1/programs/{dept.theirs.program.id}/heads",
            json={"teacher_ids": [str(profile.id)]},
            headers=dept.P,
        )
        db_session.expire_all()
        assert db_session.get(User, dean_user.id).role == Role.PRINCIPAL, (
            "appointing a Dean as head demoted their account"
        )

    def test_a_lecturer_with_no_login_can_still_be_appointed(
        self, client, dept, db_session
    ) -> None:
        """A profile may exist before its account does; the appointment still records."""
        from app.common.enums import TeacherStatus
        from app.modules.teachers.models import TeacherProfile

        orphan = TeacherProfile(
            staff_number=f"N-{dept.tag}",
            full_name="No Login Yet",
            status=TeacherStatus.ACTIVE,
        )
        db_session.add(orphan)
        db_session.flush()

        resp = client.put(
            f"/api/v1/programs/{dept.theirs.program.id}/heads",
            json={"teacher_ids": [str(orphan.id)]},
            headers=dept.P,
        )
        assert resp.status_code == 200, resp.text
        item = resp.json()["items"][0]
        assert item["teacher_id"] == str(orphan.id)
        assert item["role"] is None, "a profile with no login reported a role"

    def test_the_promotion_is_audited(self, client, dept, db_session) -> None:
        """An automatic role change must leave the same trail a manual one does."""
        from app.modules.settings.models import AuditLog

        client.put(
            f"/api/v1/programs/{dept.theirs.program.id}/heads",
            json={"teacher_ids": [str(dept.theirs.lecturer.id)]},
            headers=dept.P,
        )
        rows = (
            db_session.query(AuditLog)
            .filter(AuditLog.action == "user.role_change")
            .all()
        )
        assert any(
            r.entity_id == dept.theirs.lecturer_user.id
            and (r.summary or {}).get("to") == "hod"
            for r in rows
        ), f"no user.role_change audit row for the promotion: {[r.summary for r in rows]}"

    def test_an_unknown_lecturer_is_a_422_not_a_dangling_row(self, client, dept) -> None:
        resp = client.put(
            f"/api/v1/programs/{dept.mine.program.id}/heads",
            json={"teacher_ids": ["00000000-0000-4000-8000-000000000000"]},
            headers=dept.P,
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "unknown_teacher"

    def test_a_head_cannot_appoint_themselves(self, client, dept) -> None:
        """Dean-only. An HOD promoting themselves into another department would be the
        role's obvious abuse, and the gate is the only thing preventing it."""
        resp = client.put(
            f"/api/v1/programs/{dept.theirs.program.id}/heads",
            json={"teacher_ids": [str(dept.hod.id)]},
            headers=dept.HOD,
        )
        assert resp.status_code == 403, resp.text


class TestAuditLogEndpoint:
    def test_auditor_can_read_the_trail(self, client, dept, make_user, auth_headers) -> None:
        auditor = make_user(role=Role.AUDITOR)
        # Generate a real audited action first, so this is not asserting on an empty page.
        client.put(
            f"/api/v1/programs/{dept.mine.program.id}/heads",
            json={"teacher_ids": []},
            headers=dept.P,
        )
        resp = client.get(
            "/api/v1/settings/audit-log?page_size=25",
            headers=auth_headers(user_id=auditor.id, role=Role.AUDITOR),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] >= 1
        assert {"action", "entity_type", "created_at", "actor_name"} <= set(
            body["items"][0]
        )

    def test_the_registrar_cannot_read_the_trail(
        self, client, make_user, auth_headers
    ) -> None:
        """The log records what the Registrar did; they are not one of its readers."""
        sec = make_user(role=Role.SECRETARY)
        resp = client.get(
            "/api/v1/settings/audit-log",
            headers=auth_headers(user_id=sec.id, role=Role.SECRETARY),
        )
        assert resp.status_code == 403, resp.text

    def test_the_auditor_cannot_write_to_the_trail(
        self, client, make_user, auth_headers
    ) -> None:
        """There is no write route; prove the read one refuses a POST rather than 405ing
        into something that exists."""
        auditor = make_user(role=Role.AUDITOR)
        resp = client.post(
            "/api/v1/settings/audit-log",
            json={"action": "forged"},
            headers=auth_headers(user_id=auditor.id, role=Role.AUDITOR),
        )
        assert resp.status_code in (403, 404, 405), resp.text


class TestEveryRoleGetsADashboard:
    """`GET /dashboard` answers 200 for every role, tagged with that role.

    **This suite exists because its absence shipped a 500.** D43 re-tagged the HOD and
    Auditor payloads by splatting an existing model's `model_dump()` into a subclass whose
    `role` is a different `Literal` — a guaranteed ValidationError, and therefore a 500 on
    the dashboard of the very role the increment added. Nothing caught it: the frontend
    probe exercised the MSW mock, which is a SEPARATE implementation that happened to be
    right, so "the dashboard works" was true of the demo and false of the server.

    So this is deliberately parametrised over every role rather than the two new ones. The
    endpoint is a role-discriminated union and the discriminator is what the client
    switches on to pick a component; a payload that 500s, or one tagged with the wrong
    role, breaks the page either way. Any future role has to pass here too.
    """

    @pytest.mark.parametrize(
        ("role", "expected_tag"),
        [
            (Role.PRINCIPAL, "principal"),
            (Role.SECRETARY, "secretary"),
            (Role.TEACHER, "teacher"),
            (Role.STUDENT, "student"),
            (Role.HOD, "hod"),
            (Role.AUDITOR, "auditor"),
        ],
    )
    def test_dashboard_responds_and_is_tagged_with_the_callers_role(
        self, client, dept, make_user, auth_headers, role, expected_tag
    ) -> None:
        user = make_user(role=role)
        resp = client.get(
            "/api/v1/dashboard", headers=auth_headers(user_id=user.id, role=role)
        )
        assert resp.status_code == 200, f"{role.value} dashboard: {resp.status_code} {resp.text}"
        assert resp.json()["role"] == expected_tag, resp.json()["role"]

    def test_the_hod_dashboard_has_the_LECTURER_shape(
        self, client, dept
    ) -> None:
        """Tag and shape must agree.

        The page routes on `role` and then reads fields off `stats`. A payload tagged
        `hod` carrying the ADMIN shape returns 200 and renders an empty lecturer
        dashboard — a green status code proves nothing here on its own.
        """
        resp = client.get("/api/v1/dashboard", headers=dept.HOD)
        assert resp.status_code == 200, resp.text
        stats = resp.json()["stats"]
        assert "my_offerings" in stats, f"not the lecturer shape: {sorted(stats)}"
        assert "active_students" not in stats, f"admin fields leaked in: {sorted(stats)}"

    def test_the_auditor_dashboard_has_the_ADMIN_shape(
        self, client, make_user, auth_headers
    ) -> None:
        auditor = make_user(role=Role.AUDITOR)
        resp = client.get(
            "/api/v1/dashboard",
            headers=auth_headers(user_id=auditor.id, role=Role.AUDITOR),
        )
        assert resp.status_code == 200, resp.text
        stats = resp.json()["stats"]
        assert "active_students" in stats, f"not the admin shape: {sorted(stats)}"
        assert "my_offerings" not in stats, f"lecturer fields leaked in: {sorted(stats)}"

    def test_a_promoted_lecturer_keeps_a_working_dashboard(
        self, client, dept, db_session
    ) -> None:
        """The exact path the client hit: promote a lecturer, then load their dashboard.

        End-to-end through the real endpoints — appoint via `PUT /programs/{id}/heads`,
        then `GET /dashboard` as that person — because the defect only appeared once a
        real promotion had happened and the role branch was actually reached.
        """
        lecturer = dept.theirs.lecturer
        lecturer_user = dept.theirs.lecturer_user

        appointed = client.put(
            f"/api/v1/programs/{dept.theirs.program.id}/heads",
            json={"teacher_ids": [str(lecturer.id)]},
            headers=dept.P,
        )
        assert appointed.status_code == 200, appointed.text

        db_session.expire_all()
        from app.modules.users.models import User

        assert db_session.get(User, lecturer_user.id).role == Role.HOD

        resp = client.get(
            "/api/v1/dashboard",
            headers=dept._auth_headers(user_id=lecturer_user.id, role=Role.HOD),
        )
        assert resp.status_code == 200, (
            f"a lecturer promoted to HOD got {resp.status_code} on their dashboard: "
            f"{resp.text}"
        )
        assert resp.json()["role"] == "hod"


class TestFirstPageLoadNeverFivehundreds:
    """Nothing an HOD or Auditor loads on sign-in may 500.

    The dashboard defect reached the client as *"the lecturer's dashboard crashed"* — the
    symptom of a new role is almost never one endpoint, it is the handful the app shell
    fires the moment that role first signs in. Each of those is a place a `Literal`
    mismatch, an unhandled `elif`, or a scope helper returning the wrong empty value turns
    into a 500, and each was written before either role existed.

    A 403 or a 404 is FINE here and deliberately allowed: those are decisions. A 5xx is a
    crash, and this suite exists to say so about every one of them at once, so the next
    role added to this system gets a one-line answer to "does signing in work".
    """

    #: What the shell requests on a cold load — `AppShell`, `useNotifications`,
    #: `YearContext` and the landing route between them.
    SHELL_ENDPOINTS = [
        "/api/v1/auth/me",
        "/api/v1/dashboard",
        "/api/v1/announcements?page=1&page_size=5",
        "/api/v1/announcements/unread-count",
        "/api/v1/grade-revisions?status=pending",
        "/api/v1/settings/academic-years",
        "/api/v1/timetable/me",
        "/api/v1/students?page_size=25",
        "/api/v1/teachers?page_size=25",
        "/api/v1/offerings?page_size=25",
        "/api/v1/courses?page_size=25",
        "/api/v1/programs?page_size=25",
    ]

    @pytest.mark.parametrize("role", [Role.HOD, Role.AUDITOR])
    def test_no_shell_endpoint_returns_5xx(
        self, client, dept, make_user, auth_headers, role
    ) -> None:
        user = make_user(role=role)
        headers = auth_headers(user_id=user.id, role=role)

        crashes = []
        for path in self.SHELL_ENDPOINTS:
            resp = client.get(path, headers=headers)
            if resp.status_code >= 500:
                crashes.append(f"{path} -> {resp.status_code} {resp.text[:200]}")

        assert not crashes, f"{role.value} crashed on sign-in:\n" + "\n".join(crashes)

    def test_an_APPOINTED_head_loads_the_shell_cleanly(self, client, dept) -> None:
        """The same sweep for a head who actually heads something.

        Separate from the parametrised case above because the two exercise different
        code: an unappointed head takes the empty-scope path everywhere, while this one
        runs the real `program_heads` joins. A scope helper can be fine on `[]` and wrong
        on a populated set.
        """
        crashes = []
        for path in self.SHELL_ENDPOINTS:
            resp = client.get(path, headers=dept.HOD)
            if resp.status_code >= 500:
                crashes.append(f"{path} -> {resp.status_code} {resp.text[:200]}")

        assert not crashes, "an appointed HOD crashed on sign-in:\n" + "\n".join(crashes)

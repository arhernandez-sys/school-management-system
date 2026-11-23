"""D42 §2/§3 — what a Lecturer sees on a student, and the lecturer profile's year switcher.

Two rules, one file, because they are the same client sentence read from both ends:

  **§3 — "lecturer cannot see all the students course and course offering only theirs,
  they can only see grades for their courses not for all the student takes."**

  A Lecturer reaches a student's profile as soon as they share ONE offering with them
  (`_assert_teacher_can_see_student`). That was always the right rule for *reachability*
  and the wrong one for *content*: the profile then listed every course the student takes
  and grouped every mark in all of them. The Grades module and the Offerings module were
  already scoped to `class_teachers`; the STUDENT module was the hole.

  **§2 — the academic-year switcher on the lecturer profile.**

  `GET /teachers/{id}/years` + `?academic_year_id=` on the detail. Narrowing only: the
  assignments listed are that lecturer's either way, so the switcher can never widen a
  view. Includes the `SemesterRef` fix — `_classes_taught` built its `OfferingRef` without
  one, so the profile's term line rendered blank against the real backend while the demo
  handlers filled it in.

Reuses `test_grades.py::_Graph`, which already carries an owning teacher, a second
offering owned by somebody ELSE, and a student factory. That second offering is the whole
experiment: enrol one student in both, and every assertion below is "does the un-owned
half leak".

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.offerings.models import ClassEnrollment, ClassTeacher, Course, CourseOffering
from app.modules.settings.models import AcademicYear, Semester
from app.modules.teachers.models import TeacherProfile
from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"
TEACHERS = "/api/v1/teachers"


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale)


@pytest.fixture
def shared_student(graph, db_session):
    """A student enrolled in BOTH offerings — the one the owning Lecturer teaches and the
    one they do not. Returns `(student, enrollment_in_owned_offering)`.

    Everything in this file turns on this student: a Lecturer who shares only one of the
    two must still reach the profile, and must see only the one.
    """
    student, enr = graph.student()
    db_session.add(
        ClassEnrollment(
            offering_id=graph.other_cs.id, student_id=student.id, semester_id=graph.sem.id
        )
    )
    db_session.flush()
    return student, enr


# ════════════════════════════════════════════════════════════════════════════
# §3 — GET /students/{id} — the enrolment list
# ════════════════════════════════════════════════════════════════════════════
class TestStudentDetailOfferings:
    def test_the_dean_sees_both_offerings(self, client, graph, shared_student) -> None:
        """The control. Without it a bug that emptied `current_offerings` for EVERYONE
        would read as a pass on every Lecturer assertion below."""
        student, _enr = shared_student
        body = client.get(f"{STUDENTS}/{student.id}", headers=graph.P).json()
        ids = {o["id"] for o in body["current_offerings"]}
        assert ids == {str(graph.cs.id), str(graph.other_cs.id)}

    def test_the_registrar_sees_both_offerings(self, client, graph, shared_student) -> None:
        student, _enr = shared_student
        body = client.get(f"{STUDENTS}/{student.id}", headers=graph.S).json()
        ids = {o["id"] for o in body["current_offerings"]}
        assert ids == {str(graph.cs.id), str(graph.other_cs.id)}

    def test_a_lecturer_can_OPEN_only_their_OWN_offering(
        self, client, graph, shared_student
    ) -> None:
        """THE RULE, as D44 restated it.

        D42 removed the other lecturer's offering from this list outright. The client
        asked for the opposite shape: the lecturer should SEE that their advisee is taking
        four courses, and be able to open only the one they teach. So the list is complete
        and `can_open` carries the rule.

        What has NOT changed is the reach behind it — the other offering's roster and
        gradebook are still refused by `offerings/service` on its own authority.
        `can_open` is an affordance; see `StudentOfferingRef`.
        """
        student, _enr = shared_student
        resp = client.get(f"{STUDENTS}/{student.id}", headers=graph.H)
        assert resp.status_code == 200, resp.text
        offerings = {o["id"]: o for o in resp.json()["current_offerings"]}
        assert set(offerings) == {str(graph.cs.id), str(graph.other_cs.id)}
        assert offerings[str(graph.cs.id)]["can_open"] is True
        assert offerings[str(graph.other_cs.id)]["can_open"] is False

    def test_the_OTHER_lecturer_can_open_only_theirs(
        self, client, graph, shared_student
    ) -> None:
        """Symmetry, and it is not redundant: a rule accidentally written against the
        wrong side of the join would pass the test above and fail this one."""
        student, _enr = shared_student
        offerings = {
            o["id"]: o
            for o in client.get(f"{STUDENTS}/{student.id}", headers=graph.OTHER).json()[
                "current_offerings"
            ]
        }
        assert set(offerings) == {str(graph.cs.id), str(graph.other_cs.id)}
        assert offerings[str(graph.other_cs.id)]["can_open"] is True
        assert offerings[str(graph.cs.id)]["can_open"] is False

    def test_the_dean_may_open_everything(self, client, graph, shared_student) -> None:
        """D44 — the roles that see everything get `can_open` left at its default rather
        than being handed a computed set. Pinned so that "no narrowing" cannot silently
        become "narrowed to nothing" for them."""
        student, _enr = shared_student
        body = client.get(f"{STUDENTS}/{student.id}", headers=graph.P).json()
        assert [o["can_open"] for o in body["current_offerings"]] == [True, True]

    def test_reachability_is_unchanged(self, client, graph, db_session) -> None:
        """Filtering the CONTENT must not have changed who may open the page. A student
        the Lecturer shares nothing with is still a 404 (no existence leak, §3.3)."""
        stranger = graph.student(enroll=False)[0]
        db_session.add(
            ClassEnrollment(
                offering_id=graph.other_cs.id, student_id=stranger.id, semester_id=graph.sem.id
            )
        )
        db_session.flush()
        assert client.get(f"{STUDENTS}/{stranger.id}", headers=graph.H).status_code == 404

    def test_the_directory_COUNT_agrees_with_the_profile(
        self, client, graph, shared_student
    ) -> None:
        """The "Courses" column on the directory is the same fact the profile's enrolment
        list shows, so the two must never disagree for the same viewer.

        D44 flipped which side that agreement is reached on. D42 narrowed BOTH to the
        lecturer's own offerings; D44 shows the full enrolment on the profile, so the
        count is global again. The invariant is untouched — only the value is."""
        student, _enr = shared_student

        dean_row = next(
            r
            for r in client.get(STUDENTS, headers=graph.P).json()["items"]
            if r["id"] == str(student.id)
        )
        lecturer_row = next(
            r
            for r in client.get(STUDENTS, headers=graph.H).json()["items"]
            if r["id"] == str(student.id)
        )
        # Both see 2 now: the lecturer's profile lists both offerings, one of them
        # unopenable, so a count of 1 would be the thing that read as a bug.
        assert dean_row["offering_count"] == 2
        assert lecturer_row["offering_count"] == 2

        profile = client.get(f"{STUDENTS}/{student.id}", headers=graph.H).json()
        assert lecturer_row["offering_count"] == len(profile["current_offerings"])

    def test_the_lecturer_still_gets_the_rest_of_the_profile(
        self, client, graph, shared_student
    ) -> None:
        """Scoping the offering list is not a reason to hollow out the record — the
        Lecturer legitimately needs to know who they are looking at."""
        student, _enr = shared_student
        body = client.get(f"{STUDENTS}/{student.id}", headers=graph.H).json()
        assert body["full_name"] == student.full_name
        assert body["student_number"] == student.student_number


# ════════════════════════════════════════════════════════════════════════════
# §3 — GET /students/{id}/assessments — the Grades & Assessments tab
# ════════════════════════════════════════════════════════════════════════════
class TestStudentAssessments:
    def _groups(self, client, graph, student, headers):
        resp = client.get(f"{STUDENTS}/{student.id}/assessments", headers=headers)
        assert resp.status_code == 200, resp.text
        return {g["offering_id"] for g in resp.json()["items"]}

    @pytest.fixture
    def graded_in_both(self, graph, shared_student):
        """One assessment in each offering, so both subjects would group if unscoped.

        Only the owned one carries a mark — the tab groups by OFFERING and lists the
        assessments in it, so an ungraded assessment still produces a group. That is what
        makes this fixture discriminating: the un-owned group would appear on nothing more
        than the student's enrolment.
        """
        student, enr = shared_student
        mine = graph.assessment(is_released=True)
        graph.grade(mine, student, enr, score="18")
        theirs = graph.assessment(cs_id=graph.other_cs.id, is_released=True)
        return student, mine, theirs

    def test_the_dean_sees_both_subjects(self, client, graph, graded_in_both) -> None:
        student, _mine, _theirs = graded_in_both
        assert self._groups(client, graph, student, graph.P) == {
            str(graph.cs.id),
            str(graph.other_cs.id),
        }

    def test_a_lecturer_sees_only_their_OWN_subject(
        self, client, graph, graded_in_both
    ) -> None:
        """"they can only see grades for their courses not for all the student takes"
        — the tab used to group every subject the student sits."""
        student, _mine, _theirs = graded_in_both
        assert self._groups(client, graph, student, graph.H) == {str(graph.cs.id)}

    def test_the_OTHER_lecturer_sees_only_theirs(
        self, client, graph, graded_in_both
    ) -> None:
        student, _mine, _theirs = graded_in_both
        assert self._groups(client, graph, student, graph.OTHER) == {str(graph.other_cs.id)}

    def test_an_explicit_year_is_scoped_too(
        self, client, graph, graded_in_both
    ) -> None:
        """The year switcher takes a different code path (`student_offerings_in_year`
        rather than the active-year fallback), so it needs its own assertion — a filter
        applied to only one branch is exactly the kind of half-fix that reads as done."""
        student, _mine, _theirs = graded_in_both
        resp = client.get(
            f"{STUDENTS}/{student.id}/assessments?academic_year_id={graph.year.id}",
            headers=graph.H,
        )
        assert resp.status_code == 200, resp.text
        assert {g["offering_id"] for g in resp.json()["items"]} == {str(graph.cs.id)}


# ════════════════════════════════════════════════════════════════════════════
# §3 — GET /students/{id}/years — the per-student year switcher
# ════════════════════════════════════════════════════════════════════════════
class TestStudentYears:
    def test_a_lecturer_only_gets_years_they_taught_the_student(
        self, client, graph, db_session, make_user, auth_headers
    ) -> None:
        """A year the Lecturer did not teach them in would open a switcher position where
        every tab below is empty — which reads as a broken screen rather than as a rule."""
        student, _enr = graph.student()

        # A second year the student sat, taught entirely by somebody else.
        past = AcademicYear(
            name=f"Past {graph.tag}",
            start_date=date(2024, 9, 1),
            end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        db_session.add(past)
        db_session.flush()
        past_sem = Semester(
            academic_year_id=past.id, name="Semester 1", sequence=1,
            start_date=date(2024, 9, 1), end_date=date(2025, 1, 31), is_active=False,
        )
        past_course = Course(name=f"Past {graph.tag}", code=f"P{graph.tag[:3].upper()}")
        db_session.add_all([past_sem, past_course])
        db_session.flush()
        past_offering = CourseOffering(
            course_id=past_course.id,
            semester_id=past_sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db_session.add(past_offering)
        db_session.flush()
        db_session.add_all(
            [
                ClassTeacher(
                    offering_id=past_offering.id, teacher_id=graph.other_teacher.id
                ),
                ClassEnrollment(
                    offering_id=past_offering.id,
                    student_id=student.id,
                    semester_id=past_sem.id,
                ),
            ]
        )
        db_session.flush()

        dean_years = {
            y["id"] for y in client.get(f"{STUDENTS}/{student.id}/years", headers=graph.P).json()["items"]
        }
        assert dean_years == {str(graph.year.id), str(past.id)}

        lecturer_years = {
            y["id"] for y in client.get(f"{STUDENTS}/{student.id}/years", headers=graph.H).json()["items"]
        }
        assert lecturer_years == {str(graph.year.id)}


# ════════════════════════════════════════════════════════════════════════════
# §2 — the lecturer profile's academic-year switcher
# ════════════════════════════════════════════════════════════════════════════
def _second_year_assignment(graph, db_session) -> tuple[AcademicYear, CourseOffering]:
    """Give `graph.teacher` an assignment in a SECOND academic year."""
    year2 = AcademicYear(
        name=f"Year2 {graph.tag}",
        start_date=date(2024, 9, 1),
        end_date=date(2025, 6, 30),
        status=AcademicYearStatus.ARCHIVED,
    )
    db_session.add(year2)
    db_session.flush()
    sem2 = Semester(
        academic_year_id=year2.id, name="Semester 1", sequence=1,
        start_date=date(2024, 9, 1), end_date=date(2025, 1, 31), is_active=False,
    )
    course2 = Course(name=f"Course2 {graph.tag}", code=f"C2{graph.tag[:3].upper()}")
    db_session.add_all([sem2, course2])
    db_session.flush()
    offering2 = CourseOffering(
        course_id=course2.id, semester_id=sem2.id, section_code=uuid.uuid4().hex[:6]
    )
    db_session.add(offering2)
    db_session.flush()
    db_session.add(ClassTeacher(offering_id=offering2.id, teacher_id=graph.teacher.id))
    db_session.flush()
    return year2, offering2


class TestTeacherYears:
    def test_only_the_years_the_lecturer_actually_taught(
        self, client, graph, db_session
    ) -> None:
        year2, _off2 = _second_year_assignment(graph, db_session)
        body = client.get(f"{TEACHERS}/{graph.teacher.id}/years", headers=graph.P).json()
        assert {y["id"] for y in body["items"]} == {str(graph.year.id), str(year2.id)}

    def test_newest_first(self, client, graph, db_session) -> None:
        """The switcher opens on the top entry, and a Dean asking about "this year"
        should not have to scroll past 2019 to find it."""
        year2, _off2 = _second_year_assignment(graph, db_session)
        items = client.get(f"{TEACHERS}/{graph.teacher.id}/years", headers=graph.P).json()["items"]
        assert [y["id"] for y in items] == [str(graph.year.id), str(year2.id)]

    def test_a_lecturer_with_no_assignments_gets_an_empty_list(
        self, client, graph, db_session
    ) -> None:
        """Not a 404 and not the whole calendar. An empty switcher is the honest answer
        for a newly created lecturer, and `YearSelect` disables itself on one."""
        idle = TeacherProfile(
            staff_number=f"IDLE-{graph.tag}", full_name="Idle Lecturer",
            status=TeacherStatus.ACTIVE,
        )
        db_session.add(idle)
        db_session.flush()
        body = client.get(f"{TEACHERS}/{idle.id}/years", headers=graph.P).json()
        assert body["items"] == []

    def test_unknown_lecturer_is_404(self, client, graph) -> None:
        assert client.get(f"{TEACHERS}/{uuid.uuid4()}/years", headers=graph.P).status_code == 404

    def test_a_lecturer_may_read_it(self, client, graph) -> None:
        """The switcher is offered on the lecturer's OWN profile too, so the route has to
        admit them — it is the same `_read` gate the rest of the module uses."""
        assert client.get(f"{TEACHERS}/{graph.teacher.id}/years", headers=graph.H).status_code == 200

    def test_a_student_is_denied(self, client, graph) -> None:
        """Students have no access to any teacher route (api-spec §3.4)."""
        student, _enr = graph.student(with_login=True)
        resp = client.get(
            f"{TEACHERS}/{graph.teacher.id}/years", headers=graph.student_headers(student)
        )
        assert resp.status_code == 403

    def test_the_route_is_not_swallowed_by_the_detail_path(self, client, graph) -> None:
        """`/{teacher_id}/years` must be declared BEFORE `/{teacher_id}`; if it were not,
        FastAPI would try to parse "years" as a uuid and answer 422."""
        resp = client.get(f"{TEACHERS}/{graph.teacher.id}/years", headers=graph.P)
        assert resp.status_code == 200
        assert "items" in resp.json()


class TestTeacherDetailYearScoping:
    def test_no_year_returns_every_assignment(self, client, graph, db_session) -> None:
        _year2, off2 = _second_year_assignment(graph, db_session)
        body = client.get(f"{TEACHERS}/{graph.teacher.id}", headers=graph.P).json()
        ids = {c["offering_id"] for c in body["classes_taught"]}
        assert ids == {str(graph.cs.id), str(off2.id)}

    def test_a_year_narrows_to_that_year(self, client, graph, db_session) -> None:
        year2, off2 = _second_year_assignment(graph, db_session)
        body = client.get(
            f"{TEACHERS}/{graph.teacher.id}?academic_year_id={year2.id}", headers=graph.P
        ).json()
        assert {c["offering_id"] for c in body["classes_taught"]} == {str(off2.id)}

        body = client.get(
            f"{TEACHERS}/{graph.teacher.id}?academic_year_id={graph.year.id}", headers=graph.P
        ).json()
        assert {c["offering_id"] for c in body["classes_taught"]} == {str(graph.cs.id)}

    def test_a_year_the_lecturer_never_taught_is_empty(
        self, client, graph, db_session
    ) -> None:
        """Strict, not fall-back-to-everything. Silently answering about a different year
        is how a screen ends up confidently showing the wrong thing."""
        empty = AcademicYear(
            name=f"Empty {graph.tag}",
            start_date=date(2020, 9, 1),
            end_date=date(2021, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        db_session.add(empty)
        db_session.flush()
        body = client.get(
            f"{TEACHERS}/{graph.teacher.id}?academic_year_id={empty.id}", headers=graph.P
        ).json()
        assert body["classes_taught"] == []

    def test_the_year_cannot_widen_what_a_lecturer_sees(
        self, client, graph, db_session
    ) -> None:
        """The assignments listed are that lecturer's either way — asserted rather than
        assumed, because a scoping param that reaches a different query is the classic
        way an "only narrows" claim stops being true."""
        year2, off2 = _second_year_assignment(graph, db_session)
        body = client.get(
            f"{TEACHERS}/{graph.other_teacher.id}?academic_year_id={year2.id}",
            headers=graph.P,
        ).json()
        assert body["classes_taught"] == []
        assert str(off2.id) not in {c["offering_id"] for c in body["classes_taught"]}

    def test_an_unknown_year_is_422_not_a_silent_everything(self, client, graph) -> None:
        """A malformed uuid must not fall through to the unfiltered answer."""
        resp = client.get(
            f"{TEACHERS}/{graph.teacher.id}?academic_year_id=not-a-uuid", headers=graph.P
        )
        assert resp.status_code == 422


class TestTheOfferingRefCarriesItsTerm:
    def test_classes_taught_now_names_the_semester(self, client, graph) -> None:
        """`_classes_taught` built its `OfferingRef` WITHOUT a semester, so the profile's
        term line (`c.offering.semester?.name`) has rendered blank against the real
        backend since D31 while the demo handlers filled it in. A year switcher whose rows
        do not say which term they belong to would be that same bug, larger."""
        body = client.get(f"{TEACHERS}/{graph.teacher.id}", headers=graph.P).json()
        taught = next(c for c in body["classes_taught"] if c["offering_id"] == str(graph.cs.id))
        assert taught["offering"]["semester"] is not None
        assert taught["offering"]["semester"]["name"] == graph.sem.name
        assert taught["offering"]["semester"]["id"] == str(graph.sem.id)

"""Religion / Gender / Programme filters on the students directory (D32 Phase 5, brief §3).

Three new query params on `GET /students`. The brief's requirement is that they "work
independently" and "work in combination with existing filters", and the four worked
examples it gives are all-Male, one-Programme, one-Religion, and Female-in-Programme-X —
so the combination cases are pinned here individually rather than left to a single
smoke test.

**Two things are easy to get wrong and are pinned deliberately:**

  * These filter the STUDENT RECORD, not their enrolment. A graduated or withdrawn
    student still matches, because "print all Catholic students" means all of them. The
    same trap already caught `academic_year_id` once (see `list_students`' docstring),
    where filtering through enrolment quietly emptied the `status=graduated` view.
  * `religion` is EXACT-match, not a LIKE. The values come from `/students/filter-options`,
    and a substring match would only ever conflate two real values — "Catholic" swallowing
    "Roman Catholic".

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.common.enums import Role, StudentStatus
from app.modules.programs.models import Program
from app.modules.students.models import StudentProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"


@pytest.fixture
def staff_headers(make_user, auth_headers):
    user = make_user(role=Role.PRINCIPAL)
    return auth_headers(user_id=user.id, role=Role.PRINCIPAL)


@pytest.fixture
def programs(db_session):
    """Two programmes, so a programme filter has something to exclude."""
    tag = uuid.uuid4().hex[:4].upper()
    a = Program(code=f"AA{tag}", name=f"Programme A {tag}", min_passing_grade_point=2.5)
    b = Program(code=f"BB{tag}", name=f"Programme B {tag}", min_passing_grade_point=2.5)
    db_session.add_all([a, b])
    db_session.flush()
    return a, b


def _student(
    db_session,
    *,
    name: str,
    gender: str | None = None,
    religion: str | None = None,
    program=None,
    status=StudentStatus.ACTIVE,
) -> StudentProfile:
    s = StudentProfile(
        student_number=f"S{uuid.uuid4().hex[:10]}",
        **split_name(name),
        date_of_birth=date(2010, 1, 1),
        enrollment_date=date(2025, 9, 1),
        status=status,
        gender=gender,
        religion=religion,
        program_id=program.id if program is not None else None,
    )
    db_session.add(s)
    db_session.flush()
    return s


@pytest.fixture
def cohort(db_session, programs):
    """Six students spanning both genders, two religions and two programmes.

    Deliberately NOT a clean grid: `carla` is Female/Catholic/Programme A and `dan` is
    Male/Catholic/Programme A, so a combination filter has to actually AND rather than
    happening to be right because only one axis varies.
    """
    a, b = programs
    return {
        "ana": _student(db_session, name="Ana Alpha", gender="female", religion="Catholic", program=a),
        "ben": _student(db_session, name="Ben Bravo", gender="male", religion="Adventist", program=b),
        "carla": _student(db_session, name="Carla Charlie", gender="female", religion="Catholic", program=a),
        "dan": _student(db_session, name="Dan Delta", gender="male", religion="Catholic", program=a),
        "eve": _student(db_session, name="Eve Echo", gender="female", religion=None, program=b),
        "gone": _student(
            db_session, name="Gia Graduate", gender="female", religion="Catholic",
            program=a, status=StudentStatus.GRADUATED,
        ),
    }


def _ids(client, headers, **params) -> set[str]:
    """The full filtered id set. `page_size=100` so an assertion never fails merely
    because the answer spilled onto page 2."""
    query = "&".join(f"{k}={v}" for k, v in {"page_size": 100, **params}.items())
    resp = client.get(f"{STUDENTS}?{query}", headers=headers)
    assert resp.status_code == 200, resp.text
    return {i["id"] for i in resp.json()["items"]}


# ════════════════════════════════════════════════════════════════════════════
class TestEachFilterAlone:
    def test_gender(self, client, staff_headers, cohort) -> None:
        got = _ids(client, staff_headers, gender="female")
        assert {str(cohort[k].id) for k in ("ana", "carla", "eve", "gone")} <= got
        assert str(cohort["ben"].id) not in got
        assert str(cohort["dan"].id) not in got

    def test_religion(self, client, staff_headers, cohort) -> None:
        got = _ids(client, staff_headers, religion="Catholic")
        assert {str(cohort[k].id) for k in ("ana", "carla", "dan", "gone")} <= got
        assert str(cohort["ben"].id) not in got
        assert str(cohort["eve"].id) not in got

    def test_program(self, client, staff_headers, cohort, programs) -> None:
        a, _b = programs
        got = _ids(client, staff_headers, program_id=a.id)
        assert {str(cohort[k].id) for k in ("ana", "carla", "dan", "gone")} <= got
        assert str(cohort["ben"].id) not in got
        assert str(cohort["eve"].id) not in got

    def test_religion_is_exact_not_a_substring(self, client, staff_headers, db_session, cohort) -> None:
        """"Catholic" must not swallow "Roman Catholic" — they are different answers on
        the admissions form, and conflating them would misreport a headcount."""
        roman = _student(db_session, name="Rita Roman", religion="Roman Catholic")
        got = _ids(client, staff_headers, religion="Catholic")
        assert str(roman.id) not in got
        assert str(cohort["ana"].id) in got

    def test_an_unmatched_value_returns_empty_not_everything(
        self, client, staff_headers, cohort
    ) -> None:
        """The failure mode worth guarding: a filter the service silently ignores would
        return the whole directory and look like it worked."""
        assert _ids(client, staff_headers, religion="Zoroastrian") == set()


# ════════════════════════════════════════════════════════════════════════════
class TestCombinations:
    """The brief's worked examples, plus the case that catches a filter that does not
    actually AND."""

    def test_female_students_in_programme_X(self, client, staff_headers, cohort, programs) -> None:
        a, _b = programs
        got = _ids(client, staff_headers, gender="female", program_id=a.id)
        assert {str(cohort[k].id) for k in ("ana", "carla", "gone")} <= got
        # Male, same programme — excluded by gender alone.
        assert str(cohort["dan"].id) not in got
        # Female, other programme — excluded by programme alone.
        assert str(cohort["eve"].id) not in got

    def test_all_three_at_once(self, client, staff_headers, cohort, programs) -> None:
        a, _b = programs
        got = _ids(
            client, staff_headers, gender="male", religion="Catholic", program_id=a.id
        )
        assert str(cohort["dan"].id) in got
        assert str(cohort["ana"].id) not in got  # right religion and programme, wrong gender
        assert str(cohort["ben"].id) not in got  # right gender, wrong religion and programme

    def test_they_compose_with_status(self, client, staff_headers, cohort) -> None:
        got = _ids(client, staff_headers, gender="female", status="Graduated")
        assert str(cohort["gone"].id) in got
        assert str(cohort["ana"].id) not in got

    def test_they_compose_with_search(self, client, staff_headers, cohort) -> None:
        got = _ids(client, staff_headers, gender="female", search="Carla")
        assert got == {str(cohort["carla"].id)}

    def test_a_graduated_student_still_matches(self, client, staff_headers, cohort) -> None:
        """These are facts about the PERSON, so they must not be filtered through
        enrolment. Doing so would quietly empty the graduated view — the same trap the
        `academic_year_id` filter documents."""
        assert str(cohort["gone"].id) in _ids(client, staff_headers, religion="Catholic")


# ════════════════════════════════════════════════════════════════════════════
class TestTheRowCarriesWhatItWasFilteredBy:
    """A printed sheet headed "Female students in Business Management" that does not
    print the programme cannot be checked by the person holding it."""

    def test_the_list_row_carries_gender_religion_and_program_code(
        self, client, staff_headers, cohort, programs
    ) -> None:
        a, _b = programs
        resp = client.get(
            f"{STUDENTS}?page_size=100&search=Ana Alpha", headers=staff_headers
        )
        assert resp.status_code == 200, resp.text
        row = next(i for i in resp.json()["items"] if i["id"] == str(cohort["ana"].id))
        assert row["gender"] == "female"
        assert row["religion"] == "Catholic"
        assert row["program_code"] == a.code

    def test_a_student_with_no_programme_reports_null(
        self, client, staff_headers, db_session
    ) -> None:
        loose = _student(db_session, name="Nora None")
        resp = client.get(f"{STUDENTS}?page_size=100&search=Nora None", headers=staff_headers)
        row = next(i for i in resp.json()["items"] if i["id"] == str(loose.id))
        assert row["program_code"] is None
        assert row["religion"] is None


# ════════════════════════════════════════════════════════════════════════════
class TestFilterOptions:
    OPTIONS = f"{STUDENTS}/filter-options"

    def test_it_returns_the_distinct_religions_present(
        self, client, staff_headers, cohort
    ) -> None:
        body = client.get(self.OPTIONS, headers=staff_headers).json()
        assert "Catholic" in body["religions"]
        assert "Adventist" in body["religions"]

    def test_the_values_are_distinct_and_sorted(self, client, staff_headers, cohort) -> None:
        religions = client.get(self.OPTIONS, headers=staff_headers).json()["religions"]
        assert religions == sorted(set(religions))

    def test_nulls_are_not_offered(self, client, staff_headers, cohort) -> None:
        religions = client.get(self.OPTIONS, headers=staff_headers).json()["religions"]
        assert None not in religions
        assert "" not in religions

    def test_a_soft_deleted_students_value_is_not_offered(
        self, client, staff_headers, db_session
    ) -> None:
        """A value that only ever belonged to a removed record would sit in the dropdown
        matching nothing."""
        from app.core.timeutil import utcnow

        ghost = _student(db_session, name="Ghost Only", religion="OnlyGhostReligion")
        ghost.deleted_at = utcnow()
        db_session.flush()
        religions = client.get(self.OPTIONS, headers=staff_headers).json()["religions"]
        assert "OnlyGhostReligion" not in religions

    def test_the_route_is_not_parsed_as_a_student_id(self, client, staff_headers) -> None:
        """`/filter-options` is declared before `/{student_id}`; without that FastAPI
        tries to parse the literal as a UUID and 422s."""
        assert client.get(self.OPTIONS, headers=staff_headers).status_code == 200

    def test_a_student_cannot_read_it(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            self.OPTIONS, headers=auth_headers(user_id=student.id, role=Role.STUDENT)
        )
        assert resp.status_code == 403, resp.text


# ════════════════════════════════════════════════════════════════════════════
class TestScopeIsStillEnforced:
    """New filters must not become a way around the existing scoping — a Lecturer with a
    programme filter must still see only their own students, not the programme's."""

    def test_a_student_still_cannot_list_the_directory(
        self, client, make_user, auth_headers, cohort, programs
    ) -> None:
        a, _b = programs
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            f"{STUDENTS}?program_id={a.id}",
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403, resp.text

    def test_a_lecturer_with_no_offerings_sees_nobody(
        self, client, make_user, auth_headers, db_session, cohort, programs
    ) -> None:
        from app.common.enums import TeacherStatus
        from app.modules.teachers.models import TeacherProfile

        a, _b = programs
        user = make_user(role=Role.TEACHER, full_name="Lonely Lecturer")
        db_session.add(
            TeacherProfile(
                user_id=user.id,
                staff_number=f"T-{uuid.uuid4().hex[:6]}",
                full_name="Lonely Lecturer",
                status=TeacherStatus.ACTIVE,
            )
        )
        db_session.flush()
        got = _ids(
            client,
            auth_headers(user_id=user.id, role=Role.TEACHER),
            program_id=a.id,
        )
        assert got == set(), "the programme filter widened a teacher's scope"

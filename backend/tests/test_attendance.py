"""Comprehensive pytest suite for Module 7.7 — ATTENDANCE (api-spec §8, D-Q4).

Scope: the section picker, the daily register read + bulk upsert, the per-section
summary, and the student's own history — with the negative/edge/security paths.

Recording is teacher-only: P/S read but cannot mark, which is the opposite of most
modules and gets an explicit test. Also pins the three shapes that are easy to get
subtly wrong against the finished frontend: `teachers[].name` (not `full_name`),
`last_recorded.by` as a plain string, and `pct_present` counting LATE as present.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.modules.attendance.models import AttendanceRecord
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

AT = "/api/v1/attendance"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


def _school_today() -> date:
    """The school's local date (America/Belize) — what the service validates against.

    Deliberately not `date.today()` (the runner's clock) nor `utcnow().date()`:
    Belize is UTC-6, so for the last six hours of every local day the UTC date is
    already tomorrow, and asserting against it would make these tests pass or fail
    depending on the hour they run (OQ-TZ1).
    """
    from app.core.timeutil import school_today

    return school_today()


class _Graph:
    """A writable year + section + offering + owning teacher, plus a second section
    the teacher owns nothing in."""

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db_session
        self._make_user = make_user
        self._auth_headers = auth_headers

        self.year = AcademicYear(
            name=f"AttYear {tag}", start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        db_session.add(self.sem)

        self.subject = Course(name=f"Subj {tag}", code=tag.upper())
        db_session.add(self.subject)
        db_session.flush()

        self.cs = CourseOffering(
                course_id=self.subject.id,
                semester_id=self.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        self.other_cs = CourseOffering(
                course_id=self.subject.id,
                semester_id=self.sem.id,
                section_code=uuid.uuid4().hex[:6],
            )
        db_session.add_all([self.cs, self.other_cs])
        db_session.flush()
        self.other_section = self.other_cs
        self.section = self.cs

        self.teacher_user = make_user(role=Role.TEACHER, full_name="Maria Reyes")
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id, staff_number=f"T-{tag}",
            full_name="Maria Reyes", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()
        db_session.add(ClassTeacher(offering_id=self.cs.id, teacher_id=self.teacher.id, is_lead=True))

        # Owns the OTHER section only.
        self.other_teacher_user = make_user(role=Role.TEACHER, full_name="Other Teacher")
        self.other_teacher = TeacherProfile(
            user_id=self.other_teacher_user.id, staff_number=f"O-{tag}",
            full_name="Other Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.other_teacher)
        db_session.flush()
        db_session.add(
            ClassTeacher(offering_id=self.other_cs.id, teacher_id=self.other_teacher.id, is_lead=True)
        )
        db_session.flush()

        self.principal_user = make_user(role=Role.PRINCIPAL, full_name="The Principal")
        self.secretary_user = make_user(role=Role.SECRETARY)
        self.H = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.OTHER = auth_headers(user_id=self.other_teacher_user.id, role=Role.TEACHER)
        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)

    def student(self, *, enroll=True, name=None, with_login=False, section=None):
        s = StudentProfile(
            student_number=f"S-{uuid.uuid4().hex[:8]}",
            **split_name(name or f"Stu {uuid.uuid4().hex[:4]}"),
            date_of_birth=date(2012, 1, 1),
            enrollment_date=date(2025, 9, 1),
            status="Active",
        )
        if with_login:
            user = self._make_user(role=Role.STUDENT, full_name=s.full_name)
            s.user_id = user.id
            s._login = user
        self._db.add(s)
        self._db.flush()
        enr = None
        if enroll:
            enr = ClassEnrollment(
                offering_id=(section or self.section).id, student_id=s.id, semester_id=self.sem.id
            )
            self._db.add(enr)
            self._db.flush()
        return s, enr

    def record(self, student, enrollment, *, status="present", on=None, section=None):
        r = AttendanceRecord(
            offering_id=(section or self.section).id,
            student_id=student.id,
            enrollment_id=enrollment.id,
            semester_id=self.sem.id,
            attendance_date=on or date(2025, 10, 15),
            status=status,
        )
        self._db.add(r)
        self._db.flush()
        return r

    def student_headers(self, student):
        return self._auth_headers(user_id=student._login.id, role=Role.STUDENT)

    def label(self, offering) -> str:  # noqa: ANN001
        """The label the API sends for `offering`.

        Built with the SERVER's `offering_label`, not re-spelled here: deriving the label
        in one place buys nothing if the test hardcodes a second formula that happens to
        agree today. Both offerings in this graph teach `self.subject`.
        """
        from app.modules.offerings.labels import offering_label

        return offering_label(self.subject.code, offering.section_code)


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year)


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_sections_requires_auth(self, client) -> None:
        assert client.get(f"{AT}/offerings").status_code == 401

    def test_register_requires_auth(self, client) -> None:
        assert client.get(f"{AT}?offering_id={uuid.uuid4()}").status_code == 401

    def test_upsert_requires_auth(self, client) -> None:
        body = {"offering_id": str(uuid.uuid4()), "date": "2025-10-15", "entries": []}
        assert client.put(AT, json=body).status_code == 401

    def test_summary_requires_auth(self, client) -> None:
        assert client.get(f"{AT}/summary?offering_id={uuid.uuid4()}").status_code == 401

    def test_me_requires_auth(self, client) -> None:
        assert client.get(f"{AT}/me").status_code == 401

    def test_student_forbidden_on_sections(self, client, graph) -> None:
        s, _ = graph.student(with_login=True)
        r = client.get(f"{AT}/offerings", headers=graph.student_headers(s))
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_student_forbidden_on_register(self, client, graph) -> None:
        s, _ = graph.student(with_login=True)
        r = client.get(f"{AT}?offering_id={graph.section.id}", headers=graph.student_headers(s))
        assert r.status_code == 403

    def test_student_forbidden_on_summary(self, client, graph) -> None:
        s, _ = graph.student(with_login=True)
        r = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.student_headers(s))
        assert r.status_code == 403

    def test_principal_forbidden_on_upsert(self, client, graph) -> None:
        """Unusual for this codebase: P/S read the register but cannot mark it."""
        body = {"offering_id": str(graph.section.id), "date": "2025-10-15", "entries": []}
        r = client.put(AT, json=body, headers=graph.P)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_secretary_forbidden_on_upsert(self, client, graph) -> None:
        body = {"offering_id": str(graph.section.id), "date": "2025-10-15", "entries": []}
        assert client.put(AT, json=body, headers=graph.S).status_code == 403

    def test_teacher_forbidden_on_me(self, client, graph) -> None:
        assert client.get(f"{AT}/me", headers=graph.H).status_code == 403
        assert client.get(f"{AT}/me", headers=graph.P).status_code == 403


# ════════════════════════════════════════════════════════════════════════════
class TestSections:
    def test_teacher_sees_only_sections_they_teach_in(self, client, graph) -> None:
        ids = {i["offering"]["id"] for i in client.get(f"{AT}/offerings", headers=graph.H).json()["items"]}
        assert str(graph.section.id) in ids
        assert str(graph.other_section.id) not in ids

    def test_principal_sees_all_sections(self, client, graph) -> None:
        ids = {i["offering"]["id"] for i in client.get(f"{AT}/offerings", headers=graph.P).json()["items"]}
        assert {str(graph.section.id), str(graph.other_section.id)} <= ids

    def test_year_filter(self, client, graph, db_session) -> None:
        older = AcademicYear(
            name=f"Older {graph.tag}", start_date=date(2024, 9, 1), end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        db_session.add(older)
        db_session.flush()
        r = client.get(f"{AT}/offerings?academic_year_id={older.id}", headers=graph.P)
        assert r.json()["items"] == []

    def test_archived_sections_excluded_when_no_year_given(self, client, graph, db_session) -> None:
        graph.section.is_archived = True
        db_session.flush()
        ids = {i["offering"]["id"] for i in client.get(f"{AT}/offerings", headers=graph.P).json()["items"]}
        assert str(graph.section.id) not in ids

    def test_enrolled_count_counts_active_enrollments(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        graph.student()
        graph.student()
        _dropped, dropped_enr = graph.student()
        dropped_enr.unenrolled_at = utcnow()
        db_session.flush()
        item = next(i for i in client.get(f"{AT}/offerings", headers=graph.H).json()["items"]
                    if i["offering"]["id"] == str(graph.section.id))
        assert item["enrolled_count"] == 2

    def test_teachers_use_the_key_name_not_full_name(self, client, graph) -> None:
        """Binding: the attendance screens read `t.name`. Grades' ref uses full_name."""
        item = next(i for i in client.get(f"{AT}/offerings", headers=graph.H).json()["items"]
                    if i["offering"]["id"] == str(graph.section.id))
        assert item["teachers"][0]["name"] == "Maria Reyes"
        assert "full_name" not in item["teachers"][0]

    def test_a_teacher_on_two_offerings_is_listed_on_each_separately(
        self, client, graph, db_session
    ) -> None:
        """D31 REPLACED a dedup test whose premise is gone.

        This used to assert that a teacher taking two SUBJECTS of one homeroom appeared
        once on that homeroom's register — a real concern when one `classes` row taught
        seven subjects and the picker had to collapse them. An offering teaches exactly
        one course, so there is nothing left to collapse.

        What matters instead is the property that dedup used to protect: each register
        names ITS OWN staff. A teacher on two offerings must appear on both, and neither
        may pick up the other's teachers.
        """
        second_subject = Course(name=f"Second {graph.tag}", code=f"S{graph.tag[:3].upper()}")
        db_session.add(second_subject)
        db_session.flush()
        cs2 = CourseOffering(
            course_id=second_subject.id,
            semester_id=graph.sem.id,
            section_code=uuid.uuid4().hex[:6],
        )
        db_session.add(cs2)
        db_session.flush()
        db_session.add(ClassTeacher(offering_id=cs2.id, teacher_id=graph.teacher.id))
        db_session.flush()

        items = {
            i["offering"]["id"]: i
            for i in client.get(f"{AT}/offerings", headers=graph.H).json()["items"]
        }
        assert [t["name"] for t in items[str(graph.section.id)]["teachers"]] == ["Maria Reyes"]
        assert [t["name"] for t in items[str(cs2.id)]["teachers"]] == ["Maria Reyes"]
        # And the other teacher's offering is not in this teacher's picker at all.
        assert str(graph.other_section.id) not in items

    def test_can_record_only_for_teacher(self, client, graph) -> None:
        assert client.get(f"{AT}/offerings", headers=graph.H).json()["can_record"] is True
        assert client.get(f"{AT}/offerings", headers=graph.P).json()["can_record"] is False
        assert client.get(f"{AT}/offerings", headers=graph.S).json()["can_record"] is False

    def test_the_picker_sends_a_derived_label_not_a_stored_name(self, client, graph) -> None:
        """D31 replaced this file's `homeroom_label`/`section` coercion test.

        Those columns are gone, and with them the "nullable in the ORM, non-nullable in
        the frontend type" coercion they existed to pin. What replaces them is the thing
        that can now go wrong instead: the label is DERIVED, so the register must be told
        what an offering is called rather than reading a column.
        """
        item = next(
            i
            for i in client.get(f"{AT}/offerings", headers=graph.P).json()["items"]
            if i["offering"]["id"] == str(graph.section.id)
        )
        assert item["offering"]["label"] == graph.label(graph.section)
        assert item["offering"]["course"]["code"]

    def test_items_sorted_by_course_code_then_section(self, client, graph) -> None:
        """Ordered in SQL by `OFFERING_ORDER`, never by the formatted label — "MATH1110-2"
        sorts before "MATH1110-10" as a string."""
        items = client.get(f"{AT}/offerings", headers=graph.P).json()["items"]
        keys = [
            (i["offering"]["course"]["code"], i["offering"]["section_code"] or "")
            for i in items
        ]
        assert keys == sorted(keys)


# ════════════════════════════════════════════════════════════════════════════
class TestRegisterRead:
    def test_missing_section_id_is_422(self, client, graph) -> None:
        r = client.get(AT, headers=graph.H)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="validation_error")

    def test_unknown_section_404(self, client, graph) -> None:
        r = client.get(f"{AT}?offering_id={uuid.uuid4()}", headers=graph.P)
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_teacher_not_on_the_section_404(self, client, graph) -> None:
        r = client.get(f"{AT}?offering_id={graph.other_section.id}", headers=graph.H)
        assert r.status_code == 404

    def test_unrecorded_students_have_null_status(self, client, graph) -> None:
        graph.student()
        graph.student()
        body = client.get(f"{AT}?offering_id={graph.section.id}&date=2025-10-15", headers=graph.H).json()
        assert len(body["entries"]) == 2
        assert all(e["status"] is None and e["recorded_at"] is None for e in body["entries"])

    def test_recorded_students_report_status_and_recorded_at(self, client, graph) -> None:
        s, e = graph.student()
        rec = graph.record(s, e, status="late", on=date(2025, 10, 15))
        body = client.get(f"{AT}?offering_id={graph.section.id}&date=2025-10-15", headers=graph.H).json()
        entry = next(x for x in body["entries"] if x["student"]["id"] == str(s.id))
        assert entry["status"] == "late"
        assert entry["recorded_at"] is not None
        assert entry["enrollment_id"] == str(e.id)

    def test_date_defaults_to_today(self, client, graph) -> None:
        body = client.get(f"{AT}?offering_id={graph.section.id}", headers=graph.H).json()
        assert body["date"] == _school_today().isoformat()

    def test_entries_sorted_by_student_name(self, client, graph) -> None:
        graph.student(name="Zoe Last")
        graph.student(name="Ana First")
        body = client.get(f"{AT}?offering_id={graph.section.id}", headers=graph.H).json()
        assert [e["student"]["full_name"] for e in body["entries"]] == ["Ana First", "Zoe Last"]

    def test_last_recorded_is_null_when_nothing_recorded(self, client, graph) -> None:
        graph.student()
        body = client.get(f"{AT}?offering_id={graph.section.id}&date=2025-10-15", headers=graph.H).json()
        assert body["last_recorded"] is None

    def test_last_recorded_by_is_a_plain_name_string(self, client, graph) -> None:
        """Binding: `by` is a string, not a {id, full_name} object."""
        s, _ = graph.student()
        client.put(
            AT,
            json={
                "offering_id": str(graph.section.id),
                "date": "2025-10-15",
                "entries": [{"student_id": str(s.id), "status": "present"}],
            },
            headers=graph.H,
        )
        body = client.get(f"{AT}?offering_id={graph.section.id}&date=2025-10-15", headers=graph.H).json()
        assert isinstance(body["last_recorded"]["by"], str)
        assert body["last_recorded"]["by"] == "Maria Reyes"
        assert set(body["last_recorded"].keys()) == {"by", "at"}

    def test_unenrolled_student_absent_from_entries(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        gone, gone_enr = graph.student()
        gone_enr.unenrolled_at = utcnow()
        db_session.flush()
        body = client.get(f"{AT}?offering_id={graph.section.id}", headers=graph.H).json()
        assert str(gone.id) not in {e["student"]["id"] for e in body["entries"]}

    def test_principal_can_read_with_can_record_false(self, client, graph) -> None:
        graph.student()
        body = client.get(f"{AT}?offering_id={graph.section.id}", headers=graph.P).json()
        assert body["can_record"] is False
        assert len(body["entries"]) == 1


# ════════════════════════════════════════════════════════════════════════════
class TestRegisterUpsert:
    def _body(self, graph, entries, on="2025-10-15"):
        return {"offering_id": str(graph.section.id), "date": on, "entries": entries}

    def test_happy_path_returns_count_and_summary(self, client, graph) -> None:
        s1, _ = graph.student()
        s2, _ = graph.student()
        body = client.put(
            AT,
            json=self._body(graph, [
                {"student_id": str(s1.id), "status": "present"},
                {"student_id": str(s2.id), "status": "absent"},
            ]),
            headers=graph.H,
        ).json()
        assert body["upserted"] == 2
        assert body["summary"]["present"] == 1
        assert body["summary"]["absent"] == 1
        assert body["summary"]["pct_present"] == 50.0

    def test_upsert_is_idempotent_and_updates_in_place(self, client, graph, db_session) -> None:
        s, _ = graph.student()
        payload = self._body(graph, [{"student_id": str(s.id), "status": "present"}])
        client.put(AT, json=payload, headers=graph.H)
        payload["entries"][0]["status"] = "late"
        client.put(AT, json=payload, headers=graph.H)

        count = db_session.scalar(
            select(func.count()).select_from(AttendanceRecord).where(
                AttendanceRecord.offering_id == graph.section.id,
                AttendanceRecord.student_id == s.id,
                AttendanceRecord.attendance_date == date(2025, 10, 15),
            )
        )
        row = db_session.scalar(
            select(AttendanceRecord).where(
                AttendanceRecord.offering_id == graph.section.id,
                AttendanceRecord.student_id == s.id,
            )
        )
        assert count == 1
        assert row.status.value == "late"

    def test_non_owning_teacher_404(self, client, graph) -> None:
        s, _ = graph.student()
        body = {
            "offering_id": str(graph.other_section.id),
            "date": "2025-10-15",
            "entries": [{"student_id": str(s.id), "status": "present"}],
        }
        assert client.put(AT, json=body, headers=graph.H).status_code == 404

    def test_future_date_rejected(self, client, graph) -> None:
        s, _ = graph.student()
        tomorrow = (_school_today() + timedelta(days=1)).isoformat()
        r = client.put(
            AT,
            json=self._body(graph, [{"student_id": str(s.id), "status": "present"}], on=tomorrow),
            headers=graph.H,
        )
        assert r.status_code == 422
        _assert_envelope(r.json(), code="future_date_not_allowed")

    def test_today_is_allowed_boundary(self, client, graph) -> None:
        s, _ = graph.student()
        r = client.put(
            AT,
            json=self._body(
                graph, [{"student_id": str(s.id), "status": "present"}], on=_school_today().isoformat()
            ),
            headers=graph.H,
        )
        assert r.status_code == 200

    def test_archived_year_409(self, client, graph, db_session) -> None:
        from app.core.timeutil import utcnow

        s, _ = graph.student()
        graph.year.archived_at = utcnow()
        db_session.flush()
        r = client.put(
            AT, json=self._body(graph, [{"student_id": str(s.id), "status": "present"}]), headers=graph.H
        )
        assert r.status_code == 409
        _assert_envelope(r.json(), code="year_archived")

    def test_archived_section_409(self, client, graph, db_session) -> None:
        s, _ = graph.student()
        graph.section.is_archived = True
        db_session.flush()
        r = client.put(
            AT, json=self._body(graph, [{"student_id": str(s.id), "status": "present"}]), headers=graph.H
        )
        assert r.status_code == 409

    def test_duplicate_student_422(self, client, graph) -> None:
        s, _ = graph.student()
        r = client.put(
            AT,
            json=self._body(graph, [
                {"student_id": str(s.id), "status": "present"},
                {"student_id": str(s.id), "status": "absent"},
            ]),
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="duplicate_entry")
        assert str(s.id) in err["fields"]["student_id"]

    def test_not_enrolled_lists_offenders(self, client, graph) -> None:
        ok, _ = graph.student()
        bad, _ = graph.student(enroll=False)
        r = client.put(
            AT,
            json=self._body(graph, [
                {"student_id": str(ok.id), "status": "present"},
                {"student_id": str(bad.id), "status": "present"},
            ]),
            headers=graph.H,
        )
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="student_not_enrolled")
        assert err["fields"]["student_id"] == [str(bad.id)]

    def test_all_or_nothing_bad_entry_writes_nothing(self, client, graph, db_session) -> None:
        good = [graph.student() for _ in range(3)]
        bad, _ = graph.student(enroll=False)
        entries = [{"student_id": str(s.id), "status": "present"} for s, _ in good]
        entries.append({"student_id": str(bad.id), "status": "present"})
        r = client.put(AT, json=self._body(graph, entries), headers=graph.H)
        assert r.status_code == 422
        written = db_session.scalar(
            select(func.count()).select_from(AttendanceRecord).where(
                AttendanceRecord.offering_id == graph.section.id
            )
        )
        assert written == 0

    def test_enrollment_semester_and_updated_by_are_stamped(self, client, graph, db_session) -> None:
        s, e = graph.student()
        client.put(
            AT, json=self._body(graph, [{"student_id": str(s.id), "status": "present"}]), headers=graph.H
        )
        row = db_session.scalar(
            select(AttendanceRecord).where(AttendanceRecord.student_id == s.id)
        )
        assert row.enrollment_id == e.id
        assert row.semester_id == graph.sem.id  # NOT NULL in the live schema
        assert row.updated_by == graph.teacher_user.id

    def test_summary_spans_the_whole_day_not_just_submitted_rows(self, client, graph) -> None:
        """A partial save must still report the day's true state."""
        s1, e1 = graph.student()
        s2, _ = graph.student()
        graph.record(s1, e1, status="absent", on=date(2025, 10, 15))
        body = client.put(
            AT, json=self._body(graph, [{"student_id": str(s2.id), "status": "present"}]), headers=graph.H
        ).json()
        assert body["upserted"] == 1
        assert body["summary"]["present"] == 1
        assert body["summary"]["absent"] == 1  # the pre-existing row still counts

    def test_unknown_field_rejected(self, client, graph) -> None:
        s, _ = graph.student()
        body = self._body(graph, [{"student_id": str(s.id), "status": "present", "note": "x"}])
        assert client.put(AT, json=body, headers=graph.H).status_code == 422

    def test_invalid_status_rejected(self, client, graph) -> None:
        s, _ = graph.student()
        body = self._body(graph, [{"student_id": str(s.id), "status": "tardy"}])
        assert client.put(AT, json=body, headers=graph.H).status_code == 422

    def test_empty_entries_is_a_no_op(self, client, graph) -> None:
        body = client.put(AT, json=self._body(graph, []), headers=graph.H).json()
        assert body["upserted"] == 0
        assert body["summary"]["pct_present"] == 0.0


# ════════════════════════════════════════════════════════════════════════════
class TestSummary:
    def test_shapes(self, client, graph) -> None:
        s, e = graph.student()
        graph.record(s, e, status="present", on=date(2025, 10, 15))
        body = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.H).json()
        assert set(body.keys()) == {"offering", "overall", "by_date", "by_student"}
        assert body["by_date"][0]["date"] == "2025-10-15"
        assert body["by_student"][0]["student"]["id"] == str(s.id)

    def test_late_counts_as_present(self, client, graph) -> None:
        """Binding formula from handlers/attendance.ts:119 — (present+late)/total."""
        s1, e1 = graph.student()
        s2, e2 = graph.student()
        s3, e3 = graph.student()
        graph.record(s1, e1, status="present", on=date(2025, 10, 15))
        graph.record(s2, e2, status="late", on=date(2025, 10, 15))
        graph.record(s3, e3, status="absent", on=date(2025, 10, 15))
        body = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.H).json()
        # 2 of 3 -> 66.7, NOT 33.3 (which a present-only formula would give).
        assert body["overall"]["pct_present"] == 66.7

    def test_pct_present_has_one_decimal(self, client, graph) -> None:
        for status in ("present", "present", "absent"):
            s, e = graph.student()
            graph.record(s, e, status=status, on=date(2025, 10, 15))
        body = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.H).json()
        assert body["overall"]["pct_present"] == 66.7

    def test_zero_records_yields_zero_not_a_division_error(self, client, graph) -> None:
        graph.student()
        body = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.H).json()
        assert body["overall"]["pct_present"] == 0.0
        assert body["overall"]["present"] == 0
        assert body["by_date"] == []

    def test_by_date_ascending(self, client, graph) -> None:
        s, e = graph.student()
        for day in (date(2025, 10, 17), date(2025, 10, 15), date(2025, 10, 16)):
            graph.record(s, e, status="present", on=day)
        body = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.H).json()
        dates = [d["date"] for d in body["by_date"]]
        assert dates == sorted(dates)

    def test_by_student_includes_zero_record_roster_members(self, client, graph) -> None:
        marked, e = graph.student(name="AAA Marked")
        graph.student(name="BBB Never Marked")
        graph.record(marked, e, status="present", on=date(2025, 10, 15))
        body = client.get(f"{AT}/summary?offering_id={graph.section.id}", headers=graph.H).json()
        rows = {r["student"]["full_name"]: r for r in body["by_student"]}
        assert rows["BBB Never Marked"]["present"] == 0
        assert rows["BBB Never Marked"]["pct_present"] == 0.0

    def test_date_window_narrows_the_result(self, client, graph) -> None:
        s, e = graph.student()
        graph.record(s, e, status="present", on=date(2025, 10, 1))
        graph.record(s, e, status="absent", on=date(2025, 11, 1))
        url = f"{AT}/summary?offering_id={graph.section.id}&from=2025-10-20&to=2025-11-30"
        body = client.get(url, headers=graph.H).json()
        assert body["overall"]["present"] == 0
        assert body["overall"]["absent"] == 1

    def test_non_owning_teacher_404(self, client, graph) -> None:
        r = client.get(f"{AT}/summary?offering_id={graph.other_section.id}", headers=graph.H)
        assert r.status_code == 404

    def test_missing_section_id_422(self, client, graph) -> None:
        assert client.get(f"{AT}/summary", headers=graph.H).status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestMyAttendance:
    def test_self_scoped_only(self, client, graph) -> None:
        me, my_enr = graph.student(with_login=True)
        other, other_enr = graph.student()
        graph.record(me, my_enr, status="present", on=date(2025, 10, 15))
        graph.record(other, other_enr, status="absent", on=date(2025, 10, 15))
        body = client.get(f"{AT}/me", headers=graph.student_headers(me)).json()
        assert body["summary"]["present"] == 1
        assert body["summary"]["absent"] == 0  # the other student never leaks

    def test_history_sorted_newest_first(self, client, graph) -> None:
        me, enr = graph.student(with_login=True)
        for day in (date(2025, 10, 15), date(2025, 10, 17), date(2025, 10, 16)):
            graph.record(me, enr, status="present", on=day)
        body = client.get(f"{AT}/me", headers=graph.student_headers(me)).json()
        dates = [h["date"] for h in body["history"]]
        assert dates == sorted(dates, reverse=True)

    def test_year_filter_narrows_to_that_years_semesters(self, client, graph, db_session) -> None:
        me, enr = graph.student(with_login=True)
        graph.record(me, enr, status="present", on=date(2025, 10, 15))
        other_year = AcademicYear(
            name=f"Other {graph.tag}", start_date=date(2024, 9, 1), end_date=date(2025, 6, 30),
            status=AcademicYearStatus.ARCHIVED,
        )
        db_session.add(other_year)
        db_session.flush()
        body = client.get(
            f"{AT}/me?academic_year_id={other_year.id}", headers=graph.student_headers(me)
        ).json()
        assert body["history"] == []
        assert body["summary"]["pct_present"] == 0.0

    def test_empty_history_yields_all_zero_summary(self, client, graph) -> None:
        me, _ = graph.student(with_login=True)
        body = client.get(f"{AT}/me", headers=graph.student_headers(me)).json()
        assert body["history"] == []
        assert body["summary"] == {
            "present": 0, "absent": 0, "late": 0, "excused": 0, "pct_present": 0.0
        }

    def test_student_without_a_profile_404(self, client, graph, make_user, auth_headers) -> None:
        user = make_user(role=Role.STUDENT)
        r = client.get(f"{AT}/me", headers=auth_headers(user_id=user.id, role=Role.STUDENT))
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_summary_counts_late_as_present(self, client, graph) -> None:
        me, enr = graph.student(with_login=True)
        graph.record(me, enr, status="late", on=date(2025, 10, 15))
        graph.record(me, enr, status="absent", on=date(2025, 10, 16))
        body = client.get(f"{AT}/me", headers=graph.student_headers(me)).json()
        assert body["summary"]["late"] == 1
        assert body["summary"]["pct_present"] == 50.0

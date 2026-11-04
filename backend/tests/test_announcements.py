"""Comprehensive pytest suite for Module 7.8 — ANNOUNCEMENTS (api-spec §9, FR-ANN-*).

Scope: the targeted feed, unread count, compose picker, detail, create/edit/delete
and idempotent mark-read.

Two things here are unlike every other module and get explicit tests:

  * **An archived academic year does NOT block writes.** An announcement is a
    communication, not academic history, so there is deliberately no 409
    `year_archived` guard — the opposite of Grades, Attendance and Assessments.
  * **Reads are not role-gated.** Every role may call the feed; what comes back is
    decided purely by audience targeting.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.core.timeutil import utcnow
from app.modules.announcements.models import Announcement, AnnouncementRead
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

AN = "/api/v1/announcements"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, body
    assert body["error"]["code"] == code, body["error"]
    return body["error"]


class _Graph:
    """One section the teacher owns + one they don't, a student enrolled in the
    first, and a user per role."""

    def __init__(self, db_session, make_user, auth_headers, archive_seeded_active_year):
        archive_seeded_active_year()
        tag = uuid.uuid4().hex[:6]
        self.tag = tag
        self._db = db_session
        self._make_user = make_user
        self._auth_headers = auth_headers

        self.year = AcademicYear(
            name=f"AnnYear {tag}", start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
            status=AcademicYearStatus.ACTIVE,
        )
        db_session.add(self.year)
        db_session.flush()
        self.sem = Semester(
            academic_year_id=self.year.id, name="Semester 1", sequence=1,
            start_date=date(2025, 9, 1), end_date=date(2026, 1, 31), is_active=True,
        )
        db_session.add(self.sem)
        # D31: the catalog course comes FIRST now, because an offering cannot exist
        # without one — `course_offerings.course_id` is NOT NULL. Under the old model a
        # `classes` row stood alone and a subject was attached to it afterwards.
        self.subject = Course(name=f"Subj {tag}", code=tag.upper())
        self.other_subject = Course(name=f"Other {tag}", code=f"O{tag.upper()[:6]}")
        db_session.add_all([self.subject, self.other_subject])
        db_session.flush()

        # Two offerings in the same term. They teach DIFFERENT courses rather than the
        # same course in two sections, because `uq_course_offering_active` is
        # (course_id, semester_id, section_code) and the old fixture's two rows only
        # differed by a homeroom name that no longer exists.
        self.section = CourseOffering(
            course_id=self.subject.id, semester_id=self.sem.id, section_code="A",
        )
        self.other_section = CourseOffering(
            course_id=self.other_subject.id, semester_id=self.sem.id, section_code="B",
        )
        db_session.add_all([self.section, self.other_section])
        db_session.flush()

        # The offering IS the gradebook unit — `section` and `cs` were two rows before
        # D31 and are one now. Aliased so the assertions below keep reading naturally.
        self.cs = self.section
        self.other_cs = self.other_section

        self.principal_user = make_user(role=Role.PRINCIPAL, full_name="The Principal")
        self.secretary_user = make_user(role=Role.SECRETARY, full_name="Front Office")
        self.teacher_user = make_user(role=Role.TEACHER, full_name="Maria Reyes")
        self.teacher = TeacherProfile(
            user_id=self.teacher_user.id, staff_number=f"T-{tag}",
            full_name="Maria Reyes", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.teacher)
        db_session.flush()
        db_session.add(ClassTeacher(offering_id=self.cs.id, teacher_id=self.teacher.id, is_lead=True))

        # A teacher who owns the OTHER section only.
        self.other_teacher_user = make_user(role=Role.TEACHER, full_name="Other Teacher")
        self.other_teacher = TeacherProfile(
            user_id=self.other_teacher_user.id, staff_number=f"O-{tag}",
            full_name="Other Teacher", status=TeacherStatus.ACTIVE,
        )
        db_session.add(self.other_teacher)
        db_session.flush()
        db_session.add(
            ClassTeacher(offering_id=self.other_cs.id, teacher_id=self.other_teacher.id)
        )

        # A student enrolled in `section`.
        self.student_user = make_user(role=Role.STUDENT, full_name="Ana Lopez")
        self.student = StudentProfile(
            user_id=self.student_user.id, student_number=f"S-{tag}", **split_name("Ana Lopez"),
            date_of_birth=date(2012, 1, 1), enrollment_date=date(2025, 9, 1), status="Active",
        )
        db_session.add(self.student)
        db_session.flush()
        db_session.add(ClassEnrollment(
            offering_id=self.section.id, student_id=self.student.id, semester_id=self.sem.id
        ))
        db_session.flush()

        self.P = auth_headers(user_id=self.principal_user.id, role=Role.PRINCIPAL)
        self.S = auth_headers(user_id=self.secretary_user.id, role=Role.SECRETARY)
        self.T = auth_headers(user_id=self.teacher_user.id, role=Role.TEACHER)
        self.T2 = auth_headers(user_id=self.other_teacher_user.id, role=Role.TEACHER)
        self.U = auth_headers(user_id=self.student_user.id, role=Role.STUDENT)

    def announcement(
        self, *, audience="all", offering_id=None, author=None, title=None, body=None,
        published_at=None, expires_at=None, deleted=False,
    ) -> Announcement:
        row = Announcement(
            author_id=(author or self.principal_user).id,
            title=title or f"Notice {uuid.uuid4().hex[:5]}",
            body=body or "Body text for the announcement.",
            audience=audience,
            offering_id=offering_id,
            published_at=published_at or (utcnow() - timedelta(hours=1)),
            expires_at=expires_at,
            deleted_at=utcnow() if deleted else None,
        )
        self._db.add(row)
        self._db.flush()
        return row

    def mark_read(self, announcement, user) -> None:
        self._db.add(AnnouncementRead(announcement_id=announcement.id, user_id=user.id))
        self._db.flush()

    def payload(self, **overrides) -> dict:
        body = {
            "title": f"New Notice {uuid.uuid4().hex[:5]}",
            "body": "Something everyone should know.",
            "audience": "all",
            "offering_id": None,
            "expires_at": None,
        }
        body.update(overrides)
        return body


@pytest.fixture
def graph(db_session, make_user, auth_headers, archive_seeded_active_year) -> _Graph:
    return _Graph(db_session, make_user, auth_headers, archive_seeded_active_year)


def _feed_ids(client, headers, query="") -> set[str]:
    body = client.get(f"{AN}{query}", headers=headers).json()
    return {i["id"] for i in body["items"]}


# ════════════════════════════════════════════════════════════════════════════
class TestAuthGate:
    def test_feed_requires_auth(self, client) -> None:
        assert client.get(AN).status_code == 401

    def test_unread_count_requires_auth(self, client) -> None:
        assert client.get(f"{AN}/unread-count").status_code == 401

    def test_target_offerings_requires_auth(self, client) -> None:
        assert client.get(f"{AN}/target-offerings").status_code == 401

    def test_detail_requires_auth(self, client) -> None:
        assert client.get(f"{AN}/{uuid.uuid4()}").status_code == 401

    def test_create_requires_auth(self, client) -> None:
        assert client.post(AN, json={"title": "x", "body": "y"}).status_code == 401

    def test_mark_read_requires_auth(self, client) -> None:
        assert client.post(f"{AN}/{uuid.uuid4()}/read").status_code == 401

    def test_student_cannot_create(self, client, graph) -> None:
        r = client.post(AN, json=graph.payload(), headers=graph.U)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_every_role_can_read_the_feed(self, client, graph) -> None:
        graph.announcement(audience="all")
        for headers in (graph.P, graph.S, graph.T, graph.U):
            assert client.get(AN, headers=headers).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestRouteOrdering:
    def test_unread_count_is_not_swallowed_by_the_uuid_param(self, client, graph) -> None:
        """If `/{announcement_id}` were declared first this would 422."""
        r = client.get(f"{AN}/unread-count", headers=graph.P)
        assert r.status_code == 200
        assert "unread_count" in r.json()

    def test_target_offerings_is_not_swallowed_by_the_uuid_param(self, client, graph) -> None:
        r = client.get(f"{AN}/target-offerings", headers=graph.P)
        assert r.status_code == 200
        assert "items" in r.json()


# ════════════════════════════════════════════════════════════════════════════
class TestAudienceTargeting:
    def test_all_reaches_every_role(self, client, graph) -> None:
        row = graph.announcement(audience="all")
        for headers in (graph.P, graph.S, graph.T, graph.U):
            assert str(row.id) in _feed_ids(client, headers)

    def test_students_audience_reaches_students_not_teachers(self, client, graph) -> None:
        row = graph.announcement(audience="students")
        assert str(row.id) in _feed_ids(client, graph.U)
        assert str(row.id) not in _feed_ids(client, graph.T)

    def test_teachers_audience_reaches_teachers_not_students(self, client, graph) -> None:
        row = graph.announcement(audience="teachers")
        assert str(row.id) in _feed_ids(client, graph.T)
        assert str(row.id) not in _feed_ids(client, graph.U)

    def test_admin_sees_a_role_broadcast_they_posted(self, client, graph) -> None:
        """An author always sees their own, whatever the audience — so a principal
        who broadcast to students still finds it in their own feed."""
        row = graph.announcement(audience="students", author=graph.principal_user)
        assert str(row.id) in _feed_ids(client, graph.P)

    def test_admin_does_not_see_a_teacher_audience_notice_from_a_teacher(self, client, graph) -> None:
        """The two rules compose: teacher-authored is invisible to admins, and
        `teachers` audience does not name an admin either."""
        row = graph.announcement(audience="teachers", author=graph.teacher_user)
        assert str(row.id) in _feed_ids(client, graph.T)
        assert str(row.id) not in _feed_ids(client, graph.P)
        assert str(row.id) not in _feed_ids(client, graph.S)

    def test_class_audience_reaches_the_enrolled_student(self, client, graph) -> None:
        row = graph.announcement(audience="class", offering_id=graph.section.id)
        assert str(row.id) in _feed_ids(client, graph.U)

    def test_class_audience_reaches_the_owning_teacher(self, client, graph) -> None:
        row = graph.announcement(audience="class", offering_id=graph.section.id)
        assert str(row.id) in _feed_ids(client, graph.T)

    def test_class_audience_misses_a_teacher_of_another_section(self, client, graph) -> None:
        row = graph.announcement(audience="class", offering_id=graph.section.id)
        assert str(row.id) not in _feed_ids(client, graph.T2)

    def test_admins_do_not_see_a_teacher_authored_class_notice(self, client, graph) -> None:
        """Stakeholder rule: a teacher's class notice is between them and their class.

        Because a teacher can only ever create a `class` announcement, "admins don't
        see teacher-authored notices" is the whole of that rule.
        """
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.teacher_user
        )
        assert str(row.id) not in _feed_ids(client, graph.P)
        assert str(row.id) not in _feed_ids(client, graph.S)

    def test_admins_see_an_admin_authored_class_notice(self, client, graph) -> None:
        """P/S are equivalent — either sees the other's class notices."""
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.secretary_user
        )
        assert str(row.id) in _feed_ids(client, graph.P)
        assert str(row.id) in _feed_ids(client, graph.S)

    def test_admin_sees_their_own_class_notice(self, client, graph) -> None:
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.principal_user
        )
        assert str(row.id) in _feed_ids(client, graph.P)

    def test_admin_authored_class_notice_still_reaches_the_class(self, client, graph) -> None:
        """The class it names must receive it regardless of who wrote it."""
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.principal_user
        )
        assert str(row.id) in _feed_ids(client, graph.U)
        assert str(row.id) in _feed_ids(client, graph.T)

    def test_admins_see_each_others_student_broadcasts(self, client, graph) -> None:
        row = graph.announcement(audience="students", author=graph.secretary_user)
        assert str(row.id) in _feed_ids(client, graph.P)

    def test_unenrolled_student_loses_the_class_notice(self, client, graph, db_session) -> None:
        row = graph.announcement(audience="class", offering_id=graph.section.id)
        enr = db_session.scalar(
            select(ClassEnrollment).where(ClassEnrollment.student_id == graph.student.id)
        )
        enr.unenrolled_at = utcnow()
        db_session.flush()
        assert str(row.id) not in _feed_ids(client, graph.U)

    def test_audience_query_filter(self, client, graph) -> None:
        broad = graph.announcement(audience="all")
        student_only = graph.announcement(audience="students")
        found = _feed_ids(client, graph.U, "?audience=students")
        assert str(student_only.id) in found
        assert str(broad.id) not in found


# ════════════════════════════════════════════════════════════════════════════
class TestFeedVisibility:
    def test_soft_deleted_is_excluded(self, client, graph) -> None:
        row = graph.announcement(deleted=True)
        assert str(row.id) not in _feed_ids(client, graph.P)

    def test_expired_is_excluded(self, client, graph) -> None:
        row = graph.announcement(
            published_at=utcnow() - timedelta(days=5), expires_at=utcnow() - timedelta(days=1)
        )
        assert str(row.id) not in _feed_ids(client, graph.P)

    def test_future_expiry_is_included(self, client, graph) -> None:
        row = graph.announcement(expires_at=utcnow() + timedelta(days=3))
        assert str(row.id) in _feed_ids(client, graph.P)

    def test_future_published_at_is_hidden(self, client, graph) -> None:
        """Documented divergence: the mock omits this filter. The compose form never
        sets `published_at`, so behaviour is identical for real data — but a notice
        scheduled for later must not leak early."""
        row = graph.announcement(published_at=utcnow() + timedelta(days=2))
        assert str(row.id) not in _feed_ids(client, graph.P)

    def test_newest_first(self, client, graph) -> None:
        old = graph.announcement(published_at=utcnow() - timedelta(days=10))
        new = graph.announcement(published_at=utcnow() - timedelta(minutes=5))
        ids = [i["id"] for i in client.get(AN, headers=graph.P).json()["items"]]
        assert ids.index(str(new.id)) < ids.index(str(old.id))

    def test_page_envelope_shape(self, client, graph) -> None:
        graph.announcement()
        body = client.get(AN, headers=graph.P).json()
        assert set(body.keys()) == {"items", "total", "page", "page_size", "total_pages"}

    def test_pagination_works(self, client, graph) -> None:
        for _ in range(3):
            graph.announcement(audience="teachers")
        body = client.get(f"{AN}?page=1&page_size=2&audience=teachers", headers=graph.T).json()
        assert len(body["items"]) == 2
        assert body["total"] >= 3
        assert body["total_pages"] >= 2


# ════════════════════════════════════════════════════════════════════════════
class TestFeedItemShape:
    def test_list_item_keys(self, client, graph) -> None:
        graph.announcement(audience="class", offering_id=graph.section.id)
        item = client.get(AN, headers=graph.U).json()["items"][0]
        assert set(item.keys()) == {
            "id", "title", "body_preview", "audience", "offering",
            "author", "published_at", "expires_at", "is_read",
        }

    def test_offering_ref_shape_and_key_name(self, client, graph) -> None:
        """The key is `offering`, not `class`, `class_ref` or `class_id` (D31).

        The payload changed with it: a homeroom sent `name` + `grade_level`; an offering
        sends the derived `label` ("MATH1110-01") and the course title. Neither of the old
        fields has a tertiary meaning.
        """
        graph.announcement(audience="class", offering_id=graph.section.id)
        item = client.get(AN, headers=graph.U).json()["items"][0]
        assert item["offering"] == {
            "id": str(graph.section.id),
            "label": f"{graph.subject.code}-A",
            "course_name": graph.subject.name,
        }

    def test_offering_is_null_for_a_broadcast(self, client, graph) -> None:
        graph.announcement(audience="all")
        item = next(i for i in client.get(AN, headers=graph.P).json()["items"]
                    if i["audience"] == "all")
        assert item["offering"] is None

    def test_author_carries_role(self, client, graph) -> None:
        graph.announcement(author=graph.principal_user)
        item = client.get(AN, headers=graph.P).json()["items"][0]
        assert item["author"] == {
            "id": str(graph.principal_user.id),
            "full_name": "The Principal",
            "role": "principal",
        }

    def test_body_preview_clips_long_bodies_with_an_ellipsis(self, client, graph) -> None:
        graph.announcement(body="x" * 300)
        item = client.get(AN, headers=graph.P).json()["items"][0]
        assert len(item["body_preview"]) == 141  # 140 chars + the ellipsis
        assert item["body_preview"].endswith("…")

    def test_body_preview_collapses_whitespace(self, client, graph) -> None:
        graph.announcement(body="Line one.\n\n   Line   two.")
        item = client.get(AN, headers=graph.P).json()["items"][0]
        assert item["body_preview"] == "Line one. Line two."

    def test_short_body_is_not_clipped(self, client, graph) -> None:
        graph.announcement(body="Short and sweet.")
        item = client.get(AN, headers=graph.P).json()["items"][0]
        assert item["body_preview"] == "Short and sweet."
        assert "…" not in item["body_preview"]

    def test_feed_carries_no_full_body(self, client, graph) -> None:
        graph.announcement(body="y" * 300)
        item = client.get(AN, headers=graph.P).json()["items"][0]
        assert "body" not in item


# ════════════════════════════════════════════════════════════════════════════
class TestUnreadCount:
    def test_counts_only_targeted_unread(self, client, graph) -> None:
        """Measured as a DELTA: the shared DB is seeded with announcements of its
        own, so an absolute count would depend on seed data."""
        before = client.get(f"{AN}/unread-count", headers=graph.U).json()["unread_count"]
        graph.announcement(audience="students")
        graph.announcement(audience="teachers")  # not for the student
        after = client.get(f"{AN}/unread-count", headers=graph.U).json()["unread_count"]
        assert after - before == 1

    def test_marking_read_decrements(self, client, graph) -> None:
        row = graph.announcement(audience="students")
        before = client.get(f"{AN}/unread-count", headers=graph.U).json()["unread_count"]
        client.post(f"{AN}/{row.id}/read", headers=graph.U)
        after = client.get(f"{AN}/unread-count", headers=graph.U).json()["unread_count"]
        assert after == before - 1

    def test_expired_does_not_count(self, client, graph) -> None:
        before = client.get(f"{AN}/unread-count", headers=graph.U).json()["unread_count"]
        graph.announcement(
            audience="students",
            published_at=utcnow() - timedelta(days=5),
            expires_at=utcnow() - timedelta(days=1),
        )
        after = client.get(f"{AN}/unread-count", headers=graph.U).json()["unread_count"]
        assert after == before

    def test_is_read_reflects_the_ledger(self, client, graph) -> None:
        row = graph.announcement(audience="students")
        graph.mark_read(row, graph.student_user)
        item = next(i for i in client.get(AN, headers=graph.U).json()["items"]
                    if i["id"] == str(row.id))
        assert item["is_read"] is True

    def test_read_state_is_per_user(self, client, graph) -> None:
        row = graph.announcement(audience="all")
        graph.mark_read(row, graph.student_user)
        student_item = next(i for i in client.get(AN, headers=graph.U).json()["items"]
                            if i["id"] == str(row.id))
        teacher_item = next(i for i in client.get(AN, headers=graph.T).json()["items"]
                            if i["id"] == str(row.id))
        assert student_item["is_read"] is True
        assert teacher_item["is_read"] is False

    def test_unread_only_filter(self, client, graph) -> None:
        read = graph.announcement(audience="students")
        unread = graph.announcement(audience="students")
        graph.mark_read(read, graph.student_user)
        found = _feed_ids(client, graph.U, "?unread_only=true")
        assert str(unread.id) in found
        assert str(read.id) not in found


# ════════════════════════════════════════════════════════════════════════════
class TestTargetClasses:
    def test_principal_sees_all_live_sections(self, client, graph) -> None:
        ids = {i["id"] for i in client.get(f"{AN}/target-offerings", headers=graph.P).json()["items"]}
        assert {str(graph.section.id), str(graph.other_section.id)} <= ids

    def test_secretary_sees_all_live_sections(self, client, graph) -> None:
        ids = {i["id"] for i in client.get(f"{AN}/target-offerings", headers=graph.S).json()["items"]}
        assert str(graph.section.id) in ids

    def test_teacher_sees_only_owned_sections(self, client, graph) -> None:
        ids = {i["id"] for i in client.get(f"{AN}/target-offerings", headers=graph.T).json()["items"]}
        assert ids == {str(graph.section.id)}

    def test_archived_sections_excluded(self, client, graph, db_session) -> None:
        graph.section.is_archived = True
        db_session.flush()
        ids = {i["id"] for i in client.get(f"{AN}/target-offerings", headers=graph.P).json()["items"]}
        assert str(graph.section.id) not in ids

    def test_student_gets_an_empty_list_not_a_403(self, client, graph) -> None:
        """It's a picker source and the compose UI is already hidden from students."""
        r = client.get(f"{AN}/target-offerings", headers=graph.U)
        assert r.status_code == 200
        assert r.json()["items"] == []

    def test_item_shape(self, client, graph) -> None:
        item = client.get(f"{AN}/target-offerings", headers=graph.T).json()["items"][0]
        assert set(item.keys()) == {"id", "label", "course_name"}


# ════════════════════════════════════════════════════════════════════════════
class TestDetail:
    def test_targeted_read_returns_the_full_body(self, client, graph) -> None:
        row = graph.announcement(audience="students", body="The full body text.")
        body = client.get(f"{AN}/{row.id}", headers=graph.U).json()
        assert body["body"] == "The full body text."
        assert "body_preview" not in body

    def test_untargeted_read_404(self, client, graph) -> None:
        row = graph.announcement(audience="teachers")
        r = client.get(f"{AN}/{row.id}", headers=graph.U)
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_unknown_id_404(self, client, graph) -> None:
        assert client.get(f"{AN}/{uuid.uuid4()}", headers=graph.P).status_code == 404

    def test_soft_deleted_404(self, client, graph) -> None:
        row = graph.announcement(deleted=True)
        assert client.get(f"{AN}/{row.id}", headers=graph.P).status_code == 404

    def test_author_can_always_read_their_own(self, client, graph) -> None:
        """A teacher's own class notice stays readable even outside the audience."""
        row = graph.announcement(
            audience="class", offering_id=graph.other_section.id, author=graph.teacher_user
        )
        assert client.get(f"{AN}/{row.id}", headers=graph.T).status_code == 200

    def test_author_can_read_their_own_expired_notice(self, client, graph) -> None:
        """Relaxation vs the feed, so an author can still open and edit it."""
        row = graph.announcement(
            author=graph.principal_user,
            published_at=utcnow() - timedelta(days=5),
            expires_at=utcnow() - timedelta(days=1),
        )
        assert client.get(f"{AN}/{row.id}", headers=graph.P).status_code == 200

    def test_principal_cannot_read_a_teacher_notice_by_id(self, client, graph) -> None:
        """No by-id backdoor: the visibility rule has to hold on detail too."""
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.teacher_user
        )
        r = client.get(f"{AN}/{row.id}", headers=graph.P)
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_secretary_cannot_read_a_teacher_notice_by_id(self, client, graph) -> None:
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.teacher_user
        )
        assert client.get(f"{AN}/{row.id}", headers=graph.S).status_code == 404

    def test_principal_can_read_a_secretary_class_notice(self, client, graph) -> None:
        row = graph.announcement(
            audience="class", offering_id=graph.section.id, author=graph.secretary_user
        )
        assert client.get(f"{AN}/{row.id}", headers=graph.P).status_code == 200


# ════════════════════════════════════════════════════════════════════════════
class TestCreate:
    def test_principal_can_broadcast(self, client, graph) -> None:
        r = client.post(AN, json=graph.payload(audience="all"), headers=graph.P)
        assert r.status_code == 201
        assert r.json()["author"]["id"] == str(graph.principal_user.id)

    def test_secretary_can_broadcast(self, client, graph) -> None:
        assert client.post(AN, json=graph.payload(audience="all"), headers=graph.S).status_code == 201

    def test_teacher_cannot_broadcast(self, client, graph) -> None:
        r = client.post(AN, json=graph.payload(audience="all"), headers=graph.T)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="teacher_cannot_broadcast")

    def test_teacher_cannot_target_students_audience(self, client, graph) -> None:
        r = client.post(AN, json=graph.payload(audience="students"), headers=graph.T)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="teacher_cannot_broadcast")

    def test_teacher_can_post_to_an_owned_section(self, client, graph) -> None:
        r = client.post(
            AN,
            json=graph.payload(audience="class", offering_id=str(graph.section.id)),
            headers=graph.T,
        )
        assert r.status_code == 201
        assert r.json()["offering"]["id"] == str(graph.section.id)

    def test_teacher_cannot_post_to_an_unowned_section(self, client, graph) -> None:
        r = client.post(
            AN,
            json=graph.payload(audience="class", offering_id=str(graph.other_section.id)),
            headers=graph.T,
        )
        assert r.status_code == 403
        _assert_envelope(r.json(), code="teacher_cannot_broadcast")

    def test_class_audience_without_class_id_422(self, client, graph) -> None:
        r = client.post(AN, json=graph.payload(audience="class", offering_id=None), headers=graph.P)
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="class_audience_requires_offering_id")
        assert "offering_id" in err["fields"]

    def test_unknown_class_id_422(self, client, graph) -> None:
        r = client.post(
            AN, json=graph.payload(audience="class", offering_id=str(uuid.uuid4())), headers=graph.P
        )
        assert r.status_code == 422
        _assert_envelope(r.json(), code="class_audience_requires_offering_id")

    def test_non_class_audience_clears_class_id(self, client, graph) -> None:
        body = client.post(
            AN,
            json=graph.payload(audience="all", offering_id=str(graph.section.id)),
            headers=graph.P,
        ).json()
        assert body["offering"] is None

    def test_empty_title_rejected(self, client, graph) -> None:
        assert client.post(AN, json=graph.payload(title=""), headers=graph.P).status_code == 422

    def test_whitespace_only_title_rejected(self, client, graph) -> None:
        """Regression: `min_length=1` alone accepts "   ", which then strips to "".
        Titles must strip BEFORE length validation."""
        r = client.post(AN, json=graph.payload(title="   "), headers=graph.P)
        assert r.status_code == 422
        assert "title" in r.json()["error"]["fields"]

    def test_empty_body_rejected(self, client, graph) -> None:
        assert client.post(AN, json=graph.payload(body=""), headers=graph.P).status_code == 422

    def test_whitespace_only_body_rejected(self, client, graph) -> None:
        r = client.post(AN, json=graph.payload(body="  \n  "), headers=graph.P)
        assert r.status_code == 422
        assert "body" in r.json()["error"]["fields"]

    def test_expiry_before_publish_rejected(self, client, graph) -> None:
        past = (utcnow() - timedelta(days=10)).isoformat()
        r = client.post(AN, json=graph.payload(expires_at=past), headers=graph.P)
        assert r.status_code == 422
        err = _assert_envelope(r.json(), code="validation_error")
        assert "expires_at" in err["fields"]

    def test_future_expiry_accepted(self, client, graph) -> None:
        future = (utcnow() + timedelta(days=10)).isoformat()
        assert client.post(AN, json=graph.payload(expires_at=future), headers=graph.P).status_code == 201

    def test_unknown_field_rejected(self, client, graph) -> None:
        assert client.post(AN, json=graph.payload(nope=1), headers=graph.P).status_code == 422

    def test_author_has_implicitly_read_their_own(self, client, graph) -> None:
        """A notice you wrote must not light up your own bell."""
        before = client.get(f"{AN}/unread-count", headers=graph.P).json()["unread_count"]
        body = client.post(AN, json=graph.payload(audience="all"), headers=graph.P).json()
        after = client.get(f"{AN}/unread-count", headers=graph.P).json()["unread_count"]
        assert body["is_read"] is True
        assert after == before

    def test_archived_year_does_NOT_block_creation(self, client, graph, db_session) -> None:
        """The one module where an archived year is not a 409.

        An announcement is a communication, not academic history — a principal may
        still post or correct a notice after the year is archived.
        """
        graph.year.archived_at = utcnow()
        graph.year.status = AcademicYearStatus.ARCHIVED
        graph.section.is_archived = True
        db_session.flush()
        r = client.post(
            AN,
            json=graph.payload(audience="class", offering_id=str(graph.section.id)),
            headers=graph.P,
        )
        assert r.status_code == 201

    def test_title_and_body_are_trimmed(self, client, graph) -> None:
        body = client.post(
            AN, json=graph.payload(title="  Spaced  ", body="  Padded body  "), headers=graph.P
        ).json()
        assert body["title"] == "Spaced"
        assert body["body"] == "Padded body"


# ════════════════════════════════════════════════════════════════════════════
class TestUpdate:
    def test_author_can_edit(self, client, graph) -> None:
        row = graph.announcement(author=graph.secretary_user)
        body = client.patch(f"{AN}/{row.id}", json={"title": "Renamed"}, headers=graph.S).json()
        assert body["title"] == "Renamed"

    def test_admins_can_edit_each_others(self, client, graph) -> None:
        """P/S are equivalent, so either may correct the other's notice."""
        row = graph.announcement(author=graph.principal_user)
        r = client.patch(f"{AN}/{row.id}", json={"title": "Corrected"}, headers=graph.S)
        assert r.status_code == 200
        assert r.json()["title"] == "Corrected"

    def test_principal_cannot_edit_a_teacher_notice(self, client, graph) -> None:
        """Follows from admins not seeing teacher notices — editing an invisible
        announcement would be incoherent. NOTE the operational consequence: there is
        no admin override for a teacher's post; only that teacher can withdraw it."""
        row = graph.announcement(
            author=graph.teacher_user, audience="class", offering_id=graph.section.id
        )
        r = client.patch(f"{AN}/{row.id}", json={"title": "Moderated"}, headers=graph.P)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="forbidden")

    def test_other_teacher_cannot_edit(self, client, graph) -> None:
        row = graph.announcement(author=graph.teacher_user, audience="class", offering_id=graph.section.id)
        assert client.patch(f"{AN}/{row.id}", json={"title": "Nope"}, headers=graph.T2).status_code == 403

    def test_unknown_id_404(self, client, graph) -> None:
        assert client.patch(f"{AN}/{uuid.uuid4()}", json={"title": "x"}, headers=graph.P).status_code == 404

    def test_teacher_cannot_escalate_to_a_broadcast_by_editing(self, client, graph) -> None:
        """Targeting is re-checked against the MERGED audience."""
        row = graph.announcement(
            author=graph.teacher_user, audience="class", offering_id=graph.section.id
        )
        r = client.patch(f"{AN}/{row.id}", json={"audience": "all"}, headers=graph.T)
        assert r.status_code == 403
        _assert_envelope(r.json(), code="teacher_cannot_broadcast")

    def test_teacher_cannot_move_a_notice_to_an_unowned_section(self, client, graph) -> None:
        row = graph.announcement(
            author=graph.teacher_user, audience="class", offering_id=graph.section.id
        )
        r = client.patch(
            f"{AN}/{row.id}",
            json={"audience": "class", "offering_id": str(graph.other_section.id)},
            headers=graph.T,
        )
        assert r.status_code == 403

    def test_switching_to_a_broadcast_clears_the_offering(self, client, graph) -> None:
        row = graph.announcement(audience="class", offering_id=graph.section.id)
        body = client.patch(f"{AN}/{row.id}", json={"audience": "all"}, headers=graph.P).json()
        assert body["audience"] == "all"
        assert body["offering"] is None

    def test_switching_to_class_without_a_class_id_422(self, client, graph) -> None:
        row = graph.announcement(audience="all")
        r = client.patch(f"{AN}/{row.id}", json={"audience": "class"}, headers=graph.P)
        assert r.status_code == 422
        _assert_envelope(r.json(), code="class_audience_requires_offering_id")

    def test_expiry_can_be_cleared(self, client, graph) -> None:
        row = graph.announcement(expires_at=utcnow() + timedelta(days=5))
        body = client.patch(f"{AN}/{row.id}", json={"expires_at": None}, headers=graph.P).json()
        assert body["expires_at"] is None

    def test_expiry_validated_against_the_stored_publish_date(self, client, graph) -> None:
        row = graph.announcement(published_at=utcnow() - timedelta(days=1))
        stale = (utcnow() - timedelta(days=10)).isoformat()
        r = client.patch(f"{AN}/{row.id}", json={"expires_at": stale}, headers=graph.P)
        assert r.status_code == 422
        assert "expires_at" in r.json()["error"]["fields"]

    def test_empty_body_is_a_no_op(self, client, graph) -> None:
        row = graph.announcement(title="Untouched")
        body = client.patch(f"{AN}/{row.id}", json={}, headers=graph.P).json()
        assert body["title"] == "Untouched"

    def test_whitespace_only_title_rejected(self, client, graph) -> None:
        """The PATCH path had the same strip-after-validate bug as POST."""
        row = graph.announcement()
        r = client.patch(f"{AN}/{row.id}", json={"title": "  "}, headers=graph.P)
        assert r.status_code == 422
        assert "title" in r.json()["error"]["fields"]

    def test_whitespace_only_body_rejected(self, client, graph) -> None:
        row = graph.announcement()
        assert client.patch(f"{AN}/{row.id}", json={"body": " "}, headers=graph.P).status_code == 422

    def test_unknown_field_rejected(self, client, graph) -> None:
        row = graph.announcement()
        assert client.patch(f"{AN}/{row.id}", json={"nope": 1}, headers=graph.P).status_code == 422


# ════════════════════════════════════════════════════════════════════════════
class TestDelete:
    def test_author_can_delete(self, client, graph, db_session) -> None:
        row = graph.announcement(author=graph.secretary_user)
        assert client.delete(f"{AN}/{row.id}", headers=graph.S).status_code == 204
        db_session.expire_all()
        stored = db_session.scalar(select(Announcement).where(Announcement.id == row.id))
        # Soft delete — the row survives for the audit trail.
        assert stored is not None
        assert stored.deleted_at is not None

    def test_admins_can_delete_each_others(self, client, graph) -> None:
        row = graph.announcement(author=graph.principal_user)
        assert client.delete(f"{AN}/{row.id}", headers=graph.S).status_code == 204

    def test_principal_cannot_delete_a_teacher_notice(self, client, graph) -> None:
        row = graph.announcement(
            author=graph.teacher_user, audience="class", offering_id=graph.section.id
        )
        assert client.delete(f"{AN}/{row.id}", headers=graph.P).status_code == 403

    def test_teacher_can_withdraw_their_own(self, client, graph) -> None:
        """The only route to removing a teacher's post, given no admin override."""
        row = graph.announcement(
            author=graph.teacher_user, audience="class", offering_id=graph.section.id
        )
        assert client.delete(f"{AN}/{row.id}", headers=graph.T).status_code == 204

    def test_deleted_leaves_the_feed(self, client, graph) -> None:
        row = graph.announcement(audience="all")
        client.delete(f"{AN}/{row.id}", headers=graph.P)
        assert str(row.id) not in _feed_ids(client, graph.P)

    def test_unknown_id_404(self, client, graph) -> None:
        assert client.delete(f"{AN}/{uuid.uuid4()}", headers=graph.P).status_code == 404

    def test_second_delete_404s(self, client, graph) -> None:
        row = graph.announcement()
        assert client.delete(f"{AN}/{row.id}", headers=graph.P).status_code == 204
        assert client.delete(f"{AN}/{row.id}", headers=graph.P).status_code == 404


# ════════════════════════════════════════════════════════════════════════════
class TestMarkRead:
    def test_marks_read_and_returns_204(self, client, graph, db_session) -> None:
        row = graph.announcement(audience="students")
        assert client.post(f"{AN}/{row.id}/read", headers=graph.U).status_code == 204
        ledger = db_session.scalar(
            select(AnnouncementRead).where(
                AnnouncementRead.announcement_id == row.id,
                AnnouncementRead.user_id == graph.student_user.id,
            )
        )
        assert ledger is not None

    def test_is_idempotent(self, client, graph, db_session) -> None:
        from sqlalchemy import func

        row = graph.announcement(audience="students")
        client.post(f"{AN}/{row.id}/read", headers=graph.U)
        assert client.post(f"{AN}/{row.id}/read", headers=graph.U).status_code == 204
        count = db_session.scalar(
            select(func.count()).select_from(AnnouncementRead).where(
                AnnouncementRead.announcement_id == row.id,
                AnnouncementRead.user_id == graph.student_user.id,
            )
        )
        assert count == 1

    def test_untargeted_announcement_404(self, client, graph) -> None:
        """Answering 204 would leak that it exists."""
        row = graph.announcement(audience="teachers")
        r = client.post(f"{AN}/{row.id}/read", headers=graph.U)
        assert r.status_code == 404
        _assert_envelope(r.json(), code="not_found")

    def test_unknown_id_404(self, client, graph) -> None:
        assert client.post(f"{AN}/{uuid.uuid4()}/read", headers=graph.U).status_code == 404

    def test_read_by_one_user_does_not_mark_it_for_another(self, client, graph) -> None:
        row = graph.announcement(audience="all")
        client.post(f"{AN}/{row.id}/read", headers=graph.U)
        item = next(i for i in client.get(AN, headers=graph.T).json()["items"]
                    if i["id"] == str(row.id))
        assert item["is_read"] is False

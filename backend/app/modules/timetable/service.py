"""Timetable service (FR-SCH-03..05).

Builds the Mon–Fri week for whoever is asking. It lives in its own module rather than
inside Classes because it spans two different notions of "my classes" — a student's
enrolments and a teacher's assignments — and belongs to neither the Students nor the
Teachers module for the same reason.

Scoping (api-spec §3.3, no existence leak):
  * Student → the classes they are ACTIVELY enrolled in.
  * Teacher → the classes they are assigned to teach.
  * P/S     → any student's timetable, via `student_timetable`. There is deliberately
              no "whole school" timetable here; that is a room/teacher-utilisation
              report, not a personal week.

Year resolution: everything is scoped to ONE academic year — the active one by
default, or an explicit `academic_year_id` so the year switcher can look back. Without
that scope an archived year's classes would be interleaved into the current week.

TERM resolution (added by D31, and it is not cosmetic). A week belongs to ONE TERM, not
to a year. Under the year-scoped `classes` model that distinction was invisible, because
a course could only be offered once per year — so scoping to the year happened to select
one term's worth of teaching. D31 makes "the same course in two terms" a first-class
capability, and the moment the demo seed used it the bug showed: a student enrolled in
`MATH1110-01` in BOTH Semester 1 and Semester 2 got Monday 08:00 rendered TWICE, one of
the two being a class that does not start for another four months. `_narrow_to_one_term`
is the fix — the year is still the outer scope, but the grid shows a single term's week.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import DayOfWeek, Role
from app.common.schemas import StudentRef, TeacherRef
from app.core.errors import NotFound
from app.core.rbac import _teacher_profile_id, hod_program_ids
from app.modules.offerings.queries import offerings_in_year
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassMeeting,
    ClassTeacher,
    Course,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.timetable.schemas import (
    TimetableDay,
    TimetableEntry,
    TimetableView,
    UnscheduledOffering,
)
from app.modules.users.models import User

#: Mon–Fri, in order. The single mapping of ISO weekday → label on the backend.
_DAY_NAMES: dict[int, str] = {
    DayOfWeek.MONDAY.value: "Monday",
    DayOfWeek.TUESDAY.value: "Tuesday",
    DayOfWeek.WEDNESDAY.value: "Wednesday",
    DayOfWeek.THURSDAY.value: "Thursday",
    DayOfWeek.FRIDAY.value: "Friday",
}


def _active_year_id(db: Session) -> uuid.UUID | None:
    return db.scalar(select(AcademicYear.id).where(AcademicYear.status == "active"))


def _student_profile_or_404(db: Session, user: User) -> StudentProfile:
    profile = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == user.id, StudentProfile.deleted_at.is_(None)
        )
    )
    if profile is None:
        raise NotFound("Student profile not found.", code="student_not_found")
    return profile


def _narrow_to_one_term(
    db: Session, pairs: list[tuple[uuid.UUID, uuid.UUID]]
) -> list[uuid.UUID]:
    """Keep only the offerings belonging to the ONE term this week should show.

    `pairs` is (offering_id, semester_id) for everything the caller holds in the
    resolved year, which after D31 can span both of its terms (see the module
    docstring). The term is chosen from what the CALLER actually holds, not from the
    calendar, and in this order:

      1. the ACTIVE semester, if the caller has anything in it — "this week" for the
         current year, which is what an unqualified request means;
      2. otherwise the highest `sequence` present — for an ARCHIVED year, the last term
         the caller actually sat, rather than a term of that year they were not in
         (which would render as a blank grid and read as a broken filter).

    Choosing from what the caller holds is what makes the archived case work without a
    `semester_id` on the wire. Letting the client SELECT the term is the follow-on: it
    is a contract change (a query parameter plus the chosen term on the response) and
    belongs with the API surface, not here.
    """
    if not pairs:
        return []
    semester_ids = {sem for _off, sem in pairs}
    rows = db.execute(
        select(Semester.id, Semester.is_active, Semester.sequence).where(
            Semester.id.in_(semester_ids)
        )
    ).all()
    if not rows:
        return list(dict.fromkeys(off for off, _sem in pairs))
    active = [r for r in rows if r.is_active]
    chosen = active[0].id if active else max(rows, key=lambda r: r.sequence).id
    return list(dict.fromkeys(off for off, sem in pairs if sem == chosen))


def _student_offering_ids(
    db: Session,
    *,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """The classes a student actively sits, in ONE term of the given year.

    Scoped through `semesters` rather than the offering's year so a class whose year was
    later corrected cannot appear under two years at once: the enrolment's own semester
    is what actually places the student in time.
    """
    stmt = (
        select(ClassEnrollment.offering_id, ClassEnrollment.semester_id)
        .join(Semester, ClassEnrollment.semester_id == Semester.id)
        .join(CourseOffering, ClassEnrollment.offering_id == CourseOffering.id)
        .where(
            ClassEnrollment.student_id == student_id,
            ClassEnrollment.unenrolled_at.is_(None),
            CourseOffering.deleted_at.is_(None),
        )
    )
    if academic_year_id is not None:
        stmt = stmt.where(Semester.academic_year_id == academic_year_id)
    return _narrow_to_one_term(db, [(row[0], row[1]) for row in db.execute(stmt)])


def _teacher_offering_ids(
    db: Session, *, user: User, academic_year_id: uuid.UUID | None
) -> list[uuid.UUID]:
    """The classes a teacher is assigned to teach, in ONE term of the given year."""
    try:
        teacher_id = _teacher_profile_id(db, user)
    except NotFound:
        # A teacher account with no profile owns nothing — an empty week, not a 404.
        return []
    stmt = (
        select(CourseOffering.id, CourseOffering.semester_id)
        .join(ClassTeacher, ClassTeacher.offering_id == CourseOffering.id)
        .where(
            ClassTeacher.teacher_id == teacher_id,
            CourseOffering.deleted_at.is_(None),
        )
    )
    if academic_year_id is not None:
        stmt = stmt.where(offerings_in_year(academic_year_id))
    return _narrow_to_one_term(db, [(row[0], row[1]) for row in db.execute(stmt)])


def _build_view(
    db: Session,
    *,
    offering_ids: list[uuid.UUID],
    academic_year_id: uuid.UUID | None,
    student: StudentRef | None = None,
) -> TimetableView:
    """Shape the week for a set of classes in a fixed number of queries.

    Every weekday is emitted even when empty, so the grid always has five columns and
    a blank Wednesday is visibly blank rather than missing.
    """
    days = [
        TimetableDay(day_of_week=d, day_name=_DAY_NAMES[d], entries=[])
        for d in sorted(_DAY_NAMES)
    ]
    view = TimetableView(
        student=student, academic_year_id=academic_year_id, days=days, unscheduled=[]
    )
    if not offering_ids:
        return view

    offerings = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            CourseOffering.id.in_(offering_ids),
            CourseOffering.deleted_at.is_(None),
        )
        .order_by(*OFFERING_ORDER)
    ).all()
    if not offerings:
        return view

    offering_ids_present = [offering.id for (offering, _course) in offerings]

    teacher_rows = db.execute(
        select(ClassTeacher.offering_id, TeacherProfile)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.offering_id.in_(offering_ids_present))
        .order_by(ClassTeacher.is_lead.desc(), TeacherProfile.full_name.asc())
    ).all()
    teachers_by_cs: dict[uuid.UUID, list[TeacherRef]] = {}
    for cs_id, tp in teacher_rows:
        teachers_by_cs.setdefault(cs_id, []).append(TeacherRef.model_validate(tp))

    meetings = db.execute(
        select(ClassMeeting)
        .where(
            ClassMeeting.offering_id.in_(offering_ids_present),
            ClassMeeting.deleted_at.is_(None),
        )
        .order_by(ClassMeeting.day_of_week.asc(), ClassMeeting.start_time.asc())
    ).scalars()
    meetings_by_cs: dict[uuid.UUID, list[ClassMeeting]] = {}
    for m in meetings:
        meetings_by_cs.setdefault(m.offering_id, []).append(m)

    by_day = {d.day_of_week: d for d in view.days}
    for offering, course in offerings:
        ref = offering_ref(offering, course)
        teachers = teachers_by_cs.get(offering.id, [])
        slots = meetings_by_cs.get(offering.id, [])
        if not slots:
            view.unscheduled.append(
                UnscheduledOffering(offering=ref, teachers=teachers)
            )
            continue
        for m in slots:
            day = by_day.get(m.day_of_week)
            if day is None:
                # A day outside Mon–Fri can only exist if the CHECK was bypassed
                # (a hand-edited row). Skip it rather than inventing a sixth column.
                continue
            day.entries.append(
                TimetableEntry(
                    meeting_id=m.id,
                    offering=ref,
                    teachers=teachers,
                    room=m.room,
                    day_of_week=m.day_of_week,
                    start_time=m.start_time,
                    end_time=m.end_time,
                )
            )

    # Within a day, by start time; ties broken by the offering label. `offerings` was
    # already fetched in `OFFERING_ORDER`, so `unscheduled` needs no further sort.
    for day in view.days:
        day.entries.sort(key=lambda e: (e.start_time, e.offering.label))
    return view


# ══════════════════════════════════════════════════════════════════════════════
# GET /timetable/me
# ══════════════════════════════════════════════════════════════════════════════
def my_timetable(
    db: Session, *, caller: User, academic_year_id: uuid.UUID | None
) -> TimetableView:
    """The caller's own week.

    P/S get an empty week rather than a 403: they have no personal timetable, and the
    nav never offers them this screen. Returning empty keeps the endpoint honest for
    any client that asks anyway.
    """
    year_id = academic_year_id or _active_year_id(db)

    if caller.role == Role.STUDENT:
        profile = _student_profile_or_404(db, caller)
        offering_ids = _student_offering_ids(
            db, student_id=profile.id, academic_year_id=year_id
        )
        return _build_view(
            db,
            offering_ids=offering_ids,
            academic_year_id=year_id,
            student=StudentRef.model_validate(profile),
        )

    if caller.role == Role.TEACHER:
        offering_ids = _teacher_offering_ids(db, user=caller, academic_year_id=year_id)
        return _build_view(db, offering_ids=offering_ids, academic_year_id=year_id)

    return _build_view(db, offering_ids=[], academic_year_id=year_id)


# ══════════════════════════════════════════════════════════════════════════════
# GET /students/{student_id}/timetable
# ══════════════════════════════════════════════════════════════════════════════
def student_timetable(
    db: Session,
    *,
    actor: User,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
) -> TimetableView:
    """Any student's week. Role gate is the router's; the HOD's SCOPE is here.

    The office needs this to check a student's week before enrolling them into one more
    class, which is the moment a clash is cheapest to catch.

    D45 §40 opened this to the Head of Department, who the blueprint says oversees the
    timetable and class lists of their department. The scope lands here rather than in
    `require_role`, which is a role allowlist and cannot express "only their own
    students" — the same division D43 used everywhere else the HOD reads.

    **A student outside the head's programmes is 404, not 403.** Confirming that a
    student exists but is off-limits leaks their existence (api-spec §3.3), and it is the
    discipline every other HOD-scoped read in this system already follows.
    """
    profile = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
        )
    )
    if profile is None:
        raise NotFound("Student not found.", code="student_not_found")

    if actor.role == Role.HOD:
        # `hod_program_ids` returns [] for a head with no `program_heads` row yet — a real
        # state, since appointing a head and provisioning their login are two separate
        # acts. [] must narrow to the empty set, never widen to everything.
        if profile.program_id not in set(hod_program_ids(db, actor)):
            raise NotFound("Student not found.", code="student_not_found")

    year_id = academic_year_id or _active_year_id(db)
    offering_ids = _student_offering_ids(db, student_id=profile.id, academic_year_id=year_id)
    return _build_view(
        db,
        offering_ids=offering_ids,
        academic_year_id=year_id,
        student=StudentRef.model_validate(profile),
    )

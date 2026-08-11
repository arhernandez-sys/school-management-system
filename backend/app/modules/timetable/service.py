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
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import DayOfWeek, Role
from app.common.schemas import StudentRef, SubjectRef, TeacherRef
from app.core.errors import NotFound
from app.core.rbac import _teacher_profile_id
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassMeeting,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.timetable.schemas import (
    TimetableDay,
    TimetableEntry,
    TimetableView,
    UnscheduledClass,
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


def _student_class_ids(
    db: Session,
    *,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """The classes a student actively sits in the given year.

    Scoped through `semesters` rather than `classes.academic_year_id` so a class whose
    year was later corrected cannot appear under two years at once: the enrolment's own
    semester is what actually places the student in time.
    """
    stmt = (
        select(ClassEnrollment.class_id)
        .join(Semester, ClassEnrollment.semester_id == Semester.id)
        .join(Class, ClassEnrollment.class_id == Class.id)
        .where(
            ClassEnrollment.student_id == student_id,
            ClassEnrollment.unenrolled_at.is_(None),
            Class.deleted_at.is_(None),
        )
    )
    if academic_year_id is not None:
        stmt = stmt.where(Semester.academic_year_id == academic_year_id)
    return list(dict.fromkeys(db.scalars(stmt)))


def _teacher_class_ids(
    db: Session, *, user: User, academic_year_id: uuid.UUID | None
) -> list[uuid.UUID]:
    """The classes a teacher is assigned to teach in the given year."""
    try:
        teacher_id = _teacher_profile_id(db, user)
    except NotFound:
        # A teacher account with no profile owns nothing — an empty week, not a 404.
        return []
    stmt = (
        select(ClassSubject.class_id)
        .join(ClassTeacher, ClassTeacher.class_subject_id == ClassSubject.id)
        .join(Class, ClassSubject.class_id == Class.id)
        .where(
            ClassTeacher.teacher_id == teacher_id,
            ClassSubject.deleted_at.is_(None),
            Class.deleted_at.is_(None),
        )
    )
    if academic_year_id is not None:
        stmt = stmt.where(Class.academic_year_id == academic_year_id)
    return list(dict.fromkeys(db.scalars(stmt)))


def _build_view(
    db: Session,
    *,
    class_ids: list[uuid.UUID],
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
    if not class_ids:
        return view

    offerings = db.execute(
        select(ClassSubject, Class, Subject)
        .join(Class, ClassSubject.class_id == Class.id)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(
            ClassSubject.class_id.in_(class_ids),
            ClassSubject.deleted_at.is_(None),
            Class.deleted_at.is_(None),
        )
        .order_by(Class.name.asc(), ClassSubject.id.asc())
    ).all()
    if not offerings:
        return view

    cs_ids = [cs.id for (cs, _c, _s) in offerings]

    teacher_rows = db.execute(
        select(ClassTeacher.class_subject_id, TeacherProfile)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.class_subject_id.in_(cs_ids))
        .order_by(ClassTeacher.is_lead.desc(), TeacherProfile.full_name.asc())
    ).all()
    teachers_by_cs: dict[uuid.UUID, list[TeacherRef]] = {}
    for cs_id, tp in teacher_rows:
        teachers_by_cs.setdefault(cs_id, []).append(TeacherRef.model_validate(tp))

    meetings = db.execute(
        select(ClassMeeting)
        .where(
            ClassMeeting.class_subject_id.in_(cs_ids),
            ClassMeeting.deleted_at.is_(None),
        )
        .order_by(ClassMeeting.day_of_week.asc(), ClassMeeting.start_time.asc())
    ).scalars()
    meetings_by_cs: dict[uuid.UUID, list[ClassMeeting]] = {}
    for m in meetings:
        meetings_by_cs.setdefault(m.class_subject_id, []).append(m)

    by_day = {d.day_of_week: d for d in view.days}
    for cs, section, subject in offerings:
        subject_ref = SubjectRef.model_validate(subject)
        teachers = teachers_by_cs.get(cs.id, [])
        slots = meetings_by_cs.get(cs.id, [])
        if not slots:
            view.unscheduled.append(
                UnscheduledClass(
                    class_id=section.id,
                    class_name=section.name,
                    class_subject_id=cs.id,
                    subject=subject_ref,
                    teachers=teachers,
                )
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
                    class_id=section.id,
                    class_name=section.name,
                    class_subject_id=cs.id,
                    subject=subject_ref,
                    teachers=teachers,
                    room=m.room,
                    day_of_week=m.day_of_week,
                    start_time=m.start_time,
                    end_time=m.end_time,
                )
            )

    for day in view.days:
        day.entries.sort(key=lambda e: (e.start_time, e.class_name))
    view.unscheduled.sort(key=lambda u: u.class_name)
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
        class_ids = _student_class_ids(
            db, student_id=profile.id, academic_year_id=year_id
        )
        return _build_view(
            db,
            class_ids=class_ids,
            academic_year_id=year_id,
            student=StudentRef.model_validate(profile),
        )

    if caller.role == Role.TEACHER:
        class_ids = _teacher_class_ids(db, user=caller, academic_year_id=year_id)
        return _build_view(db, class_ids=class_ids, academic_year_id=year_id)

    return _build_view(db, class_ids=[], academic_year_id=year_id)


# ══════════════════════════════════════════════════════════════════════════════
# GET /students/{student_id}/timetable
# ══════════════════════════════════════════════════════════════════════════════
def student_timetable(
    db: Session,
    *,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
) -> TimetableView:
    """Any student's week (P/S only — the role gate is the router's).

    The office needs this to check a student's week before enrolling them into one more
    class, which is the moment a clash is cheapest to catch.
    """
    profile = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
        )
    )
    if profile is None:
        raise NotFound("Student not found.", code="student_not_found")

    year_id = academic_year_id or _active_year_id(db)
    class_ids = _student_class_ids(db, student_id=profile.id, academic_year_id=year_id)
    return _build_view(
        db,
        class_ids=class_ids,
        academic_year_id=year_id,
        student=StudentRef.model_validate(profile),
    )

"""Attendance service (api-spec §5 Module 8, FR-ATT-*, D-Q4).

Owns DB access + transactions for the 5 attendance endpoints; the router is thin.
Attendance is **per-offering, per-day**: for an (offering, date) every actively
enrolled student carries a present/absent/late/excused status.

Recording is **teacher-only** — principals and secretaries read the register and
the summary but cannot mark it (matching the finished frontend). A teacher may mark an
offering they are assigned to, via `assert_teacher_owns_offering` (D31 merged the old
"owns the section" and "owns the class_subject" gates into one — with one course per
offering they became the same lookup).

The live `attendance_records` table has no `recorded_at`/`recorded_by` columns, so
those wire fields map onto the audit mixin: `recorded_at` ← `updated_at`, and
`last_recorded.by` ← `updated_by` resolved to `users.full_name`.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import AcademicYearStatus, AttendanceStatus, Role
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.rbac import _teacher_profile_id, assert_teacher_owns_offering
from app.core.timeutil import school_today, utcnow
from app.modules.attendance.models import AttendanceRecord
from app.modules.attendance.schemas import (
    AttendanceCounts,
    AttendanceDatePoint,
    AttendanceEntry,
    AttendanceRegister,
    AttendanceOfferingPickerItem,
    AttendanceOfferingRef,
    AttendanceOfferingsResponse,
    AttendanceStudentPoint,
    AttendanceStudentRef,
    AttendanceSummaryResponse,
    AttendanceTeacherRef,
    AttendanceUpsertRequest,
    AttendanceUpsertResponse,
    LastRecorded,
    MyAttendanceHistoryItem,
    MyAttendanceResponse,
)
from app.modules.offerings.queries import offerings_in_year, year_id_of_offering, year_of_offering
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.models import ClassEnrollment, ClassTeacher, Course, CourseOffering
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import STUDENT_NAME_ORDER, StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User


def _audit(db: Session, *, actor: User, action: str, entity_id=None, summary=None) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="attendance",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _today() -> date_type:
    """The school's local date (OQ-TZ1, resolved: America/Belize).

    NOT `utcnow().date()`. Belize is UTC-6, so after 18:00 local the UTC date is
    already tomorrow — a teacher marking the register at 18:30 would otherwise be
    able to submit for the next day, and `future_date_not_allowed` would let it
    through.
    """
    return school_today()


# ──────────────────────────────────────────────────────────────────────────────
# The one counts implementation
# ──────────────────────────────────────────────────────────────────────────────
def _summarize(statuses: list[AttendanceStatus]) -> AttendanceCounts:
    """Tally P/A/L/E and derive `pct_present`.

    **LATE COUNTS AS PRESENT** and the result carries one decimal place — this
    matches `handlers/attendance.ts:119-120`, the binding contract. (Note the demo's
    `selectors.ts::attendanceSummaryForSection` uses a different, present-only
    formula; it is not what the attendance handler serves, so it is not the spec.)

    `total == 0` yields 0 rather than dividing by zero.
    """
    counts = {status: 0 for status in AttendanceStatus}
    for status in statuses:
        counts[status] += 1
    total = len(statuses)
    present_like = counts[AttendanceStatus.PRESENT] + counts[AttendanceStatus.LATE]
    pct = 0.0 if total == 0 else round(present_like / total * 1000) / 10
    return AttendanceCounts(
        present=counts[AttendanceStatus.PRESENT],
        absent=counts[AttendanceStatus.ABSENT],
        late=counts[AttendanceStatus.LATE],
        excused=counts[AttendanceStatus.EXCUSED],
        pct_present=pct,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups
# ──────────────────────────────────────────────────────────────────────────────
def _active_year(db: Session) -> AcademicYear | None:
    return db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


def _semester_for_offering(db: Session, offering: CourseOffering) -> Semester | None:
    """The offering's own year's active term, else its `sequence=1` term.

    Same reasoning as the gradebook: keying off the globally-active semester would
    mis-resolve for any offering outside the current year.
    """
    active = db.scalar(
        select(Semester).where(
            Semester.is_active.is_(True),
            Semester.academic_year_id == year_id_of_offering(db, offering),
        )
    )
    if active is not None:
        return active
    return db.scalar(
        select(Semester)
        .where(Semester.academic_year_id == year_id_of_offering(db, offering))
        .order_by(Semester.sequence.asc())
        .limit(1)
    )


def _offering_or_404(db: Session, actor: User, offering_id: uuid.UUID) -> CourseOffering:
    """Load an accessible offering or 404.

    A teacher who owns nothing in the offering gets the same 404 as a nonexistent
    id — the no-existence-leak rule (api-spec §3.3).
    """
    offering = db.scalar(
        select(CourseOffering).where(CourseOffering.id == offering_id, CourseOffering.deleted_at.is_(None))
    )
    if offering is None:
        raise NotFound("Section not found.", code="not_found")
    if actor.role == Role.TEACHER:
        assert_teacher_owns_offering(db, actor, offering.id)
    return offering


def _teachers_for_offerings(
    db: Session, offering_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[AttendanceTeacherRef]]:
    """Distinct teachers per offering, deduped across that offering's offerings."""
    if not offering_ids:
        return {}
    rows = db.execute(
        select(CourseOffering.id, TeacherProfile.id, TeacherProfile.full_name)
        .join(ClassTeacher, ClassTeacher.offering_id == CourseOffering.id)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(
            CourseOffering.id.in_(offering_ids),
            CourseOffering.deleted_at.is_(None),
        )
    ).all()
    seen: dict[uuid.UUID, dict[uuid.UUID, str]] = defaultdict(dict)
    for class_id, teacher_id, full_name in rows:
        seen[class_id][teacher_id] = full_name
    return {
        class_id: [
            # Key is `name`, NOT `full_name` — the attendance screens read `t.name`.
            AttendanceTeacherRef(id=tid, name=name)
            for tid, name in sorted(members.items(), key=lambda kv: kv[1])
        ]
        for class_id, members in seen.items()
    }


def _offering_ref(
    db: Session,
    offering: CourseOffering,
    teachers: list[AttendanceTeacherRef],
    *,
    course: Course | None = None,
) -> AttendanceOfferingRef:
    """The register's offering ref. `course` is accepted so a caller that already
    joined it (the picker) does not re-fetch it once per row."""
    course = course or db.get(Course, offering.course_id)
    return AttendanceOfferingRef(
        offering=offering_ref(offering, course),
        teachers=teachers,
    )


def _student_ref(student: StudentProfile) -> AttendanceStudentRef:
    return AttendanceStudentRef(
        id=student.id,
        full_name=student.full_name,
        student_number=student.student_number,
    )


def _active_roster(
    db: Session, offering: CourseOffering, semester: Semester | None
) -> list[tuple[StudentProfile, ClassEnrollment]]:
    """Active enrollments for (offering, semester), sorted by student name."""
    if semester is None:
        return []
    rows = db.execute(
        select(StudentProfile, ClassEnrollment)
        .join(ClassEnrollment, ClassEnrollment.student_id == StudentProfile.id)
        .where(
            ClassEnrollment.offering_id == offering.id,
            ClassEnrollment.semester_id == semester.id,
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .order_by(*STUDENT_NAME_ORDER)
    ).all()
    return [(student, enrollment) for student, enrollment in rows]


# ──────────────────────────────────────────────────────────────────────────────
# GET /attendance/offerings
# ──────────────────────────────────────────────────────────────────────────────
def list_offerings(
    db: Session, *, actor: User, academic_year_id: uuid.UUID | None
) -> AttendanceOfferingsResponse:
    """The register's offering picker. Teacher → the offerings they are assigned to;
    P/S → every offering of the year."""
    stmt = (
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(CourseOffering.deleted_at.is_(None))
    )

    if academic_year_id is not None:
        stmt = stmt.where(offerings_in_year(academic_year_id))
    else:
        active = _active_year(db)
        if active is None:
            return AttendanceOfferingsResponse(items=[], can_record=actor.role == Role.TEACHER)
        stmt = stmt.where(
            offerings_in_year(active.id), CourseOffering.is_archived.is_(False)
        )

    if actor.role == Role.TEACHER:
        teacher_id = _teacher_profile_id(db, actor)
        owned = select(CourseOffering.id).join(
            ClassTeacher, ClassTeacher.offering_id == CourseOffering.id
        ).where(
            ClassTeacher.teacher_id == teacher_id, CourseOffering.deleted_at.is_(None)
        )
        stmt = stmt.where(CourseOffering.id.in_(owned))

    # Ordered in SQL by `OFFERING_ORDER` (course code, then offering) rather than by the
    # formatted label in Python — "MATH1110-2" sorts before "MATH1110-10" as a string.
    rows = db.execute(stmt.order_by(*OFFERING_ORDER)).all()
    teachers = _teachers_for_offerings(db, [offering.id for offering, _ in rows])

    items: list[AttendanceOfferingPickerItem] = []
    for offering, course in rows:
        semester = _semester_for_offering(db, offering)
        roster = _active_roster(db, offering, semester)
        ref = _offering_ref(db, offering, teachers.get(offering.id, []), course=course)
        items.append(
            AttendanceOfferingPickerItem(
                offering=ref.offering,
                teachers=ref.teachers,
                enrolled_count=len(roster),
            )
        )
    return AttendanceOfferingsResponse(
        items=items,
        # Only a teacher marks the register; P/S are read-only here.
        can_record=actor.role == Role.TEACHER,
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /attendance
# ──────────────────────────────────────────────────────────────────────────────
def get_register(
    db: Session, *, actor: User, offering_id: uuid.UUID, on_date: date_type | None
) -> AttendanceRegister:
    """The daily register: the whole active roster, left-joined to the day's records.

    An unrecorded student has `status=None` — that is "not yet marked", not an
    attendance value, and the UI defaults the row to present.
    """
    offering = _offering_or_404(db, actor, offering_id)
    target = on_date or _today()
    semester = _semester_for_offering(db, offering)
    roster = _active_roster(db, offering, semester)

    records = {
        r.student_id: r
        for r in db.scalars(
            select(AttendanceRecord).where(
                AttendanceRecord.offering_id == offering.id,
                AttendanceRecord.attendance_date == target,
            )
        ).all()
    }

    entries = [
        AttendanceEntry(
            student=_student_ref(student),
            enrollment_id=enrollment.id,
            status=records[student.id].status if student.id in records else None,
            recorded_at=records[student.id].updated_at if student.id in records else None,
        )
        for student, enrollment in roster
    ]

    last_recorded = None
    if records:
        newest = max(records.values(), key=lambda r: r.updated_at)
        actor_id = newest.updated_by or newest.created_by
        name = None
        if actor_id is not None:
            name = db.scalar(select(User.full_name).where(User.id == actor_id))
        last_recorded = LastRecorded(
            # `by` is a plain NAME STRING on the wire, not a user ref object.
            by=name or "Staff",
            at=newest.updated_at,
        )

    teachers = _teachers_for_offerings(db, [offering.id])
    return AttendanceRegister(
        offering=_offering_ref(db, offering, teachers.get(offering.id, [])),
        date=target,
        can_record=actor.role == Role.TEACHER,
        entries=entries,
        last_recorded=last_recorded,
    )


# ──────────────────────────────────────────────────────────────────────────────
# PUT /attendance
# ──────────────────────────────────────────────────────────────────────────────
def upsert_register(
    db: Session, *, actor: User, payload: AttendanceUpsertRequest
) -> AttendanceUpsertResponse:
    """Bulk upsert one (offering, date). Teacher-only, all-or-nothing validation."""
    offering = _offering_or_404(db, actor, payload.offering_id)

    if payload.date > _today():
        raise ValidationError(
            "You can't record attendance for a future date.",
            code="future_date_not_allowed",
            fields={"date": ["You can't record attendance for a future date."]},
        )

    if offering.is_archived:
        raise Conflict("The academic year is archived.", code="year_archived")
    year = year_of_offering(db, offering)
    if year is not None and year.archived_at is not None:
        raise Conflict("The academic year is archived.", code="year_archived")

    seen: set[uuid.UUID] = set()
    duplicates: list[uuid.UUID] = []
    for entry in payload.entries:
        if entry.student_id in seen:
            duplicates.append(entry.student_id)
        seen.add(entry.student_id)
    if duplicates:
        raise ValidationError(
            "Each student may appear only once.",
            code="duplicate_entry",
            fields={"student_id": [str(s) for s in dict.fromkeys(duplicates)]},
        )

    semester = _semester_for_offering(db, offering)
    enrollments = {
        student.id: enrollment for student, enrollment in _active_roster(db, offering, semester)
    }

    # The mock silently skips non-roster entries; we reject instead. The frontend
    # only ever submits roster rows, so it cannot regress on this.
    not_enrolled = [sid for sid in seen if sid not in enrollments]
    if not_enrolled:
        raise ValidationError(
            "Some students are not enrolled in this offering.",
            code="student_not_enrolled",
            fields={"student_id": [str(s) for s in not_enrolled]},
        )

    existing = {
        r.student_id: r
        for r in db.scalars(
            select(AttendanceRecord).where(
                AttendanceRecord.offering_id == offering.id,
                AttendanceRecord.attendance_date == payload.date,
            )
        ).all()
    }

    for entry in payload.entries:
        enrollment = enrollments[entry.student_id]
        row = existing.get(entry.student_id)
        if row is None:
            row = AttendanceRecord(
                offering_id=offering.id,
                student_id=entry.student_id,
                # Both are NOT NULL in the live schema — stamp from the enrollment.
                enrollment_id=enrollment.id,
                semester_id=enrollment.semester_id,
                attendance_date=payload.date,
                status=entry.status,
            )
            db.add(row)
        row.status = entry.status
        row.enrollment_id = enrollment.id
        row.semester_id = enrollment.semester_id
        row.updated_by = actor.id

    _audit(
        db,
        actor=actor,
        action="attendance.upsert",
        entity_id=offering.id,
        summary={"date": payload.date.isoformat(), "entries": len(payload.entries)},
    )
    db.flush()

    # Summary spans EVERY record for the day, not only the submitted rows — a
    # partial save must still report the day's true state.
    statuses = list(
        db.scalars(
            select(AttendanceRecord.status).where(
                AttendanceRecord.offering_id == offering.id,
                AttendanceRecord.attendance_date == payload.date,
            )
        ).all()
    )
    db.commit()
    return AttendanceUpsertResponse(
        upserted=len(payload.entries), summary=_summarize(statuses)
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /attendance/summary
# ──────────────────────────────────────────────────────────────────────────────
def get_summary(
    db: Session,
    *,
    actor: User,
    offering_id: uuid.UUID,
    date_from: date_type | None,
    date_to: date_type | None,
) -> AttendanceSummaryResponse:
    """Overall + per-day + per-student tallies for a offering.

    A offering belongs to exactly one academic year, so this is already year-scoped
    without an explicit filter; `from`/`to` narrow it further when supplied.
    """
    offering = _offering_or_404(db, actor, offering_id)

    stmt = select(AttendanceRecord).where(AttendanceRecord.offering_id == offering.id)
    if date_from is not None:
        stmt = stmt.where(AttendanceRecord.attendance_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(AttendanceRecord.attendance_date <= date_to)
    records = list(db.scalars(stmt).all())

    by_date: dict[date_type, list[AttendanceStatus]] = defaultdict(list)
    by_student: dict[uuid.UUID, list[AttendanceStatus]] = defaultdict(list)
    for record in records:
        by_date[record.attendance_date].append(record.status)
        by_student[record.student_id].append(record.status)

    semester = _semester_for_offering(db, offering)
    roster = _active_roster(db, offering, semester)
    teachers = _teachers_for_offerings(db, [offering.id])

    return AttendanceSummaryResponse(
        offering=_offering_ref(db, offering, teachers.get(offering.id, [])),
        overall=_summarize([r.status for r in records]),
        by_date=[
            AttendanceDatePoint(date=day, **_summarize(statuses).model_dump())
            for day, statuses in sorted(by_date.items())
        ],
        by_student=[
            # The FULL active roster, so a student with no records still shows as
            # a zero row rather than disappearing from the report.
            AttendanceStudentPoint(
                student=_student_ref(student),
                **_summarize(by_student.get(student.id, [])).model_dump(),
            )
            for student, _enrollment in roster
        ],
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /attendance/me
# ──────────────────────────────────────────────────────────────────────────────
def get_my_attendance(
    db: Session,
    *,
    actor: User,
    academic_year_id: uuid.UUID | None,
    semester_id: uuid.UUID | None = None,
) -> MyAttendanceResponse:
    """The signed-in student's own attendance, newest first.

    `semester_id` narrows within the year (the global switcher picks a year·semester
    pair); omitted, the year's semesters are fanned out exactly as before. The summary
    is computed from the SAME filtered records as the history, so the percentage always
    describes the period on screen."""
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == actor.id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None:
        raise NotFound("Student profile not found.", code="not_found")

    year_id = academic_year_id
    if year_id is None:
        active = _active_year(db)
        year_id = active.id if active is not None else None

    stmt = select(AttendanceRecord).where(AttendanceRecord.student_id == student.id)
    if year_id is not None:
        semester_ids = select(Semester.id).where(Semester.academic_year_id == year_id)
        stmt = stmt.where(AttendanceRecord.semester_id.in_(semester_ids))
    if semester_id is not None:
        # Applied IN ADDITION to the year fan-out above, never instead of it. If the
        # caller pairs a year with a semester from a DIFFERENT year the two clauses
        # intersect to nothing, and empty is the right answer: returning that
        # semester's records under the requested year's heading is precisely the
        # mislabelling defect that `/grades/me` was fixed for (see its fallback guard).
        stmt = stmt.where(AttendanceRecord.semester_id == semester_id)
    records = list(db.scalars(stmt.order_by(AttendanceRecord.attendance_date.desc())).all())

    return MyAttendanceResponse(
        summary=_summarize([r.status for r in records]),
        history=[
            MyAttendanceHistoryItem(date=r.attendance_date, status=r.status)
            for r in records
        ],
    )

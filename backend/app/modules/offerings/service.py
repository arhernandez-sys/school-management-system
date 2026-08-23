"""Course-offerings service (api-spec §5 Module 5, FR-CLS-01..10, FR-SCH-01..06).

Owns DB access + transactions for the Offerings endpoints; routers are thin.

**D31 — an offering is ONE COURSE IN ONE TERM.** `classes` (a homeroom scoped to an
academic year) and `class_subjects` (the many-to-many that existed because a homeroom
taught seven subjects) merged into `course_offerings`. Four consequences live in this file:

  1. **The join is gone.** Every helper that existed only to get from a section to its
     single subject — `_offering_of`, `_offering_map`, `_class_subject_items`,
     `_class_subject_or_404`, `_one_class_subject_item`, `_teacher_owned_cs_ids` — is
     deleted. The offering IS the subject.

  2. **`attach_subject` / `detach_subject` are gone with them**, and with them
     `GET`/`POST /classes/{id}/subjects`. A course is chosen when the offering is created,
     because an offering without a course cannot be graded, scheduled or enrolled into.

  3. **The term comes from the offering, not from "the active semester".** Enrolment,
     rosters and the enrollable-students picker all read `offering.semester_id`. Passing a
     different `semester_id` is a 409 rather than being quietly honoured: a row claiming a
     term the offering does not run in is not a state worth being able to reach.

  4. **The year is derived** through `semesters.academic_year_id`. `_assert_year_writable`
     therefore does one extra hop, and "archive this year's offerings" became a subquery
     (`settings/service.py`).

Cross-cutting discipline (api-spec §3):
  * 404-vs-403 — record/ownership denial → 404 (no existence leak). Lecturer scope reuses
    `assert_teacher_owns_offering` (rbac.py). Role denial is the router gate.
  * Every WRITE path rejects an offering in an archived academic year → 409 year_archived
    (FR-CLS-06, schema §5 rule 7).
  * Identity `(course_id, semester_id, section_code)` is enforced by the DB unique index
    `uq_course_offering_active`; we pre-check for the documented 409 code.

Derived data:
  * enrolled_count = active roster rows (unenrolled_at IS NULL).
  * over_capacity  = capacity set (>0) and enrolled_count > capacity (warn-only).
  * label          = `offerings.labels.offering_label` — one definition, never re-spelled.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import Role, StudentStatus
from app.common.schemas import (
    AcademicYearRef,
    AuditStamp,
    CourseRef,
    SemesterRef,
    StudentRef,
    TeacherRef,
    UserRef,
)
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id, assert_teacher_owns_offering
from app.modules.offerings.labels import OFFERING_ORDER, offering_label
from app.modules.offerings.models import (
    ClassEnrollment,
    ClassMeeting,
    ClassTeacher,
    Course,
    CourseOffering,
)
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import STUDENT_NAME_ORDER, StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User

#: Sortable keys. `label` sorts on the CODE then the section, never on the formatted
#: string — "MATH1110-2" would otherwise sort before "MATH1110-10" (see labels.py).
_OFFERING_SORT_FIELDS: dict[str, tuple] = {
    "label": (Course.code, CourseOffering.section_code),
    "code": (Course.code, CourseOffering.section_code),
    "course": (Course.name,),
    "created_at": (CourseOffering.created_at,),
}


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _audit(
    db: Session,
    *,
    actor: User,
    action: str,
    entity_id: uuid.UUID | None = None,
    summary: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="course_offering",
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + guards
# ──────────────────────────────────────────────────────────────────────────────
def _offering_or_404(db: Session, offering_id: uuid.UUID) -> CourseOffering:
    offering = db.scalar(
        select(CourseOffering).where(
            CourseOffering.id == offering_id, CourseOffering.deleted_at.is_(None)
        )
    )
    if offering is None:
        raise NotFound("Offering not found.", code="not_found")
    return offering


def _active_semester_id(db: Session) -> uuid.UUID | None:
    return db.scalar(select(Semester.id).where(Semester.is_active.is_(True)))


def _year_of(db: Session, offering: CourseOffering) -> AcademicYear | None:
    """The offering's academic year, via its semester (D31 — never stored here)."""
    return db.scalar(
        select(AcademicYear)
        .join(Semester, Semester.academic_year_id == AcademicYear.id)
        .where(Semester.id == offering.semester_id)
    )


def _assert_year_writable(db: Session, offering: CourseOffering) -> None:
    """Reject any write on an offering whose academic year is archived (FR-CLS-06)."""
    if offering.is_archived:
        raise Conflict("This offering's year is archived.", code="year_archived")
    year = _year_of(db, offering)
    if year is not None and year.archived_at is not None:
        raise Conflict("This offering's year is archived.", code="year_archived")


def _assert_identity_free(
    db: Session,
    *,
    course_id: uuid.UUID,
    semester_id: uuid.UUID,
    section_code: str | None,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Pre-check `uq_course_offering_active` so the caller gets a named 409, not a 1062.

    NULL and '' are the SAME section here, matching the `active_section` generated column
    that COALESCEs them: without that, two unsectioned offerings of one course in one term
    would both be allowed, because unique indexes do not collide on NULL.
    """
    wanted = (section_code or "").strip() or None
    stmt = select(CourseOffering.id).where(
        CourseOffering.course_id == course_id,
        CourseOffering.semester_id == semester_id,
        CourseOffering.deleted_at.is_(None),
    )
    stmt = (
        stmt.where(CourseOffering.section_code.is_(None))
        if wanted is None
        else stmt.where(func.lower(CourseOffering.section_code) == wanted.lower())
    )
    if exclude_id is not None:
        stmt = stmt.where(CourseOffering.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "This course is already offered in that term with the same section.",
            code="duplicate_offering",
        )


def _student_profile_id_or_none(db: Session, user: User) -> uuid.UUID | None:
    return db.scalar(
        select(StudentProfile.id).where(
            StudentProfile.user_id == user.id, StudentProfile.deleted_at.is_(None)
        )
    )


def _validated_teacher_set(
    db: Session, *, teacher_ids: list[uuid.UUID], lead_teacher_id: uuid.UUID | None
) -> tuple[list[uuid.UUID], uuid.UUID | None]:
    """Dedupe, validate existence, and resolve the lead for a lecturer assignment.

    Shared by `create_offering` and `assign_teachers` so the lead-must-be-a-member rule
    and the "lead defaults to the first lecturer" fallback cannot drift between the create
    path and the later reassign path.
    """
    ids = list(dict.fromkeys(teacher_ids))  # dedupe, keep order
    lead = lead_teacher_id
    if lead is not None and lead not in ids:
        raise ValidationError(
            "lead_teacher_id must be one of teacher_ids.",
            code="validation_error",
            fields={"lead_teacher_id": ["Must be included in teacher_ids."]},
        )
    if lead is None and ids:
        lead = ids[0]
    if ids:
        found = set(
            db.execute(
                select(TeacherProfile.id).where(
                    TeacherProfile.id.in_(ids), TeacherProfile.deleted_at.is_(None)
                )
            ).scalars()
        )
        if [t for t in ids if t not in found]:
            raise NotFound("Lecturer not found.", code="teacher_not_found")
    return ids, lead


# ──────────────────────────────────────────────────────────────────────────────
# Shaping helpers
# ──────────────────────────────────────────────────────────────────────────────
def _enrolled_counts(db: Session, offering_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not offering_ids:
        return {}
    rows = db.execute(
        select(ClassEnrollment.offering_id, func.count())
        .where(
            ClassEnrollment.offering_id.in_(offering_ids),
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .group_by(ClassEnrollment.offering_id)
    ).all()
    return {oid: n for (oid, n) in rows}


def _teachers_map(
    db: Session, offering_ids: list[uuid.UUID]
) -> tuple[dict[uuid.UUID, list[TeacherRef]], dict[uuid.UUID, uuid.UUID]]:
    """offering_id → (lecturers ordered lead-first, lead lecturer id)."""
    if not offering_ids:
        return {}, {}
    rows = db.execute(
        select(ClassTeacher, TeacherProfile)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.offering_id.in_(offering_ids))
        .order_by(ClassTeacher.is_lead.desc(), TeacherProfile.full_name.asc())
    ).all()
    teachers: dict[uuid.UUID, list[TeacherRef]] = {}
    leads: dict[uuid.UUID, uuid.UUID] = {}
    for ct, tp in rows:
        teachers.setdefault(ct.offering_id, []).append(TeacherRef.model_validate(tp))
        if ct.is_lead:
            leads[ct.offering_id] = tp.id
    return teachers, leads


def _meetings_map(db: Session, offering_ids: list[uuid.UUID]) -> dict[uuid.UUID, list]:
    """offering_id → its weekly meetings, in Mon→Fri / earliest-first order."""
    from app.modules.offerings.schemas import OfferingMeetingItem

    if not offering_ids:
        return {}
    rows = db.execute(
        select(ClassMeeting)
        .where(
            ClassMeeting.offering_id.in_(offering_ids),
            ClassMeeting.deleted_at.is_(None),
        )
        .order_by(
            ClassMeeting.day_of_week.asc(),
            ClassMeeting.start_time.asc(),
            ClassMeeting.id.asc(),
        )
    ).scalars()
    out: dict[uuid.UUID, list] = {}
    for m in rows:
        out.setdefault(m.offering_id, []).append(OfferingMeetingItem.model_validate(m))
    return out


def _assessment_counts(db: Session, offering_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    from app.modules.assessments.models import Assessment

    if not offering_ids:
        return {}
    return {
        oid: n
        for (oid, n) in db.execute(
            select(Assessment.offering_id, func.count())
            .where(
                Assessment.offering_id.in_(offering_ids),
                Assessment.deleted_at.is_(None),
            )
            .group_by(Assessment.offering_id)
        ).all()
    }


def _owned_offering_ids(
    db: Session, caller: User, offering_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these offerings the caller may act on (drives actionable_by_caller)."""
    if not offering_ids:
        return set()
    if caller.role in (Role.PRINCIPAL, Role.SECRETARY):
        return set(offering_ids)
    if caller.role != Role.TEACHER:
        return set()
    teacher_id = _teacher_profile_id(db, caller)
    return set(
        db.execute(
            select(ClassTeacher.offering_id).where(
                ClassTeacher.offering_id.in_(offering_ids),
                ClassTeacher.teacher_id == teacher_id,
            )
        ).scalars()
    )


def _decorate_offering_rows(db: Session, items: list, *, caller: User) -> None:
    """Attach course / semester / label / lecturers / meetings / counts in a fixed
    number of queries, whatever the row count."""
    if not items:
        return
    ids = [i.id for i in items]

    offerings = {
        o.id: o
        for o in db.execute(
            select(CourseOffering).where(CourseOffering.id.in_(ids))
        ).scalars()
    }
    course_ids = {o.course_id for o in offerings.values()}
    semester_ids = {o.semester_id for o in offerings.values()}
    courses = {
        c.id: c
        for c in db.execute(select(Course).where(Course.id.in_(course_ids))).scalars()
    }
    semesters = {
        s.id: s
        for s in db.execute(select(Semester).where(Semester.id.in_(semester_ids))).scalars()
    }
    teachers, leads = _teachers_map(db, ids)
    meetings = _meetings_map(db, ids)
    enrolled = _enrolled_counts(db, ids)
    owned = _owned_offering_ids(db, caller, ids)

    for item in items:
        o = offerings.get(item.id)
        if o is None:
            continue
        course = courses.get(o.course_id)
        semester = semesters.get(o.semester_id)
        item.course = CourseRef.model_validate(course) if course else None
        item.semester = SemesterRef.model_validate(semester) if semester else None
        item.section_code = o.section_code
        item.label = offering_label(course.code if course else "", o.section_code)
        item.teachers = teachers.get(o.id, [])
        item.lead_teacher_id = leads.get(o.id)
        item.meetings = meetings.get(o.id, [])
        item.enrolled_count = enrolled.get(o.id, 0)
        item.actionable_by_caller = o.id in owned


def _audit_stamp(db: Session, offering: CourseOffering) -> AuditStamp:
    ids = {i for i in (offering.created_by, offering.updated_by) if i is not None}
    actors: dict[uuid.UUID, UserRef] = {}
    if ids:
        for u in db.execute(select(User).where(User.id.in_(ids))).scalars():
            actors[u.id] = UserRef.model_validate(u)
    return AuditStamp(
        created_at=offering.created_at,
        updated_at=offering.updated_at,
        created_by=actors.get(offering.created_by) if offering.created_by else None,
        updated_by=actors.get(offering.updated_by) if offering.updated_by else None,
    )


def _detail(db: Session, offering: CourseOffering, *, caller: User):
    from app.modules.offerings.schemas import OfferingDetail

    year = _year_of(db, offering)
    capacity = offering.capacity
    detail = OfferingDetail(
        id=offering.id,
        capacity=capacity,
        is_archived=offering.is_archived,
        academic_year=AcademicYearRef.model_validate(year) if year else None,
        assessment_count=_assessment_counts(db, [offering.id]).get(offering.id, 0),
        audit=_audit_stamp(db, offering),
    )
    _decorate_offering_rows(db, [detail], caller=caller)
    detail.over_capacity = bool(
        capacity and capacity > 0 and detail.enrolled_count > capacity
    )
    return detail


# ──────────────────────────────────────────────────────────────────────────────
# Schedule helpers (FR-SCH-*)
# ──────────────────────────────────────────────────────────────────────────────
_DAY_NAMES = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri"}


def _slot_label(day_of_week: int, start: time, end: time) -> str:
    """"Mon 08:00-09:30" — the one place this is formatted, so every conflict message
    and every audit summary reads the same."""
    day = _DAY_NAMES.get(day_of_week, f"Day {day_of_week}")
    return f"{day} {start.strftime('%H:%M')}-{end.strftime('%H:%M')}"


def _overlaps(a_start: time, a_end: time, b_start: time, b_end: time) -> bool:
    """Half-open overlap: back-to-back meetings (09:30 end, 09:30 start) do NOT clash."""
    return a_start < b_end and b_start < a_end


def _labels_for(db: Session, offering_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """offering_id → display label, for conflict messages."""
    if not offering_ids:
        return {}
    rows = db.execute(
        select(CourseOffering.id, Course.code, CourseOffering.section_code)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(CourseOffering.id.in_(offering_ids))
    ).all()
    return {oid: offering_label(code, section) for (oid, code, section) in rows}


def _sibling_offering_ids(db: Session, offering: CourseOffering) -> list[uuid.UUID]:
    """Every OTHER live offering in the same academic year.

    Scoped to the year, not the term and not the whole college: a clash across years is
    meaningless, and comparing term-only would miss a Summer block overlapping a
    Semester 1 room booking.
    """
    return list(
        db.execute(
            select(CourseOffering.id)
            .join(Semester, Semester.id == CourseOffering.semester_id)
            .where(
                Semester.academic_year_id.in_(
                    select(Semester.academic_year_id).where(
                        Semester.id == offering.semester_id
                    )
                ),
                CourseOffering.id != offering.id,
                CourseOffering.deleted_at.is_(None),
            )
        ).scalars()
    )


def _teacher_room_conflicts(db: Session, *, offering: CourseOffering, proposed: list) -> list:
    """Lecturer- and room-level clashes for a proposed week on ONE offering."""
    from app.modules.offerings.schemas import ScheduleConflict

    conflicts: list[ScheduleConflict] = []
    if not proposed:
        return conflicts

    my_teacher_ids = set(
        db.execute(
            select(ClassTeacher.teacher_id).where(
                ClassTeacher.offering_id == offering.id
            )
        ).scalars()
    )

    other_ids = _sibling_offering_ids(db, offering)
    if not other_ids:
        return conflicts
    rows = db.execute(
        select(ClassMeeting)
        .where(
            ClassMeeting.offering_id.in_(other_ids),
            ClassMeeting.deleted_at.is_(None),
        )
    ).scalars().all()
    if not rows:
        return conflicts

    touched = list({m.offering_id for m in rows})
    teachers_by_offering, _leads = _teachers_map(db, touched)
    labels = _labels_for(db, touched)

    for want in proposed:
        for meeting in rows:
            if meeting.day_of_week != want.day_of_week:
                continue
            if not _overlaps(
                want.start_time, want.end_time, meeting.start_time, meeting.end_time
            ):
                continue
            slot = _slot_label(meeting.day_of_week, meeting.start_time, meeting.end_time)
            other_label = labels.get(meeting.offering_id, "another offering")

            for t in teachers_by_offering.get(meeting.offering_id, []):
                if t.id in my_teacher_ids:
                    conflicts.append(
                        ScheduleConflict(
                            kind="teacher",
                            label=t.full_name,
                            with_offering_id=meeting.offering_id,
                            with_offering_label=other_label,
                            day_of_week=meeting.day_of_week,
                            start_time=meeting.start_time,
                            end_time=meeting.end_time,
                            message=f"{t.full_name} also teaches {other_label} at {slot}.",
                        )
                    )

            # Room comparison is case-insensitive on trimmed text: the office types
            # "Lab 1" and "lab 1" interchangeably, and a clash the user can see but the
            # system cannot is worse than no check at all.
            want_room = (want.room or "").strip().lower()
            other_room = (meeting.room or "").strip().lower()
            if want_room and want_room == other_room:
                conflicts.append(
                    ScheduleConflict(
                        kind="room",
                        label=meeting.room or "",
                        with_offering_id=meeting.offering_id,
                        with_offering_label=other_label,
                        day_of_week=meeting.day_of_week,
                        start_time=meeting.start_time,
                        end_time=meeting.end_time,
                        message=f"{meeting.room} is already used by {other_label} at {slot}.",
                    )
                )
    return conflicts


def _student_enrol_conflicts(
    db: Session,
    *,
    offering: CourseOffering,
    student_ids: list[uuid.UUID],
    semester_id: uuid.UUID,
) -> list:
    """Clashes between this offering's week and what the given students already sit.

    Only ACTIVE enrolments for `semester_id` count — a withdrawn one frees the slot.
    """
    from app.modules.offerings.schemas import ScheduleConflict

    conflicts: list[ScheduleConflict] = []
    if not student_ids:
        return conflicts
    mine = list(_meetings_map(db, [offering.id]).get(offering.id, []))
    if not mine:
        return conflicts

    rows = db.execute(
        select(ClassEnrollment.student_id, StudentProfile.full_name, ClassMeeting)
        .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
        .join(ClassMeeting, ClassMeeting.offering_id == ClassEnrollment.offering_id)
        .where(
            ClassEnrollment.student_id.in_(student_ids),
            ClassEnrollment.semester_id == semester_id,
            ClassEnrollment.unenrolled_at.is_(None),
            ClassEnrollment.offering_id != offering.id,
            ClassMeeting.deleted_at.is_(None),
        )
    ).all()
    labels = _labels_for(db, list({m.offering_id for (_s, _n, m) in rows}))

    for _sid, student_name, meeting in rows:
        for want in mine:
            if meeting.day_of_week != want.day_of_week:
                continue
            if not _overlaps(
                want.start_time, want.end_time, meeting.start_time, meeting.end_time
            ):
                continue
            slot = _slot_label(meeting.day_of_week, meeting.start_time, meeting.end_time)
            other_label = labels.get(meeting.offering_id, "another offering")
            conflicts.append(
                ScheduleConflict(
                    kind="student",
                    label=student_name,
                    with_offering_id=meeting.offering_id,
                    with_offering_label=other_label,
                    day_of_week=meeting.day_of_week,
                    start_time=meeting.start_time,
                    end_time=meeting.end_time,
                    message=f"{student_name} already has {other_label} at {slot}.",
                )
            )
    return conflicts


def _roster_entry(enr: ClassEnrollment, student: StudentProfile):
    from app.modules.offerings.schemas import RosterEntry

    return RosterEntry(
        enrollment_id=enr.id,
        student=StudentRef.model_validate(student),
        enrolled_at=enr.enrolled_at,
        unenrolled_at=enr.unenrolled_at,
        enrollment_status=enr.enrollment_status,
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /offerings
# ══════════════════════════════════════════════════════════════════════════════
def list_offerings(
    db: Session,
    *,
    caller: User,
    params: PageParams,
    search: str | None,
    academic_year_id: uuid.UUID | None,
    semester_id: uuid.UUID | None = None,
    course_id: uuid.UUID | None = None,
):
    """GET /offerings. Defaults to the active year; Lecturer scoped to what they teach,
    Student scoped to what they are actively enrolled in.

    `grade_level` is gone as a filter — it was the homeroom's Form level (D31). Filtering
    is now by term (`semester_id`), by year, or by catalog course.
    """
    if academic_year_id is None and semester_id is None:
        academic_year_id = db.scalar(
            select(AcademicYear.id).where(AcademicYear.status == "active")
        )

    stmt = (
        select(CourseOffering)
        .join(Course, CourseOffering.course_id == Course.id)
        .join(Semester, CourseOffering.semester_id == Semester.id)
        .where(CourseOffering.deleted_at.is_(None))
    )
    if semester_id is not None:
        stmt = stmt.where(CourseOffering.semester_id == semester_id)
    elif academic_year_id is not None:
        stmt = stmt.where(Semester.academic_year_id == academic_year_id)
    if course_id is not None:
        stmt = stmt.where(CourseOffering.course_id == course_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(Course.code.ilike(like) | Course.name.ilike(like))

    if caller.role == Role.TEACHER:
        teacher_id = _teacher_profile_id(db, caller)
        owns = (
            select(ClassTeacher.id)
            .where(
                ClassTeacher.offering_id == CourseOffering.id,
                ClassTeacher.teacher_id == teacher_id,
            )
            .exists()
        )
        stmt = stmt.where(owns)
    elif caller.role == Role.STUDENT:
        sid = _student_profile_id_or_none(db, caller)
        if sid is None:
            stmt = stmt.where(False)  # no profile → empty page
        else:
            enrolled = (
                select(ClassEnrollment.id)
                .where(
                    ClassEnrollment.offering_id == CourseOffering.id,
                    ClassEnrollment.student_id == sid,
                    ClassEnrollment.unenrolled_at.is_(None),
                )
                .exists()
            )
            stmt = stmt.where(enrolled)

    sort = (params.sort or "label").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    cols = _OFFERING_SORT_FIELDS.get(key)
    if cols is None:
        raise ValidationError(f"Unknown sort field '{key}'.", code="invalid_sort_field")
    stmt = stmt.order_by(
        *[c.desc() if desc else c.asc() for c in cols], CourseOffering.id.asc()
    )

    from app.modules.offerings.schemas import OfferingListItem

    page = paginate(db, stmt, params, serialize=OfferingListItem.model_validate)
    _decorate_offering_rows(db, page.items, caller=caller)
    return page


# ══════════════════════════════════════════════════════════════════════════════
# GET /offerings/{id}
# ══════════════════════════════════════════════════════════════════════════════
def get_offering(db: Session, *, caller: User, offering_id: uuid.UUID):
    offering = _offering_or_404(db, offering_id)
    _assert_caller_can_read(db, caller, offering)
    return _detail(db, offering, caller=caller)


def _assert_caller_can_read(db: Session, caller: User, offering: CourseOffering) -> None:
    """Dean/Registrar: any. Lecturer: teaches it (else 404). Student: actively enrolled
    (else 404). No existence leak (§3.3)."""
    if caller.role in (Role.PRINCIPAL, Role.SECRETARY):
        return
    if caller.role == Role.TEACHER:
        # Same wording as `_offering_or_404`, so "you do not teach it" and "it does
        # not exist" are byte-identical responses.
        assert_teacher_owns_offering(
            db, caller, offering.id, message="Offering not found."
        )
        return
    sid = _student_profile_id_or_none(db, caller)
    enrolled = sid is not None and db.scalar(
        select(ClassEnrollment.id)
        .where(
            ClassEnrollment.offering_id == offering.id,
            ClassEnrollment.student_id == sid,
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .exists()
        .select()
    )
    if not enrolled:
        raise NotFound("Offering not found.", code="not_found")


# ══════════════════════════════════════════════════════════════════════════════
# POST /offerings
# ══════════════════════════════════════════════════════════════════════════════
def create_offering(db: Session, *, actor: User, payload):
    """Schedule a course in a term, with optional lecturers and weekly meetings — all in
    ONE transaction.

    Atomic on purpose: a partially created offering (course chosen, lecturers lost) would
    leave the office holding a row nobody owns. Nothing is committed until every piece
    validates.
    """
    semester_id = payload.semester_id or _active_semester_id(db)
    if semester_id is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")
    semester = db.get(Semester, semester_id)
    if semester is None:
        raise NotFound("Semester not found.", code="semester_not_found")

    year = db.get(AcademicYear, semester.academic_year_id)
    if year is None:
        raise NotFound("Academic year not found.", code="year_not_found")
    if year.archived_at is not None or year.status == "archived":
        raise Conflict(
            "Cannot add an offering to an archived year.", code="year_archived"
        )

    course = db.scalar(
        select(Course).where(
            Course.id == payload.course_id, Course.deleted_at.is_(None)
        )
    )
    if course is None:
        raise NotFound("Course not found.", code="course_not_found")

    section_code = (payload.section_code or "").strip() or None
    _assert_identity_free(
        db,
        course_id=course.id,
        semester_id=semester_id,
        section_code=section_code,
    )

    teacher_ids, lead = _validated_teacher_set(
        db, teacher_ids=payload.teacher_ids, lead_teacher_id=payload.lead_teacher_id
    )

    offering = CourseOffering(
        course_id=course.id,
        semester_id=semester_id,
        section_code=section_code,
        capacity=payload.capacity,
        is_archived=False,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(offering)
    db.flush()

    for tid in teacher_ids:
        db.add(
            ClassTeacher(
                offering_id=offering.id,
                teacher_id=tid,
                is_lead=(tid == lead),
                created_by=actor.id,
                updated_by=actor.id,
            )
        )
    for want in payload.meetings:
        db.add(
            ClassMeeting(
                offering_id=offering.id,
                day_of_week=want.day_of_week,
                start_time=want.start_time,
                end_time=want.end_time,
                room=(want.room or None),
                created_by=actor.id,
                updated_by=actor.id,
            )
        )

    _audit(
        db,
        actor=actor,
        action="offering.create",
        entity_id=offering.id,
        summary={
            "label": offering_label(course.code, section_code),
            "course_id": str(course.id),
            "semester_id": str(semester_id),
            "teacher_ids": [str(t) for t in teacher_ids],
            "meeting_count": len(payload.meetings),
        },
    )
    db.commit()
    return _detail(db, offering, caller=actor)


# ══════════════════════════════════════════════════════════════════════════════
# PATCH /offerings/{id}
# ══════════════════════════════════════════════════════════════════════════════
def update_offering(db: Session, *, actor: User, offering_id: uuid.UUID, payload):
    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)

    if payload.section_code is not None:
        wanted = payload.section_code.strip() or None
        if wanted != offering.section_code:
            _assert_identity_free(
                db,
                course_id=offering.course_id,
                semester_id=offering.semester_id,
                section_code=wanted,
                exclude_id=offering.id,
            )
            offering.section_code = wanted
    if payload.capacity is not None:
        offering.capacity = payload.capacity
    if payload.is_archived is not None:
        offering.is_archived = payload.is_archived

    offering.updated_by = actor.id
    _audit(db, actor=actor, action="offering.update", entity_id=offering.id)
    db.commit()
    return _detail(db, offering, caller=actor)


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /offerings/{id}
# ══════════════════════════════════════════════════════════════════════════════
def delete_offering(db: Session, *, actor: User, offering_id: uuid.UUID) -> None:
    """Soft-delete an offering only if it has no academic history (no assessments, no
    attendance). Else 409 offering_has_history ('archive instead'). Closes active
    enrolments and removes lecturer assignments."""
    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)

    from app.modules.assessments.models import Assessment
    from app.modules.attendance.models import AttendanceRecord

    has_assessments = db.scalar(
        select(Assessment.id).where(Assessment.offering_id == offering.id).limit(1)
    )
    has_attendance = db.scalar(
        select(AttendanceRecord.id)
        .where(AttendanceRecord.offering_id == offering.id)
        .limit(1)
    )
    if has_assessments is not None or has_attendance is not None:
        raise Conflict(
            "This offering has academic history — archive it instead.",
            code="offering_has_history",
        )

    now = _now()
    for enr in db.execute(
        select(ClassEnrollment).where(
            ClassEnrollment.offering_id == offering.id,
            ClassEnrollment.unenrolled_at.is_(None),
        )
    ).scalars():
        enr.unenrolled_at = now
        enr.updated_by = actor.id
    for ct in db.execute(
        select(ClassTeacher).where(ClassTeacher.offering_id == offering.id)
    ).scalars():
        db.delete(ct)

    offering.deleted_at = now
    offering.updated_by = actor.id
    _audit(db, actor=actor, action="offering.delete", entity_id=offering.id)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# PUT /offerings/{id}/teachers
# ══════════════════════════════════════════════════════════════════════════════
def assign_teachers(db: Session, *, actor: User, offering_id: uuid.UUID, payload):
    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)

    teacher_ids, lead = _validated_teacher_set(
        db, teacher_ids=payload.teacher_ids, lead_teacher_id=payload.lead_teacher_id
    )

    # Replace the assignment set.
    for ct in db.execute(
        select(ClassTeacher).where(ClassTeacher.offering_id == offering.id)
    ).scalars():
        db.delete(ct)
    db.flush()
    for tid in teacher_ids:
        db.add(
            ClassTeacher(
                offering_id=offering.id,
                teacher_id=tid,
                is_lead=(tid == lead),
                created_by=actor.id,
                updated_by=actor.id,
            )
        )
    _audit(
        db,
        actor=actor,
        action="offering.assign_teachers",
        entity_id=offering.id,
        summary={
            "teacher_ids": [str(t) for t in teacher_ids],
            "lead_teacher_id": str(lead) if lead else None,
        },
    )
    db.commit()
    return _detail(db, offering, caller=actor)


# ══════════════════════════════════════════════════════════════════════════════
# GET /offerings/{id}/roster
# ══════════════════════════════════════════════════════════════════════════════
def get_roster(
    db: Session,
    *,
    caller: User,
    offering_id: uuid.UUID,
    semester_id: uuid.UUID | None,
    include: str | None,
):
    offering = _offering_or_404(db, offering_id)
    if caller.role == Role.TEACHER:
        assert_teacher_owns_offering(db, caller, offering.id)  # 404 if not owner

    # D31: the term is the OFFERING's. An explicit semester_id may narrow but not
    # contradict it — see the module docstring.
    target_semester = semester_id or offering.semester_id

    stmt = (
        select(ClassEnrollment, StudentProfile)
        .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
        .where(
            ClassEnrollment.offering_id == offering.id,
            ClassEnrollment.semester_id == target_semester,
        )
    )
    if include != "withdrawn":
        stmt = stmt.where(ClassEnrollment.unenrolled_at.is_(None))
    stmt = stmt.order_by(*STUDENT_NAME_ORDER)

    rows = db.execute(stmt).all()
    return [_roster_entry(enr, student) for (enr, student) in rows]


# ══════════════════════════════════════════════════════════════════════════════
# GET /offerings/{id}/enrollable-students
# ══════════════════════════════════════════════════════════════════════════════
def enrollable_students(
    db: Session, *, offering_id: uuid.UUID, semester_id: uuid.UUID | None, search: str | None
):
    offering = _offering_or_404(db, offering_id)
    target_semester = semester_id or offering.semester_id

    already = select(ClassEnrollment.student_id).where(
        ClassEnrollment.offering_id == offering.id,
        ClassEnrollment.semester_id == target_semester,
        ClassEnrollment.unenrolled_at.is_(None),
    )

    stmt = select(StudentProfile).where(
        StudentProfile.deleted_at.is_(None),
        StudentProfile.status == StudentStatus.REGISTERED,
        StudentProfile.id.notin_(already),
    )
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            StudentProfile.full_name.ilike(like)
            | StudentProfile.student_number.ilike(like)
        )
    stmt = stmt.order_by(*STUDENT_NAME_ORDER).limit(200)

    from app.modules.offerings.schemas import EnrollableStudents

    rows = db.execute(stmt).scalars().all()
    return EnrollableStudents(items=[StudentRef.model_validate(s) for s in rows])


# ══════════════════════════════════════════════════════════════════════════════
# POST /offerings/{id}/enrollments
# ══════════════════════════════════════════════════════════════════════════════
def course_id_for_offering(db: Session, offering_id: uuid.UUID) -> uuid.UUID | None:
    """The CATALOG course an offering teaches.

    Trivial since D31 — an offering holds `course_id` directly, where it used to require
    a hop through `class_subjects`. Kept as a named function because
    `students/service.py` calls it and the prerequisite gate reads better for it.
    """
    return db.scalar(
        select(CourseOffering.course_id).where(
            CourseOffering.id == offering_id, CourseOffering.deleted_at.is_(None)
        )
    )


def _assert_prerequisites_met(
    db: Session,
    *,
    offering: CourseOffering,
    students: list[StudentProfile],
    semester_id: uuid.UUID,
) -> None:
    """Refuse the whole enrolment if ANY student is short (D30 §D4).

    Imported inside the function: `prerequisites.service` reads grades, which reads
    offerings, and a module-level import would close the cycle.
    """
    from app.modules.prerequisites import service as prereq_service

    for student in students:
        prereq_service.assert_eligible(
            db, student=student, course_id=offering.course_id, semester_id=semester_id
        )


def enroll_students(db: Session, *, actor: User, offering_id: uuid.UUID, payload):
    """Enrol students into THIS offering, leaving their other offerings alone.

    Purely additive: a timetable clash is reported in `schedule_conflicts` and the
    enrolment still succeeds (warn-only, per D-Q6). A missing prerequisite is not — see
    below.
    """
    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)

    # D31: an offering runs in exactly one term, so that is the term a student registers
    # for. Accepting a different one would let a row claim a term the offering does not
    # run in, which no screen could then explain.
    semester_id = payload.semester_id or offering.semester_id
    if semester_id != offering.semester_id:
        raise Conflict(
            "This offering runs in a different term.", code="semester_mismatch"
        )

    students = {
        s.id: s
        for s in db.execute(
            select(StudentProfile).where(
                StudentProfile.id.in_(payload.student_ids),
                StudentProfile.deleted_at.is_(None),
            )
        ).scalars()
    }
    missing = [sid for sid in payload.student_ids if sid not in students]
    if missing:
        raise NotFound("Student not found.", code="student_not_found")

    from app.modules.offerings.schemas import EnrollmentResult

    now = _now()

    # Computed BEFORE the inserts: it asks "what does this student already sit that
    # overlaps us", and the new rows would otherwise be compared against themselves.
    conflicts = _student_enrol_conflicts(
        db,
        offering=offering,
        student_ids=list(payload.student_ids),
        semester_id=semester_id,
    )

    # D30 §D4 — the prerequisite gate. Checked for EVERY student BEFORE anything is
    # written, so a blocked student cannot leave the rest of the batch half-enrolled:
    # this endpoint takes a list, and a failure part-way through would commit the
    # students before it and reject the ones after.
    #
    # A conflict here is a 409 naming the missing courses and the grade actually earned —
    # the Registrar has to be able to tell "one course short" from "sat it and failed".
    # Warn-only was considered and rejected: unlike a timetable clash (D-Q6), a missing
    # prerequisite is not fixed by the next edit.
    _assert_prerequisites_met(
        db,
        offering=offering,
        students=[students[sid] for sid in payload.student_ids],
        semester_id=semester_id,
    )

    for sid in payload.student_ids:
        # Already active in THIS offering for the term? idempotent — skip create.
        here = db.scalar(
            select(ClassEnrollment).where(
                ClassEnrollment.offering_id == offering.id,
                ClassEnrollment.student_id == sid,
                ClassEnrollment.semester_id == semester_id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        )
        if here is not None:
            continue
        db.add(
            ClassEnrollment(
                offering_id=offering.id,
                student_id=sid,
                semester_id=semester_id,
                enrolled_at=now,
                # D35 — the client's `coursestatus`, applied to the whole batch. Defaults
                # to `enrolled`, so every pre-D35 caller is unchanged.
                enrollment_status=payload.enrollment_status,
                created_by=actor.id,
                updated_by=actor.id,
            )
        )

    _audit(
        db,
        actor=actor,
        action="offering.enroll",
        entity_id=offering.id,
        summary={
            "student_ids": [str(s) for s in payload.student_ids],
            "semester_id": str(semester_id),
            "enrollment_status": payload.enrollment_status.value,
        },
    )
    db.commit()

    rows = db.execute(
        select(ClassEnrollment, StudentProfile)
        .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
        .where(
            ClassEnrollment.offering_id == offering.id,
            ClassEnrollment.semester_id == semester_id,
            ClassEnrollment.student_id.in_(payload.student_ids),
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .order_by(*STUDENT_NAME_ORDER)
    ).all()
    enrolled = [_roster_entry(enr, student) for (enr, student) in rows]

    total_active = _enrolled_counts(db, [offering.id]).get(offering.id, 0)
    over = bool(
        offering.capacity and offering.capacity > 0 and total_active > offering.capacity
    )
    return EnrollmentResult(
        enrolled=enrolled, over_capacity_warning=over, schedule_conflicts=conflicts
    )


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /offerings/{id}/enrollments/{enrollment_id}
# ══════════════════════════════════════════════════════════════════════════════
def unenroll_student(
    db: Session, *, actor: User, offering_id: uuid.UUID, enrollment_id: uuid.UUID
) -> None:
    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)
    enr = db.scalar(
        select(ClassEnrollment).where(
            ClassEnrollment.id == enrollment_id,
            ClassEnrollment.offering_id == offering.id,
        )
    )
    if enr is None:
        raise NotFound("Enrollment not found.", code="not_found")
    if enr.unenrolled_at is None:
        enr.unenrolled_at = _now()
        enr.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="offering.unenroll",
        entity_id=offering.id,
        summary={"enrollment_id": str(enrollment_id)},
    )
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# PATCH /offerings/{id}/enrollments/{enrollment_id} — the client's `coursestatus`
# ══════════════════════════════════════════════════════════════════════════════
def set_enrollment_status(
    db: Session,
    *,
    actor: User,
    offering_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    payload,
):
    """Change HOW one student is sitting one offering (D35 — the client's `coursestatus`).

    **Deliberately NOT `DELETE`.** Un-enrolling closes the row with `unenrolled_at` and
    takes the student off the roster, which says the registration was a mistake. A
    WITHDRAWAL is the opposite claim: the student did sit the course and then left, and the
    transcript has to print `W/P` or `W/F` against it. So the row stays open and on the
    roster — deleting it would erase the very thing being recorded.

    **An un-enrolled row is refused**, because there is nothing to describe: the student is
    not sitting the offering at all. Re-enrol them first if the intent was to reinstate.

    The change is audited with the before/after and the reason, which is the only place the
    reason is kept — `class_enrollments` has no column for it, and inventing one to hold
    free text that nothing reads would be worse than the audit row that already exists for
    exactly this purpose.
    """
    from app.modules.offerings.schemas import RosterEntry  # noqa: F401 - shape only

    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)

    enr = db.scalar(
        select(ClassEnrollment).where(
            ClassEnrollment.id == enrollment_id,
            ClassEnrollment.offering_id == offering.id,
        )
    )
    if enr is None:
        raise NotFound("Enrollment not found.", code="not_found")
    if enr.unenrolled_at is not None:
        raise Conflict(
            "This student is no longer enrolled in the offering, so their course status "
            "cannot be set. Re-enrol them first.",
            code="enrollment_closed",
        )

    before = enr.enrollment_status
    after = payload.enrollment_status
    enr.enrollment_status = after
    enr.updated_by = actor.id

    _audit(
        db,
        actor=actor,
        action="offering.enrollment_status",
        entity_id=offering.id,
        summary={
            "enrollment_id": str(enrollment_id),
            "student_id": str(enr.student_id),
            "before": before.value,
            "after": after.value,
            "reason": payload.reason,
        },
    )
    db.commit()

    student = db.get(StudentProfile, enr.student_id)
    return _roster_entry(enr, student)


# ══════════════════════════════════════════════════════════════════════════════
# GET /offerings/{id}/meetings
# ══════════════════════════════════════════════════════════════════════════════
def list_meetings(db: Session, *, caller: User, offering_id: uuid.UUID):
    """The offering's weekly schedule. Readable by anyone who can read the offering, so a
    student sees when their own course meets and a lecturer sees their own week."""
    from app.modules.offerings.schemas import MeetingsResult

    offering = _offering_or_404(db, offering_id)
    _assert_caller_can_read(db, caller, offering)
    return MeetingsResult(
        meetings=_meetings_map(db, [offering.id]).get(offering.id, []), conflicts=[]
    )


# ══════════════════════════════════════════════════════════════════════════════
# PUT /offerings/{id}/meetings
# ══════════════════════════════════════════════════════════════════════════════
def replace_meetings(db: Session, *, actor: User, offering_id: uuid.UUID, payload):
    """Replace the offering's whole weekly schedule.

    Hard-deletes the old rows rather than soft-deleting them: a meeting is a recurring
    calendar slot, not a record of anything that happened, so nothing references it
    historically (attendance is keyed by date, not by meeting) and accumulating tombstones
    would only slow the timetable joins.

    Overlaps do not block the write — see `MeetingsResult`. Two kinds are checked:
    self-overlap inside the submitted week (a straight input mistake) and clashes with
    other offerings in the same year.
    """
    from app.modules.offerings.schemas import MeetingsResult, ScheduleConflict

    offering = _offering_or_404(db, offering_id)
    _assert_year_writable(db, offering)

    my_label = _labels_for(db, [offering.id]).get(offering.id, "this offering")
    wanted = list(payload.meetings)

    # Self-overlap: the offering cannot be in two places at once.
    self_conflicts: list[ScheduleConflict] = []
    for i, a in enumerate(wanted):
        for b in wanted[i + 1 :]:
            if a.day_of_week == b.day_of_week and _overlaps(
                a.start_time, a.end_time, b.start_time, b.end_time
            ):
                self_conflicts.append(
                    ScheduleConflict(
                        kind="room" if (a.room and a.room == b.room) else "teacher",
                        label=my_label,
                        with_offering_id=offering.id,
                        with_offering_label=my_label,
                        day_of_week=b.day_of_week,
                        start_time=b.start_time,
                        end_time=b.end_time,
                        message=(
                            f"{my_label} has two overlapping meetings at "
                            f"{_slot_label(b.day_of_week, b.start_time, b.end_time)}."
                        ),
                    )
                )

    conflicts = self_conflicts + _teacher_room_conflicts(
        db, offering=offering, proposed=wanted
    )

    for old in db.execute(
        select(ClassMeeting).where(ClassMeeting.offering_id == offering.id)
    ).scalars():
        db.delete(old)
    db.flush()

    for want in wanted:
        db.add(
            ClassMeeting(
                offering_id=offering.id,
                day_of_week=want.day_of_week,
                start_time=want.start_time,
                end_time=want.end_time,
                room=(want.room.strip() or None) if want.room else None,
                created_by=actor.id,
                updated_by=actor.id,
            )
        )

    _audit(
        db,
        actor=actor,
        action="offering.replace_meetings",
        entity_id=offering.id,
        summary={
            "slots": [
                _slot_label(w.day_of_week, w.start_time, w.end_time) for w in wanted
            ],
            "conflict_count": len(conflicts),
        },
    )
    db.commit()
    return MeetingsResult(
        meetings=_meetings_map(db, [offering.id]).get(offering.id, []),
        conflicts=conflicts,
    )

"""Classes service (api-spec §5 Module 5, FR-CLS-01..10, FR-SCH-01..06).

Owns DB access + transactions for the Classes endpoints; routers are thin.

**D29 — a class is a SUBJECT CLASS** ("Math-1"), not a homeroom. The two behavioural
consequences that live in this file:

  1. `enroll_students` no longer transfers. It used to close a student's active
     enrolment anywhere else in the semester, which was the entire "one section per
     student" rule — and under D29 it would silently drop Freddy from Math the moment
     the office added him to Biology. Clashes are now reported, not resolved.
  2. `create_class` attaches the class's single subject (and optionally its teachers
     and weekly meetings) in the same transaction, so a half-created subject class
     with no subject can never exist.

Cross-cutting discipline (api-spec §3):
  * 404-vs-403 — record/ownership denial → 404 (no existence leak). Teacher scope
    reuses `assert_teacher_owns_section` (rbac.py). Role denial is the router gate.
  * Every WRITE path rejects a section in an archived academic year → 409
    year_archived (FR-CLS-06, schema §5 rule 7).
  * Uniqueness of section name per year is enforced by the DB partial-unique index
    (`uq_classes_year_name` over the `active_class_name` generated column); we
    pre-check for the documented 409 code.

Derived data (matches the frontend selectors):
  * enrolled_count = active roster rows (unenrolled_at IS NULL) for the class.
  * over_capacity  = capacity set (>0) and enrolled_count > capacity (warn-only).
  * subject / teachers / meetings = the class's single offering, its assigned
    teachers, and its weekly schedule, batched onto list rows to avoid client N+1.
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
    StudentRef,
    SubjectRef,
    TeacherRef,
    UserRef,
)
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id, assert_teacher_owns_section
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassMeeting,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User

_CLASS_SORT_FIELDS = {
    "name": Class.name,
    "grade_level": Class.grade_level,
    "created_at": Class.created_at,
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
            entity_type="class",
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + guards
# ──────────────────────────────────────────────────────────────────────────────
def _class_or_404(db: Session, class_id: uuid.UUID) -> Class:
    section = db.scalar(
        select(Class).where(Class.id == class_id, Class.deleted_at.is_(None))
    )
    if section is None:
        raise NotFound("Section not found.", code="not_found")
    return section


def _active_semester_id(db: Session) -> uuid.UUID | None:
    return db.scalar(select(Semester.id).where(Semester.is_active.is_(True)))


def _assert_year_writable(db: Session, section: Class) -> None:
    """Reject any write on a section whose academic year is archived (FR-CLS-06)."""
    if section.is_archived:
        raise Conflict("This section's year is archived.", code="year_archived")
    year = db.get(AcademicYear, section.academic_year_id)
    if year is not None and year.archived_at is not None:
        raise Conflict("This section's year is archived.", code="year_archived")


def _assert_name_unique_in_year(
    db: Session,
    *,
    name: str,
    academic_year_id: uuid.UUID,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(Class.id).where(
        Class.academic_year_id == academic_year_id,
        func.lower(Class.name) == name.strip().lower(),
        Class.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Class.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A section with this name already exists for the year.",
            code="duplicate_class_name",
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
    """Dedupe, validate existence, and resolve the lead for a teacher assignment.

    Shared by `create_class` and `assign_teachers` so the lead-must-be-a-member rule
    and the "lead defaults to the first teacher" fallback cannot drift between the
    create path and the later reassign path.
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
            raise NotFound("Teacher not found.", code="teacher_not_found")
    return ids, lead


# ──────────────────────────────────────────────────────────────────────────────
# Shaping helpers
# ──────────────────────────────────────────────────────────────────────────────
def _enrolled_counts(db: Session, class_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not class_ids:
        return {}
    rows = db.execute(
        select(ClassEnrollment.class_id, func.count())
        .where(
            ClassEnrollment.class_id.in_(class_ids),
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .group_by(ClassEnrollment.class_id)
    ).all()
    return {cid: n for (cid, n) in rows}


def _offering_of(db: Session, class_id: uuid.UUID) -> ClassSubject | None:
    """The class's single live offering (D29), or None for a pre-D29 empty class.

    Ordered by `id` so a legacy multi-subject class resolves deterministically rather
    than returning whichever row the planner happened to hand back first.
    """
    return db.scalar(
        select(ClassSubject)
        .where(ClassSubject.class_id == class_id, ClassSubject.deleted_at.is_(None))
        .order_by(ClassSubject.id.asc())
        .limit(1)
    )


def _offering_map(
    db: Session, class_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[ClassSubject, Subject]]:
    """class_id → (offering, subject) for many classes in one query.

    Keeps the FIRST offering per class by id, matching `_offering_of`'s tiebreak so a
    list row and its detail page never disagree about which subject a legacy
    multi-subject class teaches.
    """
    if not class_ids:
        return {}
    rows = db.execute(
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(
            ClassSubject.class_id.in_(class_ids),
            ClassSubject.deleted_at.is_(None),
        )
        .order_by(ClassSubject.class_id.asc(), ClassSubject.id.asc())
    ).all()
    out: dict[uuid.UUID, tuple[ClassSubject, Subject]] = {}
    for cs, subj in rows:
        out.setdefault(cs.class_id, (cs, subj))
    return out


def _teachers_map(
    db: Session, class_subject_ids: list[uuid.UUID]
) -> tuple[dict[uuid.UUID, list[TeacherRef]], dict[uuid.UUID, uuid.UUID]]:
    """class_subject_id → (teachers ordered lead-first, lead teacher id)."""
    if not class_subject_ids:
        return {}, {}
    rows = db.execute(
        select(ClassTeacher, TeacherProfile)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.class_subject_id.in_(class_subject_ids))
        .order_by(ClassTeacher.is_lead.desc(), TeacherProfile.full_name.asc())
    ).all()
    teachers: dict[uuid.UUID, list[TeacherRef]] = {}
    leads: dict[uuid.UUID, uuid.UUID] = {}
    for ct, tp in rows:
        teachers.setdefault(ct.class_subject_id, []).append(TeacherRef.model_validate(tp))
        if ct.is_lead:
            leads[ct.class_subject_id] = tp.id
    return teachers, leads


def _meetings_map(db: Session, class_subject_ids: list[uuid.UUID]) -> dict[uuid.UUID, list]:
    """class_subject_id → its weekly meetings, in Mon→Fri / earliest-first order."""
    from app.modules.classes.schemas import ClassMeetingItem

    if not class_subject_ids:
        return {}
    rows = db.execute(
        select(ClassMeeting)
        .where(
            ClassMeeting.class_subject_id.in_(class_subject_ids),
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
        out.setdefault(m.class_subject_id, []).append(ClassMeetingItem.model_validate(m))
    return out


def _decorate_class_rows(db: Session, items: list) -> None:
    """Attach subject / class_subject_id / teachers / meetings to ClassListItem or
    ClassDetail rows in a fixed number of queries, whatever the row count."""
    if not items:
        return
    class_ids = [i.id for i in items]
    offerings = _offering_map(db, class_ids)
    cs_ids = [cs.id for (cs, _s) in offerings.values()]
    teachers, leads = _teachers_map(db, cs_ids)
    meetings = _meetings_map(db, cs_ids)
    for item in items:
        pair = offerings.get(item.id)
        if pair is None:
            continue
        cs, subj = pair
        item.class_subject_id = cs.id
        item.subject = SubjectRef.model_validate(subj)
        item.teachers = teachers.get(cs.id, [])
        item.lead_teacher_id = leads.get(cs.id)
        item.meetings = meetings.get(cs.id, [])


def _audit_stamp(db: Session, section: Class) -> AuditStamp:
    ids = {i for i in (section.created_by, section.updated_by) if i is not None}
    actors: dict[uuid.UUID, UserRef] = {}
    if ids:
        for u in db.execute(select(User).where(User.id.in_(ids))).scalars():
            actors[u.id] = UserRef.model_validate(u)
    return AuditStamp(
        created_at=section.created_at,
        updated_at=section.updated_at,
        created_by=actors.get(section.created_by) if section.created_by else None,
        updated_by=actors.get(section.updated_by) if section.updated_by else None,
    )


def _detail(db: Session, section: Class) -> ClassDetail:
    from app.modules.classes.schemas import ClassDetail

    enrolled = _enrolled_counts(db, [section.id]).get(section.id, 0)
    year = db.get(AcademicYear, section.academic_year_id)
    capacity = section.capacity
    detail = ClassDetail(
        id=section.id,
        name=section.name,
        grade_level=section.grade_level,
        section=section.section,
        capacity=capacity,
        academic_year=AcademicYearRef.model_validate(year),
        enrolled_count=enrolled,
        over_capacity=bool(capacity and capacity > 0 and enrolled > capacity),
        is_archived=section.is_archived,
        audit=_audit_stamp(db, section),
    )
    _decorate_class_rows(db, [detail])
    return detail


# ──────────────────────────────────────────────────────────────────────────────
# Schedule helpers (D29 / FR-SCH-*)
# ──────────────────────────────────────────────────────────────────────────────
_DAY_NAMES = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri"}


def _slot_label(day_of_week: int, start: time, end: time) -> str:
    """"Mon 08:00–09:30" — the one place this is formatted, so every conflict
    message and every audit summary reads the same."""
    day = _DAY_NAMES.get(day_of_week, f"Day {day_of_week}")
    return f"{day} {start.strftime('%H:%M')}–{end.strftime('%H:%M')}"


def _overlaps(a_start: time, a_end: time, b_start: time, b_end: time) -> bool:
    """Half-open overlap: back-to-back meetings (09:30 end, 09:30 start) do NOT clash."""
    return a_start < b_end and b_start < a_end


def _meeting_rows_for_classes(db: Session, class_ids: list[uuid.UUID]) -> list[tuple]:
    """(meeting, class) for every live meeting of the given classes."""
    if not class_ids:
        return []
    return db.execute(
        select(ClassMeeting, Class)
        .join(ClassSubject, ClassMeeting.class_subject_id == ClassSubject.id)
        .join(Class, ClassSubject.class_id == Class.id)
        .where(
            ClassSubject.class_id.in_(class_ids),
            ClassMeeting.deleted_at.is_(None),
            ClassSubject.deleted_at.is_(None),
            Class.deleted_at.is_(None),
        )
    ).all()


def _teacher_room_conflicts(
    db: Session, *, section: Class, cs: ClassSubject, proposed: list
) -> list:
    """Teacher- and room-level clashes for a proposed week on ONE class.

    Compares against every OTHER live class in the same academic year: a clash across
    years is meaningless, and comparing school-wide would flag last year's timetable.
    """
    from app.modules.classes.schemas import ScheduleConflict

    conflicts: list[ScheduleConflict] = []
    if not proposed:
        return conflicts

    teacher_names = {
        tid: name
        for (tid, name) in db.execute(
            select(TeacherProfile.id, TeacherProfile.full_name).join(
                ClassTeacher, ClassTeacher.teacher_id == TeacherProfile.id
            ).where(ClassTeacher.class_subject_id == cs.id)
        ).all()
    }
    my_teacher_ids = set(teacher_names)

    # Every other class in the year, with its meetings and teachers.
    other_ids = list(
        db.execute(
            select(Class.id).where(
                Class.academic_year_id == section.academic_year_id,
                Class.id != section.id,
                Class.deleted_at.is_(None),
            )
        ).scalars()
    )
    rows = _meeting_rows_for_classes(db, other_ids)
    if not rows:
        return conflicts

    other_cs_ids = list({m.class_subject_id for (m, _c) in rows})
    teachers_by_cs, _leads = _teachers_map(db, other_cs_ids)

    for want in proposed:
        for meeting, other in rows:
            if meeting.day_of_week != want.day_of_week:
                continue
            if not _overlaps(want.start_time, want.end_time, meeting.start_time, meeting.end_time):
                continue
            slot = _slot_label(meeting.day_of_week, meeting.start_time, meeting.end_time)

            for t in teachers_by_cs.get(meeting.class_subject_id, []):
                if t.id in my_teacher_ids:
                    conflicts.append(
                        ScheduleConflict(
                            kind="teacher",
                            label=t.full_name,
                            with_class_id=other.id,
                            with_class_name=other.name,
                            day_of_week=meeting.day_of_week,
                            start_time=meeting.start_time,
                            end_time=meeting.end_time,
                            message=(
                                f"{t.full_name} also teaches {other.name} at {slot}."
                            ),
                        )
                    )

            # Room comparison is case-insensitive on trimmed text: the office types
            # "Lab 1" and "lab 1" interchangeably, and a clash the user can see but the
            # system can't is worse than no check at all.
            want_room = (want.room or "").strip().lower()
            other_room = (meeting.room or "").strip().lower()
            if want_room and want_room == other_room:
                conflicts.append(
                    ScheduleConflict(
                        kind="room",
                        label=meeting.room or "",
                        with_class_id=other.id,
                        with_class_name=other.name,
                        day_of_week=meeting.day_of_week,
                        start_time=meeting.start_time,
                        end_time=meeting.end_time,
                        message=(
                            f"{meeting.room} is already used by {other.name} at {slot}."
                        ),
                    )
                )
    return conflicts


def _student_enrol_conflicts(
    db: Session,
    *,
    section: Class,
    student_ids: list[uuid.UUID],
    semester_id: uuid.UUID,
) -> list:
    """Clashes between this class's week and what the given students already sit.

    Only classes the student is ACTIVELY enrolled in for `semester_id` count — a
    withdrawn enrolment frees the slot.
    """
    from app.modules.classes.schemas import ScheduleConflict

    conflicts: list[ScheduleConflict] = []
    target_cs = _offering_of(db, section.id)
    if target_cs is None or not student_ids:
        return conflicts
    mine = list(_meetings_map(db, [target_cs.id]).get(target_cs.id, []))
    if not mine:
        return conflicts

    rows = db.execute(
        select(ClassEnrollment.student_id, StudentProfile.full_name, ClassMeeting, Class)
        .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
        .join(Class, ClassEnrollment.class_id == Class.id)
        .join(ClassSubject, ClassSubject.class_id == Class.id)
        .join(ClassMeeting, ClassMeeting.class_subject_id == ClassSubject.id)
        .where(
            ClassEnrollment.student_id.in_(student_ids),
            ClassEnrollment.semester_id == semester_id,
            ClassEnrollment.unenrolled_at.is_(None),
            ClassEnrollment.class_id != section.id,
            ClassMeeting.deleted_at.is_(None),
            ClassSubject.deleted_at.is_(None),
            Class.deleted_at.is_(None),
        )
    ).all()

    for _sid, student_name, meeting, other in rows:
        for want in mine:
            if meeting.day_of_week != want.day_of_week:
                continue
            if not _overlaps(want.start_time, want.end_time, meeting.start_time, meeting.end_time):
                continue
            slot = _slot_label(meeting.day_of_week, meeting.start_time, meeting.end_time)
            conflicts.append(
                ScheduleConflict(
                    kind="student",
                    label=student_name,
                    with_class_id=other.id,
                    with_class_name=other.name,
                    day_of_week=meeting.day_of_week,
                    start_time=meeting.start_time,
                    end_time=meeting.end_time,
                    message=f"{student_name} already has {other.name} at {slot}.",
                )
            )
    return conflicts


def _teacher_owned_cs_ids(
    db: Session, caller: User, class_subject_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Subset of class_subject_ids the teacher owns (for actionable_by_caller)."""
    if not class_subject_ids:
        return set()
    teacher_id = _teacher_profile_id(db, caller)
    rows = db.execute(
        select(ClassTeacher.class_subject_id).where(
            ClassTeacher.class_subject_id.in_(class_subject_ids),
            ClassTeacher.teacher_id == teacher_id,
        )
    ).scalars()
    return set(rows)


def _class_subject_items(db: Session, section_id: uuid.UUID, *, caller: User):
    """Build ClassSubjectItem[] for a class's live offerings (batched, no N+1).

    Under D29 this returns a single-element list for a properly created subject class;
    it stays a list so a pre-D29 multi-subject row still renders.
    """
    from app.modules.assessments.models import Assessment
    from app.modules.classes.schemas import ClassSubjectItem

    rows = db.execute(
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(ClassSubject.class_id == section_id, ClassSubject.deleted_at.is_(None))
        .order_by(Subject.name.asc(), ClassSubject.id.asc())
    ).all()
    cs_ids = [cs.id for (cs, _s) in rows]

    teachers_by_cs, lead_by_cs = _teachers_map(db, cs_ids)

    # assessment counts per class_subject
    counts: dict[uuid.UUID, int] = {}
    if cs_ids:
        for cs_id, n in db.execute(
            select(Assessment.class_subject_id, func.count())
            .where(
                Assessment.class_subject_id.in_(cs_ids),
                Assessment.deleted_at.is_(None),
            )
            .group_by(Assessment.class_subject_id)
        ).all():
            counts[cs_id] = n

    if caller.role in (Role.PRINCIPAL, Role.SECRETARY):
        owned = set(cs_ids)
    elif caller.role == Role.TEACHER:
        owned = _teacher_owned_cs_ids(db, caller, cs_ids)
    else:
        owned = set()

    return [
        ClassSubjectItem(
            class_subject_id=cs.id,
            subject=SubjectRef.model_validate(subj),
            teachers=teachers_by_cs.get(cs.id, []),
            lead_teacher_id=lead_by_cs.get(cs.id),
            assessment_count=counts.get(cs.id, 0),
            is_active=cs.is_active,
            actionable_by_caller=cs.id in owned,
        )
        for (cs, subj) in rows
    ]


def _class_subject_or_404(
    db: Session, section_id: uuid.UUID, class_subject_id: uuid.UUID
) -> ClassSubject:
    cs = db.scalar(
        select(ClassSubject).where(
            ClassSubject.id == class_subject_id,
            ClassSubject.class_id == section_id,
            ClassSubject.deleted_at.is_(None),
        )
    )
    if cs is None:
        raise NotFound("Subject offering not found.", code="class_subject_not_found")
    return cs


def _one_class_subject_item(db: Session, cs: ClassSubject, *, caller: User):
    """Single ClassSubjectItem (POST/PUT responses)."""
    section = db.get(Class, cs.class_id)
    for item in _class_subject_items(db, section.id, caller=caller):
        if item.class_subject_id == cs.id:
            return item
    # Fallback (freshly attached with no teachers yet)
    from app.modules.classes.schemas import ClassSubjectItem

    subj = db.get(Subject, cs.subject_id)
    return ClassSubjectItem(
        class_subject_id=cs.id,
        subject=SubjectRef.model_validate(subj),
        teachers=[],
        lead_teacher_id=None,
        assessment_count=0,
        is_active=cs.is_active,
        actionable_by_caller=caller.role in (Role.PRINCIPAL, Role.SECRETARY),
    )


def _roster_entry(enr: ClassEnrollment, student: StudentProfile):
    from app.modules.classes.schemas import RosterEntry

    return RosterEntry(
        enrollment_id=enr.id,
        student=StudentRef.model_validate(student),
        enrolled_at=enr.enrolled_at,
        unenrolled_at=enr.unenrolled_at,
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /classes
# ══════════════════════════════════════════════════════════════════════════════
def list_classes(
    db: Session,
    *,
    caller: User,
    params: PageParams,
    search: str | None,
    academic_year_id: uuid.UUID | None,
    grade_level: str | None,
    subject_id: uuid.UUID | None = None,
):
    """GET /classes. Defaults to the active year; Teacher scoped to classes they
    teach, Student scoped to classes they're actively enrolled in.

    Under D29 a student's scope is a LIST, not a single row — this is where
    "My Classes" gets every subject class they take.
    """
    if academic_year_id is None:
        academic_year_id = db.scalar(
            select(AcademicYear.id).where(AcademicYear.status == "active")
        )

    stmt = select(Class).where(Class.deleted_at.is_(None))
    if academic_year_id is not None:
        stmt = stmt.where(Class.academic_year_id == academic_year_id)
    if grade_level is not None:
        stmt = stmt.where(Class.grade_level == grade_level)
    if subject_id is not None:
        teaches = (
            select(ClassSubject.id)
            .where(
                ClassSubject.class_id == Class.id,
                ClassSubject.subject_id == subject_id,
                ClassSubject.deleted_at.is_(None),
            )
            .exists()
        )
        stmt = stmt.where(teaches)
    if search:
        stmt = stmt.where(Class.name.ilike(f"%{search.strip()}%"))

    if caller.role == Role.TEACHER:
        teacher_id = _teacher_profile_id(db, caller)
        owns = (
            select(ClassTeacher.id)
            .join(ClassSubject, ClassTeacher.class_subject_id == ClassSubject.id)
            .where(
                ClassSubject.class_id == Class.id,
                ClassSubject.deleted_at.is_(None),
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
                    ClassEnrollment.class_id == Class.id,
                    ClassEnrollment.student_id == sid,
                    ClassEnrollment.unenrolled_at.is_(None),
                )
                .exists()
            )
            stmt = stmt.where(enrolled)

    sort = (params.sort or "name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _CLASS_SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(f"Unknown sort field '{key}'.", code="invalid_sort_field")
    stmt = stmt.order_by(col.desc() if desc else col.asc(), Class.id.asc())

    from app.modules.classes.schemas import ClassListItem

    page = paginate(db, stmt, params, serialize=ClassListItem.model_validate)
    ids = [i.id for i in page.items]
    enrolled = _enrolled_counts(db, ids)
    for item in page.items:
        item.enrolled_count = enrolled.get(item.id, 0)
    _decorate_class_rows(db, page.items)
    return page


# ══════════════════════════════════════════════════════════════════════════════
# GET /classes/{id}
# ══════════════════════════════════════════════════════════════════════════════
def get_class(db: Session, *, caller: User, class_id: uuid.UUID):
    section = _class_or_404(db, class_id)
    _assert_caller_can_read_section(db, caller, section)
    return _detail(db, section)


def _assert_caller_can_read_section(db: Session, caller: User, section: Class) -> None:
    """P/S: any. Teacher: owns any subject in the section (else 404). Student:
    actively enrolled (else 404). No existence leak (§3.3)."""
    if caller.role in (Role.PRINCIPAL, Role.SECRETARY):
        return
    if caller.role == Role.TEACHER:
        assert_teacher_owns_section(db, caller, section.id)  # raises NotFound
        return
    # Student
    sid = _student_profile_id_or_none(db, caller)
    enrolled = sid is not None and db.scalar(
        select(ClassEnrollment.id)
        .where(
            ClassEnrollment.class_id == section.id,
            ClassEnrollment.student_id == sid,
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .exists()
        .select()
    )
    if not enrolled:
        raise NotFound("Section not found.", code="not_found")


# ══════════════════════════════════════════════════════════════════════════════
# POST /classes
# ══════════════════════════════════════════════════════════════════════════════
def create_class(db: Session, *, actor: User, payload):
    """Create a subject class, its single offering, and optionally its teachers and
    weekly meetings — all in ONE transaction.

    Atomic on purpose: a `Class` with no `ClassSubject` cannot be graded, scheduled,
    or enrolled into, so a partial create would leave the office holding an unusable
    row. Nothing is committed until every piece validates.
    """
    year_id = payload.academic_year_id
    if year_id is None:
        year_id = db.scalar(select(AcademicYear.id).where(AcademicYear.status == "active"))
        if year_id is None:
            raise Conflict("No active academic year is configured.", code="no_active_year")
    year = db.get(AcademicYear, year_id)
    if year is None:
        raise NotFound("Academic year not found.", code="year_not_found")
    if year.archived_at is not None or year.status == "archived":
        raise Conflict("Cannot add a class to an archived year.", code="year_archived")

    _assert_name_unique_in_year(db, name=payload.name, academic_year_id=year_id)

    subject = db.scalar(
        select(Subject).where(
            Subject.id == payload.subject_id, Subject.deleted_at.is_(None)
        )
    )
    if subject is None:
        raise NotFound("Subject not found.", code="subject_not_found")

    teacher_ids, lead = _validated_teacher_set(
        db, teacher_ids=payload.teacher_ids, lead_teacher_id=payload.lead_teacher_id
    )

    section = Class(
        academic_year_id=year_id,
        name=payload.name.strip(),
        grade_level=payload.grade_level.strip(),
        section=payload.section,
        capacity=payload.capacity,
        is_archived=False,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(section)
    db.flush()

    cs = ClassSubject(
        class_id=section.id,
        subject_id=subject.id,
        is_active=True,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(cs)
    db.flush()

    for tid in teacher_ids:
        db.add(
            ClassTeacher(
                class_subject_id=cs.id,
                teacher_id=tid,
                is_lead=(tid == lead),
                created_by=actor.id,
                updated_by=actor.id,
            )
        )
    for want in payload.meetings:
        db.add(
            ClassMeeting(
                class_subject_id=cs.id,
                day_of_week=want.day_of_week,
                start_time=want.start_time,
                end_time=want.end_time,
                room=(want.room or None),
                created_by=actor.id,
                updated_by=actor.id,
            )
        )

    _audit(db, actor=actor, action="class.create", entity_id=section.id,
           summary={"name": section.name, "subject_id": str(subject.id),
                    "teacher_ids": [str(t) for t in teacher_ids],
                    "meeting_count": len(payload.meetings)})
    db.commit()
    return _detail(db, section)


# ══════════════════════════════════════════════════════════════════════════════
# PATCH /classes/{id}
# ══════════════════════════════════════════════════════════════════════════════
def update_class(db: Session, *, actor: User, class_id: uuid.UUID, payload):
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)

    if payload.name is not None and payload.name.strip().lower() != section.name.lower():
        _assert_name_unique_in_year(
            db, name=payload.name, academic_year_id=section.academic_year_id,
            exclude_id=section.id,
        )
        section.name = payload.name.strip()
    if payload.grade_level is not None:
        section.grade_level = payload.grade_level.strip()
    if payload.section is not None:
        section.section = payload.section
    if payload.capacity is not None:
        section.capacity = payload.capacity

    section.updated_by = actor.id
    _audit(db, actor=actor, action="class.update", entity_id=section.id)
    db.commit()
    return _detail(db, section)


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /classes/{id}
# ══════════════════════════════════════════════════════════════════════════════
def delete_class(db: Session, *, actor: User, class_id: uuid.UUID) -> None:
    """Soft-delete a section only if it has no academic history (no assessments on
    any of its subjects, no attendance). Else 409 class_has_history ('archive
    instead'). Cascades soft-delete to its class_subjects + unenrolls active rows."""
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)

    from app.modules.assessments.models import Assessment
    from app.modules.attendance.models import AttendanceRecord

    has_assessments = db.scalar(
        select(Assessment.id)
        .join(ClassSubject, Assessment.class_subject_id == ClassSubject.id)
        .where(ClassSubject.class_id == section.id)
        .limit(1)
    )
    has_attendance = db.scalar(
        select(AttendanceRecord.id).where(AttendanceRecord.class_id == section.id).limit(1)
    )
    if has_assessments is not None or has_attendance is not None:
        raise Conflict(
            "This section has academic history — archive it instead.",
            code="class_has_history",
        )

    now = _now()
    # cascade: soft-delete offerings + close active enrollments
    for cs in db.execute(
        select(ClassSubject).where(
            ClassSubject.class_id == section.id, ClassSubject.deleted_at.is_(None)
        )
    ).scalars():
        cs.deleted_at = now
        cs.updated_by = actor.id
    for enr in db.execute(
        select(ClassEnrollment).where(
            ClassEnrollment.class_id == section.id,
            ClassEnrollment.unenrolled_at.is_(None),
        )
    ).scalars():
        enr.unenrolled_at = now
        enr.updated_by = actor.id

    section.deleted_at = now
    section.updated_by = actor.id
    _audit(db, actor=actor, action="class.delete", entity_id=section.id)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# GET /classes/{id}/subjects
# ══════════════════════════════════════════════════════════════════════════════
def list_class_subjects(db: Session, *, caller: User, class_id: uuid.UUID):
    section = _class_or_404(db, class_id)
    _assert_caller_can_read_section(db, caller, section)
    return _class_subject_items(db, section.id, caller=caller)


# ══════════════════════════════════════════════════════════════════════════════
# POST /classes/{id}/subjects — attach a subject
# ══════════════════════════════════════════════════════════════════════════════
def attach_subject(db: Session, *, actor: User, class_id: uuid.UUID, subject_id: uuid.UUID):
    """Attach the class's subject.

    Retained only to backfill a pre-D29 class that has no offering; the normal path is
    `POST /classes`, which attaches the subject as part of the create. Under D29 a
    class teaches exactly ONE subject, so a second attach is a 409 rather than a second
    offering — otherwise a class could grow two gradebooks and two timetables.
    """
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)

    subject = db.scalar(
        select(Subject).where(Subject.id == subject_id, Subject.deleted_at.is_(None))
    )
    if subject is None:
        raise NotFound("Subject not found.", code="subject_not_found")

    existing = _offering_of(db, section.id)
    if existing is not None:
        if existing.subject_id == subject_id:
            raise Conflict(
                "This subject is already offered in the class.",
                code="subject_already_in_section",
            )
        raise Conflict(
            "This class already teaches a subject. Create a separate class instead.",
            code="subject_already_set",
        )

    cs = ClassSubject(
        class_id=section.id,
        subject_id=subject_id,
        is_active=True,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(cs)
    db.flush()
    _audit(db, actor=actor, action="class_subject.attach", entity_id=cs.id,
           summary={"class_id": str(section.id), "subject_id": str(subject_id)})
    db.commit()
    return _one_class_subject_item(db, cs, caller=actor)


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /classes/{class_id}/subjects/{class_subject_id}
# ══════════════════════════════════════════════════════════════════════════════
def detach_subject(
    db: Session, *, actor: User, class_id: uuid.UUID, class_subject_id: uuid.UUID
) -> None:
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)
    cs = _class_subject_or_404(db, section.id, class_subject_id)

    from app.modules.assessments.models import Assessment

    has_history = db.scalar(
        select(Assessment.id).where(Assessment.class_subject_id == cs.id).limit(1)
    )
    if has_history is not None:
        raise Conflict(
            "This offering has assessments — retire it (is_active=false) instead.",
            code="class_subject_has_history",
        )

    cs.deleted_at = _now()
    cs.updated_by = actor.id
    # remove teacher assignments for the detached offering
    for ct in db.execute(
        select(ClassTeacher).where(ClassTeacher.class_subject_id == cs.id)
    ).scalars():
        db.delete(ct)
    _audit(db, actor=actor, action="class_subject.detach", entity_id=cs.id)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# PUT /classes/{class_id}/subjects/{class_subject_id}/teachers
# ══════════════════════════════════════════════════════════════════════════════
def assign_teachers(
    db: Session,
    *,
    actor: User,
    class_id: uuid.UUID,
    class_subject_id: uuid.UUID,
    payload,
):
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)
    cs = _class_subject_or_404(db, section.id, class_subject_id)

    teacher_ids, lead = _validated_teacher_set(
        db, teacher_ids=payload.teacher_ids, lead_teacher_id=payload.lead_teacher_id
    )

    # Replace the assignment set.
    for ct in db.execute(
        select(ClassTeacher).where(ClassTeacher.class_subject_id == cs.id)
    ).scalars():
        db.delete(ct)
    db.flush()
    for tid in teacher_ids:
        db.add(
            ClassTeacher(
                class_subject_id=cs.id,
                teacher_id=tid,
                is_lead=(tid == lead),
                created_by=actor.id,
                updated_by=actor.id,
            )
        )
    _audit(db, actor=actor, action="class_subject.assign_teachers", entity_id=cs.id,
           summary={"teacher_ids": [str(t) for t in teacher_ids],
                    "lead_teacher_id": str(lead) if lead else None})
    db.commit()
    return _one_class_subject_item(db, cs, caller=actor)


# ══════════════════════════════════════════════════════════════════════════════
# GET /classes/{id}/roster
# ══════════════════════════════════════════════════════════════════════════════
def get_roster(
    db: Session,
    *,
    caller: User,
    class_id: uuid.UUID,
    semester_id: uuid.UUID | None,
    include: str | None,
):
    section = _class_or_404(db, class_id)
    if caller.role == Role.TEACHER:
        assert_teacher_owns_section(db, caller, section.id)  # 404 if not owner

    target_semester = semester_id or _active_semester_id(db)

    stmt = (
        select(ClassEnrollment, StudentProfile)
        .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
        .where(ClassEnrollment.class_id == section.id)
    )
    if target_semester is not None:
        stmt = stmt.where(ClassEnrollment.semester_id == target_semester)
    if include != "withdrawn":
        stmt = stmt.where(ClassEnrollment.unenrolled_at.is_(None))
    stmt = stmt.order_by(StudentProfile.full_name.asc())

    rows = db.execute(stmt).all()
    return [_roster_entry(enr, student) for (enr, student) in rows]


# ══════════════════════════════════════════════════════════════════════════════
# GET /classes/{id}/enrollable-students  (frontend enroll-dialog picker)
# ══════════════════════════════════════════════════════════════════════════════
def enrollable_students(
    db: Session, *, class_id: uuid.UUID, semester_id: uuid.UUID | None, search: str | None
):
    section = _class_or_404(db, class_id)
    target_semester = semester_id or _active_semester_id(db)

    # Students already actively on THIS section's roster (excluded).
    already = select(ClassEnrollment.student_id).where(
        ClassEnrollment.class_id == section.id,
        ClassEnrollment.unenrolled_at.is_(None),
    )
    if target_semester is not None:
        already = already.where(ClassEnrollment.semester_id == target_semester)

    stmt = select(StudentProfile).where(
        StudentProfile.deleted_at.is_(None),
        StudentProfile.status == StudentStatus.ACTIVE,
        StudentProfile.id.notin_(already),
    )
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            StudentProfile.full_name.ilike(like)
            | StudentProfile.student_number.ilike(like)
        )
    stmt = stmt.order_by(StudentProfile.full_name.asc()).limit(200)

    from app.modules.classes.schemas import EnrollableStudents

    rows = db.execute(stmt).scalars().all()
    return EnrollableStudents(items=[StudentRef.model_validate(s) for s in rows])


# ══════════════════════════════════════════════════════════════════════════════
# POST /classes/{id}/enrollments
# ══════════════════════════════════════════════════════════════════════════════
def enroll_students(db: Session, *, actor: User, class_id: uuid.UUID, payload):
    """Enrol students into THIS subject class, leaving their other classes alone.

    D29's central behavioural change. This function used to close a student's active
    enrolment anywhere else in the semester and report it as a `transfer` — correct
    when a student could only sit in one homeroom, and a data-loss bug the moment a
    student legitimately takes Math AND Biology. Now every enrolment is purely
    additive; a timetable clash is reported in `schedule_conflicts` and the enrolment
    still succeeds (warn-only, per D-Q6).
    """
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)

    semester_id = payload.semester_id or _active_semester_id(db)
    if semester_id is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")

    # Validate all students exist (live).
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

    from app.modules.classes.schemas import EnrollmentResult

    now = _now()

    # Computed BEFORE the inserts: it asks "what does this student already sit that
    # overlaps us", and the new rows would otherwise be compared against themselves.
    conflicts = _student_enrol_conflicts(
        db, section=section, student_ids=list(payload.student_ids), semester_id=semester_id
    )

    for sid in payload.student_ids:
        # Already active in THIS class for the semester? idempotent — skip create.
        here = db.scalar(
            select(ClassEnrollment).where(
                ClassEnrollment.class_id == section.id,
                ClassEnrollment.student_id == sid,
                ClassEnrollment.semester_id == semester_id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        )
        if here is not None:
            continue
        db.add(
            ClassEnrollment(
                class_id=section.id,
                student_id=sid,
                semester_id=semester_id,
                enrolled_at=now,
                created_by=actor.id,
                updated_by=actor.id,
            )
        )

    _audit(db, actor=actor, action="class.enroll", entity_id=section.id,
           summary={"student_ids": [str(s) for s in payload.student_ids],
                    "semester_id": str(semester_id)})
    db.commit()

    # Build the result: active rows for the requested students in this section.
    rows = db.execute(
        select(ClassEnrollment, StudentProfile)
        .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
        .where(
            ClassEnrollment.class_id == section.id,
            ClassEnrollment.semester_id == semester_id,
            ClassEnrollment.student_id.in_(payload.student_ids),
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .order_by(StudentProfile.full_name.asc())
    ).all()
    enrolled = [_roster_entry(enr, student) for (enr, student) in rows]

    total_active = _enrolled_counts(db, [section.id]).get(section.id, 0)
    over = bool(section.capacity and section.capacity > 0 and total_active > section.capacity)
    return EnrollmentResult(
        enrolled=enrolled, over_capacity_warning=over, schedule_conflicts=conflicts
    )


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /classes/{class_id}/enrollments/{enrollment_id}
# ══════════════════════════════════════════════════════════════════════════════
def unenroll_student(
    db: Session, *, actor: User, class_id: uuid.UUID, enrollment_id: uuid.UUID
) -> None:
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)
    enr = db.scalar(
        select(ClassEnrollment).where(
            ClassEnrollment.id == enrollment_id,
            ClassEnrollment.class_id == section.id,
        )
    )
    if enr is None:
        raise NotFound("Enrollment not found.", code="not_found")
    if enr.unenrolled_at is None:
        enr.unenrolled_at = _now()
        enr.updated_by = actor.id
    _audit(db, actor=actor, action="class.unenroll", entity_id=section.id,
           summary={"enrollment_id": str(enrollment_id)})
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# GET /classes/{id}/meetings
# ══════════════════════════════════════════════════════════════════════════════
def list_meetings(db: Session, *, caller: User, class_id: uuid.UUID):
    """The class's weekly schedule. Readable by anyone who can read the class, so a
    student sees when their own class meets and a teacher sees their own week."""
    from app.modules.classes.schemas import MeetingsResult

    section = _class_or_404(db, class_id)
    _assert_caller_can_read_section(db, caller, section)
    cs = _offering_of(db, section.id)
    if cs is None:
        return MeetingsResult(meetings=[], conflicts=[])
    return MeetingsResult(meetings=_meetings_map(db, [cs.id]).get(cs.id, []), conflicts=[])


# ══════════════════════════════════════════════════════════════════════════════
# PUT /classes/{id}/meetings
# ══════════════════════════════════════════════════════════════════════════════
def replace_meetings(db: Session, *, actor: User, class_id: uuid.UUID, payload):
    """Replace the class's whole weekly schedule (P/S).

    Hard-deletes the old rows rather than soft-deleting them: a meeting is a recurring
    calendar slot, not a record of anything that happened, so nothing references it
    historically (attendance is keyed by date, not by meeting) and accumulating
    tombstones would only slow the timetable joins.

    Overlaps do not block the write — see `MeetingsResult`. Two kinds are checked:
    self-overlap inside the submitted week (a straight input mistake) and clashes with
    other classes in the same year.
    """
    from app.modules.classes.schemas import MeetingsResult, ScheduleConflict

    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)
    cs = _offering_of(db, section.id)
    if cs is None:
        raise Conflict(
            "This class has no subject yet, so it cannot be scheduled.",
            code="subject_not_set",
        )

    wanted = list(payload.meetings)

    # Self-overlap: the class cannot be in two places at once.
    self_conflicts: list[ScheduleConflict] = []
    for i, a in enumerate(wanted):
        for b in wanted[i + 1 :]:
            if a.day_of_week == b.day_of_week and _overlaps(
                a.start_time, a.end_time, b.start_time, b.end_time
            ):
                self_conflicts.append(
                    ScheduleConflict(
                        kind="room" if (a.room and a.room == b.room) else "teacher",
                        label=section.name,
                        with_class_id=section.id,
                        with_class_name=section.name,
                        day_of_week=b.day_of_week,
                        start_time=b.start_time,
                        end_time=b.end_time,
                        message=(
                            f"{section.name} has two overlapping meetings at "
                            f"{_slot_label(b.day_of_week, b.start_time, b.end_time)}."
                        ),
                    )
                )

    conflicts = self_conflicts + _teacher_room_conflicts(
        db, section=section, cs=cs, proposed=wanted
    )

    for old in db.execute(
        select(ClassMeeting).where(ClassMeeting.class_subject_id == cs.id)
    ).scalars():
        db.delete(old)
    db.flush()

    for want in wanted:
        db.add(
            ClassMeeting(
                class_subject_id=cs.id,
                day_of_week=want.day_of_week,
                start_time=want.start_time,
                end_time=want.end_time,
                room=(want.room.strip() or None) if want.room else None,
                created_by=actor.id,
                updated_by=actor.id,
            )
        )

    _audit(
        db, actor=actor, action="class.replace_meetings", entity_id=section.id,
        summary={
            "class_subject_id": str(cs.id),
            "slots": [
                _slot_label(w.day_of_week, w.start_time, w.end_time) for w in wanted
            ],
            "conflict_count": len(conflicts),
        },
    )
    db.commit()
    return MeetingsResult(
        meetings=_meetings_map(db, [cs.id]).get(cs.id, []), conflicts=conflicts
    )


# Re-export the schema type used by _detail's annotation lazily.
from app.modules.classes.schemas import ClassDetail  # noqa: E402

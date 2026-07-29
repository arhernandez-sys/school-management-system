"""Classes (sections) service (api-spec §5 Module 5, FR-CLS-01..10).

Owns DB access + transactions for the 13 Classes endpoints; routers are thin.

Cross-cutting discipline (api-spec §3):
  * 404-vs-403 — record/ownership denial → 404 (no existence leak). Teacher scope
    reuses `assert_teacher_owns_section` (rbac.py). Role denial is the router gate.
  * Every WRITE path rejects a section in an archived academic year → 409
    year_archived (FR-CLS-06, schema §5 rule 7).
  * Uniqueness of section name per year is enforced by the DB partial-unique index
    (`uq_classes_year_name` over the `active_class_name` generated column); we
    pre-check for the documented 409 code.

Derived data (matches the frontend selectors):
  * enrolled_count = active roster rows (unenrolled_at IS NULL) for the section.
  * subject_count  = active, non-deleted class_subjects for the section.
  * over_capacity  = capacity set (>0) and enrolled_count > capacity (warn-only).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

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


def _subject_counts(db: Session, class_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not class_ids:
        return {}
    rows = db.execute(
        select(ClassSubject.class_id, func.count())
        .where(
            ClassSubject.class_id.in_(class_ids),
            ClassSubject.deleted_at.is_(None),
            ClassSubject.is_active.is_(True),
        )
        .group_by(ClassSubject.class_id)
    ).all()
    return {cid: n for (cid, n) in rows}


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
    return ClassDetail(
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
    """Build ClassSubjectItem[] for a section's live offerings (batched, no N+1)."""
    from app.modules.assessments.models import Assessment
    from app.modules.classes.schemas import ClassSubjectItem

    rows = db.execute(
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(ClassSubject.class_id == section_id, ClassSubject.deleted_at.is_(None))
        .order_by(Subject.name.asc(), ClassSubject.id.asc())
    ).all()
    cs_ids = [cs.id for (cs, _s) in rows]

    # teachers per class_subject
    teacher_rows = db.execute(
        select(ClassTeacher, TeacherProfile)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.class_subject_id.in_(cs_ids or [uuid.UUID(int=0)]))
        .order_by(ClassTeacher.is_lead.desc(), TeacherProfile.full_name.asc())
    ).all()
    teachers_by_cs: dict[uuid.UUID, list[TeacherRef]] = {}
    lead_by_cs: dict[uuid.UUID, uuid.UUID] = {}
    for ct, tp in teacher_rows:
        teachers_by_cs.setdefault(ct.class_subject_id, []).append(
            TeacherRef.model_validate(tp)
        )
        if ct.is_lead:
            lead_by_cs[ct.class_subject_id] = tp.id

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
):
    """GET /classes. Defaults to the active year; Teacher scoped to owned sections,
    Student scoped to sections they're actively enrolled in."""
    if academic_year_id is None:
        academic_year_id = db.scalar(
            select(AcademicYear.id).where(AcademicYear.status == "active")
        )

    stmt = select(Class).where(Class.deleted_at.is_(None))
    if academic_year_id is not None:
        stmt = stmt.where(Class.academic_year_id == academic_year_id)
    if grade_level is not None:
        stmt = stmt.where(Class.grade_level == grade_level)
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
    subjects = _subject_counts(db, ids)
    for item in page.items:
        item.enrolled_count = enrolled.get(item.id, 0)
        item.subject_count = subjects.get(item.id, 0)
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
    year_id = payload.academic_year_id
    if year_id is None:
        year_id = db.scalar(select(AcademicYear.id).where(AcademicYear.status == "active"))
        if year_id is None:
            raise Conflict("No active academic year is configured.", code="no_active_year")
    year = db.get(AcademicYear, year_id)
    if year is None:
        raise NotFound("Academic year not found.", code="year_not_found")
    if year.archived_at is not None or year.status == "archived":
        raise Conflict("Cannot add a section to an archived year.", code="year_archived")

    _assert_name_unique_in_year(db, name=payload.name, academic_year_id=year_id)

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
    _audit(db, actor=actor, action="class.create", entity_id=section.id,
           summary={"name": section.name})
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
    section = _class_or_404(db, class_id)
    _assert_year_writable(db, section)

    subject = db.scalar(
        select(Subject).where(Subject.id == subject_id, Subject.deleted_at.is_(None))
    )
    if subject is None:
        raise NotFound("Subject not found.", code="subject_not_found")

    existing = db.scalar(
        select(ClassSubject.id).where(
            ClassSubject.class_id == section.id,
            ClassSubject.subject_id == subject_id,
            ClassSubject.deleted_at.is_(None),
        )
    )
    if existing is not None:
        raise Conflict(
            "This subject is already offered in the section.",
            code="subject_already_in_section",
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

    teacher_ids = list(dict.fromkeys(payload.teacher_ids))  # dedupe, keep order
    lead = payload.lead_teacher_id
    if lead is not None and lead not in teacher_ids:
        raise ValidationError(
            "lead_teacher_id must be one of teacher_ids.",
            code="validation_error",
            fields={"lead_teacher_id": ["Must be included in teacher_ids."]},
        )
    if lead is None and teacher_ids:
        lead = teacher_ids[0]

    # Validate every teacher exists (live).
    if teacher_ids:
        found = set(
            db.execute(
                select(TeacherProfile.id).where(
                    TeacherProfile.id.in_(teacher_ids),
                    TeacherProfile.deleted_at.is_(None),
                )
            ).scalars()
        )
        missing = [t for t in teacher_ids if t not in found]
        if missing:
            raise NotFound("Teacher not found.", code="teacher_not_found")

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

    from app.modules.classes.schemas import EnrollmentResult, TransferItem

    transferred: list[TransferItem] = []
    now = _now()

    for sid in payload.student_ids:
        # Already active in THIS section for the semester? idempotent — skip create.
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
        # Active elsewhere this semester → transfer (close the old row).
        other = db.scalar(
            select(ClassEnrollment).where(
                ClassEnrollment.student_id == sid,
                ClassEnrollment.semester_id == semester_id,
                ClassEnrollment.class_id != section.id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        )
        if other is not None:
            other.unenrolled_at = now
            other.updated_by = actor.id
            transferred.append(
                TransferItem(student_id=sid, from_class_id=other.class_id)
            )
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
        enrolled=enrolled, transferred=transferred, over_capacity_warning=over
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


# Re-export the schema type used by _detail's annotation lazily.
from app.modules.classes.schemas import ClassDetail  # noqa: E402

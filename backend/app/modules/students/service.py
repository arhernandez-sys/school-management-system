"""Students service (api-spec §5 Module 3, FR-STU-01..10).

Owns DB access + transactions for the 8 student endpoints; the router is thin.

Cross-cutting discipline honored here (api-spec §3):
  * Server-derived student scope — `/students/me` resolves the profile from the
    token's user, NEVER a client-supplied id (§3.2 hard rule).
  * Teacher scope — a teacher only lists/reads students enrolled in a section they
    own any subject of (`assert_teacher_owns_section` as a read filter). A student
    a teacher can't reach yields 404, not 403 (§3.3, no existence leak).
  * 404-vs-403 — record-ownership denial → 404; role denial is handled by the
    router's `require_role`.

Uniqueness (`student_number`) is enforced at the DB by a partial-unique index over
live rows (`uq_student_profiles_number WHERE deleted_at IS NULL`). We pre-check for
the documented 409 code; the index is the backstop against a race.

`current_section` (the student's active section for the active semester) is derived
from `class_enrollments` (unenrolled_at IS NULL) joined to `classes`. The target
student id is the enforcement key for grades — this module never fabricates them.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.common.enums import AssessmentStatus, Role, StudentStatus
from app.common.schemas import AuditStamp, ClassRef, SubjectRef, UserRef
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id
from app.modules.assessments.models import Assessment
from app.modules.classes.models import Class, ClassEnrollment, ClassSubject, Subject
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile
from app.modules.students.schemas import (
    StudentAssessmentItem,
    StudentCreateRequest,
    StudentDetail,
    StudentListItem,
    StudentStatusRequest,
    StudentUpdateRequest,
)
from app.modules.users.models import User

# Allowed sort fields for the students list (whitelist — never interpolated, §6).
_STUDENT_SORT_FIELDS = {
    "full_name": StudentProfile.full_name,
    "student_number": StudentProfile.student_number,
    "status": StudentProfile.status,
    "created_at": StudentProfile.created_at,
}

# Lifecycle transitions (FR-STU-04). A terminal state (graduated/withdrawn/
# transferred) may be reactivated to `active` (re-admission / correction), but
# terminal→terminal jumps are disallowed as ambiguous — go via `active` first.
# `inactive` is a soft pause reachable from/to any non-terminal state.
_ALLOWED_STATUS_TRANSITIONS: dict[StudentStatus, set[StudentStatus]] = {
    StudentStatus.ACTIVE: {
        StudentStatus.INACTIVE,
        StudentStatus.TRANSFERRED,
        StudentStatus.GRADUATED,
        StudentStatus.WITHDRAWN,
    },
    StudentStatus.INACTIVE: {
        StudentStatus.ACTIVE,
        StudentStatus.TRANSFERRED,
        StudentStatus.GRADUATED,
        StudentStatus.WITHDRAWN,
    },
    StudentStatus.TRANSFERRED: {StudentStatus.ACTIVE, StudentStatus.INACTIVE},
    StudentStatus.GRADUATED: {StudentStatus.ACTIVE, StudentStatus.INACTIVE},
    StudentStatus.WITHDRAWN: {StudentStatus.ACTIVE, StudentStatus.INACTIVE},
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
            entity_type="student",
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + shared shaping
# ──────────────────────────────────────────────────────────────────────────────
def _student_or_404(db: Session, student_id: uuid.UUID) -> StudentProfile:
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id,
            StudentProfile.deleted_at.is_(None),
        )
    )
    if student is None:
        raise NotFound("Student not found.", code="not_found")
    return student


def _active_semester_id(db: Session) -> uuid.UUID | None:
    """The single active semester (schema §3.C). None when Settings isn't
    configured — callers treat that as 'no current section' rather than an error
    on read paths."""
    return db.scalar(select(Semester.id).where(Semester.is_active.is_(True)))


def _current_section_map(
    db: Session, student_ids: list[uuid.UUID], *, semester_id: uuid.UUID | None
) -> dict[uuid.UUID, ClassRef]:
    """Batch-resolve each student's active section for `semester_id` in ONE query
    (avoids N+1 on the list endpoint). A student is in at most one active section
    per semester (uq_enroll_active), so the map is 1:1."""
    if not student_ids or semester_id is None:
        return {}
    rows = db.execute(
        select(ClassEnrollment.student_id, Class)
        .join(Class, ClassEnrollment.class_id == Class.id)
        .where(
            ClassEnrollment.student_id.in_(student_ids),
            ClassEnrollment.semester_id == semester_id,
            ClassEnrollment.unenrolled_at.is_(None),
            Class.deleted_at.is_(None),
        )
    ).all()
    return {sid: ClassRef.model_validate(cls) for (sid, cls) in rows}


def _audit_stamp(db: Session, student: StudentProfile) -> AuditStamp:
    """Resolve the created_by/updated_by actor refs (lightweight join to users).
    Both are nullable (seed/system rows have no human actor, schema §1.3)."""
    actor_ids = {
        i for i in (student.created_by, student.updated_by) if i is not None
    }
    actors: dict[uuid.UUID, UserRef] = {}
    if actor_ids:
        for u in db.execute(
            select(User).where(User.id.in_(actor_ids))
        ).scalars():
            actors[u.id] = UserRef.model_validate(u)
    return AuditStamp(
        created_at=student.created_at,
        updated_at=student.updated_at,
        created_by=actors.get(student.created_by) if student.created_by else None,
        updated_by=actors.get(student.updated_by) if student.updated_by else None,
    )


def _detail(
    db: Session, student: StudentProfile, *, semester_id: uuid.UUID | None
) -> StudentDetail:
    section_map = _current_section_map(db, [student.id], semester_id=semester_id)
    detail = StudentDetail.model_validate(student)
    detail.current_section = section_map.get(student.id)
    detail.audit = _audit_stamp(db, student)
    return detail


def _assert_number_unique(
    db: Session, student_number: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(StudentProfile.id).where(
        func.lower(StudentProfile.student_number) == student_number.strip().lower(),
        StudentProfile.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(StudentProfile.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A student with this student number already exists.",
            code="duplicate_student_number",
        )


# ──────────────────────────────────────────────────────────────────────────────
# GET /students — list (P/S all; Teacher scoped to own sections)
# ──────────────────────────────────────────────────────────────────────────────
def list_students(
    db: Session,
    *,
    caller: User,
    params: PageParams,
    search: str | None,
    status: StudentStatus | None,
    class_id: uuid.UUID | None,
    grade_level: str | None,
):
    """GET /students (P/S/Teacher). Page[StudentListItem]; default sort full_name.

    Teacher scope (FR-STU-08): restricted to students with an active enrollment in
    a section the teacher owns ANY class_subject of — enforced as a read filter, so
    a teacher literally cannot page students outside their sections.
    """
    semester_id = _active_semester_id(db)

    stmt = select(StudentProfile).where(StudentProfile.deleted_at.is_(None))

    if status is not None:
        stmt = stmt.where(StudentProfile.status == status)

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            StudentProfile.full_name.ilike(like)
            | StudentProfile.student_number.ilike(like)
        )

    # Section / grade filters and teacher scope all constrain via class_enrollments
    # → classes. We build an EXISTS correlated subquery so a student appears once
    # regardless of how the joins fan out.
    needs_enrollment_scope = (
        class_id is not None
        or grade_level is not None
        or caller.role == Role.TEACHER
    )
    if needs_enrollment_scope:
        enr = (
            select(ClassEnrollment.id)
            .join(Class, ClassEnrollment.class_id == Class.id)
            .where(
                ClassEnrollment.student_id == StudentProfile.id,
                ClassEnrollment.unenrolled_at.is_(None),
                Class.deleted_at.is_(None),
            )
        )
        # Constrain to the active semester when known so "current section" filters
        # and teacher scope reflect the live term (not historical rosters).
        if semester_id is not None:
            enr = enr.where(ClassEnrollment.semester_id == semester_id)
        if class_id is not None:
            enr = enr.where(Class.id == class_id)
        if grade_level is not None:
            enr = enr.where(Class.grade_level == grade_level)

        if caller.role == Role.TEACHER:
            teacher_id = _teacher_profile_id(db, caller)
            enr = _apply_teacher_ownership(enr, teacher_id)

        stmt = stmt.where(enr.exists())

    sort = (params.sort or "full_name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _STUDENT_SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(col.desc() if desc else col.asc(), StudentProfile.id.asc())

    page = paginate(db, stmt, params, serialize=StudentListItem.model_validate)

    # Attach current_section to each item in ONE batched query (no N+1).
    ids = [item.id for item in page.items]
    section_map = _current_section_map(db, ids, semester_id=semester_id)
    for item in page.items:
        item.current_section = section_map.get(item.id)
    return page


def _apply_teacher_ownership(enr_stmt, teacher_id: uuid.UUID):
    """Constrain an enrollment subquery to sections the teacher owns any subject
    of, via class_teachers → class_subjects on the same section.

    Built as `select(...).join(...).where(...).exists()` — the `exists().select_
    from(...).join(...)` form is NOT valid (Exists has no `.join`)."""
    from app.modules.classes.models import ClassTeacher

    ownership = (
        select(ClassTeacher.id)
        .join(ClassSubject, ClassTeacher.class_subject_id == ClassSubject.id)
        .where(
            ClassSubject.class_id == Class.id,
            ClassSubject.deleted_at.is_(None),
            ClassTeacher.teacher_id == teacher_id,
        )
        .exists()
    )
    return enr_stmt.where(ownership)


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/{id} — detail
# ──────────────────────────────────────────────────────────────────────────────
def get_student(db: Session, *, caller: User, student_id: uuid.UUID) -> StudentDetail:
    """GET /students/{id} (P/S any; Teacher must own a section the student is in →
    else 404, §3.3)."""
    student = _student_or_404(db, student_id)
    if caller.role == Role.TEACHER:
        _assert_teacher_can_see_student(db, caller, student.id)
    semester_id = _active_semester_id(db)
    return _detail(db, student, semester_id=semester_id)


def _assert_teacher_can_see_student(
    db: Session, caller: User, student_id: uuid.UUID
) -> None:
    """Teacher may see a student iff they share a section (any subject the teacher
    owns) via an ACTIVE enrollment. Denial → 404 (no existence leak, §3.3)."""
    from app.modules.classes.models import ClassTeacher

    teacher_id = _teacher_profile_id(db, caller)
    shares = db.scalar(
        select(ClassEnrollment.id)
        .join(ClassSubject, ClassSubject.class_id == ClassEnrollment.class_id)
        .join(ClassTeacher, ClassTeacher.class_subject_id == ClassSubject.id)
        .where(
            ClassEnrollment.student_id == student_id,
            ClassEnrollment.unenrolled_at.is_(None),
            ClassSubject.deleted_at.is_(None),
            ClassTeacher.teacher_id == teacher_id,
        )
        .exists()
        .select()
    )
    if not shares:
        raise NotFound("Student not found.", code="not_found")


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/me — self (server-derived scope)
# ──────────────────────────────────────────────────────────────────────────────
def get_my_student(db: Session, *, caller: User) -> StudentDetail:
    """GET /students/me (student). Scope is derived from the token's user, NEVER a
    client id (§3.2 hard rule). 404 no_student_profile if the login isn't linked."""
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == caller.id,
            StudentProfile.deleted_at.is_(None),
        )
    )
    if student is None:
        raise NotFound(
            "No student profile is linked to this account.",
            code="no_student_profile",
        )
    semester_id = _active_semester_id(db)
    return _detail(db, student, semester_id=semester_id)


# ──────────────────────────────────────────────────────────────────────────────
# POST /students — create (+ optional enroll into a section, one txn)
# ──────────────────────────────────────────────────────────────────────────────
def create_student(
    db: Session, *, actor: User, payload: StudentCreateRequest
) -> StudentDetail:
    """POST /students (P/S). Optionally enrolls into `section_id` for the active
    semester in the same transaction (FR-STU-05).

    Errors: 409 duplicate_student_number, 409 section_archived, 422 (e.g. DOB in
    the future — handled at the schema/validation layer below), 404 section.
    """
    if payload.date_of_birth > _now().date():
        raise ValidationError(
            "date_of_birth cannot be in the future.",
            fields={"date_of_birth": ["Cannot be in the future."]},
        )

    _assert_number_unique(db, payload.student_number)

    student = StudentProfile(
        student_number=payload.student_number.strip(),
        full_name=payload.full_name.strip(),
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        enrollment_date=payload.enrollment_date,
        status=payload.status,
        guardian_name=payload.guardian_name,
        guardian_phone=payload.guardian_phone,
        guardian_email=payload.guardian_email,
        address=payload.address,
        phone=payload.phone,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(student)
    db.flush()  # assign student.id

    semester_id: uuid.UUID | None = None
    if payload.section_id is not None:
        semester_id = _enroll_into_section(
            db, actor=actor, student=student, section_id=payload.section_id
        )
    else:
        semester_id = _active_semester_id(db)

    _audit(
        db,
        actor=actor,
        action="student.create",
        entity_id=student.id,
        summary={"student_number": student.student_number},
    )
    db.commit()
    return _detail(db, student, semester_id=semester_id)


def _enroll_into_section(
    db: Session, *, actor: User, student: StudentProfile, section_id: uuid.UUID
) -> uuid.UUID:
    """Enroll `student` into `section_id` for the active semester (FR-STU-05).

    Guards: the section must exist (live), its academic year must not be archived
    (else 409 section_archived), and there must be an active semester. Returns the
    active semester id so the caller can shape `current_section`.
    """
    section = db.scalar(
        select(Class).where(Class.id == section_id, Class.deleted_at.is_(None))
    )
    if section is None:
        raise NotFound("Section not found.", code="section_not_found")

    year = db.get(AcademicYear, section.academic_year_id)
    if section.is_archived or (year is not None and year.archived_at is not None):
        raise Conflict(
            "Cannot enroll into a section of an archived year.",
            code="section_archived",
        )

    semester_id = _active_semester_id(db)
    if semester_id is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")

    db.add(
        ClassEnrollment(
            class_id=section.id,
            student_id=student.id,
            semester_id=semester_id,
            created_by=actor.id,
            updated_by=actor.id,
        )
    )
    return semester_id


# ──────────────────────────────────────────────────────────────────────────────
# PATCH /students/{id} — edit (status NOT editable here)
# ──────────────────────────────────────────────────────────────────────────────
def update_student(
    db: Session, *, actor: User, student_id: uuid.UUID, payload: StudentUpdateRequest
) -> StudentDetail:
    """PATCH /students/{id} (P/S). Partial update of profile fields; `status` is
    handled by POST /students/{id}/status only. Re-checks student_number uniqueness
    on change."""
    student = _student_or_404(db, student_id)

    if (
        payload.student_number is not None
        and payload.student_number.strip().lower() != student.student_number.lower()
    ):
        _assert_number_unique(db, payload.student_number, exclude_id=student.id)
        student.student_number = payload.student_number.strip()

    if payload.date_of_birth is not None:
        if payload.date_of_birth > _now().date():
            raise ValidationError(
                "date_of_birth cannot be in the future.",
                fields={"date_of_birth": ["Cannot be in the future."]},
            )
        student.date_of_birth = payload.date_of_birth

    if payload.full_name is not None:
        student.full_name = payload.full_name.strip()
    if payload.gender is not None:
        student.gender = payload.gender
    if payload.enrollment_date is not None:
        student.enrollment_date = payload.enrollment_date
    if payload.guardian_name is not None:
        student.guardian_name = payload.guardian_name
    if payload.guardian_phone is not None:
        student.guardian_phone = payload.guardian_phone
    if payload.guardian_email is not None:
        student.guardian_email = payload.guardian_email
    if payload.address is not None:
        student.address = payload.address
    if payload.phone is not None:
        student.phone = payload.phone

    student.updated_by = actor.id
    _audit(db, actor=actor, action="student.update", entity_id=student.id)
    db.commit()
    return _detail(db, student, semester_id=_active_semester_id(db))


# ──────────────────────────────────────────────────────────────────────────────
# POST /students/{id}/status — lifecycle change (auditable, guarded)
# ──────────────────────────────────────────────────────────────────────────────
def change_student_status(
    db: Session,
    *,
    actor: User,
    student_id: uuid.UUID,
    payload: StudentStatusRequest,
) -> StudentDetail:
    """POST /students/{id}/status (P/S). Validates the transition (FR-STU-04) and
    records before/after in the audit log. 422 invalid_transition on an illegal
    move."""
    student = _student_or_404(db, student_id)
    before = student.status
    after = payload.status

    if before != after:
        allowed = _ALLOWED_STATUS_TRANSITIONS.get(before, set())
        if after not in allowed:
            raise ValidationError(
                f"Cannot change status from '{before.value}' to '{after.value}'.",
                code="invalid_transition",
                fields={"status": [f"Invalid transition from {before.value}."]},
            )
        student.status = after

    student.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="student.status_change",
        entity_id=student.id,
        summary={
            "before": before.value,
            "after": after.value,
            "reason": payload.reason,
        },
    )
    db.commit()
    return _detail(db, student, semester_id=_active_semester_id(db))


# ──────────────────────────────────────────────────────────────────────────────
# DELETE /students/{id} — soft-delete only if no academic history
# ──────────────────────────────────────────────────────────────────────────────
def delete_student(db: Session, *, actor: User, student_id: uuid.UUID) -> None:
    """DELETE /students/{id} (P/S). Soft-delete ONLY IF the student has no academic
    history (any assessment_grades / attendance_records) — those FKs are RESTRICT
    (FR-STU-10). Else 409 has_academic_history ('deactivate instead')."""
    student = _student_or_404(db, student_id)

    if _has_academic_history(db, student.id):
        raise Conflict(
            "This student has grade or attendance history — deactivate instead.",
            code="has_academic_history",
        )

    student.deleted_at = _now()
    student.updated_by = actor.id
    _audit(db, actor=actor, action="student.delete", entity_id=student.id)
    db.commit()


def _has_academic_history(db: Session, student_id: uuid.UUID) -> bool:
    """True if the student is referenced by any grade or attendance record. Import
    locally to avoid a heavy import at module load and keep boundaries clean."""
    from app.modules.attendance.models import AttendanceRecord
    from app.modules.grades.models import AssessmentGrade

    has_grade = db.scalar(
        select(exists().where(AssessmentGrade.student_id == student_id))
    )
    if has_grade:
        return True
    has_attendance = db.scalar(
        select(exists().where(AttendanceRecord.student_id == student_id))
    )
    return bool(has_attendance)


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/{id}/assessments — assessments for the student's section subjects
# ──────────────────────────────────────────────────────────────────────────────
def list_student_assessments(
    db: Session,
    *,
    caller: User,
    student_id: uuid.UUID,
    semester_id: uuid.UUID | None,
) -> list[StudentAssessmentItem]:
    """GET /students/{id}/assessments (P/S any; Teacher must own a section the
    student is in → else 404). Returns assessments for the subjects offered in the
    student's active section, grouped-friendly (ordered by subject then date).

    This is a student-DETAIL read for an admin/teacher viewer; a student self uses
    GET /assessments?scope=me (Assessments module, not built here). We surface the
    published/known assessment set for the section's subjects.
    """
    student = _student_or_404(db, student_id)
    if caller.role == Role.TEACHER:
        _assert_teacher_can_see_student(db, caller, student.id)

    target_semester = semester_id or _active_semester_id(db)
    if target_semester is None:
        return []

    # The student's active section for the target semester.
    section_id = db.scalar(
        select(ClassEnrollment.class_id).where(
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.semester_id == target_semester,
            ClassEnrollment.unenrolled_at.is_(None),
        )
    )
    if section_id is None:
        return []

    # Assessments for every live class_subject of that section, in the semester.
    # Draft assessments are internal-only; the student-detail view shows the known
    # (published+) set. We join class + subject once (no N+1).
    rows = db.execute(
        select(Assessment, ClassSubject, Class, Subject)
        .join(ClassSubject, Assessment.class_subject_id == ClassSubject.id)
        .join(Class, ClassSubject.class_id == Class.id)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(
            ClassSubject.class_id == section_id,
            ClassSubject.deleted_at.is_(None),
            Assessment.semester_id == target_semester,
            Assessment.deleted_at.is_(None),
            Assessment.status != AssessmentStatus.DRAFT,
        )
        .order_by(Subject.name.asc(), Assessment.assessment_date.asc().nullslast())
    ).all()

    return [
        StudentAssessmentItem(
            id=a.id,
            title=a.title,
            type=a.type,
            assessment_date=a.assessment_date,
            max_score=float(a.max_score),
            class_subject_id=cs.id,
            class_ref=ClassRef.model_validate(cls),
            subject=SubjectRef.model_validate(subj),
            status=a.status.value,
        )
        for (a, cs, cls, subj) in rows
    ]

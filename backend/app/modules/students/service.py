"""Students service (api-spec §5 Module 3, FR-STU-01..10).

Owns DB access + transactions for the 8 student endpoints; the router is thin.

Cross-cutting discipline honored here (api-spec §3):
  * Server-derived student scope — `/students/me` resolves the profile from the
    token's user, NEVER a client-supplied id (§3.2 hard rule).
  * Teacher scope — a teacher only lists/reads students enrolled in a class they
    own any subject of (`assert_teacher_owns_section` as a read filter). A student
    a teacher can't reach yields 404, not 403 (§3.3, no existence leak).
  * 404-vs-403 — record-ownership denial → 404; role denial is handled by the
    router's `require_role`.

Uniqueness (`student_number`) is enforced at the DB by a partial-unique index over
live rows (`uq_student_profiles_number WHERE deleted_at IS NULL`). We pre-check for
the documented 409 code; the index is the backstop against a race.

D29 (sixth form): a student sits MANY subject classes, so `current_section` became
`current_classes` — a list derived from `class_enrollments` (unenrolled_at IS NULL)
joined to `classes` — and the level shown on screen comes from
`student_profiles.year_group` rather than from a homeroom's `grade_level`. The target
student id is the enforcement key for grades — this module never fabricates them.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.common.enums import AcademicYearStatus, Role, StudentStatus
from app.common.schemas import AuditStamp, ClassRef, SubjectRef, UserRef
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id
from app.modules.assessments import release_nudge
from app.modules.classes.models import Class, ClassEnrollment, ClassSubject
from app.modules.grades import service as grades_service
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile
from app.modules.students.numbering import allocate_student_number
from app.modules.programs.models import Program
from app.modules.students.schemas import (
    ProgramRef,
    StudentAssessmentGroup,
    StudentAssessmentLine,
    StudentAssessmentsResponse,
    StudentCreateRequest,
    StudentDetail,
    StudentListItem,
    StudentStatusRequest,
    StudentTermGrade,
    StudentUpdateRequest,
    StudentYearItem,
    StudentYearsResponse,
)
from app.modules.users.models import User

# Allowed sort fields for the students list (whitelist — never interpolated, §6).
#
# Each key maps to a TUPLE of columns, because sorting by name is (surname, given
# name) and not a single column (D30 §D10, brief §11). `full_name` and `name` are
# accepted spellings of that same ordering: a caller asking for "the name order" gets
# the register order, never an alphabetical-by-first-name list. The old behaviour —
# ordering on the combined display string — is not reachable any more, and the column
# it read no longer exists (`007_student_names.sql`).
_STUDENT_SORT_FIELDS: dict[str, tuple] = {
    "name": (StudentProfile.last_name, StudentProfile.first_name),
    "full_name": (StudentProfile.last_name, StudentProfile.first_name),
    "last_name": (StudentProfile.last_name, StudentProfile.first_name),
    "first_name": (StudentProfile.first_name, StudentProfile.last_name),
    "student_number": (StudentProfile.student_number,),
    "status": (StudentProfile.status,),
    "year_group": (StudentProfile.year_group,),
    "created_at": (StudentProfile.created_at,),
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


def _active_year_id(db: Session) -> uuid.UUID | None:
    """The single active academic year (schema §3.C), or None if unconfigured."""
    return db.scalar(
        select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


# ──────────────────────────────────────────────────────────────────────────────
# Year → classes resolution (THE single implementation)
# ──────────────────────────────────────────────────────────────────────────────
def classes_in_year(
    db: Session, *, student_id: uuid.UUID, academic_year_id: uuid.UUID
) -> list[Class]:
    """Every subject class the student sat in during `academic_year_id`.

    D29 turned this from `section_in_year` (one homeroom) into a list: a sixth-former
    takes Math-1, Biology-10 and English-5, and returning only the first would have
    hidden most of their record behind an arbitrary tiebreak.

    An academic year spans BOTH semesters, so this resolves through
    `class_enrollments → semesters → academic_years` rather than filtering on a
    single semester, and ended enrollments (`unenrolled_at` set) still count — a
    past year is exactly the case where they are set.

    This is the single implementation of "which classes that year". The student
    detail header (`GET /students/{id}?academic_year_id=`) and the assessments tab
    (`GET /students/{id}/assessments?academic_year_id=`) MUST agree, or one screen
    shows a different set of classes for the same student at the same time.

    It lives here rather than in the Grades module because it is an enrollment
    question, not grade math; `grades.service.student_assessment_groups` takes the
    classes this resolves as a parameter (Students imports Grades, never the
    reverse).
    """
    rows = db.execute(
        select(Class)
        .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
        .join(Semester, ClassEnrollment.semester_id == Semester.id)
        .where(
            ClassEnrollment.student_id == student_id,
            Semester.academic_year_id == academic_year_id,
            Class.deleted_at.is_(None),
        )
        .order_by(Class.name.asc())
    ).scalars()
    # DISTINCT in Python, not SQL: a student enrolled in the same class across both
    # semesters yields two rows, and DISTINCT on a whole ORM entity is dialect-fussy.
    seen: dict[uuid.UUID, Class] = {}
    for cls in rows:
        seen.setdefault(cls.id, cls)
    return list(seen.values())


def _assessments_classes(
    db: Session, *, student_id: uuid.UUID, academic_year_id: uuid.UUID | None
) -> list[Class]:
    """The classes that scope the assessments tab.

    An EXPLICIT year is strict — if the student never sat that year the tab is
    empty, rather than silently answering about a different year. With no year
    asked for we use the active year, falling back to the student's live
    enrollments so a school with no active year configured still renders.
    """
    if academic_year_id is not None:
        return classes_in_year(
            db, student_id=student_id, academic_year_id=academic_year_id
        )

    active_year_id = _active_year_id(db)
    classes = (
        classes_in_year(db, student_id=student_id, academic_year_id=active_year_id)
        if active_year_id is not None
        else []
    )
    if not classes:
        classes = list(
            db.execute(
                select(Class)
                .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
                .where(
                    ClassEnrollment.student_id == student_id,
                    ClassEnrollment.unenrolled_at.is_(None),
                    Class.deleted_at.is_(None),
                )
                .order_by(Class.name.asc())
            ).scalars()
        )
    return classes


def _current_classes_map(
    db: Session, student_ids: list[uuid.UUID], *, semester_id: uuid.UUID | None
) -> dict[uuid.UUID, list[ClassRef]]:
    """Batch-resolve each student's active classes for `semester_id` in ONE query
    (avoids N+1 on the list endpoint).

    D29: the value is a LIST, not a single ClassRef — `uq_enroll_active` allows one
    row per (class, student, semester), so a student legitimately has many.
    """
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
        .order_by(Class.name.asc())
    ).all()
    out: dict[uuid.UUID, list[ClassRef]] = {}
    for sid, cls in rows:
        out.setdefault(sid, []).append(ClassRef.model_validate(cls))
    return out


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
    db: Session,
    student: StudentProfile,
    *,
    semester_id: uuid.UUID | None,
    academic_year_id: uuid.UUID | None = None,
) -> StudentDetail:
    """Shape a StudentDetail. `current_classes` is the student's ACTIVE-semester
    subject classes, unless `academic_year_id` is supplied — then it is the classes
    they sat in that year, so the profile header agrees with the assessments tab when
    the year switcher is on a past year.

    The branch is on the PRESENCE of the param, not on resolving-then-falling-back:
    an explicit year the student never sat in yields `[]`, never another year's
    classes."""
    detail = StudentDetail.model_validate(student)
    if academic_year_id is not None:
        detail.current_classes = [
            ClassRef.model_validate(c)
            for c in classes_in_year(
                db, student_id=student.id, academic_year_id=academic_year_id
            )
        ]
    else:
        detail.current_classes = _current_classes_map(
            db, [student.id], semester_id=semester_id
        ).get(student.id, [])
    # The programme is a REF, not the raw uuid: every screen that shows a student shows
    # the code, and making each one fetch `/programs/{id}` to render one chip would be a
    # request per row (D30 §D12).
    if student.program_id is not None:
        program = db.get(Program, student.program_id)
        if program is not None:
            detail.program = ProgramRef(
                id=program.id, code=program.code, name=program.name
            )
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
    year_group: str | None,
    academic_year_id: uuid.UUID | None = None,
):
    """GET /students (P/S/Teacher). Page[StudentListItem]; default sort by surname.

    Teacher scope (FR-STU-08): restricted to students with an active enrollment in
    a class the teacher owns ANY class_subject of — enforced as a read filter, so
    a teacher literally cannot page students outside their classes.

    D29: the level filter is `year_group` and reads `student_profiles.year_group`
    directly. It used to be `grade_level` resolved through the student's homeroom,
    which under a sixth-form model would have answered "which of their subject classes
    is labelled Lower 6" instead of "which level is this student in".

    `academic_year_id` (the module year switcher) FILTERS the student set: a PAST
    year restricts the directory to the students enrolled that year. It
    deliberately does NOT rescope each row's `class_count`, which stays the student's
    live load — the field describes the present.

    The ACTIVE year (or no year at all) applies NO enrollment filter, so the full
    directory still lists — including graduated / withdrawn / transferred students
    who hold no active enrollment. Filtering on the active year would quietly empty
    the `status=graduated` view (mock: `academic_year_id !== activeYearId`).
    """
    semester_id = _active_semester_id(db)
    # Only a PAST year scopes the roster; the active year means "the directory".
    past_year_id = (
        academic_year_id
        if academic_year_id is not None and academic_year_id != _active_year_id(db)
        else None
    )

    stmt = select(StudentProfile).where(StudentProfile.deleted_at.is_(None))

    if status is not None:
        stmt = stmt.where(StudentProfile.status == status)

    if search:
        like = f"%{search.strip()}%"
        # `full_name` is the hybrid (D30 §D10) and compiles to CONCAT_WS, so typing a
        # name in full still matches. The individual parts are matched too, because
        # the register is surname-first and a Registrar searching "Perez Ana" would
        # otherwise get nothing.
        stmt = stmt.where(
            StudentProfile.full_name.ilike(like)
            | StudentProfile.first_name.ilike(like)
            | StudentProfile.last_name.ilike(like)
            | StudentProfile.student_number.ilike(like)
        )

    if year_group is not None:
        stmt = stmt.where(StudentProfile.year_group == year_group)

    # Class filter and teacher scope constrain via class_enrollments → classes. We
    # build an EXISTS correlated subquery so a student appears once regardless of how
    # the joins fan out — which matters much more under D29, where a student has many
    # enrollments and a plain join would return them once per class.
    needs_enrollment_scope = (
        past_year_id is not None
        or class_id is not None
        or caller.role == Role.TEACHER
    )
    if needs_enrollment_scope:
        enr = (
            select(ClassEnrollment.id)
            .join(Class, ClassEnrollment.class_id == Class.id)
            .where(
                ClassEnrollment.student_id == StudentProfile.id,
                Class.deleted_at.is_(None),
            )
        )
        if past_year_id is not None:
            # Historical roster: any semester of that year, and ENDED enrollments
            # count — `unenrolled_at` being set is the normal state for a past
            # year, so requiring it NULL would return an empty directory.
            enr = enr.where(
                ClassEnrollment.semester_id.in_(
                    select(Semester.id).where(
                        Semester.academic_year_id == past_year_id
                    )
                )
            )
        else:
            # Live view: constrain to the active semester when known so section /
            # grade filters and teacher scope reflect the current term.
            enr = enr.where(ClassEnrollment.unenrolled_at.is_(None))
            if semester_id is not None:
                enr = enr.where(ClassEnrollment.semester_id == semester_id)
        if class_id is not None:
            enr = enr.where(Class.id == class_id)

        if caller.role == Role.TEACHER:
            teacher_id = _teacher_profile_id(db, caller)
            enr = _apply_teacher_ownership(enr, teacher_id)

        stmt = stmt.where(enr.exists())

    sort = (params.sort or "name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    cols = _STUDENT_SORT_FIELDS.get(key)
    if cols is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(
        *[c.desc() if desc else c.asc() for c in cols], StudentProfile.id.asc()
    )

    page = paginate(db, stmt, params, serialize=StudentListItem.model_validate)

    # Attach class_count to each item in ONE batched query (no N+1).
    ids = [item.id for item in page.items]
    classes_map = _current_classes_map(db, ids, semester_id=semester_id)
    for item in page.items:
        item.class_count = len(classes_map.get(item.id, []))
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
def get_student(
    db: Session,
    *,
    caller: User,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None = None,
) -> StudentDetail:
    """GET /students/{id} (P/S any; Teacher must own a class the student is in →
    else 404, §3.3).

    `academic_year_id` rescopes `current_classes` to the classes the student sat in
    that year (the profile page's year switcher). RBAC is unaffected — the teacher
    ownership check is still evaluated against the student's LIVE enrollments, so
    selecting a past year can never widen a teacher's reach.
    """
    student = _student_or_404(db, student_id)
    if caller.role == Role.TEACHER:
        _assert_teacher_can_see_student(db, caller, student.id)
    return _detail(
        db,
        student,
        semester_id=_active_semester_id(db),
        academic_year_id=academic_year_id,
    )


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
def _my_student_or_404(db: Session, caller: User) -> StudentProfile:
    """The profile linked to the token's user (§3.2 hard rule — never a client id)."""
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
    return student


def get_my_student(
    db: Session, *, caller: User, academic_year_id: uuid.UUID | None = None
) -> StudentDetail:
    """GET /students/me (student). Scope is derived from the token's user, NEVER a
    client id (§3.2 hard rule). 404 no_student_profile if the login isn't linked.

    `academic_year_id` rescopes `current_classes` to the classes this student sat in
    that year, so their "My Profile" header agrees with the year·semester switcher
    instead of always showing their current load. Identical to the `academic_year_id`
    handling in `get_student` — and equally unable to affect WHICH student is read,
    since that comes from `caller` alone."""
    student = _my_student_or_404(db, caller)
    semester_id = _active_semester_id(db)
    return _detail(
        db, student, semester_id=semester_id, academic_year_id=academic_year_id
    )


# ──────────────────────────────────────────────────────────────────────────────
# POST /students — create (+ optional enroll into subject classes, one txn)
# ──────────────────────────────────────────────────────────────────────────────
def create_student(
    db: Session, *, actor: User, payload: StudentCreateRequest
) -> StudentDetail:
    """POST /students (P/S). Optionally enrolls into every class in `class_ids` for
    the active semester in the same transaction (FR-STU-05).

    D29: `class_ids` is a list, so registering a sixth-former and their whole subject
    load is one call. All-or-nothing — if any class is missing or archived the whole
    create rolls back, rather than leaving a student half-enrolled.

    D30: `student_number` is optional. Omitted, the server issues the next
    `YYYYMM###` for the school-local month (§D9) — generation is server-side only, so
    a client cannot pick its own place in the sequence.

    Errors: 409 duplicate_student_number, 409 student_number_exhausted, 409
    section_archived, 422 (e.g. DOB in the future — handled at the schema/validation
    layer below), 404 section.
    """
    if payload.date_of_birth > _now().date():
        raise ValidationError(
            "date_of_birth cannot be in the future.",
            fields={"date_of_birth": ["Cannot be in the future."]},
        )

    if payload.student_number is None:
        # Allocated inside THIS transaction, before the insert below, so a failed
        # registration rolls the sequence back with it and no number is burnt.
        student_number = allocate_student_number(db)
    else:
        student_number = payload.student_number.strip()
        _assert_number_unique(db, student_number)

    student = StudentProfile(
        student_number=student_number,
        first_name=payload.first_name.strip(),
        middle_name=(payload.middle_name or "").strip() or None,
        last_name=payload.last_name.strip(),
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        year_group=payload.year_group,
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
    if payload.class_ids:
        for class_id in dict.fromkeys(payload.class_ids):
            semester_id = _enroll_into_section(
                db, actor=actor, student=student, section_id=class_id
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
    """Enroll `student` into one subject class for the active semester (FR-STU-05).

    Guards: the class must exist (live), its academic year must not be archived
    (else 409 section_archived), and there must be an active semester. Returns the
    active semester id so the caller can shape `current_classes`.

    Purely additive, like `classes.service.enroll_students` — it never closes another
    enrollment, so calling it once per class in `class_ids` builds up the student's
    whole subject load.
    """
    section = db.scalar(
        select(Class).where(Class.id == section_id, Class.deleted_at.is_(None))
    )
    if section is None:
        raise NotFound("Class not found.", code="section_not_found")

    year = db.get(AcademicYear, section.academic_year_id)
    if section.is_archived or (year is not None and year.archived_at is not None):
        raise Conflict(
            "Cannot enroll into a class of an archived year.",
            code="section_archived",
        )

    semester_id = _active_semester_id(db)
    if semester_id is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")

    # D30 §D4 — the same prerequisite gate the Classes module applies. It has to be
    # here too: registering a student with `class_ids` enrols them without ever
    # touching `POST /classes/{id}/enrollments`, so gating only there would leave the
    # rule enforceable from one door and not the other.
    #
    # Imported inside the function — `prerequisites.service` reads grades, which reads
    # students, and a module-level import would close the cycle.
    from app.modules.classes import service as classes_service
    from app.modules.prerequisites import service as prereq_service

    course_id = classes_service.course_id_for_section(db, section.id)
    if course_id is not None:
        prereq_service.assert_eligible(
            db, student=student, course_id=course_id, semester_id=semester_id
        )

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

    if payload.first_name is not None:
        student.first_name = payload.first_name.strip()
    if payload.middle_name is not None:
        # "" clears it — a middle name a Registrar entered by mistake has to be
        # removable, and NULL is the right stored value, not an empty string.
        student.middle_name = payload.middle_name.strip() or None
    if payload.last_name is not None:
        student.last_name = payload.last_name.strip()
    if payload.gender is not None:
        student.gender = payload.gender
    if payload.year_group is not None:
        student.year_group = payload.year_group
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
# GET /students/{id}/assessments — grouped by offering, with the term grade
# ──────────────────────────────────────────────────────────────────────────────
def list_student_assessments(
    db: Session,
    *,
    caller: User,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
) -> StudentAssessmentsResponse:
    """GET /students/{id}/assessments (P/S any; Teacher must own a class the
    student is in → else 404, §3.3).

    A student-DETAIL read for an admin/teacher viewer (a student self uses
    `GET /grades/me`). Returns `{items:[...]}` grouped by `class_subject`, each
    group carrying the subject label, the student's term grade and the per-
    assessment lines with that student's own grade status/score.

    `academic_year_id` scopes to the classes the student sat that YEAR — a year
    spans both semesters, so this is deliberately NOT a semester filter. The
    resolution is `classes_in_year`, the SAME helper `GET /students/{id}` uses, so
    the profile header and this tab can never disagree about which classes the
    student sat in. Under D29 that is a LIST, so the tab spans every subject class
    the student takes rather than the subjects of one homeroom.

    All loading + arithmetic is delegated to
    `grades.service.student_assessment_groups`, which routes the term grade through
    the single engine in `grades/calc.py`. This function only resolves the classes
    and maps the dataclasses it returns onto the Students wire schema.
    """
    student = _student_or_404(db, student_id)
    if caller.role == Role.TEACHER:
        _assert_teacher_can_see_student(db, caller, student.id)

    sections = _assessments_classes(
        db, student_id=student.id, academic_year_id=academic_year_id
    )
    groups = grades_service.student_assessment_groups(
        db, student_id=student.id, sections=sections
    )
    return StudentAssessmentsResponse(
        items=[
            StudentAssessmentGroup(
                class_subject_id=g.class_subject_id,
                subject=SubjectRef(
                    id=g.subject_id, name=g.subject_name, code=g.subject_code
                ),
                term_grade=StudentTermGrade(
                    numeric=g.term_numeric, letter=g.term_letter
                ),
                assessments=[
                    StudentAssessmentLine(
                        id=line.id,
                        title=line.title,
                        type=line.type,
                        max_score=line.max_score,
                        weight=line.weight,
                        assessment_date=line.assessment_date,
                        status=line.status,
                        score=line.score,
                        is_released=line.is_released,
                        last_nudged_at=line.last_nudged_at,
                    )
                    for line in g.assessments
                ],
            )
            for g in groups
        ],
        nudge_cooldown_seconds=release_nudge.NUDGE_COOLDOWN_SECONDS,
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/{id}/years + GET /students/me/years — the year switcher
# ──────────────────────────────────────────────────────────────────────────────
def _years_for_student(db: Session, student_id: uuid.UUID) -> list[AcademicYear]:
    """Academic years the student was ACTUALLY enrolled in, newest first.

    Resolved through `class_enrollments → semesters → academic_years`. Ended
    enrollments count (`unenrolled_at` is not filtered) — the whole point of the
    switcher is to reach past years. The year id set is an IN-subquery rather than
    a DISTINCT over a joined entity select, so the ordering columns stay
    unambiguous across dialects.
    """
    enrolled_year_ids = (
        select(Semester.academic_year_id)
        .join(ClassEnrollment, ClassEnrollment.semester_id == Semester.id)
        .where(ClassEnrollment.student_id == student_id)
    )
    return list(
        db.scalars(
            select(AcademicYear)
            .where(AcademicYear.id.in_(enrolled_year_ids))
            .order_by(AcademicYear.start_date.desc(), AcademicYear.name.desc())
        ).all()
    )


def _years_response(db: Session, student_id: uuid.UUID) -> StudentYearsResponse:
    return StudentYearsResponse(
        items=[
            StudentYearItem.model_validate(y) for y in _years_for_student(db, student_id)
        ]
    )


def list_student_years(
    db: Session, *, caller: User, student_id: uuid.UUID
) -> StudentYearsResponse:
    """GET /students/{id}/years (P/S any; Teacher must own a section the student is
    in → else 404, §3.3). Students are denied at the role gate → use /me/years."""
    student = _student_or_404(db, student_id)
    if caller.role == Role.TEACHER:
        _assert_teacher_can_see_student(db, caller, student.id)
    return _years_response(db, student.id)


def list_my_years(db: Session, *, caller: User) -> StudentYearsResponse:
    """GET /students/me/years (student). Server-derived scope (§3.2) — the profile
    comes from the token, never a param. 404 no_student_profile if unlinked, the
    same contract as GET /students/me."""
    student = _my_student_or_404(db, caller)
    return _years_response(db, student.id)

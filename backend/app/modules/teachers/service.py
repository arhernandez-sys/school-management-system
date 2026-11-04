"""Teachers service (api-spec §5 Module 4, FR-TCH-01..07).

Owns DB access + transactions for the 6 teacher endpoints; the router is thin.

Discipline honored here (api-spec §3):
  * Role gates live in the router (`require_role`). Teacher reads are directory-
    only (RO); Student → 403 at the gate.
  * Deactivation / hard-delete are BLOCKED while the teacher is assigned to any
    active class_subject (FR-TCH-06) → 409 teacher_has_active_assignments, with the
    offending class_subject refs for reassignment guidance.

Uniqueness (`staff_number`) is enforced at the DB by a partial-unique index over
live rows (`uq_teacher_profiles_number WHERE deleted_at IS NULL`); we pre-check for
the documented 409 and the index backstops races. `create_login` provisioning
mirrors the Settings user-create path (admin-provisioned, D5): a linked `users`
row is created in the SAME transaction, must_change_password=true, temp password
echoed once.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.common.enums import AcademicYearStatus, Role, TeacherStatus
from app.common.schemas import AuditStamp, OfferingRef, CourseRef, SemesterRef, UserRef
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.security import generate_temp_password, hash_password
from app.modules.offerings.queries import offerings_in_year
from app.modules.offerings.labels import OFFERING_ORDER, offering_label
from app.modules.offerings.models import CourseOffering, CourseOffering, ClassTeacher, Course
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.teachers.models import TeacherProfile
from app.modules.teachers.schemas import (
    ClassTaught,
    TeacherYearItem,
    TeacherYearsResponse,
    TeacherCreateRequest,
    TeacherDetail,
    TeacherExpertise,
    TeacherListItem,
    TeacherStatusRequest,
    TeacherUpdateRequest,
)
from app.core.rbac import hod_program_ids, hod_teacher_ids
from app.modules.users.models import User

# Allowed sort fields for the teachers list (whitelist — never interpolated, §6).
_TEACHER_SORT_FIELDS = {
    "full_name": TeacherProfile.full_name,
    "staff_number": TeacherProfile.staff_number,
    "status": TeacherProfile.status,
    "created_at": TeacherProfile.created_at,
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
            entity_type="teacher",
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + shared shaping
# ──────────────────────────────────────────────────────────────────────────────
def _teacher_or_404(db: Session, teacher_id: uuid.UUID) -> TeacherProfile:
    teacher = db.scalar(
        select(TeacherProfile).where(
            TeacherProfile.id == teacher_id,
            TeacherProfile.deleted_at.is_(None),
        )
    )
    if teacher is None:
        raise NotFound("Teacher not found.", code="not_found")
    return teacher


def _assert_staff_number_unique(
    db: Session, staff_number: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(TeacherProfile.id).where(
        func.lower(TeacherProfile.staff_number) == staff_number.strip().lower(),
        TeacherProfile.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(TeacherProfile.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A teacher with this staff number already exists.",
            code="duplicate_staff_number",
        )


def _classes_taught(
    db: Session,
    teacher_id: uuid.UUID,
    *,
    academic_year_id: uuid.UUID | None = None,
) -> list[ClassTaught]:
    """The offerings this lecturer is assigned to. One join since D31 — ownership rows
    point straight at the offering, where they used to reach it through `class_subjects`.

    `academic_year_id` narrows it to one year (D42 §2), reaching the year through the
    offering's semester — an offering stores no year of its own. Absent, every year the
    lecturer has ever taught comes back, which is the behaviour every existing caller
    (create / patch / status) still wants.

    **The `SemesterRef` is new.** This built the ref without a `semester`, so the profile's
    term line — `c.offering.semester?.name` — has rendered blank against the real backend
    since D31 while the demo handlers filled it in. A year switcher whose rows do not say
    which term they belong to would have been the same bug wearing a bigger hat.
    """
    stmt = (
        select(ClassTeacher, CourseOffering, Course, Semester)
        .join(CourseOffering, ClassTeacher.offering_id == CourseOffering.id)
        .join(Course, CourseOffering.course_id == Course.id)
        .join(Semester, CourseOffering.semester_id == Semester.id)
        .where(
            ClassTeacher.teacher_id == teacher_id,
            CourseOffering.deleted_at.is_(None),
        )
        .order_by(*OFFERING_ORDER)
    )
    if academic_year_id is not None:
        stmt = stmt.where(offerings_in_year(academic_year_id))
    rows = db.execute(stmt).all()
    return [
        ClassTaught(
            offering_id=offering.id,
            offering=OfferingRef(
                id=offering.id,
                course=CourseRef.model_validate(course),
                semester=SemesterRef.model_validate(semester),
                section_code=offering.section_code,
                label=offering_label(course.code, offering.section_code),
            ),
            is_lead=ct.is_lead,
        )
        for (ct, offering, course, semester) in rows
    ]


def teacher_years(db: Session, *, teacher_id: uuid.UUID) -> TeacherYearsResponse:
    """GET /teachers/{id}/years — the academic years this lecturer taught in, newest
    first (D42 §2). The mirror of `students.service._years_for_student`.

    Resolved through `class_teachers -> course_offerings -> semesters -> academic_years`.
    Inactive and archived years count: reaching a past year is the entire point of the
    switcher. Deleted offerings do not.
    """
    taught_year_ids = (
        select(Semester.academic_year_id)
        .join(CourseOffering, CourseOffering.semester_id == Semester.id)
        .join(ClassTeacher, ClassTeacher.offering_id == CourseOffering.id)
        .where(
            ClassTeacher.teacher_id == teacher_id,
            CourseOffering.deleted_at.is_(None),
        )
    )
    years = db.scalars(
        select(AcademicYear)
        .where(AcademicYear.id.in_(taught_year_ids))
        .order_by(AcademicYear.start_date.desc(), AcademicYear.name.desc())
    ).all()
    return TeacherYearsResponse(
        items=[TeacherYearItem.model_validate(y) for y in years]
    )


def _audit_stamp(db: Session, teacher: TeacherProfile) -> AuditStamp:
    actor_ids = {
        i for i in (teacher.created_by, teacher.updated_by) if i is not None
    }
    actors: dict[uuid.UUID, UserRef] = {}
    if actor_ids:
        for u in db.execute(select(User).where(User.id.in_(actor_ids))).scalars():
            actors[u.id] = UserRef.model_validate(u)
    return AuditStamp(
        created_at=teacher.created_at,
        updated_at=teacher.updated_at,
        created_by=actors.get(teacher.created_by) if teacher.created_by else None,
        updated_by=actors.get(teacher.updated_by) if teacher.updated_by else None,
    )


def _clean(value: str | None) -> str | None:
    """Trim an optional free-text field; whitespace-only becomes NULL.

    A field holding only spaces is not a value — stored as-is it renders as a
    mysteriously blank-but-present line on the profile card. Matches how the PATCH path
    has always treated these.
    """
    if value is None:
        return None
    return value.strip() or None


def _sync_is_employed(teacher: TeacherProfile) -> None:
    """Keep `is_employed` in step with `status` (D39, Meeting #2 item 10).

    The client renamed their `IsPresent` column to `IsEmployed` and the DB person's dump
    added it, but this schema already answers that question with
    `status enum('active','inactive')`. Rather than migrate the application onto the new
    column or expose both for editing, `status` stays authoritative and this mirrors it.

    Called from teacher creation and from `change_teacher_status` — the only two places
    `status` is written. `is_employed` is deliberately absent from both request schemas,
    so there is no path by which a caller can set it out of step.
    """
    teacher.is_employed = teacher.status == TeacherStatus.ACTIVE


def _detail(
    db: Session,
    teacher: TeacherProfile,
    *,
    academic_year_id: uuid.UUID | None = None,
) -> TeacherDetail:
    detail = TeacherDetail.model_validate(teacher)
    detail.subject_specializations = teacher.subject_specializations or []
    # Same reason as the line above: the column is NULL for every lecturer whose profile
    # has never been filled in, and `model_validate` carries that NULL straight through
    # a `default_factory` that only fires when the key is ABSENT.
    detail.expertise = [
        TeacherExpertise.model_validate(row) for row in (teacher.expertise or [])
    ]
    detail.classes_taught = _classes_taught(
        db, teacher.id, academic_year_id=academic_year_id
    )
    detail.audit = _audit_stamp(db, teacher)
    return detail


def _active_assignment_refs(db: Session, teacher_id: uuid.UUID) -> list[dict]:
    """The class_subject refs the teacher is currently assigned to (active/live
    offerings) — surfaced in the 409 so the admin knows what to reassign
    (FR-TCH-06)."""
    rows = db.execute(
        select(CourseOffering.id, Course.code, CourseOffering.section_code, Course.name)
        .join(ClassTeacher, ClassTeacher.offering_id == CourseOffering.id)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            ClassTeacher.teacher_id == teacher_id,
            CourseOffering.deleted_at.is_(None),
        )
    ).all()
    return [
        {
            "offering_id": str(oid),
            "offering_label": offering_label(code, section),
            "course_name": cname,
        }
        for (oid, code, section, cname) in rows
    ]


# ──────────────────────────────────────────────────────────────────────────────
# GET /teachers — directory list
# ──────────────────────────────────────────────────────────────────────────────
def list_teachers(
    db: Session,
    *,
    params: PageParams,
    search: str | None,
    status: TeacherStatus | None,
    specialization: str | None,
    academic_year_id: uuid.UUID | None = None,
    caller: User | None = None,
):
    """GET /teachers (P/S/Teacher RO). Page[TeacherListItem]; default sort
    full_name. `specialization` matches the JSON array via MariaDB JSON_SEARCH.

    `academic_year_id` scopes the directory to staff who actually taught that
    year, for the module's year switcher. Two things about it are deliberate and
    mirror the equivalent rule on `students.list_students`:

    * **A PAST year filters the set**; the active year (or no param) does not.
      Filtering on the active year would hide any teacher who holds no offering
      yet — a newly hired member of staff, or anyone between assignments — which
      silently empties the directory exactly when it is most needed.
    * Membership is resolved through `class_teachers -> class_subjects -> classes`
      for that year, so it reflects real assignments rather than the teacher's
      own status field.

    Before this parameter existed the frontend sent it and FastAPI silently
    dropped it (undeclared query params are discarded, not rejected), so the year
    switcher appeared to work while returning the same rows for every year.
    """
    stmt = select(TeacherProfile).where(TeacherProfile.deleted_at.is_(None))

    if caller is not None and caller.role == Role.HOD:
        # D43 — "they can see all the teachers under their program". Derived from actual
        # teaching assignments, because that is the only link a lecturer has to a
        # programme: `teacher_profiles` carries no programme column and never has.
        #
        # The head appears in their own list when they teach in their own programme,
        # which is right — a department list that omits its head is a list of other
        # people. A colleague who teaches nothing in the programme is correctly absent.
        stmt = stmt.where(
            TeacherProfile.id.in_(hod_teacher_ids(db, hod_program_ids(db, caller)))
        )

    if status is not None:
        stmt = stmt.where(TeacherProfile.status == status)

    if academic_year_id is not None:
        active = db.scalar(
            select(AcademicYear.id).where(
                AcademicYear.status == AcademicYearStatus.ACTIVE
            )
        )
        # Compared as strings on purpose. FastAPI hands us a real `uuid.UUID` and
        # the GUID TypeDecorator returns one too, so `!=` works — but a caller
        # passing a str (a script, a test using raw text() SQL that bypasses the
        # decorator) would silently miss the exemption and filter the ACTIVE year,
        # emptying the directory. Failing that way is worse than the cost of str().
        if str(academic_year_id) != str(active):
            stmt = stmt.where(
                exists().where(
                    ClassTeacher.teacher_id == TeacherProfile.id,
                    ClassTeacher.offering_id == CourseOffering.id,
                    CourseOffering.deleted_at.is_(None),
                    offerings_in_year(academic_year_id),
                )
            )

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            TeacherProfile.full_name.ilike(like)
            | TeacherProfile.staff_number.ilike(like)
        )

    if specialization:
        # JSON-array membership on MariaDB: JSON_SEARCH returns the path to a
        # matching string element (or NULL). The term is a bound parameter, so
        # this is injection-safe. Exact element match (no LIKE wildcards passed).
        stmt = stmt.where(
            func.json_search(
                TeacherProfile.subject_specializations,
                "one",
                specialization.strip(),
            ).is_not(None)
        )

    sort = (params.sort or "full_name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _TEACHER_SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(col.desc() if desc else col.asc(), TeacherProfile.id.asc())

    def _serialize(row: TeacherProfile) -> TeacherListItem:
        item = TeacherListItem.model_validate(row)
        item.subject_specializations = row.subject_specializations or []
        return item

    return paginate(db, stmt, params, serialize=_serialize)


# ──────────────────────────────────────────────────────────────────────────────
# GET /teachers/{id} — detail
# ──────────────────────────────────────────────────────────────────────────────
def get_teacher(
    db: Session, *, teacher_id: uuid.UUID, academic_year_id: uuid.UUID | None = None
) -> TeacherDetail:
    """GET /teachers/{id} (P/S/Teacher RO). Teacher directory is not scoped by
    ownership (FR-TCH-05/07) — any authenticated non-student may read any teacher;
    Student is denied at the role gate (403).

    `academic_year_id` scopes `classes_taught` to one year (D42 §2). It narrows the view
    and can never widen it: the assignments listed are this lecturer's either way.
    """
    return _detail(
        db, _teacher_or_404(db, teacher_id), academic_year_id=academic_year_id
    )


# ──────────────────────────────────────────────────────────────────────────────
# POST /teachers — create (+ optional linked login, one txn)
# ──────────────────────────────────────────────────────────────────────────────
def create_teacher(
    db: Session, *, actor: User, payload: TeacherCreateRequest
) -> tuple[TeacherDetail, str | None]:
    """POST /teachers (P/S). Returns (detail, temp_password).

    409 duplicate_staff_number; 409 duplicate_email (contact email OR linked-login
    email collides with a live user). `create_login` provisions a linked teacher
    `users` row in the same transaction (D5); its generated temp password is
    echoed once. temp_password is None when no login was provisioned.
    """
    _assert_staff_number_unique(db, payload.staff_number)

    contact_email = payload.email.strip() if payload.email else None

    temp_password: str | None = None
    user_id: uuid.UUID | None = None

    if payload.create_login is not None:
        login_email = payload.create_login.email.strip()
        # A login email must not collide with an existing live user.
        dup = db.scalar(
            select(User.id).where(
                User.email == login_email, User.deleted_at.is_(None)
            )
        )
        if dup is not None:
            raise Conflict(
                "A user with this login email already exists.",
                code="duplicate_email",
            )
        temp_password = generate_temp_password()
        login_user = User(
            email=login_email,
            username=None,
            password_hash=hash_password(temp_password),
            # A teacher profile links only to a teacher login. D43 deliberately did NOT
            # let this create an HOD: promoting someone is the Dean's act, gated by
            # `_PRIVILEGED_ROLES` on the Users screen, and appointing a head of a
            # programme is a third act again (`program_heads`). Creating a lecturer is
            # the Registrar's, and it must not be a way to mint a role that reads a
            # whole programme.
            role=Role.TEACHER,
            full_name=payload.full_name.strip(),
            is_active=True,
            must_change_password=True,
            created_by=actor.id,
        )
        db.add(login_user)
        db.flush()  # assign id for the profile linkage + audit
        user_id = login_user.id
        _audit(
            db,
            actor=actor,
            action="user.create",
            entity_id=user_id,
            summary={"role": Role.TEACHER.value, "via": "teacher.create"},
        )

    teacher = TeacherProfile(
        user_id=user_id,
        staff_number=payload.staff_number.strip(),
        full_name=payload.full_name.strip(),
        email=contact_email,
        phone=payload.phone,
        status=payload.status,
        # D39 — `is_employed` is DERIVED, never taken from the request. It is the
        # client's spelling of the same fact `status` already carries (Meeting #2 item
        # 10, "change IsPresent to IsEmployed"), and two independently-settable copies of
        # one fact is how they come to disagree. `_sync_is_employed` is the only writer.
        subject_specializations=payload.subject_specializations or [],
        created_by=actor.id,
        first_name=_clean(payload.first_name),
        last_name=_clean(payload.last_name),
        ssno=_clean(payload.ssno),
        licensenum=_clean(payload.licensenum),
        hire_date=payload.hire_date,
        end_date=payload.end_date,
        academic_qualification=_clean(payload.academic_qualification),
        designation=_clean(payload.designation),
        address=_clean(payload.address),
        comments=_clean(payload.comments),
        # D40 — the three the create body could not carry until now. `expertise` is
        # stored as plain dicts for the reason `update_teacher` records: the column is
        # JSON, and handing it a Pydantic model serialises through whatever the driver
        # happens to do with an object.
        gender=payload.gender,
        bio=_clean(payload.bio),
        expertise=[
            {"area": row.area.strip(), "level": row.level}
            for row in (payload.expertise or [])
            if row.area.strip()
        ],
    )
    _sync_is_employed(teacher)
    db.add(teacher)
    db.flush()

    _audit(
        db,
        actor=actor,
        action="teacher.create",
        entity_id=teacher.id,
        summary={"staff_number": teacher.staff_number, "linked_login": user_id is not None},
    )
    if temp_password:
        # Do not keep the plaintext around longer than needed.
        echo = temp_password
    else:
        echo = None
    db.commit()
    return _detail(db, teacher), echo


# ──────────────────────────────────────────────────────────────────────────────
# PATCH /teachers/{id} — benign profile edits
# ──────────────────────────────────────────────────────────────────────────────
def update_teacher(
    db: Session, *, actor: User, teacher_id: uuid.UUID, payload: TeacherUpdateRequest
) -> TeacherDetail:
    """PATCH /teachers/{id} (P/S). Benign profile edits only — deactivation and
    role change are separate, more-guarded endpoints. Re-checks staff_number
    uniqueness on change."""
    teacher = _teacher_or_404(db, teacher_id)

    if (
        payload.staff_number is not None
        and payload.staff_number.strip().lower() != teacher.staff_number.lower()
    ):
        _assert_staff_number_unique(db, payload.staff_number, exclude_id=teacher.id)
        teacher.staff_number = payload.staff_number.strip()

    if payload.full_name is not None:
        teacher.full_name = payload.full_name.strip()
    if payload.email is not None:
        teacher.email = payload.email.strip() or None
    if payload.phone is not None:
        teacher.phone = payload.phone
    if payload.subject_specializations is not None:
        teacher.subject_specializations = payload.subject_specializations

    # Extended profile (D39). Absent means "leave alone"; a blank string CLEARS, which is
    # how the dialog erases a designation without a separate delete affordance. The free
    # text fields are stripped so a field holding only spaces stores as NULL rather than
    # rendering as a mysteriously blank-but-present line on the profile card.
    for field in (
        "avatar_url",
        "bio",
        "academic_qualification",
        "designation",
        "address",
        # D39 (Meeting #2 item 10) — the employment record. `is_employed` is absent
        # from `TeacherUpdateRequest` on purpose and so cannot appear here.
        "first_name",
        "last_name",
        "ssno",
        "licensenum",
        "comments",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(teacher, field, value.strip() or None)
    if payload.gender is not None:
        teacher.gender = payload.gender
    # Dates are not strings and have no "blank clears it" spelling, so they follow the
    # plain absent-means-leave-alone rule. Clearing a hire date is not an edit the form
    # offers, and inventing a sentinel for it would be guessing at a workflow.
    if payload.hire_date is not None:
        teacher.hire_date = payload.hire_date
    if payload.end_date is not None:
        teacher.end_date = payload.end_date
    if payload.expertise is not None:
        # Stored as plain dicts: the column is JSON, and a Pydantic model handed to it
        # would serialise through whatever the driver happens to do with an object.
        teacher.expertise = [
            {"area": row.area.strip(), "level": row.level}
            for row in payload.expertise
            if row.area.strip()
        ]

    teacher.updated_by = actor.id
    _audit(db, actor=actor, action="teacher.update", entity_id=teacher.id)
    db.commit()
    return _detail(db, teacher)


# ──────────────────────────────────────────────────────────────────────────────
# POST /teachers/{id}/status — activate/deactivate (Principal-only)
# ──────────────────────────────────────────────────────────────────────────────
def change_teacher_status(
    db: Session, *, actor: User, teacher_id: uuid.UUID, payload: TeacherStatusRequest
) -> TeacherDetail:
    """POST /teachers/{id}/status (Principal). Deactivating a teacher assigned to
    any active class_subject is blocked (FR-TCH-06) → 409
    teacher_has_active_assignments (reassign first)."""
    teacher = _teacher_or_404(db, teacher_id)

    if payload.status == TeacherStatus.INACTIVE and teacher.status != TeacherStatus.INACTIVE:
        refs = _active_assignment_refs(db, teacher.id)
        if refs:
            raise Conflict(
                "This teacher is assigned to active class-subjects; reassign them "
                "before deactivating.",
                code="teacher_has_active_assignments",
                extra={"class_subjects": refs},
            )

    teacher.status = payload.status
    # D39 — `is_employed` mirrors `status`, so it moves with it. This is the ONLY other
    # place status changes, and letting the two drift would leave a deactivated lecturer
    # reading as employed on the client's own reports.
    _sync_is_employed(teacher)
    teacher.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="teacher.status_change",
        entity_id=teacher.id,
        summary={"status": payload.status.value},
    )
    db.commit()
    return _detail(db, teacher)


# ──────────────────────────────────────────────────────────────────────────────
# DELETE /teachers/{id} — soft-delete only if unassigned (Principal-only)
# ──────────────────────────────────────────────────────────────────────────────
def delete_teacher(db: Session, *, actor: User, teacher_id: uuid.UUID) -> None:
    """DELETE /teachers/{id} (Principal). Blocked if assigned to any active
    class_subject (FK RESTRICT, FR-TCH-06) → 409 teacher_has_active_assignments."""
    teacher = _teacher_or_404(db, teacher_id)

    # Any class_teachers row referencing this teacher blocks the delete (the FK is
    # RESTRICT). We surface the active offerings for reassignment guidance.
    assigned = db.scalar(
        select(exists().where(ClassTeacher.teacher_id == teacher.id))
    )
    if assigned:
        raise Conflict(
            "This teacher is assigned to class-subjects; reassign them before "
            "deleting.",
            code="teacher_has_active_assignments",
            extra={"class_subjects": _active_assignment_refs(db, teacher.id)},
        )

    teacher.deleted_at = _now()
    teacher.updated_by = actor.id
    _audit(db, actor=actor, action="teacher.delete", entity_id=teacher.id)
    db.commit()

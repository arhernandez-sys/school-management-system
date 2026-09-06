"""Programme + curriculum service (D30 §D3, §D14).

Owns DB access + transactions; the router is thin.

DEAN-ONLY TO WRITE (§D14, brief §6). Reading is open to every authenticated user:
a programme's code, name and course sequence are the institution's own published
prospectus material, and the student-facing academic-history screens in Phase 4 read
it. The Registrar still schedules offerings and enrols students — what they cannot do
is change what a programme REQUIRES.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.modules.offerings.models import Course
from app.modules.programs.models import Program, ProgramCourse, ProgramHead
from app.modules.programs.schemas import (
    CourseRef,
    ProgramCourseCreateRequest,
    ProgramCourseItem,
    ProgramCourseUpdateRequest,
    ProgramCreateRequest,
    ProgramDetail,
    ProgramHeadItem,
    ProgramHeadsResponse,
    ProgramListItem,
    ProgramUpdateRequest,
    TermBlock,
)
from app.modules.settings.models import AuditLog
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User

_PROGRAM_SORT_FIELDS = {
    "code": Program.code,
    "name": Program.name,
    "award": Program.award,
    "total_credits": Program.total_credits,
    "is_active": Program.is_active,
    "created_at": Program.created_at,
}


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _audit(
    db: Session,
    *,
    actor: User,
    action: str,
    entity_type: str = "program",
    entity_id: uuid.UUID | None = None,
    summary: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + uniqueness
# ──────────────────────────────────────────────────────────────────────────────
def _program_or_404(db: Session, program_id: uuid.UUID) -> Program:
    program = db.scalar(
        select(Program).where(
            Program.id == program_id, Program.deleted_at.is_(None)
        )
    )
    if program is None:
        raise NotFound("Program not found.", code="not_found")
    return program


def _assert_code_unique(
    db: Session, code: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Program.id).where(
        func.lower(Program.code) == code.strip().lower(),
        Program.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Program.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A program with this code already exists.", code="duplicate_program_code"
        )


def _assert_name_unique(
    db: Session, name: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Program.id).where(
        func.lower(Program.name) == name.strip().lower(),
        Program.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Program.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A program with this name already exists.", code="duplicate_program_name"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Read
# ──────────────────────────────────────────────────────────────────────────────
def _curriculum_totals(
    db: Session, program_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """(course_count, summed credits) per programme, in ONE query — no N+1.

    The credit sum joins `courses`, which is only reachable at all because `006` moved
    the catalog there. On `subjects` there was no credits column to add up (plan §B3).
    """
    if not program_ids:
        return {}
    rows = db.execute(
        select(
            ProgramCourse.program_id,
            func.count(ProgramCourse.id),
            func.coalesce(func.sum(Course.credits), 0),
        )
        .join(Course, Course.id == ProgramCourse.course_id)
        .where(ProgramCourse.program_id.in_(program_ids))
        .group_by(ProgramCourse.program_id)
    ).all()
    return {pid: (int(count), int(credits)) for (pid, count, credits) in rows}


def list_programs(
    db: Session,
    *,
    params: PageParams,
    search: str | None,
    is_active: bool | None,
    include_retired: bool = False,
):
    """GET /programs (authenticated). Page[ProgramListItem]; default sort code.

    Defaults to ACTIVE only, like the course catalog: the common caller is a picker,
    and a retired programme in it is a way to enrol a student into a study the college
    no longer runs.

    **`?include_retired=true` is what returns BOTH.** The docstring here used to claim
    `?is_active=false` did, and it never could: that is an equality filter, so it returns
    only the RETIRED ones. The management screen's "Show retired" switch had nothing to
    call — it dropped the parameter, the default put it straight back, and the switch
    moved nothing on screen. `is_active` keeps its exact meaning; the new flag says
    "do not filter on this column at all", which is a different question and now has its
    own parameter to ask it with.

    `include_retired` wins over `is_active` when both arrive: the caller has asked for
    everything, and silently intersecting that with an equality filter would hand back a
    narrower list than either parameter alone describes.
    """
    stmt = select(Program).where(Program.deleted_at.is_(None))

    if not include_retired:
        effective_active = True if is_active is None else is_active
        stmt = stmt.where(Program.is_active.is_(effective_active))

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            Program.name.ilike(like)
            | Program.code.ilike(like)
            | Program.award.ilike(like)
        )

    sort = (params.sort or "code").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _PROGRAM_SORT_FIELDS.get(key)
    if col is None:
        from app.core.errors import ValidationError

        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(col.desc() if desc else col.asc(), Program.id.asc())

    page = paginate(db, stmt, params, serialize=ProgramListItem.model_validate)

    totals = _curriculum_totals(db, [item.id for item in page.items])
    for item in page.items:
        count, credits = totals.get(item.id, (0, 0))
        item.course_count = count
        item.curriculum_credits = credits
    return page


def _curriculum(db: Session, program_id: uuid.UUID) -> list[TermBlock]:
    """The programme's plan, grouped into term blocks and ordered by `term_order`.

    Courses within a block are ordered by code — that is how the source sequences
    print them, and it keeps the block stable as rows are added.
    """
    rows = db.execute(
        select(ProgramCourse, Course)
        .join(Course, Course.id == ProgramCourse.course_id)
        .where(ProgramCourse.program_id == program_id)
        .order_by(ProgramCourse.term_order.asc(), Course.code.asc())
    ).all()

    blocks: list[TermBlock] = []
    by_order: dict[int, TermBlock] = {}
    for pc, course in rows:
        block = by_order.get(pc.term_order)
        if block is None:
            block = TermBlock(
                term_label=pc.term_label,
                term_order=pc.term_order,
                credits=0,
                courses=[],
            )
            by_order[pc.term_order] = block
            blocks.append(block)
        block.courses.append(
            ProgramCourseItem(
                id=pc.id,
                course=CourseRef.model_validate(course),
                is_required=pc.is_required,
            )
        )
        block.credits += course.credits
    return blocks


def _detail(db: Session, program: Program) -> ProgramDetail:
    detail = ProgramDetail.model_validate(program)
    detail.curriculum = _curriculum(db, program.id)
    detail.course_count = sum(len(b.courses) for b in detail.curriculum)
    detail.curriculum_credits = sum(b.credits for b in detail.curriculum)
    return detail


def get_program(db: Session, *, program_id: uuid.UUID) -> ProgramDetail:
    """GET /programs/{id} (authenticated)."""
    return _detail(db, _program_or_404(db, program_id))


# ──────────────────────────────────────────────────────────────────────────────
# Programme writes (Dean only)
# ──────────────────────────────────────────────────────────────────────────────
def create_program(
    db: Session, *, actor: User, payload: ProgramCreateRequest
) -> ProgramDetail:
    """POST /programs (Dean only). 409 duplicate_program_code / _name."""
    code = payload.code.strip()
    name = payload.name.strip()
    _assert_code_unique(db, code)
    _assert_name_unique(db, name)

    program = Program(
        code=code,
        name=name,
        award=payload.award,
        admission_requirements=payload.admission_requirements,
        graduation_requirements=payload.graduation_requirements,
        comments=payload.comments,
        total_credits=payload.total_credits,
        min_passing_grade_point=payload.min_passing_grade_point,
        is_active=True,
        created_by=actor.id,
    )
    db.add(program)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="program.create",
        entity_id=program.id,
        summary={"code": code, "name": name},
    )
    db.commit()
    return _detail(db, program)


def update_program(
    db: Session, *, actor: User, program_id: uuid.UUID, payload: ProgramUpdateRequest
) -> ProgramDetail:
    """PATCH /programs/{id} (Dean only). Omitted field = leave alone."""
    program = _program_or_404(db, program_id)

    if payload.code is not None and payload.code.strip().lower() != program.code.lower():
        _assert_code_unique(db, payload.code, exclude_id=program.id)
        program.code = payload.code.strip()
    if payload.name is not None and payload.name.strip().lower() != program.name.lower():
        _assert_name_unique(db, payload.name, exclude_id=program.id)
        program.name = payload.name.strip()
    if payload.award is not None:
        program.award = payload.award
    # D44 — these three read `exclude_unset`, not `is not None`, because they are the
    # first FREE-TEXT fields on this model and clearing one has to be expressible. The
    # `is not None` idiom above cannot tell "leave it alone" from "empty it"; for `code`
    # and `award` that is harmless, for a notes box it is a field you can fill and never
    # empty again.
    supplied = payload.model_dump(exclude_unset=True)
    for name in ("admission_requirements", "graduation_requirements", "comments"):
        if name in supplied:
            value = supplied[name]
            setattr(program, name, (value or "").strip() or None)
    if payload.total_credits is not None:
        program.total_credits = payload.total_credits
    if payload.min_passing_grade_point is not None:
        program.min_passing_grade_point = payload.min_passing_grade_point
    if payload.is_active is not None:
        program.is_active = payload.is_active

    program.updated_by = actor.id
    _audit(db, actor=actor, action="program.update", entity_id=program.id)
    db.commit()
    return _detail(db, program)


def delete_program(db: Session, *, actor: User, program_id: uuid.UUID) -> None:
    """DELETE /programs/{id} (Dean only). Soft-delete, and ONLY if no student is on it.

    409 `program_in_use` otherwise, steering the Dean to retire it
    (`is_active=false`) instead — which stops new enrolments while leaving every
    existing student's programme, and therefore their academic history, intact. The
    `student_profiles.program_id` FK is `ON DELETE SET NULL`, so a hard delete would
    silently orphan those students rather than fail.

    The curriculum itself is not a blocker: `program_courses` cascades from the
    programme and means nothing without it.
    """
    program = _program_or_404(db, program_id)

    enrolled = db.scalar(
        select(func.count())
        .select_from(StudentProfile)
        .where(
            StudentProfile.program_id == program.id,
            StudentProfile.deleted_at.is_(None),
        )
    )
    if enrolled:
        raise Conflict(
            f"{enrolled} student(s) are on this program — retire it instead.",
            code="program_in_use",
        )

    program.deleted_at = _now()
    program.updated_by = actor.id
    _audit(db, actor=actor, action="program.delete", entity_id=program.id)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# Curriculum writes (Dean only)
# ──────────────────────────────────────────────────────────────────────────────
def _program_course_or_404(
    db: Session, *, program_id: uuid.UUID, program_course_id: uuid.UUID
) -> ProgramCourse:
    """Scoped to the programme in the path.

    Looking it up by id alone would let `/programs/{A}/courses/{row-belonging-to-B}`
    succeed and edit B's curriculum through A's URL.
    """
    row = db.scalar(
        select(ProgramCourse).where(
            ProgramCourse.id == program_course_id,
            ProgramCourse.program_id == program_id,
        )
    )
    if row is None:
        raise NotFound("Curriculum entry not found.", code="not_found")
    return row


def add_program_course(
    db: Session,
    *,
    actor: User,
    program_id: uuid.UUID,
    payload: ProgramCourseCreateRequest,
) -> ProgramDetail:
    """POST /programs/{id}/courses (Dean only). Returns the whole programme.

    Returning the full detail rather than the created row is deliberate: adding a
    course changes the block's credit total and the programme's curriculum total, and
    a curriculum builder that had to re-fetch after every add would flicker.

    409 `course_already_in_program` (the `uq_program_courses` pre-check) /
    `course_retired`.
    """
    program = _program_or_404(db, program_id)

    course = db.scalar(
        select(Course).where(
            Course.id == payload.course_id, Course.deleted_at.is_(None)
        )
    )
    if course is None:
        raise NotFound("Course not found.", code="course_not_found")
    if not course.is_active:
        raise Conflict(
            "That course is retired — reactivate it before adding it to a program.",
            code="course_retired",
        )

    existing = db.scalar(
        select(ProgramCourse.id).where(
            ProgramCourse.program_id == program.id,
            ProgramCourse.course_id == course.id,
        )
    )
    if existing is not None:
        raise Conflict(
            "That course is already in this program.",
            code="course_already_in_program",
        )

    db.add(
        ProgramCourse(
            program_id=program.id,
            course_id=course.id,
            term_label=payload.term_label.strip(),
            term_order=payload.term_order,
            is_required=payload.is_required,
            created_by=actor.id,
        )
    )
    _audit(
        db,
        actor=actor,
        action="program.course_add",
        entity_id=program.id,
        summary={"course_code": course.code, "term_label": payload.term_label},
    )
    db.commit()
    return _detail(db, program)


def update_program_course(
    db: Session,
    *,
    actor: User,
    program_id: uuid.UUID,
    program_course_id: uuid.UUID,
    payload: ProgramCourseUpdateRequest,
) -> ProgramDetail:
    """PATCH /programs/{id}/courses/{pcid} (Dean only). Moves a course between blocks
    or flips whether it is required."""
    program = _program_or_404(db, program_id)
    row = _program_course_or_404(
        db, program_id=program.id, program_course_id=program_course_id
    )

    if payload.term_label is not None:
        row.term_label = payload.term_label.strip()
    if payload.term_order is not None:
        row.term_order = payload.term_order
    if payload.is_required is not None:
        row.is_required = payload.is_required
    row.updated_by = actor.id

    _audit(db, actor=actor, action="program.course_update", entity_id=program.id)
    db.commit()
    return _detail(db, program)


def remove_program_course(
    db: Session,
    *,
    actor: User,
    program_id: uuid.UUID,
    program_course_id: uuid.UUID,
) -> ProgramDetail:
    """DELETE /programs/{id}/courses/{pcid} (Dean only).

    A HARD delete, unlike everything else in this module. A curriculum row carries no
    history of its own — it says "this programme requires this course", and once that
    stops being true there is nothing to preserve. What a student actually took lives
    in `class_enrollments` and `term_grade_snapshots` and is untouched by this.
    """
    program = _program_or_404(db, program_id)
    row = _program_course_or_404(
        db, program_id=program.id, program_course_id=program_course_id
    )
    db.delete(row)
    _audit(db, actor=actor, action="program.course_remove", entity_id=program.id)
    db.commit()
    return _detail(db, program)


# ══════════════════════════════════════════════════════════════════════════════
# Heads of Department (D43)
# ══════════════════════════════════════════════════════════════════════════════
def list_program_heads(db: Session, *, program_id: uuid.UUID) -> ProgramHeadsResponse:
    """GET /programs/{id}/heads — who heads this programme.

    Readable by any authenticated user, like the rest of the programme. Who runs a
    department is not confidential; it is the answer to "who do I ask about this
    course", and hiding it from the people who need it serves nobody.
    """
    _program_or_404(db, program_id)
    rows = db.execute(
        select(ProgramHead, TeacherProfile, User.role)
        .join(TeacherProfile, TeacherProfile.id == ProgramHead.teacher_id)
        .outerjoin(User, User.id == TeacherProfile.user_id)
        .where(
            ProgramHead.program_id == program_id,
            TeacherProfile.deleted_at.is_(None),
        )
        .order_by(TeacherProfile.full_name.asc())
    ).all()
    return ProgramHeadsResponse(
        items=[
            ProgramHeadItem(
                teacher_id=tp.id,
                full_name=tp.full_name,
                staff_number=tp.staff_number,
                role=role.value if role is not None else None,
                appointed_at=ph.appointed_at,
            )
            for (ph, tp, role) in rows
        ]
    )


def set_program_heads(
    db: Session, *, actor: User, program_id: uuid.UUID, teacher_ids: list[uuid.UUID]
) -> ProgramHeadsResponse:
    """PUT /programs/{id}/heads — replace the appointments (Dean only).

    **Appointing a head PROMOTES them; removing one demotes them.** The appointment and
    the access are one action. The earlier two-step version put the Dean in the position
    of having done something that visibly had no effect: they appoint a head, the head
    signs in, and nothing has changed until somebody remembers a second screen.

    Three rules keep that safe, and each is load-bearing:

      1. **Only a `teacher` is promoted.** A Dean, Registrar or Auditor who is also
         appointed keeps the role they have — this endpoint must never be a way to give
         an account MORE reach than an HOD, and silently demoting a Dean to a lecturer
         would be worse still.

      2. **A removed head is demoted only if they head NOTHING ELSE.** Someone running
         two programmes who is taken off one is still a Head of Department, and dropping
         them to `teacher` would revoke their access to the department they still run.
         The check runs AFTER the diff is flushed, against what remains.

      3. **Only an `hod` is demoted, and only back to `teacher`.** Any other role was not
         granted here and is not this endpoint's to take away.

    A lecturer with no linked login is appointed normally and simply has no role to
    change — the appointment is still recorded, which is what lets a profile be prepared
    before the account exists.

    Every role change is written to `audit_log` as `user.role_change`, the same action
    the Settings screen records, so the trail does not depend on which screen did it.

    The appointments themselves are diffed rather than delete-all-then-insert, so
    `appointed_at` survives on a head who was already there — re-saving the multi-select
    with one name added must not reset everyone else's appointment date.
    """
    _program_or_404(db, program_id)

    wanted = set(teacher_ids)
    if wanted:
        found = set(
            db.scalars(
                select(TeacherProfile.id).where(
                    TeacherProfile.id.in_(wanted),
                    TeacherProfile.deleted_at.is_(None),
                )
            ).all()
        )
        missing = wanted - found
        if missing:
            raise ValidationError(
                "One or more lecturers could not be found.",
                code="unknown_teacher",
                fields={"teacher_ids": [str(m) for m in sorted(missing, key=str)]},
            )

    existing = {
        ph.teacher_id: ph
        for ph in db.scalars(
            select(ProgramHead).where(ProgramHead.program_id == program_id)
        ).all()
    }

    added = wanted - existing.keys()
    removed = existing.keys() - wanted

    for teacher_id in added:
        db.add(
            ProgramHead(
                program_id=program_id,
                teacher_id=teacher_id,
                created_by=actor.id,
            )
        )
    for teacher_id in removed:
        db.delete(existing[teacher_id])

    # FLUSH before the role sync. Rule 2 asks "does this person still head anything
    # else?", and that can only be answered against the POST-diff state — reading it
    # before the delete lands would see the row just removed and never demote.
    db.flush()

    _sync_head_roles(db, actor=actor, added=added, removed=removed)

    _audit(
        db,
        actor=actor,
        action="program.heads.set",
        entity_id=program_id,
        summary={"teacher_ids": [str(t) for t in sorted(wanted, key=str)]},
    )
    db.commit()
    return list_program_heads(db, program_id=program_id)


def _sync_head_roles(
    db: Session,
    *,
    actor: User,
    added: set[uuid.UUID],
    removed: set[uuid.UUID],
) -> None:
    """Promote newly-appointed heads to `hod`; demote departing ones back to `teacher`.

    Split out of `set_program_heads` because the three safety rules in that docstring are
    the substance of this operation, and burying them in the diff loop is how one of them
    quietly stops being true.

    Call only AFTER the `program_heads` diff has been flushed — the demotion test reads
    the rows that remain.
    """
    for teacher_id in added:
        user = _login_of(db, teacher_id)
        # Rule 1 — promote a plain lecturer and nobody else. A Dean or Auditor who is
        # also appointed keeps the role they came with.
        if user is not None and user.role == Role.TEACHER:
            _set_role(db, actor=actor, user=user, new_role=Role.HOD, reason="appointed")

    for teacher_id in removed:
        user = _login_of(db, teacher_id)
        # Rule 3 — only an HOD is demoted, and only back to `teacher`.
        if user is None or user.role != Role.HOD:
            continue
        # Rule 2 — still heads something else? Keep the role. This is the check that
        # makes removing a two-programme head from one of them safe.
        still_heads = db.scalar(
            select(ProgramHead.id).where(ProgramHead.teacher_id == teacher_id).limit(1)
        )
        if still_heads is None:
            _set_role(
                db, actor=actor, user=user, new_role=Role.TEACHER, reason="unappointed"
            )


def _login_of(db: Session, teacher_id: uuid.UUID) -> User | None:
    """The login linked to a lecturer profile, or None — a profile may have no account."""
    user_id = db.scalar(
        select(TeacherProfile.user_id).where(TeacherProfile.id == teacher_id)
    )
    return db.get(User, user_id) if user_id is not None else None


def _set_role(
    db: Session, *, actor: User, user: User, new_role: Role, reason: str
) -> None:
    """Change a role and record it under the SAME audit action the Settings screen uses.

    An auditor reading the trail should not have to know which screen a promotion came
    from; `reason` distinguishes it, in the summary rather than in the action name.
    """
    previous = user.role
    user.role = new_role
    user.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="user.role_change",
        entity_id=user.id,
        summary={
            "from": previous.value,
            "to": new_role.value,
            "reason": f"program_head_{reason}",
        },
    )

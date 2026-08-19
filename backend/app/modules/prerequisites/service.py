"""Prerequisite CRUD + the enrolment gate (D30 §D4, brief §17).

DEAN-ONLY TO WRITE (§D14). What a course REQUIRES is academic structure, exactly as
the catalog and the programmes are.

THE GATE, in one paragraph. When a student is enrolled into an offering, every
prerequisite of that offering's course is checked. A requirement is satisfied only by
SUCCESSFUL COMPLETION — a passing term grade (frozen or live) or an approved credit
transfer — judged against the student's PROGRAMME pass mark. Prior enrolment is never
enough, and neither is sitting the prerequisite in the same term as the course it
gates. A blocked enrolment is a 409 that names the missing courses AND the grade
actually earned.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import CreditTransferStatus, PrerequisiteType
from app.core.errors import Conflict, NotFound, ValidationError
from app.modules.admissions.models import CreditTransferRequest
from app.modules.classes.models import Subject
from app.modules.grades import calc
from app.modules.grades import service as grades_service
from app.modules.prerequisites.models import CoursePrerequisite
from app.modules.prerequisites.schemas import (
    EligibilityIssue,
    PrerequisiteCourseRef,
    PrerequisiteCreateRequest,
    PrerequisiteItem,
    PrerequisiteList,
    ProgramRef,
)
from app.modules.programs.models import Program, ProgramCourse
from app.modules.settings.models import AuditLog
from app.modules.students.models import StudentProfile
from app.modules.users.models import User

#: Used when a student is on no programme at all. C+ is the BAJC norm — seven of the
#: eight programmes — so an unassigned student is held to the ordinary standard rather
#: than waved through. Students carry no programme until Phase 4 (§D12), so today this
#: is the value every check actually uses.
_DEFAULT_MIN_GRADE_POINT = "2.50"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _audit(
    db: Session, *, actor: User, action: str, entity_id: uuid.UUID, summary: dict | None = None
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="course_prerequisite",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _course_or_404(db: Session, course_id: uuid.UUID) -> Subject:
    course = db.scalar(
        select(Subject).where(Subject.id == course_id, Subject.deleted_at.is_(None))
    )
    if course is None:
        raise NotFound("Course not found.", code="not_found")
    return course


# ──────────────────────────────────────────────────────────────────────────────
# Read
# ──────────────────────────────────────────────────────────────────────────────
def _item(
    row: CoursePrerequisite,
    course: Subject | None,
    program: Program | None,
) -> PrerequisiteItem:
    return PrerequisiteItem(
        id=row.id,
        requirement_type=row.requirement_type,
        prerequisite_course=(
            PrerequisiteCourseRef.model_validate(course) if course is not None else None
        ),
        program=ProgramRef.model_validate(program) if program is not None else None,
    )


def list_prerequisites(db: Session, *, course_id: uuid.UUID) -> PrerequisiteList:
    """GET /subjects/{id}/prerequisites (authenticated).

    Reading is open: a course's prerequisites are published prospectus material, and
    a student deciding what to take next needs them.
    """
    course = _course_or_404(db, course_id)
    rows = db.scalars(
        select(CoursePrerequisite)
        .where(CoursePrerequisite.course_id == course.id)
        .order_by(CoursePrerequisite.created_at.asc(), CoursePrerequisite.id.asc())
    ).all()

    course_ids = [r.prerequisite_course_id for r in rows if r.prerequisite_course_id]
    program_ids = [r.program_id for r in rows if r.program_id]
    courses = (
        {c.id: c for c in db.scalars(select(Subject).where(Subject.id.in_(course_ids))).all()}
        if course_ids
        else {}
    )
    programs = (
        {p.id: p for p in db.scalars(select(Program).where(Program.id.in_(program_ids))).all()}
        if program_ids
        else {}
    )

    return PrerequisiteList(
        items=[
            _item(
                r,
                courses.get(r.prerequisite_course_id) if r.prerequisite_course_id else None,
                programs.get(r.program_id) if r.program_id else None,
            )
            for r in rows
        ],
        prerequisites_text=course.prerequisites_text,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Write (Dean only)
# ──────────────────────────────────────────────────────────────────────────────
def add_prerequisite(
    db: Session, *, actor: User, course_id: uuid.UUID, payload: PrerequisiteCreateRequest
) -> PrerequisiteList:
    """POST /subjects/{id}/prerequisites (Dean only).

    Returns the whole list, not the created row: the editor is a list, and a single
    row would make it re-fetch to render.
    """
    course = _course_or_404(db, course_id)

    program: Program | None = None
    if payload.program_id is not None:
        program = db.scalar(
            select(Program).where(
                Program.id == payload.program_id, Program.deleted_at.is_(None)
            )
        )
        if program is None:
            raise NotFound("Program not found.", code="program_not_found")

    if payload.requirement_type == PrerequisiteType.ALL_PROGRAM_COURSES:
        # "Every course in the programme" is meaningless without a programme, and
        # naming a course as well would be two different requirements in one row.
        if payload.program_id is None:
            raise ValidationError(
                "An 'all program courses' requirement must name the programme.",
                fields={"program_id": ["Required for all_program_courses."]},
            )
        if payload.prerequisite_course_id is not None:
            raise ValidationError(
                "An 'all program courses' requirement cannot also name a course.",
                fields={"prerequisite_course_id": ["Must be omitted."]},
            )
        prerequisite: Subject | None = None
    else:
        if payload.prerequisite_course_id is None:
            raise ValidationError(
                "A course requirement must name the required course.",
                fields={"prerequisite_course_id": ["Required."]},
            )
        if payload.prerequisite_course_id == course.id:
            raise ValidationError(
                "A course cannot be its own prerequisite.",
                fields={"prerequisite_course_id": ["Cannot be this course."]},
            )
        prerequisite = db.scalar(
            select(Subject).where(
                Subject.id == payload.prerequisite_course_id,
                Subject.deleted_at.is_(None),
            )
        )
        if prerequisite is None:
            raise NotFound("Course not found.", code="course_not_found")
        _assert_no_cycle(db, course_id=course.id, prerequisite_id=prerequisite.id)

    existing = db.scalar(
        select(CoursePrerequisite.id).where(
            CoursePrerequisite.course_id == course.id,
            CoursePrerequisite.prerequisite_course_id == payload.prerequisite_course_id,
            CoursePrerequisite.program_id == payload.program_id,
        )
    )
    if existing is not None:
        raise Conflict(
            "That prerequisite is already recorded for this course.",
            code="duplicate_prerequisite",
        )

    db.add(
        CoursePrerequisite(
            course_id=course.id,
            prerequisite_course_id=payload.prerequisite_course_id,
            program_id=payload.program_id,
            requirement_type=payload.requirement_type,
            created_by=actor.id,
            updated_by=actor.id,
        )
    )
    _audit(
        db,
        actor=actor,
        action="course_prerequisite.add",
        entity_id=course.id,
        summary={
            "requirement_type": payload.requirement_type.value,
            "prerequisite_course_id": str(payload.prerequisite_course_id)
            if payload.prerequisite_course_id
            else None,
        },
    )
    db.commit()
    return list_prerequisites(db, course_id=course.id)


def _assert_no_cycle(
    db: Session, *, course_id: uuid.UUID, prerequisite_id: uuid.UUID
) -> None:
    """Refuse a requirement that would make a course reachable from itself.

    `ck_course_prereq_not_self` catches the one-hop case (A requires A). It cannot
    catch A → B → A, and the consequence of that is not cosmetic: a cycle makes both
    courses permanently un-enrollable, with a 409 that names the other one — an
    unfixable deadlock discovered by a Registrar at registration time, not by the Dean
    who created it.

    Walks the existing graph from `prerequisite_id` looking for `course_id`. The
    catalog is a few hundred rows and prerequisite chains are shallow, so a plain BFS
    is the right amount of machinery.
    """
    seen: set[uuid.UUID] = set()
    frontier = [prerequisite_id]
    while frontier:
        current = frontier.pop()
        if current == course_id:
            raise Conflict(
                "That would create a circular prerequisite — the two courses would "
                "each require the other, and neither could ever be taken.",
                code="circular_prerequisite",
            )
        if current in seen:
            continue
        seen.add(current)
        frontier.extend(
            db.scalars(
                select(CoursePrerequisite.prerequisite_course_id).where(
                    CoursePrerequisite.course_id == current,
                    CoursePrerequisite.prerequisite_course_id.is_not(None),
                )
            ).all()
        )


def remove_prerequisite(
    db: Session, *, actor: User, course_id: uuid.UUID, prerequisite_id: uuid.UUID
) -> PrerequisiteList:
    """DELETE /subjects/{id}/prerequisites/{prerequisite_id} (Dean only).

    Scoped to the course in the path — by id alone, one course's URL could delete
    another's requirement.
    """
    course = _course_or_404(db, course_id)
    row = db.scalar(
        select(CoursePrerequisite).where(
            CoursePrerequisite.id == prerequisite_id,
            CoursePrerequisite.course_id == course.id,
        )
    )
    if row is None:
        raise NotFound("Prerequisite not found.", code="not_found")

    db.delete(row)
    _audit(db, actor=actor, action="course_prerequisite.remove", entity_id=course.id)
    db.commit()
    return list_prerequisites(db, course_id=course.id)


# ──────────────────────────────────────────────────────────────────────────────
# THE GATE
# ──────────────────────────────────────────────────────────────────────────────
def _approved_transfer_course_ids(
    db: Session, *, student_id: uuid.UUID
) -> set[uuid.UUID]:
    """Courses this student was granted by an approved credit transfer (brief §13).

    Reached student → `student_profiles.application_id` → `applications` →
    `credit_transfer_requests`, because a transfer is anchored on the APPLICATION,
    not the student: by policy it can only be requested at admission, when no student
    record exists yet.

    **Was raw SQL until Phase 4.** 2C wrote it against the table directly because
    `credit_transfer_requests` was Phase 4's to own and mapping it early would have fixed
    its shape before the admissions module was designed. Phase 4 has now mapped it, so
    this reads the model — and the status comparison is against the `CreditTransferStatus`
    enum rather than the string `'approved'`, which is what makes a renamed member a
    type error here instead of a query that silently matches nothing.

    Written and tested in 2C while it returned nothing for the whole school. It returns
    real rows from Phase 4 onward, and the test that covered it then covers it now.
    """
    return set(
        db.scalars(
            select(CreditTransferRequest.target_course_id)
            .join(
                StudentProfile,
                StudentProfile.application_id == CreditTransferRequest.application_id,
            )
            .where(
                StudentProfile.id == student_id,
                CreditTransferRequest.status == CreditTransferStatus.APPROVED,
            )
        ).all()
    )


def _min_grade_point(db: Session, student: StudentProfile):  # noqa: ANN201
    """The pass mark this student is judged against — their PROGRAMME's (§D5)."""
    if student.program_id is not None:
        program = db.get(Program, student.program_id)
        if program is not None:
            return program.min_passing_grade_point
    return _DEFAULT_MIN_GRADE_POINT


def check_eligibility(
    db: Session,
    *,
    student: StudentProfile,
    course_id: uuid.UUID,
    semester_id: uuid.UUID | None,
) -> list[EligibilityIssue]:
    """Every prerequisite of `course_id` this student has NOT met. `[]` = eligible.

    Returns rather than raises, so a caller enrolling several students can report all
    of them at once instead of failing on the first.

    `semester_id` is the term being enrolled INTO, and it is excluded from the
    student's results. That is what stops a course from satisfying its own
    prerequisite: sitting MATH1 alongside MATH2 this term is not having completed
    MATH1.

    Requirements scoped to a programme (`program_id` set) apply only to students on
    that programme; global ones apply to everyone.
    """
    rules = db.scalars(
        select(CoursePrerequisite).where(CoursePrerequisite.course_id == course_id)
    ).all()
    if not rules:
        return []  # the overwhelmingly common case — nothing else runs

    applicable = [
        r
        for r in rules
        if r.program_id is None or r.program_id == student.program_id
    ]
    if not applicable:
        return []

    results = grades_service.completed_course_results(
        db, student_id=student.id, exclude_semester_id=semester_id
    )
    transferred = _approved_transfer_course_ids(db, student_id=student.id)
    minimum = _min_grade_point(db, student)

    def satisfied(required_id: uuid.UUID) -> tuple[bool, str | None, float | None]:
        if required_id in transferred:
            return True, None, None
        result = results.get(required_id)
        if result is None:
            return False, None, None
        passed = calc.meets_grade_point(result.letter, result.bands, minimum)
        return (
            passed,
            result.letter,
            float(result.numeric) if result.numeric is not None else None,
        )

    issues: list[EligibilityIssue] = []
    for rule in applicable:
        if rule.requirement_type == PrerequisiteType.ALL_PROGRAM_COURSES:
            required_ids = list(
                db.scalars(
                    select(ProgramCourse.course_id).where(
                        ProgramCourse.program_id == rule.program_id,
                        ProgramCourse.course_id != course_id,
                        ProgramCourse.is_required.is_(True),
                    )
                ).all()
            )
            for required_id in required_ids:
                ok, letter, numeric = satisfied(required_id)
                if ok:
                    continue
                course = db.get(Subject, required_id)
                issues.append(
                    EligibilityIssue(
                        course_code=course.code if course else "?",
                        course_name=course.name if course else "Unknown course",
                        requirement_type=rule.requirement_type,
                        earned_letter=letter,
                        earned_numeric=numeric,
                        reason=(
                            "Not yet taken."
                            if letter is None
                            else f"Taken but not passed (earned {letter})."
                        ),
                    )
                )
            continue

        assert rule.prerequisite_course_id is not None  # ck_course_prereq_shape
        ok, letter, numeric = satisfied(rule.prerequisite_course_id)
        if ok:
            continue
        course = db.get(Subject, rule.prerequisite_course_id)
        issues.append(
            EligibilityIssue(
                course_code=course.code if course else "?",
                course_name=course.name if course else "Unknown course",
                requirement_type=rule.requirement_type,
                earned_letter=letter,
                earned_numeric=numeric,
                reason=(
                    "Not yet taken."
                    if letter is None
                    else f"Taken but not passed (earned {letter})."
                ),
            )
        )
    return issues


def assert_eligible(
    db: Session,
    *,
    student: StudentProfile,
    course_id: uuid.UUID,
    semester_id: uuid.UUID | None,
) -> None:
    """`check_eligibility`, but raising 409 `prerequisite_not_met` (D30 §D4).

    The message names the missing courses and the grade actually earned, because
    "prerequisite not met" alone leaves the Registrar with nothing to act on — they
    cannot tell a student who is one course short from a student who failed it.
    """
    issues = check_eligibility(
        db, student=student, course_id=course_id, semester_id=semester_id
    )
    if not issues:
        return

    detail = "; ".join(
        f"{i.course_code} ({i.reason.rstrip('.')})" for i in issues
    )
    raise Conflict(
        f"{student.full_name} has not met the prerequisites: {detail}.",
        code="prerequisite_not_met",
    )

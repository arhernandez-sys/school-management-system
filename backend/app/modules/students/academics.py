"""Programme registration and derived academic history (D30 §D12, brief §12/§27).

Two concerns, kept out of `students/service.py` because that file is already the
students CRUD surface and these are a different question — the same reason
`numbering.py` sits beside it rather than inside it.

**EVERYTHING HERE EXCEPT THE PROGRAMME ITSELF IS DERIVED** (§D12). Nothing caches what a
student has completed, failed, passed, transferred or still owes: it is computed from
`class_enrollments` + `term_grade_snapshots` + approved `credit_transfer_requests` +
`program_courses` on every read. A stored copy would be a second source of truth that
starts drifting the first time a grade is corrected.

**A programme change never destroys history.** `student_program_history` keeps every
programme the student has read, and the database itself allows only one OPEN row per
student — `open_flag` is generated as `IF(ended_at IS NULL, 1, NULL)` under a unique index
on `(student_id, open_flag)`. So the change closes the old row BEFORE opening the new one;
the reverse order trips the index.

**Changing programme does not assume everything carries over** (§D12). The derivation
re-runs against the NEW programme's curriculum, so a course that was required before and
is not required now simply stops being counted toward the award — and the student's grade
for it is untouched, because what they actually took lives in `class_enrollments` and
`term_grade_snapshots` and this module never writes there.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import CreditTransferStatus
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.timeutil import school_today
from app.modules.admissions.models import CreditTransferRequest
from app.modules.classes.models import ClassEnrollment, ClassSubject, Subject
from app.modules.grades import calc
from app.modules.grades import service as grades_service
from app.modules.programs.models import Program, ProgramCourse
from app.modules.settings.models import AuditLog, Semester
from app.modules.students.models import StudentProfile, StudentProgramHistory
from app.modules.students.schemas import (
    AcademicHistory,
    AcademicHistoryCourse,
    AcademicHistoryCounts,
    ProgramChangeRequest,
    ProgramHistoryEntry,
    ProgramRef,
    StudentProgramRef,
)
from app.modules.users.models import User

#: Used when a student is on no programme at all. Matches
#: `programs.min_passing_grade_point`'s own default and `prerequisites.service`.
_DEFAULT_MIN_GRADE_POINT = Decimal("2.50")

#: One day. Named so the date arithmetic in `set_program` reads as intent rather than as a
#: magic literal: the outgoing programme is closed the day BEFORE the new one opens.
_ONE_DAY = timedelta(days=1)


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
            entity_type="student_profile",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _student_or_404(db: Session, student_id: uuid.UUID) -> StudentProfile:
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None:
        raise NotFound("Student not found.", code="not_found")
    return student


def _program_ref(db: Session, program_id: uuid.UUID | None) -> ProgramRef | None:
    if program_id is None:
        return None
    program = db.get(Program, program_id)
    if program is None:  # pragma: no cover
        return None
    return ProgramRef(id=program.id, code=program.code, name=program.name)


# ──────────────────────────────────────────────────────────────────────────────
# Programme history
# ──────────────────────────────────────────────────────────────────────────────
def program_history(db: Session, *, student_id: uuid.UUID) -> list[ProgramHistoryEntry]:
    """Every programme the student has been registered on, oldest first."""
    rows = db.execute(
        select(StudentProgramHistory, Program)
        .join(Program, Program.id == StudentProgramHistory.program_id)
        .where(StudentProgramHistory.student_id == student_id)
        .order_by(StudentProgramHistory.started_at, StudentProgramHistory.created_at)
    ).all()
    return [
        ProgramHistoryEntry(
            id=row.id,
            program=ProgramRef(id=program.id, code=program.code, name=program.name),
            started_at=row.started_at,
            ended_at=row.ended_at,
            reason=row.reason,
            is_current=row.ended_at is None,
        )
        for row, program in rows
    ]


def set_program(
    db: Session, *, actor: User, student_id: uuid.UUID, payload: ProgramChangeRequest
) -> StudentProgramRef:
    """PUT /students/{id}/program — **DEAN ONLY** (§D12, §D14).

    Assigns a programme, or moves the student to a different one. Both go through here so
    there is exactly one writer of `student_profiles.program_id` outside acceptance, and
    therefore exactly one place that keeps `student_program_history` in step with it.

    **Order is load-bearing**: the open row is closed first, then the new one is opened.
    `uq_student_program_open (student_id, open_flag)` allows only one open row per student,
    so opening before closing would be refused by the database — and the ordering is the
    fix, not a `try` around the constraint.

    A change is recorded with `started_at` = today by default. `effective_from` overrides
    it, because a Dean often records a change days after the student actually moved; the
    old row is closed the day BEFORE, so the two never overlap and never leave a gap.

    Errors: 404 unknown student / programme, 409 `program_unchanged`, 422 on a date that
    would close a row before it started.
    """
    student = _student_or_404(db, student_id)

    program = db.scalar(
        select(Program).where(
            Program.id == payload.program_id, Program.deleted_at.is_(None)
        )
    )
    if program is None:
        raise NotFound("Programme not found.", code="program_not_found")

    if student.program_id == program.id:
        # Not a silent no-op: a Dean who meant to change something wants to know they
        # did not, and writing another history row for the same programme would make the
        # history read as a change that never happened.
        raise Conflict(
            f"This student is already registered on {program.code}.",
            code="program_unchanged",
        )

    effective = payload.effective_from or school_today()
    open_row = db.scalar(
        select(StudentProgramHistory).where(
            StudentProgramHistory.student_id == student.id,
            StudentProgramHistory.ended_at.is_(None),
        )
    )
    if open_row is not None:
        if effective < open_row.started_at:
            raise ValidationError(
                "The change cannot take effect before the current programme started "
                f"({open_row.started_at.isoformat()}).",
                fields={"effective_from": ["Earlier than the current registration."]},
            )
        # Closed the day before the new one opens, so the two are contiguous with no
        # overlap. `ck_student_program_dates` permits ended_at == started_at, which is
        # what a same-day correction produces.
        open_row.ended_at = max(effective - _ONE_DAY, open_row.started_at)
        open_row.reason = open_row.reason or payload.reason
        open_row.updated_by = actor.id
        db.flush()

    db.add(
        StudentProgramHistory(
            student_id=student.id,
            program_id=program.id,
            started_at=effective,
            reason=payload.reason,
            created_by=actor.id,
            updated_by=actor.id,
        )
    )
    previous = student.program_id
    student.program_id = program.id
    if payload.year_of_study is not None:
        student.year_of_study = payload.year_of_study
    if payload.enrollment_load is not None:
        student.enrollment_load = payload.enrollment_load
    student.updated_by = actor.id

    _audit(
        db,
        actor=actor,
        action="student.program_change",
        entity_id=student.id,
        summary={
            "from_program_id": str(previous) if previous else None,
            "to_program_id": str(program.id),
            "effective_from": effective.isoformat(),
            "reason": payload.reason,
        },
    )
    db.commit()
    return StudentProgramRef(
        student_id=student.id,
        program=_program_ref(db, student.program_id),
        year_of_study=student.year_of_study,
        enrollment_load=student.enrollment_load,
        history=program_history(db, student_id=student.id),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Derived academic history (§D12, brief §27)
# ──────────────────────────────────────────────────────────────────────────────
def _transferred_course_ids(db: Session, student: StudentProfile) -> set[uuid.UUID]:
    """Courses granted by an APPROVED credit transfer.

    Reached student → `application_id` → application → transfers, because a transfer is
    anchored on the application by policy: it can only be requested at admission, when no
    student record exists yet (brief §13). A student with no application on file — anyone
    created directly through `POST /students` — simply has none.
    """
    if student.application_id is None:
        return set()
    return set(
        db.scalars(
            select(CreditTransferRequest.target_course_id).where(
                CreditTransferRequest.application_id == student.application_id,
                CreditTransferRequest.status == CreditTransferStatus.APPROVED,
            )
        ).all()
    )


def _enrolled_course_ids(db: Session, student_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    """`{course_id: latest semester_id}` for every course the student has ever sat.

    Keyed on the course rather than the offering: "have you taken Intermediate Algebra?"
    is a question about the course, and the same course may have been sat in two terms.
    """
    rows = db.execute(
        select(ClassSubject.subject_id, ClassEnrollment.semester_id)
        .join(ClassEnrollment, ClassEnrollment.class_id == ClassSubject.class_id)
        .where(
            ClassEnrollment.student_id == student_id,
            ClassSubject.deleted_at.is_(None),
        )
    ).all()
    out: dict[uuid.UUID, uuid.UUID] = {}
    for course_id, semester_id in rows:
        out[course_id] = semester_id
    return out


def academic_history(db: Session, *, student_id: uuid.UUID) -> AcademicHistory:
    """GET /students/{id}/academic-history — everything derived, nothing stored (§D12).

    Every course the student touches is placed in exactly one bucket:

      * **transferred** — an approved credit transfer granted it. Counts toward the award
        and is deliberately EXCLUDED from the GPA: a transfer grants credit, not a grade
        point. Scoring it 0 would punish the student for transferring and scoring it 4.00
        would invent a grade nobody at BAJC awarded.
      * **completed** — a result that clears the student's PROGRAMME pass mark
        (`calc.meets_grade_point`, §D5). Primary Education passes at C, everything else at
        C+, so two students with the same letter get different answers.
      * **failed** — a result that does not clear it. Still counted in the GPA, and still
        leaves the course owing.
      * **in_progress** — enrolled, no result yet.
      * **remaining** — in the programme's curriculum and never taken.

    Credits: **earned** = completed + transferred; **remaining** = required curriculum
    credits not yet earned. The programme's own printed `total_credits` is returned
    alongside, because the two disagreeing is how a data-entry slip in an 87-credit
    sequence gets noticed — the same reasoning as the Phase 2B curriculum builder.

    The GPA is `calc.compute_gpa` over every ENROLLED credit (decision #4), which is the
    one implementation the report card, transcript and dashboard also use. It is a
    cumulative figure here, so it will not always equal the transcript's per-term ones —
    those are per term by construction.

    A student on NO programme still gets a useful answer: their results and GPA are real,
    and the curriculum-derived buckets are simply empty rather than the endpoint failing.
    """
    student = _student_or_404(db, student_id)
    program = db.get(Program, student.program_id) if student.program_id else None
    min_gp = program.min_passing_grade_point if program else _DEFAULT_MIN_GRADE_POINT

    results = grades_service.completed_course_results(db, student_id=student.id)
    transferred = _transferred_course_ids(db, student)
    enrolled = _enrolled_course_ids(db, student.id)

    # The programme's plan: curriculum position + whether the award requires it.
    plan: dict[uuid.UUID, ProgramCourse] = {}
    if program is not None:
        plan = {
            pc.course_id: pc
            for pc in db.scalars(
                select(ProgramCourse).where(ProgramCourse.program_id == program.id)
            ).all()
        }

    # Every course that appears anywhere, loaded in one query rather than per row.
    course_ids = set(plan) | set(results) | set(transferred) | set(enrolled)
    courses = {
        c.id: c
        for c in db.scalars(select(Subject).where(Subject.id.in_(course_ids))).all()
    } if course_ids else {}

    active_semester_id = db.scalar(select(Semester.id).where(Semester.is_active.is_(True)))

    rows: list[AcademicHistoryCourse] = []
    gpa_entries: list[calc.GpaEntry] = []
    counts = {"completed": 0, "failed": 0, "in_progress": 0, "transferred": 0, "remaining": 0}
    credits_earned = 0

    for course_id in course_ids:
        course = courses.get(course_id)
        if course is None:  # pragma: no cover - a hard-deleted course
            continue
        pc = plan.get(course_id)
        result = results.get(course_id)
        credits = course.credits or 0

        grade_point = None
        numeric = None
        letter = None
        is_frozen = False

        if course_id in transferred:
            status = "transferred"
            credits_earned += credits
        elif result is not None:
            numeric = result.numeric
            letter = result.letter
            is_frozen = result.is_frozen
            grade_point = calc.grade_point_for(result.letter, result.bands)
            passed = calc.meets_grade_point(result.letter, result.bands, min_gp)
            status = "completed" if passed else "failed"
            if passed:
                credits_earned += credits
            gpa_entries.append(calc.GpaEntry(credits=credits, grade_point=grade_point))
        elif course_id in enrolled:
            status = "in_progress"
            # Enrolled with nothing marked yet: its credits are in the denominator and it
            # earns no quality points, exactly as the report card treats an ungraded row.
            gpa_entries.append(calc.GpaEntry(credits=credits))
        else:
            status = "remaining"

        counts[status] += 1
        rows.append(
            AcademicHistoryCourse(
                course_id=course.id,
                code=course.code or "",
                name=course.name,
                credits=course.credits,
                term_label=pc.term_label if pc else None,
                term_order=pc.term_order if pc else None,
                #: A course the student took that is NOT in the plan reads as not required
                #: — which is the honest answer, and the one a programme change produces
                #: for work that no longer counts toward the new award.
                is_required=bool(pc.is_required) if pc else False,
                in_curriculum=pc is not None,
                status=status,
                numeric=float(numeric) if numeric is not None else None,
                letter=letter,
                grade_point=float(grade_point) if grade_point is not None else None,
                is_frozen=is_frozen,
                semester_id=enrolled.get(course_id),
            )
        )

    # Plan order where there is one, then code — so the screen reads down the programme
    # sequence and the extras fall to the end rather than interleaving.
    rows.sort(key=lambda r: (r.term_order is None, r.term_order or 0, r.code))

    required_credits = sum(
        (courses[cid].credits or 0)
        for cid, pc in plan.items()
        if pc.is_required and cid in courses
    )
    earned_required = sum(
        r.credits or 0
        for r in rows
        if r.is_required and r.status in ("completed", "transferred")
    )
    gpa = calc.compute_gpa(gpa_entries)

    return AcademicHistory(
        student_id=student.id,
        full_name=student.full_name,
        student_number=student.student_number,
        program=_program_ref(db, student.program_id),
        year_of_study=student.year_of_study,
        enrollment_load=student.enrollment_load,
        program_total_credits=program.total_credits if program else None,
        curriculum_required_credits=required_credits,
        credits_earned=credits_earned,
        #: Against the REQUIRED curriculum, not against everything the student ever sat:
        #: electives they chose not to take are not outstanding requirements. Floored at 0
        #: so over-achieving does not report a negative.
        credits_remaining=max(required_credits - earned_required, 0),
        gpa=float(gpa.gpa) if gpa.gpa is not None else None,
        gpa_total_credits=int(gpa.total_credits),
        counts=AcademicHistoryCounts(**counts),
        courses=rows,
        program_history=program_history(db, student_id=student.id),
        active_semester_id=active_semester_id,
    )

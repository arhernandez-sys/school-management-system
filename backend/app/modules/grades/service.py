"""Grades service (api-spec Module 7, FR-GRD-*, schema §10).

Owns DB access + transactions for the gradebook read + the single grade write; the
router is thin. All arithmetic lives in `calc.py` — this module's job is to load
rows, hand them over as dataclasses, and shape the response.

Scoping: P/S read everything, a teacher reads only offerings they own (denial is a
**404**, not a 403 — api-spec §3.3 no-existence-leak), and a student reads only
their own released results via `/grades/me`.

Three behaviours here deliberately differ from other modules; each is commented at
its site: `class_subjects.is_active` is NOT filtered, the semester is resolved
against the *section's* year, and grading bands come from the section's year rather
than the active one.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import AssessmentStatus, AssessmentType, GradeStatus, Role
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.rbac import (
    _teacher_profile_id,
    assert_teacher_owns_offering,
    hod_offering_ids,
    hod_program_ids,
    teacher_offering_ids,
)
from app.core.timeutil import ensure_aware, utcnow
from app.modules.assessments import release_nudge
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.queries import offerings_in_year, year_id_of_offering, year_of_offering
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.grades import calc, revisions
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.grades.schemas import (
    OfferingOption,
    OfferingOptionsResponse,
    GradesOfferingRef,
    Gradebook,
    GradebookAssessment,
    GradebookCategory,
    GradebookCell,
    GradebookRow,
    GradeCellResult,
    GradeEntryRequest,
    GradeEntryResponse,
    MyGradeAssessment,
    MyGrades,
    MyGradeSubject,
    SemesterRef,
    StudentRef,
    TeacherRef,
    TermGradeItem,
    TermGradeList,
)
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    AuditLog,
    GradingScale,
    GradingScaleBand,
    Semester,
)
from app.modules.students.models import STUDENT_NAME_ORDER, StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User


def _audit(db: Session, *, actor: User, action: str, entity_id=None, summary=None) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="grade",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _dec(value) -> Decimal | None:  # noqa: ANN001
    if value is None:
        return None
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _f(value) -> float | None:  # noqa: ANN001
    """Numeric columns come back as `Decimal`; the wire contract is JSON number."""
    return None if value is None else float(value)


# ──────────────────────────────────────────────────────────────────────────────
# Lookups
# ──────────────────────────────────────────────────────────────────────────────
def _cs_or_404(db: Session, offering_id: uuid.UUID) -> CourseOffering:
    cs = db.scalar(
        select(CourseOffering).where(
            CourseOffering.id == offering_id, CourseOffering.deleted_at.is_(None)
        )
    )
    if cs is None:
        raise NotFound("Gradebook not found.", code="not_found")
    return cs


def _assessment_or_404(db: Session, assessment_id: uuid.UUID) -> Assessment:
    a = db.scalar(
        select(Assessment).where(
            Assessment.id == assessment_id, Assessment.deleted_at.is_(None)
        )
    )
    if a is None:
        raise NotFound("Assessment not found.", code="not_found")
    return a


def _assert_year_writable(db: Session, cs: CourseOffering) -> None:
    section = cs  # D31: the offering IS the section
    if section is not None and section.is_archived:
        raise Conflict("The academic year is archived.", code="year_archived")
    if section is not None:
        year = year_of_offering(db, section)
        if year is not None and year.archived_at is not None:
            raise Conflict("The academic year is archived.", code="year_archived")


# ──────────────────────────────────────────────────────────────────────────────
# D42 §5 — the END-OF-SESSION grade submission deadline is gone.
#
# `_grade_window_closed` and `_assert_grade_window_open` lived here and turned
# `semesters.grade_submission_deadline` into a 409 on the grade write path (D30 §D6).
# The client asked for the deadline to be removed from Academic Structure and for the
# MID-SESSION freeze to be the only thing that stops grade entry, so the enforcement went
# with the field rather than being left behind where nobody could see or clear it — a
# term that already carried a deadline would otherwise have locked its lecturers out
# permanently, with the Dean given no control that could undo it.
#
# The COLUMN is deliberately still there and still writable through the Settings schemas:
# historic terms carry real values, and dropping a column on live `sims` to tidy away a
# field nobody reads is a one-way door. `Gradebook.grade_window_closed` is now hard-wired
# to False and `grade_submission_deadline` to None, so every reader sees an open window.
#
# The mid-session freeze below is untouched — it is the rule that survives.
# ──────────────────────────────────────────────────────────────────────────────


def midterm_freeze_state(
    db: Session, semester_id: uuid.UUID | None
) -> tuple[bool, datetime | None, datetime | None]:
    """`(frozen, start, end)` for a term's MID-TERM grading window (D33, client ask 7).

    **This is the freeze the mid-term window never had.** D32 Phase 1 added
    `midterm_submission_start` / `midterm_submission_end` and used them for one thing only:
    deciding whether a result was part of the mid-term submission, and therefore whether it
    could be *revised* (`revisions.midterm_revision_eligible`). Nothing stopped a mark being
    typed in while the window was running — so the mid-term snapshot the Dean freezes at
    the end of it was assembled from a set that could still move underneath it. The
    client's ask is the missing half: **from the start date to the end date the mid-term is
    frozen and nobody enters a grade.**

    `frozen` is true only strictly inside `[start, end]`. Both bounds are INCLUSIVE, which
    is the reading that leaves no gap: `utcnow() == end` must not be the one instant a mark
    slips through, and `midterm_revision_eligible` uses `utcnow() <= end` for the mirror-image
    reason. After `end` the window is over and entry re-opens — a *new* mark goes in normally
    (which is what makes rules 2 and 3 of the revision gate reachable), while CHANGING one
    that was entered before `start` needs the Dean to approve a revision.

    NULL either side → never frozen — the safe default: an invented window would lock a
    live term. That
    is the state of every semester created before D32, and an invented window would lock a
    live term. `_assert_midterm_window` in `settings/service.py` already refuses to store
    only one of the pair, so a half-configured window cannot reach this function.

    `ensure_aware` is load-bearing: the columns are MariaDB `DATETIME`s and pymysql hands
    them back timezone-NAIVE, so comparing one with `utcnow()` raises `TypeError` — a 500
    on the save path rather than a clean 409.
    """
    if semester_id is None:
        return False, None, None
    row = db.execute(
        select(Semester.midterm_submission_start, Semester.midterm_submission_end).where(
            Semester.id == semester_id
        )
    ).one_or_none()
    if row is None:
        return False, None, None
    start = ensure_aware(row[0])
    end = ensure_aware(row[1])
    if start is None or end is None:
        return False, None, None
    return start <= utcnow() <= end, start, end


def _assert_midterm_not_frozen(db: Session, assessment: Assessment, actor: User) -> None:
    """409 `midterm_frozen` while the term's mid-term grading window is running (D33).

    Enforced in `upsert_grades` because that is the single grade write path (api-spec §7 —
    there is no `POST /grades`), so the freeze, the seeds and any future writer are all
    inside the rule.

    **The Dean is exempt.** The arm is currently unreachable because the route is `require_role(Role.TEACHER)` — and
    it is written for the same reason: the rule belongs with the check, and the Dean's
    sanctioned post-freeze path is approving a revision rather than typing the mark.

    The 409 carries BOTH dates. "Frozen" with no reopen date is unactionable: the Lecturer's
    next question is always whether to wait or to file a revision, and the end date is the
    answer.
    """
    if actor.role == Role.PRINCIPAL:
        return
    frozen, start, end = midterm_freeze_state(db, assessment.semester_id)
    if frozen:
        raise Conflict(
            "The mid-term grading period is in progress, so grades for this term are "
            "frozen. Entry reopens once the period closes.",
            code="midterm_frozen",
            extra={
                "midterm_submission_start": start.isoformat() if start else None,
                "midterm_submission_end": end.isoformat() if end else None,
            },
        )


def _assert_pre_midterm_marks_not_edited(
    db: Session,
    assessment: Assessment,
    actor: User,
    entries,  # noqa: ANN001 - Sequence[GradeEntry]; typed loosely to avoid a cycle
    existing: dict[uuid.UUID, AssessmentGrade],
) -> None:
    """409 `midterm_revision_required` when a CLOSED window's mark is edited directly (D45).

    **The second half of the freeze, which D33 stated but never enforced.** The docstring
    on `midterm_freeze_state` already promised it: *"After `end` the window is over and
    entry re-opens — a new mark goes in normally … while CHANGING one that was entered
    before `start` needs the Dean to approve a revision."* Only the first half existed.
    `_assert_midterm_not_frozen` raises strictly inside `[start, end]`, so the instant the
    window closed a Lecturer got a revision button AND an editable cell — and the editable
    cell won. Reproduced on 2026-09-08: a mid-term mark moved 11.0 -> 19.0 through the
    ordinary save path, with no Dean approval and no revision record.

    **Why that is worse than it looks.** The direct edit sets `graded_at = now`, which is
    exactly what `midterm_revision_eligible` rule 3 reads. So the overwrite ALSO destroys
    the evidence that the mark was ever part of the mid-term submission, and the revision
    button disappears behind it. One action, both the change and the cover-up.

    The conditions mirror `revisions.midterm_revision_eligible` rules 1-3 deliberately —
    the two must partition cleanly, or there is a cell that can be neither edited nor
    revised:

      1. the window exists and has **closed** (inside it, `_assert_midterm_not_frozen`
         already owns the refusal; before it, entry is simply open)
      2. the **assessment** predates `start` - post-window work is graded normally
      3. **this student's grade** predates `start` - a row first filled in after the
         window opened was never part of the mid-term submission

    Rule 4 (`semester.is_active`) is deliberately NOT mirrored. Eligibility uses it to stop
    a *revision* reopening a settled term; here its absence would do the opposite and let a
    closed term be edited freely, which is the one case that matters most.

    **A no-op write is not an edit.** The gradebook saves whole rows, so a Lecturer typing
    into one cell re-sends the forty that did not change. Refusing those would make the
    screen unusable and teach everyone to route real corrections around the rule. Only an
    entry that actually moves `status`, `score` or `makeup_score` is refused.

    **The Dean is exempt**, matching `_assert_midterm_not_frozen`: approving a revision is
    the Dean's sanctioned path, and a Dean who could not also correct a mark directly would
    have no way to act on one.
    """
    if actor.role == Role.PRINCIPAL:
        return
    frozen, start, end = midterm_freeze_state(db, assessment.semester_id)
    if start is None or end is None or frozen or utcnow() <= end:
        return
    if ensure_aware(assessment.created_at) >= start:
        return

    offenders: list[uuid.UUID] = []
    for entry in entries:
        row = existing.get(entry.student_id)
        if row is None:
            continue  # a mark entered for the first time now is post-window work
        entered_at = ensure_aware(row.graded_at) or ensure_aware(row.created_at)
        if entered_at is None or entered_at >= start:
            continue
        score = _dec(entry.score) if entry.status == GradeStatus.GRADED else None
        makeup = _dec(entry.makeup_score) if entry.status == GradeStatus.ABSENT else None
        if (
            row.status == entry.status
            and _dec(row.score) == score
            and _dec(row.makeup_score) == makeup
        ):
            continue  # unchanged - the gradebook re-sending a row it did not touch
        offenders.append(entry.student_id)

    if offenders:
        raise Conflict(
            "This mark was part of the mid-term submission and can no longer be edited "
            "directly. File a Revision of Grades for the Dean to approve.",
            code="midterm_revision_required",
            extra={
                "midterm_submission_start": start.isoformat(),
                "midterm_submission_end": end.isoformat(),
                "student_id": [str(s) for s in offenders],
            },
        )


def _assert_readable(db: Session, actor: User, cs: CourseOffering) -> bool:
    """Authorize a gradebook read. Returns whether the caller may WRITE it.

    A teacher who doesn't own the offering gets 404 from
    `assert_teacher_owns_offering`, matching the discipline used for the
    write path — the mock returns 403 on writes, but a consistent 404 everywhere
    avoids confirming that an offering they can't see exists.
    """
    if actor.role == Role.TEACHER:
        assert_teacher_owns_offering(db, actor, cs.id)
        return True
    if actor.role == Role.HOD:
        # D43 — the head's two-tier answer, and the whole "sees all, edits only their
        # own" rule in four lines. Teaching it wins first: a head who also teaches the
        # course keeps every lecturer right on it. Otherwise, being in a programme they
        # head buys READ and nothing more, so `False` here is what makes the gradebook
        # render without an edit affordance. Anything else is a 404, identical to a
        # gradebook that does not exist.
        # `teacher_offering_ids` rather than `_owned_cs_ids`: it returns [] for a head
        # with no lecturer profile instead of raising, so that case falls through to the
        # programme check and ends in the same honest 404 rather than an early one.
        if cs.id in set(teacher_offering_ids(db, actor)):
            return True
        if cs.id in set(hod_offering_ids(db, hod_program_ids(db, actor))):
            return False
        raise NotFound("Resource not found.")
    return False


def _active_year(db: Session) -> AcademicYear | None:
    from app.common.enums import AcademicYearStatus

    return db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


def _semester_for_section(
    db: Session, section: CourseOffering, semester_id: uuid.UUID | None
) -> Semester | None:
    """Resolve which term's gradebook to show: the explicit param, else THE OFFERING'S OWN.

    **D31 turned this from a resolution into a lookup.** It used to reason from the
    offering's academic YEAR — take that year's active semester, else its `sequence=1`
    term — because `classes` carried `academic_year_id` and no semester, so the term
    genuinely had to be guessed. `course_offerings.semester_id` makes that guess both
    unnecessary and WRONG: an offering belongs to exactly one term, and asking the year
    which term to show can name a different one.

    That is not hypothetical. It is how the D31 demo seed's Semester-2 offerings rendered
    an EMPTY gradebook: `BIOL1102-01` in Semester 2 of 2025-2026 resolved to that year's
    active term (Semester 1), and then `_assessments_for` filtered
    `Assessment.semester_id == Semester 1` — so the offering's own 2 assessments and its
    23-student roster both matched nothing, with no error anywhere. The old docstring
    worried about exactly this shape one level up (an archived year being handed the
    current year's active term) and mitigated it with a year check; reading the term off
    the offering makes it impossible instead of mitigated.

    The explicit param is still honoured, so the wire contract is unchanged — but a caller
    passing a semester the offering does not run in is asking a contradictory question and
    still gets an empty gradebook. Rejecting that outright would be a contract change.
    """
    if semester_id is not None:
        return db.get(Semester, semester_id)
    return db.get(Semester, section.semester_id)


def _bands_for_section(db: Session, section: CourseOffering) -> tuple[list[calc.BandInput], Decimal | None]:
    """Grading bands + pass mark for the SECTION's academic year.

    Not the active year's: an archived year keeps the scale that was in force then
    (schema §10.4), so a historical gradebook must not be relettered by a later
    scale edit. Falls back to the active year's scale when a year has none (a
    test-created year, typically).
    """
    scale = db.scalar(
        select(GradingScale).where(GradingScale.academic_year_id == year_id_of_offering(db, section))
    )
    if scale is None:
        active = _active_year(db)
        if active is not None:
            scale = db.scalar(
                select(GradingScale).where(GradingScale.academic_year_id == active.id)
            )
    if scale is None:
        return [], None

    rows = db.scalars(
        select(GradingScaleBand).where(GradingScaleBand.grading_scale_id == scale.id)
    ).all()
    bands = [
        calc.BandInput(
            letter=b.letter,
            min_score=_dec(b.min_score),
            is_passing=b.is_passing,
            # D30 §D5 — NULL on every seeded scale until Phase 3 fills it in.
            # `calc.meets_grade_point` handles the absence; see its docstring.
            grade_point=_dec(b.grade_point),
        )
        for b in rows
    ]
    return bands, _dec(scale.pass_mark)


def _school_policy(db: Session) -> AssessmentPolicy | None:
    return db.scalar(select(AssessmentPolicy).where(AssessmentPolicy.id == 1))


# ──────────────────────────────────────────────────────────────────────────────
# Refs
# ──────────────────────────────────────────────────────────────────────────────
def _teacher_rows(db: Session, cs_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[tuple]]:
    """Batch-load (teacher, is_lead) per class_subject — avoids an N+1 in the picker."""
    if not cs_ids:
        return {}
    rows = db.execute(
        select(ClassTeacher.offering_id, TeacherProfile, ClassTeacher.is_lead)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.offering_id.in_(cs_ids))
    ).all()
    out: dict[uuid.UUID, list[tuple]] = defaultdict(list)
    for cs_id, teacher, is_lead in rows:
        out[cs_id].append((teacher, is_lead))
    # Lead first, then by name — the frontend shows `teachers[0]` as the owner.
    for items in out.values():
        items.sort(key=lambda t: (not t[1], t[0].full_name))
    return out


def _offering_ref(
    offering: CourseOffering,
    course: Course,
    teachers: list[tuple],
) -> GradesOfferingRef:
    """D31: one row, not two. This took `cs` AND `section` because a gradebook lived at
    the intersection of a homeroom and a subject; an offering IS the gradebook."""
    lead = next((t for t, is_lead in teachers if is_lead), None)
    return GradesOfferingRef(
        offering=offering_ref(offering, course),
        teachers=[TeacherRef(id=t.id, full_name=t.full_name) for t, _ in teachers],
        lead_teacher_id=lead.id if lead is not None else None,
    )


def _owned_cs_ids(db: Session, actor: User) -> list[uuid.UUID]:
    teacher_id = _teacher_profile_id(db, actor)
    return list(
        db.scalars(
            select(ClassTeacher.offering_id).where(ClassTeacher.teacher_id == teacher_id)
        ).all()
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /grades/class-subjects
# ──────────────────────────────────────────────────────────────────────────────
def list_offering_options(
    db: Session, *, actor: User, academic_year_id: uuid.UUID | None
) -> OfferingOptionsResponse:
    """The gradebook picker. Teacher → owned offerings; P/S → every offering."""
    year_id = academic_year_id
    if year_id is None:
        active = _active_year(db)
        year_id = active.id if active is not None else None

    stmt = (
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        # NOTE: `is_archived` is deliberately NOT filtered here. Offerings of a past
        # year are archived, and the year switcher must still list them.
        .where(CourseOffering.deleted_at.is_(None))
        .order_by(*OFFERING_ORDER)
    )
    if year_id is not None:
        stmt = stmt.where(offerings_in_year(year_id))

    is_teacher = actor.role == Role.TEACHER
    #: Offerings this caller may EDIT, when that differs per row. `None` means the
    #: answer is the same for every row and comes from the role alone — which was the
    #: only case before D43 introduced a caller who sees more than they can edit.
    editable_ids: set[uuid.UUID] | None = None

    if is_teacher:
        owned = _owned_cs_ids(db, actor)
        if not owned:
            return OfferingOptionsResponse(items=[])
        stmt = stmt.where(CourseOffering.id.in_(owned))
    elif actor.role == Role.HOD:
        # D43 — the head's picker lists their own offerings AND every offering in the
        # programme(s) they head, but only the first set comes back editable. The union
        # matters: a head may teach a shared course outside their own programme, and
        # scoping to the programme alone would hide their own gradebook from them.
        owned_ids = set(teacher_offering_ids(db, actor))
        visible = owned_ids | set(hod_offering_ids(db, hod_program_ids(db, actor)))
        if not visible:
            return OfferingOptionsResponse(items=[])
        stmt = stmt.where(CourseOffering.id.in_(visible))
        editable_ids = owned_ids

    rows = db.execute(stmt).all()
    cs_ids = [cs.id for cs, _ in rows]
    teachers_by_cs = _teacher_rows(db, cs_ids)

    counts: dict[uuid.UUID, int] = {}
    if cs_ids:
        for cs_id, total in db.execute(
            select(Assessment.offering_id, func.count())
            .where(
                Assessment.offering_id.in_(cs_ids),
                Assessment.deleted_at.is_(None),
            )
            .group_by(Assessment.offering_id)
        ).all():
            counts[cs_id] = total

    items = [
        OfferingOption(
            **_offering_ref(cs, subject, teachers_by_cs.get(cs.id, [])).model_dump(),
            assessment_count=counts.get(cs.id, 0),
            can_edit=is_teacher if editable_ids is None else cs.id in editable_ids,
        )
        for cs, subject in rows
    ]

    return OfferingOptionsResponse(items=items)


# ──────────────────────────────────────────────────────────────────────────────
# Shared grade-loading used by the gradebook, /grades/me and /grades/term
# ──────────────────────────────────────────────────────────────────────────────
def _resolved_categories(
    db: Session,
    cs_id: uuid.UUID,
    year: AcademicYear | None,
    school: AssessmentPolicy | None,
) -> tuple[list[AssessmentCategory], list[calc.CategoryInput], int]:
    """Categories plus their drop-lowest counts resolved down the §10.2a chain.

    Returns `(rows, calc inputs, uncategorized_drop_lowest)`. There is no
    offering level in the chain — schema §10.2a defines it as
    assessment → category → year → school, and no screen sets an offering override.
    """
    rows = list(
        db.scalars(
            select(AssessmentCategory).where(AssessmentCategory.offering_id == cs_id)
        ).all()
    )

    def resolve(*levels) -> int:  # noqa: ANN002
        for level in levels:
            if level is not None:
                return max(0, int(level))
        return 0

    year_drop = year.drop_lowest_count if year is not None else None
    school_drop = school.drop_lowest_count if school is not None else None

    inputs = [
        calc.CategoryInput(
            id=c.id,
            weight=_dec(c.weight) or Decimal(0),
            drop_lowest_count=resolve(c.drop_lowest_count, year_drop, school_drop),
        )
        for c in rows
    ]
    return rows, inputs, resolve(year_drop, school_drop)


def _grade_inputs(
    assessments: list[Assessment],
    grades_by_assessment: dict[uuid.UUID, AssessmentGrade],
    categories_by_id: dict[uuid.UUID, AssessmentCategory],
    year: AcademicYear | None,
    school: AssessmentPolicy | None,
) -> list[calc.GradeInput]:
    """Build one `GradeInput` per assessment for a single student."""
    out: list[calc.GradeInput] = []
    for a in assessments:
        grade = grades_by_assessment.get(a.id)
        policy = calc.resolve_policy(
            a,
            categories_by_id.get(a.category_id) if a.category_id else None,
            year,
            school,
        )
        effective_release = (
            a.is_released if grade is None or grade.is_released is None else grade.is_released
        )
        out.append(
            calc.GradeInput(
                assessment_id=a.id,
                max_score=_dec(a.max_score) or Decimal(0),
                weight=_dec(a.weight) or Decimal(0),
                assessment_status=a.status,
                policy=policy,
                category_id=a.category_id,
                grade_status=grade.status if grade is not None else None,
                score=_dec(grade.score) if grade is not None else None,
                makeup_score=_dec(grade.makeup_score) if grade is not None else None,
                is_released=bool(effective_release),
            )
        )
    return out


def _assessments_for_many(
    db: Session,
    cs_ids: list[uuid.UUID],
    semester_id: uuid.UUID | None,
    *,
    exclude_draft: bool = False,
) -> dict[uuid.UUID, list[Assessment]]:
    """Batch variant of `_assessments_for` — ONE query across many offerings.

    Exists so a per-student, per-section read (which spans every offering of the
    section) doesn't fan out into one query per subject. The ordering lives here
    only, so the single- and multi-offering paths can never diverge.
    """
    if not cs_ids:
        return {}
    stmt = select(Assessment).where(
        Assessment.offering_id.in_(cs_ids), Assessment.deleted_at.is_(None)
    )
    if semester_id is not None:
        stmt = stmt.where(Assessment.semester_id == semester_id)
    if exclude_draft:
        stmt = stmt.where(Assessment.status != AssessmentStatus.DRAFT)

    out: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in db.scalars(stmt).all():
        out[a.offering_id].append(a)
    # Portable "NULLs last" ordering — this codebase avoids dialect-specific
    # NULLS LAST (it broke on the Postgres→MariaDB move).
    for rows in out.values():
        rows.sort(key=lambda a: (a.assessment_date is None, a.assessment_date, a.title, str(a.id)))
    return dict(out)


def _assessments_for(db: Session, cs_id: uuid.UUID, semester_id: uuid.UUID | None) -> list[Assessment]:
    return _assessments_for_many(db, [cs_id], semester_id).get(cs_id, [])


# ──────────────────────────────────────────────────────────────────────────────
# GET /grades/class-subject/{id}
# ──────────────────────────────────────────────────────────────────────────────
def get_gradebook(
    db: Session,
    *,
    actor: User,
    offering_id: uuid.UUID,
    semester_id: uuid.UUID | None,
) -> Gradebook:
    cs = _cs_or_404(db, offering_id)
    can_edit = _assert_readable(db, actor, cs)

    section = cs  # D31: the offering IS the section
    subject = db.get(Course, cs.course_id)
    if subject is None:  # pragma: no cover - the FK guarantees this
        raise NotFound("Gradebook not found.", code="not_found")

    semester = _semester_for_section(db, section, semester_id)
    year = year_of_offering(db, section)
    school = _school_policy(db)
    bands, _pass_mark = _bands_for_section(db, section)

    assessments = _assessments_for(db, cs.id, semester.id if semester else None)
    assessment_ids = [a.id for a in assessments]
    category_rows, category_inputs, uncategorized_drop = _resolved_categories(
        db, cs.id, year, school
    )
    categories_by_id = {c.id: c for c in category_rows}

    # One query for every grade in the gradebook, then grouped in memory.
    grades: list[AssessmentGrade] = []
    if assessment_ids:
        grades = list(
            db.scalars(
                select(AssessmentGrade).where(
                    AssessmentGrade.assessment_id.in_(assessment_ids)
                )
            ).all()
        )
    by_student: dict[uuid.UUID, dict[uuid.UUID, AssessmentGrade]] = defaultdict(dict)
    for g in grades:
        by_student[g.student_id][g.assessment_id] = g

    # Roster = active enrollments for (section, resolved semester).
    enrollment_rows = []
    if semester is not None:
        enrollment_rows = db.execute(
            select(ClassEnrollment, StudentProfile)
            .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
            .where(
                ClassEnrollment.offering_id == section.id,
                ClassEnrollment.semester_id == semester.id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        ).all()
    active_students = {student.id: (enr, student) for enr, student in enrollment_rows}

    # A student who holds a grade but is no longer on the roster still gets a row —
    # otherwise their marks would silently vanish from the teacher's view.
    extra_ids = [sid for sid in by_student if sid not in active_students]
    extras = (
        list(db.scalars(select(StudentProfile).where(StudentProfile.id.in_(extra_ids))).all())
        if extra_ids
        else []
    )

    ordered: list[tuple[StudentProfile, uuid.UUID | None, bool]] = [
        *sorted(
            ((student, enr.id, True) for enr, student in enrollment_rows),
            key=lambda t: t[0].full_name,
        ),
        *sorted(((student, None, False) for student in extras), key=lambda t: t[0].full_name),
    ]

    stats: dict[uuid.UUID, dict[str, int]] = {
        a.id: {"graded": 0, "entered": 0} for a in assessments
    }
    for g in grades:
        bucket = stats.get(g.assessment_id)
        if bucket is None:
            continue
        if g.status != GradeStatus.PENDING:
            bucket["entered"] += 1
        if g.status == GradeStatus.GRADED and g.score is not None:
            bucket["graded"] += 1

    # D32 (brief §1) — only a Lecturer can FILE a revision, so nobody else is told whether
    # a cell qualifies. Resolved once here rather than inside the loop: the answer does not
    # vary by cell, and asking per cell would put a role comparison in an N×M inner loop.
    #
    # `midterm_revision_eligible` calls `db.get(Semester, ...)` per cell, which costs one
    # query for the whole gradebook: every assessment here belongs to the same term, and
    # `Session.get` serves repeats from the identity map without touching the database.
    viewer_is_lecturer = actor.role == Role.TEACHER

    rows: list[GradebookRow] = []
    for student, enrollment_id, is_member in ordered:
        student_grades = by_student.get(student.id, {})
        cells: list[GradebookCell] = []
        for a in assessments:
            g = student_grades.get(a.id)
            status = g.status if g is not None else GradeStatus.PENDING
            score = _dec(g.score) if g is not None else None
            released = (
                a.is_released if g is None or g.is_released is None else g.is_released
            )
            letter = None
            if status == GradeStatus.GRADED and score is not None:
                letter = calc.letter_for(calc.percentage_for(score, a.max_score), bands)

            can_revise = False
            blocked_reason: str | None = None
            if viewer_is_lecturer:
                if g is None:
                    # No row at all: there is nothing to revise, and the Lecturer should
                    # enter the grade rather than appeal a mark that was never given.
                    blocked_reason = "not_graded"
                else:
                    can_revise, blocked_reason = revisions.midterm_revision_eligible(
                        db, grade=g, assessment=a
                    )

            cells.append(
                GradebookCell(
                    assessment_id=a.id,
                    status=status,
                    score=_f(score),
                    makeup_score=_f(g.makeup_score) if g is not None else None,
                    is_released=bool(released),
                    letter=letter,
                    can_request_revision=can_revise,
                    revision_blocked_reason=blocked_reason,
                )
            )

        term = calc.compute_term_grade(
            _grade_inputs(assessments, student_grades, categories_by_id, year, school),
            categories=category_inputs,
            uncategorized_drop_lowest=uncategorized_drop,
            bands=bands,
            released_only=False,
        )
        rows.append(
            GradebookRow(
                student=StudentRef(
                    id=student.id,
                    full_name=student.full_name,
                    student_number=student.student_number,
                ),
                enrollment_id=enrollment_id,
                is_active_member=is_member,
                cells=cells,
                term_numeric=_f(term.numeric),
                term_letter=term.letter,
            )
        )

    # D33 ask 7 — the mid-term freeze, reported the same way and for the same reason.
    midterm_frozen, midterm_start, midterm_end = midterm_freeze_state(
        db, semester.id if semester is not None else None
    )

    return Gradebook(
        offering=_offering_ref(cs, subject, _teacher_rows(db, [cs.id]).get(cs.id, [])),
        semester=(
            SemesterRef(id=semester.id, name=semester.name, sequence=semester.sequence)
            if semester is not None
            else None
        ),
        assessments=[
            GradebookAssessment(
                id=a.id,
                title=a.title,
                type=a.type,
                category_id=a.category_id,
                max_score=_f(a.max_score),
                weight=_f(a.weight),
                assessment_date=a.assessment_date,
                status=a.status,
                is_released=a.is_released,
                # Drafts render as columns but reject entry.
                is_editable=a.status != AssessmentStatus.DRAFT,
                graded_count=stats[a.id]["graded"],
                entered_count=stats[a.id]["entered"],
            )
            for a in assessments
        ],
        categories=[
            GradebookCategory(
                id=c.id,
                name=c.name,
                weight=_f(c.weight),
                drop_lowest_count=next(
                    (ci.drop_lowest_count for ci in category_inputs if ci.id == c.id), 0
                ),
            )
            for c in category_rows
        ],
        rows=rows,
        drop_lowest_applied=(
            any(ci.drop_lowest_count > 0 for ci in category_inputs) or uncategorized_drop > 0
        ),
        can_edit=can_edit,
        # Reported for EVERY viewer, not just the one who can write: a Registrar asked
        # "why can't the lecturer enter these?" needs to see the same closed window.
        # D42 §5 — constants now. The end-of-session deadline is no longer enforced or
        # configurable; the fields stay on the wire so an older client still parses the
        # response, and they always report an OPEN window.
        grade_window_closed=False,
        grade_submission_deadline=None,
        midterm_frozen=midterm_frozen,
        midterm_submission_start=midterm_start,
        midterm_submission_end=midterm_end,
        viewer_role=actor.role.value,
    )


# ──────────────────────────────────────────────────────────────────────────────
# PUT /assessments/{id}/grades
# ──────────────────────────────────────────────────────────────────────────────
def upsert_grades(
    db: Session, *, actor: User, assessment_id: uuid.UUID, payload: GradeEntryRequest
) -> GradeEntryResponse:
    """Bulk grade entry — the only write path for grades (api-spec §7).

    **All-or-nothing.** Every entry is validated and every offender collected
    before anything is mutated, so a bad row in a batch of forty leaves the
    gradebook exactly as it was rather than half-saved.
    """
    assessment = _assessment_or_404(db, assessment_id)
    assert_teacher_owns_offering(db, actor, assessment.offering_id)
    cs = db.get(CourseOffering, assessment.offering_id)
    _assert_year_writable(db, cs)
    # D42 §5 — the end-of-session deadline check that used to sit here is gone. The
    # mid-session freeze is the only window that stops grade entry now.
    _assert_midterm_not_frozen(db, assessment, actor)

    entries = payload.entries
    max_score = _dec(assessment.max_score) or Decimal(0)

    seen: set[uuid.UUID] = set()
    duplicates: list[uuid.UUID] = []
    for entry in entries:
        if entry.student_id in seen:
            duplicates.append(entry.student_id)
        seen.add(entry.student_id)
    if duplicates:
        raise ValidationError(
            "Each student may appear only once.",
            code="duplicate_entry",
            fields={"student_id": [str(s) for s in dict.fromkeys(duplicates)]},
        )

    # Provenance: a grade must hang off a real active enrollment for this term.
    enrollments: dict[uuid.UUID, ClassEnrollment] = {}
    if seen:
        enrollments = {
            e.student_id: e
            for e in db.scalars(
                select(ClassEnrollment).where(
                    ClassEnrollment.offering_id == cs.id,
                    ClassEnrollment.semester_id == assessment.semester_id,
                    ClassEnrollment.unenrolled_at.is_(None),
                    ClassEnrollment.student_id.in_(list(seen)),
                )
            ).all()
        }

    not_enrolled = [e.student_id for e in entries if e.student_id not in enrollments]
    if not_enrolled:
        raise ValidationError(
            "Some students are not enrolled in this section.",
            code="student_not_enrolled",
            fields={"student_id": [str(s) for s in not_enrolled]},
        )

    score_offenders: list[uuid.UUID] = []
    status_conflicts: list[uuid.UUID] = []
    makeup_wrong_status: list[uuid.UUID] = []
    makeup_disabled: list[uuid.UUID] = []
    makeup_out_of_range: list[uuid.UUID] = []

    category = (
        db.get(AssessmentCategory, assessment.category_id)
        if assessment.category_id
        else None
    )
    section = cs  # D31: the offering IS the section
    year = year_of_offering(db, section) if section else None
    policy = calc.resolve_policy(assessment, category, year, _school_policy(db))

    for entry in entries:
        score = _dec(entry.score)
        makeup = _dec(entry.makeup_score)

        if entry.status == GradeStatus.GRADED:
            # A graded row with no score lands here too — the mock lumps it in with
            # out-of-range scores and so do we.
            if score is None or score < 0 or score > max_score:
                score_offenders.append(entry.student_id)
        elif score is not None:
            status_conflicts.append(entry.student_id)

        if makeup is not None:
            if entry.status != GradeStatus.ABSENT:
                makeup_wrong_status.append(entry.student_id)
            elif not policy.allow_makeup:
                makeup_disabled.append(entry.student_id)
            elif makeup < 0 or makeup > max_score:
                makeup_out_of_range.append(entry.student_id)

    if score_offenders or makeup_out_of_range:
        raise ValidationError(
            f"Score must be between 0 and {max_score}.",
            code="score_exceeds_max",
            fields={"student_id": [str(s) for s in score_offenders + makeup_out_of_range]},
        )
    if status_conflicts:
        raise ValidationError(
            "A score can only be recorded for a graded result.",
            code="score_status_conflict",
            fields={"student_id": [str(s) for s in status_conflicts]},
        )
    if makeup_wrong_status:
        raise ValidationError(
            "Makeup score applies only to an absent result.",
            code="makeup_not_allowed",
            fields={"student_id": [str(s) for s in makeup_wrong_status]},
        )
    if makeup_disabled:
        raise ValidationError(
            "Makeups are disabled by the grading policy.",
            code="makeup_not_allowed",
            fields={"student_id": [str(s) for s in makeup_disabled]},
        )

    # ── Validation passed; mutate ────────────────────────────────────────────
    existing: dict[uuid.UUID, AssessmentGrade] = {}
    if seen:
        existing = {
            g.student_id: g
            for g in db.scalars(
                select(AssessmentGrade).where(
                    AssessmentGrade.assessment_id == assessment.id,
                    AssessmentGrade.student_id.in_(list(seen)),
                )
            ).all()
        }

    # D45 — the closed-window lock. Placed HERE, after `existing` is loaded and before any
    # mutation, because it is the only point where both halves of rule 3 are known: which
    # rows already exist, and whether the incoming entry actually changes one. Still inside
    # the all-or-nothing discipline — it collects every offender and raises once.
    _assert_pre_midterm_marks_not_edited(db, assessment, actor, entries, existing)

    bands, _pass_mark = _bands_for_section(db, section) if section else ([], None)

    # D45 §46 (Phase 7) — the BEFORE picture, captured before anything is mutated.
    #
    # §46's worked example is "a final grade going C+ -> B, citing a change request",
    # and it was not reproducible from this log: `grade.update` recorded
    # `{"entries": 3}` — the COUNT of cells touched. No student, no mark, no previous
    # value. An auditor asking "who changed this student's grade, from what, to what,
    # and why" could not be answered from the audit trail at all, only inferred from
    # `updated_by` on the row itself, which holds the LAST writer and overwrites the
    # one before.
    #
    # Letters as well as scores: the auditor's question is asked in letters, and a
    # band edit means today's letter for an old score is not the letter that was
    # awarded. Storing it settles what the mark actually WAS at the time.
    def _letter_of(status, score):  # noqa: ANN001, ANN202
        if status != GradeStatus.GRADED or score is None:
            return None
        return calc.letter_for(calc.percentage_for(score, assessment.max_score), bands)

    def _status_value(status):  # noqa: ANN001, ANN202
        """`status` comes back as a `GradeStatus` on a freshly written row and as a plain
        `str` on one loaded from the database, depending on how the row entered the
        identity map. `.value` on the second is an AttributeError, and it took three
        existing freeze tests to surface it — the happy path never hits the str form.

        `GradeStatus` is a `str` enum, so every COMPARISON in this function is safe either
        way; only the attribute access was not."""
        if status is None:
            return None
        return getattr(status, "value", status)

    before_state: dict[uuid.UUID, dict] = {}
    for sid, row in existing.items():
        before_state[sid] = {
            "score": _f(row.score),
            "makeup_score": _f(row.makeup_score),
            "status": _status_value(row.status),
            "letter": _letter_of(row.status, row.score),
        }

    results: list[GradeCellResult] = []
    changed: list[tuple[uuid.UUID, dict | None, dict]] = []
    now = utcnow()

    for entry in entries:
        score = _dec(entry.score) if entry.status == GradeStatus.GRADED else None
        makeup = _dec(entry.makeup_score) if entry.status == GradeStatus.ABSENT else None

        row = existing.get(entry.student_id)
        if row is None:
            row = AssessmentGrade(
                assessment_id=assessment.id,
                student_id=entry.student_id,
                enrollment_id=enrollments[entry.student_id].id,
                status=entry.status,
                # Only settable HERE. The tail below sets `updated_by` on insert and
                # update alike, so without this the row would record who last touched
                # a mark but never who first entered it — the provenance a grade
                # dispute actually asks for, and unrecoverable once the row exists.
                created_by=actor.id,
            )
            db.add(row)
        row.status = entry.status
        row.score = score
        row.makeup_score = makeup
        row.enrollment_id = enrollments[entry.student_id].id
        row.updated_by = actor.id
        if entry.status == GradeStatus.GRADED and score is not None:
            row.graded_at = now
        # `is_released` is deliberately untouched — releasing is its own endpoint.

        letter = (
            calc.letter_for(calc.percentage_for(score, assessment.max_score), bands)
            if entry.status == GradeStatus.GRADED and score is not None
            else None
        )
        results.append(
            GradeCellResult(
                student_id=entry.student_id,
                status=entry.status,
                score=_f(score),
                makeup_score=_f(makeup),
                letter=letter,
            )
        )

        # Only what actually MOVED. Re-saving a gradebook without touching a mark is
        # the commonest action in the system, and logging a "change" for every
        # unchanged cell would bury the real edits — the ones an auditor is looking
        # for — under thousands of rows that say nothing happened.
        after = {
            "score": _f(score),
            "makeup_score": _f(makeup),
            # Same accessor as the BEFORE side on purpose: if the two ever rendered the
            # status differently, every save would report a phantom status change.
            "status": _status_value(entry.status),
            "letter": letter,
        }
        before = before_state.get(entry.student_id)
        if before != after:
            changed.append((entry.student_id, before, after))

    # One audit row PER STUDENT whose mark moved. §46 asks for the previous and new
    # value of a grade; a single row for a whole gradebook cannot carry them, and
    # "this student's grade went from X to Y" is the unit an auditor actually asks
    # about. The batch row stays as well, so "the lecturer saved the gradebook" is
    # still one findable event rather than only its consequences.
    student_names = {}
    if changed:
        student_names = {
            sp.id: (sp.full_name, sp.student_number)
            for sp in db.scalars(
                select(StudentProfile).where(
                    StudentProfile.id.in_([sid for sid, _b, _a in changed])
                )
            ).all()
        }
    for sid, before, after in changed:
        name, number = student_names.get(sid, (None, None))
        db.add(
            AuditLog(
                actor_user_id=actor.id,
                action="grade.update",
                entity_type="grade",
                entity_id=assessment.id,
                summary={
                    "student_id": str(sid),
                    "student_name": name,
                    "student_number": number,
                    "assessment": assessment.title,
                    "assessment_id": str(assessment.id),
                    "max_score": _f(assessment.max_score),
                    "first_entry": before is None,
                },
                previous_value=before,
                new_value=after,
            )
        )

    _audit(
        db,
        actor=actor,
        action="grade.update",
        entity_id=assessment.id,
        summary={
            "entries": len(entries),
            "changed": len(changed),
            "assessment": assessment.title,
            "batch": True,
        },
    )
    db.commit()
    return GradeEntryResponse(updated=results)


# ──────────────────────────────────────────────────────────────────────────────
# GET /grades/me
# ──────────────────────────────────────────────────────────────────────────────
def get_my_grades(
    db: Session,
    *,
    actor: User,
    academic_year_id: uuid.UUID | None,
    semester_id: uuid.UUID | None = None,
) -> MyGrades:
    """A student's own released results, grouped by subject.

    Release filtering happens twice on purpose: unreleased assessments are dropped
    from the listing, AND the term average is computed with `released_only=True`,
    so the number a student sees is always derivable from the rows shown to them.

    `semester_id` narrows within the resolved year (the student's global switcher picks
    a year·semester pair). It is threaded into the ONE `_assessments_for` call below,
    which feeds both the listing and `compute_term_grade` — so "term average" stays
    derivable from the rows shown rather than silently averaging the whole year. A
    semester that belongs to some OTHER year simply matches nothing, which is the
    correct empty answer and not a mislabelling (same reasoning as the year fallback
    guard below).
    """
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

    # Resolve the section this student sat in for the selected year, via their
    # enrollments joined to that year's semesters.
    section: CourseOffering | None = None
    if year_id is not None:
        section = db.scalar(
            select(CourseOffering)
            .join(ClassEnrollment, ClassEnrollment.offering_id == CourseOffering.id)
            .join(Semester, ClassEnrollment.semester_id == Semester.id)
            .where(
                ClassEnrollment.student_id == student.id,
                Semester.academic_year_id == year_id,
            )
            .order_by(ClassEnrollment.enrolled_at.desc())
            .limit(1)
        )
    # Fallback to the student's current enrollment ONLY when no year was asked for.
    #
    # ⚠️ This condition is the fix for a real defect. The fallback used to run whenever
    # `section is None`, including when the caller had explicitly named a year the
    # student has no enrollment in — so `/grades/me?academic_year_id=<other-or-stale>`
    # silently returned the CURRENT year's grades under the requested year's heading.
    # The student's own year switcher only offers years they were enrolled in, so this
    # was not reachable by clicking; a stale bookmark or a hand-edited URL reached it.
    # No cross-user exposure (every query here is already keyed to `student.id`) — the
    # bug is mislabelling: the reader believes they are looking at another year.
    #
    # Keeping the fallback for the `academic_year_id is None` case is deliberate: that
    # is the "school has no active year configured" path, where showing the student
    # their most recent enrollment is better than showing nothing.
    #
    # With a year requested and no enrollment in it, the correct answer is an EMPTY
    # result, which is what `/attendance/me` already does for the same situation
    # (it filters records by that year's semesters with no fallback). Matching it
    # keeps the two student year-switcher surfaces consistent with each other.
    if section is None and academic_year_id is None:
        section = db.scalar(
            select(CourseOffering)
            .join(ClassEnrollment, ClassEnrollment.offering_id == CourseOffering.id)
            .where(
                ClassEnrollment.student_id == student.id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
            .order_by(ClassEnrollment.enrolled_at.desc())
            .limit(1)
        )

    student_ref = StudentRef(
        id=student.id, full_name=student.full_name, student_number=student.student_number
    )
    if section is None:
        return MyGrades(student=student_ref, by_subject=[])

    year = year_of_offering(db, section)
    school = _school_policy(db)
    bands, _pass_mark = _bands_for_section(db, section)

    offerings = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        # As in the picker: no `is_active` filter, so a past year still lists.
        .where(CourseOffering.id == section.id, CourseOffering.deleted_at.is_(None))
    ).all()
    teachers_by_cs = _teacher_rows(db, [cs.id for cs, _ in offerings])

    by_subject: list[MyGradeSubject] = []
    for cs, subject in offerings:
        assessments = _assessments_for(db, cs.id, semester_id)
        assessment_ids = [a.id for a in assessments]
        student_grades = {
            g.assessment_id: g
            for g in (
                db.scalars(
                    select(AssessmentGrade).where(
                        AssessmentGrade.assessment_id.in_(assessment_ids),
                        AssessmentGrade.student_id == student.id,
                    )
                ).all()
                if assessment_ids
                else []
            )
        }
        category_rows, category_inputs, uncategorized_drop = _resolved_categories(
            db, cs.id, year, school
        )
        categories_by_id = {c.id: c for c in category_rows}

        listed: list[MyGradeAssessment] = []
        for a in assessments:
            g = student_grades.get(a.id)
            released = a.is_released if g is None or g.is_released is None else g.is_released
            if not released:
                continue
            # Only surface rows that carry a real result.
            if g is None or g.status == GradeStatus.PENDING:
                continue
            score = _dec(g.score) if g.status == GradeStatus.GRADED else None
            listed.append(
                MyGradeAssessment(
                    assessment_id=a.id,
                    title=a.title,
                    type=a.type,
                    max_score=_f(a.max_score),
                    assessment_date=a.assessment_date,
                    status=g.status,
                    score=_f(score),
                    letter=(
                        calc.letter_for(calc.percentage_for(score, a.max_score), bands)
                        if score is not None
                        else None
                    ),
                )
            )

        term = calc.compute_term_grade(
            _grade_inputs(assessments, student_grades, categories_by_id, year, school),
            categories=category_inputs,
            uncategorized_drop_lowest=uncategorized_drop,
            bands=bands,
            released_only=True,
        )
        teachers = teachers_by_cs.get(cs.id, [])
        lead = next((t for t, is_lead in teachers if is_lead), None)
        by_subject.append(
            MyGradeSubject(
                offering=_offering_ref(cs, subject, teachers),
                teacher=(
                    TeacherRef(id=lead.id, full_name=lead.full_name)
                    if lead is not None
                    else None
                ),
                assessments=listed,
                term_numeric=_f(term.numeric),
                term_letter=term.letter,
            )
        )

    by_subject.sort(key=lambda s: s.offering.offering.label if s.offering else "")
    return MyGrades(student=student_ref, by_subject=by_subject)


# ──────────────────────────────────────────────────────────────────────────────
# Student-detail assessment groups — consumed by the Students module
# ──────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class StudentAssessmentLineData:
    """One assessment row as an admin/teacher sees it on a student's detail page."""

    id: uuid.UUID
    title: str
    type: AssessmentType
    max_score: float
    weight: float | None
    assessment_date: date | None
    #: The **student's grade status**, not the assessment's lifecycle status.
    #: `pending` when no `assessment_grades` row exists — schema §10.2b treats
    #: "no row" and "pending" identically.
    status: GradeStatus
    #: Withheld (`None`) unless the row is released AND its status is `graded`.
    score: float | None
    #: Effective release flag: `grade.is_released ?? assessment.is_released`.
    is_released: bool
    #: When a principal/secretary last nudged this assessment's teacher to release
    #: (UTC, aware), or `None` if never. Read from `audit_log`, not a column — see
    #: `assessments/release_nudge.py`. Present on EVERY line, not just the ones
    #: currently awaiting release, so the tab can still show "reminded 2h ago" on a
    #: row the teacher has since published.
    last_nudged_at: datetime | None = None


@dataclass(frozen=True)
class StudentSubjectAssessmentsData:
    """One offering's assessments plus the student's term grade for it."""

    offering_id: uuid.UUID
    subject_id: uuid.UUID
    subject_name: str
    subject_code: str | None
    term_numeric: float | None
    term_letter: str | None
    assessments: list[StudentAssessmentLineData]


def student_assessment_groups(
    db: Session, *, student_id: uuid.UUID, sections: list[CourseOffering]
) -> list[StudentSubjectAssessmentsData]:
    """One student's assessments + term grades across `sections`, grouped by offering.

    Backs `GET /students/{id}/assessments` (an admin/teacher read of somebody
    else's record). It lives here rather than in the Students module because the
    term grade must come from the single engine in `calc.py` — nothing recomputes
    that math locally. Returns plain dataclasses, deliberately: the Students
    module owns its own wire schema, and neither module imports the other's.

    Authorization is the CALLER's job — this function trusts `student_id`.

    D29: `sections` is a LIST — every subject class the student sits in the year being
    viewed, resolved by `students.service.student_offerings_in_year`. It used to be one homeroom,
    which under a sixth-form model would have shown one subject and hidden the rest.
    Which-classes-in-which-year is an enrollment question, and keeping it in one place
    there is what stops the profile header and this tab from disagreeing. `[]` → no
    groups.

    Three behaviours deliberately differ from `get_my_grades` (the student's own
    view of the same data):

    * **`released_only=False`.** Principal / secretary / teacher see the true
      working average, the same number the gradebook shows. A student's own term
      grade can therefore legitimately read lower while results are unreleased.
    * **Unreleased assessments are still listed** — only the `score` is withheld.
      The student's view drops the row entirely.
    * **Rows with no grade yet are listed as `pending`** rather than dropped, so
      the tab shows the full plan of work for the term.

    Because each class carries its year, assessments are not filtered by semester
    (a year spans both). Offerings are listed with no `is_active` filter —
    offerings of a past year are inactive and the year switcher must still render
    them (as in the gradebook picker).
    """
    if not sections:
        return []

    school = _school_policy(db)
    # Year and grading bands are resolved PER CLASS rather than once: the caller
    # normally passes classes from a single year, but nothing here forces that, and
    # applying one year's bands to another's grades would silently mislabel letters.
    sections_by_id = {s.id: s for s in sections}
    years = {
        s.id: year_of_offering(db, s) for s in sections_by_id.values()
    }
    bands_by_section = {
        s.id: _bands_for_section(db, s)[0] for s in sections_by_id.values()
    }

    offerings = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            CourseOffering.id.in_(list(sections_by_id)),
            CourseOffering.deleted_at.is_(None),
        )
        .order_by(Course.name.asc(), CourseOffering.id.asc())
    ).all()
    if not offerings:
        return []

    cs_ids = [cs.id for cs, _ in offerings]
    # Draft assessments stay internal-only on this screen. Excluding them cannot
    # move a term grade either — `calc.compute_term_grade` only counts
    # assessments whose LIFECYCLE status is `graded`.
    assessments_by_cs = _assessments_for_many(db, cs_ids, None, exclude_draft=True)

    all_ids = [a.id for rows in assessments_by_cs.values() for a in rows]
    grades_by_assessment: dict[uuid.UUID, AssessmentGrade] = (
        {
            g.assessment_id: g
            for g in db.scalars(
                select(AssessmentGrade).where(
                    AssessmentGrade.assessment_id.in_(all_ids),
                    AssessmentGrade.student_id == student_id,
                )
            ).all()
        }
        if all_ids
        else {}
    )
    # ONE grouped audit_log read for every assessment on the tab, not one per row.
    nudges = release_nudge.last_nudged_at_bulk(db, all_ids)

    groups: list[StudentSubjectAssessmentsData] = []
    for cs, subject in offerings:
        year = years.get(cs.id)
        bands = bands_by_section.get(cs.id, [])
        assessments = assessments_by_cs.get(cs.id, [])
        student_grades = {
            a.id: grades_by_assessment[a.id]
            for a in assessments
            if a.id in grades_by_assessment
        }
        category_rows, category_inputs, uncategorized_drop = _resolved_categories(
            db, cs.id, year, school
        )
        categories_by_id = {c.id: c for c in category_rows}

        lines: list[StudentAssessmentLineData] = []
        for a in assessments:
            g = student_grades.get(a.id)
            released = bool(
                a.is_released if g is None or g.is_released is None else g.is_released
            )
            graded = g is not None and g.status == GradeStatus.GRADED
            lines.append(
                StudentAssessmentLineData(
                    id=a.id,
                    title=a.title,
                    type=a.type,
                    max_score=_f(a.max_score),
                    weight=_f(a.weight),
                    assessment_date=a.assessment_date,
                    status=g.status if g is not None else GradeStatus.PENDING,
                    score=_f(g.score) if (released and graded) else None,
                    is_released=released,
                    last_nudged_at=nudges.get(a.id),
                )
            )

        term = calc.compute_term_grade(
            _grade_inputs(assessments, student_grades, categories_by_id, year, school),
            categories=category_inputs,
            uncategorized_drop_lowest=uncategorized_drop,
            bands=bands,
            released_only=False,
        )
        groups.append(
            StudentSubjectAssessmentsData(
                offering_id=cs.id,
                subject_id=subject.id,
                subject_name=subject.name,
                subject_code=subject.code,
                term_numeric=_f(term.numeric),
                term_letter=term.letter,
                assessments=lines,
            )
        )
    return groups


# ──────────────────────────────────────────────────────────────────────────────
# Completed-course results — the input to prerequisite validation (D30 §D4)
# ──────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class CourseResult:
    """What a student ended up with in one COURSE, wherever that came from."""

    course_id: uuid.UUID
    numeric: Decimal | None
    letter: str | None
    #: The bands in force for the year the result was earned in — the caller needs
    #: them to resolve a grade point, and a later scale edit must not reletter a
    #: historical result (schema §10.4).
    bands: list[calc.BandInput]
    #: True when it came from a frozen `term_grade_snapshots` row rather than a
    #: live computation. Surfaced so a 409 can say which it is.
    is_frozen: bool


def completed_course_results(
    db: Session, *, student_id: uuid.UUID, exclude_semester_id: uuid.UUID | None = None
) -> dict[uuid.UUID, CourseResult]:
    """Every course this student has a RESULT for, keyed by course id (D30 §D4).

    This lives here, not in the prerequisites module, for the reason the whole
    module exists: the term grade must come from the single engine in `calc.py`,
    and nothing recomputes that math locally (plan §C).

    TWO SOURCES, and both are needed:

      * **Frozen** `term_grade_snapshots`, written by the archive freeze. These are
        the authority for any archived year — a later scale edit must not reletter
        them.
      * **Live** computation for years that have not been archived. Without this,
        a student who finished Semester 1 of the CURRENT year would have no result
        at all, and every prerequisite in the school would be unsatisfiable until
        July.

    `exclude_semester_id` drops enrolments in that term. The caller passes the term
    being enrolled INTO, which is what stops a course from satisfying its own
    prerequisite: sitting MATH2 alongside MATH1 this term is not having completed
    MATH1. Frozen snapshots are filtered the same way for the same reason.

    A frozen result wins over a live one for the same course — it is the archived
    truth. Between two live results (a retake, or the same course sat in two terms)
    the HIGHER numeric wins, which matches how a transcript reads a repeated course.

    Authorization is the CALLER's job; this trusts `student_id`.
    """
    results: dict[uuid.UUID, CourseResult] = {}

    # ── Live: every section the student sits/sat, outside the excluded term ──────
    enrol_stmt = (
        select(ClassEnrollment.offering_id)
        .where(ClassEnrollment.student_id == student_id)
        .distinct()
    )
    if exclude_semester_id is not None:
        enrol_stmt = enrol_stmt.where(ClassEnrollment.semester_id != exclude_semester_id)
    section_ids = list(db.scalars(enrol_stmt).all())

    if section_ids:
        sections = list(
            db.scalars(
                select(CourseOffering).where(
                    CourseOffering.id.in_(section_ids), CourseOffering.deleted_at.is_(None)
                )
            ).all()
        )
        for group in student_assessment_groups(
            db, student_id=student_id, sections=sections
        ):
            if group.term_letter is None:
                continue  # nothing participated — not a result, not a failure
            numeric = _dec(group.term_numeric)
            existing = results.get(group.subject_id)
            if existing is not None and not existing.is_frozen:
                if (existing.numeric or Decimal(0)) >= (numeric or Decimal(0)):
                    continue
            results[group.subject_id] = CourseResult(
                course_id=group.subject_id,
                numeric=numeric,
                letter=group.term_letter,
                bands=_bands_for_offering(db, group.offering_id),
                is_frozen=False,
            )

    # ── Frozen: authoritative, so applied last and unconditionally ──────────────
    snap_stmt = select(TermGradeSnapshot).where(
        TermGradeSnapshot.student_id == student_id
    )
    if exclude_semester_id is not None:
        snap_stmt = snap_stmt.where(
            TermGradeSnapshot.semester_id != exclude_semester_id
        )
    for snap in db.scalars(snap_stmt).all():
        existing = results.get(snap.subject_id)
        numeric = _dec(snap.numeric_grade)
        if (
            existing is not None
            and existing.is_frozen
            and (existing.numeric or Decimal(0)) >= (numeric or Decimal(0))
        ):
            continue
        results[snap.subject_id] = CourseResult(
            course_id=snap.subject_id,
            numeric=numeric,
            letter=snap.letter_grade,
            bands=_bands_for_offering(db, snap.offering_id),
            is_frozen=True,
        )

    return results


def _bands_for_offering(
    db: Session, offering_id: uuid.UUID
) -> list[calc.BandInput]:
    """The grading bands in force for the YEAR an offering belongs to.

    Resolved per offering rather than once, for the same reason
    `student_assessment_groups` does it: results can span years, and applying one
    year's scale to another year's grade would silently mislabel the letter — and
    here, silently change whether a prerequisite is satisfied.
    """
    section = db.scalar(
        select(CourseOffering)
        .where(CourseOffering.id == offering_id)
    )
    if section is None:
        return []
    return _bands_for_section(db, section)[0]


# ──────────────────────────────────────────────────────────────────────────────
# GET /grades/term
# ──────────────────────────────────────────────────────────────────────────────
def list_term_grades(
    db: Session,
    *,
    actor: User,
    scope: str | None,
    student_id: uuid.UUID | None,
    offering_id: uuid.UUID | None,
    semester_id: uuid.UUID | None,
) -> TermGradeList:
    """Term grades for a flexible selection.

    Archived years are served from `term_grade_snapshots` (frozen at archival,
    schema §10.4) and flagged `is_frozen`; live years are computed on read.
    """
    is_student = actor.role == Role.STUDENT or scope == "me"

    target_student: StudentProfile | None = None
    if is_student:
        target_student = db.scalar(
            select(StudentProfile).where(
                StudentProfile.user_id == actor.id, StudentProfile.deleted_at.is_(None)
            )
        )
        if target_student is None:
            raise NotFound("Student profile not found.", code="not_found")
    elif student_id is not None:
        target_student = db.scalar(
            select(StudentProfile).where(
                StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
            )
        )
        if target_student is None:
            raise NotFound("Student not found.", code="not_found")

    # Which offerings are in scope?
    cs_stmt = (
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(CourseOffering.deleted_at.is_(None))
        .order_by(*OFFERING_ORDER)
    )
    if offering_id is not None:
        cs_stmt = cs_stmt.where(CourseOffering.id == offering_id)

    if actor.role == Role.TEACHER:
        owned = _owned_cs_ids(db, actor)
        if offering_id is not None and offering_id not in owned:
            raise NotFound("Gradebook not found.", code="not_found")
        if not owned:
            return TermGradeList(items=[])
        cs_stmt = cs_stmt.where(CourseOffering.id.in_(owned))

    if target_student is not None:
        # Restrict to offerings of sections the student is/was enrolled in.
        section_ids = list(
            db.scalars(
                select(ClassEnrollment.offering_id).where(
                    ClassEnrollment.student_id == target_student.id
                )
            ).all()
        )
        if not section_ids:
            return TermGradeList(items=[])
        cs_stmt = cs_stmt.where(CourseOffering.id.in_(section_ids))

    offerings = db.execute(cs_stmt).all()
    if not offerings:
        return TermGradeList(items=[])

    teachers_by_cs = _teacher_rows(db, [cs.id for cs, _ in offerings])
    school = _school_policy(db)
    items: list[TermGradeItem] = []

    for cs, subject in offerings:
        section = cs
        semester = _semester_for_section(db, section, semester_id)
        if semester is None:
            continue
        year = year_of_offering(db, section)
        frozen = year is not None and year.archived_at is not None
        bands, _pass_mark = _bands_for_section(db, section)
        cs_ref = _offering_ref(cs, subject, teachers_by_cs.get(cs.id, []))
        sem_ref = SemesterRef(id=semester.id, name=semester.name, sequence=semester.sequence)

        # Which students? The named one, else the section's active roster.
        if target_student is not None:
            students = [target_student]
        else:
            students = list(
                db.scalars(
                    select(StudentProfile)
                    .join(ClassEnrollment, ClassEnrollment.student_id == StudentProfile.id)
                    .where(
                        ClassEnrollment.offering_id == section.id,
                        ClassEnrollment.semester_id == semester.id,
                        ClassEnrollment.unenrolled_at.is_(None),
                    )
                    .order_by(*STUDENT_NAME_ORDER)
                ).all()
            )

        if frozen:
            snapshots = {
                s.student_id: s
                for s in db.scalars(
                    select(TermGradeSnapshot).where(
                        TermGradeSnapshot.offering_id == cs.id,
                        TermGradeSnapshot.semester_id == semester.id,
                    )
                ).all()
            }
            for student in students:
                snap = snapshots.get(student.id)
                if snap is None:
                    continue
                items.append(
                    TermGradeItem(
                        student=StudentRef(
                            id=student.id,
                            full_name=student.full_name,
                            student_number=student.student_number,
                        ),
                        offering=cs_ref,
                        semester=sem_ref,
                        numeric=_f(snap.numeric_grade),
                        letter=snap.letter_grade,
                        weight_base_used=_f(snap.weight_base_used),
                        is_frozen=True,
                        effective_policy=snap.effective_policy,
                    )
                )
            continue

        assessments = _assessments_for(db, cs.id, semester.id)
        assessment_ids = [a.id for a in assessments]
        category_rows, category_inputs, uncategorized_drop = _resolved_categories(
            db, cs.id, year, school
        )
        categories_by_id = {c.id: c for c in category_rows}

        grades_by_student: dict[uuid.UUID, dict[uuid.UUID, AssessmentGrade]] = defaultdict(dict)
        if assessment_ids and students:
            for g in db.scalars(
                select(AssessmentGrade).where(
                    AssessmentGrade.assessment_id.in_(assessment_ids),
                    AssessmentGrade.student_id.in_([s.id for s in students]),
                )
            ).all():
                grades_by_student[g.student_id][g.assessment_id] = g

        requests = {
            student.id: calc.TermGradeRequest(
                grades=_grade_inputs(
                    assessments, grades_by_student.get(student.id, {}), categories_by_id, year, school
                ),
                categories=category_inputs,
                uncategorized_drop_lowest=uncategorized_drop,
                bands=bands,
                # A student reading their own term grade only ever sees released work.
                released_only=is_student,
            )
            for student in students
        }
        computed = calc.compute_term_grades_bulk(requests)

        for student in students:
            term = computed[student.id]
            items.append(
                TermGradeItem(
                    student=StudentRef(
                        id=student.id,
                        full_name=student.full_name,
                        student_number=student.student_number,
                    ),
                    offering=cs_ref,
                    semester=sem_ref,
                    numeric=_f(term.numeric),
                    letter=term.letter,
                    weight_base_used=_f(term.weight_base_used),
                    is_frozen=False,
                    effective_policy=None,
                )
            )

    return TermGradeList(items=items)

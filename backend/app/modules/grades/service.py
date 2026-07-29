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
from app.core.rbac import _teacher_profile_id, assert_teacher_owns_class_subject
from app.core.timeutil import utcnow
from app.modules.assessments import release_nudge
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.grades import calc
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.grades.schemas import (
    ClassSubjectOption,
    ClassSubjectOptionsResponse,
    ClassSubjectRef,
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
    SectionRef,
    SemesterRef,
    StudentRef,
    SubjectRef,
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
from app.modules.students.models import StudentProfile
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
def _cs_or_404(db: Session, class_subject_id: uuid.UUID) -> ClassSubject:
    cs = db.scalar(
        select(ClassSubject).where(
            ClassSubject.id == class_subject_id, ClassSubject.deleted_at.is_(None)
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


def _assert_year_writable(db: Session, cs: ClassSubject) -> None:
    section = db.get(Class, cs.class_id)
    if section is not None and section.is_archived:
        raise Conflict("The academic year is archived.", code="year_archived")
    if section is not None:
        year = db.get(AcademicYear, section.academic_year_id)
        if year is not None and year.archived_at is not None:
            raise Conflict("The academic year is archived.", code="year_archived")


def _assert_readable(db: Session, actor: User, cs: ClassSubject) -> bool:
    """Authorize a gradebook read. Returns whether the caller may WRITE it.

    A teacher who doesn't own the offering gets 404 from
    `assert_teacher_owns_class_subject`, matching the discipline used for the
    write path — the mock returns 403 on writes, but a consistent 404 everywhere
    avoids confirming that an offering they can't see exists.
    """
    if actor.role == Role.TEACHER:
        assert_teacher_owns_class_subject(db, actor, cs.id)
        return True
    return False


def _active_year(db: Session) -> AcademicYear | None:
    from app.common.enums import AcademicYearStatus

    return db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


def _semester_for_section(
    db: Session, section: Class, semester_id: uuid.UUID | None
) -> Semester | None:
    """Resolve which term's gradebook to show.

    Explicit param → the active semester **only if it belongs to this section's
    academic year** → else that year's `sequence=1` term.

    The year check is the load-bearing part: a principal browsing an archived year
    through the global year switcher would otherwise be handed the *current*
    year's active semester, match no assessments, and see an empty gradebook.
    """
    if semester_id is not None:
        return db.get(Semester, semester_id)

    active = db.scalar(
        select(Semester).where(
            Semester.is_active.is_(True),
            Semester.academic_year_id == section.academic_year_id,
        )
    )
    if active is not None:
        return active

    return db.scalar(
        select(Semester)
        .where(Semester.academic_year_id == section.academic_year_id)
        .order_by(Semester.sequence.asc())
        .limit(1)
    )


def _bands_for_section(db: Session, section: Class) -> tuple[list[calc.BandInput], Decimal | None]:
    """Grading bands + pass mark for the SECTION's academic year.

    Not the active year's: an archived year keeps the scale that was in force then
    (schema §10.4), so a historical gradebook must not be relettered by a later
    scale edit. Falls back to the active year's scale when a year has none (a
    test-created year, typically).
    """
    scale = db.scalar(
        select(GradingScale).where(GradingScale.academic_year_id == section.academic_year_id)
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
        calc.BandInput(letter=b.letter, min_score=_dec(b.min_score), is_passing=b.is_passing)
        for b in rows
    ]
    return bands, _dec(scale.pass_mark)


def _school_policy(db: Session) -> AssessmentPolicy | None:
    return db.scalar(select(AssessmentPolicy).where(AssessmentPolicy.id == 1))


# ──────────────────────────────────────────────────────────────────────────────
# Refs
# ──────────────────────────────────────────────────────────────────────────────
def _section_ref(section: Class) -> SectionRef:
    return SectionRef(
        id=section.id,
        name=section.name,
        grade_level=section.grade_level,
        # Nullable in the ORM, non-nullable `string` in the frontend type.
        section=section.section or "",
    )


def _subject_ref(subject: Subject) -> SubjectRef:
    return SubjectRef(id=subject.id, name=subject.name, code=subject.code)


def _teacher_rows(db: Session, cs_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[tuple]]:
    """Batch-load (teacher, is_lead) per class_subject — avoids an N+1 in the picker."""
    if not cs_ids:
        return {}
    rows = db.execute(
        select(ClassTeacher.class_subject_id, TeacherProfile, ClassTeacher.is_lead)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.class_subject_id.in_(cs_ids))
    ).all()
    out: dict[uuid.UUID, list[tuple]] = defaultdict(list)
    for cs_id, teacher, is_lead in rows:
        out[cs_id].append((teacher, is_lead))
    # Lead first, then by name — the frontend shows `teachers[0]` as the owner.
    for items in out.values():
        items.sort(key=lambda t: (not t[1], t[0].full_name))
    return out


def _cs_ref(
    cs: ClassSubject,
    section: Class,
    subject: Subject,
    teachers: list[tuple],
) -> ClassSubjectRef:
    lead = next((t for t, is_lead in teachers if is_lead), None)
    return ClassSubjectRef(
        id=cs.id,
        section=_section_ref(section),
        subject=_subject_ref(subject),
        teachers=[TeacherRef(id=t.id, full_name=t.full_name) for t, _ in teachers],
        lead_teacher_id=lead.id if lead is not None else None,
        display_name=f"{section.name} · {subject.name}",
    )


def _owned_cs_ids(db: Session, actor: User) -> list[uuid.UUID]:
    teacher_id = _teacher_profile_id(db, actor)
    return list(
        db.scalars(
            select(ClassTeacher.class_subject_id).where(ClassTeacher.teacher_id == teacher_id)
        ).all()
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /grades/class-subjects
# ──────────────────────────────────────────────────────────────────────────────
def list_class_subject_options(
    db: Session, *, actor: User, academic_year_id: uuid.UUID | None
) -> ClassSubjectOptionsResponse:
    """The gradebook picker. Teacher → owned offerings; P/S → every offering."""
    year_id = academic_year_id
    if year_id is None:
        active = _active_year(db)
        year_id = active.id if active is not None else None

    stmt = (
        select(ClassSubject, Class, Subject)
        .join(Class, ClassSubject.class_id == Class.id)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        # NOTE: `is_active` is deliberately NOT filtered here. Offerings of a past
        # year are inactive, and the year switcher must still list them.
        .where(ClassSubject.deleted_at.is_(None), Class.deleted_at.is_(None))
    )
    if year_id is not None:
        stmt = stmt.where(Class.academic_year_id == year_id)

    is_teacher = actor.role == Role.TEACHER
    if is_teacher:
        owned = _owned_cs_ids(db, actor)
        if not owned:
            return ClassSubjectOptionsResponse(items=[])
        stmt = stmt.where(ClassSubject.id.in_(owned))

    rows = db.execute(stmt).all()
    cs_ids = [cs.id for cs, _, _ in rows]
    teachers_by_cs = _teacher_rows(db, cs_ids)

    counts: dict[uuid.UUID, int] = {}
    if cs_ids:
        for cs_id, total in db.execute(
            select(Assessment.class_subject_id, func.count())
            .where(
                Assessment.class_subject_id.in_(cs_ids),
                Assessment.deleted_at.is_(None),
            )
            .group_by(Assessment.class_subject_id)
        ).all():
            counts[cs_id] = total

    items = [
        ClassSubjectOption(
            **_cs_ref(cs, section, subject, teachers_by_cs.get(cs.id, [])).model_dump(),
            assessment_count=counts.get(cs.id, 0),
            can_edit=is_teacher,
        )
        for cs, section, subject in rows
    ]
    items.sort(key=lambda i: i.display_name)
    return ClassSubjectOptionsResponse(items=items)


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
            select(AssessmentCategory).where(AssessmentCategory.class_subject_id == cs_id)
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
        Assessment.class_subject_id.in_(cs_ids), Assessment.deleted_at.is_(None)
    )
    if semester_id is not None:
        stmt = stmt.where(Assessment.semester_id == semester_id)
    if exclude_draft:
        stmt = stmt.where(Assessment.status != AssessmentStatus.DRAFT)

    out: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in db.scalars(stmt).all():
        out[a.class_subject_id].append(a)
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
    class_subject_id: uuid.UUID,
    semester_id: uuid.UUID | None,
) -> Gradebook:
    cs = _cs_or_404(db, class_subject_id)
    can_edit = _assert_readable(db, actor, cs)

    section = db.get(Class, cs.class_id)
    subject = db.get(Subject, cs.subject_id)
    if section is None or subject is None:  # pragma: no cover - FK guarantees these
        raise NotFound("Gradebook not found.", code="not_found")

    semester = _semester_for_section(db, section, semester_id)
    year = db.get(AcademicYear, section.academic_year_id)
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
                ClassEnrollment.class_id == section.id,
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
            cells.append(
                GradebookCell(
                    assessment_id=a.id,
                    status=status,
                    score=_f(score),
                    makeup_score=_f(g.makeup_score) if g is not None else None,
                    is_released=bool(released),
                    letter=letter,
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

    return Gradebook(
        class_subject=_cs_ref(cs, section, subject, _teacher_rows(db, [cs.id]).get(cs.id, [])),
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
    assert_teacher_owns_class_subject(db, actor, assessment.class_subject_id)
    cs = db.get(ClassSubject, assessment.class_subject_id)
    _assert_year_writable(db, cs)

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
                    ClassEnrollment.class_id == cs.class_id,
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
    section = db.get(Class, cs.class_id)
    year = db.get(AcademicYear, section.academic_year_id) if section else None
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

    bands, _pass_mark = _bands_for_section(db, section) if section else ([], None)
    results: list[GradeCellResult] = []
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

    _audit(
        db,
        actor=actor,
        action="grade.update",
        entity_id=assessment.id,
        summary={"entries": len(entries)},
    )
    db.commit()
    return GradeEntryResponse(updated=results)


# ──────────────────────────────────────────────────────────────────────────────
# GET /grades/me
# ──────────────────────────────────────────────────────────────────────────────
def get_my_grades(
    db: Session, *, actor: User, academic_year_id: uuid.UUID | None
) -> MyGrades:
    """A student's own released results, grouped by subject.

    Release filtering happens twice on purpose: unreleased assessments are dropped
    from the listing, AND the term average is computed with `released_only=True`,
    so the number a student sees is always derivable from the rows shown to them.
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
    section: Class | None = None
    if year_id is not None:
        section = db.scalar(
            select(Class)
            .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
            .join(Semester, ClassEnrollment.semester_id == Semester.id)
            .where(
                ClassEnrollment.student_id == student.id,
                Semester.academic_year_id == year_id,
            )
            .order_by(ClassEnrollment.enrolled_at.desc())
            .limit(1)
        )
    if section is None:
        section = db.scalar(
            select(Class)
            .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
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

    year = db.get(AcademicYear, section.academic_year_id)
    school = _school_policy(db)
    bands, _pass_mark = _bands_for_section(db, section)

    offerings = db.execute(
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        # As in the picker: no `is_active` filter, so a past year still lists.
        .where(ClassSubject.class_id == section.id, ClassSubject.deleted_at.is_(None))
    ).all()
    teachers_by_cs = _teacher_rows(db, [cs.id for cs, _ in offerings])

    by_subject: list[MyGradeSubject] = []
    for cs, subject in offerings:
        assessments = _assessments_for(db, cs.id, None)
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
                class_subject=_cs_ref(cs, section, subject, teachers),
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

    by_subject.sort(key=lambda s: s.class_subject.display_name if s.class_subject else "")
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

    class_subject_id: uuid.UUID
    subject_id: uuid.UUID
    subject_name: str
    subject_code: str | None
    term_numeric: float | None
    term_letter: str | None
    assessments: list[StudentAssessmentLineData]


def student_assessment_groups(
    db: Session, *, student_id: uuid.UUID, section: Class | None
) -> list[StudentSubjectAssessmentsData]:
    """One student's assessments + term grades for `section`, grouped by offering.

    Backs `GET /students/{id}/assessments` (an admin/teacher read of somebody
    else's record). It lives here rather than in the Students module because the
    term grade must come from the single engine in `calc.py` — nothing recomputes
    that math locally. Returns plain dataclasses, deliberately: the Students
    module owns its own wire schema, and neither module imports the other's.

    Authorization is the CALLER's job — this function trusts `student_id`.

    The caller also resolves `section` (which section the student sat in for the
    year being viewed) via `students.service.section_in_year`. Which-section-in-
    which-year is an enrollment question, and keeping it in one place there is what
    stops the profile header and this tab from disagreeing. `None` → no groups.

    Three behaviours deliberately differ from `get_my_grades` (the student's own
    view of the same data):

    * **`released_only=False`.** Principal / secretary / teacher see the true
      working average, the same number the gradebook shows. A student's own term
      grade can therefore legitimately read lower while results are unreleased.
    * **Unreleased assessments are still listed** — only the `score` is withheld.
      The student's view drops the row entirely.
    * **Rows with no grade yet are listed as `pending`** rather than dropped, so
      the tab shows the full plan of work for the term.

    Because the section carries the year, assessments are not filtered by semester
    (a year spans both). Offerings are listed with no `is_active` filter —
    offerings of a past year are inactive and the year switcher must still render
    them (as in the gradebook picker).
    """
    if section is None:
        return []

    year = db.get(AcademicYear, section.academic_year_id)
    school = _school_policy(db)
    bands, _pass_mark = _bands_for_section(db, section)

    offerings = db.execute(
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(ClassSubject.class_id == section.id, ClassSubject.deleted_at.is_(None))
        .order_by(Subject.name.asc())
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
                class_subject_id=cs.id,
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
# GET /grades/term
# ──────────────────────────────────────────────────────────────────────────────
def list_term_grades(
    db: Session,
    *,
    actor: User,
    scope: str | None,
    student_id: uuid.UUID | None,
    class_subject_id: uuid.UUID | None,
    class_id: uuid.UUID | None,
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
        select(ClassSubject, Class, Subject)
        .join(Class, ClassSubject.class_id == Class.id)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(ClassSubject.deleted_at.is_(None))
    )
    if class_subject_id is not None:
        cs_stmt = cs_stmt.where(ClassSubject.id == class_subject_id)
    if class_id is not None:
        cs_stmt = cs_stmt.where(ClassSubject.class_id == class_id)

    if actor.role == Role.TEACHER:
        owned = _owned_cs_ids(db, actor)
        if class_subject_id is not None and class_subject_id not in owned:
            raise NotFound("Gradebook not found.", code="not_found")
        if not owned:
            return TermGradeList(items=[])
        cs_stmt = cs_stmt.where(ClassSubject.id.in_(owned))

    if target_student is not None:
        # Restrict to offerings of sections the student is/was enrolled in.
        section_ids = list(
            db.scalars(
                select(ClassEnrollment.class_id).where(
                    ClassEnrollment.student_id == target_student.id
                )
            ).all()
        )
        if not section_ids:
            return TermGradeList(items=[])
        cs_stmt = cs_stmt.where(ClassSubject.class_id.in_(section_ids))

    offerings = db.execute(cs_stmt).all()
    if not offerings:
        return TermGradeList(items=[])

    teachers_by_cs = _teacher_rows(db, [cs.id for cs, _, _ in offerings])
    school = _school_policy(db)
    items: list[TermGradeItem] = []

    for cs, section, subject in offerings:
        semester = _semester_for_section(db, section, semester_id)
        if semester is None:
            continue
        year = db.get(AcademicYear, section.academic_year_id)
        frozen = year is not None and year.archived_at is not None
        bands, _pass_mark = _bands_for_section(db, section)
        cs_ref = _cs_ref(cs, section, subject, teachers_by_cs.get(cs.id, []))
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
                        ClassEnrollment.class_id == section.id,
                        ClassEnrollment.semester_id == semester.id,
                        ClassEnrollment.unenrolled_at.is_(None),
                    )
                    .order_by(StudentProfile.full_name.asc())
                ).all()
            )

        if frozen:
            snapshots = {
                s.student_id: s
                for s in db.scalars(
                    select(TermGradeSnapshot).where(
                        TermGradeSnapshot.class_subject_id == cs.id,
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
                        class_subject=cs_ref,
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
                    class_subject=cs_ref,
                    semester=sem_ref,
                    numeric=_f(term.numeric),
                    letter=term.letter,
                    weight_base_used=_f(term.weight_base_used),
                    is_frozen=False,
                    effective_policy=None,
                )
            )

    return TermGradeList(items=items)

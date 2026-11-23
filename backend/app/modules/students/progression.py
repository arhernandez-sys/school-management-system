"""Year-end progression: First year -> Second year -> Completed (11 Nov 2026).

`student_profiles.year_of_study` used to be typed at admission and never advanced. BAJC's
rule (client, 11 Nov 2026):

  * A student must PASS the year's **Summer, Semester 1 and Semester 2** to move on.
  * "Pass" is decided by the GRADING SCALE — the same test the academic history and the
    prerequisite gate use (`calc.meets_grade_point` against the student's programme pass
    mark), so the three can never disagree about one result.
  * There are only two years. A student who never fails is First, then Second, then done:
    a Second-year who passes is moved to `Completed` (coursework finished, award not yet
    conferred — graduation stays a manual Registrar step).
  * A student who does not pass stays in the same year and repeats it.

What "passed the year" means precisely, per student:

  1. Every Summer / Semester term of the academic year has at least one course the
     student sat for credit (an audit or a drop does not count as sitting it).
  2. Every course they sat in those terms was passed. A course failed in one term and
     re-sat and passed in a LATER term of the same year counts as passed — the transcript
     reads a repeated course the same way.
  3. A `failed` or `withdrawn` enrolment is not a pass, and neither is a course with no
     final grade yet.

It runs inside `archive_academic_year`, after the freeze, in the same transaction — so
the year's results are final and the whole thing commits or rolls back together. The
preview (`evaluate_year`) is read-only and is what the Dean sees before confirming.

Only `Active` students are processed. Each decision is written to
`student_year_records` (one row per student per year: the level held DURING the year and
how it ended), which (a) skips anyone already decided for that year, (b) lets the year
switcher show the level a student actually had then, and (c) lets
`reactivate_academic_year` undo exactly the students this run changed.
`student_profiles.year_of_study` stays the CURRENT level.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import (
    EnrollmentStatus,
    ProgressionStanding,
    StudentStatus,
    TermType,
    YearOfStudy,
)
from app.modules.grades import calc
from app.modules.grades import service as grades_service
from app.modules.grades.models import TermGradeSnapshot
from app.modules.offerings.models import ClassEnrollment, Course, CourseOffering
from app.modules.programs.models import Program
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile, StudentYearRecord
from app.modules.users.models import User

#: The terms a year must be passed in. Spring / Independent blocks are not part of the
#: First -> Second rule BAJC gave; courses in them still count on the transcript.
PROGRESSION_TERM_TYPES: frozenset[TermType] = frozenset({TermType.SUMMER, TermType.SEMESTER})

#: Same default as `academics._DEFAULT_MIN_GRADE_POINT`: C+ for a student on no programme.
_DEFAULT_MIN_GRADE_POINT = Decimal("2.50")

#: Sitting a course for credit. An audit was never for credit and a drop left no trace.
_NOT_SAT = frozenset({EnrollmentStatus.AUDIT, EnrollmentStatus.DROPPED})

Outcome = Literal["promote", "complete", "repeat", "skip"]


IssueKind = Literal["missing_term", "failed", "withdrawn", "no_grade", "not_passed"]


@dataclass
class ProgressionIssue:
    """One thing standing between a student and the next year.

    `excused` issues are shown (so the Dean's decision stays visible and reversible) but
    do not block. A `missing_term` is excused at STUDENT level for the year; every other
    kind is excused on the ENROLMENT (`class_enrollments.progression_excused`).
    """

    kind: IssueKind
    message: str
    term_name: str
    enrollment_id: uuid.UUID | None = None
    excused: bool = False
    excuse_reason: str | None = None


@dataclass
class ProgressionDecision:
    student_id: uuid.UUID
    student_number: str
    full_name: str
    year_of_study: YearOfStudy | None
    outcome: Outcome
    #: Why the student is repeating or skipped (unexcused issues only). Empty otherwise.
    reasons: list[str] = field(default_factory=list)
    #: Every issue found, excused ones included.
    issues: list[ProgressionIssue] = field(default_factory=list)
    #: The Dean's student-level exception for this year, if any.
    terms_excused: bool = False
    terms_excuse_reason: str | None = None


@dataclass
class YearProgression:
    year_id: uuid.UUID
    #: The terms the rule was checked against, in order.
    term_names: list[str]
    decisions: list[ProgressionDecision]

    def count(self, outcome: Outcome) -> int:
        return sum(1 for d in self.decisions if d.outcome == outcome)


def _full_name(s: StudentProfile) -> str:
    return s.full_name or s.student_number


def evaluate_year(db: Session, year: AcademicYear) -> YearProgression:
    """Decide every affected student's outcome for `year`. Reads only — writes nothing."""
    terms = sorted(
        (
            t
            for t in db.scalars(
                select(Semester).where(Semester.academic_year_id == year.id)
            ).all()
            if t.term_type in PROGRESSION_TERM_TYPES
        ),
        key=lambda t: t.sequence,
    )
    if not terms:
        return YearProgression(year_id=year.id, term_names=[], decisions=[])
    term_ids = {t.id for t in terms}

    # Every live enrolment in the year's progression terms, with the course it is for.
    rows = db.execute(
        select(ClassEnrollment, CourseOffering, Course)
        .join(CourseOffering, CourseOffering.id == ClassEnrollment.offering_id)
        .join(Course, Course.id == CourseOffering.course_id)
        .where(
            ClassEnrollment.semester_id.in_(term_ids),
            ClassEnrollment.unenrolled_at.is_(None),
            CourseOffering.deleted_at.is_(None),
        )
    ).all()
    if not rows:
        return YearProgression(year_id=year.id, term_names=[t.name for t in terms], decisions=[])

    by_student: dict[uuid.UUID, list[tuple[ClassEnrollment, CourseOffering, Course]]] = {}
    for enr, off, course in rows:
        by_student.setdefault(enr.student_id, []).append((enr, off, course))

    students = {
        s.id: s
        for s in db.scalars(
            select(StudentProfile).where(
                StudentProfile.id.in_(by_student), StudentProfile.deleted_at.is_(None)
            )
        ).all()
    }
    program_ids = {s.program_id for s in students.values() if s.program_id}
    min_gp: dict[uuid.UUID, Decimal | None] = (
        {
            p.id: p.min_passing_grade_point
            for p in db.scalars(select(Program).where(Program.id.in_(program_ids))).all()
        }
        if program_ids
        else {}
    )

    # Frozen results win (the archive writes them just before this runs); anything not
    # frozen is computed live by the single grade engine.
    frozen: dict[tuple[uuid.UUID, uuid.UUID], str] = {
        (snap.student_id, snap.offering_id): snap.letter_grade
        for snap in db.scalars(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.semester_id.in_(term_ids),
                TermGradeSnapshot.student_id.in_(students),
            )
        ).all()
    }

    # One scale per academic year: every offering here is in this year.
    bands = grades_service._bands_for_section(db, rows[0][1])[0]  # noqa: SLF001
    term_name = {t.id: t.name for t in terms}
    term_seq = {t.id: t.sequence for t in terms}
    records = _records_for(db, year.id, list(students))

    decisions: list[ProgressionDecision] = []
    for student_id, enrolments in by_student.items():
        s = students.get(student_id)
        if s is None:
            continue
        d = ProgressionDecision(
            student_id=s.id,
            student_number=s.student_number,
            full_name=_full_name(s),
            year_of_study=s.year_of_study,
            outcome="skip",
        )
        decisions.append(d)

        if s.status != StudentStatus.ACTIVE:
            d.reasons.append(f"Status is {s.status.value}, not Active.")
            continue
        rec = records.get(s.id)
        if rec is not None and rec.result is not None:
            d.reasons.append("Already processed for this year.")
            continue
        if s.year_of_study is None:
            d.reasons.append("Year of study is not set on the student record.")
            continue

        sat = sorted(
            ((e, o, c) for (e, o, c) in enrolments if e.enrollment_status not in _NOT_SAT),
            key=lambda row: term_seq[row[0].semester_id],
        )
        d.terms_excused = bool(rec and rec.missing_terms_excused)
        d.terms_excuse_reason = rec.excuse_reason if (rec and d.terms_excused) else None

        # 1. Every term has at least one course sat for credit — unless the Dean excused
        #    this student's missing sessions for the year.
        sat_terms = {e.semester_id for (e, _, _) in sat}
        for t in terms:
            if t.id not in sat_terms:
                d.issues.append(
                    ProgressionIssue(
                        kind="missing_term",
                        message=f"No courses taken in {t.name}.",
                        term_name=t.name,
                        excused=d.terms_excused,
                        excuse_reason=d.terms_excuse_reason,
                    )
                )

        # 2/3. Every course sat was passed (best attempt within the year).
        live_needed = [o for (e, o, _) in sat if (s.id, o.id) not in frozen]
        live: dict[uuid.UUID, str | None] = {}
        if live_needed:
            for g in grades_service.student_assessment_groups(
                db, student_id=s.id, sections=live_needed
            ):
                live[g.offering_id] = g.term_letter

        threshold = min_gp.get(s.program_id) if s.program_id else None
        if threshold is None:
            threshold = _DEFAULT_MIN_GRADE_POINT

        # Per COURSE: passed if any attempt this year passed. Otherwise one issue, on the
        # excused attempt if the Dean excused one, else on the latest failing attempt.
        passed_course: set[uuid.UUID] = set()
        course_issue: dict[uuid.UUID, ProgressionIssue] = {}
        for e, o, c in sat:
            label = c.code or c.name
            tname = term_name[e.semester_id]
            kind: IssueKind
            if e.enrollment_status is EnrollmentStatus.FAILED:
                ok, kind, why = False, "failed", f"Failed {label} ({tname})."
            elif e.enrollment_status is EnrollmentStatus.WITHDRAWN:
                ok, kind, why = False, "withdrawn", f"Withdrew from {label} ({tname})."
            else:
                letter = frozen.get((s.id, o.id)) or live.get(o.id)
                if letter is None:
                    ok, kind, why = False, "no_grade", f"No final grade for {label} ({tname})."
                else:
                    ok = calc.meets_grade_point(letter, bands, threshold)
                    kind, why = "not_passed", f"Did not pass {label} — {letter} ({tname})."
            if ok:
                passed_course.add(c.id)
                course_issue.pop(c.id, None)
                continue
            if c.id in passed_course:
                continue
            prior = course_issue.get(c.id)
            if prior is not None and prior.excused:
                continue  # an excused attempt already clears the course
            course_issue[c.id] = ProgressionIssue(
                kind=kind,
                message=why,
                term_name=tname,
                enrollment_id=e.id,
                excused=bool(e.progression_excused),
                excuse_reason=e.progression_excuse_reason if e.progression_excused else None,
            )

        d.issues.extend(course_issue.values())
        d.reasons = [i.message for i in d.issues if not i.excused]

        if d.reasons:
            d.outcome = "repeat"
        elif s.year_of_study == YearOfStudy.FIRST:
            d.outcome = "promote"
        else:
            d.outcome = "complete"

    order = {"promote": 0, "complete": 1, "repeat": 2, "skip": 3}
    decisions.sort(key=lambda d: (order[d.outcome], d.full_name.casefold()))
    return YearProgression(
        year_id=year.id, term_names=[t.name for t in terms], decisions=decisions
    )


def _records_for(
    db: Session, year_id: uuid.UUID, student_ids: list[uuid.UUID]
) -> dict[uuid.UUID, StudentYearRecord]:
    if not student_ids:
        return {}
    return {
        r.student_id: r
        for r in db.scalars(
            select(StudentYearRecord).where(
                StudentYearRecord.academic_year_id == year_id,
                StudentYearRecord.student_id.in_(student_ids),
            )
        ).all()
    }


_RESULT_FOR = {
    "promote": ProgressionStanding.PROMOTED,
    "complete": ProgressionStanding.COMPLETED,
    "repeat": ProgressionStanding.REPEATING,
}


def apply_progression(
    db: Session, *, actor: User, year: AcademicYear
) -> tuple[YearProgression, list[dict]]:
    """Apply `evaluate_year` to the student records. Does NOT commit — the caller (the
    year archive) owns the transaction.

    Returns the evaluation and a list of per-student `before` states, which the archive
    stores on its audit row so `revert_progression` can undo exactly these changes.
    """
    result = evaluate_year(db, year)
    changed = [d for d in result.decisions if d.outcome != "skip"]
    if not changed:
        return result, []

    students = {
        s.id: s
        for s in db.scalars(
            select(StudentProfile).where(StudentProfile.id.in_([d.student_id for d in changed]))
        ).all()
    }
    records = _records_for(db, year.id, list(students))
    now = datetime.now(tz=timezone.utc)
    undo: list[dict] = []
    for d in changed:
        s = students[d.student_id]
        rec = records.get(s.id)
        undo.append(
            {
                "student_id": str(s.id),
                "outcome": d.outcome,
                "year_of_study": s.year_of_study.value if s.year_of_study else None,
                "status": s.status.value,
                "completion_date": s.completion_date.isoformat() if s.completion_date else None,
                # The row existed before (a Dean exception made it early): keep it on undo.
                "record_existed": rec is not None,
            }
        )
        # The year's record: the level held DURING the year, and how it ended. Written
        # before the profile moves on, so it keeps the "then" value.
        if rec is None:
            rec = StudentYearRecord(student_id=s.id, academic_year_id=year.id)
            db.add(rec)
        rec.year_of_study = s.year_of_study
        rec.result = _RESULT_FOR[d.outcome]
        rec.decided_at = now
        rec.updated_by = actor.id
        if d.outcome == "promote":
            s.year_of_study = YearOfStudy.SECOND
        elif d.outcome == "complete":
            # Same stamping rule as `change_student_status`: only when empty. The date is
            # the year's end — what the completion is ABOUT — not the day someone archived.
            s.status = StudentStatus.COMPLETED
            if s.completion_date is None:
                s.completion_date = year.end_date
        s.updated_by = actor.id
        db.add(
            AuditLog(
                actor_user_id=actor.id,
                action="student.progression",
                entity_type="student_profile",
                entity_id=s.id,
                summary={
                    "academic_year": year.name,
                    "outcome": d.outcome,
                    "year_of_study_before": undo[-1]["year_of_study"],
                    "year_of_study_after": s.year_of_study.value if s.year_of_study else None,
                    "reasons": d.reasons,
                    # The Dean's exceptions that let this outcome through, on the record.
                    "excused": [
                        {"issue": i.message, "reason": i.excuse_reason}
                        for i in d.issues
                        if i.excused
                    ],
                },
            )
        )
    return result, undo


def revert_progression(db: Session, *, year: AcademicYear, undo: list[dict]) -> int:
    """Undo `apply_progression` for `year` (used by `reactivate_academic_year`).

    A student is restored only while this year's record still holds a result: if the
    Registrar has since changed the record, that later truth is kept. The year's record
    loses its result (or is deleted, if this run created it). Returns the number of
    students restored.
    """
    restored = 0
    ids = []
    for u in undo:
        try:
            ids.append(uuid.UUID(str(u.get("student_id"))))
        except ValueError:
            continue
    if not ids:
        return 0
    students = {
        s.id: s
        for s in db.scalars(select(StudentProfile).where(StudentProfile.id.in_(ids))).all()
    }
    records = _records_for(db, year.id, ids)
    for u in undo:
        try:
            s = students.get(uuid.UUID(str(u.get("student_id"))))
        except ValueError:
            continue
        rec = records.get(s.id) if s is not None else None
        if s is None or rec is None or rec.result is None:
            continue
        # The record must still say what this run set. A Completed student the Registrar
        # has since moved to Graduated is NOT dragged back to Active, and their year
        # keeps its result.
        if u.get("outcome") == "complete" and s.status != StudentStatus.COMPLETED:
            continue
        if u.get("outcome") == "promote" and s.year_of_study != YearOfStudy.SECOND:
            continue
        # The year's record goes back to "not decided". A row a Dean exception created
        # early is kept (the exception still stands); one this run created is removed.
        if u.get("record_existed") or rec.missing_terms_excused:
            rec.result = None
            rec.decided_at = None
        else:
            db.delete(rec)
        yos = u.get("year_of_study")
        s.year_of_study = YearOfStudy(yos) if yos else None
        s.status = StudentStatus(u["status"])
        cd = u.get("completion_date")
        s.completion_date = date.fromisoformat(cd) if cd else None
        restored += 1
    return restored


# ──────────────────────────────────────────────────────────────────────────────
# Dean exceptions
# ──────────────────────────────────────────────────────────────────────────────
def _open_year_or_error(db: Session, year_id: uuid.UUID) -> AcademicYear:
    from app.common.enums import AcademicYearStatus
    from app.core.errors import Conflict, NotFound

    year = db.get(AcademicYear, year_id)
    if year is None:
        raise NotFound("Academic year not found.", code="not_found")
    if year.status == AcademicYearStatus.ARCHIVED:
        # Progression was already applied at archive; an exception now would change
        # nothing. Reactivate the year to revisit it.
        raise Conflict(
            "This academic year is archived. Reactivate it to change exceptions.",
            code="year_archived",
        )
    return year


def set_student_excuse(
    db: Session,
    *,
    actor: User,
    year_id: uuid.UUID,
    student_id: uuid.UUID,
    excused: bool,
    reason: str | None,
) -> None:
    """Excuse (or un-excuse) the sessions a student did not take in `year`.

    Stored on the student's record for THAT year (`student_year_records`), so an
    exception given for 2025-26 never carries into 2026-27.
    """
    from app.core.errors import NotFound

    year = _open_year_or_error(db, year_id)
    s = db.get(StudentProfile, student_id)
    if s is None or s.deleted_at is not None:
        raise NotFound("Student not found.", code="not_found")

    rec = _records_for(db, year.id, [s.id]).get(s.id)
    before = {
        "excused": bool(rec and rec.missing_terms_excused),
        "reason": rec.excuse_reason if rec else None,
    }
    after_reason: str | None = None
    if excused:
        if rec is None:
            rec = StudentYearRecord(
                student_id=s.id, academic_year_id=year.id, year_of_study=s.year_of_study
            )
            db.add(rec)
        rec.missing_terms_excused = True
        rec.excuse_reason = after_reason = (reason or "").strip()[:255]
        rec.updated_by = actor.id
    elif rec is not None:
        if rec.result is None:
            db.delete(rec)  # it existed only to hold the exception
        else:
            rec.missing_terms_excused = False
            rec.excuse_reason = None
            rec.updated_by = actor.id
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="student.progression_excuse",
            entity_type="student_profile",
            entity_id=s.id,
            summary={
                "academic_year": year.name,
                "scope": "missing_sessions",
                "before": before,
                "after": {"excused": excused, "reason": after_reason},
            },
        )
    )
    db.commit()


def set_enrollment_excuse(
    db: Session,
    *,
    actor: User,
    year_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    excused: bool,
    reason: str | None,
) -> None:
    """Excuse (or un-excuse) one course enrolment from blocking progression.

    Changes NOTHING about the grade, the GPA or the transcript: a failed course stays
    failed there. It only answers "may this student still move up a year?".

    Object-level check: the enrolment must belong to one of `year`'s sessions, so a
    year id in the URL cannot be used to touch another year's record.
    """
    from app.core.errors import NotFound

    year = _open_year_or_error(db, year_id)
    enr = db.get(ClassEnrollment, enrollment_id)
    if enr is None:
        raise NotFound("Enrollment not found.", code="not_found")
    term = db.get(Semester, enr.semester_id)
    if term is None or term.academic_year_id != year.id:
        raise NotFound("Enrollment not found in this academic year.", code="not_found")

    before = {"excused": bool(enr.progression_excused), "reason": enr.progression_excuse_reason}
    enr.progression_excused = excused
    enr.progression_excuse_reason = (reason or "").strip()[:255] if excused else None
    enr.updated_by = actor.id
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="student.progression_excuse",
            entity_type="student_profile",
            entity_id=enr.student_id,
            summary={
                "academic_year": year.name,
                "scope": "course",
                "enrollment_id": str(enr.id),
                "offering_id": str(enr.offering_id),
                "term": term.name,
                "before": before,
                "after": {"excused": excused, "reason": enr.progression_excuse_reason},
            },
        )
    )
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# Reading: a student's level AS IT WAS in a given year
# ──────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class YearLevel:
    #: The level held during the year, when the year has been decided. None = use the
    #: student's CURRENT `year_of_study` (the year is still running, or predates records).
    year_of_study: YearOfStudy | None
    #: How the year ended (Promoted / Repeating / Completed); None while undecided.
    result: ProgressionStanding | None
    #: Sitting this level again: the student's previous decided year ended in Repeating.
    repeating: bool


def levels_in_year(
    db: Session, student_ids: list[uuid.UUID], year_id: uuid.UUID | None
) -> dict[uuid.UUID, YearLevel]:
    """What the year switcher should show for each student in `year_id` (one query).

    `year_id` None = no year context: `repeating` then follows the student's latest
    decided year.
    """
    if not student_ids:
        return {}
    rows = db.execute(
        select(StudentYearRecord, AcademicYear.start_date)
        .join(AcademicYear, AcademicYear.id == StudentYearRecord.academic_year_id)
        .where(StudentYearRecord.student_id.in_(student_ids))
    ).all()
    year_start = (
        db.scalar(select(AcademicYear.start_date).where(AcademicYear.id == year_id))
        if year_id is not None
        else None
    )
    by_student: dict[uuid.UUID, list[tuple[StudentYearRecord, date]]] = {}
    for rec, start in rows:
        by_student.setdefault(rec.student_id, []).append((rec, start))

    out: dict[uuid.UUID, YearLevel] = {}
    for sid, recs in by_student.items():
        own = next((r for r, _ in recs if r.academic_year_id == year_id), None)
        earlier = [
            (r, start)
            for r, start in recs
            if r.result is not None
            and r.academic_year_id != year_id
            and (year_start is None or start < year_start)
        ]
        prev = max(earlier, key=lambda x: x[1])[0] if earlier else None
        decided = own is not None and own.result is not None
        out[sid] = YearLevel(
            year_of_study=own.year_of_study if decided else None,
            result=own.result if decided else None,
            repeating=bool(prev and prev.result == ProgressionStanding.REPEATING),
        )
    return out

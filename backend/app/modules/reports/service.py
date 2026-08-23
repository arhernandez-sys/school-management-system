"""Reports service (api-spec §5 Module 10, FR-RPT-*, FR-TRN-*, schema §10.4/§10.6).

Owns the printed documents: the student picker, report cards, the multi-year
transcript, and three aggregate reports.

**Live vs frozen (schema §10.4).** An active year computes on read; an **archived**
year reads `term_grade_snapshots` and reports `is_frozen=true`. That is the whole
point of the freeze — a later grading-scale or policy edit must not retroactively
change a document a parent already received.

**The report-card release rule is per-OFFERING, not per-assessment** (AC 5.5). For a
student viewing their own card, a subject with ANY unreleased graded assessment shows
as `status="pending"` with no numeric, rather than a partial average. An official
document should not print a half-finished grade. Staff always see the computed value.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from math import ceil

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.common.enums import (
    EnrollmentStatus,
    AcademicYearStatus,
    AssessmentStatus,
    ReportCardKind,
    Role,
    StudentStatus,
)
from app.core.errors import Forbidden, NotFound
from app.core.pagination import PageParams
from app.core.timeutil import ensure_aware, utcnow
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.attendance.models import AttendanceRecord
from app.modules.attendance.service import _summarize
from app.modules.programs.queries import enrollment_by_programme
from app.modules.offerings.queries import offerings_in_year, year_id_of_offering, year_of_offering
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.grades import calc
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.reports.models import ReportCardSnapshot
from app.modules.reports.schemas import (
    AttendanceReport,
    AttendanceReportSummary,
    OfferingGradesDistributionItem,
    OfferingGradesReport,
    OfferingGradesStudentRow,
    EnrollmentByOffering,
    EnrollmentByProgramme,
    EnrollmentReport,
    EnrollmentTotals,
    ReportAcademicYearRef,
    ReportAttendanceSummary,
    ReportCard,
    ReportCardSubjectRow,
    ReportSchool,
    ReportSemesterRef,
    ReportStudentRef,
    ReportSubjectRef,
    StudentPickerPage,
    Transcript,
    TranscriptSemester,
    TranscriptSubjectRow,
    TranscriptYear,
)
from app.modules.programs.models import Program
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    GradingScale,
    GradingScaleBand,
    SchoolProfile,
    Semester,
)
from app.modules.settings.service import _logo_url_for
from app.modules.students.models import STUDENT_NAME_ORDER, StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User

_CENTS = Decimal("0.01")


def _dec(value) -> Decimal | None:  # noqa: ANN001
    if value is None:
        return None
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _f(value) -> float | None:  # noqa: ANN001
    return None if value is None else float(value)


def _mean(values: list[Decimal]) -> Decimal | None:
    """Average of the supplied term grades, 2dp HALF_UP. `None` for an empty list.

    Note this is a **simple mean of subject term grades**, not a re-weighting of the
    underlying assessments — a report card's headline figure is the average of the
    subject rows printed beneath it, so the two always reconcile visually.
    """
    if not values:
        return None
    total = sum(values, start=Decimal(0))
    return (total / Decimal(len(values))).quantize(_CENTS, rounding=ROUND_HALF_UP)


# ──────────────────────────────────────────────────────────────────────────────
# Shared refs
# ──────────────────────────────────────────────────────────────────────────────
def _school(db: Session) -> ReportSchool:
    profile = db.scalar(select(SchoolProfile).where(SchoolProfile.id == 1))
    if profile is None:
        return ReportSchool(name="School")
    return ReportSchool(
        name=profile.name,
        address=profile.address,
        # The printed documents use short names; the ORM columns are contact_*.
        phone=profile.contact_phone,
        email=profile.contact_email,
        logo_url=_logo_url_for(profile.logo_storage_key),
    )


def _semester_ref(db: Session, semester: Semester) -> ReportSemesterRef:
    year_name = db.scalar(
        select(AcademicYear.name).where(AcademicYear.id == semester.academic_year_id)
    )
    return ReportSemesterRef(
        id=semester.id,
        name=semester.name,
        sequence=semester.sequence,
        academic_year_id=semester.academic_year_id,
        academic_year_name=year_name or "",
    )


#: `coursestatus` -> the notation a transcript prints for it (D35).
#:
#: Standard registry shorthand, and the reason the column is worth recording at all: an
#: audit and a withdrawal produce NO GRADE, so before D35 the transcript's
#: `if r.numeric is None: continue` filter dropped them entirely. A permanent record that
#: silently omits the course a student withdrew from is not a transcript — the notation IS
#: the information.
TRANSCRIPT_NOTATION: dict[EnrollmentStatus, str] = {
    EnrollmentStatus.AUDIT: "AU",
    EnrollmentStatus.WITHDRAW_PASSING: "W/P",
    EnrollmentStatus.WITHDRAW_FAILING: "W/F",
}

#: Statuses whose credits leave the term GPA **entirely** — see
#: `students/academics.py::_GPA_DROPPED`, which this mirrors.
#:
#: `withdraw_failing` is absent on purpose: BAJC decided (2026-08-23) that a W/F counts as
#: a fail, so it keeps its credits in the denominator and scores zero quality points.
GPA_DROPPED = frozenset({EnrollmentStatus.AUDIT, EnrollmentStatus.WITHDRAW_PASSING})


def _enrollment_status_map(
    db: Session, student_id: uuid.UUID, semester_id: uuid.UUID | None
) -> dict[uuid.UUID, EnrollmentStatus]:
    """`{offering_id: how the student sat it}` for one term (D35).

    A separate read rather than a change to `_classes_for`, which returns
    `CourseOffering` rows and is shared with the report card — threading the status through
    it would have changed a signature two callers depend on to serve one of them.
    """
    if semester_id is None:
        return {}
    return {
        offering_id: status
        for offering_id, status in db.execute(
            select(ClassEnrollment.offering_id, ClassEnrollment.enrollment_status).where(
                ClassEnrollment.student_id == student_id,
                ClassEnrollment.semester_id == semester_id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
        ).all()
    }


def _classes_for(
    db: Session, student_id: uuid.UUID, semester_id: uuid.UUID | None
) -> list[CourseOffering]:
    """Every subject class the student sat in for a given term (D29).

    Was `_section_for`, which returned one homeroom — a report card built from it
    would have printed a single subject for a sixth-former taking four.

    Falls back to their whole enrollment history when no term is given, so a card
    requested without a semester still lists something rather than nothing.
    """
    if semester_id is not None:
        rows = list(
            db.scalars(
                select(CourseOffering)
                .join(ClassEnrollment, ClassEnrollment.offering_id == CourseOffering.id)
                .join(Course, CourseOffering.course_id == Course.id)
                .where(
                    ClassEnrollment.student_id == student_id,
                    ClassEnrollment.semester_id == semester_id,
                    ClassEnrollment.unenrolled_at.is_(None),
                    CourseOffering.deleted_at.is_(None),
                )
                .order_by(*OFFERING_ORDER)
            ).all()
        )
        if rows:
            return _dedupe_classes(rows)
    return _dedupe_classes(
        list(
            db.scalars(
                select(CourseOffering)
                .join(ClassEnrollment, ClassEnrollment.offering_id == CourseOffering.id)
                .join(Course, CourseOffering.course_id == Course.id)
                .where(
                    ClassEnrollment.student_id == student_id,
                    CourseOffering.deleted_at.is_(None),
                )
                .order_by(*OFFERING_ORDER)
            ).all()
        )
    )


def _dedupe_classes(rows: list[CourseOffering]) -> list[CourseOffering]:
    """Same class enrolled across both semesters yields two rows; keep one."""
    seen: dict[uuid.UUID, CourseOffering] = {}
    for cls in rows:
        seen.setdefault(cls.id, cls)
    return list(seen.values())


def _student_ref(db: Session, student: StudentProfile) -> ReportStudentRef:
    return ReportStudentRef(
        id=student.id,
        full_name=student.full_name,
        student_number=student.student_number,
        date_of_birth=student.date_of_birth,
        status=student.status.value if hasattr(student.status, "value") else student.status,
        # Same defensive read as `status` above: the column is enum-typed in the ORM but
        # comes back as a plain `str` on some load paths.
        year_of_study=(
            student.year_of_study.value
            if hasattr(student.year_of_study, "value")
            else student.year_of_study
        ),
    )


def _bands(db: Session, year_id: uuid.UUID | None) -> tuple[list[calc.BandInput], Decimal | None]:
    if year_id is None:
        return [], None
    scale = db.scalar(select(GradingScale).where(GradingScale.academic_year_id == year_id))
    if scale is None:
        active = db.scalar(
            select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        if active is not None:
            scale = db.scalar(
                select(GradingScale).where(GradingScale.academic_year_id == active.id)
            )
    if scale is None:
        return [], None
    rows = db.scalars(
        select(GradingScaleBand).where(GradingScaleBand.grading_scale_id == scale.id)
    ).all()
    return (
        [
            calc.BandInput(
                letter=b.letter,
                min_score=_dec(b.min_score),
                is_passing=b.is_passing,
                # D30 §D5 — without this the GPA on every report card and transcript
                # would be weightless, because `calc.grade_point_for` would answer
                # None for every letter. NULL on an archived year's frozen scale.
                grade_point=_dec(b.grade_point),
            )
            for b in rows
        ],
        _dec(scale.pass_mark),
    )


def _school_policy(db: Session) -> AssessmentPolicy | None:
    return db.scalar(select(AssessmentPolicy).where(AssessmentPolicy.id == 1))


def _lead_teacher_names(db: Session, cs_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Lead teacher per offering, falling back to any assigned teacher."""
    if not cs_ids:
        return {}
    rows = db.execute(
        select(ClassTeacher.offering_id, TeacherProfile.full_name, ClassTeacher.is_lead)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.offering_id.in_(cs_ids))
    ).all()
    out: dict[uuid.UUID, str] = {}
    for cs_id, name, is_lead in sorted(rows, key=lambda r: (not r[2], r[1])):
        out.setdefault(cs_id, name)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Term-grade assembly (the core shared by report card, transcript, class grades)
# ──────────────────────────────────────────────────────────────────────────────
class _SubjectResult:
    """One computed subject row before it is shaped for a specific document.

    `credits` (D30 §D5) is the course's credit weight, and it is carried HERE rather
    than resolved per document because this class is the single supplier of per-subject
    figures to the report card, the transcript, the class-grades report AND the
    archival freeze. A GPA computed from credits fetched somewhere else would be a
    second implementation of the rule.
    """

    __slots__ = ("cs_id", "subject_id", "subject_name", "subject_code", "credits",
                 "numeric", "letter", "fully_released")

    def __init__(self, cs_id, subject_id, subject_name, subject_code, credits, numeric, letter, fully_released):  # noqa: ANN001
        self.cs_id = cs_id
        self.subject_id = subject_id
        self.subject_name = subject_name
        self.subject_code = subject_code
        self.credits = credits
        self.numeric = numeric
        self.letter = letter
        self.fully_released = fully_released


def _subject_results(
    db: Session,
    *,
    student_id: uuid.UUID,
    sections: list[CourseOffering],
    semester: Semester,
    year: AcademicYear | None,
    frozen: bool,
) -> list[_SubjectResult]:
    """Per-subject term grades for (student, their classes, semester).

    D29: `sections` is every subject class the student sits, so a report card lists
    one row per subject the student actually takes.

    `frozen` → read `term_grade_snapshots`; otherwise compute from live grades.
    Sorted by subject name, which is the order the documents print.
    """
    if not sections:
        return []

    offerings = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            CourseOffering.id.in_([s.id for s in sections]),
            CourseOffering.deleted_at.is_(None),
        )
    ).all()
    if not offerings:
        return []

    # Bands come from the SEMESTER's year, not a class's. Every class on one card
    # belongs to that term by construction, and it removes the need to pick one class
    # to be authoritative over the others.
    bands, _pass_mark = _bands(db, semester.academic_year_id)

    if frozen:
        snapshots = {
            s.offering_id: s
            for s in db.scalars(
                select(TermGradeSnapshot).where(
                    TermGradeSnapshot.student_id == student_id,
                    TermGradeSnapshot.semester_id == semester.id,
                )
            ).all()
        }
        results = []
        for cs, subject in offerings:
            snap = snapshots.get(cs.id)
            if snap is None:
                continue
            results.append(
                _SubjectResult(
                    cs.id, subject.id, subject.name, subject.code or "",
                    # Credits come from the SNAPSHOT, falling back to the live course
                    # only for rows frozen before D30 Phase 3 (which have NULL). A
                    # later credit edit must not move an issued report card — that is
                    # the whole point of freezing them (schema §10.4).
                    snap.credits if snap.credits is not None else subject.credits,
                    _dec(snap.numeric_grade), snap.letter_grade,
                    # A frozen figure is final; release state no longer gates it.
                    True,
                )
            )
        results.sort(key=lambda r: r.subject_name)
        return results

    cs_ids = [cs.id for cs, _ in offerings]
    assessments = list(
        db.scalars(
            select(Assessment).where(
                Assessment.offering_id.in_(cs_ids),
                Assessment.semester_id == semester.id,
                Assessment.deleted_at.is_(None),
            )
        ).all()
    )
    by_cs: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in assessments:
        by_cs[a.offering_id].append(a)

    my_grades: dict[uuid.UUID, AssessmentGrade] = {}
    if assessments:
        my_grades = {
            g.assessment_id: g
            for g in db.scalars(
                select(AssessmentGrade).where(
                    AssessmentGrade.assessment_id.in_([a.id for a in assessments]),
                    AssessmentGrade.student_id == student_id,
                )
            ).all()
        }

    categories = list(
        db.scalars(
            select(AssessmentCategory).where(AssessmentCategory.offering_id.in_(cs_ids))
        ).all()
    )
    cats_by_cs: dict[uuid.UUID, list[AssessmentCategory]] = defaultdict(list)
    for c in categories:
        cats_by_cs[c.offering_id].append(c)
    cats_by_id = {c.id: c for c in categories}
    school = _school_policy(db)

    def resolved_drop(category: AssessmentCategory | None) -> int:
        for candidate in (
            category.drop_lowest_count if category else None,
            year.drop_lowest_count if year else None,
            school.drop_lowest_count if school else None,
        ):
            if candidate is not None:
                return max(0, int(candidate))
        return 0

    def release_state(a: Assessment) -> bool:
        g = my_grades.get(a.id)
        return a.is_released if g is None or g.is_released is None else g.is_released

    requests: dict[object, calc.TermGradeRequest] = {}
    released_flags: dict[uuid.UUID, bool] = {}
    for cs, _subject in offerings:
        items = by_cs.get(cs.id, [])
        graded_lifecycle = [a for a in items if a.status == AssessmentStatus.GRADED]
        # Per-OFFERING release rule: every graded assessment must be released.
        released_flags[cs.id] = all(release_state(a) for a in graded_lifecycle)
        requests[cs.id] = calc.TermGradeRequest(
            grades=[
                calc.GradeInput(
                    assessment_id=a.id,
                    max_score=_dec(a.max_score) or Decimal(0),
                    weight=_dec(a.weight) or Decimal(0),
                    assessment_status=a.status,
                    policy=calc.resolve_policy(
                        a, cats_by_id.get(a.category_id) if a.category_id else None, year, school
                    ),
                    category_id=a.category_id,
                    grade_status=my_grades[a.id].status if a.id in my_grades else None,
                    score=_dec(my_grades[a.id].score) if a.id in my_grades else None,
                    makeup_score=(
                        _dec(my_grades[a.id].makeup_score) if a.id in my_grades else None
                    ),
                    is_released=release_state(a),
                )
                for a in items
            ],
            categories=[
                calc.CategoryInput(
                    id=c.id,
                    weight=_dec(c.weight) or Decimal(0),
                    drop_lowest_count=resolved_drop(c),
                )
                for c in cats_by_cs.get(cs.id, [])
            ],
            uncategorized_drop_lowest=resolved_drop(None),
            bands=bands,
        )

    computed = calc.compute_term_grades_bulk(requests)
    results = [
        _SubjectResult(
            cs.id, subject.id, subject.name, subject.code or "", subject.credits,
            computed[cs.id].numeric, computed[cs.id].letter, released_flags[cs.id],
        )
        for cs, subject in offerings
    ]
    results.sort(key=lambda r: r.subject_name)
    return results


def _gpa_entries(
    results: list[_SubjectResult],
    bands: list[calc.BandInput],
    *,
    exclude_cs_ids: set[uuid.UUID] | None = None,
) -> list[calc.GpaEntry]:
    """Turn computed subject rows into `calc.GpaEntry` rows (D30 §D5).

    The only assembly step; the arithmetic itself is `calc.compute_gpa` and is never
    reimplemented here (plan §C: never duplicate grade logic into a service).

    **Every enrolled row is included**, graded or not (decision #4). A row with no
    letter, or one whose letter the scale cannot price, resolves to
    `grade_point=None` → 0 quality points with its credits still counted. That is
    exactly what makes the sample report card print 2.1 instead of 3.50.

    `exclude_cs_ids` is for the student-facing card: a subject held back as `pending`
    must not leak its grade through the GPA, so it is scored as ungraded rather than
    dropped — dropping it would shrink the denominator and let the student solve for
    the hidden mark.
    """
    excluded = exclude_cs_ids or set()
    return [
        calc.GpaEntry(
            credits=_dec(r.credits) or Decimal(0),
            grade_point=(
                None if r.cs_id in excluded else calc.grade_point_for(r.letter, bands)
            ),
        )
        for r in results
    ]


def _period_for(semester: Semester) -> str:
    """The BAJC report card's `Period` label (D30 §D13).

    `"<Term>, <Mon YYYY> - <Mon YYYY>"`, reproducing the sample's
    `Summer, July 2026 - August 2026`. Built from the term's own dates rather than the
    academic year's, because BAJC's Summer block legitimately falls outside its year
    (see the Phase 2B note on why terms are not date-validated against their year).
    """
    start = semester.start_date.strftime("%B %Y")
    end = semester.end_date.strftime("%B %Y")
    return f"{semester.name}, {start} - {end}"


def _program_code_for(db: Session, student: StudentProfile) -> str | None:
    """The student's programme CODE, e.g. `BMAD`, or `None` when unassigned.

    Every `student_profiles.program_id` is NULL today — assigning a student to a
    programme needs `student_program_history` so a change never destroys history, and
    that is Phase 4 §D12. The lookup is wired now so the label fills itself in the
    moment Phase 4 lands, rather than the printed document silently omitting a field.
    """
    if student.program_id is None:
        return None
    return db.scalar(select(Program.code).where(Program.id == student.program_id))


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/students
# ──────────────────────────────────────────────────────────────────────────────
def list_students(
    db: Session, *, params: PageParams, search: str | None, status: str | None
) -> StudentPickerPage:
    """The report picker. A thin projection, deliberately separate from
    `/students` so the print screens don't inherit that endpoint's scoping rules."""
    stmt = select(StudentProfile).where(StudentProfile.deleted_at.is_(None))
    if status:
        stmt = stmt.where(StudentProfile.status == status)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                StudentProfile.full_name.ilike(like),
                StudentProfile.student_number.ilike(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.scalars(
            stmt.order_by(*STUDENT_NAME_ORDER)
            .limit(params.page_size)
            .offset((params.page - 1) * params.page_size)
        ).all()
    )
    return StudentPickerPage(
        items=[_student_ref(db, s) for s in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
        total_pages=ceil(total / params.page_size) if params.page_size else 0,
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/report-card  +  /report-card/me
# ──────────────────────────────────────────────────────────────────────────────
def _resolve_semester(db: Session, semester_id: uuid.UUID | None) -> Semester:
    if semester_id is not None:
        semester = db.get(Semester, semester_id)
        if semester is None:
            # No silent fallback to the active term: that would hide a client bug,
            # and the frontend only ever sends ids from /settings/semesters.
            raise NotFound("Semester not found.", code="semester_not_found")
        return semester
    active = db.scalar(select(Semester).where(Semester.is_active.is_(True)))
    if active is None:
        raise NotFound("No active academic term.", code="no_active_semester")
    return active


def _build_report_card(
    db: Session, *, student: StudentProfile, semester: Semester, release_filter: bool
) -> ReportCard:
    sections = _classes_for(db, student.id, semester.id)
    # The TERM already names its year — `year_of_offering` takes an OFFERING, and passing
    # a `Semester` to it was a mechanical D31 substitution that typechecks and then reads
    # `.semester_id` off the wrong object at runtime.
    year = db.get(AcademicYear, semester.academic_year_id)
    frozen = year is not None and year.archived_at is not None
    bands, _pass_mark = _bands(db, semester.academic_year_id)

    subjects: list[ReportCardSubjectRow] = []
    graded_numerics: list[Decimal] = []
    gpa = calc.compute_gpa(())

    if sections:
        results = _subject_results(
            db, student_id=student.id, sections=sections, semester=semester,
            year=year, frozen=frozen,
        )
        teachers = _lead_teacher_names(db, [r.cs_id for r in results])
        withheld: set[uuid.UUID] = set()
        for r in results:
            # AC 5.5 — a student's card shows `pending` for a subject that still has
            # unreleased graded work, rather than printing a partial average.
            pending = release_filter and not r.fully_released
            if pending:
                withheld.add(r.cs_id)
            subjects.append(
                ReportCardSubjectRow(
                    subject=ReportSubjectRef(
                        id=r.subject_id, name=r.subject_name, code=r.subject_code
                    ),
                    teacher=teachers.get(r.cs_id),
                    credits=r.credits,
                    numeric=None if pending else _f(r.numeric),
                    letter=None if pending else r.letter,
                    status="pending" if pending else "graded",
                )
            )
            if not pending and r.numeric is not None:
                graded_numerics.append(r.numeric)

        # Over EVERY enrolled row, ungraded and withheld included (decision #4).
        gpa = calc.compute_gpa(_gpa_entries(results, bands, exclude_cs_ids=withheld))

    term_average = _mean(graded_numerics)

    # Attendance is student+semester scoped, never class-scoped, so it already spans
    # every subject class the student sits and needed no change under D29. The guard
    # is dropped with it: a student with no classes can still have a register.
    statuses = list(
        db.scalars(
            select(AttendanceRecord.status).where(
                AttendanceRecord.student_id == student.id,
                AttendanceRecord.semester_id == semester.id,
            )
        ).all()
    )
    counts = _summarize(statuses)

    return ReportCard(
        student=_student_ref(db, student),
        # Same defensive read as `status` above: the column is enum-typed in the ORM but
        # comes back as a plain `str` on some load paths.
        year_of_study=(
            student.year_of_study.value
            if hasattr(student.year_of_study, "value")
            else student.year_of_study
        ),
        semester=_semester_ref(db, semester),
        school=_school(db),
        program_code=_program_code_for(db, student),
        period=_period_for(semester),
        # `block` is deliberately left at its None default — plan §G item 3.
        subjects=subjects,
        attendance_summary=ReportAttendanceSummary(
            pct_present=counts.pct_present,
            absent=counts.absent,
            late=counts.late,
            excused=counts.excused,
        ),
        term_average=_f(term_average),
        term_average_letter=calc.letter_for(term_average, bands) if term_average is not None else None,
        gpa=_f(gpa.gpa),
        total_credits=int(gpa.total_credits),
        is_frozen=frozen,
    )


def _midterm_report_card(
    db: Session, *, actor: User, student: StudentProfile, semester: Semester
) -> ReportCard:
    """A MID-TERM report card — read back VERBATIM from `report_card_snapshots` (D32, §5).

    **This never recalculates, and that is the whole feature.** The stored payload is the
    card exactly as it stood when the mid-term window closed. Rebuilding it from current
    grades would fold in post-midterm work and silently move a figure a parent has already
    been shown, which is the behaviour the client asked to eliminate.

    This is also the FIRST READER `report_card_snapshots` has ever had. Before D32 the
    table was written by the year-archive freeze and never read: archived cards were
    rebuilt from `term_grade_snapshots` instead, so the one genuinely frozen artefact was
    discarded on every read.

    **The lazy freeze.** If the window has closed and no snapshot exists, one is captured
    here and then read. The backend has no scheduler (`app/jobs/purge.py` says so
    explicitly), so the alternative is a report that fails until the Dean remembers to
    press a button. `freeze_midterm` is idempotent, so two concurrent first-reads converge
    rather than duplicating.

    Before the window closes there is nothing to serve and nothing honest to invent:
    `freeze_midterm` raises 409 `midterm_window_open`, or 422 `no_midterm_window` for a
    term with no mid-term period at all.
    """

    def _load() -> ReportCardSnapshot | None:
        return db.scalar(
            select(ReportCardSnapshot).where(
                ReportCardSnapshot.student_id == student.id,
                ReportCardSnapshot.semester_id == semester.id,
                ReportCardSnapshot.kind == ReportCardKind.MIDTERM,
            )
        )

    row = _load()
    if row is None:
        # Imported here, not at module scope: `reports.freeze` imports this module for
        # `_build_report_card`, so a top-level import either way round would be circular
        # — the same reason `settings.service` imports the freeze lazily.
        from app.modules.reports.freeze import freeze_midterm

        # Raises 409/422 when the window is open or unconfigured, so the caller gets a
        # reason rather than an empty card.
        freeze_midterm(db, actor=actor, semester=semester)
        db.commit()
        row = _load()
    if row is None:
        # The freeze ran but wrote nothing for this student: they hold no live enrolment
        # in the term. 404 is honest; an empty card would read as "no marks earned".
        raise NotFound(
            "No mid-term report card exists for this student in that term.",
            code="no_midterm_snapshot",
        )

    # `model_validate` rather than trusting the dict: a payload may have been written by
    # an older build of this schema, and validating on the way out gives a field added
    # since then its default instead of letting it arrive missing.
    card = ReportCard.model_validate(row.payload)
    card.is_frozen = True
    card.report_kind = ReportCardKind.MIDTERM
    card.frozen_at = ensure_aware(row.frozen_at)
    return card


def get_report_card(
    db: Session,
    *,
    actor: User,
    student_id: uuid.UUID,
    semester_id: uuid.UUID | None,
    kind: ReportCardKind = ReportCardKind.ENDTERM,
) -> ReportCard:
    """GET /reports/report-card (P/S/Teacher). Staff see computed values.

    D32: `kind=midterm` reads the frozen snapshot instead. `endterm` is unchanged — live
    years compute on read, archived ones read `term_grade_snapshots` (§10.4).
    """
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None:
        raise NotFound("Student not found.", code="not_found")
    semester = _resolve_semester(db, semester_id)
    if kind == ReportCardKind.MIDTERM:
        return _midterm_report_card(db, actor=actor, student=student, semester=semester)
    return _build_report_card(
        db, student=student, semester=semester, release_filter=False
    )


def get_my_report_card(
    db: Session,
    *,
    actor: User,
    semester_id: uuid.UUID | None,
    kind: ReportCardKind = ReportCardKind.ENDTERM,
) -> ReportCard:
    """GET /reports/report-card/me (student).

    Currently unreachable from the UI — `PERMISSION_MATRIX.reports` is `'none'` for
    students — but mandated by api-spec §5.10 / FR-RPT-05, and `ReportCardScreen`
    already has the code path, so it is built and tested.
    """
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == actor.id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None:
        raise NotFound("Student profile not found.", code="not_found")
    semester = _resolve_semester(db, semester_id)
    if kind == ReportCardKind.MIDTERM:
        # NOTE the absence of a release filter on this branch, unlike the end-term one
        # below. A frozen card is a document that has already been issued; re-applying
        # "hide subjects with unreleased work" to it would blank rows the student has
        # already been shown, because release state has moved on since the freeze.
        return _midterm_report_card(db, actor=actor, student=student, semester=semester)
    return _build_report_card(db, student=student, semester=semester, release_filter=True)


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/transcript
# ──────────────────────────────────────────────────────────────────────────────
def get_transcript(db: Session, *, actor: User, student_id: uuid.UUID) -> Transcript:
    """GET /reports/transcript — **principal/secretary only** (D26).

    Assembles every year the student has an enrollment in, newest year first:
    archived years from frozen snapshots, the live year computed on read (schema
    §10.6). Semesters with no grades are dropped unless they are the current term.
    """
    if actor.role not in (Role.PRINCIPAL, Role.SECRETARY):
        raise Forbidden("Transcripts are restricted to administrators.", code="forbidden")

    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None:
        raise NotFound("Student not found.", code="not_found")

    active_semester = db.scalar(select(Semester).where(Semester.is_active.is_(True)))

    # Only years this student was actually enrolled in.
    year_ids = list(
        db.scalars(
            select(Semester.academic_year_id)
            .join(ClassEnrollment, ClassEnrollment.semester_id == Semester.id)
            .where(ClassEnrollment.student_id == student.id)
            .distinct()
        ).all()
    )
    years_rows = (
        list(
            db.scalars(
                select(AcademicYear)
                .where(AcademicYear.id.in_(year_ids))
                .order_by(AcademicYear.start_date.desc())
            ).all()
        )
        if year_ids
        else []
    )

    out_years: list[TranscriptYear] = []
    all_term_averages: list[Decimal] = []
    # GPA entries accumulate at every level and each level's figure is computed from
    # its OWN credits (D30 §D5). Averaging the level below would weight a 6-credit
    # summer block equally with an 18-credit semester.
    all_gpa_entries: list[calc.GpaEntry] = []

    for year in years_rows:
        frozen = year.archived_at is not None
        bands, _pass_mark = _bands(db, year.id)
        semesters = list(
            db.scalars(
                select(Semester)
                .where(Semester.academic_year_id == year.id)
                .order_by(Semester.sequence.asc())
            ).all()
        )
        out_semesters: list[TranscriptSemester] = []
        year_term_averages: list[Decimal] = []
        year_gpa_entries: list[calc.GpaEntry] = []

        for semester in semesters:
            sections = _classes_for(db, student.id, semester.id)
            rows: list[TranscriptSubjectRow] = []
            numerics: list[Decimal] = []
            term_gpa_entries: list[calc.GpaEntry] = []
            if sections:
                results = _subject_results(
                    db, student_id=student.id, sections=sections, semester=semester,
                    year=year, frozen=frozen,
                )
                teachers = _lead_teacher_names(db, [r.cs_id for r in results])
                # D35 — how the student sat each of them (the client's `coursestatus`).
                how = _enrollment_status_map(db, student.id, semester.id)
                notated = {
                    r.cs_id
                    for r in results
                    if how.get(r.cs_id) in TRANSCRIPT_NOTATION
                }
                # BEFORE the filter below: the transcript LISTS only graded lines, but
                # the GPA denominator is every enrolled credit (decision #4). Building
                # these from `rows` would silently drop the ungraded courses and print
                # a graded-only mean.
                #
                # Two DIFFERENT exclusions, and conflating them was a real bug in D35's
                # first cut. `_gpa_entries(exclude_cs_ids=...)` sets `grade_point=None` but
                # KEEPS THE CREDITS — it was built so a withheld `pending` row cannot
                # shrink the denominator and let a student solve for the hidden mark. That
                # is "scored as ungraded", which is:
                #
                #   * exactly right for `withdraw_failing` — a W/F counts as a fail (BAJC,
                #     2026-08-23), so its credits belong in the denominator at zero;
                #   * exactly WRONG for `audit` / `withdraw_passing`, whose credits must
                #     leave the fraction altogether. Those have to be filtered OUT of the
                #     list, not passed as an exclusion.
                dropped = {r.cs_id for r in results if how.get(r.cs_id) in GPA_DROPPED}
                scored_zero = {
                    r.cs_id
                    for r in results
                    if how.get(r.cs_id) is EnrollmentStatus.WITHDRAW_FAILING
                }
                term_gpa_entries = _gpa_entries(
                    [r for r in results if r.cs_id not in dropped],
                    bands,
                    exclude_cs_ids=scored_zero,
                )
                for r in results:
                    notation = TRANSCRIPT_NOTATION.get(how.get(r.cs_id))
                    if notation is not None:
                        # An audit or a withdrawal has NO grade, so it would have been
                        # dropped by the filter below. It is printed with its notation and
                        # no numeric — and left out of `numerics`, so it does not move the
                        # term average either.
                        rows.append(
                            TranscriptSubjectRow(
                                subject=ReportSubjectRef(
                                    id=r.subject_id,
                                    name=r.subject_name,
                                    code=r.subject_code,
                                ),
                                teacher=teachers.get(r.cs_id),
                                credits=r.credits,
                                numeric=None,
                                letter="",
                                notation=notation,
                            )
                        )
                        continue
                    # A transcript lists only lines that resolved to a grade.
                    if r.numeric is None:
                        continue
                    rows.append(
                        TranscriptSubjectRow(
                            subject=ReportSubjectRef(
                                id=r.subject_id, name=r.subject_name, code=r.subject_code
                            ),
                            teacher=teachers.get(r.cs_id),
                            credits=r.credits,
                            numeric=_f(r.numeric),
                            letter=r.letter or "",
                        )
                    )
                    numerics.append(r.numeric)

            is_current = (
                active_semester is not None
                and semester.id == active_semester.id
                and year.status == AcademicYearStatus.ACTIVE
            )
            if not rows and not is_current:
                continue

            term_average = _mean(numerics)
            if term_average is not None:
                year_term_averages.append(term_average)

            # A term contributes credits to the year and cumulative GPA only once at
            # least ONE of its courses has resolved to a grade.
            #
            # This is not a softening of decision #4 — within a term that has started
            # being marked, every enrolled credit still counts and the ungraded ones
            # still earn nothing. It excludes only the term where NOTHING is marked yet,
            # and it has to, for two reasons:
            #
            #   * The transcript keeps the CURRENT term even with no rows (`is_current`
            #     below), so an in-progress term would otherwise halve a cumulative GPA
            #     the moment a student registered for it — before a single mark existed.
            #   * `_classes_for` falls back to the student's whole enrolment history when
            #     they have no enrolment in the requested term, so a term they never sat
            #     can return their courses and hand over phantom credits.
            #
            # Unlike the report card, which prints every row it counted, a cumulative GPA
            # cannot be checked against the page — so an unexplainable denominator there
            # is a defect rather than a curiosity. The report card keeps 0.00 for a fully
            # unmarked term, where the breakdown is visible.
            term_gpa = calc.compute_gpa(term_gpa_entries) if rows else calc.compute_gpa(())
            if rows:
                year_gpa_entries.extend(term_gpa_entries)
            out_semesters.append(
                TranscriptSemester(
                    semester=_semester_ref(db, semester),
                    is_current=is_current,
                    term_average=_f(term_average),
                    gpa=_f(term_gpa.gpa),
                    total_credits=int(term_gpa.total_credits),
                    subjects=rows,
                )
            )

        if not out_semesters:
            continue
        all_term_averages.extend(year_term_averages)
        all_gpa_entries.extend(year_gpa_entries)
        year_gpa = calc.compute_gpa(year_gpa_entries)
        out_years.append(
            TranscriptYear(
                academic_year=ReportAcademicYearRef(
                    id=year.id,
                    name=year.name,
                    status=year.status.value if hasattr(year.status, "value") else year.status,
                ),
                year_average=_f(_mean(year_term_averages)),
                gpa=_f(year_gpa.gpa),
                total_credits=int(year_gpa.total_credits),
                semesters=out_semesters,
            )
        )

    cumulative = calc.compute_gpa(all_gpa_entries)
    return Transcript(
        student=_student_ref(db, student),
        school=_school(db),
        issued_at=utcnow(),
        years=out_years,
        cumulative_average=_f(_mean(all_term_averages)),
        cumulative_gpa=_f(cumulative.gpa),
        total_credits=int(cumulative.total_credits),
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/offering-grades
# ──────────────────────────────────────────────────────────────────────────────
def get_offering_grades(
    db: Session, *, actor: User, offering_id: uuid.UUID, semester_id: uuid.UUID | None
) -> OfferingGradesReport:
    """Per-offering grade summary + letter distribution.

    No frontend screen calls this today (FR-RPT-02 is served by the real gradebook);
    built per api-spec §5.10 as a print-friendly aggregate.
    """
    cs = db.scalar(
        select(CourseOffering).where(
            CourseOffering.id == offering_id, CourseOffering.deleted_at.is_(None)
        )
    )
    if cs is None:
        raise NotFound("Offering not found.", code="not_found")
    section = cs  # D31: the offering IS the section
    subject = db.get(Course, cs.course_id)
    if subject is None:  # pragma: no cover - the FK guarantees this
        raise NotFound("Offering not found.", code="not_found")

    semester = _resolve_semester(db, semester_id)
    year = year_of_offering(db, section)
    frozen = year is not None and year.archived_at is not None
    bands, _pass_mark = _bands(db, year_id_of_offering(db, section))

    students = list(
        db.scalars(
            select(StudentProfile)
            .join(ClassEnrollment, ClassEnrollment.student_id == StudentProfile.id)
            .where(
                ClassEnrollment.offering_id == section.id,
                ClassEnrollment.semester_id == semester.id,
                ClassEnrollment.unenrolled_at.is_(None),
                StudentProfile.deleted_at.is_(None),
            )
            .order_by(*STUDENT_NAME_ORDER)
        ).all()
    )

    rows: list[OfferingGradesStudentRow] = []
    numerics: list[Decimal] = []
    for student in students:
        # Scoped to THIS class only — the class-grades report is about one gradebook,
        # not the student's whole load, so it must not fan out to their other classes.
        results = _subject_results(
            db, student_id=student.id, sections=[section], semester=semester,
            year=year, frozen=frozen,
        )
        mine = next((r for r in results if r.cs_id == cs.id), None)
        numeric = mine.numeric if mine else None
        rows.append(
            OfferingGradesStudentRow(
                student=_student_ref(db, student),
                numeric=_f(numeric),
                letter=mine.letter if mine else None,
            )
        )
        if numeric is not None:
            numerics.append(numeric)

    tally: dict[str, int] = {b.letter: 0 for b in sorted(
        bands, key=lambda b: -(_dec(b.min_score) or Decimal(0))
    )}
    for row in rows:
        if row.letter in tally:
            tally[row.letter] += 1

    return OfferingGradesReport(
        offering=offering_ref(cs, subject),
        semester=_semester_ref(db, semester),
        students=rows,
        class_average=_f(_mean(numerics)),
        distribution=[
            OfferingGradesDistributionItem(letter=letter, count=count)
            for letter, count in tally.items()
        ],
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/attendance
# ──────────────────────────────────────────────────────────────────────────────
def get_attendance_report(
    db: Session, *, actor: User, section_id: uuid.UUID
) -> AttendanceReport:
    """Per-section attendance summary. No frontend caller (FR-RPT-03 is served by
    `/attendance/summary`); built per api-spec §5.10 for a print view."""
    section = db.scalar(
        select(CourseOffering).where(CourseOffering.id == section_id, CourseOffering.deleted_at.is_(None))
    )
    if section is None:
        raise NotFound("Section not found.", code="not_found")

    statuses = list(
        db.scalars(
            select(AttendanceRecord.status).where(AttendanceRecord.offering_id == section.id)
        ).all()
    )
    counts = _summarize(statuses)
    active = db.scalar(
        select(Semester).where(
            Semester.academic_year_id == year_id_of_offering(db, section),
            Semester.is_active.is_(True),
        )
    )

    course = db.get(Course, section.course_id)
    return AttendanceReport(
        offering=offering_ref(section, course),
        semester=_semester_ref(db, active) if active else None,
        summary=AttendanceReportSummary(
            present=counts.present,
            absent=counts.absent,
            late=counts.late,
            excused=counts.excused,
            pct_present=counts.pct_present,
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/enrollment
# ──────────────────────────────────────────────────────────────────────────────
def get_enrollment_report(db: Session, *, actor: User) -> EnrollmentReport:
    """Headcount by programme and by offering. **P/S only.**

    No frontend caller (FR-RPT-04 is served by the principal dashboard); built per
    api-spec §5.10.
    """
    if actor.role not in (Role.PRINCIPAL, Role.SECRETARY):
        raise Forbidden(
            "Enrollment reports are restricted to administrators.", code="forbidden"
        )

    year = db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )
    if year is None:
        return EnrollmentReport(totals=EnrollmentTotals())

    semester = db.scalar(
        select(Semester).where(
            Semester.academic_year_id == year.id, Semester.is_active.is_(True)
        )
    )
    sections = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            offerings_in_year(year.id),
            CourseOffering.deleted_at.is_(None),
            CourseOffering.is_archived.is_(False),
        )
        .order_by(*OFFERING_ORDER)
    ).all()

    counts: dict[uuid.UUID, int] = {}
    if semester is not None:
        counts = dict(
            db.execute(
                select(ClassEnrollment.offering_id, func.count(func.distinct(ClassEnrollment.student_id)))
                .where(
                    ClassEnrollment.semester_id == semester.id,
                    ClassEnrollment.unenrolled_at.is_(None),
                )
                .group_by(ClassEnrollment.offering_id)
            ).all()
        )

    total_students = db.scalar(
        select(func.count())
        .select_from(StudentProfile)
        .where(
            StudentProfile.deleted_at.is_(None),
            StudentProfile.status == StudentStatus.REGISTERED,
        )
    ) or 0

    return EnrollmentReport(
        totals=EnrollmentTotals(students=total_students, offerings=len(sections)),
        # Programme, not Form. `classes.grade_level` is gone with the homeroom, and the
        # same query backs the principal dashboard tile so the two cannot disagree.
        by_programme=[
            EnrollmentByProgramme(programme=row.name, count=row.count)
            for row in enrollment_by_programme(db, year)
        ],
        by_offering=[
            EnrollmentByOffering(
                offering=offering_ref(o, c),
                enrolled=counts.get(o.id, 0),
                capacity=o.capacity,
            )
            for o, c in sections
        ],
    )

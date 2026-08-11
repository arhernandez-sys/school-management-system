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

from app.common.enums import AcademicYearStatus, AssessmentStatus, Role, StudentStatus
from app.core.errors import Forbidden, NotFound
from app.core.pagination import PageParams
from app.core.timeutil import utcnow
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.attendance.models import AttendanceRecord
from app.modules.attendance.service import _summarize
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.grades import calc
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot
from app.modules.reports.schemas import (
    AttendanceReport,
    AttendanceReportSummary,
    ClassGradesClassSubjectRef,
    ClassGradesDistributionItem,
    ClassGradesReport,
    ClassGradesStudentRow,
    EnrollmentByClass,
    EnrollmentByGrade,
    EnrollmentReport,
    EnrollmentTotals,
    ReportAcademicYearRef,
    ReportAttendanceSummary,
    ReportCard,
    ReportCardSubjectRow,
    ReportSchool,
    ReportSectionRef,
    ReportSemesterRef,
    ReportStudentRef,
    ReportSubjectRef,
    StudentPickerPage,
    Transcript,
    TranscriptSemester,
    TranscriptSubjectRow,
    TranscriptYear,
)
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    GradingScale,
    GradingScaleBand,
    SchoolProfile,
    Semester,
)
from app.modules.settings.service import _logo_url_for
from app.modules.students.models import StudentProfile
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


def _classes_for(
    db: Session, student_id: uuid.UUID, semester_id: uuid.UUID | None
) -> list[Class]:
    """Every subject class the student sat in for a given term (D29).

    Was `_section_for`, which returned one homeroom — a report card built from it
    would have printed a single subject for a sixth-former taking four.

    Falls back to their whole enrollment history when no term is given, so a card
    requested without a semester still lists something rather than nothing.
    """
    if semester_id is not None:
        rows = list(
            db.scalars(
                select(Class)
                .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
                .where(
                    ClassEnrollment.student_id == student_id,
                    ClassEnrollment.semester_id == semester_id,
                    ClassEnrollment.unenrolled_at.is_(None),
                    Class.deleted_at.is_(None),
                )
                .order_by(Class.name.asc())
            ).all()
        )
        if rows:
            return _dedupe_classes(rows)
    return _dedupe_classes(
        list(
            db.scalars(
                select(Class)
                .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
                .where(
                    ClassEnrollment.student_id == student_id,
                    Class.deleted_at.is_(None),
                )
                .order_by(Class.name.asc())
            ).all()
        )
    )


def _dedupe_classes(rows: list[Class]) -> list[Class]:
    """Same class enrolled across both semesters yields two rows; keep one."""
    seen: dict[uuid.UUID, Class] = {}
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
        year_group=student.year_group,
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
            calc.BandInput(letter=b.letter, min_score=_dec(b.min_score), is_passing=b.is_passing)
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
        select(ClassTeacher.class_subject_id, TeacherProfile.full_name, ClassTeacher.is_lead)
        .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
        .where(ClassTeacher.class_subject_id.in_(cs_ids))
    ).all()
    out: dict[uuid.UUID, str] = {}
    for cs_id, name, is_lead in sorted(rows, key=lambda r: (not r[2], r[1])):
        out.setdefault(cs_id, name)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Term-grade assembly (the core shared by report card, transcript, class grades)
# ──────────────────────────────────────────────────────────────────────────────
class _SubjectResult:
    """One computed subject row before it is shaped for a specific document."""

    __slots__ = ("cs_id", "subject_id", "subject_name", "subject_code", "numeric",
                 "letter", "fully_released")

    def __init__(self, cs_id, subject_id, subject_name, subject_code, numeric, letter, fully_released):  # noqa: ANN001
        self.cs_id = cs_id
        self.subject_id = subject_id
        self.subject_name = subject_name
        self.subject_code = subject_code
        self.numeric = numeric
        self.letter = letter
        self.fully_released = fully_released


def _subject_results(
    db: Session,
    *,
    student_id: uuid.UUID,
    sections: list[Class],
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
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(
            ClassSubject.class_id.in_([s.id for s in sections]),
            ClassSubject.deleted_at.is_(None),
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
            s.class_subject_id: s
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
                Assessment.class_subject_id.in_(cs_ids),
                Assessment.semester_id == semester.id,
                Assessment.deleted_at.is_(None),
            )
        ).all()
    )
    by_cs: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in assessments:
        by_cs[a.class_subject_id].append(a)

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
            select(AssessmentCategory).where(AssessmentCategory.class_subject_id.in_(cs_ids))
        ).all()
    )
    cats_by_cs: dict[uuid.UUID, list[AssessmentCategory]] = defaultdict(list)
    for c in categories:
        cats_by_cs[c.class_subject_id].append(c)
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
            cs.id, subject.id, subject.name, subject.code or "",
            computed[cs.id].numeric, computed[cs.id].letter, released_flags[cs.id],
        )
        for cs, subject in offerings
    ]
    results.sort(key=lambda r: r.subject_name)
    return results


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
            stmt.order_by(StudentProfile.full_name.asc())
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
    year = db.get(AcademicYear, semester.academic_year_id)
    frozen = year is not None and year.archived_at is not None
    bands, _pass_mark = _bands(db, semester.academic_year_id)

    subjects: list[ReportCardSubjectRow] = []
    graded_numerics: list[Decimal] = []

    if sections:
        results = _subject_results(
            db, student_id=student.id, sections=sections, semester=semester,
            year=year, frozen=frozen,
        )
        teachers = _lead_teacher_names(db, [r.cs_id for r in results])
        for r in results:
            # AC 5.5 — a student's card shows `pending` for a subject that still has
            # unreleased graded work, rather than printing a partial average.
            pending = release_filter and not r.fully_released
            subjects.append(
                ReportCardSubjectRow(
                    subject=ReportSubjectRef(
                        id=r.subject_id, name=r.subject_name, code=r.subject_code
                    ),
                    teacher=teachers.get(r.cs_id),
                    numeric=None if pending else _f(r.numeric),
                    letter=None if pending else r.letter,
                    status="pending" if pending else "graded",
                )
            )
            if not pending and r.numeric is not None:
                graded_numerics.append(r.numeric)

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
        year_group=student.year_group,
        semester=_semester_ref(db, semester),
        school=_school(db),
        subjects=subjects,
        attendance_summary=ReportAttendanceSummary(
            pct_present=counts.pct_present,
            absent=counts.absent,
            late=counts.late,
            excused=counts.excused,
        ),
        term_average=_f(term_average),
        term_average_letter=calc.letter_for(term_average, bands) if term_average is not None else None,
        is_frozen=frozen,
    )


def get_report_card(
    db: Session, *, actor: User, student_id: uuid.UUID, semester_id: uuid.UUID | None
) -> ReportCard:
    """GET /reports/report-card (P/S/Teacher). Staff see computed values."""
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None:
        raise NotFound("Student not found.", code="not_found")
    semester = _resolve_semester(db, semester_id)
    return _build_report_card(
        db, student=student, semester=semester, release_filter=False
    )


def get_my_report_card(
    db: Session, *, actor: User, semester_id: uuid.UUID | None
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

    for year in years_rows:
        frozen = year.archived_at is not None
        semesters = list(
            db.scalars(
                select(Semester)
                .where(Semester.academic_year_id == year.id)
                .order_by(Semester.sequence.asc())
            ).all()
        )
        out_semesters: list[TranscriptSemester] = []
        year_term_averages: list[Decimal] = []

        for semester in semesters:
            sections = _classes_for(db, student.id, semester.id)
            rows: list[TranscriptSubjectRow] = []
            numerics: list[Decimal] = []
            if sections:
                results = _subject_results(
                    db, student_id=student.id, sections=sections, semester=semester,
                    year=year, frozen=frozen,
                )
                teachers = _lead_teacher_names(db, [r.cs_id for r in results])
                for r in results:
                    # A transcript lists only lines that resolved to a grade.
                    if r.numeric is None:
                        continue
                    rows.append(
                        TranscriptSubjectRow(
                            subject=ReportSubjectRef(
                                id=r.subject_id, name=r.subject_name, code=r.subject_code
                            ),
                            teacher=teachers.get(r.cs_id),
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
            out_semesters.append(
                TranscriptSemester(
                    semester=_semester_ref(db, semester),
                    is_current=is_current,
                    term_average=_f(term_average),
                    subjects=rows,
                )
            )

        if not out_semesters:
            continue
        all_term_averages.extend(year_term_averages)
        out_years.append(
            TranscriptYear(
                academic_year=ReportAcademicYearRef(
                    id=year.id,
                    name=year.name,
                    status=year.status.value if hasattr(year.status, "value") else year.status,
                ),
                year_average=_f(_mean(year_term_averages)),
                semesters=out_semesters,
            )
        )

    return Transcript(
        student=_student_ref(db, student),
        school=_school(db),
        issued_at=utcnow(),
        years=out_years,
        cumulative_average=_f(_mean(all_term_averages)),
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /reports/class-grades
# ──────────────────────────────────────────────────────────────────────────────
def get_class_grades(
    db: Session, *, actor: User, class_subject_id: uuid.UUID, semester_id: uuid.UUID | None
) -> ClassGradesReport:
    """Per-offering grade summary + letter distribution.

    No frontend screen calls this today (FR-RPT-02 is served by the real gradebook);
    built per api-spec §5.10 as a print-friendly aggregate.
    """
    cs = db.scalar(
        select(ClassSubject).where(
            ClassSubject.id == class_subject_id, ClassSubject.deleted_at.is_(None)
        )
    )
    if cs is None:
        raise NotFound("Class subject not found.", code="not_found")
    section = db.get(Class, cs.class_id)
    subject = db.get(Subject, cs.subject_id)
    if section is None or subject is None:  # pragma: no cover - FK guarantees these
        raise NotFound("Class subject not found.", code="not_found")

    semester = _resolve_semester(db, semester_id)
    year = db.get(AcademicYear, section.academic_year_id)
    frozen = year is not None and year.archived_at is not None
    bands, _pass_mark = _bands(db, section.academic_year_id)

    students = list(
        db.scalars(
            select(StudentProfile)
            .join(ClassEnrollment, ClassEnrollment.student_id == StudentProfile.id)
            .where(
                ClassEnrollment.class_id == section.id,
                ClassEnrollment.semester_id == semester.id,
                ClassEnrollment.unenrolled_at.is_(None),
                StudentProfile.deleted_at.is_(None),
            )
            .order_by(StudentProfile.full_name.asc())
        ).all()
    )

    rows: list[ClassGradesStudentRow] = []
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
            ClassGradesStudentRow(
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

    return ClassGradesReport(
        class_subject=ClassGradesClassSubjectRef(
            id=cs.id,
            section_id=section.id,
            section_name=section.name,
            subject_name=subject.name,
        ),
        semester=_semester_ref(db, semester),
        students=rows,
        class_average=_f(_mean(numerics)),
        distribution=[
            ClassGradesDistributionItem(letter=letter, count=count)
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
        select(Class).where(Class.id == section_id, Class.deleted_at.is_(None))
    )
    if section is None:
        raise NotFound("Section not found.", code="not_found")

    statuses = list(
        db.scalars(
            select(AttendanceRecord.status).where(AttendanceRecord.class_id == section.id)
        ).all()
    )
    counts = _summarize(statuses)
    active = db.scalar(
        select(Semester).where(
            Semester.academic_year_id == section.academic_year_id,
            Semester.is_active.is_(True),
        )
    )

    return AttendanceReport(
        section=ReportSectionRef(
            id=section.id, name=section.name, grade_level=section.grade_level
        ),
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
    """Headcount by grade and by section. **P/S only.**

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
    sections = list(
        db.scalars(
            select(Class)
            .where(
                Class.academic_year_id == year.id,
                Class.deleted_at.is_(None),
                Class.is_archived.is_(False),
            )
            .order_by(Class.name.asc())
        ).all()
    )

    counts: dict[uuid.UUID, int] = {}
    if semester is not None:
        counts = dict(
            db.execute(
                select(ClassEnrollment.class_id, func.count(func.distinct(ClassEnrollment.student_id)))
                .where(
                    ClassEnrollment.semester_id == semester.id,
                    ClassEnrollment.unenrolled_at.is_(None),
                )
                .group_by(ClassEnrollment.class_id)
            ).all()
        )

    by_grade: dict[str, int] = defaultdict(int)
    for section in sections:
        by_grade[section.grade_level] += counts.get(section.id, 0)

    total_students = db.scalar(
        select(func.count())
        .select_from(StudentProfile)
        .where(
            StudentProfile.deleted_at.is_(None),
            StudentProfile.status == StudentStatus.ACTIVE,
        )
    ) or 0

    return EnrollmentReport(
        totals=EnrollmentTotals(students=total_students, classes=len(sections)),
        by_grade=[
            EnrollmentByGrade(grade_level=grade, count=count)
            for grade, count in sorted(by_grade.items())
        ],
        by_class=[
            EnrollmentByClass(
                class_ref=ReportSectionRef(
                    id=s.id, name=s.name, grade_level=s.grade_level
                ),
                enrolled=counts.get(s.id, 0),
                capacity=s.capacity,
            )
            for s in sections
        ],
    )

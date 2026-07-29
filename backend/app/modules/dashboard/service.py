"""Dashboard service (api-spec §5 Module 2, FR-DASH-*).

One composite read per role. Shapes are driven by what the four finished screens
actually render (`AdminDashboard`, `SecretaryDashboard`, `TeacherDashboard`,
`StudentDashboard`), not by the api-spec's sketch.

**N+1 budget.** Each variant is a bounded set of aggregate queries — counts via
`func.count`, list cards via one `LIMIT`ed query each, and the grade distribution via
a single batched load piped through `calc.compute_term_grades_bulk`. Nothing here
loops a query per student or per section; the principal variant is the one that could
plausibly regress, so its comment marks the batch boundary.

Where the MSW mock fabricates data, this derives it honestly instead — see
`_enrollment_trend` and `_new_students_term`. Two mock behaviours are deliberately
NOT copied because they leak unreleased work to students; both are noted at the site.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import (
    AcademicYearStatus,
    AssessmentStatus,
    GradeStatus,
    Role,
    StudentStatus,
    TeacherStatus,
)
from app.core.errors import Conflict
from app.core.rbac import teacher_section_ids
from app.core.timeutil import school_today
from app.modules.announcements import service as announcements_service
from app.modules.announcements.models import Announcement, AnnouncementRead
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.assessments.release_nudge import graded_unreleased_clause
from app.modules.attendance.models import AttendanceRecord
from app.modules.attendance.service import _summarize
from app.modules.classes.models import (
    Class,
    ClassEnrollment,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.dashboard.schemas import (
    AdminDashboard,
    AdminStats,
    DashboardAnnouncement,
    DashboardPerson,
    DashboardResponse,
    EnrollmentByGradeItem,
    EnrollmentTrendItem,
    GradeDistributionItem,
    PersonStatus,
    SecretaryDashboard,
    SecretaryEnrollmentItem,
    SecretaryStats,
    StudentClassItem,
    StudentDashboard,
    StudentGradeItem,
    StudentStats,
    StudentUpcomingItem,
    TeacherAssessmentItem,
    TeacherAwaitingReleaseItem,
    TeacherDashboard,
    TeacherStats,
    TeacherTodayClass,
)
from app.modules.grades import calc
from app.modules.grades.models import AssessmentGrade
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    GradingScale,
    GradingScaleBand,
    Semester,
)
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User

#: How many rows each "recent …" card shows. Matches the finished screens.
_CARD_LIMIT = 6
_ANNOUNCEMENT_LIMIT = 5
_TEACHER_ANNOUNCEMENT_LIMIT = 4
_TREND_TERMS = 6


def _dec(value) -> Decimal | None:  # noqa: ANN001
    if value is None:
        return None
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _f(value) -> float | None:  # noqa: ANN001
    return None if value is None else float(value)


# ──────────────────────────────────────────────────────────────────────────────
# Shared header + announcements
# ──────────────────────────────────────────────────────────────────────────────
def _active_year(db: Session) -> AcademicYear | None:
    return db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


def _active_semester(db: Session) -> Semester | None:
    return db.scalar(select(Semester).where(Semester.is_active.is_(True)))


def _recent_announcements(
    db: Session, actor: User, limit: int
) -> list[DashboardAnnouncement]:
    """The caller's targeted feed, reusing the announcements module's visibility rule.

    Importing `_visible_clause` rather than re-deriving targeting keeps the dashboard
    honest: the stakeholder rules (admins don't see teacher notices, a class notice
    reaches its class) apply here automatically and cannot drift out of sync.
    """
    rows = list(
        db.scalars(
            select(Announcement)
            .where(announcements_service._visible_clause(db, actor))
            .order_by(Announcement.published_at.desc(), Announcement.id.desc())
            .limit(limit)
        ).all()
    )
    read_ids: set[uuid.UUID] = set()
    if rows:
        read_ids = set(
            db.scalars(
                select(AnnouncementRead.announcement_id).where(
                    AnnouncementRead.user_id == actor.id,
                    AnnouncementRead.announcement_id.in_([r.id for r in rows]),
                )
            ).all()
        )
    return [
        DashboardAnnouncement(
            id=r.id,
            title=r.title,
            body=r.body,
            audience=r.audience,
            published_at=r.published_at,
            is_read=r.id in read_ids,
        )
        for r in rows
    ]


def _unread_count(db: Session, actor: User) -> int:
    return announcements_service.unread_count(db, actor=actor).unread_count


def _bands(db: Session, year: AcademicYear | None) -> tuple[list[calc.BandInput], Decimal | None]:
    if year is None:
        return [], None
    scale = db.scalar(
        select(GradingScale).where(GradingScale.academic_year_id == year.id)
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


# ──────────────────────────────────────────────────────────────────────────────
# Principal
# ──────────────────────────────────────────────────────────────────────────────
def _enrollment_by_grade(db: Session, year: AcademicYear) -> list[EnrollmentByGradeItem]:
    rows = db.execute(
        select(Class.grade_level, func.count(func.distinct(ClassEnrollment.student_id)))
        .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
        .where(
            Class.academic_year_id == year.id,
            Class.deleted_at.is_(None),
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .group_by(Class.grade_level)
        .order_by(Class.grade_level.asc())
    ).all()
    return [EnrollmentByGradeItem(grade_level=g, count=c) for g, c in rows]


def _new_students_term(db: Session, year: AcademicYear) -> int:
    """Students whose enrollment date falls inside this academic year.

    The mock proxies this as "the Form 1 cohort", which hardcodes a grade label and
    breaks the moment a school renames its entry grade. `enrollment_date` is the
    data-driven answer to "new to the school this year".
    """
    return db.scalar(
        select(func.count())
        .select_from(StudentProfile)
        .where(
            StudentProfile.deleted_at.is_(None),
            StudentProfile.enrollment_date >= year.start_date,
            StudentProfile.enrollment_date <= year.end_date,
        )
    ) or 0


def _enrollment_trend(db: Session, year: AcademicYear) -> list[EnrollmentTrendItem]:
    """Active enrollment per term over the last few semesters.

    The mock fabricates six synthetic points anchored to the live count. This derives
    real ones from `class_enrollments` grouped by semester. The field is optional in
    the frontend type and the chart accepts fewer than six points, so a young school
    with two terms of history renders correctly rather than showing invented growth.
    """
    rows = db.execute(
        select(
            Semester.id,
            Semester.name,
            AcademicYear.name,
            Semester.start_date,
            func.count(func.distinct(ClassEnrollment.student_id)),
        )
        .join(AcademicYear, Semester.academic_year_id == AcademicYear.id)
        .outerjoin(
            ClassEnrollment,
            (ClassEnrollment.semester_id == Semester.id)
            & (ClassEnrollment.unenrolled_at.is_(None)),
        )
        .where(Semester.start_date <= year.end_date)
        .group_by(Semester.id, Semester.name, AcademicYear.name, Semester.start_date)
        .order_by(Semester.start_date.desc())
        .limit(_TREND_TERMS)
    ).all()
    # Query descends so LIMIT keeps the most recent terms; the chart reads ascending.
    return [
        EnrollmentTrendItem(period=f"{sem_name} {year_name}", count=count)
        for _sid, sem_name, year_name, _start, count in reversed(rows)
    ]


def _grade_distribution(
    db: Session, year: AcademicYear, semester: Semester
) -> list[GradeDistributionItem]:
    """Letter-grade histogram across the whole active term.

    This is the one figure that could become O(students × subjects). It loads every
    assessment, category and grade for the term in **three** queries, then computes
    entirely in memory via `compute_term_grades_bulk`.
    """
    bands, _pass_mark = _bands(db, year)
    if not bands:
        return []

    offerings = db.execute(
        select(ClassSubject.id, ClassSubject.class_id)
        .join(Class, ClassSubject.class_id == Class.id)
        .where(
            Class.academic_year_id == year.id,
            Class.deleted_at.is_(None),
            ClassSubject.deleted_at.is_(None),
        )
    ).all()
    if not offerings:
        return []
    cs_ids = [cs_id for cs_id, _ in offerings]

    assessments = list(
        db.scalars(
            select(Assessment).where(
                Assessment.class_subject_id.in_(cs_ids),
                Assessment.semester_id == semester.id,
                Assessment.deleted_at.is_(None),
            )
        ).all()
    )
    if not assessments:
        return []
    by_cs: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in assessments:
        by_cs[a.class_subject_id].append(a)

    categories = list(
        db.scalars(
            select(AssessmentCategory).where(AssessmentCategory.class_subject_id.in_(cs_ids))
        ).all()
    )
    cats_by_cs: dict[uuid.UUID, list[AssessmentCategory]] = defaultdict(list)
    for c in categories:
        cats_by_cs[c.class_subject_id].append(c)
    cats_by_id = {c.id: c for c in categories}

    grades = list(
        db.scalars(
            select(AssessmentGrade).where(
                AssessmentGrade.assessment_id.in_([a.id for a in assessments])
            )
        ).all()
    )
    grades_by_student_cs: dict[
        tuple[uuid.UUID, uuid.UUID], dict[uuid.UUID, AssessmentGrade]
    ] = defaultdict(dict)
    assessment_cs = {a.id: a.class_subject_id for a in assessments}
    for g in grades:
        cs_id = assessment_cs.get(g.assessment_id)
        if cs_id is not None:
            grades_by_student_cs[(g.student_id, cs_id)][g.assessment_id] = g

    school = _school_policy(db)
    requests: dict[object, calc.TermGradeRequest] = {}
    for (student_id, cs_id), student_grades in grades_by_student_cs.items():
        cat_rows = cats_by_cs.get(cs_id, [])
        cat_inputs = [
            calc.CategoryInput(
                id=c.id,
                weight=_dec(c.weight) or Decimal(0),
                drop_lowest_count=int(
                    c.drop_lowest_count
                    if c.drop_lowest_count is not None
                    else (year.drop_lowest_count if year.drop_lowest_count is not None
                          else (school.drop_lowest_count if school else 0))
                ),
            )
            for c in cat_rows
        ]
        inputs = [
            calc.GradeInput(
                assessment_id=a.id,
                max_score=_dec(a.max_score) or Decimal(0),
                weight=_dec(a.weight) or Decimal(0),
                assessment_status=a.status,
                policy=calc.resolve_policy(
                    a, cats_by_id.get(a.category_id) if a.category_id else None, year, school
                ),
                category_id=a.category_id,
                grade_status=(
                    student_grades[a.id].status if a.id in student_grades else None
                ),
                score=_dec(student_grades[a.id].score) if a.id in student_grades else None,
                makeup_score=(
                    _dec(student_grades[a.id].makeup_score) if a.id in student_grades else None
                ),
                is_released=True,
            )
            for a in by_cs.get(cs_id, [])
        ]
        requests[(student_id, cs_id)] = calc.TermGradeRequest(
            grades=inputs, categories=cat_inputs, bands=bands
        )

    computed = calc.compute_term_grades_bulk(requests)
    tally: dict[str, int] = defaultdict(int)
    for term in computed.values():
        if term.letter is not None:
            tally[term.letter] += 1

    order = {b.letter: i for i, b in enumerate(sorted(bands, key=lambda b: -(_dec(b.min_score) or Decimal(0))))}
    return [
        GradeDistributionItem(letter=letter, count=count)
        for letter, count in sorted(tally.items(), key=lambda kv: order.get(kv[0], 99))
    ]


def _school_attendance_rate(db: Session, year: AcademicYear) -> float:
    statuses = list(
        db.scalars(
            select(AttendanceRecord.status)
            .join(Class, AttendanceRecord.class_id == Class.id)
            .where(Class.academic_year_id == year.id, Class.deleted_at.is_(None))
        ).all()
    )
    return _summarize(statuses).pct_present


def _admin_payload(db: Session, actor: User, year: AcademicYear, semester: Semester) -> AdminDashboard:
    active_students = db.scalar(
        select(func.count())
        .select_from(StudentProfile)
        .where(
            StudentProfile.deleted_at.is_(None),
            StudentProfile.status == StudentStatus.ACTIVE,
        )
    ) or 0
    active_teachers = db.scalar(
        select(func.count())
        .select_from(TeacherProfile)
        .where(
            TeacherProfile.deleted_at.is_(None),
            TeacherProfile.status == TeacherStatus.ACTIVE,
        )
    ) or 0
    sections = list(
        db.scalars(
            select(Class).where(
                Class.academic_year_id == year.id,
                Class.deleted_at.is_(None),
                Class.is_archived.is_(False),
            )
        ).all()
    )
    total_courses = db.scalar(
        select(func.count())
        .select_from(ClassSubject)
        .join(Class, ClassSubject.class_id == Class.id)
        .where(
            Class.academic_year_id == year.id,
            Class.deleted_at.is_(None),
            ClassSubject.deleted_at.is_(None),
            ClassSubject.is_active.is_(True),
        )
    ) or 0

    recent_teachers = [
        DashboardPerson(
            id=t.id,
            name=t.full_name,
            # Matches the mock's `specializations.join(' · ') || 'General'`.
            # `subject_specializations` is a nullable JSON list.
            secondary=" · ".join(t.subject_specializations or []) or "General",
            status=PersonStatus(label="Active", kind="success"),
        )
        for t in db.scalars(
            select(TeacherProfile)
            .where(
                TeacherProfile.deleted_at.is_(None),
                TeacherProfile.status == TeacherStatus.ACTIVE,
            )
            .order_by(TeacherProfile.full_name.asc())
            .limit(_CARD_LIMIT)
        ).all()
    ]

    section_names = {s.id: s.name for s in sections}
    recent_students = [
        DashboardPerson(
            id=s.id,
            name=s.full_name,
            secondary=section_names.get(cls_id, "—") if cls_id else "—",
            status=PersonStatus(label="Active", kind="success"),
        )
        for s, cls_id in db.execute(
            select(StudentProfile, ClassEnrollment.class_id)
            .outerjoin(
                ClassEnrollment,
                (ClassEnrollment.student_id == StudentProfile.id)
                & (ClassEnrollment.semester_id == semester.id)
                & (ClassEnrollment.unenrolled_at.is_(None)),
            )
            .where(
                StudentProfile.deleted_at.is_(None),
                StudentProfile.status == StudentStatus.ACTIVE,
            )
            .order_by(StudentProfile.full_name.asc())
            .limit(_CARD_LIMIT)
        ).all()
    ]

    return AdminDashboard(
        user_full_name=actor.full_name,
        academic_year_name=year.name,
        semester_name=semester.name,
        stats=AdminStats(
            active_students=active_students,
            active_teachers=active_teachers,
            total_sections=len(sections),
            attendance_rate=_school_attendance_rate(db, year),
            unread_announcements=_unread_count(db, actor),
            new_students_term=_new_students_term(db, year),
            total_courses=total_courses,
            student_capacity=sum(s.capacity or 0 for s in sections),
        ),
        enrollment_by_grade=_enrollment_by_grade(db, year),
        grade_distribution=_grade_distribution(db, year, semester),
        enrollment_trend=_enrollment_trend(db, year),
        recent_teachers=recent_teachers,
        recent_students=recent_students,
        recent_announcements=_recent_announcements(db, actor, _ANNOUNCEMENT_LIMIT),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Secretary
# ──────────────────────────────────────────────────────────────────────────────
def _secretary_payload(
    db: Session, actor: User, year: AcademicYear, semester: Semester
) -> SecretaryDashboard:
    sections = list(
        db.scalars(
            select(Class).where(
                Class.academic_year_id == year.id,
                Class.deleted_at.is_(None),
                Class.is_archived.is_(False),
            )
        ).all()
    )

    # Active offerings with nobody assigned — the clerk's setup queue.
    staffed = select(ClassTeacher.class_subject_id).distinct().subquery()
    unstaffed_subjects = db.scalar(
        select(func.count())
        .select_from(ClassSubject)
        .join(Class, ClassSubject.class_id == Class.id)
        .where(
            Class.academic_year_id == year.id,
            Class.deleted_at.is_(None),
            ClassSubject.deleted_at.is_(None),
            ClassSubject.is_active.is_(True),
            ClassSubject.id.notin_(select(staffed.c.class_subject_id)),
        )
    ) or 0

    roster_counts = dict(
        db.execute(
            select(ClassEnrollment.class_id, func.count())
            .where(
                ClassEnrollment.semester_id == semester.id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
            .group_by(ClassEnrollment.class_id)
        ).all()
    )
    over_capacity_sections = sum(
        1
        for s in sections
        if s.capacity and roster_counts.get(s.id, 0) > s.capacity
    )

    recent_enrollments = [
        SecretaryEnrollmentItem(
            enrollment_id=enr_id,
            student_name=student_name,
            section_name=section_name,
            enrolled_at=enrolled_at,
        )
        for enr_id, student_name, section_name, enrolled_at in db.execute(
            select(
                ClassEnrollment.id,
                StudentProfile.full_name,
                Class.name,
                ClassEnrollment.enrolled_at,
            )
            .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
            .join(Class, ClassEnrollment.class_id == Class.id)
            .where(
                ClassEnrollment.unenrolled_at.is_(None),
                Class.academic_year_id == year.id,
            )
            .order_by(ClassEnrollment.enrolled_at.desc(), ClassEnrollment.id.desc())
            .limit(_CARD_LIMIT)
        ).all()
    ]

    active_students = db.scalar(
        select(func.count())
        .select_from(StudentProfile)
        .where(
            StudentProfile.deleted_at.is_(None),
            StudentProfile.status == StudentStatus.ACTIVE,
        )
    ) or 0
    active_teachers = db.scalar(
        select(func.count())
        .select_from(TeacherProfile)
        .where(
            TeacherProfile.deleted_at.is_(None),
            TeacherProfile.status == TeacherStatus.ACTIVE,
        )
    ) or 0

    return SecretaryDashboard(
        user_full_name=actor.full_name,
        academic_year_name=year.name,
        semester_name=semester.name,
        stats=SecretaryStats(
            active_students=active_students,
            active_teachers=active_teachers,
            total_sections=len(sections),
            unstaffed_subjects=unstaffed_subjects,
            over_capacity_sections=over_capacity_sections,
            unread_announcements=_unread_count(db, actor),
        ),
        recent_enrollments=recent_enrollments,
        recent_announcements=_recent_announcements(db, actor, _ANNOUNCEMENT_LIMIT),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Teacher
# ──────────────────────────────────────────────────────────────────────────────
def _teacher_payload(
    db: Session, actor: User, year: AcademicYear, semester: Semester
) -> TeacherDashboard:
    section_ids = teacher_section_ids(db, actor)

    owned = []
    if section_ids:
        owned = db.execute(
            select(ClassSubject, Class, Subject)
            .join(Class, ClassSubject.class_id == Class.id)
            .join(Subject, ClassSubject.subject_id == Subject.id)
            .join(ClassTeacher, ClassTeacher.class_subject_id == ClassSubject.id)
            .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
            .where(
                TeacherProfile.user_id == actor.id,
                ClassSubject.deleted_at.is_(None),
                Class.deleted_at.is_(None),
                Class.academic_year_id == year.id,
            )
        ).all()

    today = school_today()
    recorded_sections: set[uuid.UUID] = set()
    if section_ids:
        recorded_sections = set(
            db.scalars(
                select(AttendanceRecord.class_id)
                .where(
                    AttendanceRecord.class_id.in_(section_ids),
                    AttendanceRecord.attendance_date == today,
                )
                .distinct()
            ).all()
        )

    # One row per SECTION — attendance is per-section-per-day, so a teacher taking
    # three subjects in one homeroom still marks that register once.
    first_offering_by_section: dict[uuid.UUID, tuple] = {}
    for cs, section, subject in owned:
        first_offering_by_section.setdefault(section.id, (cs, section, subject))

    today_classes = [
        TeacherTodayClass(
            class_subject_id=cs.id,
            section_id=section.id,
            section_name=section.name,
            subject_name=subject.name,
            attendance_recorded=section.id in recorded_sections,
        )
        for cs, section, subject in sorted(
            first_offering_by_section.values(), key=lambda t: t[1].name
        )
    ]

    cs_meta = {cs.id: (section, subject) for cs, section, subject in owned}
    pending_statuses = (AssessmentStatus.PUBLISHED, AssessmentStatus.GRADING)
    pending = []
    if cs_meta:
        pending = list(
            db.scalars(
                select(Assessment).where(
                    Assessment.class_subject_id.in_(list(cs_meta)),
                    Assessment.semester_id == semester.id,
                    Assessment.status.in_(pending_statuses),
                    Assessment.deleted_at.is_(None),
                )
            ).all()
        )
    pending.sort(key=lambda a: (a.assessment_date is None, a.assessment_date, a.title))

    recent_assessments = [
        TeacherAssessmentItem(
            id=a.id,
            title=a.title,
            subject_name=cs_meta[a.class_subject_id][1].name,
            section_name=cs_meta[a.class_subject_id][0].name,
            assessment_date=a.assessment_date,
            status=a.status,
        )
        for a in pending[:_CARD_LIMIT]
    ]

    awaiting = _awaiting_release(db, cs_meta, semester)

    return TeacherDashboard(
        user_full_name=actor.full_name,
        academic_year_name=year.name,
        semester_name=semester.name,
        stats=TeacherStats(
            my_sections=len(first_offering_by_section),
            my_class_subjects=len(owned),
            attendance_due_today=sum(
                1 for c in today_classes if not c.attendance_recorded
            ),
            ungraded_items=len(pending),
            awaiting_release_items=len(awaiting),
        ),
        today_classes=today_classes,
        recent_assessments=recent_assessments,
        awaiting_release=awaiting[:_CARD_LIMIT],
        recent_announcements=_recent_announcements(db, actor, _TEACHER_ANNOUNCEMENT_LIMIT),
    )


def _awaiting_release(
    db: Session,
    cs_meta: dict[uuid.UUID, tuple],
    semester: Semester,
) -> list[TeacherAwaitingReleaseItem]:
    """Assessments the teacher has MARKED but not yet PUBLISHED to students.

    Distinct from `ungraded_items`, which counts assessments still being marked
    (lifecycle `published`/`grading`). This counts assessments carrying at least one
    grade row that is `graded` while its effective release flag is false — work the
    teacher has finished and the student still cannot see. See
    `assessments/release_nudge.graded_unreleased_clause`, which is the single
    definition shared with `POST /assessments/{id}/nudge-release`, so the tile and
    the endpoint's 409 can never disagree.

    **Ownership is not re-derived here.** `cs_meta` is the caller's already-resolved
    set of owned offerings (built in `_teacher_payload` from the same
    `ClassTeacher → TeacherProfile` join the rest of the payload uses), so this adds
    no second ownership query.

    **One query, not one per assessment.** A single `IN (…) + GROUP BY` returns the
    assessment, its display columns and the waiting-student count together, matching
    this module's batched-load budget. Every non-aggregate column is named in the
    GROUP BY rather than relying on functional dependency, which MariaDB's
    ONLY_FULL_GROUP_BY does not infer as reliably as Postgres.

    Scoped to the ACTIVE semester, exactly like `ungraded_items` — the dashboard is a
    view of the current term's outstanding work, not a lifetime backlog.
    """
    if not cs_meta:
        return []

    rows = db.execute(
        select(
            Assessment.id,
            Assessment.class_subject_id,
            Assessment.title,
            Assessment.assessment_date,
            Assessment.status,
            func.count(),
        )
        .join(AssessmentGrade, AssessmentGrade.assessment_id == Assessment.id)
        .where(
            Assessment.class_subject_id.in_(list(cs_meta)),
            Assessment.semester_id == semester.id,
            Assessment.deleted_at.is_(None),
            graded_unreleased_clause(),
        )
        .group_by(
            Assessment.id,
            Assessment.class_subject_id,
            Assessment.title,
            Assessment.assessment_date,
            Assessment.status,
        )
    ).all()

    items = [
        TeacherAwaitingReleaseItem(
            id=a_id,
            title=title,
            subject_name=cs_meta[cs_id][1].name,
            section_name=cs_meta[cs_id][0].name,
            assessment_date=on,
            status=status,
            class_subject_id=cs_id,
            graded_unreleased_count=waiting,
        )
        for a_id, cs_id, title, on, status, waiting in rows
    ]
    # Oldest work first — the longest-hidden result is the most overdue. Portable
    # "NULLs last" ordering, as elsewhere in this codebase.
    items.sort(key=lambda i: (i.assessment_date is None, i.assessment_date, i.title))
    return items


# ──────────────────────────────────────────────────────────────────────────────
# Student
# ──────────────────────────────────────────────────────────────────────────────
def _student_payload(
    db: Session, actor: User, year: AcademicYear, semester: Semester
) -> StudentDashboard:
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == actor.id, StudentProfile.deleted_at.is_(None)
        )
    )
    base = {
        "user_full_name": actor.full_name,
        "academic_year_name": year.name,
        "semester_name": semester.name,
    }
    if student is None:
        # A student login with no profile still gets a renderable page.
        return StudentDashboard(**base, stats=StudentStats())

    section = db.scalar(
        select(Class)
        .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
        .where(
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.semester_id == semester.id,
            ClassEnrollment.unenrolled_at.is_(None),
        )
        .limit(1)
    )
    if section is None:
        return StudentDashboard(
            **base,
            stats=StudentStats(),
            announcements=_recent_announcements(db, actor, _ANNOUNCEMENT_LIMIT),
        )

    offerings = db.execute(
        select(ClassSubject, Subject)
        .join(Subject, ClassSubject.subject_id == Subject.id)
        .where(
            ClassSubject.class_id == section.id,
            ClassSubject.deleted_at.is_(None),
            ClassSubject.is_active.is_(True),
        )
    ).all()

    lead_names: dict[uuid.UUID, str] = {}
    if offerings:
        for cs_id, name in db.execute(
            select(ClassTeacher.class_subject_id, TeacherProfile.full_name)
            .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
            .where(
                ClassTeacher.class_subject_id.in_([cs.id for cs, _ in offerings]),
                ClassTeacher.is_lead.is_(True),
            )
        ).all():
            lead_names[cs_id] = name

    my_classes = [
        StudentClassItem(
            class_subject_id=cs.id,
            subject_name=subject.name,
            teacher_name=lead_names.get(cs.id, "Unassigned"),
        )
        for cs, subject in sorted(offerings, key=lambda t: t[1].name)
    ]

    bands, _pass_mark = _bands(db, year)
    school = _school_policy(db)
    cs_ids = [cs.id for cs, _ in offerings]

    assessments: list[Assessment] = []
    if cs_ids:
        assessments = list(
            db.scalars(
                select(Assessment).where(
                    Assessment.class_subject_id.in_(cs_ids),
                    Assessment.semester_id == semester.id,
                    Assessment.deleted_at.is_(None),
                )
            ).all()
        )
    my_grades = {}
    if assessments:
        my_grades = {
            g.assessment_id: g
            for g in db.scalars(
                select(AssessmentGrade).where(
                    AssessmentGrade.assessment_id.in_([a.id for a in assessments]),
                    AssessmentGrade.student_id == student.id,
                )
            ).all()
        }

    categories = []
    if cs_ids:
        categories = list(
            db.scalars(
                select(AssessmentCategory).where(
                    AssessmentCategory.class_subject_id.in_(cs_ids)
                )
            ).all()
        )
    cats_by_cs: dict[uuid.UUID, list[AssessmentCategory]] = defaultdict(list)
    for c in categories:
        cats_by_cs[c.class_subject_id].append(c)
    cats_by_id = {c.id: c for c in categories}

    subject_names = {cs.id: subject.name for cs, subject in offerings}
    by_cs: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in assessments:
        by_cs[a.class_subject_id].append(a)

    def released(a: Assessment) -> bool:
        g = my_grades.get(a.id)
        return a.is_released if g is None or g.is_released is None else g.is_released

    # Per-subject term grades, RELEASED ONLY. The mock computes this with the
    # release-agnostic selector, which would surface a number a student cannot
    # reconcile from the grades they can actually see.
    requests: dict[object, calc.TermGradeRequest] = {}
    for cs_id in cs_ids:
        cat_inputs = [
            calc.CategoryInput(
                id=c.id,
                weight=_dec(c.weight) or Decimal(0),
                drop_lowest_count=int(
                    c.drop_lowest_count
                    if c.drop_lowest_count is not None
                    else (year.drop_lowest_count if year.drop_lowest_count is not None
                          else (school.drop_lowest_count if school else 0))
                ),
            )
            for c in cats_by_cs.get(cs_id, [])
        ]
        requests[cs_id] = calc.TermGradeRequest(
            grades=[
                calc.GradeInput(
                    assessment_id=a.id,
                    max_score=_dec(a.max_score) or Decimal(0),
                    weight=_dec(a.weight) or Decimal(0),
                    assessment_status=a.status,
                    policy=calc.resolve_policy(
                        a,
                        cats_by_id.get(a.category_id) if a.category_id else None,
                        year,
                        school,
                    ),
                    category_id=a.category_id,
                    grade_status=my_grades[a.id].status if a.id in my_grades else None,
                    score=_dec(my_grades[a.id].score) if a.id in my_grades else None,
                    makeup_score=(
                        _dec(my_grades[a.id].makeup_score) if a.id in my_grades else None
                    ),
                    is_released=released(a),
                )
                for a in by_cs.get(cs_id, [])
            ],
            categories=cat_inputs,
            bands=bands,
            released_only=True,
        )
    per_subject = [
        t.numeric for t in calc.compute_term_grades_bulk(requests).values() if t.numeric is not None
    ]
    term_average = None
    term_letter = None
    if per_subject:
        mean = sum(per_subject) / Decimal(len(per_subject))
        term_average = float(round(mean, 1))
        term_letter = calc.letter_for(mean, bands)

    recent_graded = [
        a
        for a in assessments
        if a.status == AssessmentStatus.GRADED
        and released(a)
        and a.id in my_grades
        and my_grades[a.id].status == GradeStatus.GRADED
        and my_grades[a.id].score is not None
    ]
    recent_graded.sort(
        key=lambda a: (a.assessment_date is None, a.assessment_date), reverse=True
    )
    recent_grades = [
        StudentGradeItem(
            assessment_id=a.id,
            title=a.title,
            subject_name=subject_names.get(a.class_subject_id, ""),
            score=_f(my_grades[a.id].score),
            max_score=_f(a.max_score),
            letter=calc.letter_for(
                calc.percentage_for(my_grades[a.id].score, a.max_score), bands
            ) or "",
        )
        for a in recent_graded[:_CARD_LIMIT]
    ]

    # Upcoming: dated in the future and NOT a draft. The mock includes drafts, which
    # leaks unpublished work to a student — a real scope bug, not copied.
    upcoming = [
        a
        for a in assessments
        if a.assessment_date is not None
        and a.assessment_date > school_today()
        and a.status != AssessmentStatus.DRAFT
    ]
    upcoming.sort(key=lambda a: a.assessment_date)
    upcoming_assessments = [
        StudentUpcomingItem(
            id=a.id,
            title=a.title,
            subject_name=subject_names.get(a.class_subject_id, ""),
            assessment_date=a.assessment_date,
        )
        for a in upcoming[:_ANNOUNCEMENT_LIMIT]
    ]

    # The student's OWN attendance rate, not their section's. The mock reports the
    # section average, which is not what "my attendance" means and would not
    # reconcile with the My Attendance screen.
    own_statuses = list(
        db.scalars(
            select(AttendanceRecord.status).where(
                AttendanceRecord.student_id == student.id,
                AttendanceRecord.semester_id.in_(
                    select(Semester.id).where(Semester.academic_year_id == year.id)
                ),
            )
        ).all()
    )

    return StudentDashboard(
        **base,
        stats=StudentStats(
            term_average=term_average,
            term_letter=term_letter,
            attendance_rate=_summarize(own_statuses).pct_present,
            upcoming_count=len(upcoming_assessments),
        ),
        my_classes=my_classes,
        recent_grades=recent_grades,
        upcoming_assessments=upcoming_assessments,
        announcements=_recent_announcements(db, actor, _ANNOUNCEMENT_LIMIT),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────
def get_dashboard(db: Session, *, actor: User) -> DashboardResponse:
    """GET /dashboard — one composite read, shaped by the caller's role.

    409 `no_active_semester` when the school has no active term: every variant's
    header and scoping hang off it, so an empty dashboard would be misleading rather
    than merely sparse. The frontend already renders this as a setup prompt.
    """
    year = _active_year(db)
    semester = _active_semester(db)
    if year is None or semester is None:
        raise Conflict(
            "No active academic term is configured.", code="no_active_semester"
        )

    if actor.role == Role.TEACHER:
        return _teacher_payload(db, actor, year, semester)
    if actor.role == Role.STUDENT:
        return _student_payload(db, actor, year, semester)
    if actor.role == Role.SECRETARY:
        return _secretary_payload(db, actor, year, semester)
    return _admin_payload(db, actor, year, semester)

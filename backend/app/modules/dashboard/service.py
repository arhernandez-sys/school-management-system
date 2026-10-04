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
    ApplicationStatus,
    AssessmentStatus,
    GradeStatus,
    Role,
    StudentStatus,
    TeacherStatus,
)
from app.core.errors import Conflict, Forbidden
from app.core.rbac import teacher_offering_ids
from app.core.timeutil import school_today
from app.modules.announcements import service as announcements_service
from app.modules.announcements.models import Announcement, AnnouncementRead
from app.modules.admissions.models import Application
from app.modules.assessments.models import Assessment, AssessmentCategory
from app.modules.assessments.release_nudge import graded_unreleased_clause
from app.modules.attendance.models import AttendanceRecord
from app.modules.attendance import service as attendance_service
from app.modules.attendance.service import _summarize
from app.modules.offerings.labels import OFFERING_ORDER, offering_label, offering_ref
from app.modules.offerings.queries import offerings_in_year
from app.modules.programs.queries import enrollment_by_programme
from app.modules.offerings.models import (
    CourseOffering,
    ClassEnrollment,
    ClassTeacher,
    Course,
)
from app.modules.dashboard.schemas import (
    AdminDashboard,
    AuditorDashboard,
    AdminStats,
    CourseFailureRateItem,
    DashboardAnnouncement,
    DashboardPerson,
    DashboardResponse,
    EnrollmentByProgrammeItem,
    EnrollmentTrendItem,
    GradeDistributionItem,
    HodDashboard,
    PersonStatus,
    SecretaryDashboard,
    SecretaryEnrollmentItem,
    SecretaryStats,
    StudentOfferingItem,
    StudentDashboard,
    StudentGradeItem,
    StudentStats,
    StudentUpcomingItem,
    TeacherAssessmentItem,
    TeacherAwaitingReleaseItem,
    TeacherDashboard,
    TeacherStats,
    TeacherTodayOffering,
)
from app.modules.grades import calc
from app.modules.grades.models import AssessmentGrade
from app.modules.programs.models import Program
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    GradingScale,
    GradingScaleBand,
    Semester,
)
from app.modules.students.models import STUDENT_NAME_ORDER, StudentProfile
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
            calc.BandInput(
                letter=b.letter,
                min_score=_dec(b.min_score),
                is_passing=b.is_passing,
                # D30 §D5 — the student dashboard's GPA needs it; see reports/_bands.
                grade_point=_dec(b.grade_point),
            )
            for b in rows
        ],
        _dec(scale.pass_mark),
    )


def _school_policy(db: Session) -> AssessmentPolicy | None:
    return db.scalar(select(AssessmentPolicy).where(AssessmentPolicy.id == 1))


# ──────────────────────────────────────────────────────────────────────────────
# Principal
# ──────────────────────────────────────────────────────────────────────────────
def _enrollment_by_programme(
    db: Session, year: AcademicYear
) -> list[EnrollmentByProgrammeItem]:
    """Students per programme, for the year (D31 — replaces the by-Form breakdown).

    The query itself lives in `programs/queries.py` because `GET /reports/enrollment`
    needs the same numbers; two screens reporting different enrolment totals is a bug
    users notice and nobody can explain. This only shapes the tile's wire model.
    """
    return [
        EnrollmentByProgrammeItem(
            programme_id=row.programme_id,
            programme_code=row.code,
            programme_name=row.name,
            count=row.count,
        )
        for row in enrollment_by_programme(db, year)
    ]


# ──────────────────────────────────────────────────────────────────────────────
# D45 §42 / §59 — the Dean Dashboard's admissions and risk counters
# ──────────────────────────────────────────────────────────────────────────────
#: Application states that mean "waiting on the college" (D45 §42, "New Applicants").
#:
#: `DRAFT` is excluded: an application the applicant has not submitted is not waiting on
#: anybody here. `ACCEPTED` is excluded too and counted separately — an accepted applicant
#: is waiting on ENROLMENT, which is different work by a different person.
#:
#: `REJECTED`, `WITHDRAWN` and `ENROLLED` are finished states and belong in a report, not
#: on a queue tile.
_PENDING_APPLICATION_STATES = (
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.DOCUMENTS_PENDING,
    ApplicationStatus.ELIGIBLE,
    ApplicationStatus.DEFERRED,
)


def _application_counts(db: Session) -> tuple[int, int]:
    """`(new_applicants, accepted_applicants)` — the §42 pair.

    Deliberately NOT scoped to the active academic year. An application carries the year
    it is FOR, and the queue the Dean has to clear includes next year's intake, which is
    the whole point of looking at it in September. Scoping to the current year would show
    zero during exactly the months admissions is busiest.
    """
    pending = db.scalar(
        select(func.count())
        .select_from(Application)
        .where(
            Application.deleted_at.is_(None),
            Application.status.in_(_PENDING_APPLICATION_STATES),
        )
    ) or 0
    accepted = db.scalar(
        select(func.count())
        .select_from(Application)
        .where(
            Application.deleted_at.is_(None),
            Application.status == ApplicationStatus.ACCEPTED,
        )
    ) or 0
    return int(pending), int(accepted)


def _active_programme_count(db: Session) -> int:
    """§59 "Active Programmes"."""
    return int(
        db.scalar(
            select(func.count())
            .select_from(Program)
            .where(Program.deleted_at.is_(None), Program.is_active.is_(True))
        )
        or 0
    )


def _students_at_risk(db: Session, actor: User, year: AcademicYear) -> int:
    """§59 "Students At Risk" — distinct students under the configured attendance floor.

    Built on `attendance.get_alerts`, which is built on `_summarize` — the SAME tally the
    attendance screen, the report card and the alerts list use. A second percentage
    implementation here would eventually disagree with the screen this tile links to, and
    the tile would be the one nobody believed.

    DISTINCT students, not alert rows: `get_alerts` reports one row per student PER CLASS,
    so a student failing three classes would otherwise read as three at-risk students.
    """
    alerts = attendance_service.get_alerts(
        db, actor=actor, academic_year_id=year.id, threshold=None
    )
    return len({item.student.id for item in alerts.students})


def _graduates(db: Session) -> int:
    """§42 "graduates" — students whose lifecycle status is `Graduated`.

    ⚠️ CUMULATIVE, and forced by the data rather than chosen: `graduation_date` is NULL
    on every graduated row in the live register, so there is no date to scope a year by.
    Filtering on the column anyway would report 0 for a college that has graduated
    people — the worse of the two wrong answers — so the count is all-time and the tile
    says "to date". If BAJC starts recording graduation dates this becomes a one-line
    change to a year-scoped count.
    """
    return int(
        db.scalar(
            select(func.count())
            .select_from(StudentProfile)
            .where(
                StudentProfile.deleted_at.is_(None),
                StudentProfile.status == StudentStatus.GRADUATED,
            )
        )
        or 0
    )


def _outstanding_grade_submissions(
    db: Session, year: AcademicYear, semester: Semester
) -> int:
    """§42 "outstanding grade submissions" — assessments still being MARKED, college-wide.

    **The same predicate as the Lecturer's own `ungraded_items` tile** (lifecycle
    `published` or `grading`), summed over every offering in the session instead of one
    lecturer's. That is deliberate: a Dean asking "how far behind is marking" must not
    get a total that disagrees with the tiles of the people it is about.

    Scoped to the offering's own session, not just the semester id, so an assessment
    attached to an offering outside the active year cannot inflate it.
    """
    return int(
        db.scalar(
            select(func.count())
            .select_from(Assessment)
            .join(CourseOffering, CourseOffering.id == Assessment.offering_id)
            .where(
                Assessment.semester_id == semester.id,
                Assessment.deleted_at.is_(None),
                Assessment.status.in_(
                    (AssessmentStatus.PUBLISHED, AssessmentStatus.GRADING)
                ),
                offerings_in_year(year.id),
                CourseOffering.deleted_at.is_(None),
            )
        )
        or 0
    )


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


#: A course needs at least this many RESOLVED term grades before its failure rate is
#: reported (§42). One graded student at 40% is not a 100% failure rate, it is one
#: student — and a list sorted by percentage would put that course at the top, above a
#: course with 30 students and a genuine problem. Small courses are still counted in the
#: college-wide `failure_rate`; they are only kept out of the per-course RANKING.
_MIN_FAILURE_RATE_RESULTS = 5

#: How many courses the failure-rate card lists. A dashboard card is a prompt to look,
#: not the report — §53's own reports are where the whole list belongs.
_FAILURE_RATE_LIMIT = 8


def _term_grades_for_year(
    db: Session, year: AcademicYear, semester: Semester
) -> tuple[dict[tuple, object], dict[uuid.UUID, uuid.UUID], dict[str, bool]]:
    """Every (student, offering) term grade in the active session, computed once.

    Returns `(computed, course_id_by_offering, passing_by_letter)`.

    **Extracted from `_grade_distribution` (D45 Phase 8) so the letter histogram and
    §42's course failure rates share ONE pass.** They are two readings of the same
    computation, and this is the one figure on the dashboard that could become
    O(students × subjects): it loads every assessment, category and grade for the term
    in three queries and computes in memory via `compute_term_grades_bulk`. Doing that
    twice would double the most expensive query on the Dean's screen to answer a second
    question about the same numbers — and, worse, a second copy of this assembly would
    eventually resolve a letter differently from the histogram beside it.
    """
    bands, _pass_mark = _bands(db, year)
    if not bands:
        return {}, {}, {}
    passing_by_letter = {b.letter: b.is_passing for b in bands}

    offerings = db.execute(
        select(CourseOffering.id, CourseOffering.course_id)
        .where(
            offerings_in_year(year.id),
            CourseOffering.deleted_at.is_(None),
        )
    ).all()
    if not offerings:
        return {}, {}, passing_by_letter
    cs_ids = [cs_id for cs_id, _ in offerings]
    course_by_offering = {cs_id: course_id for cs_id, course_id in offerings}

    assessments = list(
        db.scalars(
            select(Assessment).where(
                Assessment.offering_id.in_(cs_ids),
                Assessment.semester_id == semester.id,
                Assessment.deleted_at.is_(None),
            )
        ).all()
    )
    if not assessments:
        return {}, course_by_offering, passing_by_letter
    by_cs: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in assessments:
        by_cs[a.offering_id].append(a)

    categories = list(
        db.scalars(
            select(AssessmentCategory).where(AssessmentCategory.offering_id.in_(cs_ids))
        ).all()
    )
    cats_by_cs: dict[uuid.UUID, list[AssessmentCategory]] = defaultdict(list)
    for c in categories:
        cats_by_cs[c.offering_id].append(c)
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
    assessment_cs = {a.id: a.offering_id for a in assessments}
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
    # The band ORDER is needed by the histogram and nowhere else, so it is recomputed
    # there rather than widening this function's return.
    return computed, course_by_offering, passing_by_letter


def _grade_distribution(
    db: Session,
    year: AcademicYear,
    semester: Semester,
    *,
    computed=None,  # noqa: ANN001 — the shared pass, if the caller already made it
) -> list[GradeDistributionItem]:
    """Letter-grade histogram across the whole active session.

    A thin reading of `_term_grades_for_year`, and still the ONE definition of this
    histogram — `_admin_payload` hands in the pass it already made rather than tallying
    a second copy inline, which would have left this function dead beside a duplicate of
    its own body. Output is unchanged from before the Phase 8 split.
    """
    bands, _pass_mark = _bands(db, year)
    if not bands:
        return []
    if computed is None:
        computed, _courses, _passing = _term_grades_for_year(db, year, semester)
    tally: dict[str, int] = defaultdict(int)
    for term in computed.values():
        if term.letter is not None:
            tally[term.letter] += 1

    order = {b.letter: i for i, b in enumerate(sorted(bands, key=lambda b: -(_dec(b.min_score) or Decimal(0))))}
    return [
        GradeDistributionItem(letter=letter, count=count)
        for letter, count in sorted(tally.items(), key=lambda kv: order.get(kv[0], 99))
    ]


def _failure_rates(
    db: Session,
    year: AcademicYear,
    semester: Semester,
    *,
    computed=None,  # noqa: ANN001 — the shared pass, if the caller already made it
    course_by_offering: dict[uuid.UUID, uuid.UUID] | None = None,
    passing_by_letter: dict[str, bool] | None = None,
) -> tuple[float, list[CourseFailureRateItem]]:
    """§42 "course failure rates" — the college figure, and the worst courses.

    `(failure_rate, per_course)`. The second reading of `_term_grades_for_year`; the
    caller passes the pass in so the Dean's payload computes it once.

    **The denominator is RESOLVED term grades, never enrolments.** A course three weeks
    into the session has almost no resolved grades, and dividing its failures by its
    roster would report a catastrophic failure rate for a class nobody has assessed yet —
    which is the number a Dean would act on first and the one most likely to be wrong.

    A letter is FAILING when its band says so (`grading_scale_bands.is_passing`), never
    by comparing to a hardcoded mark: BAJC runs two scales whose `D` disagrees about
    passing, and the year's own scale is the only authority on which is in force.
    """
    if computed is None:
        computed, course_by_offering, passing_by_letter = _term_grades_for_year(
            db, year, semester
        )
    course_by_offering = course_by_offering or {}
    passing_by_letter = passing_by_letter or {}

    total = failing = 0
    per_course: dict[uuid.UUID, list[int]] = defaultdict(lambda: [0, 0])
    for (_student_id, offering_id), term in computed.items():
        if term.letter is None:
            continue  # not a result, and not a failure — see `completed_course_results`
        total += 1
        # An UNKNOWN letter is treated as passing rather than failing. It can only happen
        # if a band is deleted after a grade resolved against it, and inventing a failure
        # for a student on the strength of a missing configuration row is the one error
        # here with a person on the end of it.
        is_fail = passing_by_letter.get(term.letter, True) is False
        failing += int(is_fail)
        course_id = course_by_offering.get(offering_id)
        if course_id is None:
            continue
        bucket = per_course[course_id]
        bucket[0] += 1
        bucket[1] += int(is_fail)

    overall = 0.0 if total == 0 else round(failing / total * 1000) / 10

    if not per_course:
        return overall, []
    names = {
        cid: (code, name)
        for cid, code, name in db.execute(
            select(Course.id, Course.code, Course.name).where(
                Course.id.in_(list(per_course))
            )
        ).all()
    }
    rows = [
        CourseFailureRateItem(
            course_code=names.get(cid, ("?", "Unknown course"))[0],
            course_name=names.get(cid, ("?", "Unknown course"))[1],
            results=results,
            failing=fails,
            failure_rate=round(fails / results * 1000) / 10,
        )
        for cid, (results, fails) in per_course.items()
        if results >= _MIN_FAILURE_RATE_RESULTS
    ]
    rows.sort(key=lambda r: (-r.failure_rate, -r.results, r.course_code))
    return overall, rows[:_FAILURE_RATE_LIMIT]


def _school_attendance_rate(db: Session, year: AcademicYear) -> float:
    statuses = list(
        db.scalars(
            select(AttendanceRecord.status)
            .join(CourseOffering, AttendanceRecord.offering_id == CourseOffering.id)
            .where(offerings_in_year(year.id), CourseOffering.deleted_at.is_(None))
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
    # ⚠️ DEFECT FIXED (D45 Phase 8): this counted `course_offerings`, not courses.
    #
    # The clause was `deleted_at IS NULL` written three times over `CourseOffering` — the
    # tell-tale of a copy-paste — so the Dean's "Courses" tile showed the number of
    # OFFERINGS in the year while the tile beneath it showed "Across N sections" from the
    # same table. Two tiles, one fact, and neither of them the catalog. §42 asks for total
    # courses, which is the catalog: on live `sims` that is 125, against 22 offerings.
    total_courses = db.scalar(
        select(func.count())
        .select_from(Course)
        .where(Course.deleted_at.is_(None), Course.is_active.is_(True))
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

    # The offering's DERIVED label, not a stored homeroom name (D31).
    section_names = {o.id: offering_label(c.code, o.section_code) for o, c in sections}
    recent_students = [
        DashboardPerson(
            id=s.id,
            name=s.full_name,
            secondary=section_names.get(cls_id, "—") if cls_id else "—",
            status=PersonStatus(label="Active", kind="success"),
        )
        for s, cls_id in db.execute(
            select(StudentProfile, ClassEnrollment.offering_id)
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
            .order_by(*STUDENT_NAME_ORDER)
            .limit(_CARD_LIMIT)
        ).all()
    ]

    # D45 §42 — one query pair, unpacked here rather than called twice inline.
    _new_applicants, _accepted_applicants = _application_counts(db)

    # D45 Phase 8 — the letter histogram and the failure rates are two readings of ONE
    # term-grade pass, which is the most expensive computation on this screen. Computed
    # here and handed to both, so the Dean's payload pays for it once.
    _computed, _course_by_offering, _passing = _term_grades_for_year(db, year, semester)
    _failure_rate, _failure_rows = _failure_rates(
        db,
        year,
        semester,
        computed=_computed,
        course_by_offering=_course_by_offering,
        passing_by_letter=_passing,
    )

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
            student_capacity=sum(s.capacity or 0 for s, _c in sections),
            # D45 §42 / §59 — the four tiles the revised blueprint highlighted.
            new_applicants=_new_applicants,
            accepted_applicants=_accepted_applicants,
            active_programmes=_active_programme_count(db),
            students_at_risk=_students_at_risk(db, actor, year),
            # D45 Phase 8 — the rest of §42's KPI set. "Students on probation" and
            # "graduation candidates" are absent on purpose: they need Academic Standing
            # and the Graduation Audit, deferred with C1 and C2. A tile reading 0 for a
            # feature that does not exist is a number the Dean would believe.
            graduates=_graduates(db),
            outstanding_grade_submissions=_outstanding_grade_submissions(
                db, year, semester
            ),
            failure_rate=_failure_rate,
        ),
        enrollment_by_programme=_enrollment_by_programme(db, year),
        grade_distribution=_grade_distribution(db, year, semester, computed=_computed),
        course_failure_rates=_failure_rows,
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

    # Active offerings with nobody assigned — the clerk's setup queue.
    staffed = select(ClassTeacher.offering_id).distinct().subquery()
    unstaffed_subjects = db.scalar(
        select(func.count())
        .select_from(CourseOffering)
        .where(
            offerings_in_year(year.id),
            CourseOffering.deleted_at.is_(None),
            CourseOffering.deleted_at.is_(None),
            CourseOffering.deleted_at.is_(None),
            CourseOffering.id.notin_(select(staffed.c.offering_id)),
        )
    ) or 0

    roster_counts = dict(
        db.execute(
            select(ClassEnrollment.offering_id, func.count())
            .where(
                ClassEnrollment.semester_id == semester.id,
                ClassEnrollment.unenrolled_at.is_(None),
            )
            .group_by(ClassEnrollment.offering_id)
        ).all()
    )
    over_capacity_sections = sum(
        1
        for s, _c in sections
        if s.capacity and roster_counts.get(s.id, 0) > s.capacity
    )

    recent_enrollments = [
        SecretaryEnrollmentItem(
            enrollment_id=enr_id,
            student_name=student_name,
            offering_label=offering_label(code, section),
            enrolled_at=enrolled_at,
        )
        for enr_id, student_name, code, section, enrolled_at in db.execute(
            select(
                ClassEnrollment.id,
                StudentProfile.full_name,
                Course.code,
                CourseOffering.section_code,
                ClassEnrollment.enrolled_at,
            )
            .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
            .join(CourseOffering, ClassEnrollment.offering_id == CourseOffering.id)
            .join(Course, CourseOffering.course_id == Course.id)
            .where(
                ClassEnrollment.unenrolled_at.is_(None),
                offerings_in_year(year.id),
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
    section_ids = teacher_offering_ids(db, actor)

    owned = []
    if section_ids:
        owned = db.execute(
            select(CourseOffering, Course)
            .join(Course, CourseOffering.course_id == Course.id)
            .join(ClassTeacher, ClassTeacher.offering_id == CourseOffering.id)
            .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
            .where(
                TeacherProfile.user_id == actor.id,
                CourseOffering.deleted_at.is_(None),
                offerings_in_year(year.id),
            )
            .order_by(*OFFERING_ORDER)
        ).all()

    today = school_today()
    recorded_sections: set[uuid.UUID] = set()
    if section_ids:
        recorded_sections = set(
            db.scalars(
                select(AttendanceRecord.offering_id)
                .where(
                    AttendanceRecord.offering_id.in_(section_ids),
                    AttendanceRecord.attendance_date == today,
                )
                .distinct()
            ).all()
        )

    # D31 dropped a dedupe that existed only for homerooms. Attendance is marked once
    # per offering per day, and an offering teaches exactly one course — so the old
    # "collapse the seven subjects a teacher takes in one homeroom down to one register"
    # step now has nothing to collapse, and every owned offering is its own register.
    today_classes = [
        TeacherTodayOffering(
            offering=offering_ref(cs, subject),
            attendance_recorded=cs.id in recorded_sections,
        )
        for cs, subject in owned
    ]

    cs_meta = {cs.id: (cs, subject) for cs, subject in owned}
    pending_statuses = (AssessmentStatus.PUBLISHED, AssessmentStatus.GRADING)
    pending = []
    if cs_meta:
        pending = list(
            db.scalars(
                select(Assessment).where(
                    Assessment.offering_id.in_(list(cs_meta)),
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
            offering=offering_ref(*cs_meta[a.offering_id]),
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
            my_offerings=len(owned),
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
            Assessment.offering_id,
            Assessment.title,
            Assessment.assessment_date,
            Assessment.status,
            func.count(),
        )
        .join(AssessmentGrade, AssessmentGrade.assessment_id == Assessment.id)
        .where(
            Assessment.offering_id.in_(list(cs_meta)),
            Assessment.semester_id == semester.id,
            Assessment.deleted_at.is_(None),
            graded_unreleased_clause(),
        )
        .group_by(
            Assessment.id,
            Assessment.offering_id,
            Assessment.title,
            Assessment.assessment_date,
            Assessment.status,
        )
    ).all()

    items = [
        TeacherAwaitingReleaseItem(
            id=a_id,
            title=title,
            offering=offering_ref(*cs_meta[cs_id]),
            assessment_date=on,
            status=status,
            offering_id=cs_id,
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

    # D29: EVERY subject class the student sits this term, not one homeroom. Taking
    # the first (`.limit(1)`) used to be correct when a student had exactly one; now
    # it would show one subject and silently drop the rest of their timetable.
    class_ids = list(
        dict.fromkeys(
            db.scalars(
                select(ClassEnrollment.offering_id)
                .join(CourseOffering, ClassEnrollment.offering_id == CourseOffering.id)
                .where(
                    ClassEnrollment.student_id == student.id,
                    ClassEnrollment.semester_id == semester.id,
                    ClassEnrollment.unenrolled_at.is_(None),
                    CourseOffering.deleted_at.is_(None),
                )
            ).all()
        )
    )
    if not class_ids:
        return StudentDashboard(
            **base,
            stats=StudentStats(),
            announcements=_recent_announcements(db, actor, _ANNOUNCEMENT_LIMIT),
        )

    offerings = db.execute(
        select(CourseOffering, Course)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            CourseOffering.id.in_(class_ids),
            CourseOffering.deleted_at.is_(None),
        )
        .order_by(*OFFERING_ORDER)
    ).all()

    lead_names: dict[uuid.UUID, str] = {}
    if offerings:
        for cs_id, name in db.execute(
            select(ClassTeacher.offering_id, TeacherProfile.full_name)
            .join(TeacherProfile, ClassTeacher.teacher_id == TeacherProfile.id)
            .where(
                ClassTeacher.offering_id.in_([cs.id for cs, _ in offerings]),
                ClassTeacher.is_lead.is_(True),
            )
        ).all():
            lead_names[cs_id] = name

    my_classes = [
        StudentOfferingItem(
            offering=offering_ref(cs, subject),
            teacher_name=lead_names.get(cs.id, "Unassigned"),
        )
        for cs, subject in offerings
    ]

    bands, _pass_mark = _bands(db, year)
    school = _school_policy(db)
    cs_ids = [cs.id for cs, _ in offerings]

    assessments: list[Assessment] = []
    if cs_ids:
        assessments = list(
            db.scalars(
                select(Assessment).where(
                    Assessment.offering_id.in_(cs_ids),
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
                    AssessmentCategory.offering_id.in_(cs_ids)
                )
            ).all()
        )
    cats_by_cs: dict[uuid.UUID, list[AssessmentCategory]] = defaultdict(list)
    for c in categories:
        cats_by_cs[c.offering_id].append(c)
    cats_by_id = {c.id: c for c in categories}

    offering_refs = {cs.id: offering_ref(cs, subject) for cs, subject in offerings}
    by_cs: dict[uuid.UUID, list[Assessment]] = defaultdict(list)
    for a in assessments:
        by_cs[a.offering_id].append(a)

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
    computed_terms = calc.compute_term_grades_bulk(requests)
    per_subject = [t.numeric for t in computed_terms.values() if t.numeric is not None]
    term_average = None
    term_letter = None
    if per_subject:
        mean = sum(per_subject) / Decimal(len(per_subject))
        term_average = float(round(mean, 1))
        term_letter = calc.letter_for(mean, bands)

    # Credit-weighted GPA (D30 §D5). Assembled here, computed by the one shared
    # `calc.compute_gpa` — every offering the student sits contributes its credits, and
    # one with no released grade contributes 0 quality points (decision #4).
    credits_by_cs = {cs.id: subject.credits for cs, subject in offerings}
    term_gpa = calc.compute_gpa(
        [
            calc.GpaEntry(
                credits=_dec(credits_by_cs.get(cs_id)) or Decimal(0),
                grade_point=calc.grade_point_for(term.letter, bands),
            )
            for cs_id, term in computed_terms.items()
        ]
    )

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
            offering=offering_refs.get(a.offering_id),
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
            offering=offering_refs.get(a.offering_id),
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
            gpa=_f(term_gpa.gpa),
            total_credits=int(term_gpa.total_credits),
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
    # D43 — a head lands on their own teaching; an auditor on the school-wide figures.
    # Both reuse an existing payload and re-tag it, so the client's `role` discriminator
    # stays truthful (see the schema note).
    #
    # `exclude={"role"}` is NOT cosmetic. `_teacher_payload` returns a `TeacherDashboard`,
    # whose `role` field is `Literal["teacher"]` with a default — so its `model_dump()`
    # carries `role="teacher"`, and splatting that into `HodDashboard` (`Literal["hod"]`)
    # is a ValidationError, i.e. a 500 on the head's dashboard. Dropping the key lets each
    # subclass apply its OWN discriminator default, which is the whole point of re-tagging.
    if actor.role == Role.HOD:
        return HodDashboard(
            **_teacher_payload(db, actor, year, semester).model_dump(exclude={"role"})
        )
    if actor.role == Role.AUDITOR:
        return AuditorDashboard(
            **_admin_payload(db, actor, year, semester).model_dump(exclude={"role"})
        )
    if actor.role == Role.PRINCIPAL:
        return _admin_payload(db, actor, year, semester)
    # No silent fallback. This used to `return _admin_payload(...)` for anything
    # unmatched, so ANY role added later would have been handed the Dean's school-wide
    # dashboard by default — the most privileged view in the app, reached by omission.
    # Failing closed makes the next role's author add a branch instead of shipping a leak.
    raise Forbidden("No dashboard is available for this account.")

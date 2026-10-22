"""The four INSTITUTIONAL reports of blueprint §53 (D45 Phase 9).

    GET /reports/new-vs-returning       §53 Enrollment   — intake, year and term
    GET /reports/overcapacity           §53 Registration — classes past their seats
    GET /reports/credit-load            §53 Registration — what each student is carrying
    GET /reports/programme-attendance   §53 Attendance   — the "department" report, per C4

**WHY A SEPARATE MODULE.** `reports/service.py` is the REPORT-CARD engine: 1,300 lines
whose whole subject is one student's grades, shared by the card, the transcript and the
gradebook summary. These four share none of that machinery — no bands, no GPA, no
snapshots — and putting them in the same file would have meant a reader of either half
scrolling past the other. They share the ROUTER, because they are `/reports`, and that is
the right amount of togetherness.

────────────────────────────────────────────────────────────────────────────────
DEFINITIONS — read these before reading a number off any of these screens
────────────────────────────────────────────────────────────────────────────────

**"Registered" means `unenrolled_at IS NULL`, and nothing else.** Not a filter on
`enrollment_status`. This is deliberate and it is not laziness: `offerings/service.py::
_enrolled_counts` — the count behind the over-capacity WARNING the Registrar sees while
seating a student — is exactly that predicate. If this report used a cleverer rule, the
report and the warning would disagree about the same class on the same day, and the
Registrar would believe the one in front of them. One predicate, one answer.

**A withdrawal still occupies its seat** as a consequence, until somebody unenrolls the
row. That is the existing system's behaviour, not a Phase 9 decision, and it is the
honest one: a student who withdrew in week 10 did occupy a chair for ten weeks.

**Credits are `courses.credits`** — the catalog value, which is where credits live
(D30 moved the graded chain onto `courses` precisely so a stored grade could reach one).
Audited courses (D35) are counted in the load AND reported separately: an audit is real
attendance and real work, and earns nothing towards the award.

**Attendance percentages come from `attendance/service.py::_summarize`** — the same tally
the summary screen, both dashboards, the report card and the alerts screen use. LATE
COUNTS AS PRESENT there, so it counts as present here. A second percentage implementation
in this file would eventually disagree with the screen the reader clicks through to, and
this one would be the number nobody believed.

**The attendance floor is `school_profile.attendance_alert_threshold`** (D45 Phase 1) and
the comparison is STRICTLY BELOW, matching `attendance_alerts`. ⚠️ The column's own
docstring in `settings/models.py` says "at or below"; the code that has shipped since D45
Phase 1 says below. The shipped comparison wins here, because the alternative is two
screens flagging different sets of students from the same configured number.

────────────────────────────────────────────────────────────────────────────────
WHO CAN READ THEM
────────────────────────────────────────────────────────────────────────────────
Dean, Registrar and Auditor see the college. A **Head of Department sees their own
programmes and nothing else**, and every response says so in `scope` — an HOD reading
"3 classes over capacity" must not carry it out of the room as the college total.

The Lecturer is NOT here. `_staff` on the older report routes includes them because a
lecturer legitimately prints their own students' report cards; a college-wide list of who
is carrying how many credits is not their business, and §48 is explicit that being an
employee is not a reason to see something.

The System Administrator is refused centrally by Phase 1's `technical_role_scope`, the
same guard that correctly refused the audit trail in Phase 7. Nothing is needed here.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import AcademicYearStatus, EnrollmentStatus, Role
from app.core.errors import Forbidden, NotFound
from app.core.rbac import hod_program_ids
from app.core.timeutil import utcnow
from app.modules.attendance.models import AttendanceRecord
from app.modules.attendance.service import _summarize, resolve_attendance_threshold
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.models import ClassEnrollment, Course, CourseOffering
from app.modules.programs.models import Program
from app.modules.reports.schemas import (
    CreditLoadBand,
    CreditLoadByDeclared,
    CreditLoadReport,
    CreditLoadStudentRow,
    NewVsReturningProgrammeRow,
    NewVsReturningReport,
    NewVsReturningSemesterRow,
    NewVsReturningStudentRow,
    OvercapacityReport,
    OvercapacityRow,
    ProgrammeAttendanceReport,
    ProgrammeAttendanceRow,
    ProgrammeAttendanceStudentRow,
    ReportAcademicYearRef,
    ReportScope,
    ReportStudentRef,
)
#: `_semester_ref` and `_lead_teacher_names` are the report-card service's, imported
#: rather than re-spelled. The term ref in particular is a WIRE SHAPE: a second
#: constructor for it is a second thing to forget to update, which is the whole argument
#: `offerings/labels.py` makes about the offering label.
from app.modules.reports.service import _lead_teacher_names, _semester_ref
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import STUDENT_NAME_ORDER, StudentProfile
from app.modules.users.models import User

#: The roles that may read an institutional report at all. The HOD is admitted and then
#: NARROWED by `_scope`; everyone else here sees the college.
_ALLOWED = (Role.PRINCIPAL, Role.SECRETARY, Role.AUDITOR, Role.HOD)

#: BAJC's OWN definition, taken from the application form and already documented on
#: `EnrollmentLoad`: *"Part Time is under 15 credits a term, Full Time is over 15."*
#:
#: ⚠️ The form says "under 15" and "over 15" and therefore says NOTHING about exactly 15.
#: A student carrying precisely 15 is reported as consistent with either declaration
#: rather than flagged, because inventing the boundary is how a report starts asserting a
#: policy the college never set. Raised as an open question in the plan document.
FULL_TIME_CREDITS = 15

#: "Not assigned" is the same label `EnrollmentByProgramme` uses for a student with no
#: programme. Spelled once here so the two reports group the same students under the same
#: heading.
_UNASSIGNED = "Not assigned"


# ══════════════════════════════════════════════════════════════════════════════
# Access, scope and the two resolvers
# ══════════════════════════════════════════════════════════════════════════════
def _scope(db: Session, actor: User) -> tuple[list[uuid.UUID] | None, ReportScope]:
    """`(programme ids to restrict to | None, the scope to echo back)`.

    `None` means "the whole college". A Head of Department gets a LIST, and an HOD who
    heads nothing gets an EMPTY list — which every caller below narrows to the empty set,
    never widens to everything. `hod_program_ids` documents why that direction matters:
    getting it backwards turns an unconfigured HOD into a Dean.
    """
    if actor.role not in _ALLOWED:
        raise Forbidden(
            "Institutional reports are restricted to the Dean, the Registrar, "
            "Heads of Department and the Auditor.",
            code="forbidden",
        )
    if actor.role is not Role.HOD:
        return None, ReportScope(is_scoped=False)

    program_ids = hod_program_ids(db, actor)
    names = (
        list(
            db.scalars(
                select(Program.name)
                .where(Program.id.in_(program_ids))
                .order_by(Program.name.asc())
            ).all()
        )
        if program_ids
        else []
    )
    return program_ids, ReportScope(is_scoped=True, programmes=names)


def _resolve_year(db: Session, academic_year_id: uuid.UUID | None) -> AcademicYear:
    """The requested year, else the active one. 404 for an id that does not exist.

    No silent fallback to the active year for an unknown id — that masks a client bug by
    answering a question nobody asked, and the reader has no way to tell.
    """
    if academic_year_id is not None:
        year = db.get(AcademicYear, academic_year_id)
        if year is None:
            raise NotFound("Academic year not found.", code="academic_year_not_found")
        return year
    year = db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )
    if year is None:
        raise NotFound("No active academic year.", code="no_active_year")
    return year


def _resolve_semester(db: Session, semester_id: uuid.UUID | None) -> Semester:
    """The requested term, else the active term. 404 for an id that does not exist.

    ⚠️ The default is the ACTIVE SEMESTER, not "the active year's first term". Three of
    these reports are term reports and a year-shaped default is exactly the slip D31 turned
    into three wrong answers elsewhere in this codebase.
    """
    if semester_id is not None:
        semester = db.get(Semester, semester_id)
        if semester is None:
            raise NotFound("Semester not found.", code="semester_not_found")
        return semester
    semester = db.scalar(select(Semester).where(Semester.is_active.is_(True)))
    if semester is None:
        raise NotFound("No active semester.", code="no_active_semester")
    return semester


def _student_ref(student: StudentProfile) -> ReportStudentRef:
    """The picker/report row for a student.

    Deliberately NOT imported from `reports/service.py`: that one takes a `Session` it
    does not use, and these reports build hundreds of refs in a loop where a stray
    per-row query would be the whole cost of the screen.
    """
    return ReportStudentRef(
        id=student.id,
        full_name=student.full_name,
        student_number=student.student_number,
        date_of_birth=student.date_of_birth,
        status=getattr(student.status, "value", student.status),
        year_of_study=getattr(student.year_of_study, "value", student.year_of_study),
    )


def _students_by_id(
    db: Session, program_ids: list[uuid.UUID] | None
) -> tuple[dict[uuid.UUID, StudentProfile], dict[uuid.UUID, str]]:
    """Every live student (optionally narrowed to programmes), plus id -> programme name.

    One query for the students and one for the programmes, then everything else in
    Python. At BAJC's 46 students that is not an optimisation — it is what keeps the
    grouping rules below readable as rules instead of as SQL.
    """
    stmt = select(StudentProfile).where(StudentProfile.deleted_at.is_(None))
    if program_ids is not None:
        # The empty list narrows to nothing. See `_scope`.
        stmt = stmt.where(StudentProfile.program_id.in_(program_ids or [None]))
    students = list(db.scalars(stmt.order_by(*STUDENT_NAME_ORDER)).all())

    names = dict(db.execute(select(Program.id, Program.name)).all())
    programme_of = {
        s.id: (names.get(s.program_id) or _UNASSIGNED) for s in students
    }
    return {s.id: s for s in students}, programme_of


# ══════════════════════════════════════════════════════════════════════════════
# §53 Enrollment — new versus returning students
# ══════════════════════════════════════════════════════════════════════════════
def new_vs_returning(
    db: Session, *, actor: User, academic_year_id: uuid.UUID | None
) -> NewVsReturningReport:
    """Intake for one academic year, split into first-timers and students coming back.

    **THE DEFINITION.** A student counts in this report if they hold at least one live
    registration in a term of the chosen year. They are NEW if the earliest academic year
    they have ever registered in IS that year, and RETURNING otherwise. It is measured
    from `class_enrollments`, never from `student_profiles.enrollment_date` — that column
    is the date somebody typed on the admission record, it moves when a record is
    corrected, and a student admitted in August who first registers the following January
    is not new twice.

    The per-term breakdown answers a narrower question — see `NewVsReturningSemesterRow`.
    Both are returned because BAJC uses both.
    """
    program_ids, scope = _scope(db, actor)
    year = _resolve_year(db, academic_year_id)
    students, programme_of = _students_by_id(db, program_ids)

    # Every live registration in the system, with the term and year it sits in. 393 rows
    # on the live college; the year-ordering key is (year start, term sequence) rather
    # than a name, because "2024-2025" sorts before "2025-2026" only by luck of spelling.
    rows = db.execute(
        select(
            ClassEnrollment.student_id,
            Semester.id,
            Semester.sequence,
            AcademicYear.id,
            AcademicYear.name,
            AcademicYear.start_date,
        )
        .join(Semester, Semester.id == ClassEnrollment.semester_id)
        .join(AcademicYear, AcademicYear.id == Semester.academic_year_id)
        .where(ClassEnrollment.unenrolled_at.is_(None))
    ).all()

    first_year: dict[uuid.UUID, tuple] = {}
    first_term: dict[uuid.UUID, tuple] = {}
    in_year: set[uuid.UUID] = set()
    in_semester: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)

    for student_id, sem_id, sequence, yr_id, yr_name, yr_start in rows:
        if student_id not in students:
            continue  # soft-deleted, or outside an HOD's programmes
        year_key = (yr_start, str(yr_name), yr_id)
        term_key = (yr_start, sequence, sem_id)
        if student_id not in first_year or year_key < first_year[student_id]:
            first_year[student_id] = year_key
        if student_id not in first_term or term_key < first_term[student_id]:
            first_term[student_id] = term_key
        if yr_id == year.id:
            in_year.add(student_id)
            in_semester[sem_id].add(student_id)

    by_programme: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    student_rows: list[NewVsReturningStudentRow] = []
    total_new = 0

    for student_id in in_year:
        is_new = first_year[student_id][2] == year.id
        total_new += int(is_new)
        programme = programme_of.get(student_id, _UNASSIGNED)
        by_programme[programme][0 if is_new else 1] += 1
        student_rows.append(
            NewVsReturningStudentRow(
                student=_student_ref(students[student_id]),
                programme=programme,
                is_new=is_new,
                first_registered_year=first_year[student_id][1],
            )
        )
    student_rows.sort(key=lambda r: (not r.is_new, r.student.full_name))

    semesters = list(
        db.scalars(
            select(Semester)
            .where(Semester.academic_year_id == year.id)
            .order_by(Semester.sequence.asc())
        ).all()
    )
    semester_rows = []
    for semester in semesters:
        members = in_semester.get(semester.id, set())
        first_here = sum(
            1 for sid in members if first_term[sid][2] == semester.id
        )
        semester_rows.append(
            NewVsReturningSemesterRow(
                semester=_semester_ref(db, semester),
                new=first_here,
                returning=len(members) - first_here,
                total=len(members),
            )
        )

    codes = dict(db.execute(select(Program.name, Program.code)).all())
    return NewVsReturningReport(
        academic_year=ReportAcademicYearRef(
            id=year.id,
            name=year.name,
            status=getattr(year.status, "value", year.status),
        ),
        generated_at=utcnow(),
        new=total_new,
        returning=len(in_year) - total_new,
        total=len(in_year),
        by_programme=sorted(
            (
                NewVsReturningProgrammeRow(
                    programme=name,
                    programme_code=codes.get(name),
                    new=counts[0],
                    returning=counts[1],
                    total=counts[0] + counts[1],
                )
                for name, counts in by_programme.items()
            ),
            key=lambda r: (-r.total, r.programme),
        ),
        by_semester=semester_rows,
        students=student_rows,
        scope=scope,
        note=(
            "A student is NEW if this is the first academic year they have ever held a "
            "registration in, and RETURNING otherwise — measured from registrations, not "
            "from the admission date on the student record. The per-term figures answer a "
            "narrower question: how many of that term's students had never registered in "
            "any term before it."
        ),
    )


# ══════════════════════════════════════════════════════════════════════════════
# §53 Registration — over-capacity classes
# ══════════════════════════════════════════════════════════════════════════════
def overcapacity(
    db: Session, *, actor: User, semester_id: uuid.UUID | None
) -> OvercapacityReport:
    """Offerings in one term whose registered headcount has passed the seats set.

    **The three lists are the report.** An "over capacity" screen that is empty tells the
    Dean one of two completely different things — nothing is over-subscribed, or nothing
    has a capacity recorded — and it looks identical either way. So `at_capacity` (full,
    and the next registration breaks it) and `no_capacity_set` (unanswerable, not fine)
    are returned alongside, and the note says which is which.

    ⚠️ `capacity` is a WARNING in this system, not a gate: `offerings/service.py` lets a
    registration through and reports `over_capacity_warning` (decision D-Q6). This report
    is therefore the only place an exceeded capacity is ever LOOKED FOR rather than
    noticed in passing.
    """
    program_ids, scope = _scope(db, actor)
    semester = _resolve_semester(db, semester_id)

    stmt = (
        select(CourseOffering, Course)
        .join(Course, Course.id == CourseOffering.course_id)
        .where(
            CourseOffering.semester_id == semester.id,
            CourseOffering.deleted_at.is_(None),
            CourseOffering.is_archived.is_(False),
        )
    )
    if program_ids is not None:
        from app.core.rbac import hod_course_ids

        course_ids = hod_course_ids(db, program_ids)
        stmt = stmt.where(CourseOffering.course_id.in_(course_ids or [None]))
    pairs = db.execute(stmt.order_by(*OFFERING_ORDER)).all()

    offering_ids = [o.id for (o, _c) in pairs]
    counts: dict[uuid.UUID, int] = {}
    if offering_ids:
        counts = dict(
            db.execute(
                select(ClassEnrollment.offering_id, func.count())
                .where(
                    ClassEnrollment.offering_id.in_(offering_ids),
                    # THE SAME PREDICATE AS `_enrolled_counts`. See the module docstring.
                    ClassEnrollment.unenrolled_at.is_(None),
                )
                .group_by(ClassEnrollment.offering_id)
            ).all()
        )

    lecturers = _lead_teacher_names(db, offering_ids)

    over: list[OvercapacityRow] = []
    at: list[OvercapacityRow] = []
    unset: list[OvercapacityRow] = []
    seats_total = 0
    registered_total = 0
    under = 0

    for offering, course in pairs:
        registered = counts.get(offering.id, 0)
        registered_total += registered
        capacity = offering.capacity
        row = OvercapacityRow(
            offering=offering_ref(offering, course, semester),
            lecturer=lecturers.get(offering.id),
            capacity=capacity,
            registered=registered,
            utilisation_pct=(
                None
                if not capacity
                else round(registered / capacity * 1000) / 10
            ),
        )
        if not capacity:
            row.band = "unset"
            unset.append(row)
            continue
        seats_total += capacity
        if registered > capacity:
            row.band = "over"
            row.over_by = registered - capacity
            over.append(row)
        elif registered == capacity:
            row.band = "at"
            at.append(row)
        else:
            under += 1

    over.sort(key=lambda r: (-r.over_by, r.offering.label))
    at.sort(key=lambda r: r.offering.label)
    unset.sort(key=lambda r: (-r.registered, r.offering.label))

    return OvercapacityReport(
        semester=_semester_ref(db, semester),
        generated_at=utcnow(),
        over=over,
        at_capacity=at,
        no_capacity_set=unset,
        under_capacity=under,
        offerings_total=len(pairs),
        seats_total=seats_total,
        registered_total=registered_total,
        note=(
            "Registered means a live registration row — the same count the Registrar sees "
            "as an over-capacity warning while seating a student. Capacity is a warning in "
            "this system, not a limit: a registration is never refused for it. Classes with "
            "no capacity recorded cannot appear as over capacity, which is why they are "
            "listed separately rather than left out."
        ),
        scope=scope,
    )


# ══════════════════════════════════════════════════════════════════════════════
# §53 Registration — credit load
# ══════════════════════════════════════════════════════════════════════════════
def credit_load(
    db: Session, *, actor: User, semester_id: uuid.UUID | None
) -> CreditLoadReport:
    """What every registered student is actually carrying this term, in credits.

    **The mismatch column is the point of the report.** `student_profiles.enrollment_load`
    is what the applicant DECLARED once, at admission; the credits are what they are
    doing now, and the two drift the moment somebody drops a course. The rule applied is
    BAJC's own, off the application form and already recorded on `EnrollmentLoad`:
    Part Time under 15 credits, Full Time over 15. Exactly 15 is not flagged — the form
    does not say, and this report does not get to decide (see `FULL_TIME_CREDITS`).

    Students with NO registration this term are absent from the rows: this is a report on
    load, and a student carrying nothing has no load. Whether they SHOULD be registered is
    the separate "students not registered" report of §53, which is not in this phase.
    """
    program_ids, scope = _scope(db, actor)
    semester = _resolve_semester(db, semester_id)
    students, programme_of = _students_by_id(db, program_ids)

    rows = db.execute(
        select(
            ClassEnrollment.student_id,
            ClassEnrollment.enrollment_status,
            Course.credits,
        )
        .join(CourseOffering, CourseOffering.id == ClassEnrollment.offering_id)
        .join(Course, Course.id == CourseOffering.course_id)
        .where(
            ClassEnrollment.semester_id == semester.id,
            ClassEnrollment.unenrolled_at.is_(None),
        )
    ).all()

    per_student: dict[uuid.UUID, list[int]] = defaultdict(lambda: [0, 0, 0])
    for student_id, status, credits in rows:
        if student_id not in students:
            continue
        credits = int(credits or 0)
        bucket = per_student[student_id]
        bucket[0] += 1
        bucket[1] += credits
        if getattr(status, "value", status) == EnrollmentStatus.AUDIT.value:
            bucket[2] += credits

    out: list[CreditLoadStudentRow] = []
    for student_id, (courses, credits, audited) in per_student.items():
        student = students[student_id]
        declared = getattr(
            student.enrollment_load, "value", student.enrollment_load
        )
        mismatch = None
        if declared == "Full Time" and credits < FULL_TIME_CREDITS:
            mismatch = (
                f"Declared Full Time but carrying {credits} credits, "
                f"under the {FULL_TIME_CREDITS}-credit full-time load."
            )
        elif declared == "Part Time" and credits > FULL_TIME_CREDITS:
            mismatch = (
                f"Declared Part Time but carrying {credits} credits, "
                f"over the {FULL_TIME_CREDITS}-credit part-time ceiling."
            )
        out.append(
            CreditLoadStudentRow(
                student=_student_ref(student),
                programme=programme_of.get(student_id, _UNASSIGNED),
                declared_load=declared,
                courses=courses,
                credits=credits,
                audit_credits=audited,
                mismatch=mismatch,
            )
        )
    out.sort(key=lambda r: (-r.credits, r.student.full_name))

    totals = [r.credits for r in out]
    by_declared: dict[str, list[int]] = defaultdict(lambda: [])
    mismatches_by_declared: dict[str, int] = defaultdict(int)
    for row in out:
        label = row.declared_load or "Not declared"
        by_declared[label].append(row.credits)
        mismatches_by_declared[label] += int(row.mismatch is not None)

    distribution: dict[int, int] = defaultdict(int)
    for value in totals:
        distribution[value] += 1

    return CreditLoadReport(
        semester=_semester_ref(db, semester),
        generated_at=utcnow(),
        students=len(out),
        credits_total=sum(totals),
        min_credits=min(totals) if totals else 0,
        max_credits=max(totals) if totals else 0,
        avg_credits=round(sum(totals) / len(totals), 1) if totals else 0.0,
        full_time_credits=FULL_TIME_CREDITS,
        mismatches=sum(1 for r in out if r.mismatch),
        by_declared_load=sorted(
            (
                CreditLoadByDeclared(
                    declared_load=label,
                    students=len(values),
                    min_credits=min(values),
                    max_credits=max(values),
                    avg_credits=round(sum(values) / len(values), 1),
                    mismatches=mismatches_by_declared[label],
                )
                for label, values in by_declared.items()
            ),
            key=lambda r: (-r.students, r.declared_load),
        ),
        distribution=[
            CreditLoadBand(credits=k, students=v)
            for k, v in sorted(distribution.items())
        ],
        rows=out,
        scope=scope,
        note=(
            f"Credits are this term's live registrations, valued from the course catalog. "
            f"The declared load is what the student stated at admission and is not "
            f"recalculated; a row is flagged only where the two contradict BAJC's own "
            f"application-form rule (Part Time under {FULL_TIME_CREDITS} credits, Full Time "
            f"over {FULL_TIME_CREDITS}). Exactly {FULL_TIME_CREDITS} credits is not flagged "
            f"either way, because the form does not say which side it falls on. Audited "
            f"courses are included in the load and shown separately; they earn no credit."
        ),
    )


# ══════════════════════════════════════════════════════════════════════════════
# §53 Attendance — the department (programme) attendance report
# ══════════════════════════════════════════════════════════════════════════════
def programme_attendance(
    db: Session,
    *,
    actor: User,
    semester_id: uuid.UUID | None,
    program_id: uuid.UUID | None,
) -> ProgrammeAttendanceReport:
    """§53's "department attendance report", which for BAJC means PER PROGRAMME (C4).

    There is no `departments` table and there is not going to be one: D43 settled that a
    programme is the unit this college actually has, and C4 confirmed it on 8 Sep 2026.
    So the axis is `student_profiles.program_id`, grouped through the student rather than
    through the course — a Biology student's attendance in a General Studies elective is
    still Biology's attendance problem, because Biology is who will be asked about it.

    Pass `program_id` to drill into one programme and get its students; without it the
    response is the summary only. An HOD may only drill into a programme they head.
    """
    program_ids, scope = _scope(db, actor)
    semester = _resolve_semester(db, semester_id)
    floor = resolve_attendance_threshold(db)

    if program_id is not None and program_ids is not None and program_id not in program_ids:
        raise Forbidden(
            "You do not head that programme.", code="forbidden"
        )

    students, programme_of = _students_by_id(db, program_ids)

    rows = db.execute(
        select(AttendanceRecord.student_id, AttendanceRecord.status).where(
            AttendanceRecord.semester_id == semester.id
        )
    ).all()

    per_student: dict[uuid.UUID, list] = defaultdict(list)
    for student_id, status in rows:
        if student_id in students:
            per_student[student_id].append(status)

    codes = dict(db.execute(select(Program.name, Program.code)).all())
    ids_by_name = dict(db.execute(select(Program.name, Program.id)).all())

    grouped: dict[str, list[uuid.UUID]] = defaultdict(list)
    for student_id in per_student:
        grouped[programme_of.get(student_id, _UNASSIGNED)].append(student_id)

    by_programme: list[ProgrammeAttendanceRow] = []
    all_statuses: list = []
    for name, member_ids in grouped.items():
        statuses = [s for sid in member_ids for s in per_student[sid]]
        all_statuses.extend(statuses)
        counts = _summarize(statuses)
        below = sum(
            1
            for sid in member_ids
            if per_student[sid] and _summarize(per_student[sid]).pct_present < floor
        )
        by_programme.append(
            ProgrammeAttendanceRow(
                programme=name,
                programme_code=codes.get(name),
                programme_id=ids_by_name.get(name),
                students=len(member_ids),
                records=len(statuses),
                present=counts.present,
                absent=counts.absent,
                late=counts.late,
                excused=counts.excused,
                pct_present=counts.pct_present,
                # A programme with no records is UNMARKED, not failing. Same rule as
                # `attendance_alerts`, for the same reason: 0% of nothing would bury the
                # programmes genuinely in trouble.
                below_floor=bool(statuses) and counts.pct_present < floor,
                students_below_floor=below,
            )
        )
    by_programme.sort(key=lambda r: (r.pct_present, r.programme))

    focus: ProgrammeAttendanceRow | None = None
    student_rows: list[ProgrammeAttendanceStudentRow] = []
    if program_id is not None:
        name = db.scalar(select(Program.name).where(Program.id == program_id))
        if name is None:
            raise NotFound("Programme not found.", code="program_not_found")
        focus = next((r for r in by_programme if r.programme_id == program_id), None)
        if focus is None:
            # A real programme with nobody marked in this term. Return the empty row
            # rather than nothing, so the screen says "no registers taken" instead of
            # "programme not found".
            focus = ProgrammeAttendanceRow(
                programme=name,
                programme_code=codes.get(name),
                programme_id=program_id,
            )
        for student_id in grouped.get(name, []):
            counts = _summarize(per_student[student_id])
            student_rows.append(
                ProgrammeAttendanceStudentRow(
                    student=_student_ref(students[student_id]),
                    records=len(per_student[student_id]),
                    present=counts.present,
                    absent=counts.absent,
                    late=counts.late,
                    excused=counts.excused,
                    pct_present=counts.pct_present,
                    below_floor=counts.pct_present < floor,
                )
            )
        student_rows.sort(key=lambda r: (r.pct_present, r.student.full_name))

    overall = _summarize(all_statuses)
    return ProgrammeAttendanceReport(
        semester=_semester_ref(db, semester),
        generated_at=utcnow(),
        floor_pct=floor,
        by_programme=by_programme,
        programme=focus,
        students=student_rows,
        records_total=len(all_statuses),
        pct_present=overall.pct_present,
        scope=scope,
        note=(
            f"Grouped by the student's programme, not by the course — a student's absence "
            f"belongs to the programme that will be asked about it. Late counts as present, "
            f"as it does on every other attendance screen. The percentage divides by the "
            f"registers ACTUALLY TAKEN, not by sessions scheduled, so a programme with few "
            f"records has a fragile figure. Flagged below {floor:g}%, the college's "
            f"configured attendance floor; a programme with no registers taken is never "
            f"flagged."
        ),
    )

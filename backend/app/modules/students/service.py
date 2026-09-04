"""Students service (api-spec §5 Module 3, FR-STU-01..10).

Owns DB access + transactions for the 8 student endpoints; the router is thin.

Cross-cutting discipline honored here (api-spec §3):
  * Server-derived student scope — `/students/me` resolves the profile from the
    token's user, NEVER a client-supplied id (§3.2 hard rule).
  * Teacher scope — a teacher only lists/reads students enrolled in a class they
    own any subject of (`assert_teacher_owns_offering` as a read filter). A student
    a teacher can't reach yields 404, not 403 (§3.3, no existence leak).
  * 404-vs-403 — record-ownership denial → 404; role denial is handled by the
    router's `require_role`.

Uniqueness (`student_number`) is enforced at the DB by a partial-unique index over
live rows (`uq_student_profiles_number WHERE deleted_at IS NULL`). We pre-check for
the documented 409 code; the index is the backstop against a race.

D29 (sixth form): a student sits MANY subject classes, so `current_section` became
`current_offerings` — a list derived from `class_enrollments` (unenrolled_at IS NULL)
joined to `classes` — and the level shown on screen comes from
`student_profiles.year_of_study` rather than from a homeroom's `grade_level`. The target
student id is the enforcement key for grades — this module never fabricates them.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.common.enums import (
    AcademicYearStatus,
    Role,
    StudentStatus,
    normalise_civil_status,
    normalise_gender,
)
from app.common.schemas import AuditStamp, OfferingRef, CourseRef, UserRef
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.rbac import _teacher_profile_id, hod_program_ids
from app.core.timeutil import school_today
from app.modules.assessments import release_nudge
from app.modules.offerings.labels import OFFERING_ORDER, offering_ref
from app.modules.offerings.queries import year_of_offering
from app.modules.offerings.models import ClassEnrollment, Course, CourseOffering
from app.modules.grades import service as grades_service
from app.modules.settings.models import AcademicYear, AuditLog, Semester
from app.modules.students.models import StudentProfile, StudentProgramHistory
from app.modules.students.numbering import allocate_student_number
from app.modules.programs.models import Program
from app.modules.students.schemas import (
    ProgramRef,
    StudentAssessmentGroup,
    StudentAssessmentLine,
    StudentAssessmentsResponse,
    StudentCreateRequest,
    StudentDetail,
    StudentFilterOptions,
    StudentListItem,
    StudentStatusRequest,
    StudentTermGrade,
    StudentUpdateRequest,
    StudentYearItem,
    StudentYearsResponse,
)
from app.modules.users.models import User

# Allowed sort fields for the students list (whitelist — never interpolated, §6).
#
# Each key maps to a TUPLE of columns, because sorting by name is (surname, given
# name) and not a single column (D30 §D10, brief §11). `full_name` and `name` are
# accepted spellings of that same ordering: a caller asking for "the name order" gets
# the register order, never an alphabetical-by-first-name list. The old behaviour —
# ordering on the combined display string — is not reachable any more, and the column
# it read no longer exists (`007_student_names.sql`).
_STUDENT_SORT_FIELDS: dict[str, tuple] = {
    "name": (StudentProfile.last_name, StudentProfile.first_name),
    "full_name": (StudentProfile.last_name, StudentProfile.first_name),
    "last_name": (StudentProfile.last_name, StudentProfile.first_name),
    "first_name": (StudentProfile.first_name, StudentProfile.last_name),
    "student_number": (StudentProfile.student_number,),
    "status": (StudentProfile.status,),
    "year_of_study": (StudentProfile.year_of_study,),
    "created_at": (StudentProfile.created_at,),
}

# Lifecycle transitions (FR-STU-04). A terminal state (graduated / withdrawn /
# transferred / DropOut) may be reactivated to `Registered` (re-admission or a
# correction), but terminal→terminal jumps are disallowed as ambiguous — go via
# `Registered` first. `Unregistered` is the soft pause, reachable from and to any
# non-terminal state.
#
# **D34 renamed the vocabulary and added one state.** `active`→`Registered` and
# `inactive`→`Unregistered` are pure renames and the shape of the graph is unchanged for
# them. `DROPOUT` is genuinely new and is a TERMINAL state: a student who left
# mid-programme has stopped, which is what distinguishes it from `Unregistered` — the
# client's own comment defines that one as "completed the last semester but is not
# continuing", i.e. not a failure. So DropOut sits beside `withdrawn`, reachable from
# either live state and reversible only back to them.
_ALLOWED_STATUS_TRANSITIONS: dict[StudentStatus, set[StudentStatus]] = {
    StudentStatus.REGISTERED: {
        StudentStatus.UNREGISTERED,
        StudentStatus.TRANSFERRED,
        StudentStatus.GRADUATED,
        StudentStatus.WITHDRAWN,
        StudentStatus.DROPOUT,
    },
    StudentStatus.UNREGISTERED: {
        StudentStatus.REGISTERED,
        StudentStatus.TRANSFERRED,
        StudentStatus.GRADUATED,
        StudentStatus.WITHDRAWN,
        StudentStatus.DROPOUT,
    },
    StudentStatus.TRANSFERRED: {StudentStatus.REGISTERED, StudentStatus.UNREGISTERED},
    StudentStatus.GRADUATED: {StudentStatus.REGISTERED, StudentStatus.UNREGISTERED},
    StudentStatus.WITHDRAWN: {StudentStatus.REGISTERED, StudentStatus.UNREGISTERED},
    StudentStatus.DROPOUT: {StudentStatus.REGISTERED, StudentStatus.UNREGISTERED},
}


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
            entity_type="student",
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups + shared shaping
# ──────────────────────────────────────────────────────────────────────────────
def _student_or_404(db: Session, student_id: uuid.UUID) -> StudentProfile:
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.id == student_id,
            StudentProfile.deleted_at.is_(None),
        )
    )
    if student is None:
        raise NotFound("Student not found.", code="not_found")
    return student


def _active_semester_id(db: Session) -> uuid.UUID | None:
    """The single active semester (schema §3.C). None when Settings isn't
    configured — callers treat that as 'no current section' rather than an error
    on read paths."""
    return db.scalar(select(Semester.id).where(Semester.is_active.is_(True)))


def _active_year_id(db: Session) -> uuid.UUID | None:
    """The single active academic year (schema §3.C), or None if unconfigured."""
    return db.scalar(
        select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )


# ──────────────────────────────────────────────────────────────────────────────
# Year → classes resolution (THE single implementation)
# ──────────────────────────────────────────────────────────────────────────────
def student_offerings_in_year(
    db: Session, *, student_id: uuid.UUID, academic_year_id: uuid.UUID
) -> list[tuple[CourseOffering, Course]]:
    """Every offering the student sat in during `academic_year_id`, with its course.

    Returns PAIRS since D31: an offering carries no name, so every caller shaping a wire
    ref needs the `Course` too, and re-fetching it per row would be an N+1 the batched
    list endpoint exists to avoid.

    D29 turned this from `section_in_year` (one homeroom) into a list: a sixth-former
    takes Math-1, Biology-10 and English-5, and returning only the first would have
    hidden most of their record behind an arbitrary tiebreak.

    An academic year spans BOTH semesters, so this resolves through
    `class_enrollments → semesters → academic_years` rather than filtering on a
    single semester, and ended enrollments (`unenrolled_at` set) still count — a
    past year is exactly the case where they are set.

    This is the single implementation of "which classes that year". The student
    detail header (`GET /students/{id}?academic_year_id=`) and the assessments tab
    (`GET /students/{id}/assessments?academic_year_id=`) MUST agree, or one screen
    shows a different set of classes for the same student at the same time.

    It lives here rather than in the Grades module because it is an enrollment
    question, not grade math; `grades.service.student_assessment_groups` takes the
    classes this resolves as a parameter (Students imports Grades, never the
    reverse).
    """
    rows = db.execute(
        select(CourseOffering, Course)
        .join(ClassEnrollment, ClassEnrollment.offering_id == CourseOffering.id)
        .join(Semester, ClassEnrollment.semester_id == Semester.id)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            ClassEnrollment.student_id == student_id,
            Semester.academic_year_id == academic_year_id,
            CourseOffering.deleted_at.is_(None),
        )
        .order_by(*OFFERING_ORDER)
    ).all()
    # DISTINCT in Python, not SQL: a student enrolled in the same class across both
    # semesters yields two rows, and DISTINCT on a whole ORM entity is dialect-fussy.
    seen: dict[uuid.UUID, tuple[CourseOffering, Course]] = {}
    for offering, course in rows:
        seen.setdefault(offering.id, (offering, course))
    return list(seen.values())


def _teacher_owned_offering_ids(
    db: Session, teacher_id: uuid.UUID, offering_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Of `offering_ids`, the ones `teacher_id` is assigned to teach.

    **D42 §3.** A Lecturer reaches a student's profile as soon as they share ONE offering
    with them (`_assert_teacher_can_see_student`). That is the right rule for reachability
    and the wrong one for content: it admitted them to a page that then listed every course
    the student takes and every mark in all of them. The client asked for the narrower
    view — "only theirs" — so both the enrolment list and the assessments tab are filtered
    through here before they are shaped for the wire.

    Returns a SET rather than filtering in SQL because both callers already hold the
    offering rows in memory; re-querying them would cost a round trip to answer a question
    one `IN` can settle.
    """
    if not offering_ids:
        return set()
    from app.modules.offerings.models import ClassTeacher

    return set(
        db.scalars(
            select(ClassTeacher.offering_id).where(
                ClassTeacher.offering_id.in_(offering_ids),
                ClassTeacher.teacher_id == teacher_id,
            )
        ).all()
    )


def _viewer_teacher_id(db: Session, caller: User | None) -> uuid.UUID | None:
    """The lecturer profile id to scope a read by, or None for every other role."""
    if caller is None or caller.role != Role.TEACHER:
        return None
    return _teacher_profile_id(db, caller)


def _assessments_classes(
    db: Session,
    *,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
    viewer_teacher_id: uuid.UUID | None = None,
) -> list[CourseOffering]:
    """The classes that scope the assessments tab.

    `viewer_teacher_id` narrows the result to the offerings that lecturer teaches (D42 §3)
    — applied LAST, after the year resolution below, so a Lecturer sees their own subset of
    exactly the classes a Dean would see for the same year rather than a differently
    resolved set.

    An EXPLICIT year is strict — if the student never sat that year the tab is
    empty, rather than silently answering about a different year. With no year
    asked for we use the active year, falling back to the student's live
    enrollments so a school with no active year configured still renders.

    Drops the `Course` half of what `student_offerings_in_year` returns: the only consumer is
    `grades_service.student_assessment_groups`, which re-resolves the course itself.
    """
    if academic_year_id is not None:
        classes = [
            offering
            for offering, _course in student_offerings_in_year(
                db, student_id=student_id, academic_year_id=academic_year_id
            )
        ]
    else:
        active_year_id = _active_year_id(db)
        classes = (
            [
                offering
                for offering, _course in student_offerings_in_year(
                    db, student_id=student_id, academic_year_id=active_year_id
                )
            ]
            if active_year_id is not None
            else []
        )
        if not classes:
            classes = list(
                db.execute(
                    select(CourseOffering)
                    .join(
                        ClassEnrollment,
                        ClassEnrollment.offering_id == CourseOffering.id,
                    )
                    .join(Course, CourseOffering.course_id == Course.id)
                    .where(
                        ClassEnrollment.student_id == student_id,
                        ClassEnrollment.unenrolled_at.is_(None),
                        CourseOffering.deleted_at.is_(None),
                    )
                    .order_by(*OFFERING_ORDER)
                ).scalars()
            )

    if viewer_teacher_id is not None:
        owned = _teacher_owned_offering_ids(
            db, viewer_teacher_id, [c.id for c in classes]
        )
        classes = [c for c in classes if c.id in owned]
    return classes


def _current_offerings_map(
    db: Session, student_ids: list[uuid.UUID], *, semester_id: uuid.UUID | None
) -> dict[uuid.UUID, list[OfferingRef]]:
    """Batch-resolve each student's active classes for `semester_id` in ONE query
    (avoids N+1 on the list endpoint).

    D29: the value is a LIST, not a single ClassRef — `uq_enroll_active` allows one
    row per (class, student, semester), so a student legitimately has many.
    """
    if not student_ids or semester_id is None:
        return {}
    rows = db.execute(
        select(ClassEnrollment.student_id, CourseOffering, Course)
        .join(CourseOffering, ClassEnrollment.offering_id == CourseOffering.id)
        .join(Course, CourseOffering.course_id == Course.id)
        .where(
            ClassEnrollment.student_id.in_(student_ids),
            ClassEnrollment.semester_id == semester_id,
            ClassEnrollment.unenrolled_at.is_(None),
            CourseOffering.deleted_at.is_(None),
        )
        .order_by(*OFFERING_ORDER)
    ).all()
    out: dict[uuid.UUID, list[OfferingRef]] = {}
    for sid, offering, course in rows:
        out.setdefault(sid, []).append(offering_ref(offering, course))
    return out


def _audit_stamp(db: Session, student: StudentProfile) -> AuditStamp:
    """Resolve the created_by/updated_by actor refs (lightweight join to users).
    Both are nullable (seed/system rows have no human actor, schema §1.3)."""
    actor_ids = {
        i for i in (student.created_by, student.updated_by) if i is not None
    }
    actors: dict[uuid.UUID, UserRef] = {}
    if actor_ids:
        for u in db.execute(
            select(User).where(User.id.in_(actor_ids))
        ).scalars():
            actors[u.id] = UserRef.model_validate(u)
    return AuditStamp(
        created_at=student.created_at,
        updated_at=student.updated_at,
        created_by=actors.get(student.created_by) if student.created_by else None,
        updated_by=actors.get(student.updated_by) if student.updated_by else None,
    )


def _detail(
    db: Session,
    student: StudentProfile,
    *,
    semester_id: uuid.UUID | None,
    academic_year_id: uuid.UUID | None = None,
    viewer_teacher_id: uuid.UUID | None = None,
) -> StudentDetail:
    """Shape a StudentDetail. `current_offerings` is the student's ACTIVE-semester
    subject classes, unless `academic_year_id` is supplied — then it is the classes
    they sat in that year, so the profile header agrees with the assessments tab when
    the year switcher is on a past year.

    The branch is on the PRESENCE of the param, not on resolving-then-falling-back:
    an explicit year the student never sat in yields `[]`, never another year's
    classes.

    `viewer_teacher_id` narrows `current_offerings` to the offerings that lecturer
    teaches (D42 §3). It is a VIEW filter, not an access check — the caller has already
    passed `_assert_teacher_can_see_student`, and this only decides how much of a student
    they were admitted to is theirs to read."""
    detail = StudentDetail.model_validate(student)
    if academic_year_id is not None:
        detail.current_offerings = [
            offering_ref(offering, course)
            for offering, course in student_offerings_in_year(
                db, student_id=student.id, academic_year_id=academic_year_id
            )
        ]
    else:
        detail.current_offerings = _current_offerings_map(
            db, [student.id], semester_id=semester_id
        ).get(student.id, [])
    if viewer_teacher_id is not None:
        owned = _teacher_owned_offering_ids(
            db, viewer_teacher_id, [o.id for o in detail.current_offerings]
        )
        detail.current_offerings = [
            o for o in detail.current_offerings if o.id in owned
        ]
    # The programme is a REF, not the raw uuid: every screen that shows a student shows
    # the code, and making each one fetch `/programs/{id}` to render one chip would be a
    # request per row (D30 §D12).
    if student.program_id is not None:
        program = db.get(Program, student.program_id)
        if program is not None:
            detail.program = ProgramRef(
                id=program.id, code=program.code, name=program.name
            )
    # D33/D34 — the LOGIN address, so the profile can show it. Distinct from
    # `student_profiles.email`, which D34 added as the student's own contact address: a
    # student registered on paper has a contact email and no login at all, and the two
    # must never be conflated (`StudentDetail.login_email` says why).
    if student.user_id is not None:
        account = db.get(User, student.user_id)
        if account is not None:
            detail.login_email = account.email
    detail.audit = _audit_stamp(db, student)
    return detail


def _assert_number_unique(
    db: Session, student_number: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(StudentProfile.id).where(
        func.lower(StudentProfile.student_number) == student_number.strip().lower(),
        StudentProfile.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(StudentProfile.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A student with this student number already exists.",
            code="duplicate_student_number",
        )


# ──────────────────────────────────────────────────────────────────────────────
# GET /students — list (P/S all; Teacher scoped to own sections)
# ──────────────────────────────────────────────────────────────────────────────
def list_students(
    db: Session,
    *,
    caller: User,
    params: PageParams,
    search: str | None,
    status: StudentStatus | None,
    offering_id: uuid.UUID | None,
    year_of_study: str | None,
    academic_year_id: uuid.UUID | None = None,
    religion: str | None = None,
    civil_status: str | None = None,
    gender: str | None = None,
    program_id: uuid.UUID | None = None,
):
    """GET /students (P/S/Teacher). Page[StudentListItem]; default sort by surname.

    Teacher scope (FR-STU-08): restricted to students with an active enrollment in
    an offering the teacher owns — enforced as a read filter, so a teacher
    literally cannot page students outside their own offerings.

    D29: the level filter is `year_of_study` and reads `student_profiles.year_of_study`
    directly. It used to be `grade_level` resolved through the student's homeroom,
    which under a sixth-form model would have answered "which of their subject classes
    is labelled Lower 6" instead of "which level is this student in".

    `academic_year_id` (the module year switcher) FILTERS the student set: a PAST
    year restricts the directory to the students enrolled that year. It
    deliberately does NOT rescope each row's `offering_count`, which stays the student's
    live load — the field describes the present.

    The ACTIVE year (or no year at all) applies NO enrollment filter, so the full
    directory still lists — including graduated / withdrawn / transferred students
    who hold no active enrollment. Filtering on the active year would quietly empty
    the `status=graduated` view (mock: `academic_year_id !== activeYearId`).
    """
    semester_id = _active_semester_id(db)
    # Only a PAST year scopes the roster; the active year means "the directory".
    past_year_id = (
        academic_year_id
        if academic_year_id is not None and academic_year_id != _active_year_id(db)
        else None
    )

    stmt = select(StudentProfile).where(StudentProfile.deleted_at.is_(None))

    if status is not None:
        stmt = stmt.where(StudentProfile.status == status)

    if search:
        like = f"%{search.strip()}%"
        # `full_name` is the hybrid (D30 §D10) and compiles to CONCAT_WS, so typing a
        # name in full still matches. The individual parts are matched too, because
        # the register is surname-first and a Registrar searching "Perez Ana" would
        # otherwise get nothing.
        stmt = stmt.where(
            StudentProfile.full_name.ilike(like)
            | StudentProfile.first_name.ilike(like)
            | StudentProfile.last_name.ilike(like)
            | StudentProfile.student_number.ilike(like)
        )

    if year_of_study is not None:
        stmt = stmt.where(StudentProfile.year_of_study == year_of_study)

    # D32 (brief §3) — three more attribute filters. Plain WHERE clauses on
    # `student_profiles`, so they compose with each other AND with everything above
    # without any structural change; "all Female students in Programme X" is just two of
    # them ANDed, which is what the brief's worked examples ask for.
    #
    # They deliberately do NOT touch the enrolment scope below. These are facts about the
    # PERSON, so a graduated or withdrawn student still matches — filtering them through
    # enrolment would quietly empty a `status=graduated` view, the same trap the
    # `academic_year_id` note above records.
    if gender is not None:
        stmt = stmt.where(StudentProfile.gender == gender)

    if religion is not None:
        # Exact match, not a LIKE. The values come from the `religions` table (D39) plus
        # whatever `/students/filter-options` still reports as present, so a substring
        # match would only ever conflate two real values ("Catholic" swallowing "Roman
        # Catholic").
        stmt = stmt.where(StudentProfile.religion == religion)

    if civil_status is not None:
        # D40. Exact match for the same reason, and safe to keep exact because the write
        # path normalises: `normalise_civil_status` folds 'single' onto 'Single' on every
        # save, so the four canonical values are what the column holds going forward.
        #
        # A row this system never wrote can still hold something else, which is why the
        # dropdown carries a stored value it does not offer as an "(as recorded)" option
        # rather than dropping it — an unfilterable value would be an invisible student.
        stmt = stmt.where(StudentProfile.civil_status == civil_status)

    if program_id is not None:
        # `student_profiles.program_id` — the CURRENT programme. Not
        # `student_program_history`, which would also match a programme the student has
        # since left, and "print all students in Programme X" means the ones in it now.
        stmt = stmt.where(StudentProfile.program_id == program_id)

    if caller.role == Role.HOD:
        # D43 — a head sees the students OF THEIR PROGRAMME, which is a different
        # question from the lecturer scope below and is answered by a different column.
        # A lecturer sees students they SHARE AN OFFERING with (enrolment); a head sees
        # everyone reading for the degree they run, including a first-year who has not
        # been enrolled in anything yet. Routing this through the enrolment EXISTS would
        # have silently dropped exactly those students.
        #
        # Combines with an explicit `program_id` filter by intersection: a head who
        # filters to a programme they do not head correctly gets nothing.
        stmt = stmt.where(StudentProfile.program_id.in_(hod_program_ids(db, caller)))

    # Offering filter and teacher scope constrain via class_enrollments → offerings.
    # We
    # build an EXISTS correlated subquery so a student appears once regardless of how
    # the joins fan out — which matters much more under D29, where a student has many
    # enrollments and a plain join would return them once per class.
    needs_enrollment_scope = (
        past_year_id is not None
        or offering_id is not None
        or caller.role == Role.TEACHER
    )
    if needs_enrollment_scope:
        enr = (
            select(ClassEnrollment.id)
            .join(CourseOffering, ClassEnrollment.offering_id == CourseOffering.id)
            .where(
                ClassEnrollment.student_id == StudentProfile.id,
                CourseOffering.deleted_at.is_(None),
            )
        )
        if past_year_id is not None:
            # Historical roster: any semester of that year, and ENDED enrollments
            # count — `unenrolled_at` being set is the normal state for a past
            # year, so requiring it NULL would return an empty directory.
            enr = enr.where(
                ClassEnrollment.semester_id.in_(
                    select(Semester.id).where(
                        Semester.academic_year_id == past_year_id
                    )
                )
            )
        else:
            # Live view: constrain to the active semester when known so section /
            # grade filters and teacher scope reflect the current term.
            enr = enr.where(ClassEnrollment.unenrolled_at.is_(None))
            if semester_id is not None:
                enr = enr.where(ClassEnrollment.semester_id == semester_id)
        if offering_id is not None:
            enr = enr.where(CourseOffering.id == offering_id)

        if caller.role == Role.TEACHER:
            teacher_id = _teacher_profile_id(db, caller)
            enr = _apply_teacher_ownership(enr, teacher_id)

        stmt = stmt.where(enr.exists())

    sort = (params.sort or "name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    cols = _STUDENT_SORT_FIELDS.get(key)
    if cols is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(
        *[c.desc() if desc else c.asc() for c in cols], StudentProfile.id.asc()
    )

    page = paginate(db, stmt, params, serialize=StudentListItem.model_validate)

    # Attach offering_count to each item in ONE batched query (no N+1).
    #
    # D42 §3 — counted through the caller's own lens. The directory's "Courses" column is
    # the same fact the profile's enrolment list shows, and that list is now scoped to a
    # Lecturer's own offerings: leaving the count global would have printed 4 in the
    # directory and 1 on the profile of the same student, which reads as a bug rather than
    # as a rule. One extra query for the whole page, and only for a Lecturer.
    ids = [item.id for item in page.items]
    offerings_map = _current_offerings_map(db, ids, semester_id=semester_id)
    viewer_teacher_id = _viewer_teacher_id(db, caller)
    owned_offering_ids: set[uuid.UUID] | None = None
    if viewer_teacher_id is not None:
        owned_offering_ids = _teacher_owned_offering_ids(
            db,
            viewer_teacher_id,
            [o.id for refs in offerings_map.values() for o in refs],
        )
    for item in page.items:
        refs = offerings_map.get(item.id, [])
        if owned_offering_ids is not None:
            refs = [o for o in refs if o.id in owned_offering_ids]
        item.offering_count = len(refs)

    # D32 — programme CODE for the printed list. One query for the whole page, not one
    # per row: the print view raises `page_size` to cover the entire filtered result, so
    # a per-row lookup here would be an N+1 over the full directory rather than over 25.
    _attach_program_codes(db, page.items)
    return page


def _attach_program_codes(db: Session, items: list[StudentListItem]) -> None:
    """Resolve `program_code` for a page of rows in one query (D32, brief §3)."""
    if not items:
        return
    program_ids = {
        pid
        for pid in db.scalars(
            select(StudentProfile.program_id).where(
                StudentProfile.id.in_([i.id for i in items]),
                StudentProfile.program_id.is_not(None),
            )
        ).all()
        if pid is not None
    }
    if not program_ids:
        return
    codes = dict(
        db.execute(
            select(Program.id, Program.code).where(Program.id.in_(program_ids))
        ).all()
    )
    by_student = dict(
        db.execute(
            select(StudentProfile.id, StudentProfile.program_id).where(
                StudentProfile.id.in_([i.id for i in items])
            )
        ).all()
    )
    for item in items:
        pid = by_student.get(item.id)
        item.program_code = codes.get(pid) if pid is not None else None


def _distinct_present(db: Session, column) -> list[str]:
    """DISTINCT non-null, non-blank values of one `student_profiles` column, sorted.

    Soft-deleted students are excluded, so a value that only ever belonged to a removed
    record does not linger as a filter option matching nothing.

    **`DISTINCT` here is case-INSENSITIVE**, because the collation is
    (`utf8mb4_uca1400_ai_ci`): 'Single' and 'single' collapse into one row and MariaDB
    returns whichever it saw first. That is fine for what this list is FOR — it feeds a
    dropdown whose options are compared against the same collation on the way back — but
    it is why this cannot be used to audit for case drift. `GROUP BY HEX(col)` is the
    query for that.
    """
    return [
        v
        for v in db.scalars(
            select(column)
            .where(
                StudentProfile.deleted_at.is_(None),
                column.is_not(None),
                column != "",
            )
            .distinct()
            .order_by(column.asc())
        ).all()
        if v
    ]


def filter_options(db: Session) -> StudentFilterOptions:
    """GET /students/filter-options — the free-text values actually present (D32, D40).

    Derived rather than hardcoded because both columns are free text; see
    `StudentFilterOptions` for what the two lists are now for, which is narrower than it
    was: the dropdowns lead with their vocabularies (the `religions` table, `CivilStatus`)
    and use these to keep a legacy value selectable rather than to build the list.
    """
    return StudentFilterOptions(
        religions=_distinct_present(db, StudentProfile.religion),
        civil_statuses=_distinct_present(db, StudentProfile.civil_status),
    )


def _apply_teacher_ownership(enr_stmt, teacher_id: uuid.UUID):
    """Constrain an enrollment subquery to offerings this teacher is assigned to.

    **The correlation is the whole filter.** `ClassTeacher.offering_id ==
    ClassEnrollment.offering_id` is what makes this mean "the teacher owns THIS
    enrollment's offering". Without it the EXISTS reads "this teacher owns something,
    somewhere", which is true for every assigned teacher — so the directory would return
    the whole school to anyone who teaches one class. D31 dropped the correlation when
    `class_subjects` went away and the join it used to hang off went with it.

    Built as `select(...).where(...).exists()` — the `exists().select_from(...).join(...)`
    form is NOT valid (Exists has no `.join`).
    """
    from app.modules.offerings.models import ClassTeacher

    ownership = (
        select(ClassTeacher.id)
        .where(
            ClassTeacher.offering_id == ClassEnrollment.offering_id,
            ClassTeacher.teacher_id == teacher_id,
        )
        .exists()
    )
    return enr_stmt.where(ownership)


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/{id} — detail
# ──────────────────────────────────────────────────────────────────────────────
def get_student(
    db: Session,
    *,
    caller: User,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None = None,
) -> StudentDetail:
    """GET /students/{id} (P/S any; Teacher must own a class the student is in →
    else 404, §3.3).

    `academic_year_id` rescopes `current_offerings` to the offerings the student sat in
    that year (the profile page's year switcher). RBAC is unaffected — the teacher
    ownership check is still evaluated against the student's LIVE enrollments, so
    selecting a past year can never widen a teacher's reach.
    """
    student = _student_or_404(db, student_id)
    _assert_caller_can_see_student(db, caller, student)
    return _detail(
        db,
        student,
        semester_id=_active_semester_id(db),
        academic_year_id=academic_year_id,
        viewer_teacher_id=_viewer_teacher_id(db, caller),
    )


def _assert_teacher_can_see_student(
    db: Session, caller: User, student_id: uuid.UUID
) -> None:
    """Teacher may see a student iff they share a section (any subject the teacher
    owns) via an ACTIVE enrollment. Denial → 404 (no existence leak, §3.3)."""
    from app.modules.offerings.models import ClassTeacher

    teacher_id = _teacher_profile_id(db, caller)
    shares = db.scalar(
        select(ClassEnrollment.id)
        .join(CourseOffering, CourseOffering.id == ClassEnrollment.offering_id)
        .join(ClassTeacher, ClassTeacher.offering_id == CourseOffering.id)
        .where(
            ClassEnrollment.student_id == student_id,
            ClassEnrollment.unenrolled_at.is_(None),
            CourseOffering.deleted_at.is_(None),
            ClassTeacher.teacher_id == teacher_id,
        )
        .exists()
        .select()
    )
    if not shares:
        raise NotFound("Student not found.", code="not_found")


def _assert_caller_can_see_student(
    db: Session, caller: User, student: StudentProfile
) -> None:
    """Reachability for a single student, per role (D43).

    Dean, Registrar and Auditor reach anyone and return early. The two scoped roles:

      * **Lecturer** — shares an active enrolment in an offering they teach.
      * **HOD** — the student is reading for a programme they head, OR they teach them.

    The second clause of the HOD rule is not redundant. A head also teaches, and their
    teaching is not confined to their own programme: a Business head taking a shared GEC
    course must still reach the Primary Education students sitting in it. Dropping it
    would take reach AWAY from a promoted lecturer, which is the opposite of what the
    promotion means.

    The programme test comes first because it is one query against a column already
    loaded, where the ownership test is a three-table join.

    Denial is the lecturer guard's 404, byte-identical to "no such student" (§3.3).
    """
    if caller.role == Role.TEACHER:
        _assert_teacher_can_see_student(db, caller, student.id)
        return
    if caller.role == Role.HOD:
        if student.program_id is not None and student.program_id in set(
            hod_program_ids(db, caller)
        ):
            return
        _assert_teacher_can_see_student(db, caller, student.id)


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/me — self (server-derived scope)
# ──────────────────────────────────────────────────────────────────────────────
def _my_student_or_404(db: Session, caller: User) -> StudentProfile:
    """The profile linked to the token's user (§3.2 hard rule — never a client id)."""
    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == caller.id,
            StudentProfile.deleted_at.is_(None),
        )
    )
    if student is None:
        raise NotFound(
            "No student profile is linked to this account.",
            code="no_student_profile",
        )
    return student


def get_my_student(
    db: Session, *, caller: User, academic_year_id: uuid.UUID | None = None
) -> StudentDetail:
    """GET /students/me (student). Scope is derived from the token's user, NEVER a
    client id (§3.2 hard rule). 404 no_student_profile if the login isn't linked.

    `academic_year_id` rescopes `current_offerings` to the offerings this student sat in
    that year, so their "My Profile" header agrees with the year·semester switcher
    instead of always showing their current load. Identical to the `academic_year_id`
    handling in `get_student` — and equally unable to affect WHICH student is read,
    since that comes from `caller` alone."""
    student = _my_student_or_404(db, caller)
    semester_id = _active_semester_id(db)
    return _detail(
        db, student, semester_id=semester_id, academic_year_id=academic_year_id
    )


# ──────────────────────────────────────────────────────────────────────────────
# POST /students — create (+ optional enroll into subject classes, one txn)
# ──────────────────────────────────────────────────────────────────────────────
#: The admission-form columns a student record carries (D30 §D11, D33) — the fields
#: `_AdmissionProfileFields` declares, in the order the paper form prints them.
#:
#: Iterated rather than assigned one line at a time because create, update and the
#: acceptance path in `admissions/service.py` all copy the same set, and three
#: hand-written lists of nineteen names is three chances to forget one. Everything here
#: is a plain scalar with no cross-field rule, which is what makes a loop safe; anything
#: that needs validation or a side effect (`program_id`, `status`, the two dates) is
#: handled explicitly and is deliberately NOT in this list.
ADMISSION_PROFILE_FIELDS: tuple[str, ...] = (
    "ssno",
    "civil_status",
    "religion",
    "street",
    "city_town_village",
    "district",
    "mother_name",
    "father_name",
    "nok_name",
    "nok_relationship",
    "nok_phone",
    "has_health_condition",
    "health_condition_note",
    "atlib_exam",
    "num_csec",
    "finance_name",
    "finance_phone",
    "finance_email",
    "enrollment_load",
    # ── D34 · reconciled from the client's own schema (`011`) ─────────────────
    # `educationbg_id` and `doc_id` are deliberately ABSENT: they are mapped for the
    # client's tooling and are read-only on the wire, so nothing here should write them.
    "student_id_original",
    "email",
    "transferred_from",
    "graduation_date",
    "dropout_date",
    "dropout_reason",
    "comments",
    "origin",
)


def create_student(
    db: Session, *, actor: User, payload: StudentCreateRequest
) -> StudentDetail:
    """POST /students (P/S). Optionally enrols into every offering in `offering_ids` for
    the active semester in the same transaction (FR-STU-05).

    `offering_ids` is a list, so registering a student and their whole course
    load is one call. All-or-nothing — if any class is missing or archived the whole
    create rolls back, rather than leaving a student half-enrolled.

    D30: `student_number` is optional. Omitted, the server issues the next
    `YYYYMM###` for the school-local month (§D9) — generation is server-side only, so
    a client cannot pick its own place in the sequence.

    Errors: 409 duplicate_student_number, 409 student_number_exhausted, 409
    section_archived, 422 (e.g. DOB in the future — handled at the schema/validation
    layer below), 404 section.
    """
    if payload.date_of_birth > _now().date():
        raise ValidationError(
            "date_of_birth cannot be in the future.",
            fields={"date_of_birth": ["Cannot be in the future."]},
        )

    # D33 — resolved BEFORE the insert, not after it. `program_id` is a real FK, so an
    # unknown id reaches the database as an `IntegrityError` on flush (a 500) rather than
    # the clean 404 below. Validating first is what makes the error legible, and it also
    # means a bad programme aborts the create without burning a student number.
    program: Program | None = None
    if payload.program_id is not None:
        program = db.scalar(
            select(Program).where(
                Program.id == payload.program_id, Program.deleted_at.is_(None)
            )
        )
        if program is None:
            raise NotFound("Programme not found.", code="program_not_found")

    if payload.student_number is None:
        # Allocated inside THIS transaction, before the insert below, so a failed
        # registration rolls the sequence back with it and no number is burnt.
        student_number = allocate_student_number(db)
    else:
        student_number = payload.student_number.strip()
        _assert_number_unique(db, student_number)

    student = StudentProfile(
        student_number=student_number,
        first_name=payload.first_name.strip(),
        middle_name=(payload.middle_name or "").strip() or None,
        last_name=payload.last_name.strip(),
        date_of_birth=payload.date_of_birth,
        # D37 — folded onto the canonical lowercase vocabulary. The column is free text
        # (and stays so, for historical rows), so this is where consistency is enforced.
        gender=normalise_gender(payload.gender),
        year_of_study=payload.year_of_study,
        enrollment_date=payload.enrollment_date,
        status=payload.status,
        guardian_name=payload.guardian_name,
        guardian_phone=payload.guardian_phone,
        guardian_email=payload.guardian_email,
        address=payload.address,
        phone=payload.phone,
        # D33 — the registration form IS the application form (ask 3), so create writes
        # the same Sections A–E the acceptance path does.
        #
        # D40 — `civil_status` comes out of that loop already normalised. It is the one
        # member of the set with a vocabulary behind it, and it is handled here rather
        # than inside `ADMISSION_PROFILE_FIELDS` because that tuple's contract is
        # "plain scalars, copied verbatim" — putting a transform inside the loop would
        # make every other field's behaviour a question.
        **{
            f: (
                normalise_civil_status(getattr(payload, f))
                if f == "civil_status"
                else getattr(payload, f)
            )
            for f in ADMISSION_PROFILE_FIELDS
        },
        program_id=payload.program_id,
        created_by=actor.id,
    )
    db.add(student)
    db.flush()  # assign student.id

    # D33 — a programme assigned at registration opens its history row on day one, the
    # same way acceptance does (`admissions/service.py` step 4). Without this the column
    # would be set while `student_program_history` stayed empty, and the Academic-history
    # panel — which reads the history, not the column — would show a student on no
    # programme at all. CHANGING it later is still Dean-only (`PUT /students/{id}/program`).
    if program is not None:
        db.add(
            StudentProgramHistory(
                student_id=student.id,
                program_id=program.id,
                started_at=payload.enrollment_date,
                reason="Registered",
                created_by=actor.id,
            )
        )

    semester_id: uuid.UUID | None = None
    if payload.offering_ids:
        for offering_id in dict.fromkeys(payload.offering_ids):
            semester_id = _enroll_into_section(
                db, actor=actor, student=student, section_id=offering_id
            )
    else:
        semester_id = _active_semester_id(db)

    _audit(
        db,
        actor=actor,
        action="student.create",
        entity_id=student.id,
        summary={"student_number": student.student_number},
    )
    db.commit()
    return _detail(db, student, semester_id=semester_id)


def _enroll_into_section(
    db: Session, *, actor: User, student: StudentProfile, section_id: uuid.UUID
) -> uuid.UUID:
    """Enroll `student` into one subject class for the active semester (FR-STU-05).

    Guards: the class must exist (live), its academic year must not be archived
    (else 409 section_archived), and there must be an active semester. Returns the
    active semester id so the caller can shape `current_offerings`.

    Purely additive, like `classes.service.enroll_students` — it never closes another
    enrollment, so calling it once per offering in `offering_ids` builds up the student's
    whole subject load.
    """
    section = db.scalar(
        select(CourseOffering).where(CourseOffering.id == section_id, CourseOffering.deleted_at.is_(None))
    )
    if section is None:
        raise NotFound("Class not found.", code="section_not_found")

    year = year_of_offering(db, section)
    if section.is_archived or (year is not None and year.archived_at is not None):
        raise Conflict(
            "Cannot enroll into a class of an archived year.",
            code="section_archived",
        )

    semester_id = _active_semester_id(db)
    if semester_id is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")

    # D30 §D4 — the same prerequisite gate the Offerings module applies. It has to be
    # here too: registering a student with `offering_ids` enrols them without ever
    # touching `POST /offerings/{id}/enrollments`, so gating only there would leave the
    # rule enforceable from one door and not the other.
    #
    # Imported inside the function — `prerequisites.service` reads grades, which reads
    # students, and a module-level import would close the cycle.
    from app.modules.offerings import service as offerings_service
    from app.modules.prerequisites import service as prereq_service

    course_id = offerings_service.course_id_for_offering(db, section.id)
    if course_id is not None:
        prereq_service.assert_eligible(
            db, student=student, course_id=course_id, semester_id=semester_id
        )

    db.add(
        ClassEnrollment(
            offering_id=section.id,
            student_id=student.id,
            semester_id=semester_id,
            created_by=actor.id,
        )
    )
    return semester_id


# ──────────────────────────────────────────────────────────────────────────────
# PATCH /students/{id} — edit (status NOT editable here)
# ──────────────────────────────────────────────────────────────────────────────
def update_student(
    db: Session, *, actor: User, student_id: uuid.UUID, payload: StudentUpdateRequest
) -> StudentDetail:
    """PATCH /students/{id} (P/S). Partial update of profile fields; `status` is
    handled by POST /students/{id}/status only. Re-checks student_number uniqueness
    on change."""
    student = _student_or_404(db, student_id)

    if (
        payload.student_number is not None
        and payload.student_number.strip().lower() != student.student_number.lower()
    ):
        _assert_number_unique(db, payload.student_number, exclude_id=student.id)
        student.student_number = payload.student_number.strip()

    if payload.date_of_birth is not None:
        if payload.date_of_birth > _now().date():
            raise ValidationError(
                "date_of_birth cannot be in the future.",
                fields={"date_of_birth": ["Cannot be in the future."]},
            )
        student.date_of_birth = payload.date_of_birth

    if payload.first_name is not None:
        student.first_name = payload.first_name.strip()
    if payload.middle_name is not None:
        # "" clears it — a middle name a Registrar entered by mistake has to be
        # removable, and NULL is the right stored value, not an empty string.
        student.middle_name = payload.middle_name.strip() or None
    if payload.last_name is not None:
        student.last_name = payload.last_name.strip()
    if payload.gender is not None:
        student.gender = normalise_gender(payload.gender)
    if payload.year_of_study is not None:
        student.year_of_study = payload.year_of_study
    if payload.enrollment_date is not None:
        student.enrollment_date = payload.enrollment_date
    if payload.guardian_name is not None:
        student.guardian_name = payload.guardian_name
    if payload.guardian_phone is not None:
        student.guardian_phone = payload.guardian_phone
    if payload.guardian_email is not None:
        student.guardian_email = payload.guardian_email
    if payload.address is not None:
        student.address = payload.address
    if payload.phone is not None:
        student.phone = payload.phone

    # D33 — the rest of the application form. PRESENCE, not truthiness: `None` on a
    # PATCH means "not supplied", and for the two booleans that distinction is the whole
    # game. `has_health_condition=False` has to be writable — a condition entered by
    # mistake must be removable — and `if payload.x is not None` cannot express that for
    # a bool, which is why this arm reads `model_fields_set` instead.
    supplied = payload.model_fields_set
    for field in ADMISSION_PROFILE_FIELDS:
        if field not in supplied:
            continue
        value = getattr(payload, field)
        if field in ("has_health_condition", "atlib_exam") and value is None:
            # Explicitly sent as null. The column is NOT NULL, so read it as "no".
            value = False
        if field == "civil_status":
            # D40 — the same fold `create_student` applies, for the same reason
            # `gender` is normalised two arms above: the column is free text, so the
            # write path is the only place consistency can be enforced.
            value = normalise_civil_status(value)
        setattr(student, field, value)

    student.updated_by = actor.id
    _audit(db, actor=actor, action="student.update", entity_id=student.id)
    db.commit()
    return _detail(db, student, semester_id=_active_semester_id(db))


# ──────────────────────────────────────────────────────────────────────────────
# POST /students/{id}/status — lifecycle change (auditable, guarded)
# ──────────────────────────────────────────────────────────────────────────────
def change_student_status(
    db: Session,
    *,
    actor: User,
    student_id: uuid.UUID,
    payload: StudentStatusRequest,
) -> StudentDetail:
    """POST /students/{id}/status (P/S). Validates the transition (FR-STU-04) and
    records before/after in the audit log. 422 invalid_transition on an illegal
    move."""
    student = _student_or_404(db, student_id)
    before = student.status
    after = payload.status

    if before != after:
        allowed = _ALLOWED_STATUS_TRANSITIONS.get(before, set())
        if after not in allowed:
            raise ValidationError(
                f"Cannot change status from '{before.value}' to '{after.value}'.",
                code="invalid_transition",
                fields={"status": [f"Invalid transition from {before.value}."]},
            )
        student.status = after

        # D34 — stamp the date the new state is ABOUT. `011` added both columns from the
        # client's schema, and a column nothing ever writes is a column that is always
        # NULL (which is what happened to `report_card_snapshots.storage_key` until D32
        # gave it a reader). Only filled when EMPTY, so a Registrar who corrected the date
        # by hand does not have it overwritten by a later status shuffle; and only on the
        # transition INTO the state, so re-registering a graduate keeps the graduation on
        # file rather than erasing it.
        if after == StudentStatus.GRADUATED and student.graduation_date is None:
            student.graduation_date = school_today()
        if after == StudentStatus.DROPOUT and student.dropout_date is None:
            student.dropout_date = _now()
        # The reason travels with the state it explains. `reason` is already recorded on
        # the audit row for every transition; this copies it onto the record only for the
        # one state that has a column for it, so "why did they leave" is answerable from
        # the student rather than by reading the audit log.
        if after == StudentStatus.DROPOUT and payload.reason and not student.dropout_reason:
            student.dropout_reason = payload.reason[:250]

    student.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="student.status_change",
        entity_id=student.id,
        summary={
            "before": before.value,
            "after": after.value,
            "reason": payload.reason,
        },
    )
    db.commit()
    return _detail(db, student, semester_id=_active_semester_id(db))


# ──────────────────────────────────────────────────────────────────────────────
# DELETE /students/{id} — soft-delete only if no academic history
# ──────────────────────────────────────────────────────────────────────────────
def delete_student(db: Session, *, actor: User, student_id: uuid.UUID) -> None:
    """DELETE /students/{id} (P/S). Soft-delete ONLY IF the student has no academic
    history (any assessment_grades / attendance_records) — those FKs are RESTRICT
    (FR-STU-10). Else 409 has_academic_history ('deactivate instead')."""
    student = _student_or_404(db, student_id)

    if _has_academic_history(db, student.id):
        raise Conflict(
            "This student has grade or attendance history — deactivate instead.",
            code="has_academic_history",
        )

    student.deleted_at = _now()
    student.updated_by = actor.id
    _audit(db, actor=actor, action="student.delete", entity_id=student.id)
    db.commit()


def _has_academic_history(db: Session, student_id: uuid.UUID) -> bool:
    """True if the student is referenced by any grade or attendance record. Import
    locally to avoid a heavy import at module load and keep boundaries clean."""
    from app.modules.attendance.models import AttendanceRecord
    from app.modules.grades.models import AssessmentGrade

    has_grade = db.scalar(
        select(exists().where(AssessmentGrade.student_id == student_id))
    )
    if has_grade:
        return True
    has_attendance = db.scalar(
        select(exists().where(AttendanceRecord.student_id == student_id))
    )
    return bool(has_attendance)


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/{id}/assessments — grouped by offering, with the term grade
# ──────────────────────────────────────────────────────────────────────────────
def list_student_assessments(
    db: Session,
    *,
    caller: User,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID | None,
) -> StudentAssessmentsResponse:
    """GET /students/{id}/assessments (P/S any; Teacher must own a class the
    student is in → else 404, §3.3).

    A student-DETAIL read for an admin/teacher viewer (a student self uses
    `GET /grades/me`). Returns `{items:[...]}` grouped by `class_subject`, each
    group carrying the subject label, the student's term grade and the per-
    assessment lines with that student's own grade status/score.

    `academic_year_id` scopes to the classes the student sat that YEAR — a year
    spans both semesters, so this is deliberately NOT a semester filter. The
    resolution is `student_offerings_in_year`, the SAME helper `GET /students/{id}` uses, so
    the profile header and this tab can never disagree about which classes the
    student sat in. Under D29 that is a LIST, so the tab spans every subject class
    the student takes rather than the subjects of one homeroom.

    All loading + arithmetic is delegated to
    `grades.service.student_assessment_groups`, which routes the term grade through
    the single engine in `grades/calc.py`. This function only resolves the classes
    and maps the dataclasses it returns onto the Students wire schema.
    """
    student = _student_or_404(db, student_id)
    _assert_caller_can_see_student(db, caller, student)

    sections = _assessments_classes(
        db,
        student_id=student.id,
        academic_year_id=academic_year_id,
        viewer_teacher_id=_viewer_teacher_id(db, caller),
    )
    groups = grades_service.student_assessment_groups(
        db, student_id=student.id, sections=sections
    )
    return StudentAssessmentsResponse(
        items=[
            StudentAssessmentGroup(
                offering_id=g.offering_id,
                subject=CourseRef(
                    id=g.subject_id, name=g.subject_name, code=g.subject_code
                ),
                term_grade=StudentTermGrade(
                    numeric=g.term_numeric, letter=g.term_letter
                ),
                assessments=[
                    StudentAssessmentLine(
                        id=line.id,
                        title=line.title,
                        type=line.type,
                        max_score=line.max_score,
                        weight=line.weight,
                        assessment_date=line.assessment_date,
                        status=line.status,
                        score=line.score,
                        is_released=line.is_released,
                        last_nudged_at=line.last_nudged_at,
                    )
                    for line in g.assessments
                ],
            )
            for g in groups
        ],
        nudge_cooldown_seconds=release_nudge.NUDGE_COOLDOWN_SECONDS,
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /students/{id}/years + GET /students/me/years — the year switcher
# ──────────────────────────────────────────────────────────────────────────────
def _years_for_student(
    db: Session, student_id: uuid.UUID, *, viewer_teacher_id: uuid.UUID | None = None
) -> list[AcademicYear]:
    """Academic years the student was ACTUALLY enrolled in, newest first.

    `viewer_teacher_id` narrows it to the years that lecturer taught them in (D42 §3).
    Without it the switcher offered a Lecturer years in which every tab below would be
    empty, which reads as a broken screen rather than as a scoping rule.

    Resolved through `class_enrollments → semesters → academic_years`. Ended
    enrollments count (`unenrolled_at` is not filtered) — the whole point of the
    switcher is to reach past years. The year id set is an IN-subquery rather than
    a DISTINCT over a joined entity select, so the ordering columns stay
    unambiguous across dialects.
    """
    enrolled_year_ids = (
        select(Semester.academic_year_id)
        .join(ClassEnrollment, ClassEnrollment.semester_id == Semester.id)
        .where(ClassEnrollment.student_id == student_id)
    )
    if viewer_teacher_id is not None:
        from app.modules.offerings.models import ClassTeacher

        enrolled_year_ids = enrolled_year_ids.where(
            select(ClassTeacher.id)
            .where(
                ClassTeacher.offering_id == ClassEnrollment.offering_id,
                ClassTeacher.teacher_id == viewer_teacher_id,
            )
            .exists()
        )
    return list(
        db.scalars(
            select(AcademicYear)
            .where(AcademicYear.id.in_(enrolled_year_ids))
            .order_by(AcademicYear.start_date.desc(), AcademicYear.name.desc())
        ).all()
    )


def _years_response(
    db: Session, student_id: uuid.UUID, *, viewer_teacher_id: uuid.UUID | None = None
) -> StudentYearsResponse:
    return StudentYearsResponse(
        items=[
            StudentYearItem.model_validate(y)
            for y in _years_for_student(
                db, student_id, viewer_teacher_id=viewer_teacher_id
            )
        ]
    )


def list_student_years(
    db: Session, *, caller: User, student_id: uuid.UUID
) -> StudentYearsResponse:
    """GET /students/{id}/years (P/S any; Teacher must own a section the student is
    in → else 404, §3.3). Students are denied at the role gate → use /me/years."""
    student = _student_or_404(db, student_id)
    _assert_caller_can_see_student(db, caller, student)
    return _years_response(
        db, student.id, viewer_teacher_id=_viewer_teacher_id(db, caller)
    )


def list_my_years(db: Session, *, caller: User) -> StudentYearsResponse:
    """GET /students/me/years (student). Server-derived scope (§3.2) — the profile
    comes from the token, never a param. 404 no_student_profile if unlinked, the
    same contract as GET /students/me."""
    student = _my_student_or_404(db, caller)
    return _years_response(db, student.id)

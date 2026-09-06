"""Academic-structure models — the TERTIARY offering model (D31).

`courses` (the catalog — `Course`), `course_offerings` (one course scheduled in one
semester — `CourseOffering`), `class_teachers` (lecturer assignment), `class_enrollments`
(a student's registration in one offering), `class_meetings` (the weekly day/time/room
that builds each timetable).

WHAT D31 CHANGED, AND WHY

    D29 (2026-08-06) reframed `classes` from "homeroom that teaches many subjects" to "one
    subject class", and D30 made the catalog and curriculum tertiary. But the offering
    layer stayed K-12 in three ways, all three fixed by `008_course_offerings.sql`:

    1. `classes` was scoped to an academic YEAR and had no `semester_id`. That is the
       homeroom assumption: a Form 1A lasts a school year. An offering is a SEMESTER
       thing — "Programming I, Semester 1 2026" and "Programming I, Semester 2 2026" are
       two offerings, and the old shape could only tell them apart by two same-year rows
       with different names. Every child (`class_enrollments`, `assessments`,
       `term_grade_snapshots`) already carried `semester_id`: the term was tracked
       everywhere except on the thing being offered.

    2. `classes.grade_level` was NOT NULL and held `Form 1`..`Form 4`, so every offering
       had to declare a Form. `section`, `homeroom_label`, `numStudents` and
       `classStaffID` went with it.

    3. `class_subjects` was a many-to-many that only made sense while one homeroom taught
       seven subjects — all 17 live `classes` rows had ~7 courses attached. **One offering
       teaches ONE course**, so the join table became a column: `course_offerings.course_id`.

    `Class` and `CourseOffering` are therefore GONE, merged into `CourseOffering`. Children
    that keyed off `offering_id` (or `class_id`) now key off `offering_id`.

    `ClassTeacher`, `ClassEnrollment` and `ClassMeeting` keep their names because their
    TABLES keep their names (`class_teachers`, `class_enrollments`, `class_meetings`).
    Renaming those tables was not in D31's approved scope, and an ORM class whose name
    disagrees with its table is worse than one carrying a historical prefix.

    `program_courses` is untouched and lives in `app/modules/programs/models.py`. A
    programme PRESCRIBES courses (curriculum); an offering SCHEDULES one (calendar).
    Those are different facts and deliberately stay in different tables.
"""

from __future__ import annotations

import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import CourseComponent, EnrollmentStatus
from app.db.base import AuditMixin, Base, SoftDeleteMixin, TimestampMixin, uuid_pk
from app.db.types import GUID, enum_col


class Course(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """THE COURSE CATALOG — one row per BAJC course (D30 §D2, decision #2).

    Renamed from `Subject` by D31. D30 deliberately kept the old class name to avoid
    churning 14 modules for a cosmetic gain, but that trade-off inverted once D31 was
    rewriting the same files anyway: a class called `Subject` mapped to `courses`, sitting
    beside `CourseOffering` and `program_courses`, was the one confusing leftover in an
    otherwise tertiary model.

    WHY THE TABLE MOVED. Until D30 the graded chain ended at `subjects`, which has no
    credits, so NO STORED GRADE COULD REACH A CREDIT VALUE — credit-weighted GPA, quality
    points and credits-earned were all impossible (D30 plan §B3). `courses` has credits.
    `005_tertiary.sql` copied every `subjects` row into `courses` PRESERVING ITS UUID, so
    re-pointing the FKs orphaned nothing; `006` moved them — after `005` had to stop
    reverting `006` on every replay (D31 Phase 0).

    `code` is NOT NULL: a BAJC course is identified by its code on every programme
    sequence and on the report card.
    """

    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text(), nullable=False)
    code: Mapped[str] = mapped_column(Text(), nullable=False)
    #: BAJC uses 1, 2, 3, 4, 6 and 9. Defaulted to 3 by the schema (the overwhelmingly
    #: common value) so the rows carried over from `subjects` had something valid.
    credits: Mapped[int] = mapped_column(
        SmallInteger(), nullable=False, server_default=text("3")
    )
    #: GEC / SEC / CEC. NOTE (D30 §G item 8): component is really a PER-PROGRAMME fact —
    #: 9 of the 114 BAJC courses carry different components on different programmes — and
    #: this column holds the majority value. The additive fix is
    #: `program_courses.component` falling back to here; it is raised, not taken.
    component: Mapped[CourseComponent | None] = mapped_column(
        enum_col(CourseComponent), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    #: The raw prerequisite string from the course-sequence PDF. DOCUMENTATION ONLY —
    #: validation reads the `course_prerequisites` relation (D30 §D4), because this text
    #: cannot express `EDUC3201 <- ALL COURSES` and cannot be queried.
    prerequisites_text: Mapped[str | None] = mapped_column(Text(), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("true")
    )

    __table_args__ = (
        Index(
            "uq_courses_name",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_courses_code",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class CourseOffering(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """ONE COURSE, SCHEDULED IN ONE SEMESTER — "MATH1110, Semester 1 2026, section 01".

    Replaces `Class` + `CourseOffering`, which D31 merged (see the module docstring). This
    is the gradebook and ownership unit: assessments, lecturer assignments, meetings,
    enrolments and frozen term grades all key off `offering_id`.

    IDENTITY is `(course_id, semester_id, section_code)`, enforced by
    `uq_course_offering_active` over the STORED generated column `active_section`:

        active_section = if(deleted_at is null, coalesce(section_code, ''), NULL)

    The COALESCE is load-bearing. `section_code` is nullable ("the only section"), and
    unique indexes do not collide on NULL — so without it, two unsectioned offerings of
    the same course in the same term would BOTH be permitted. Folding `deleted_at` in lets
    a soft-deleted offering release its slot for a replacement.

    NO `name` COLUMN, deliberately. `classes.name` held "Form 1A"; an offering's label is
    derived from its course code, section and term. Storing it would be a second home for
    one fact — the same argument that keeps `credits` on `Course` and off the offering.

    NO `room` COLUMN, deliberately. Room is per MEETING (`ClassMeeting.room`): one course
    legitimately meets in different rooms on different days.

    The ACADEMIC YEAR is reached through `semester_id`, not stored. `classes` used to hold
    `academic_year_id` and no semester, which is precisely what made two terms of the same
    course inexpressible.
    """

    __tablename__ = "course_offerings"

    id: Mapped[uuid.UUID] = uuid_pk()
    #: WHAT is taught. Credits, component and prerequisites live on `Course` — never here.
    course_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("courses.id", ondelete="RESTRICT", name="fk_course_offerings_course"),
        nullable=False,
    )
    #: WHEN it is taught. Replaces `classes.academic_year_id` (D31); the year is derived
    #: via `semesters.academic_year_id`.
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "semesters.id", ondelete="RESTRICT", name="fk_course_offerings_semester"
        ),
        nullable=False,
    )
    #: Parallel sections of one course in one term: "01", "02". NULL = the only section.
    section_code: Mapped[str | None] = mapped_column(Text(), nullable=True)
    capacity: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    #: Where this offering meets (D44). NULL = no room assigned, which is the state all 19
    #: existing offerings are in.
    #:
    #: ⚠️ `class_meetings.room` is free text and is still what the timetable RENDERS. This
    #: column is the offering-level room and does not yet supersede it. Two columns can
    #: describe the same fact for exactly as long as it takes to decide which one wins —
    #: see `docs/d44-sims10-and-meeting3.md`.
    #:
    #: The client's dump declared this `DEFAULT uuid_v4()`, which would have pointed every
    #: existing offering at a room that does not exist. Nullable with a real FK instead.
    classroomid: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "classroom.classroomid",
            ondelete="SET NULL",
            name="fk_course_offerings_classroom",
        ),
        nullable=True,
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )

    __table_args__ = (
        Index(
            "uq_course_offering_active",
            "course_id",
            "semester_id",
            "section_code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_course_offerings_semester", "semester_id"),
        Index("ix_course_offerings_course", "course_id"),
        CheckConstraint(
            "capacity IS NULL OR capacity > 0", name="ck_course_offerings_capacity"
        ),
    )


class ClassTeacher(Base, TimestampMixin, AuditMixin):
    """Lecturer <-> offering assignment.

    Source of truth for `assert_teacher_owns_offering` (`app/core/rbac.py`) and the join
    that builds a lecturer's own timetable. The table keeps its name; only the FK moved
    from `offering_id` to `offering_id`.
    """

    __tablename__ = "class_teachers"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "course_offerings.id",
            ondelete="CASCADE",
            name="fk_class_teachers_offering",
        ),
        nullable=False,
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "teacher_profiles.id", ondelete="RESTRICT", name="fk_class_teachers_teacher"
        ),
        nullable=False,
    )
    is_lead: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, server_default=text("false")
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        Index(
            "uq_class_teachers_offering_teacher",
            "offering_id",
            "teacher_id",
            unique=True,
        ),
        Index("ix_class_teachers_teacher", "teacher_id"),
    )


class ClassEnrollment(Base, TimestampMixin, AuditMixin):
    """A student's registration in ONE offering, semester-scoped.

    A student holds MANY active rows per semester — one per course they are taking. That
    was already true under D29; what D31 changed is what the row points AT.
    `class_id` used to name a HOMEROOM, so "enrolled in Form 1A" implicitly meant taking
    all ~7 of its courses. Now `offering_id` names one course in one term, which is what a
    tertiary registration actually is.

    `semester_id` is KEPT even though it is now derivable from the offering. Dropping it
    would mean rewriting every term-scoped query in the system for no behavioural gain;
    D31 records the redundancy as a follow-on rather than widening its own blast radius.
    """

    __tablename__ = "class_enrollments"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "course_offerings.id", ondelete="RESTRICT", name="fk_enroll_offering"
        ),
        nullable=False,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("student_profiles.id", ondelete="RESTRICT", name="fk_enroll_student"),
        nullable=False,
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("semesters.id", ondelete="RESTRICT", name="fk_enroll_semester"),
        nullable=False,
    )
    #: How the student is sitting this offering (D30 §D2 step 4). This arrived as
    #: `courses.coursestatus` in `sims_bk.sql` — an enrolment fact sitting on the CATALOG,
    #: where marking one student as auditing would have marked everyone taking the course.
    enrollment_status: Mapped[EnrollmentStatus] = mapped_column(
        enum_col(EnrollmentStatus),
        nullable=False,
        server_default=text("'enrolled'"),
    )
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    unenrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "uq_enroll_active",
            "offering_id",
            "student_id",
            "semester_id",
            unique=True,
            postgresql_where=text("unenrolled_at IS NULL"),
        ),
        Index(
            "ix_enroll_offering_semester",
            "offering_id",
            "semester_id",
            postgresql_where=text("unenrolled_at IS NULL"),
        ),
        Index("ix_enroll_student", "student_id"),
    )


class ClassMeeting(Base, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """One recurring weekly meeting of an offering — "Mon 08:00-09:30, Room A".

    Times are free-form rather than slots in a fixed period grid (stakeholder decision,
    2026-08-06) — no bell-schedule setup is required before an offering can be scheduled.
    Overlaps are NOT rejected here: lecturer/room/student clashes are reported as warnings
    by the service, following the warn-only precedent set for over-capacity enrolment
    (D-Q6).
    """

    __tablename__ = "class_meetings"

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey(
            "course_offerings.id",
            ondelete="CASCADE",
            name="fk_class_meetings_offering",
        ),
        nullable=False,
    )
    #: ISO weekday, 1=Mon … 5=Fri (`app.common.enums.DayOfWeek`). Stored as an int so
    #: `ORDER BY day_of_week, start_time` renders the grid in weekday order.
    day_of_week: Mapped[int] = mapped_column(SmallInteger(), nullable=False)
    start_time: Mapped[time] = mapped_column(Time(), nullable=False)
    end_time: Mapped[time] = mapped_column(Time(), nullable=False)
    room: Mapped[str | None] = mapped_column(Text(), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "day_of_week BETWEEN 1 AND 5", name="ck_class_meetings_day_of_week"
        ),
        CheckConstraint("end_time > start_time", name="ck_class_meetings_time_order"),
        Index(
            "ix_class_meetings_offering",
            "offering_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_class_meetings_day_start", "day_of_week", "start_time"),
    )

"""How an offering is NAMED and ORDERED — one definition, reused everywhere (D31).

`classes` used to carry a stored `name` ("Form 1A", "Math-1") and a `grade_level`
("Form 1"). `course_offerings` carries neither, deliberately: an offering's label is
derived from the course it teaches plus its section, so storing it would put the same fact
in two places and let them drift — the identical argument that keeps `credits` on `Course`
and off the offering.

That leaves every screen needing the label to build it, which is exactly how the old
codebase ended up with nine independent `.order_by(StudentProfile.full_name)` calls before
`STUDENT_NAME_ORDER` consolidated them. So the label and the sort order are defined here
ONCE and imported, never re-spelled in a service.

    offering_label("MATH1110", "01")  -> "MATH1110-01"
    offering_label("MATH1110", None)  -> "MATH1110"

ORDERING is by course code then section, never by the formatted string: "MATH1110-2"
sorts before "MATH1110-10" lexically, and a label built for humans is the wrong sort key
for the same reason `STUDENT_NAME_ORDER` sorts on surname columns rather than a display
name.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.common.schemas import CourseRef, OfferingRef, SemesterRef
from app.modules.offerings.models import Course, CourseOffering

if TYPE_CHECKING:
    from app.modules.settings.models import Semester

#: Canonical ordering for any list of offerings. Import and splat into `.order_by(...)`.
#: Requires `Course` to be joined — every caller listing offerings already needs it for
#: the code and title.
OFFERING_ORDER = (
    Course.code.asc(),
    CourseOffering.section_code.asc(),
    CourseOffering.id.asc(),
)

#: The columns an offering label is built from, in `offering_label`'s argument order.
#: Select these when you need the label but not the whole row.
OFFERING_LABEL_COLUMNS = (Course.code, CourseOffering.section_code)


def offering_label(course_code: str, section_code: str | None) -> str:
    """The short human label for an offering: course code, plus section when sectioned.

    The term is NOT included. Every screen that lists offerings is already scoped to a
    term (a semester picker, a report period, a timetable week), so repeating it in each
    row is noise. `offering_full_label` exists for the places that genuinely need it.
    """
    code = (course_code or "").strip()
    section = (section_code or "").strip()
    return f"{code}-{section}" if section else code


def offering_full_label(
    course_code: str, section_code: str | None, semester_name: str | None
) -> str:
    """`offering_label` plus the term, for contexts with no term scoping of their own.

    Used where one list can span terms — a student's academic history, a transcript, an
    audit-log entry. "MATH1110-01, Semester 1".
    """
    base = offering_label(course_code, section_code)
    term = (semester_name or "").strip()
    return f"{base}, {term}" if term else base


def offering_ref(
    offering: CourseOffering, course: Course, semester: "Semester | None" = None
) -> OfferingRef:
    """Build the shared wire ref for an offering. **The only place it is constructed.**

    Before D31 five modules each defined their own ref shape for the same thing —
    `grades.OfferingRef` (keyed `id`, carrying `display_name`), `assessments.OfferingRef`
    (keyed `offering_id`), `AttendanceSectionRef`, `ReportSectionRef`,
    `ClassGradesClassSubjectRef` — and they disagreed about the key, the label field and
    which parts of the homeroom came along. That was survivable while the ref merely
    wrapped two rows; it is not, now that the label is DERIVED. Five derivations of one
    string drift, and the screens are what would show the drift.

    So the ref is built here, once, from the same `offering_label` the ordering uses.
    Callers supply the joined rows — every call site already joins `Course` to sort by
    `OFFERING_ORDER`, so this asks for nothing it did not already have.

    `semester` is optional because most screens are already scoped to a term and repeating
    it in every row is noise; pass it where one list can span terms (transcripts, academic
    history, the revision queue).
    """
    return OfferingRef(
        id=offering.id,
        course=CourseRef.model_validate(course),
        semester=SemesterRef.model_validate(semester) if semester is not None else None,
        section_code=offering.section_code,
        label=offering_label(course.code, offering.section_code),
    )

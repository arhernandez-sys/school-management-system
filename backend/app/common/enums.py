"""Shared enums (api-specification.md §4.5 / database-schema.md §1.5).

These are str-valued Python enums whose VALUES are the exact lowercase wire labels
AND the exact Postgres native enum labels. `PG_ENUM_NAMES` maps each enum to its
Postgres native type name (schema §1.5), used by the SQLAlchemy column + the
migration's explicit `create_type`.

Letter grades are intentionally NOT an enum — they derive on read from the
configurable grading_scale_bands (D11) and travel the wire as plain strings.
"""

from __future__ import annotations

import enum


class Role(str, enum.Enum):
    PRINCIPAL = "principal"
    SECRETARY = "secretary"
    TEACHER = "teacher"
    STUDENT = "student"


class StudentStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    TRANSFERRED = "transferred"
    GRADUATED = "graduated"
    WITHDRAWN = "withdrawn"


class TeacherStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class AcademicYearStatus(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class AssessmentType(str, enum.Enum):
    QUIZ = "quiz"
    TEST = "test"
    EXAM = "exam"
    ASSIGNMENT = "assignment"


class AssessmentStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    GRADING = "grading"
    GRADED = "graded"


class GradeStatus(str, enum.Enum):
    PENDING = "pending"
    GRADED = "graded"
    ABSENT = "absent"
    EXCUSED = "excused"
    EXEMPT = "exempt"


class AttendanceStatus(str, enum.Enum):
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    EXCUSED = "excused"


class AnnouncementAudience(str, enum.Enum):
    ALL = "all"
    STUDENTS = "students"
    TEACHERS = "teachers"
    CLASS = "class"


# Maps each Python enum to its Postgres native enum type name (schema §1.5).
# The migration creates these types explicitly (create_type) before any table
# uses them; the model columns reference the same names with create_type=False.
PG_ENUM_NAMES: dict[type[enum.Enum], str] = {
    Role: "user_role",
    StudentStatus: "student_status",
    TeacherStatus: "teacher_status",
    AcademicYearStatus: "academic_year_status",
    AssessmentType: "assessment_type",
    AssessmentStatus: "assessment_status",
    GradeStatus: "grade_status",
    AttendanceStatus: "attendance_status",
    AnnouncementAudience: "announcement_audience",
}

"""Model aggregator — imports every ORM model so that `Base.metadata` is fully
populated for Alembic autogenerate and `create_all`. Import this module (not the
individual model modules) anywhere the complete metadata is required.
"""

from __future__ import annotations

# Identity / RBAC
from app.modules.users.models import User, UserPreferences  # noqa: F401
from app.modules.auth.models import (  # noqa: F401
    LoginAttempt,
    PasswordResetToken,
    RefreshSession,
)

# People & linkage
from app.modules.students.models import StudentDocument, StudentProfile  # noqa: F401
from app.modules.teachers.models import TeacherProfile  # noqa: F401

# Academic structure
from app.modules.classes.models import (  # noqa: F401
    Class,
    ClassEnrollment,
    ClassMeeting,
    ClassSubject,
    ClassTeacher,
    Subject,
)
from app.modules.settings.models import (  # noqa: F401
    AcademicYear,
    AssessmentPolicy,
    AuditLog,
    GradingScale,
    GradingScaleBand,
    SchoolProfile,
    Semester,
)

# Assessment / grading
from app.modules.assessments.models import Assessment, AssessmentCategory  # noqa: F401
from app.modules.grades.models import AssessmentGrade, TermGradeSnapshot  # noqa: F401

# Attendance
from app.modules.attendance.models import AttendanceRecord  # noqa: F401

# Communications
from app.modules.announcements.models import (  # noqa: F401
    Announcement,
    AnnouncementRead,
)

# Documents / reports
from app.modules.reports.models import ReportCardSnapshot  # noqa: F401

# Calendar (Module 12 — scope addition, 2026-07)
from app.modules.events.models import Event  # noqa: F401

from app.db.base import Base  # noqa: F401  (re-export for convenience)

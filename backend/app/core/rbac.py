"""Ownership/scope authorization helpers (architecture.md §3.2, schema §9, D23).

The coarse role gate (`require_role`) lives in deps.py; this module holds the FINE
ownership checks. All three helpers are implemented and in use:

  * `assert_teacher_owns_class_subject` — Grades, Assessments, the gradebook.
  * `assert_teacher_owns_section`       — the attendance register.
  * `teacher_section_ids`               — Announcements targeting + compose picker.

Denial raises `NotFound`, never `Forbidden`: confirming that a resource exists but
is off-limits leaks its existence (api-spec §3.3).
"""

from __future__ import annotations

import uuid

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound
from app.modules.classes.models import ClassSubject, ClassTeacher
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User


def _teacher_profile_id(db: Session, user: User) -> uuid.UUID:
    """Resolve the authenticated teacher's profile id from the principal (never
    from the request — architecture §3.2 hard rule)."""
    tid = db.scalar(
        select(TeacherProfile.id).where(
            TeacherProfile.user_id == user.id,
            TeacherProfile.deleted_at.is_(None),
        )
    )
    if tid is None:
        # A teacher user with no profile cannot own anything → treat as not-found
        # on the scoped resource (404-vs-403 discipline, api-spec §3.3).
        raise NotFound("Resource not found.")
    return tid


def assert_teacher_owns_class_subject(
    db: Session, user: User, class_subject_id: uuid.UUID
) -> None:
    """Pass iff a class_teachers row exists for (class_subject_id, user→teacher).

    Used by Grades, Assessments, the gradebook, class-subject-scoped Announcements.
    Co-teachers pass identically (D-Q9). Denial raises NotFound (avoid leaking
    existence of a class_subject the caller doesn't own — api-spec §3.3).

    NOTE: implemented eagerly because it is a pure, well-defined indexed lookup and
    several later modules depend on it; if the orchestrator prefers it deferred,
    it can be re-stubbed. Kept here as the single source of truth.
    """
    teacher_id = _teacher_profile_id(db, user)
    owns = db.scalar(
        select(
            exists().where(
                ClassTeacher.class_subject_id == class_subject_id,
                ClassTeacher.teacher_id == teacher_id,
            )
        )
    )
    if not owns:
        raise NotFound("Resource not found.")


def assert_teacher_owns_section(db: Session, user: User, class_id: uuid.UUID) -> None:
    """Pass iff the teacher owns ANY class_subject of the section (class_id).

    Used by the per-section daily attendance register and class-scoped
    announcements (any subject teacher of the homeroom). Joins
    class_teachers → class_subjects on the section.
    """
    teacher_id = _teacher_profile_id(db, user)
    # Build the join on a real Select, then wrap it in EXISTS. `exists().join(...)`
    # is invalid — Exists has no `.join()` (SQLAlchemy proxies only where/select_from/
    # correlate onto it), so the join must live on the underlying select.
    owns = db.scalar(
        select(
            select(ClassTeacher.teacher_id)
            .join(ClassSubject, ClassTeacher.class_subject_id == ClassSubject.id)
            .where(
                ClassSubject.class_id == class_id,
                ClassSubject.deleted_at.is_(None),
                ClassTeacher.teacher_id == teacher_id,
            )
            .exists()
        )
    )
    if not owns:
        raise NotFound("Resource not found.")


def teacher_section_ids(db: Session, user: User) -> list[uuid.UUID]:
    """Every section (class_id) the teacher owns at least one subject offering in.

    The set form of `assert_teacher_owns_section`: that helper answers "may this
    teacher touch THIS section?", which suits a register or a gradebook addressed by
    id. Announcements need the inverse — "which sections may this teacher aim at?" —
    to build the compose picker and the feed's class-audience clause, and answering
    that by looping `assert_teacher_owns_section` over every section in the school
    would be one query per section.

    Returns `[]` for a teacher with no profile rather than raising, because the
    callers here are list/filter paths where "owns nothing" is a legitimate empty
    result, not a 404 on a specific resource.
    """
    try:
        teacher_id = _teacher_profile_id(db, user)
    except NotFound:
        return []
    return list(
        db.scalars(
            select(ClassSubject.class_id)
            .join(ClassTeacher, ClassTeacher.class_subject_id == ClassSubject.id)
            .where(
                ClassTeacher.teacher_id == teacher_id,
                ClassSubject.deleted_at.is_(None),
            )
            .distinct()
        ).all()
    )

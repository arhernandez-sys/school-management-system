"""Ownership/scope authorization helpers (architecture.md §3.2, schema §9, D23).

The coarse role gate (`require_role`) lives in deps.py; this module holds the FINE
ownership checks:

  * `assert_teacher_owns_offering` — Grades, Assessments, the gradebook, the attendance
    register, offering-scoped Announcements.
  * `teacher_offering_ids`         — Announcements targeting + compose picker.

Denial raises `NotFound`, never `Forbidden`: confirming that a resource exists but is
off-limits leaks its existence (api-spec §3.3).

D31 MERGED TWO HELPERS INTO ONE. There used to be
`assert_teacher_owns_class_subject` ("may this lecturer touch this gradebook?") and
`assert_teacher_owns_section` ("may this lecturer touch this homeroom's register?"). Those
were different questions only while a `classes` row was a HOMEROOM teaching ~7 subjects, so
that owning one subject of it granted access to the whole section's register. With
`course_offerings` there is exactly one course per offering, so both questions reduce to the
same lookup, and keeping two names for it would imply a distinction that no longer exists.
`teacher_section_ids` became `teacher_offering_ids` for the same reason.

Co-teachers pass identically (D-Q9): ownership is any `class_teachers` row, lead or not.
"""

from __future__ import annotations

import uuid

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound
from app.modules.offerings.models import ClassTeacher
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User


def _teacher_profile_id(db: Session, user: User) -> uuid.UUID:
    """Resolve the authenticated lecturer's profile id from the principal (never from
    the request — architecture §3.2 hard rule)."""
    tid = db.scalar(
        select(TeacherProfile.id).where(
            TeacherProfile.user_id == user.id,
            TeacherProfile.deleted_at.is_(None),
        )
    )
    if tid is None:
        # A lecturer user with no profile cannot own anything → treat as not-found on
        # the scoped resource (404-vs-403 discipline, api-spec §3.3).
        raise NotFound("Resource not found.")
    return tid


def assert_teacher_owns_offering(
    db: Session, user: User, offering_id: uuid.UUID, *, message: str = "Resource not found."
) -> None:
    """Pass iff a `class_teachers` row exists for (offering_id, user→lecturer).

    Used by Grades, Assessments, the gradebook, the attendance register and
    offering-scoped Announcements. Denial raises NotFound, not Forbidden — a 403 would
    confirm that an offering the caller does not teach exists.

    `message` exists because the 404 body has to MATCH the caller's ordinary
    not-found body. A generic "Resource not found." next to a module's "Offering not
    found." tells an attacker which of the two happened, which is the leak the 404 was
    chosen to close. Callers that have their own wording pass it in.
    """
    teacher_id = _teacher_profile_id(db, user)
    owns = db.scalar(
        select(
            exists().where(
                ClassTeacher.offering_id == offering_id,
                ClassTeacher.teacher_id == teacher_id,
            )
        )
    )
    if not owns:
        raise NotFound(message)


def teacher_offering_ids(db: Session, user: User) -> list[uuid.UUID]:
    """Every offering the lecturer is assigned to.

    The set form of `assert_teacher_owns_offering`: that helper answers "may this lecturer
    touch THIS offering?", which suits a register or gradebook addressed by id.
    Announcements need the inverse — "which offerings may this lecturer aim at?" — to
    build the compose picker and the feed's offering-audience clause, and answering that by
    looping the assert over every offering in the college would be one query each.

    Returns `[]` for a lecturer with no profile rather than raising, because the callers
    are list/filter paths where "owns nothing" is a legitimate empty result, not a 404 on a
    specific resource.

    No join since D31: ownership rows point straight at the offering, where they used to
    reach the section through `class_subjects`.
    """
    try:
        teacher_id = _teacher_profile_id(db, user)
    except NotFound:
        return []
    return list(
        db.scalars(
            select(ClassTeacher.offering_id)
            .where(ClassTeacher.teacher_id == teacher_id)
            .distinct()
        ).all()
    )

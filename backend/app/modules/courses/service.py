"""Course-catalog service (api-spec §5 Module 5b, M2, FR-CLS-01a; D30 §D2).

Owns DB access + transactions for the 4 catalog endpoints. The router is thin.
The `Course` model lives in `app/modules/courses/models.py` and maps the `courses`
table. D31 finished the rename: `/subjects` became `/courses`, the error codes became
`duplicate_course_name` / `duplicate_course_code` / `course_in_use`, and the audit
`entity_type` became `course` — the last places the pre-D30 noun survived on the wire.

Uniqueness is enforced at the DB by unique indexes over live rows
(`uq_courses_name`, `uq_courses_code`, both on generated `active_*` columns that go
NULL when `deleted_at` is set). We pre-check for the documented 409 codes; the
indexes are the backstop against a race.

D30 changed two things that matter to callers:
  * `code` is REQUIRED — `courses.code` is NOT NULL, so the old code-less create
    would now be a database error rather than a validation one.
  * `credits` and `component` are writable, and `credits` is what finally makes the
    graded chain reach a credit value (plan §B3).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.modules.offerings.models import CourseOffering, Course
from app.modules.settings.models import AuditLog
from app.modules.courses.schemas import (
    CourseCreateRequest,
    CourseDetail,
    CourseListItem,
    CourseUpdateRequest,
)
from app.modules.users.models import User

_SUBJECT_SORT_FIELDS = {
    "name": Course.name,
    "code": Course.code,
    "credits": Course.credits,
    "component": Course.component,
    "is_active": Course.is_active,
    "created_at": Course.created_at,
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
            entity_type="course",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _course_or_404(db: Session, course_id: uuid.UUID) -> Course:
    course = db.scalar(
        select(Course).where(
            Course.id == course_id, Course.deleted_at.is_(None)
        )
    )
    if course is None:
        raise NotFound("Subject not found.", code="not_found")
    return course


def _assert_name_unique(
    db: Session, name: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Course.id).where(
        func.lower(Course.name) == name.strip().lower(),
        Course.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Course.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A course with this name already exists.", code="duplicate_course_name"
        )


def _assert_code_unique(
    db: Session, code: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Course.id).where(
        func.lower(Course.code) == code.strip().lower(),
        Course.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Course.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A course with this code already exists.", code="duplicate_course_code"
        )


def list_courses(
    db: Session,
    *,
    params: PageParams,
    search: str | None,
    is_active: bool | None,
    include_retired: bool = False,
):
    """GET /courses (authenticated). Page[CourseListItem]; default is_active=true
    (the picker hides retired courses); default sort name.

    `?include_retired=true` returns active AND retired — see `programs.service`
    for the same fix and the same reason. The comment below used to say `is_active=false`
    "opts into the full catalog", which it does not: it is an equality filter, so it
    returns retired only. The Courses screen's "Show retired" switch was dead for exactly
    that reason.
    """
    stmt = select(Course).where(Course.deleted_at.is_(None))

    # Default to active-only (the picker), per §5b.
    if not include_retired:
        effective_active = True if is_active is None else is_active
        stmt = stmt.where(Course.is_active.is_(effective_active))

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(Course.name.ilike(like) | Course.code.ilike(like))

    sort = (params.sort or "name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _SUBJECT_SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(col.desc() if desc else col.asc(), Course.id.asc())

    return paginate(db, stmt, params, serialize=CourseListItem.model_validate)


def create_course(
    db: Session, *, actor: User, payload: CourseCreateRequest
) -> CourseDetail:
    """POST /courses (Dean only, D30 §D14). 409 duplicate_course_name /
    duplicate_course_code."""
    _assert_name_unique(db, payload.name)
    code = payload.code.strip()
    _assert_code_unique(db, code)

    course = Course(
        name=payload.name.strip(),
        code=code,
        credits=payload.credits,
        component=payload.component,
        description=payload.description,
        prerequisites_text=payload.prerequisites_text,
        is_active=True,
        created_by=actor.id,
    )
    db.add(course)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="course.create",
        entity_id=course.id,
        summary={"code": code, "credits": payload.credits},
    )
    db.commit()
    return CourseDetail.model_validate(course)


def update_course(
    db: Session, *, actor: User, course_id: uuid.UUID, payload: CourseUpdateRequest
) -> CourseDetail:
    """PATCH /courses/{id} (Dean only, D30 §D14). Partial update.

    Renaming is safe for history: transcript lines use the frozen `course_id`
    (schema §10.6), which since `006` resolves against `courses`.

    An omitted field means "leave alone" — the module-wide PATCH convention. There is
    deliberately no way to CLEAR `code` here: `courses.code` is NOT NULL, so a null
    would be a database error rather than an edit.
    """
    course = _course_or_404(db, course_id)

    if payload.name is not None and payload.name.strip().lower() != course.name.lower():
        _assert_name_unique(db, payload.name, exclude_id=course.id)
        course.name = payload.name.strip()

    if payload.code is not None:
        new_code = payload.code.strip()
        if not new_code:
            raise ValidationError(
                "A course code is required.",
                fields={"code": ["Required."]},
            )
        if course.code.lower() != new_code.lower():
            _assert_code_unique(db, new_code, exclude_id=course.id)
        course.code = new_code

    if payload.credits is not None:
        course.credits = payload.credits
    if payload.component is not None:
        course.component = payload.component
    if payload.description is not None:
        course.description = payload.description
    if payload.prerequisites_text is not None:
        course.prerequisites_text = payload.prerequisites_text

    if payload.is_active is not None:
        course.is_active = payload.is_active

    course.updated_by = actor.id
    _audit(db, actor=actor, action="course.update", entity_id=course.id)
    db.commit()
    return CourseDetail.model_validate(course)


def delete_course(db: Session, *, actor: User, course_id: uuid.UUID) -> None:
    """DELETE /courses/{id} (P/S). Soft-delete ONLY IF unreferenced by any
    offering (live OR historical — FK is RESTRICT, preserves
    transcript resolvability). Else 409 course_in_use (retire via is_active=false
    instead)."""
    course = _course_or_404(db, course_id)

    # Referenced by ANY offering row (including soft-deleted ones, which
    # still anchor historical transcript lines) → cannot delete.
    in_use = db.scalar(
        select(CourseOffering.id).where(CourseOffering.course_id == course.id).limit(1)
    )
    if in_use is not None:
        raise Conflict(
            "Offered in one or more course offerings — retire it instead.",
            code="course_in_use",
        )

    course.deleted_at = _now()
    _audit(db, actor=actor, action="course.delete", entity_id=course.id)
    db.commit()

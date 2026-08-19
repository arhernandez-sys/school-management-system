"""Course-catalog service (api-spec §5 Module 5b, M2, FR-CLS-01a; D30 §D2).

Owns DB access + transactions for the 4 catalog endpoints. The router is thin.
The `Subject` model lives in `app/modules/classes/models.py` and maps the `courses`
table — see its docstring for why the class and the route kept the old spelling.

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
from app.modules.classes.models import ClassSubject, Subject
from app.modules.settings.models import AuditLog
from app.modules.subjects.schemas import (
    SubjectCreateRequest,
    SubjectDetail,
    SubjectListItem,
    SubjectUpdateRequest,
)
from app.modules.users.models import User

_SUBJECT_SORT_FIELDS = {
    "name": Subject.name,
    "code": Subject.code,
    "credits": Subject.credits,
    "component": Subject.component,
    "is_active": Subject.is_active,
    "created_at": Subject.created_at,
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
            entity_type="subject",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _subject_or_404(db: Session, subject_id: uuid.UUID) -> Subject:
    subject = db.scalar(
        select(Subject).where(
            Subject.id == subject_id, Subject.deleted_at.is_(None)
        )
    )
    if subject is None:
        raise NotFound("Subject not found.", code="not_found")
    return subject


def _assert_name_unique(
    db: Session, name: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Subject.id).where(
        func.lower(Subject.name) == name.strip().lower(),
        Subject.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Subject.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A subject with this name already exists.", code="duplicate_subject_name"
        )


def _assert_code_unique(
    db: Session, code: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(Subject.id).where(
        func.lower(Subject.code) == code.strip().lower(),
        Subject.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Subject.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            "A subject with this code already exists.", code="duplicate_subject_code"
        )


def list_subjects(
    db: Session, *, params: PageParams, search: str | None, is_active: bool | None
):
    """GET /subjects (authenticated). Page[SubjectListItem]; default is_active=true
    (the picker hides retired subjects); default sort name."""
    stmt = select(Subject).where(Subject.deleted_at.is_(None))

    # Default to active-only (the picker), per §5b. An explicit ?is_active=false
    # opts into the full catalog/retired view.
    effective_active = True if is_active is None else is_active
    stmt = stmt.where(Subject.is_active.is_(effective_active))

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(Subject.name.ilike(like) | Subject.code.ilike(like))

    sort = (params.sort or "name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _SUBJECT_SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(col.desc() if desc else col.asc(), Subject.id.asc())

    return paginate(db, stmt, params, serialize=SubjectListItem.model_validate)


def create_subject(
    db: Session, *, actor: User, payload: SubjectCreateRequest
) -> SubjectDetail:
    """POST /subjects (Dean only, D30 §D14). 409 duplicate_subject_name /
    duplicate_subject_code."""
    _assert_name_unique(db, payload.name)
    code = payload.code.strip()
    _assert_code_unique(db, code)

    subject = Subject(
        name=payload.name.strip(),
        code=code,
        credits=payload.credits,
        component=payload.component,
        description=payload.description,
        prerequisites_text=payload.prerequisites_text,
        is_active=True,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(subject)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="subject.create",
        entity_id=subject.id,
        summary={"code": code, "credits": payload.credits},
    )
    db.commit()
    return SubjectDetail.model_validate(subject)


def update_subject(
    db: Session, *, actor: User, subject_id: uuid.UUID, payload: SubjectUpdateRequest
) -> SubjectDetail:
    """PATCH /subjects/{id} (Dean only, D30 §D14). Partial update.

    Renaming is safe for history: transcript lines use the frozen `subject_id`
    (schema §10.6), which since `006` resolves against `courses`.

    An omitted field means "leave alone" — the module-wide PATCH convention. There is
    deliberately no way to CLEAR `code` here: `courses.code` is NOT NULL, so a null
    would be a database error rather than an edit.
    """
    subject = _subject_or_404(db, subject_id)

    if payload.name is not None and payload.name.strip().lower() != subject.name.lower():
        _assert_name_unique(db, payload.name, exclude_id=subject.id)
        subject.name = payload.name.strip()

    if payload.code is not None:
        new_code = payload.code.strip()
        if not new_code:
            raise ValidationError(
                "A course code is required.",
                fields={"code": ["Required."]},
            )
        if subject.code.lower() != new_code.lower():
            _assert_code_unique(db, new_code, exclude_id=subject.id)
        subject.code = new_code

    if payload.credits is not None:
        subject.credits = payload.credits
    if payload.component is not None:
        subject.component = payload.component
    if payload.description is not None:
        subject.description = payload.description
    if payload.prerequisites_text is not None:
        subject.prerequisites_text = payload.prerequisites_text

    if payload.is_active is not None:
        subject.is_active = payload.is_active

    subject.updated_by = actor.id
    _audit(db, actor=actor, action="subject.update", entity_id=subject.id)
    db.commit()
    return SubjectDetail.model_validate(subject)


def delete_subject(db: Session, *, actor: User, subject_id: uuid.UUID) -> None:
    """DELETE /subjects/{id} (P/S). Soft-delete ONLY IF unreferenced by any
    class_subjects offering (live OR historical — FK is RESTRICT, preserves
    transcript resolvability). Else 409 subject_in_use (retire via is_active=false
    instead)."""
    subject = _subject_or_404(db, subject_id)

    # Referenced by ANY class_subjects row (including soft-deleted offerings, which
    # still anchor historical transcript lines) → cannot delete.
    in_use = db.scalar(
        select(ClassSubject.id).where(ClassSubject.subject_id == subject.id).limit(1)
    )
    if in_use is not None:
        raise Conflict(
            "Taught in one or more sections — retire it instead.",
            code="subject_in_use",
        )

    subject.deleted_at = _now()
    _audit(db, actor=actor, action="subject.delete", entity_id=subject.id)
    db.commit()

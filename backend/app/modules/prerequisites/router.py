"""Course-prerequisite router (D30 §D4, §D14).

Mounted under the EXISTING catalog prefix `/subjects`, not a new `/courses` one: the
catalog entity already has a route, and giving the same entity two spellings is worse
than the one legacy name that decision #3 preserves anyway.

Endpoints:
  GET    /courses/{id}/prerequisites               authenticated  -> PrerequisiteList
  POST   /courses/{id}/prerequisites               Dean (P)       -> PrerequisiteList (201)
  DELETE /courses/{id}/prerequisites/{prereq_id}    Dean (P)       -> PrerequisiteList

Both writes return the whole LIST rather than the touched row — the editor is a list,
and a single row would force a re-fetch to render.

There is no PATCH. A prerequisite has three fields and all three are its identity
(`uq_course_prereq` is the whole tuple); "editing" one is removing it and adding
another, and doing that silently would hide the change from anyone reading the
requirement.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_current_user, get_db, require_role
from app.modules.prerequisites import service
from app.modules.prerequisites.schemas import (
    PrerequisiteCreateRequest,
    PrerequisiteList,
)
from app.modules.users.models import User

router = APIRouter(prefix="/courses", tags=["prerequisites"])

_ERR = {"model": ErrorResponse}
_dean_only = require_role(Role.PRINCIPAL)


@router.get(
    "/{course_id}/prerequisites",
    response_model=PrerequisiteList,
    summary="What a course requires (authenticated; D30 §D4)",
    responses={401: _ERR, 404: _ERR},
)
def list_prerequisites(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> PrerequisiteList:
    """Open to every authenticated role — a student deciding what to take next needs
    it, and it is published prospectus material.

    `prerequisites_text` is the raw string from the course-sequence PDF, returned for
    comparison only. **Validation reads `items`.**
    """
    return service.list_prerequisites(db, course_id=course_id)


@router.post(
    "/{course_id}/prerequisites",
    response_model=PrerequisiteList,
    status_code=status.HTTP_201_CREATED,
    summary="Add a requirement to a course (Dean only; D30 §D4)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def add_prerequisite(
    course_id: uuid.UUID,
    payload: PrerequisiteCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> PrerequisiteList:
    """409 `duplicate_prerequisite` / `circular_prerequisite`; 404 `course_not_found`
    / `program_not_found`."""
    return service.add_prerequisite(
        db, actor=actor, course_id=course_id, payload=payload
    )


@router.delete(
    "/{course_id}/prerequisites/{prerequisite_id}",
    response_model=PrerequisiteList,
    summary="Remove a requirement from a course (Dean only; D30 §D4)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def remove_prerequisite(
    course_id: uuid.UUID,
    prerequisite_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> PrerequisiteList:
    return service.remove_prerequisite(
        db, actor=actor, course_id=course_id, prerequisite_id=prerequisite_id
    )

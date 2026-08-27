"""Programmes + curriculum router (D30 §D3, §D14).

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

**DEAN-ONLY TO WRITE** (brief §6, §D14). Creating, editing and deleting programmes /
studies is the Dean's academic authority, exactly as the course catalog is. The
Registrar keeps students, enrolment and offerings — what they cannot do is change
what a programme REQUIRES.

Reading is open to every authenticated user: a programme's code, name and course
sequence are published prospectus material, and Phase 4's student academic-history
screens read it.

Endpoints:
  GET    /programs                              authenticated  -> Page[ProgramListItem]
  GET    /programs/{id}                         authenticated  -> ProgramDetail
  POST   /programs                              Dean (P)       -> ProgramDetail (201)
  PATCH  /programs/{id}                          Dean (P)       -> ProgramDetail
  DELETE /programs/{id}                          Dean (P)       -> 204
  POST   /programs/{id}/courses                 Dean (P)       -> ProgramDetail (201)
  PATCH  /programs/{id}/courses/{pcid}           Dean (P)       -> ProgramDetail
  DELETE /programs/{id}/courses/{pcid}           Dean (P)       -> ProgramDetail

The three curriculum writes return the WHOLE programme rather than the touched row:
each one changes the affected block's credit total and the programme's curriculum
total, so a builder UI would have to re-fetch after every edit otherwise.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_current_user, get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.programs import service
from app.modules.programs.schemas import (
    ProgramCourseCreateRequest,
    ProgramCourseUpdateRequest,
    ProgramCreateRequest,
    ProgramDetail,
    ProgramListItem,
    ProgramUpdateRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/programs", tags=["programs"])

_ERR = {"model": ErrorResponse}
_dean_only = require_role(Role.PRINCIPAL)


@router.get(
    "",
    response_model=Page[ProgramListItem],
    summary="The programmes / studies offered (authenticated; D30 §D3)",
    responses={401: _ERR, 422: _ERR},
)
def list_programs(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=120)] = None,
    is_active: Annotated[bool | None, Query()] = None,
    include_retired: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Page[ProgramListItem]:
    """Default `is_active` filter hides retired programmes from pickers.

    `include_retired=true` drops the filter entirely and returns active AND retired —
    what the Programmes screen's "Show retired" switch needs. `is_active` stays an
    equality filter, so `is_active=false` still means "retired only".
    """
    return service.list_programs(
        db,
        params=params,
        search=search,
        is_active=is_active,
        include_retired=include_retired,
    )


@router.get(
    "/{program_id}",
    response_model=ProgramDetail,
    summary="One programme with its curriculum (authenticated; D30 §D3)",
    responses={401: _ERR, 404: _ERR},
)
def get_program(
    program_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ProgramDetail:
    """`curriculum` is grouped into term BLOCKS ordered by `term_order`. Those are
    curriculum positions, not calendar terms — see `ProgramCourse`."""
    return service.get_program(db, program_id=program_id)


@router.post(
    "",
    response_model=ProgramDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a programme (Dean only; D30 §D14)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_program(
    payload: ProgramCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> ProgramDetail:
    """409 duplicate_program_code / duplicate_program_name."""
    return service.create_program(db, actor=actor, payload=payload)


@router.patch(
    "/{program_id}",
    response_model=ProgramDetail,
    summary="Update a programme (Dean only; D30 §D14)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_program(
    program_id: uuid.UUID,
    payload: ProgramUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> ProgramDetail:
    return service.update_program(
        db, actor=actor, program_id=program_id, payload=payload
    )


@router.delete(
    "/{program_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a programme nobody is on (Dean only; D30 §D14)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_program(
    program_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> Response:
    """409 `program_in_use` when students are registered on it — retire it
    (`is_active=false`) instead, which stops new enrolments without touching any
    existing student's record."""
    service.delete_program(db, actor=actor, program_id=program_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Curriculum (programme → term block → course) ────────────────────────────────
@router.post(
    "/{program_id}/courses",
    response_model=ProgramDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Place a course in the programme's plan (Dean only; D30 §D3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def add_program_course(
    program_id: uuid.UUID,
    payload: ProgramCourseCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> ProgramDetail:
    """409 course_already_in_program / course_retired; 404 course_not_found."""
    return service.add_program_course(
        db, actor=actor, program_id=program_id, payload=payload
    )


@router.patch(
    "/{program_id}/courses/{program_course_id}",
    response_model=ProgramDetail,
    summary="Move a course between blocks, or flip required (Dean only; D30 §D3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def update_program_course(
    program_id: uuid.UUID,
    program_course_id: uuid.UUID,
    payload: ProgramCourseUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> ProgramDetail:
    return service.update_program_course(
        db,
        actor=actor,
        program_id=program_id,
        program_course_id=program_course_id,
        payload=payload,
    )


@router.delete(
    "/{program_id}/courses/{program_course_id}",
    response_model=ProgramDetail,
    summary="Remove a course from the programme's plan (Dean only; D30 §D3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def remove_program_course(
    program_id: uuid.UUID,
    program_course_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean_only),
) -> ProgramDetail:
    """Returns the updated programme rather than 204: the caller is a curriculum
    builder that needs the recomputed block and programme credit totals."""
    return service.remove_program_course(
        db, actor=actor, program_id=program_id, program_course_id=program_course_id
    )

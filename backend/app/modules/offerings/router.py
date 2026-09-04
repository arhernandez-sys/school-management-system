"""Course-offerings router (api-spec §5 Module 5) — 12 endpoints.

An offering is ONE COURSE scheduled in ONE SEMESTER, optionally sectioned (D31). Thin
transport; the service owns DB + transactions. Mounts under `/api/v1`.

  GET    /offerings                                    Dean/Reg/Lec/Student -> Page[OfferingListItem]
  POST   /offerings                                    Dean/Reg             -> OfferingDetail (201)
  GET    /offerings/{id}                               Dean/Reg/Lec/Student -> OfferingDetail
  PATCH  /offerings/{id}                               Dean/Reg             -> OfferingDetail
  DELETE /offerings/{id}                               Dean/Reg             -> 204
  PUT    /offerings/{id}/teachers                      Dean/Reg             -> OfferingDetail
  GET    /offerings/{id}/meetings                      Dean/Reg/Lec/Student -> MeetingsResult
  PUT    /offerings/{id}/meetings                      Dean/Reg             -> MeetingsResult
  GET    /offerings/{id}/roster                        Dean/Reg/Lec         -> RosterEntry[]
  GET    /offerings/{id}/enrollable-students           Dean/Reg             -> {items: StudentRef[]}
  POST   /offerings/{id}/enrollments                   Dean/Reg             -> EnrollmentResult
  PATCH  /offerings/{id}/enrollments/{enrollment_id}   Dean/Reg             -> RosterEntry
  DELETE /offerings/{id}/enrollments/{enrollment_id}   Dean/Reg             -> 204

D31 DROPPED THREE ENDPOINTS. `GET`/`POST /classes/{id}/subjects` and
`DELETE /classes/{id}/subjects/{cs_id}` existed to manage the subjects a HOMEROOM taught.
An offering teaches exactly one course, chosen at creation, so there is nothing to attach,
list or detach. `PUT .../subjects/{cs_id}/teachers` lost its middle segment and became
`PUT /offerings/{id}/teachers`.

PERMISSIONS are unchanged from the D30 review (§D14): scheduling offerings, assigning
lecturers and enrolling students are **Dean OR Registrar** — the Registrar's operational
work. The Dean alone owns the CATALOG and the CURRICULUM, which live in
`courses/router.py`, `programs/router.py` and `prerequisites/router.py`.
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
from app.modules.offerings import service
from app.modules.offerings.schemas import (
    EnrollableStudents,
    EnrollmentResult,
    EnrollRequest,
    EnrollmentStatusRequest,
    MeetingsReplaceRequest,
    MeetingsResult,
    OfferingCreateRequest,
    OfferingDetail,
    OfferingListItem,
    OfferingUpdateRequest,
    RosterEntry,
    TeacherAssignRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/offerings", tags=["offerings"])

_ERR = {"model": ErrorResponse}
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)
_roster_read = require_role(
    Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.HOD, Role.AUDITOR
)
_any = get_current_user


@router.get(
    "",
    response_model=Page[OfferingListItem],
    summary="List offerings (all roles; Lecturer/Student auto-scoped; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_offerings(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=160)] = None,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    course_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> Page[OfferingListItem]:
    return service.list_offerings(
        db,
        caller=caller,
        params=params,
        search=search,
        academic_year_id=academic_year_id,
        semester_id=semester_id,
        course_id=course_id,
    )


@router.post(
    "",
    response_model=OfferingDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Schedule a course in a term (Dean/Registrar; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def create_offering(
    payload: OfferingCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> OfferingDetail:
    return service.create_offering(db, actor=actor, payload=payload)


@router.get(
    "/{offering_id}",
    response_model=OfferingDetail,
    summary="Offering detail (Dean/Reg any; Lecturer teaches / Student enrolled else 404)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_offering(
    offering_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> OfferingDetail:
    return service.get_offering(db, caller=caller, offering_id=offering_id)


@router.patch(
    "/{offering_id}",
    response_model=OfferingDetail,
    summary="Update an offering (Dean/Registrar; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_offering(
    offering_id: uuid.UUID,
    payload: OfferingUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> OfferingDetail:
    return service.update_offering(
        db, actor=actor, offering_id=offering_id, payload=payload
    )


@router.delete(
    "/{offering_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete an offering with no history (Dean/Registrar)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_offering(
    offering_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    service.delete_offering(db, actor=actor, offering_id=offering_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{offering_id}/teachers",
    response_model=OfferingDetail,
    summary="Replace the lecturer set for an offering (Dean/Registrar)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def assign_teachers(
    offering_id: uuid.UUID,
    payload: TeacherAssignRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> OfferingDetail:
    return service.assign_teachers(
        db, actor=actor, offering_id=offering_id, payload=payload
    )


@router.get(
    "/{offering_id}/meetings",
    response_model=MeetingsResult,
    summary="Weekly schedule (readable by anyone who can read the offering)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def list_meetings(
    offering_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> MeetingsResult:
    return service.list_meetings(db, caller=caller, offering_id=offering_id)


@router.put(
    "/{offering_id}/meetings",
    response_model=MeetingsResult,
    summary="Replace the weekly schedule (Dean/Registrar; clashes warn, never block)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def replace_meetings(
    offering_id: uuid.UUID,
    payload: MeetingsReplaceRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> MeetingsResult:
    return service.replace_meetings(
        db, actor=actor, offering_id=offering_id, payload=payload
    )


@router.get(
    "/{offering_id}/roster",
    response_model=list[RosterEntry],
    summary="Roster (Dean/Reg any; Lecturer must teach it else 404)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_roster(
    offering_id: uuid.UUID,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    include: Annotated[str | None, Query(pattern="^withdrawn$")] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_roster_read),
) -> list[RosterEntry]:
    return service.get_roster(
        db,
        caller=caller,
        offering_id=offering_id,
        semester_id=semester_id,
        include=include,
    )


@router.get(
    "/{offering_id}/enrollable-students",
    response_model=EnrollableStudents,
    summary="Active students not already on this offering's roster (Dean/Registrar)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def enrollable_students(
    offering_id: uuid.UUID,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=160)] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> EnrollableStudents:
    return service.enrollable_students(
        db, offering_id=offering_id, semester_id=semester_id, search=search
    )


@router.post(
    "/{offering_id}/enrollments",
    response_model=EnrollmentResult,
    summary="Enrol students (Dean/Registrar; prerequisite gate is a hard 409)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def enroll_students(
    offering_id: uuid.UUID,
    payload: EnrollRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> EnrollmentResult:
    return service.enroll_students(
        db, actor=actor, offering_id=offering_id, payload=payload
    )


@router.patch(
    "/{offering_id}/enrollments/{enrollment_id}",
    response_model=RosterEntry,
    summary="Set a student's course status on an offering (Dean/Registrar; D35)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def set_enrollment_status(
    offering_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    payload: EnrollmentStatusRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> RosterEntry:
    """The client's `coursestatus`: `enrolled` / `audit` / `withdraw_passing` /
    `withdraw_failing`.

    Distinct from `DELETE` below, which UN-ENROLS. A withdrawal keeps the row open and on
    the roster because the transcript prints `W/P` or `W/F` against it; deleting it would
    erase the fact being recorded. 409 `enrollment_closed` on a row that is already
    un-enrolled.
    """
    return service.set_enrollment_status(
        db,
        actor=actor,
        offering_id=offering_id,
        enrollment_id=enrollment_id,
        payload=payload,
    )


@router.delete(
    "/{offering_id}/enrollments/{enrollment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Un-enrol a student from an offering (Dean/Registrar)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def unenroll_student(
    offering_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    service.unenroll_student(
        db, actor=actor, offering_id=offering_id, enrollment_id=enrollment_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

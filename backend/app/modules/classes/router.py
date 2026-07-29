"""Classes (sections) router (api-spec §5 Module 5) — 13 endpoints.

Thin transport; the service owns DB + transactions. Mounts under `/api/v1`.

  GET    /classes                                             P/S/T/Student  -> Page[ClassListItem]
  POST   /classes                                             P/S            -> ClassDetail (201)
  GET    /classes/{id}                                        P/S/T/Student  -> ClassDetail
  PATCH  /classes/{id}                                         P/S            -> ClassDetail
  DELETE /classes/{id}                                         P/S            -> 204
  GET    /classes/{id}/subjects                                P/S/T/Student  -> ClassSubjectItem[]
  POST   /classes/{id}/subjects                                P/S            -> ClassSubjectItem (201)
  DELETE /classes/{id}/subjects/{cs_id}                        P/S            -> 204
  PUT    /classes/{id}/subjects/{cs_id}/teachers               P/S            -> ClassSubjectItem
  GET    /classes/{id}/roster                                  P/S/T          -> RosterEntry[]
  GET    /classes/{id}/enrollable-students                     P/S            -> {items: StudentRef[]}
  POST   /classes/{id}/enrollments                             P/S            -> EnrollmentResult
  DELETE /classes/{id}/enrollments/{enrollment_id}             P/S            -> 204
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
from app.modules.classes import service
from app.modules.classes.schemas import (
    ClassCreateRequest,
    ClassDetail,
    ClassListItem,
    ClassSubjectCreateRequest,
    ClassSubjectItem,
    ClassUpdateRequest,
    EnrollableStudents,
    EnrollmentResult,
    EnrollRequest,
    RosterEntry,
    TeacherAssignRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/classes", tags=["classes"])

_ERR = {"model": ErrorResponse}
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)
_roster_read = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER)
_any = get_current_user


@router.get(
    "",
    response_model=Page[ClassListItem],
    summary="List sections (all roles; Teacher/Student auto-scoped; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_classes(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=160)] = None,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    grade_level: Annotated[str | None, Query(max_length=50)] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> Page[ClassListItem]:
    return service.list_classes(
        db, caller=caller, params=params, search=search,
        academic_year_id=academic_year_id, grade_level=grade_level,
    )


@router.post(
    "",
    response_model=ClassDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a section (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def create_class(
    payload: ClassCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> ClassDetail:
    return service.create_class(db, actor=actor, payload=payload)


@router.get(
    "/{class_id}",
    response_model=ClassDetail,
    summary="Section detail (P/S any; Teacher owns / Student enrolled else 404)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_class(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> ClassDetail:
    return service.get_class(db, caller=caller, class_id=class_id)


@router.patch(
    "/{class_id}",
    response_model=ClassDetail,
    summary="Update a section (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_class(
    class_id: uuid.UUID,
    payload: ClassUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> ClassDetail:
    return service.update_class(db, actor=actor, class_id=class_id, payload=payload)


@router.delete(
    "/{class_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a section if it has no history (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_class(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    service.delete_class(db, actor=actor, class_id=class_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{class_id}/subjects",
    response_model=list[ClassSubjectItem],
    summary="Subjects offered in a section (P/S/T/Student scoped; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def list_class_subjects(
    class_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> list[ClassSubjectItem]:
    return service.list_class_subjects(db, caller=caller, class_id=class_id)


@router.post(
    "/{class_id}/subjects",
    response_model=ClassSubjectItem,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a subject to a section (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def attach_subject(
    class_id: uuid.UUID,
    payload: ClassSubjectCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> ClassSubjectItem:
    return service.attach_subject(
        db, actor=actor, class_id=class_id, subject_id=payload.subject_id
    )


@router.delete(
    "/{class_id}/subjects/{class_subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Detach a subject offering if it has no history (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def detach_subject(
    class_id: uuid.UUID,
    class_subject_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    service.detach_subject(
        db, actor=actor, class_id=class_id, class_subject_id=class_subject_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{class_id}/subjects/{class_subject_id}/teachers",
    response_model=ClassSubjectItem,
    summary="Set the teachers for a subject offering (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def assign_teachers(
    class_id: uuid.UUID,
    class_subject_id: uuid.UUID,
    payload: TeacherAssignRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> ClassSubjectItem:
    return service.assign_teachers(
        db, actor=actor, class_id=class_id,
        class_subject_id=class_subject_id, payload=payload,
    )


@router.get(
    "/{class_id}/roster",
    response_model=list[RosterEntry],
    summary="Section roster (P/S; Teacher owns else 404; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_roster(
    class_id: uuid.UUID,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    include: Annotated[str | None, Query(pattern="^withdrawn$")] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_roster_read),
) -> list[RosterEntry]:
    return service.get_roster(
        db, caller=caller, class_id=class_id, semester_id=semester_id, include=include
    )


@router.get(
    "/{class_id}/enrollable-students",
    response_model=EnrollableStudents,
    summary="Active students not yet on the roster (P/S enroll picker)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def enrollable_students(
    class_id: uuid.UUID,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=160)] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> EnrollableStudents:
    return service.enrollable_students(
        db, class_id=class_id, semester_id=semester_id, search=search
    )


@router.post(
    "/{class_id}/enrollments",
    response_model=EnrollmentResult,
    summary="Enroll students into a section (P/S; transfer-aware; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def enroll_students(
    class_id: uuid.UUID,
    payload: EnrollRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> EnrollmentResult:
    return service.enroll_students(db, actor=actor, class_id=class_id, payload=payload)


@router.delete(
    "/{class_id}/enrollments/{enrollment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unenroll a student from a section (P/S; api-spec §5.5)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def unenroll_student(
    class_id: uuid.UUID,
    enrollment_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    service.unenroll_student(
        db, actor=actor, class_id=class_id, enrollment_id=enrollment_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

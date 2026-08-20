"""Assessments routers (api-spec Module 6) — assessments + assessment categories.

Thin transport; the service owns DB + transactions. Two routers are exported and
mounted under `/api/v1`:
  * `router`            prefix /assessments  — assessment CRUD + status + release
  * `categories_router` prefix /offerings    — per-offering categories

Writes are teacher-only (+ ownership, enforced in the service). Reads are scoped.
Route order: /assessments/offerings is declared BEFORE /assessments/{id} so
the literal wins over the UUID path param.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import AssessmentStatus, AssessmentType, Role
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_current_user, get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.assessments import service
from app.modules.assessments.schemas import (
    AssessmentCreateRequest,
    AssessmentDetail,
    AssessmentListItem,
    AssessmentStatusRequest,
    AssessmentUpdateRequest,
    CategoryCreateRequest,
    CategoryDetail,
    CategoryList,
    CategoryUpdateRequest,
    OfferingPickerList,
    NudgeReleaseResult,
    ReleaseRequest,
    ReleaseResult,
)
from app.modules.users.models import User

router = APIRouter(prefix="/assessments", tags=["assessments"])
categories_router = APIRouter(prefix="/offerings", tags=["assessments"])

_ERR = {"model": ErrorResponse}
_teacher = require_role(Role.TEACHER)
#: The nudge inverts this module's usual gate: it is the one action here performed
#: BY an administrator ON a teacher's queue, so P/S only, teacher excluded.
_admin = require_role(Role.PRINCIPAL, Role.SECRETARY)
_any = get_current_user


@router.get("", response_model=Page[AssessmentListItem],
            summary="List assessments (scoped; api-spec §6)",
            responses={401: _ERR, 422: _ERR})
def list_assessments(
    params: PageParams = Depends(page_params),
    offering_id: Annotated[uuid.UUID | None, Query()] = None,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    type: Annotated[AssessmentType | None, Query()] = None,
    status_filter: Annotated[AssessmentStatus | None, Query(alias="status")] = None,
    scope: Annotated[str | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> Page[AssessmentListItem]:
    """`academic_year_id` and `semester_id` compose: the year filters on the SECTION's
    year, the semester on the assessment's own `semester_id`. The student's global
    year·semester switcher sends both, which is how "my assessments for Semester 2"
    stops listing the whole year."""
    return service.list_assessments(
        db, caller=caller, params=params, offering_id=offering_id,
        academic_year_id=academic_year_id, semester_id=semester_id,
        type_filter=type.value if type else None,
        status_filter=status_filter.value if status_filter else None, scope=scope,
    )


@router.get("/offerings", response_model=OfferingPickerList,
            summary="Class-subject picker feed for authoring (scoped)",
            responses={401: _ERR})
def list_offerings_picker(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> OfferingPickerList:
    return service.list_offerings_picker(
        db, caller=caller, academic_year_id=academic_year_id
    )


@router.get("/{assessment_id}", response_model=AssessmentDetail,
            summary="Assessment detail (scoped; api-spec §6)",
            responses={401: _ERR, 403: _ERR, 404: _ERR})
def get_assessment(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> AssessmentDetail:
    return service.get_assessment(db, caller=caller, assessment_id=assessment_id)


@router.post("", response_model=AssessmentDetail, status_code=status.HTTP_201_CREATED,
             summary="Create an assessment (teacher; owns the offering; api-spec §6)",
             responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR})
def create_assessment(
    payload: AssessmentCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> AssessmentDetail:
    return service.create_assessment(db, actor=actor, payload=payload)


@router.patch("/{assessment_id}", response_model=AssessmentDetail,
              summary="Update an assessment (teacher; api-spec §6)",
              responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR})
def update_assessment(
    assessment_id: uuid.UUID,
    payload: AssessmentUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> AssessmentDetail:
    return service.update_assessment(
        db, actor=actor, assessment_id=assessment_id, payload=payload
    )


@router.post("/{assessment_id}/status", response_model=AssessmentDetail,
             summary="Transition assessment lifecycle status (teacher; api-spec §6)",
             responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR})
def change_status(
    assessment_id: uuid.UUID,
    payload: AssessmentStatusRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> AssessmentDetail:
    return service.change_status(
        db, actor=actor, assessment_id=assessment_id, payload=payload
    )


@router.post("/{assessment_id}/release", response_model=ReleaseResult,
             summary="Release grades for an assessment (teacher)",
             responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR})
def release(
    assessment_id: uuid.UUID,
    payload: ReleaseRequest | None = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> ReleaseResult:
    """Body is optional. Omitted → whole-column release (what the frontend sends);
    `{student_ids:[...]}` → per-student release (api-spec §7)."""
    return service.set_release(
        db,
        actor=actor,
        assessment_id=assessment_id,
        released=True,
        student_ids=payload.student_ids if payload else None,
    )


@router.post("/{assessment_id}/unrelease", response_model=ReleaseResult,
             summary="Unrelease grades for an assessment (teacher)",
             responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR})
def unrelease(
    assessment_id: uuid.UUID,
    payload: ReleaseRequest | None = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> ReleaseResult:
    """Mirrors `release`; see there for the two modes."""
    return service.set_release(
        db,
        actor=actor,
        assessment_id=assessment_id,
        released=False,
        student_ids=payload.student_ids if payload else None,
    )


@router.post("/{assessment_id}/nudge-release", response_model=NudgeReleaseResult,
             summary="Remind the teacher to release this assessment's grades (principal/secretary)",
             responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 429: _ERR})
def nudge_release(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_admin),
) -> NudgeReleaseResult:
    """No body. The reminder's recipients are derived from the offering's assigned
    teachers, never supplied by the caller.

    409 when nothing is marked-and-hidden (`nothing_awaiting_release`) or the
    offering is unstaffed (`no_assigned_teacher`); 429 inside the cooldown, which
    carries `retry_after_seconds` so the SPA can re-enable the control at the right
    moment."""
    return service.nudge_release(db, actor=actor, assessment_id=assessment_id)


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Delete an assessment if it has no grades (teacher; api-spec §6)",
               responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR})
def delete_assessment(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> Response:
    service.delete_assessment(db, actor=actor, assessment_id=assessment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Categories (nested under a section's subject offering) ─────────────────────
# D31: categories hang off the OFFERING. The old path threaded a homeroom id and a
# class_subject id to reach one gradebook; an offering IS the gradebook.
_CAT = "/{offering_id}/categories"


@categories_router.get(_CAT, response_model=CategoryList,
                       summary="List assessment categories (scoped; api-spec §6)",
                       responses={401: _ERR, 403: _ERR, 404: _ERR})
def list_categories(
    offering_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_any),
) -> CategoryList:
    return service.list_categories(
        db, caller=caller, offering_id=offering_id
    )


@categories_router.post(_CAT, response_model=CategoryDetail,
                        status_code=status.HTTP_201_CREATED,
                        summary="Create an assessment category (teacher; api-spec §6)",
                        responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR})
def create_category(
    offering_id: uuid.UUID,
    payload: CategoryCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> CategoryDetail:
    return service.create_category(
        db, actor=actor, offering_id=offering_id, payload=payload
    )


@categories_router.patch(_CAT + "/{category_id}", response_model=CategoryDetail,
                         summary="Update an assessment category (teacher; api-spec §6)",
                         responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR})
def update_category(
    offering_id: uuid.UUID,
    category_id: uuid.UUID,
    payload: CategoryUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> CategoryDetail:
    return service.update_category(
        db, actor=actor, offering_id=offering_id,
        category_id=category_id, payload=payload,
    )


@categories_router.delete(_CAT + "/{category_id}", status_code=status.HTTP_204_NO_CONTENT,
                          summary="Delete an assessment category (teacher; api-spec §6)",
                          responses={401: _ERR, 403: _ERR, 404: _ERR})
def delete_category(
    offering_id: uuid.UUID,
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> Response:
    service.delete_category(
        db, actor=actor, offering_id=offering_id,
        category_id=category_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

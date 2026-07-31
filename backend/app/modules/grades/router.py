"""Grades routers (api-spec Module 7, FR-GRD-*).

Thin transport; the service owns DB + transactions. Two routers are exported and
mounted under `/api/v1`:

  * `router`                  prefix /grades       — picker, gradebook, term, me
  * `assessment_grades_router` prefix /assessments  — `PUT /{id}/grades`

The write lives on `/assessments/{id}/grades` because grading is assessment-first
(api-spec §7: there is no `POST /grades`), but the logic belongs to this module —
hence the second router, mirroring how `assessments/router.py` exports
`categories_router` under a different prefix.

Route order matters: `/grades/class-subjects` and `/grades/class-subject/{id}` are
declared before nothing ambiguous, but `/grades/me` and `/grades/term` are literals
that must not be shadowed — there is no `/grades/{id}` route, so no conflict exists.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role
from app.modules.grades import service
from app.modules.grades.schemas import (
    ClassSubjectOptionsResponse,
    Gradebook,
    GradeEntryRequest,
    GradeEntryResponse,
    MyGrades,
    TermGradeList,
)
from app.modules.users.models import User

router = APIRouter(prefix="/grades", tags=["grades"])
assessment_grades_router = APIRouter(prefix="/assessments", tags=["grades"])

_ERR = {"model": ErrorResponse}
_staff = require_role(Role.TEACHER, Role.PRINCIPAL, Role.SECRETARY)
_teacher = require_role(Role.TEACHER)
_student = require_role(Role.STUDENT)
_any_role = require_role(Role.TEACHER, Role.PRINCIPAL, Role.SECRETARY, Role.STUDENT)


@router.get(
    "/class-subjects",
    response_model=ClassSubjectOptionsResponse,
    summary="Gradebook picker — offerings the caller may grade or view",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_class_subjects(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> ClassSubjectOptionsResponse:
    """Teacher → offerings they own; P/S → all offerings of the year. Students have
    no gradebook access (they use `/grades/me`) → 403."""
    return service.list_class_subject_options(
        db, actor=actor, academic_year_id=academic_year_id
    )


@router.get(
    "/class-subject/{class_subject_id}",
    response_model=Gradebook,
    summary="The gradebook grid for one subject offering",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_gradebook(
    class_subject_id: uuid.UUID,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> Gradebook:
    """404 for a teacher who doesn't own the offering (no existence leak).
    P/S read with `can_edit=false`."""
    return service.get_gradebook(
        db, actor=actor, class_subject_id=class_subject_id, semester_id=semester_id
    )


@router.get(
    "/term",
    response_model=TermGradeList,
    summary="Term grades for a student, offering, or section",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def list_term_grades(
    scope: Annotated[str | None, Query(pattern="^me$")] = None,
    student_id: Annotated[uuid.UUID | None, Query()] = None,
    class_subject_id: Annotated[uuid.UUID | None, Query()] = None,
    class_id: Annotated[uuid.UUID | None, Query()] = None,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_any_role),
) -> TermGradeList:
    """Archived years read from `term_grade_snapshots` and report `is_frozen=true`;
    live years compute on read. A student is always scoped to themselves."""
    return service.list_term_grades(
        db,
        actor=actor,
        scope=scope,
        student_id=student_id,
        class_subject_id=class_subject_id,
        class_id=class_id,
        semester_id=semester_id,
    )


@router.get(
    "/me",
    response_model=MyGrades,
    summary="The signed-in student's own released grades",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_my_grades(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_student),
) -> MyGrades:
    """Student-only. Unreleased assessments are omitted AND excluded from the term
    average, so the number shown is derivable from the rows shown.

    `semester_id` narrows within the year the student's global switcher selected; with
    it omitted the response spans every semester of that year, as before."""
    return service.get_my_grades(
        db, actor=actor, academic_year_id=academic_year_id, semester_id=semester_id
    )


@assessment_grades_router.put(
    "/{assessment_id}/grades",
    response_model=GradeEntryResponse,
    summary="Bulk grade entry for an assessment (teacher + ownership)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def upsert_grades(
    assessment_id: uuid.UUID,
    payload: GradeEntryRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_teacher),
) -> GradeEntryResponse:
    """The only grade write (api-spec §7 — assessment-first, no `POST /grades`).

    All-or-nothing: 422 duplicate_entry / student_not_enrolled / score_exceeds_max /
    score_status_conflict / makeup_not_allowed, 409 year_archived, 404 unknown.
    """
    return service.upsert_grades(
        db, actor=actor, assessment_id=assessment_id, payload=payload
    )

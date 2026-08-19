"""Grades routers (api-spec Module 7, FR-GRD-*).

Thin transport; the service owns DB + transactions. Two routers are exported and
mounted under `/api/v1`:

  * `router`                  prefix /grades          — picker, gradebook, term, me
  * `assessment_grades_router` prefix /assessments     — `PUT /{id}/grades`,
                                                        `POST /{id}/grade-revisions`
  * `revisions_router`        prefix /grade-revisions — the Dean's queue and ruling (§D7)

The write lives on `/assessments/{id}/grades` because grading is assessment-first
(api-spec §7: there is no `POST /grades`), but the logic belongs to this module —
hence the second router, mirroring how `assessments/router.py` exports
`categories_router` under a different prefix.

A grade REVISION is filed the same assessment-first way, and then addressed by its own id:
the Dean works a queue across offerings and should not need to know which assessment a
request came from to rule on it. Hence the third router — the same split Phase 4 used for
`/credit-transfers`.

Route order matters: `/grades/class-subjects` and `/grades/class-subject/{id}` are
declared before nothing ambiguous, but `/grades/me` and `/grades/term` are literals
that must not be shadowed — there is no `/grades/{id}` route, so no conflict exists.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.common.enums import GradeRevisionStatus, Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role
from app.modules.grades import revisions as revisions_service
from app.modules.grades import service
from app.modules.grades.schemas import (
    GradeRevisionCreateRequest,
    GradeRevisionDecisionRequest,
    GradeRevisionList,
    GradeRevisionRead,
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
revisions_router = APIRouter(prefix="/grade-revisions", tags=["grades"])

_ERR = {"model": ErrorResponse}
_staff = require_role(Role.TEACHER, Role.PRINCIPAL, Role.SECRETARY)
_teacher = require_role(Role.TEACHER)
_student = require_role(Role.STUDENT)
_any_role = require_role(Role.TEACHER, Role.PRINCIPAL, Role.SECRETARY, Role.STUDENT)
#: A grade REVISION is decided by the Dean alone (D30 §D7, §D14).
_dean = require_role(Role.PRINCIPAL)


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


# ──────────────────────────────────────────────────────────────────────────────
# Grade revision / second opportunity (D30 §D7, brief §20)
# ──────────────────────────────────────────────────────────────────────────────
@assessment_grades_router.post(
    "/{assessment_id}/grade-revisions",
    response_model=GradeRevisionRead,
    status_code=201,
    summary="Request a grade revision — LECTURER, on an offering they own",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def create_grade_revision(
    assessment_id: uuid.UUID,
    payload: GradeRevisionCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> GradeRevisionRead:
    """The Lecturer identifies the student, states a reason and proposes a new result.

    **Allowed after the grade-submission deadline**, unlike `PUT /{id}/grades`: requesting
    writes no grade, and asking the Dean to look at something is exactly what should still
    be possible once the window has shut.

    403 for anyone but the Lecturer — the Dean decides revisions, so letting them file one
    would put both halves of the workflow in one pair of hands. 404 for a Lecturer who does
    not own the offering (no existence leak). 422 `grade_not_entered` /
    `grade_not_graded` / `score_exceeds_max` / `revision_no_change`; 409
    `revision_already_pending`.
    """
    return revisions_service.create_revision(
        db, actor=actor, assessment_id=assessment_id, payload=payload
    )


@revisions_router.get(
    "",
    response_model=GradeRevisionList,
    summary="Grade revision queue — Dean sees all, Lecturer sees their own",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_grade_revisions(
    status: Annotated[GradeRevisionStatus | None, Query()] = None,
    class_subject_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> GradeRevisionList:
    """`?status=pending` IS the Dean's work list — a filtered read, not a notifications
    table (§D8). Oldest first, because a queue is worked in arrival order.

    `pending_for_me` counts what awaits the CALLER's decision, so it is non-zero only for
    the Dean; that is what makes it safe to drive a notification badge from.
    """
    return revisions_service.list_revisions(
        db, actor=actor, status=status, class_subject_id=class_subject_id
    )


@revisions_router.get(
    "/{revision_id}",
    response_model=GradeRevisionRead,
    summary="One grade revision request",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_grade_revision(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> GradeRevisionRead:
    """A Lecturer reading someone else's request gets 404, not 403 — the same
    existence-leak discipline as the gradebook."""
    return revisions_service.get_revision(db, actor=actor, revision_id=revision_id)


@revisions_router.delete(
    "/{revision_id}",
    status_code=204,
    summary="Withdraw your own PENDING revision request",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def withdraw_grade_revision(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> Response:
    """Hard delete, and only of an un-ruled request: it carries no decision. A DECIDED one
    is kept — that row is the record of what the Dean decided."""
    revisions_service.withdraw_revision(db, actor=actor, revision_id=revision_id)
    return Response(status_code=204)


@revisions_router.post(
    "/{revision_id}/decision",
    response_model=GradeRevisionRead,
    summary="Approve or deny a grade revision — DEAN ONLY",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def decide_grade_revision(
    revision_id: uuid.UUID,
    payload: GradeRevisionDecisionRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean),
) -> GradeRevisionRead:
    """Approve writes the revised mark to `makeup_score`, leaving the ORIGINAL `score`
    untouched (§D7), and appends an `audit_log` row carrying both. Deny records the ruling
    and touches no grade.

    **Writes through a closed grade-submission window on purpose** — this is the
    post-deadline path Phase 3's dormant Dean bypass was pointing at.
    """
    return revisions_service.decide_revision(
        db, actor=actor, revision_id=revision_id, payload=payload
    )

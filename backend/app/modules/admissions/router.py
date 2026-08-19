"""Admissions router (D30 §D11, brief §9/§13).

Thin transport; the service owns DB + transactions. Two routers are exported and mounted
under `/api/v1`:

  * `router`                  prefix `/applications`     — the admission record
  * `credit_transfers_router` prefix `/credit-transfers`  — decisions on ONE request

The second router exists because a credit transfer is addressed by its OWN id once filed
— the Dean works a queue across applications and should not have to know which application
a request came from to rule on it. Creating one still hangs off the application, because
that is what it is anchored to (brief §13). Same pattern as `assessment_grades_router`.

**THE PERMISSION SPLIT** (§D14, confirmed with the client):

  Registrar + Dean   file, edit, submit, review, accept, deny, withdraw an application;
                     Section B education rows; the Section F checklist; filing and editing
                     a credit transfer request
  Dean only          APPROVE or DENY a credit transfer (brief §13 — the Dean assesses it)

Students and Lecturers have no admissions access at all: an application is another
person's PII, and a Lecturer has no reason to read it.

Endpoints:
  GET    /applications                              P/S   -> ApplicationPage
  POST   /applications                              P/S   -> ApplicationDetail (201)
  GET    /applications/{id}                         P/S   -> ApplicationDetail
  PATCH  /applications/{id}                         P/S   -> ApplicationDetail
  DELETE /applications/{id}                         P/S   -> 204 (soft)
  POST   /applications/{id}/submit                  P/S   -> ApplicationDetail
  POST   /applications/{id}/review                  P/S   -> ApplicationDetail
  POST   /applications/{id}/accept                  P/S   -> ApplicationAcceptResponse (201)
  POST   /applications/{id}/deny                    P/S   -> ApplicationDetail
  POST   /applications/{id}/withdraw                P/S   -> ApplicationDetail
  PUT    /applications/{id}/education               P/S   -> ApplicationDetail
  PUT    /applications/{id}/documents               P/S   -> ApplicationDetail
  GET    /applications/{id}/credit-transfers        P/S   -> list[CreditTransferRead]
  POST   /applications/{id}/credit-transfers        P/S   -> CreditTransferRead (201)
  GET    /credit-transfers                          P/S   -> list[CreditTransferRead]
  PATCH  /credit-transfers/{id}                     P/S   -> CreditTransferRead
  DELETE /credit-transfers/{id}                     P/S   -> 204
  POST   /credit-transfers/{id}/decision            Dean  -> CreditTransferRead

The transitions are POSTs to named sub-paths rather than a PATCH of `status`, because each
one does more than set a field — accept creates a user, a student and an ID — and a client
that could write `status` directly would be able to skip all of it.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status as http_status
from sqlalchemy.orm import Session

from app.common.enums import ApplicationStatus, CreditTransferStatus, Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.admissions import service
from app.modules.admissions.schemas import (
    ApplicationAcceptRequest,
    ApplicationAcceptResponse,
    ApplicationCreateRequest,
    ApplicationDenyRequest,
    ApplicationDetail,
    ApplicationPage,
    ApplicationUpdateRequest,
    CreditTransferCreateRequest,
    CreditTransferDecisionRequest,
    CreditTransferRead,
    CreditTransferUpdateRequest,
    DocumentReplaceRequest,
    EducationReplaceRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/applications", tags=["admissions"])
credit_transfers_router = APIRouter(prefix="/credit-transfers", tags=["admissions"])

_ERR = {"model": ErrorResponse}
#: Registrar + Dean. Admission is administration (§D14).
_admissions = require_role(Role.PRINCIPAL, Role.SECRETARY)
#: The Dean alone decides a credit transfer (brief §13).
_dean = require_role(Role.PRINCIPAL)


# ──────────────────────────────────────────────────────────────────────────────
# The application record
# ──────────────────────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=ApplicationPage,
    summary="Admissions list (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_applications(
    status: Annotated[ApplicationStatus | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    program_id: Annotated[uuid.UUID | None, Query()] = None,
    params: PageParams = Depends(page_params),
    db: Session = Depends(get_db),
    _actor: User = Depends(_admissions),
) -> ApplicationPage:
    """Ordered surname-first (§D10). `?status=submitted` is the decision queue."""
    return service.list_applications(
        db, params=params, status=status, search=search, program_id=program_id
    )


@router.post(
    "",
    response_model=ApplicationDetail,
    status_code=http_status.HTTP_201_CREATED,
    summary="File an application (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def create_application(
    payload: ApplicationCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """Files a DRAFT from the applicant's names alone; `submit=true` submits outright.

    The names-only minimum is what makes the Sections A–G wizard interruption-safe — step
    A files the draft, later steps PATCH it, and a closed tab loses nothing.
    """
    return service.create_application(db, actor=actor, payload=payload)


@router.get(
    "/{application_id}",
    response_model=ApplicationDetail,
    summary="One application, with its education rows, checklist and transfers",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_application(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    _actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """`blocking_issues` lists what still stands between this form and acceptance, so the
    review screen can explain a disabled Accept button rather than the Registrar
    discovering the reason by pressing it."""
    return service.get_application(db, application_id=application_id)


@router.patch(
    "/{application_id}",
    response_model=ApplicationDetail,
    summary="Edit an application (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_application(
    application_id: uuid.UUID,
    payload: ApplicationUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """Only the keys PRESENT in the body are applied, so a one-section PATCH cannot blank
    the rest. 409 `application_decided` once accepted, denied or withdrawn."""
    return service.update_application(
        db, actor=actor, application_id=application_id, payload=payload
    )


@router.delete(
    "/{application_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
    summary="Withdraw an application from the list — soft (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def delete_application(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> Response:
    """Soft — an admissions record is kept. 409 on an ACCEPTED application: a student and
    a login hang off it, and hiding it would leave that student untraceable."""
    service.delete_application(db, actor=actor, application_id=application_id)
    return Response(status_code=http_status.HTTP_204_NO_CONTENT)


# ── Transitions ───────────────────────────────────────────────────────────────
@router.post(
    "/{application_id}/submit",
    response_model=ApplicationDetail,
    summary="Submit a draft (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def submit_application(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """422 `application_incomplete` lists EVERY missing thing at once, rather than making
    the Registrar submit six times to find them."""
    return service.submit_application(db, actor=actor, application_id=application_id)


@router.post(
    "/{application_id}/review",
    response_model=ApplicationDetail,
    summary="Move a submitted application under review (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def review_application(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """A triage state, so a queue can be worked without the only options being "decide
    now" and "leave it"."""
    return service.set_under_review(db, actor=actor, application_id=application_id)


@router.post(
    "/{application_id}/accept",
    response_model=ApplicationAcceptResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Accept — creates the student, the login and the student ID (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def accept_application(
    application_id: uuid.UUID,
    payload: ApplicationAcceptRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationAcceptResponse:
    """Decision #5 — the SINGLE action that admits a student.

    One transaction: allocate the `YYYYMM###`, create the login, build the student from
    Sections A–E, open the programme history, fill in the official-use block. The
    temporary password is returned ONCE and only when the server generated it.
    """
    return service.accept_application(
        db, actor=actor, application_id=application_id, payload=payload
    )


@router.post(
    "/{application_id}/deny",
    response_model=ApplicationDetail,
    summary="Deny an application (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def deny_application(
    application_id: uuid.UUID,
    payload: ApplicationDenyRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """Terminal, and not a delete: the college's refusal is part of the record."""
    return service.deny_application(
        db, actor=actor, application_id=application_id, reason=payload.reason
    )


@router.post(
    "/{application_id}/withdraw",
    response_model=ApplicationDetail,
    summary="Record that the APPLICANT withdrew (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def withdraw_application(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """Distinct from `deny` — one is the applicant's choice, the other the college's."""
    return service.withdraw_application(db, actor=actor, application_id=application_id)


# ── Section B / Section F ──────────────────────────────────────────────────────
@router.put(
    "/{application_id}/education",
    response_model=ApplicationDetail,
    summary="Replace Section B's institution rows (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def replace_education(
    application_id: uuid.UUID,
    payload: EducationReplaceRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """A whole-set replace: the Registrar edits the table as a block, and `sort_order` is
    renumbered server-side so the client never has to keep it consistent."""
    return service.replace_education(
        db, actor=actor, application_id=application_id, payload=payload
    )


@router.put(
    "/{application_id}/documents",
    response_model=ApplicationDetail,
    summary="Replace Section F's document checklist (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def replace_documents(
    application_id: uuid.UUID,
    payload: DocumentReplaceRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> ApplicationDetail:
    """Reconciled by id, not delete-and-reinsert: three of these rows may be cited by a
    credit transfer, and those FKs are `ON DELETE SET NULL` — a blanket delete would strip
    a pending transfer of its papers silently. 409 `document_in_use` says so instead."""
    return service.replace_documents(
        db, actor=actor, application_id=application_id, payload=payload
    )


# ── Credit transfer, filed against an application ─────────────────────────────
@router.get(
    "/{application_id}/credit-transfers",
    response_model=list[CreditTransferRead],
    summary="Credit transfer requests on one application (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def list_application_credit_transfers(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    _actor: User = Depends(_admissions),
) -> list[CreditTransferRead]:
    return service.list_credit_transfers(db, application_id=application_id, status=None)


@router.post(
    "/{application_id}/credit-transfers",
    response_model=CreditTransferRead,
    status_code=http_status.HTTP_201_CREATED,
    summary="File a credit transfer request (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def create_credit_transfer(
    application_id: uuid.UUID,
    payload: CreditTransferCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> CreditTransferRead:
    """**Admission only** (brief §13) — 409 once the application is decided, because by
    then there is a student and the moment to ask has passed. The ≥75% floor is not
    checked here: filing states a claim, the Dean assesses it."""
    return service.create_credit_transfer(
        db, actor=actor, application_id=application_id, payload=payload
    )


# ──────────────────────────────────────────────────────────────────────────────
# Credit transfer, addressed by its own id
# ──────────────────────────────────────────────────────────────────────────────
@credit_transfers_router.get(
    "",
    response_model=list[CreditTransferRead],
    summary="Credit transfer queue (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_credit_transfers(
    status: Annotated[CreditTransferStatus | None, Query()] = None,
    application_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    _actor: User = Depends(_admissions),
) -> list[CreditTransferRead]:
    """`?status=pending` IS the Dean's work list — a filtered read, not a new table, the
    same reasoning §D8 applies to the grade-revision queue."""
    return service.list_credit_transfers(db, application_id=application_id, status=status)


@credit_transfers_router.patch(
    "/{transfer_id}",
    response_model=CreditTransferRead,
    summary="Edit a PENDING credit transfer request (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_credit_transfer(
    transfer_id: uuid.UUID,
    payload: CreditTransferUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> CreditTransferRead:
    """409 once decided: changing the course or the equivalency under a ruling would make
    the Dean's decision describe something else."""
    return service.update_credit_transfer(
        db, actor=actor, transfer_id=transfer_id, payload=payload
    )


@credit_transfers_router.delete(
    "/{transfer_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
    summary="Remove a PENDING credit transfer request (Registrar + Dean)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def delete_credit_transfer(
    transfer_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_admissions),
) -> Response:
    """A HARD delete, unlike an application: an un-ruled request carries no history. A
    decided one is kept, because it records what the Dean decided."""
    service.delete_credit_transfer(db, actor=actor, transfer_id=transfer_id)
    return Response(status_code=http_status.HTTP_204_NO_CONTENT)


@credit_transfers_router.post(
    "/{transfer_id}/decision",
    response_model=CreditTransferRead,
    summary="Approve or deny a credit transfer — DEAN ONLY",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def decide_credit_transfer(
    transfer_id: uuid.UUID,
    payload: CreditTransferDecisionRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean),
) -> CreditTransferRead:
    """Brief §13 — the Dean assesses and decides. Approval needs ≥75% content equivalency
    and a tertiary institution on Section B; 422 names whichever rule failed."""
    return service.decide_credit_transfer(
        db, actor=actor, transfer_id=transfer_id, payload=payload
    )

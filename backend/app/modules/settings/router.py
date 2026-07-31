"""Settings router (api-spec §5 Module 11) — the 18 settings endpoints.

Thin transport layer: parse the request, delegate ALL business + DB logic to
`service.py`, then shape the HTTP response. No DB access or transactions here.

Endpoints (all mount under `/api/v1` via app/main.py):
  School:
    GET    /settings/school                       authenticated  -> SchoolProfileRead
    PUT    /settings/school                        principal      -> SchoolProfileRead
    POST   /settings/school/logo                   principal      -> LogoUploadResponse
  Academic structure:
    GET    /settings/active-term                   authenticated  -> ActiveTerm | 409
    GET    /settings/academic-years                authenticated  -> AcademicYearList
    GET    /settings/semesters                     authenticated  -> SemesterList
    POST   /settings/academic-years                principal      -> AcademicYearDetail (201)
    PATCH  /settings/semesters/{id}/activate        principal      -> SemesterDetail
    POST   /settings/academic-years/{id}/archive    principal      -> ArchiveYearResponse (202)
  Grading scale:
    GET    /settings/grading-scale                 authenticated  -> GradingScaleRead
    PUT    /settings/grading-scale                 principal      -> GradingScaleUpdateResponse
  Assessment policy:
    GET    /settings/assessment-policy             P/S            -> AssessmentPolicyRead
    PUT    /settings/assessment-policy             principal      -> AssessmentPolicyRead
  Users admin:
    GET    /settings/users                         P/S            -> Page[UserListItem]
    POST   /settings/users                         P/S*           -> UserCreateResponse (201)
    PATCH  /settings/users/{id}                     P/S* / P       -> UserListItem
  Account/preferences:
    GET    /settings/account                       authenticated  -> CurrentUser
    PATCH  /settings/account                        authenticated  -> CurrentUser
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import CurrentUser, ErrorResponse, Page
from app.core.deps import get_current_user, get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.settings import service
from app.modules.settings.schemas import (
    AccountUpdateRequest,
    ActiveTerm,
    AcademicYearCreateRequest,
    AcademicYearDetail,
    AcademicYearList,
    ArchiveYearResponse,
    AssessmentPolicyRead,
    AssessmentPolicyUpdateRequest,
    GradingScaleRead,
    GradingScaleUpdateRequest,
    GradingScaleUpdateResponse,
    LogoUploadResponse,
    SchoolProfileRead,
    SchoolUpdateRequest,
    SemesterDetail,
    SemesterList,
    UserCreateRequest,
    UserCreateResponse,
    UserListItem,
    UserUpdateRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/settings", tags=["settings"])

_ERR = {"model": ErrorResponse}

# Reusable role-gate dependencies (api-spec §3.4 permission matrix).
_principal = require_role(Role.PRINCIPAL)
_principal_or_secretary = require_role(Role.PRINCIPAL, Role.SECRETARY)


# ── School profile / branding ───────────────────────────────────────────────────
@router.get(
    "/school",
    response_model=SchoolProfileRead,
    summary="School identity / branding (api-spec §5.11)",
    responses={401: _ERR},
)
def get_school(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> SchoolProfileRead:
    """Authenticated read — every role needs identity for report headers."""
    return service.get_school(db)


@router.put(
    "/school",
    response_model=SchoolProfileRead,
    summary="Update school identity (principal; api-spec §5.11)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def update_school(
    payload: SchoolUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> SchoolProfileRead:
    """Principal only (Secretary read-only per matrix). Audited."""
    return service.update_school(db, actor=actor, payload=payload)


@router.post(
    "/school/logo",
    response_model=LogoUploadResponse,
    summary="Upload the school logo (principal, multipart; api-spec §5.11)",
    responses={401: _ERR, 403: _ERR, 413: _ERR, 415: _ERR},
)
async def upload_school_logo(
    file: Annotated[UploadFile, File()],
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> LogoUploadResponse:
    """Principal only; multipart/form-data image.

    NOTE: real object-storage upload is stubbed — see service.upload_logo
    TODO(OQ-DB5). Validation (415 unsupported_media_type, 413 file_too_large) is
    real; the endpoint returns {logo_url} (None until storage is provisioned)."""
    data = await file.read()
    logo_url = service.upload_logo(
        db, actor=actor, content_type=file.content_type, data=data
    )
    return LogoUploadResponse(logo_url=logo_url)


# ── Academic structure ──────────────────────────────────────────────────────────
@router.get(
    "/active-term",
    response_model=ActiveTerm,
    summary="The active academic year + semester (api-spec §5.11)",
    responses={401: _ERR, 409: _ERR},
)
def get_active_term(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ActiveTerm:
    """Authenticated. 409 no_active_semester is the uniform system-wide degrade
    signal (fresh install or only-active-year just archived)."""
    return service.get_active_term(db)


@router.get(
    "/academic-years",
    response_model=AcademicYearList,
    summary="All academic years + their semesters (authenticated; api-spec §5.11)",
    responses={401: _ERR},
)
def list_academic_years(
    db: Session = Depends(get_db),
    _actor: User = Depends(get_current_user),
) -> AcademicYearList:
    """Readable by EVERY authenticated role, not just P/S.

    This is the calendar every module's period picker is built from: `useYearFilter`
    (staff `?year=` filter on Grades/Attendance/Classes/Students) and the student's
    global year·semester switcher both read it. Gated to P/S, a teacher's picker got a
    403, so `years` came back empty, no `academic_year_id` was sent, and the picker
    silently vanished — while the MSW handler, which has no role gate, made it all look
    fine in demo mode. Year names and dates are not sensitive (`/settings/active-term`
    already exposes the current pair to everyone); the WRITES below stay principal-only,
    which is where the actual authority lives.
    """
    return AcademicYearList(items=service.list_academic_years(db))


@router.get(
    "/semesters",
    response_model=SemesterList,
    summary="Semesters, optionally filtered by year (authenticated; api-spec §5.11)",
    responses={401: _ERR},
)
def list_semesters(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    _actor: User = Depends(get_current_user),
) -> SemesterList:
    """Authenticated — same reasoning as `/academic-years` above."""
    return SemesterList(
        items=service.list_semesters(db, academic_year_id=academic_year_id)
    )


@router.post(
    "/academic-years",
    response_model=AcademicYearDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create an academic year + exactly 2 semesters (principal; api-spec §5.11)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_academic_year(
    payload: AcademicYearCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> AcademicYearDetail:
    """Principal. Creates EXACTLY 2 semesters (D10), seeds grading scale + default
    bands (D11). 409 active_year_exists when an active year already exists."""
    return service.create_academic_year(db, actor=actor, payload=payload)


@router.patch(
    "/semesters/{semester_id}/activate",
    response_model=SemesterDetail,
    summary="Activate a semester (principal; one-active invariant; api-spec §5.11)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def activate_semester(
    semester_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> SemesterDetail:
    """Principal. Clears the prior active semester, sets this one active."""
    return service.activate_semester(db, actor=actor, semester_id=semester_id)


@router.post(
    "/academic-years/{year_id}/archive",
    response_model=ArchiveYearResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Archive (freeze) an academic year (principal; api-spec §5.11)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def archive_academic_year(
    year_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> ArchiveYearResponse:
    """Principal. Computes and writes `term_grade_snapshots` +
    `report_card_snapshots` (schema §10.4), then applies the state transitions;
    `snapshots_written` reports the term-grade rows frozen. 409 year_already_archived
    if already archived."""
    written, no_active = service.archive_academic_year(
        db, actor=actor, year_id=year_id
    )
    return ArchiveYearResponse(
        snapshots_written=written, no_active_year_remaining=no_active
    )


# ── Grading scale ─────────────────────────────────────────────────────────────
@router.get(
    "/grading-scale",
    response_model=GradingScaleRead,
    summary="The grading scale + bands (authenticated; default active; api-spec §5.11)",
    responses={401: _ERR, 404: _ERR},
)
def get_grading_scale(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> GradingScaleRead:
    """Authenticated — Grades/Reports/SPA need it to display letters."""
    return service.get_grading_scale(db, academic_year_id=academic_year_id)


@router.put(
    "/grading-scale",
    response_model=GradingScaleUpdateResponse,
    summary="Update the grading scale (principal; api-spec §5.11, FR-SET-03/06)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_grading_scale(
    payload: GradingScaleUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> GradingScaleUpdateResponse:
    """Principal (Secretary cannot, FR-SET-04). 422 grading_bands_invalid on
    non-contiguous bands; 409 scale_frozen on a frozen scale."""
    scale = service.update_grading_scale(
        db,
        actor=actor,
        pass_mark=payload.pass_mark,
        bands=payload.bands,
        academic_year_id=payload.academic_year_id,
    )
    return GradingScaleUpdateResponse(
        academic_year_id=scale.academic_year_id,
        pass_mark=scale.pass_mark,
        is_frozen=scale.is_frozen,
        bands=scale.bands,
        affects_displayed_grades=True,
    )


# ── Assessment policy ─────────────────────────────────────────────────────────
@router.get(
    "/assessment-policy",
    response_model=AssessmentPolicyRead,
    summary="School-default grading policy (P/S; api-spec §5.11, DB-14)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_assessment_policy(
    db: Session = Depends(get_db),
    _actor: User = Depends(_principal_or_secretary),
) -> AssessmentPolicyRead:
    return service.get_assessment_policy(db)


@router.put(
    "/assessment-policy",
    response_model=AssessmentPolicyRead,
    summary="Update the school-default grading policy (principal; api-spec §5.11)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def update_assessment_policy(
    payload: AssessmentPolicyUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal),
) -> AssessmentPolicyRead:
    return service.update_assessment_policy(db, actor=actor, payload=payload)


# ── User & role management ────────────────────────────────────────────────────
@router.get(
    "/users",
    response_model=Page[UserListItem],
    summary="List users (P/S; api-spec §5.11, FR-SET-04)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_users(
    params: PageParams = Depends(page_params),
    role: Annotated[Role | None, Query()] = None,
    is_active: Annotated[bool | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=120)] = None,
    db: Session = Depends(get_db),
    _actor: User = Depends(_principal_or_secretary),
) -> Page[UserListItem]:
    return service.list_users(
        db, params=params, role=role, is_active=is_active, search=search
    )


@router.post(
    "/users",
    response_model=UserCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user login (P/S; principal-only for privileged roles; §5.11)",
    responses={401: _ERR, 403: _ERR, 409: _ERR, 422: _ERR},
)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> UserCreateResponse:
    """P/S may create teacher/student logins; assigning principal/secretary is
    Principal-only (403 role_change_forbidden). 409 duplicate_email. New users get
    must_change_password=true; a generated temp password is returned ONCE."""
    user, temp_password = service.create_user(db, actor=actor, payload=payload)
    return UserCreateResponse(
        user=UserListItem.model_validate(user),
        temporary_password=temp_password,
    )


@router.patch(
    "/users/{user_id}",
    response_model=UserListItem,
    summary="Update a user (P for role/active; P/S for benign edits; §5.11)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_principal_or_secretary),
) -> UserListItem:
    """role/is_active are Principal-only; a Secretary cannot edit a Principal (403).
    Audited on role/active changes."""
    user = service.update_user(db, actor=actor, target_id=user_id, payload=payload)
    return UserListItem.model_validate(user)


# ── Per-user account & preferences ──────────────────────────────────────────────
@router.get(
    "/account",
    response_model=CurrentUser,
    summary="Own account + preferences (authenticated self; api-spec §5.11)",
    responses={401: _ERR},
)
def get_account(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CurrentUser:
    return service.get_account(db, user)


@router.patch(
    "/account",
    response_model=CurrentUser,
    summary="Update own contact info + preferences (authenticated self; §5.11)",
    responses={401: _ERR, 422: _ERR},
)
def update_account(
    payload: AccountUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CurrentUser:
    return service.update_account(db, user=user, payload=payload)

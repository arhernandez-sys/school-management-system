"""Auth router (api-spec §2.3) — the 6 authentication & session endpoints.

Thin transport layer: parse the request, delegate ALL business + DB logic to
`service.py`, then shape the HTTP response and (de)set the `sis_refresh` cookie
via the shared cookie helpers. No DB access or transactions live here.

Endpoints (all mount under `/api/v1/auth` via app/main.py):
  POST   /auth/login                      → AuthTokenResponse + Set-Cookie
  POST   /auth/refresh                    → AuthTokenResponse + rotated Set-Cookie
  POST   /auth/logout                     → 204, clears cookie
  GET    /auth/me                         → CurrentUser
  PATCH  /auth/me/password                → 204
  POST   /auth/users/{user_id}/reset-password → ResetPasswordResponse (once)
"""

from __future__ import annotations

import ipaddress
import uuid

from fastapi import APIRouter, Depends, Header, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.common.enums import Role
from app.common.schemas import CurrentUser, ErrorResponse
from app.config import Settings, get_settings
from app.core.cookies import (
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    set_refresh_cookie,
)
from app.core.deps import get_current_user, get_db, require_role
from app.core.errors import _envelope
from app.core.security import parse_refresh_jti
from app.modules.auth import service
from app.modules.auth.schemas import (
    AuthTokenResponse,
    ChangePasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from app.modules.users.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

# Shared error-envelope responses for the OpenAPI doc (api-spec §4.2).
_ERR = {"model": ErrorResponse}


_REFRESH_INVALID_MESSAGE = "Your session could not be refreshed; please sign in again."


def _refresh_invalid_response(
    settings: Settings, *, message: str = _REFRESH_INVALID_MESSAGE
) -> JSONResponse:
    """Build the 401 `refresh_invalid` response with the clearing `sis_refresh`
    cookie attached to THIS response (so the browser actually deletes it).

    The body reuses `errors._envelope` so it is byte-identical to what the global
    AppError handler would have produced for an `Unauthenticated(code=
    "refresh_invalid")` — same `{error:{code,message}}` shape (api-spec §4.2)."""
    resp = JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content=_envelope("refresh_invalid", message),
    )
    clear_refresh_cookie(resp, settings)
    return resp


def _client_meta(request: Request) -> tuple[str | None, str | None]:
    """Best-effort (user_agent, ip) for the session/attempt audit columns.

    `ip_address` columns are Postgres INET, so a non-IP host value (e.g. the
    TestClient's "testclient", or a malformed proxy header) must be coerced to
    NULL rather than crash the INSERT — these are advisory audit fields, not a
    security control."""
    ua = request.headers.get("user-agent")
    raw_ip = request.client.host if request.client else None
    ip: str | None = None
    if raw_ip:
        try:
            ip = str(ipaddress.ip_address(raw_ip))
        except ValueError:
            ip = None
    return ua, ip


@router.post(
    "/login",
    response_model=AuthTokenResponse,
    summary="Authenticate by identifier + password (api-spec §2.3)",
    responses={401: _ERR, 403: _ERR, 422: _ERR, 423: _ERR, 429: _ERR},
)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthTokenResponse:
    """Establish a session: mint an access token + set the HttpOnly refresh
    cookie. Non-enumerating 401 for a wrong identifier OR password; 423 (with
    `retry_after_seconds`) while locked; 403 for inactive accounts (api-spec §2.3)."""
    ua, ip = _client_meta(request)
    result = service.login(
        db,
        identifier=payload.identifier,
        password=payload.password,
        settings=settings,
        user_agent=ua,
        ip_address=ip,
    )
    set_refresh_cookie(response, result.raw_refresh_token, settings)
    return AuthTokenResponse(access_token=result.access_token, user=result.user)


@router.post(
    "/refresh",
    response_model=AuthTokenResponse,
    summary="Rotate the refresh token and re-issue an access token (api-spec §2.3)",
    responses={401: _ERR, 429: _ERR},
)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    x_refresh: str | None = Header(default=None, alias="X-Refresh"),
) -> AuthTokenResponse | JSONResponse:
    """Cookie-only auth + the custom `X-Refresh: 1` header (CSRF defense, §2.2).
    Validates + ROTATES the refresh session. On ANY failure → 401 refresh_invalid
    AND the cookie is cleared.

    NOTE: every failure path RETURNS a `JSONResponse` (rather than raising) so the
    clearing `Set-Cookie` is attached to the response that is actually sent. If we
    raised, FastAPI would route to the global handler and DISCARD this `response`
    object — the clearing cookie would never reach the browser (api-spec §2.3
    requires a refresh failure to clear the cookie)."""
    raw_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    # §2.2: reject without the custom header (a forged cross-site call lacks it).
    if x_refresh != "1":
        return _refresh_invalid_response(settings)
    try:
        ua, ip = _client_meta(request)
        result = service.refresh(
            db,
            raw_cookie=raw_cookie,
            settings=settings,
            user_agent=ua,
            ip_address=ip,
        )
    except service.Unauthenticated as exc:
        # Clear the (stale/invalid) cookie on every failure path — returned, not
        # raised, so the Set-Cookie survives (see the function docstring).
        return _refresh_invalid_response(settings, message=exc.message)
    set_refresh_cookie(response, result.raw_refresh_token, settings)
    return AuthTokenResponse(access_token=result.access_token, user=result.user)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Terminate the current session (idempotent, api-spec §2.3)",
    responses={401: _ERR},
)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> Response:
    """Authenticated; revoke the refresh session named by the cookie and clear it.
    Idempotent — an already-logged-out caller still gets 204."""
    raw_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    service.logout(db, raw_cookie=raw_cookie)
    clear_refresh_cookie(response, settings)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get(
    "/me",
    response_model=CurrentUser,
    summary="The signed-in user's identity, role and preferences (api-spec §2.3)",
    responses={401: _ERR},
)
def me(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CurrentUser:
    """Resolve the CurrentUser payload (profile ids + preferences)."""
    return service.build_current_user(db, user)


@router.patch(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change your own password (api-spec §2.3, FR-AUTH-09)",
    responses={401: _ERR, 422: _ERR},
)
def change_my_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Self only. `current_password` required UNLESS must_change_password is set.
    New password is validated against the policy → 422 weak_password. On success,
    all OTHER refresh sessions are revoked (the current one is kept)."""
    raw_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    keep_jti = parse_refresh_jti(raw_cookie) if raw_cookie else None
    service.change_password(
        db,
        user=user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        keep_session_jti=keep_jti,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/users/{user_id}/reset-password",
    response_model=ResetPasswordResponse,
    summary="Admin-initiated password reset (api-spec §2.3, FR-SET-04)",
    responses={403: _ERR, 404: _ERR, 409: _ERR},
)
def reset_user_password(
    user_id: uuid.UUID,
    _payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(Role.PRINCIPAL, Role.SECRETARY)),
) -> ResetPasswordResponse:
    """Principal/Secretary reset another user. A Secretary may NOT reset a
    Principal (403); cannot reset self (409 cannot_reset_self); unknown target
    (404 user_not_found). Returns a generated temporary password ONCE."""
    temp_password = service.reset_password(db, actor=actor, target_user_id=user_id)
    return ResetPasswordResponse(temporary_password=temp_password)

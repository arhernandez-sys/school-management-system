"""Auth request/response schemas (api-spec §2.3, §4.4).

Write models set `extra="forbid"` (api-spec §1.4) so typo'd fields fail loudly.
Response bodies match the frontend's `AuthTokenResponse` / `CurrentUser` exactly.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.common.schemas import CurrentUser


# ── Requests ────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Required UNLESS the user must_change_password (validated in the service).
    current_password: str | None = Field(default=None, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    delivery: str | None = Field(default="temp_password")


# ── Responses ─────────────────────────────────────────────────────────────────
class AuthTokenResponse(BaseModel):
    """200 body of /auth/login and /auth/refresh."""

    access_token: str
    user: CurrentUser


class ResetPasswordResponse(BaseModel):
    """200 body of /auth/users/{id}/reset-password — returned ONCE."""

    temporary_password: str


# CurrentUser is the 200 body of GET /auth/me; re-exported for the router.
__all__ = [
    "LoginRequest",
    "ChangePasswordRequest",
    "ResetPasswordRequest",
    "AuthTokenResponse",
    "ResetPasswordResponse",
    "CurrentUser",
]

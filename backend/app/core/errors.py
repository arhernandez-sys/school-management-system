"""Typed exception hierarchy + global handlers → the ErrorResponse envelope
(architecture.md §8.1, api-spec §4.2/§4.3/§7).

One global handler maps every AppError subclass to:
    { "error": { "code", "message", "fields?", "request_id?" } }
with the correct HTTP status. FastAPI/Pydantic 422s are normalized into the SAME
envelope with code="validation_error" + populated `fields`. Unhandled 500s return
code="internal_error" + a `request_id` and NEVER a stack trace or SQL.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("sis.error")


# ── Exception hierarchy ─────────────────────────────────────────────────────────
class AppError(Exception):
    """Base for all application errors mapped to the ErrorResponse envelope."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        fields: dict[str, list[str]] | None = None,
        extra: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        self.fields = fields
        # `extra` merges additional top-level keys into the error body (e.g.
        # retry_after_seconds for account_locked).
        self.extra = extra or {}
        # `headers` sets response headers the status code has a STANDARD meaning
        # for — currently only `Retry-After` on a 429 (core/ratelimit.py). The
        # machine-readable value is still in the body as `retry_after_seconds`;
        # the header exists for proxies and non-browser clients that act on it.
        # Cross-origin JS can only read it because `Retry-After` is listed in the
        # CORS `expose_headers` in app/main.py.
        self.headers = headers


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_error"


class Unauthenticated(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthenticated"


class InvalidCredentials(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "invalid_credentials"


class Forbidden(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class Conflict(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class AccountLocked(AppError):
    status_code = status.HTTP_423_LOCKED
    code = "account_locked"


class AccountInactive(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "account_inactive"


class RateLimited(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


# ── Envelope construction ────────────────────────────────────────────────────────
def _envelope(
    code: str,
    message: str,
    *,
    fields: dict[str, list[str]] | None = None,
    request_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    if request_id:
        body["request_id"] = request_id
    if extra:
        body.update(extra)
    return {"error": body}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


# ── Handlers ──────────────────────────────────────────────────────────────────
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(
            exc.code,
            exc.message,
            fields=exc.fields,
            extra=exc.extra,
        ),
        headers=exc.headers or None,
    )


#: Where FastAPI says a validation error came from. These appear as loc[0] only.
_LOCATION_PREFIXES = frozenset({"body", "query", "path", "header", "cookie"})


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Normalize FastAPI/Pydantic 422 into the standard envelope with per-field
    messages (api-spec §4.3)."""
    fields: dict[str, list[str]] = {}
    for err in exc.errors():
        # `loc` is ("body", "title") or ("body", "entries", 0, "student_id") — a
        # location prefix, then the path to the offending field.
        #
        # Only the FIRST segment is a location. Filtering every occurrence would
        # erase a field genuinely NAMED "body" (announcements have one): loc
        # ("body", "body") would collapse to empty and report as "_root", so the
        # frontend could not attach the message to its textarea.
        loc = [str(p) for p in err.get("loc", [])]
        if loc and loc[0] in _LOCATION_PREFIXES:
            loc = loc[1:]
        # Skip list indices ("0") so `entries.0.student_id` reports as "student_id".
        names = [p for p in loc if not p.isdigit()]
        field = names[-1] if names else "_root"
        fields.setdefault(field, []).append(err.get("msg", "Invalid value."))
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_envelope(
            "validation_error",
            "Some fields need attention.",
            fields=fields,
        ),
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Map bare Starlette/FastAPI HTTPExceptions (e.g. 404 for unknown routes,
    405) into the envelope so the SPA never sees a non-conforming error body."""
    code_map = {
        401: "unauthenticated",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        409: "conflict",
        422: "validation_error",
        429: "rate_limited",
    }
    code = code_map.get(exc.status_code, "error")
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(status_code=exc.status_code, content=_envelope(code, message))


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort 500: log the full error server-side, return a generic body with
    a request_id for correlation — NEVER a stack trace or SQL (api-spec §4.2)."""
    rid = _request_id(request)
    logger.exception("unhandled_error", extra={"request_id": rid})
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_envelope(
            "internal_error",
            "An unexpected error occurred.",
            request_id=rid,
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)

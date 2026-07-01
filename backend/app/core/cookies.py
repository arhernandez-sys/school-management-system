"""Refresh-cookie helper (architecture.md §3.1, api-spec §2.1/§2.3).

The refresh token is delivered ONLY as an HttpOnly cookie named ``sis_refresh``
(never in a JSON body, never readable by JS). The Auth router (sub-phase 7.0+,
built separately) imports `set_refresh_cookie` / `clear_refresh_cookie` so the
cross-origin cookie posture is defined in exactly one place and cannot drift.

Frontend contract (non-negotiable — see api-spec §2.1):
  - name      : ``sis_refresh``
  - HttpOnly  : always (JS must never read it)
  - Secure    : ``settings.cookie_secure`` (True outside `local`; mandatory when
                SameSite=None per RFC — browsers reject SameSite=None without Secure)
  - SameSite  : ``None`` cross-origin (Vercel SPA ↔ Railway API) so the cookie is
                sent on the cross-site /auth/refresh + /auth/logout calls.
                ``Lax`` only in same-origin local dev (where Secure is off and a
                None+insecure cookie would be dropped by the browser).
  - Path      : ``/api/v1/auth`` — see the PATH note below.
  - Max-Age   : ``settings.jwt_refresh_ttl`` (set); 0 (clear).

PATH note (documented decision):
  api-spec §2.3 literally shows ``Path=/api/v1/auth/refresh`` on the login
  Set-Cookie, but §2.3 ALSO requires ``POST /auth/logout`` to read the refresh
  cookie to identify the session row to revoke. A cookie scoped to
  ``/api/v1/auth/refresh`` is NOT sent to ``/api/v1/auth/logout`` (different
  path), so logout could not see it. We therefore scope the cookie to the
  narrowest path that serves BOTH endpoints: ``/api/v1/auth``. This still keeps
  the cookie off the rest of the API surface (it authorizes only the auth
  sub-tree), preserving the CSRF posture in §2.2 (every non-auth endpoint uses
  the Bearer header, not the cookie). This is flagged to the orchestrator as a
  reconciliation of the api-spec's own logout requirement.
"""

from __future__ import annotations

from fastapi import Response

from app.config import Settings

REFRESH_COOKIE_NAME = "sis_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"


def _same_site(settings: Settings) -> str:
    # Cross-origin (prod/staging) requires SameSite=None + Secure. In local
    # same-origin dev, Secure is off, and SameSite=None without Secure is
    # rejected by modern browsers — fall back to Lax there.
    return "lax" if settings.is_local else "none"


def set_refresh_cookie(response: Response, raw_token: str, settings: Settings) -> None:
    """Attach the rotated refresh token as the HttpOnly ``sis_refresh`` cookie.

    Called by the Auth router on login and on every refresh rotation (api-spec
    §2.3). The raw token is the value produced by `security.new_refresh_token()`;
    only its SHA-256 hash is persisted server-side.
    """
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=settings.jwt_refresh_ttl,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=_same_site(settings),
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response, settings: Settings) -> None:
    """Expire the ``sis_refresh`` cookie (logout / failed refresh, api-spec §2.3).

    The attributes (name, path, samesite, secure) MUST match `set_refresh_cookie`
    or the browser will not overwrite/delete the existing cookie.
    """
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=_same_site(settings),
    )

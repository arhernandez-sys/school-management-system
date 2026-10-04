"""Response security headers (NFR-SEC).

This app is a JSON API plus one HTML surface (Swagger UI at `/api/v1/docs`). The
headers below are the ones that actually buy something in that shape:

  * `X-Content-Type-Options: nosniff` — stops a browser from re-interpreting a
    JSON error body as HTML/JS. Cheap, no downside, closes a real XSS vector on
    any endpoint that ever echoes user input into a message.

  * `X-Frame-Options: DENY` — clickjacking. Nothing here is meant to be framed,
    and the SPA lives on its own origin. `frame-ancestors` in a CSP would be the
    modern equivalent, but see the CSP note below; XFO is still honoured
    everywhere and costs nothing.

  * `Referrer-Policy: strict-origin-when-cross-origin` — chosen over the laxer
    defaults because this API's PATHS ARE SENSITIVE: `/students/{uuid}`,
    `/assessments/{uuid}` and friends put record identifiers in the URL. Under
    this policy a cross-origin request (notably Swagger UI pulling assets from a
    CDN) leaks only the bare origin, never the path, while same-origin navigation
    keeps the full referrer for debugging.

  * `Strict-Transport-Security` — ONLY outside `local`. Sending HSTS over plain
    http is meaningless (a MITM strips it) and pinning `localhost` to https in a
    developer's browser breaks every other project on that machine, permanently,
    until they clear it by hand. `Settings.hsts_enabled` gates it.

WHY THERE IS NO Content-Security-Policy
───────────────────────────────────────────────────────────────────────────────
Deliberate omission, not an oversight. The only document this app serves is
Swagger UI, which FastAPI renders with an inline bootstrap `<script>` and asset
`<link>`/`<script>` tags pointing at cdn.jsdelivr.net. A CSP strict enough to be
worth having (no `unsafe-inline`, no third-party script host) breaks
`/api/v1/docs` outright; a CSP loose enough to permit it must allow
`'unsafe-inline'` plus a third-party CDN, at which point it blocks essentially
nothing. For every OTHER response — all of them `application/json` — `nosniff`
already prevents script execution, which is the outcome a CSP would be buying.

The SPA is served from a different origin entirely and owns its own CSP; that is
where a real policy belongs. If this app ever serves application HTML, add a CSP
here and exempt the docs routes by path rather than weakening it globally.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

#: See the module docstring for why this value and not `no-referrer`.
DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach the static security headers to every response.

    Headers are set with `setdefault` semantics so a route that deliberately
    chose its own value (none do today) is never silently overridden.
    """

    def __init__(
        self,
        app,  # noqa: ANN001 - ASGI app, matches BaseHTTPMiddleware
        *,
        hsts_enabled: bool,
        hsts_max_age: int,
        referrer_policy: str = DEFAULT_REFERRER_POLICY,
    ) -> None:
        super().__init__(app)
        self._hsts_enabled = hsts_enabled
        self._hsts_max_age = hsts_max_age
        self._referrer_policy = referrer_policy

    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        response = await call_next(request)
        headers = response.headers
        if "x-content-type-options" not in headers:
            headers["X-Content-Type-Options"] = "nosniff"
        if "x-frame-options" not in headers:
            headers["X-Frame-Options"] = "DENY"
        if "referrer-policy" not in headers:
            headers["Referrer-Policy"] = self._referrer_policy
        if self._hsts_enabled and "strict-transport-security" not in headers:
            # `includeSubDomains` but NOT `preload`: preload is an effectively
            # irreversible submission to a browser-vendor list and must be an
            # explicit operator decision, not a framework default.
            headers["Strict-Transport-Security"] = (
                f"max-age={self._hsts_max_age}; includeSubDomains"
            )
        return response

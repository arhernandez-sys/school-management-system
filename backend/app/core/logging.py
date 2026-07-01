"""Structured request logging (architecture.md §8.3, NFR-SEC-03/04).

A middleware assigns each request a `request_id`, times it, and emits a single
structured log line (method, path, status, latency_ms, user_id if resolved).

HARD RULE: never log credentials, tokens, cookies, or request bodies. We log only
method, path (no query string values that could carry secrets — none do here, but
we keep it to the path), status, latency, and the authenticated user id once known.
"""

from __future__ import annotations

import logging
import sys
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("sis.request")


def configure_logging(level: int = logging.INFO) -> None:
    """Idempotent root logging setup. Plain structured key=value to stdout (12-factor)."""
    root = logging.getLogger()
    if root.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            latency_ms = round((time.perf_counter() - start) * 1000, 1)
            user_id = getattr(request.state, "user_id", None)
            logger.info(
                "request method=%s path=%s status=%s latency_ms=%s user_id=%s request_id=%s",
                request.method,
                request.url.path,
                status_code,
                latency_ms,
                user_id or "-",
                request_id,
            )

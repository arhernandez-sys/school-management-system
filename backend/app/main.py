"""FastAPI application factory (architecture.md §6, api-spec §1).

`create_app()` ties together the EXISTING scaffold pieces — it does NOT define any
module endpoints, services, or migrations (those are separate sub-phase 7.0+
workstreams). It wires:

  - fail-fast runtime config validation (config.validate_runtime, §8.4);
  - the normalized ErrorResponse handlers (core.errors.register_exception_handlers,
    §8.1) — the envelope is NOT re-implemented here;
  - credentialed CORS with an explicit allow-list (NEVER `*`, §3.1) so the
    cross-origin HttpOnly refresh cookie works;
  - the structured request-id / request-logging middleware (core.logging, §8.3);
  - an unauthenticated health endpoint;
  - the `/api/v1` versioned API surface (api-spec §1.1), with OpenAPI served
    under that prefix.

The app constructs and serves OpenAPI WITHOUT a live database: DB access is
lazy/per-request via `get_db` (db/session.py), so importing models and building
routes touches no connection.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

# Importing the models aggregator populates Base.metadata for the whole app at
# import time (no DB connection is opened — the engine connects lazily per
# request). Kept here so the app is the single import that brings the ORM online.
from app.db import models as _db_models  # noqa: F401
from app.config import Settings, get_settings
from app.core import ratelimit
from app.core.errors import _envelope, register_exception_handlers
from app.core.logging import RequestLoggingMiddleware, configure_logging
from app.core.security_headers import SecurityHeadersMiddleware
from app.db import session as db_session
from app.modules.assessments.router import categories_router as assessment_categories_router
from app.modules.assessments.router import router as assessments_router
from app.modules.auth.router import router as auth_router
from app.modules.announcements.router import router as announcements_router
from app.modules.attendance.router import router as attendance_router
from app.modules.classes.router import router as classes_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.events.router import router as events_router
from app.modules.grades.router import assessment_grades_router
from app.modules.grades.router import router as grades_router
from app.modules.reports.router import router as reports_router
from app.modules.settings.router import router as settings_router
from app.modules.students.router import router as students_router
from app.modules.subjects.router import router as subjects_router
from app.modules.teachers.router import router as teachers_router
from app.modules.timetable.router import router as timetable_router

API_V1_PREFIX = "/api/v1"

# Where module routers mount in the D17 order (Auth → Settings → Students/
# Teachers → Classes → Assessments → Grades/Attendance → Announcements →
# Dashboard/Reports). Each module exposes an APIRouter, appended here; the app
# factory includes them under `/api/v1`. Only Auth (7.1) is wired so far — later
# modules are added one at a time per the phased-orchestration rules.
MODULE_ROUTERS: list[APIRouter] = [
    auth_router,  # 7.1 — serves /api/v1/auth/* (api-spec §2)
    settings_router,  # 7.2 — serves /api/v1/settings/* (api-spec §5 Module 11)
    subjects_router,  # 7.2 — serves /api/v1/subjects/* (api-spec §5 Module 5b)
    students_router,  # 7.3 — serves /api/v1/students/* (api-spec §5 Module 3)
    teachers_router,  # 7.3 — serves /api/v1/teachers/* (api-spec §5 Module 4)
    classes_router,  # 7.4 — serves /api/v1/classes/* (api-spec §5 Module 5)
    assessments_router,  # 7.5 — serves /api/v1/assessments/* (api-spec §6)
    assessment_categories_router,  # 7.5 — /api/v1/classes/{id}/subjects/{cs}/categories
    grades_router,  # 7.6 — serves /api/v1/grades/* (api-spec §7)
    assessment_grades_router,  # 7.6 — PUT /api/v1/assessments/{id}/grades (the grade write)
    attendance_router,  # 7.7 — serves /api/v1/attendance/* (api-spec §8)
    announcements_router,  # 7.8 — serves /api/v1/announcements/* (api-spec §9)
    dashboard_router,  # 7.9a — serves GET /api/v1/dashboard (api-spec §5 Module 2)
    reports_router,  # 7.9b — serves /api/v1/reports/* (api-spec §5 Module 10)
    events_router,  # 12 — serves /api/v1/events/* (scope addition; see progress-tracker)
    timetable_router,  # 13 — serves /api/v1/timetable/* (D29 sixth-form schedule)
]


logger = logging.getLogger("sis.health")


def _build_health_router() -> APIRouter:
    router = APIRouter(tags=["health"])

    @router.get("/health", summary="Liveness probe (no auth)")
    def health() -> dict[str, str]:
        """Unauthenticated 200. Does NOT touch the database — it is a pure
        liveness signal so the app reports healthy even if MariaDB is
        unreachable (DB connectivity is per-request, architecture §1).

        This behaviour is DELIBERATE and must not change: a liveness probe wired
        to the database restarts the app every time the database hiccups, which
        turns a recoverable 60-second DB blip into a crash loop that is still
        failing long after the database came back. Use `/ready` for anything that
        should drain traffic instead of killing the process.
        """
        return {"status": "ok"}

    @router.get(
        "/ready",
        summary="Readiness probe — verifies database reachability (no auth)",
        responses={503: {"description": "A dependency is unreachable."}},
    )
    def ready() -> JSONResponse:
        """Unauthenticated. 200 when the app can reach MariaDB, 503 when it
        cannot — the signal a load balancer should use to stop sending traffic to
        this instance (as opposed to `/health`, which decides whether to KILL it).

        Deliberately reports no driver text, host, or exception detail: an
        unauthenticated endpoint must not describe the internals of a failure.
        The full error is logged server-side for the operator.
        """
        try:
            db_session.check_connection()
        except Exception:
            logger.exception("readiness_check_failed")
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content=_envelope(
                    "service_unavailable",
                    "The service is not ready to accept traffic.",
                ),
            )
        return JSONResponse(status_code=status.HTTP_200_OK, content={"status": "ready"})

    return router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    # Logging FIRST, so the hardening advisories `validate_runtime()` emits are
    # formatted and routed like every other log line. Configuring it afterwards meant
    # anything logged during validation was dropped or printed bare — and a warning an
    # operator never sees is the same as no warning at all.
    configure_logging()

    # Fail fast on insecure prod config (default/weak JWT secret, cheap password
    # hashing, default DATABASE_URL, empty/`*` CORS outside `local`) and log advisories
    # for the optional hardening. Raises RuntimeError → uvicorn refuses to start (§8.4).
    settings.validate_runtime()

    app = FastAPI(
        title="School Management System API",
        version="1.0.0",
        # Serve docs + schema UNDER the version prefix so the generated TS client
        # (orval, 7.0e) and the browser read `/api/v1/openapi.json` (api-spec §1.1).
        openapi_url=f"{API_V1_PREFIX}/openapi.json",
        docs_url=f"{API_V1_PREFIX}/docs",
        redoc_url=f"{API_V1_PREFIX}/redoc",
    )

    # ── Exception handlers (the single ErrorResponse envelope, §8.1) ──────────
    register_exception_handlers(app)

    # Bound the in-process rate limiter's memory from settings (core/ratelimit.py).
    ratelimit.configure(settings)

    # ══ MIDDLEWARE ORDER ══════════════════════════════════════════════════════
    # Starlette's `add_middleware` INSERTS AT POSITION 0, so the LAST call below
    # is the OUTERMOST layer. Reading the calls bottom-to-top gives the order a
    # request actually traverses:
    #
    #   RequestLogging  →  TrustedHost  →  SecurityHeaders  →  CORS  →  routes
    #
    # Why this order:
    #
    #  * RequestLogging OUTERMOST (unchanged from before). It assigns
    #    `request.state.request_id`, which `errors.py` reads for the 500 envelope,
    #    and stamps `X-Request-ID` on the way out. Outermost is the only position
    #    where a request rejected by an INNER layer (a bad Host, a CORS preflight)
    #    still gets logged and correlated — the requests you most need to see are
    #    exactly the ones that never reach a route.
    #
    #  * TrustedHost next. A poisoned Host header should be refused before any
    #    further work; its 400 deliberately carries no CORS headers, so a browser
    #    sees an opaque failure rather than a readable error, while the log line
    #    from the layer above still records it.
    #
    #  * SecurityHeaders OUTSIDE CORS so its headers land on every response the
    #    app can emit, including CORS preflight replies (which CORSMiddleware
    #    short-circuits without ever reaching a route) and error responses. Inside
    #    CORS those responses would ship bare. It only ADDS headers, so the
    #    `Access-Control-*` set by the inner layer passes through untouched.
    #
    #  * CORS innermost of the four, i.e. closest to the routes, which is where
    #    Starlette's own docs put it — it must see the real route response to
    #    decide the `Access-Control-Allow-*` reply.
    # ══════════════════════════════════════════════════════════════════════════

    # ── CORS: credentialed + explicit origins (mandatory for the refresh cookie)
    # NEVER `*` with credentials — validate_runtime() already rejects `*`, and
    # CORSMiddleware itself forbids `*` + allow_credentials. Origins come from the
    # CORS_ORIGINS env list (architecture §3.1, api-spec §1.6).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # Expose the correlation id so the SPA can surface it on 500s, and
        # `Retry-After` so it can re-enable the sign-in button at the right moment
        # after a 429 (core/ratelimit.py). A cross-origin response header the SPA
        # is not allowed to READ is the same as one that was never sent.
        expose_headers=["X-Request-ID", "Retry-After"],
    )

    # ── Static security response headers. No CSP — see the module docstring for
    # why (it would break Swagger UI without protecting a JSON API).
    app.add_middleware(
        SecurityHeadersMiddleware,
        hsts_enabled=settings.hsts_enabled,  # never over plain http in `local`
        hsts_max_age=settings.hsts_max_age,
    )

    # ── Host allow-list. Opt-in: the default "*" is a no-op, so a local or
    # PaaS-with-generated-hostname deployment is not broken by a setting nobody
    # knew to fill in. Set TRUSTED_HOSTS once the public hostname is fixed.
    trusted_hosts = settings.trusted_host_list
    if trusted_hosts and trusted_hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts)

    # ── Structured request logging + request_id (§8.3). Sets request.state.
    # request_id (consumed by errors.py) and reads request.state.user_id.
    # OUTERMOST — see the order block above.
    app.add_middleware(RequestLoggingMiddleware)

    # ── Routes, all under /api/v1 (api-spec §1.1) ─────────────────────────────
    api_v1 = APIRouter(prefix=API_V1_PREFIX)
    api_v1.include_router(_build_health_router())
    for module_router in MODULE_ROUTERS:
        api_v1.include_router(module_router)
    app.include_router(api_v1)

    return app


# Module-level ASGI app for `uvicorn app.main:app`.
app = create_app()

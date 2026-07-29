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

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Importing the models aggregator populates Base.metadata for the whole app at
# import time (no DB connection is opened — the engine connects lazily per
# request). Kept here so the app is the single import that brings the ORM online.
from app.db import models as _db_models  # noqa: F401
from app.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import RequestLoggingMiddleware, configure_logging
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
]


def _build_health_router() -> APIRouter:
    router = APIRouter(tags=["health"])

    @router.get("/health", summary="Liveness probe (no auth)")
    def health() -> dict[str, str]:
        """Unauthenticated 200. Does NOT touch the database — it is a pure
        liveness signal so the app reports healthy even if Postgres is
        unreachable (DB connectivity is per-request, architecture §1)."""
        return {"status": "ok"}

    return router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    # Fail fast on insecure prod config (default JWT secret outside `local`,
    # empty/`*` CORS). Raises RuntimeError → uvicorn refuses to start (§8.4).
    settings.validate_runtime()

    configure_logging()

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
        # Expose the correlation id so the SPA can surface it on 500s.
        expose_headers=["X-Request-ID"],
    )

    # ── Structured request logging + request_id (§8.3). Sets request.state.
    # request_id (consumed by errors.py) and reads request.state.user_id.
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

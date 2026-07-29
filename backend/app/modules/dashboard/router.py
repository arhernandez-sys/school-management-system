"""Dashboard router (api-spec §5 Module 2, FR-DASH-*).

ONE composite endpoint. The response is **role-discriminated**: the same
`DashboardPage` component renders whichever variant arrives, narrowing on `role`.
Role and scope are derived server-side from the access token — never from a query
param — so a student cannot request the principal's school-wide figures.

  GET /dashboard   authenticated -> AdminDashboard | SecretaryDashboard
                                   | TeacherDashboard | StudentDashboard

`response_model` is deliberately omitted: FastAPI would need a discriminated union to
serialize these four correctly, and the variants share field names with different
types (`stats` most of all), so a union response_model risks silently coercing one
shape into another. The service returns fully-validated Pydantic models already, and
the OpenAPI schema is declared explicitly below.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.schemas import ErrorResponse
from app.core.deps import get_current_user, get_db
from app.modules.dashboard import service
from app.modules.dashboard.schemas import (
    AdminDashboard,
    SecretaryDashboard,
    StudentDashboard,
    TeacherDashboard,
)
from app.modules.users.models import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_ERR = {"model": ErrorResponse}


@router.get(
    "",
    summary="Composite role-shaped dashboard payload",
    responses={
        200: {
            "description": "Role-discriminated payload; narrow on `role`.",
            "content": {
                "application/json": {
                    "schema": {
                        "oneOf": [
                            AdminDashboard.model_json_schema(ref_template="#/components/schemas/{model}"),
                            SecretaryDashboard.model_json_schema(ref_template="#/components/schemas/{model}"),
                            TeacherDashboard.model_json_schema(ref_template="#/components/schemas/{model}"),
                            StudentDashboard.model_json_schema(ref_template="#/components/schemas/{model}"),
                        ],
                        "discriminator": {"propertyName": "role"},
                    }
                }
            },
        },
        401: _ERR,
        409: _ERR,
    },
)
def get_dashboard(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):  # noqa: ANN201 - returns one of four Pydantic models (see module docstring)
    """409 `no_active_semester` when no active term is configured — every variant's
    header and scoping depend on it, so a sparse dashboard would mislead."""
    return service.get_dashboard(db, actor=actor)

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
                    # NO `ref_template` — deliberately.
                    #
                    # It used to be `ref_template="#/components/schemas/{model}"`, which
                    # rewrote every nested model reference to point at
                    # `#/components/schemas/AdminStats` (etc.) — but nothing ever ADDS those
                    # models to `components.schemas`. FastAPI only collects components from
                    # `response_model`, which this route deliberately omits (see the module
                    # docstring). The nested definitions are emitted inline, in each schema's
                    # own `$defs`, so all 16 of those refs dangled: valid-looking JSON that no
                    # resolver can follow. It surfaced as `MissingPointerError` the first time
                    # the frontend regenerated its client from the full spec, which emitted
                    # TypeScript importing modules that were never written.
                    #
                    # Pydantic's default template is `#/$defs/{model}`, which resolves against
                    # the `$defs` that ARE present, making each variant self-contained.
                    "schema": {
                        "oneOf": [
                            AdminDashboard.model_json_schema(),
                            SecretaryDashboard.model_json_schema(),
                            TeacherDashboard.model_json_schema(),
                            StudentDashboard.model_json_schema(),
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

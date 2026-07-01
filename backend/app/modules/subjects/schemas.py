"""Subjects catalog schemas (api-spec §5 Module 5b).

Write models set `extra="forbid"` (api-spec §1.4). Wire format snake_case.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SubjectListItem(BaseModel):
    """GET /subjects item (api-spec §5b)."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    code: str | None = None
    is_active: bool


class SubjectDetail(SubjectListItem):
    """POST/PATCH /subjects response (api-spec §5b)."""


class SubjectCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=40)


class SubjectUpdateRequest(BaseModel):
    """PATCH /subjects/{id}. All fields optional (partial update)."""

    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    code: str | None = Field(default=None, max_length=40)
    is_active: bool | None = None

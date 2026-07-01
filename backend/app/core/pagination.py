"""Reusable list pagination/filtering (architecture.md §6, api-spec §4.1/§6).

`PageParams` is a FastAPI dependency parsing `page`/`page_size`/`sort`. `paginate`
builds a `Page[T]` from a SQLAlchemy select + the session. Used by list endpoints
in later workstreams; defined now so the contract is stable.
"""

from __future__ import annotations

from math import ceil
from typing import Annotated, Any, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.common.schemas import Page

T = TypeVar("T")

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 200


class PageParams(BaseModel):
    page: int = 1
    page_size: int = DEFAULT_PAGE_SIZE
    sort: str | None = None


def page_params(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    sort: Annotated[str | None, Query()] = None,
) -> PageParams:
    return PageParams(page=page, page_size=page_size, sort=sort)


def paginate(
    db: Session,
    stmt: Select[Any],
    params: PageParams,
    *,
    serialize,  # callable mapping an ORM row -> a Pydantic/dict item
) -> Page:
    """Execute a count + a paged window of `stmt`. `stmt` should already carry
    filtering/sorting (sorting applied by the caller from `params.sort`)."""
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        db.execute(stmt.limit(params.page_size).offset((params.page - 1) * params.page_size))
        .scalars()
        .all()
    )
    items = [serialize(r) for r in rows]
    total_pages = ceil(total / params.page_size) if params.page_size else 0
    return Page(
        items=items,
        total=total,
        page=params.page,
        page_size=params.page_size,
        total_pages=total_pages,
    )

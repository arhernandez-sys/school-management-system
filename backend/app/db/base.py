"""Declarative base + shared mixins (database-schema.md §1.3–1.4).

All business tables use a UUID PK (DB-1). Mixins map to the standard columns:
 - TimestampMixin: created_at (NOT NULL, server-default now()) / updated_at (NULL).
 - AuditMixin:     created_by / updated_by (uuid FK -> users, SET NULL).
 - SoftDeleteMixin: deleted_at (timestamptz NULL).

**`updated_at` is NULL on a freshly created row** (D39, `015_updated_at_null_on_insert`).
It answers "when was this EDITED", and a record nobody has edited has no answer. It is
kept current on a real edit by SQLAlchemy `onupdate` AND MariaDB's own
`ON UPDATE current_timestamp()` as a backstop for the chain's hand-run SQL fixes.

(The docstring previously referred to a `set_updated_at()` trigger from the initial
migration. That migration is the Postgres-only Alembic revision which has never run
against MariaDB - see `alembic.ini` - so no such trigger exists here.)
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.types import GUID


class Base(DeclarativeBase):
    """Single declarative base; its metadata drives Alembic autogenerate (PG ref)."""


def uuid_pk() -> Mapped[uuid.UUID]:
    """A UUID primary key column with an application-side default.

    MariaDB has no `gen_random_uuid()`; the app generates the id (`uuid.uuid4`)
    on insert. Stored as CHAR(36) via the portable `GUID` type.
    """
    return mapped_column(
        GUID(),
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    #: When this row was last EDITED — **NULL until it actually is** (D39, `015`).
    #:
    #: This used to be `NOT NULL server_default=func.now()`, so creating a row stamped it
    #: with the creation instant and the UI reported "Last updated <creation date>" on a
    #: record nobody had ever touched. It also disagreed with `updated_by`, which has
    #: always been NULLable and which no insert sets — so one half of the same fact said
    #: "never edited" while the other gave a date.
    #:
    #: `onupdate` is KEPT, and the column keeps MariaDB's own `ON UPDATE
    #: current_timestamp()` as a second line of defence, so a row written by one of the
    #: chain's hand-run SQL fixes is still stamped.
    #:
    #: **Anything rendering "when was this last touched" must coalesce to `created_at`.**
    #: `updated_at` alone now answers a narrower question than most readers assume, and
    #: attendance in particular derives its `recorded_at` from it — see
    #: `attendance/service.py::_touched_at`.
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        onupdate=func.now(),
    )


class AuditMixin:
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

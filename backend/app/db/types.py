"""Shared column-type helpers for models (database-schema.md §1.5).

`pg_enum` builds a SQLAlchemy Enum bound to the Postgres NATIVE enum type by name.
`create_type=False` because the initial migration creates every enum type
explicitly, in order, before the tables (schema §11) — so SQLAlchemy must never
try to emit `CREATE TYPE` itself. `values_callable` ensures the stored/compared
labels are the lowercase `.value`s (e.g. "principal"), not the member names.
"""

from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum

from app.common.enums import PG_ENUM_NAMES


def pg_enum(py_enum: type[enum.Enum]) -> SAEnum:
    name = PG_ENUM_NAMES[py_enum]
    return SAEnum(
        py_enum,
        name=name,
        create_type=False,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
    )

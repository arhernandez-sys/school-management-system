"""Shared, database-portable column-type helpers for models.

Targets MariaDB (pymysql) at runtime. The types here bind/read values in a way
that matches the existing `sims` MariaDB columns; they are NOT used to create the
schema (no Alembic / no create_all against MariaDB).

 - `GUID`: a UUID column backed by CHAR(36). Binds `uuid.UUID`/str -> canonical
   36-char lowercase string, returns `uuid.UUID`. Works against MariaDB `uuid`
   columns (which accept/return 36-char strings over pymysql).
 - `JSONType`: SQLAlchemy's dialect-generic `JSON` — stores dict/list to MariaDB
   `JSON`/`LONGTEXT` columns.
 - `enum_col(py_enum)`: a native SQLAlchemy Enum bound by the lowercase `.value`
   (what MariaDB ENUM columns store). No Postgres type name / no create_type.
"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import CHAR
from sqlalchemy import JSON as _JSON
from sqlalchemy import Enum as SAEnum
from sqlalchemy.types import TypeDecorator


class GUID(TypeDecorator):
    """Platform-portable UUID type stored as a 36-char string (CHAR(36)).

    Binds `uuid.UUID` or a UUID-like string to the canonical lowercase 36-char
    form; returns `uuid.UUID` on read. Compatible with MariaDB `uuid` columns,
    which round-trip 36-char strings over the pymysql driver.
    """

    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return str(value)
        # Normalize/validate any UUID-like string to canonical lowercase form.
        return str(uuid.UUID(str(value)))

    def process_result_value(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        if isinstance(value, (bytes, bytearray)):
            value = value.decode()
        return uuid.UUID(value)


# Dialect-generic JSON — maps to MariaDB JSON / LONGTEXT. Use as `JSONType()`.
JSONType = _JSON


def enum_col(py_enum: type[enum.Enum]) -> SAEnum:
    """A native Enum column bound/read by the lowercase `.value`s.

    `values_callable` ensures the stored/compared labels are the `.value`s
    (e.g. "principal"), which is exactly what the MariaDB ENUM columns store.
    No Postgres native-type `name=`/`create_type` — those are PG-only.
    """
    return SAEnum(
        py_enum,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
    )


# Backwards-compatible alias so existing call sites keep working during the
# transition; new code should call `enum_col`.
pg_enum = enum_col

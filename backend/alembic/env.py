"""Alembic environment (sub-phase 7.0b).

The database URL is NOT stored in alembic.ini. It is read from the application
settings (`DATABASE_URL` env var / gitignored .env, via pydantic-settings) so the
same secret-free configuration serves the app and migrations. `target_metadata`
is `Base.metadata`, populated by importing `app.db.models` (the aggregator that
imports ALL 28 ORM models), so autogenerate/compare sees the full schema.

The pymysql driver URL (`mysql+pymysql://...`) works as-is for Alembic's
synchronous engine.

SCOPE NOTE: the checked-in revision was authored for Postgres and is knowingly
non-functional against MariaDB (native ENUMs, `gen_random_uuid()`, partial
indexes). The live MariaDB schema is maintained by the hand-run SQL under
`backend/db/mariadb/`. This env.py is kept correct so `target_metadata` stays
usable, not because `alembic upgrade` is the deployment path.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings

# Import the aggregator so EVERY model is registered on Base.metadata before we
# capture it as the autogenerate/compare target (schema §11).
from app.db.models import Base  # noqa: F401  (re-exported Base)
import app.db.models  # noqa: F401  (side-effect: registers all 28 tables)

config = context.config

# Inject the secret connection string from app settings — never from the ini.
# `set_main_option` writes through ConfigParser, which treats `%` as interpolation
# syntax. A DB password URL-encodes `@` as `%40` (see .env.example), so we escape
# every `%` to `%%` for ConfigParser; it un-escapes back to a single `%` when read.
# The stored secret stays `%40`-encoded end to end (never decoded, never logged).
_db_url = get_settings().database_url
config.set_main_option("sqlalchemy.url", _db_url.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' (SQL-emitting) mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode against a live connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

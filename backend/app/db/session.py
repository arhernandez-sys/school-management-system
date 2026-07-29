"""SQLAlchemy engine + session factory (architecture.md §6).

Synchronous engine (pymysql / MariaDB). The modular monolith is not latency-bound
at this scale; a sync session keeps the service layer simple and transactional
reasoning straightforward. `get_db` is the FastAPI dependency (defined in
core/deps.py).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,  # recycle dead connections (self-hosted MariaDB)
    connect_args={
        "charset": "utf8mb4",  # match the DB's utf8mb4 collation
        # Pin every connection to UTC. `core/timeutil` states the contract:
        # "Storage is always UTC." Python-written timestamps honour it, but the
        # 62 columns carrying a `CURRENT_TIMESTAMP` default (every TimestampMixin
        # `created_at`/`updated_at`, plus `login_attempts.attempted_at`) are
        # filled by the SERVER. With `time_zone=SYSTEM` on a Belize host that is
        # UTC-6, so those columns landed 6h behind the aware values the app reads
        # them back as — measured at exactly 21600s of drift against the
        # Python-written `refresh_sessions.issued_at` on the same row.
        # No query compares against SQL `now()` (only server_default/onupdate),
        # so forcing UTC here is purely corrective.
        "init_command": "SET time_zone = '+00:00'",
    },
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


def session_scope() -> Iterator[Session]:
    """Context-managed session for non-request callers (seed scripts, jobs)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

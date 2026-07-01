"""SQLAlchemy engine + session factory (architecture.md §6).

Synchronous engine (psycopg3). The modular monolith is not latency-bound at this
scale; a sync session keeps the service layer simple and transactional reasoning
straightforward. `get_db` is the FastAPI dependency (defined in core/deps.py).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,  # recycle dead connections (Railway/managed PG)
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

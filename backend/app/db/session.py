"""SQLAlchemy engine + session factory (architecture.md §6).

Synchronous engine (pymysql / MariaDB). The modular monolith is not latency-bound
at this scale; a sync session keeps the service layer simple and transactional
reasoning straightforward. `get_db` is the FastAPI dependency (defined in
core/deps.py).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,  # recycle dead connections (self-hosted MariaDB)
    # MariaDB drops connections idle past `wait_timeout` (default 8h, often
    # tightened to minutes in a self-hosted my.cnf). Without `pool_recycle` the
    # pool keeps handing out sockets the server has already closed, and every
    # such checkout costs a failed round trip before `pool_pre_ping` notices and
    # reconnects — under an idle-then-burst pattern (a school: nothing overnight,
    # everything at 8am) that is the entire first wave of requests. Recycling
    # proactively means pre_ping is a backstop rather than the mechanism.
    pool_recycle=_settings.db_pool_recycle,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
    pool_timeout=_settings.db_pool_timeout,
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


def check_connection() -> None:
    """Prove the database is reachable. Raises on ANY failure.

    Backs the readiness probe in `app/main.py`. Uses a raw pooled connection
    rather than a Session because readiness must answer "can I talk to MariaDB",
    not "can I open a unit of work" — and a Session would leave a transaction to
    tidy up. `SELECT 1` never touches a table, so the probe cannot be slowed by
    load or blocked by a lock.

    NOTE: `connect_args` deliberately carries no `connect_timeout` (see the long
    comment on the engine — that dict is load-bearing and left alone), so a probe
    against an unreachable host waits for pymysql's default (10s) before
    reporting 503. Anything polling this should set its own client-side timeout.
    """
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))


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

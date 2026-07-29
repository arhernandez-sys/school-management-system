"""Pytest harness + shared fixtures for the SIS backend (sub-phase 7.0c).

Scope (per the orchestrator brief): the test *harness* only — fixtures + plumbing
that every future module test will reuse. No module-endpoint tests live here yet
(Auth, Settings, etc. arrive later under the D17 module loop). This file is built
to be forward-compatible: the moment sub-phase 7.0a lands `app.main.create_app`,
the `client` fixture wires it up with the test DB override automatically, with no
further changes here.

────────────────────────────────────────────────────────────────────────────────
Test-isolation strategy (decision for 7.0c)
────────────────────────────────────────────────────────────────────────────────
We use the **transactional-rollback** pattern against the *real* (shared Supabase)
Postgres rather than spinning up a throwaway schema or an in-memory SQLite:

  1. Open ONE connection from the engine.
  2. Begin an outer transaction on that connection.
  3. Bind a Session to that connection with
     `join_transaction_mode="create_savepoint"` (SQLAlchemy 2.0) so any
     `session.commit()` inside the code under test commits only to a SAVEPOINT,
     never to the outer transaction.
  4. After each test, roll back the outer transaction and close the connection.

Net effect: every test sees a clean slate and **nothing is ever committed** to the
shared Supabase database — critical because dev and test share one Postgres
(decision 2026-06-27, OQ-7.0-DB). The tradeoff: tests cannot exercise behaviour
that depends on a real cross-connection commit being visible to a *second*
connection (rare; flag such a test to use a dedicated schema instead). SQLite was
rejected because the models use Postgres-native types (UUID, native ENUMs,
`gen_random_uuid()`); a throwaway-schema-per-session was rejected as heavier and
unnecessary for unit/integration coverage while still being available later for
the rare cross-connection case.

WHY OPT-IN / SKIP-CLEAN: the Supabase connection string is not yet available — it
will land later in a gitignored `.env`. So DB-touching fixtures **skip cleanly**
(never error) when `DATABASE_URL` is unset/left at the local default or when the
database is unreachable. `pytest` therefore runs GREEN today with no database. No
connection string is hardcoded anywhere — `Settings` reads it from the env/.env.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:  # import only for type checkers; avoids hard runtime coupling
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.config import Settings

# The local default baked into Settings.database_url. If DATABASE_URL is unset the
# app falls back to this; a test run against it would hit a MariaDB nobody is
# running, so we treat "unset or equal to this default" as "no test DB available".
#
# IMPORTED, never re-typed. This guard previously hardcoded the OLD Postgres
# default; once the app pivoted to MariaDB the strings no longer matched, so a
# machine with no `.env` stopped recognising the fallback as "no DB" and tried a
# real connection instead of skipping cleanly. Importing the constant makes that
# class of drift impossible.
from app.config import LOCAL_DEFAULT_DATABASE_URL as _LOCAL_DEFAULT_DB_URL  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────────
# Bridge the gitignored .env DATABASE_URL into os.environ (added 7.1).
# ──────────────────────────────────────────────────────────────────────────────
# The DB-availability detection below reads os.environ["DATABASE_URL"], but the
# project keeps the (live Supabase) connection string in a gitignored `.env` that
# pydantic-settings loads for the APP — not into the process environment. So the
# DB-backed tests would skip-clean even though a real DB IS configured. We mirror
# the .env value into os.environ ONCE at import time, WITHOUT hardcoding any
# connection string and WITHOUT overriding a value already exported. If `.env` is
# absent (CI with no DB), nothing is set and the skip-clean path still holds.
#
# CRITICAL (fixed after the orchestrator saw "41 skipped"): we read `.env` via an
# ABSOLUTE path anchored to THIS file's location (backend/tests/conftest.py →
# backend/.env), NOT via `app.config.Settings()`. Settings has `env_file=".env"`
# (a *relative* path), so it only finds the .env when pytest's cwd happens to be
# `backend/`. Invoking pytest from the repo root (or with a different cwd) made
# Settings silently fall back to the local default → the whole DB suite skipped.
# Parsing the file ourselves at an absolute path makes the bridge cwd-independent.
# We read the raw value verbatim (no unquoting/decoding) so a URL-encoded password
# (e.g. `%40` for `@`) stays valid.
import pathlib  # noqa: E402

# backend/tests/conftest.py -> parents[1] == backend/
_BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
_DOTENV_PATH = _BACKEND_DIR / ".env"


def _read_database_url_from_dotenv_file() -> str | None:
    """Parse DATABASE_URL out of backend/.env at an absolute path. Returns the raw
    value (verbatim, preserving %40-style encoding) or None if absent/unreadable."""
    try:
        if not _DOTENV_PATH.is_file():
            return None
        for raw_line in _DOTENV_PATH.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() != "DATABASE_URL":
                continue
            value = value.strip()
            # Strip optional surrounding quotes (dotenv allows them) but DO NOT
            # otherwise transform the value — keep %40 etc. intact.
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            return value or None
    except Exception:
        return None
    return None


def _hydrate_database_url_from_dotenv() -> None:
    if os.environ.get("DATABASE_URL"):
        return  # an explicit export wins; never override it
    url = _read_database_url_from_dotenv_file()
    if url and url.strip() and url.strip() != _LOCAL_DEFAULT_DB_URL:
        os.environ["DATABASE_URL"] = url.strip()


_hydrate_database_url_from_dotenv()


# ──────────────────────────────────────────────────────────────────────────────
# Rate limiting OFF by default for the suite (added in the hardening pass).
# ──────────────────────────────────────────────────────────────────────────────
# `core/ratelimit.py` counts FAILED auth attempts per client IP, and under
# TestClient every request reports the same peer ("testclient"), so the whole
# suite shares ONE bucket. The auth tests deliberately generate dozens of failures
# (lockout, wrong password, forged refresh cookies) and would trip the limiter,
# turning later tests' expected 401/423 into an unexpected 429.
#
# Set BEFORE anything constructs Settings, and via `setdefault` so an explicit
# export still wins. The rate-limit tests re-enable it per-app by overriding the
# `get_settings` dependency, which is the only place that reads the flag.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> Iterator[None]:
    """Clear the process-wide limiter around every test.

    The limiter is a module singleton, so without this a test that enables
    throttling would leak its counters into the next one.
    """
    from app.core.ratelimit import get_limiter

    get_limiter().reset()
    yield
    get_limiter().reset()


# ──────────────────────────────────────────────────────────────────────────────
# DB availability detection (drives skip-clean behaviour)
# ──────────────────────────────────────────────────────────────────────────────
def _configured_database_url() -> str | None:
    """Return an explicitly-configured DATABASE_URL, or None if absent/default.

    We do NOT invent a connection string. A value is only considered "real" when
    the env var is set to something other than the baked-in local default.
    """
    url = os.environ.get("DATABASE_URL")
    if url and url.strip() and url.strip() != _LOCAL_DEFAULT_DB_URL:
        return url.strip()
    return None


def _db_is_reachable(url: str) -> bool:
    """Best-effort connectivity probe. Never raises — returns False on any error so
    the caller can skip cleanly instead of failing the suite."""
    try:
        from sqlalchemy import create_engine, text

        eng = create_engine(url, pool_pre_ping=True, future=True)
        try:
            with eng.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        finally:
            eng.dispose()
    except Exception:
        return False


@pytest.fixture(scope="session")
def database_url() -> str:
    """The real test DATABASE_URL, or skip the whole DB-dependent test cleanly.

    Session-scoped so we probe connectivity once per run, not per test.
    """
    url = _configured_database_url()
    if url is None:
        pytest.skip(
            "No test database configured: set DATABASE_URL in a gitignored .env to "
            "a real (Supabase) Postgres to run DB-backed tests. Skipping cleanly."
        )
    if not _db_is_reachable(url):
        pytest.skip(
            "DATABASE_URL is set but the database is unreachable; skipping DB-backed "
            "tests cleanly (no connection string is logged)."
        )
    return url


@pytest.fixture(scope="session")
def _engine(database_url: str):  # noqa: ANN202 - sqlalchemy Engine, kept lazy
    """Session-scoped engine bound to the real test DB. Only constructed when a
    reachable DATABASE_URL exists (otherwise `database_url` already skipped)."""
    from sqlalchemy import create_engine

    eng = create_engine(database_url, pool_pre_ping=True, future=True)
    try:
        yield eng
    finally:
        eng.dispose()


# ──────────────────────────────────────────────────────────────────────────────
# Settings
# ──────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def settings() -> "Settings":
    """Fresh Settings for the test environment.

    `Settings` reads env/.env; `environment` defaults to 'local' so the insecure
    JWT default and relaxed cookie posture are acceptable in tests. We construct a
    new instance (not the lru_cached singleton) so a test may tweak fields without
    leaking into other tests.
    """
    from app.config import Settings

    return Settings(environment="local")


# ──────────────────────────────────────────────────────────────────────────────
# Transactional-rollback DB session (skips cleanly with no DB)
# ──────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def db_session(_engine) -> Iterator["Session"]:  # noqa: ANN001
    """A SQLAlchemy Session wrapped in an always-rolled-back outer transaction.

    Nothing this session (or the code under test) writes is ever committed to the
    shared Supabase DB. See the module docstring for the full rationale.
    """
    from sqlalchemy.orm import Session

    connection = _engine.connect()
    transaction = connection.begin()
    # join_transaction_mode="create_savepoint": an inner commit() lands on a
    # SAVEPOINT inside our outer transaction instead of ending it, so service-layer
    # commits are exercised yet still rolled back wholesale below.
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


# ──────────────────────────────────────────────────────────────────────────────
# App factory (forward-compatible with sub-phase 7.0a)
# ──────────────────────────────────────────────────────────────────────────────
def _import_create_app():
    """Lazily import `app.main.create_app`. Returns the callable, or None if 7.0a
    has not landed `app/main.py` yet (so client-dependent tests can skip cleanly).
    """
    try:
        from app.main import create_app  # type: ignore[import-not-found]
    except Exception:
        return None
    return create_app


@pytest.fixture
def _maybe_db_session(request: pytest.FixtureRequest) -> "Session | None":
    """Resolve `db_session` IF a test DB is configured, else None.

    This decouples the app/client fixtures from a hard DB requirement: the health
    smoke test (and any other DB-free endpoint) can run today with no database,
    while DB-backed module tests still get the transactional session the instant a
    DATABASE_URL is provided. We probe `_configured_database_url()` directly rather
    than depending on `db_session` so that the absence of a DB does NOT skip the
    whole client chain — only the override is omitted.
    """
    if _configured_database_url() is None:
        return None
    # A DB is configured; pull the real rollback-bound session via the fixture
    # machinery (this will itself skip cleanly if the configured DB is unreachable).
    return request.getfixturevalue("db_session")


@pytest.fixture
def app(_maybe_db_session: "Session | None") -> Iterator["FastAPI"]:
    """The FastAPI app built by 7.0a's `create_app()`.

    When a test DB is available, `get_db` is overridden to yield the transactional
    rollback session so the code under test never commits to shared Supabase. When
    no DB is configured, the override is skipped — DB-free routes (e.g. health)
    still work; any route that actually calls `get_db` will fail loudly, which is
    the correct signal to provide a DATABASE_URL.

    Skips cleanly only if `app.main.create_app` is not importable yet (7.0a). When
    7.0a landed, this fixture needed NO change — it imports the factory as-is.
    """
    create_app = _import_create_app()
    if create_app is None:
        pytest.skip(
            "app.main.create_app is not importable yet (sub-phase 7.0a not landed); "
            "skipping client/app-dependent tests cleanly."
        )

    from app.core.deps import get_db

    application = create_app()

    if _maybe_db_session is not None:
        def _override_get_db() -> Iterator["Session"]:
            # Yield the rollback-bound session; do NOT close it here (the
            # db_session fixture owns its lifecycle).
            yield _maybe_db_session

        application.dependency_overrides[get_db] = _override_get_db

    try:
        yield application
    finally:
        application.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client(app: "FastAPI") -> Iterator["TestClient"]:
    """HTTP client bound to the app.

    Skips cleanly only if 7.0a's `create_app` is not importable. When a test DB is
    configured the client is wired to the transactional session; without one,
    DB-free routes (health) still work. `TestClient` ships with FastAPI (Starlette
    + httpx) — no new dependency.
    """
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        yield test_client


# ──────────────────────────────────────────────────────────────────────────────
# Auth header helper stub (for future module tests)
# ──────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def make_token() -> "callable":
    """Factory that mints a valid access token for a given user id + role.

    Uses the EXISTING `app.core.security.create_access_token` (already built in the
    scaffold) — minting a token is not "building ahead"; it's harness plumbing that
    every future authenticated-endpoint test will reuse. Note: this token is only
    *accepted* once `get_current_user` can load a live, active user row from the DB,
    so module tests must also seed the matching user.
    """
    import uuid as _uuid

    from app.common.enums import Role
    from app.core.security import create_access_token

    def _make_token(
        *, user_id: "str | _uuid.UUID | None" = None, role: Role | str = Role.PRINCIPAL
    ) -> str:
        uid = user_id or _uuid.uuid4()
        if isinstance(uid, str):
            uid = _uuid.UUID(uid)
        role_value = role.value if isinstance(role, Role) else str(role)
        return create_access_token(user_id=uid, role=role_value)

    return _make_token


@pytest.fixture
def auth_headers(make_token) -> "callable":  # noqa: ANN001
    """Factory returning an Authorization header dict for a given user/role.

    Usage in a future module test:
        headers = auth_headers(user_id=seeded_user.id, role=Role.TEACHER)
        client.get("/api/v1/...", headers=headers)
    """

    def _auth_headers(**kwargs) -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(**kwargs)}"}

    return _auth_headers


# ──────────────────────────────────────────────────────────────────────────────
# User factory (added 7.1 — Auth module tests)
# ──────────────────────────────────────────────────────────────────────────────
# Auth tests must provision their own principals/teachers/students INSIDE the
# rolled-back transaction so the suite is hermetic and never touches the seeded
# principal. `make_user` creates (and flushes, but never commits beyond the
# rolled-back outer txn) a real `users` row with a genuine Argon2id hash, so the
# login/verify/lockout/reset code paths are exercised end-to-end. Because the
# `client` fixture's get_db override yields THIS same `db_session`, a user created
# via `make_user` is visible to the endpoints under test within the same request.
@pytest.fixture
def make_user(db_session) -> "callable":  # noqa: ANN001
    """Factory: insert a `users` row in the rolled-back session and return it.

    Defaults to an active Principal with a known password. Override any column via
    kwargs (role, password, is_active, must_change_password, email, username,
    full_name, failed_login_count, locked_until). Emails/usernames are uniquified
    per call so parallel users in one test never collide on the partial-unique
    indexes.
    """
    import uuid as _uuid

    from app.common.enums import Role
    from app.core.security import hash_password
    from app.modules.users.models import User

    DEFAULT_PASSWORD = "Sup3rSecret!pw"

    def _make_user(
        *,
        role: "Role | str" = Role.PRINCIPAL,
        password: str = DEFAULT_PASSWORD,
        email: str | None = None,
        username: str | None = None,
        full_name: str = "Test User",
        is_active: bool = True,
        must_change_password: bool = False,
        failed_login_count: int = 0,
        locked_until=None,  # noqa: ANN001
    ) -> User:
        role_enum = role if isinstance(role, Role) else Role(str(role))
        tag = _uuid.uuid4().hex[:12]
        user = User(
            email=email or f"user_{tag}@test.local",
            username=username,
            password_hash=hash_password(password),
            role=role_enum,
            full_name=full_name,
            is_active=is_active,
            must_change_password=must_change_password,
            failed_login_count=failed_login_count,
            locked_until=locked_until,
        )
        db_session.add(user)
        db_session.flush()  # assign PK + make visible to the request's session
        return user

    _make_user.default_password = DEFAULT_PASSWORD
    return _make_user


# ──────────────────────────────────────────────────────────────────────────────
# Settings/Subjects helpers (added 7.2 — Settings + Subjects module tests)
# ──────────────────────────────────────────────────────────────────────────────
# These create academic-structure rows INSIDE the rolled-back `db_session` so the
# Settings/Subjects suite is hermetic. The shared DB is seeded with ONE active year
# (`2025-2026` + Semester 1) + a grading scale; tests that need the "no active year"
# precondition (e.g. happy-path create-year, the active-term 409 path) call
# `archive_seeded_active_year` to free the one-active invariant within the rollback.
@pytest.fixture
def archive_seeded_active_year(db_session) -> "callable":  # noqa: ANN001
    """Flip the currently-active academic year to ARCHIVED + deactivate its active
    semester, INSIDE the rolled-back txn. Mirrors the state transitions the archive
    endpoint performs, so subsequent create-year / active-term calls see no active
    year. Returns the archived year (or None if there was no active year)."""
    from app.common.enums import AcademicYearStatus
    from app.modules.settings.models import AcademicYear, GradingScale, Semester

    def _archive() -> "AcademicYear | None":
        from sqlalchemy import select, update

        year = db_session.scalar(
            select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        if year is None:
            return None
        year.status = AcademicYearStatus.ARCHIVED
        db_session.execute(
            update(Semester)
            .where(Semester.academic_year_id == year.id, Semester.is_active.is_(True))
            .values(is_active=False)
        )
        db_session.execute(
            update(GradingScale)
            .where(GradingScale.academic_year_id == year.id)
            .values(is_frozen=True)
        )
        db_session.flush()
        return year

    return _archive


@pytest.fixture
def make_class_subject(db_session) -> "callable":  # noqa: ANN001
    """Factory: create a Class (section) + ClassSubject offering referencing a given
    subject, inside the rolled-back txn. Used to exercise the DELETE subject_in_use
    guard (a subject taught in any section cannot be hard-deleted)."""
    import uuid as _uuid

    from sqlalchemy import select

    from app.common.enums import AcademicYearStatus
    from app.modules.classes.models import Class, ClassSubject
    from app.modules.settings.models import AcademicYear

    def _make(subject_id: "_uuid.UUID") -> ClassSubject:
        # Any existing year is fine (active or archived) — the offering just needs a
        # valid academic_year_id FK. Prefer the seeded active year.
        year_id = db_session.scalar(select(AcademicYear.id).limit(1))
        tag = _uuid.uuid4().hex[:8]
        section = Class(
            academic_year_id=year_id,
            name=f"Test Section {tag}",
            grade_level="Form 1",
        )
        db_session.add(section)
        db_session.flush()
        offering = ClassSubject(class_id=section.id, subject_id=subject_id)
        db_session.add(offering)
        db_session.flush()
        return offering

    return _make


# ──────────────────────────────────────────────────────────────────────────────
# Grading-policy helpers (added 7.6 — Grades module tests)
# ──────────────────────────────────────────────────────────────────────────────
# The grade engine reads a resolved policy (schema §10.2a) and the year's bands
# (§10.3). Both live in rows that tests must MUTATE rather than insert: the
# `assessment_policies` singleton is pinned to id=1 and is already seeded, and a
# test-created year has no grading scale of its own.
@pytest.fixture
def set_assessment_policy(db_session) -> "callable":  # noqa: ANN001
    """Set fields on the school-default `assessment_policies` singleton (id=1).

    Upserts rather than inserts, since the row is seeded and the PK is pinned by
    a CHECK constraint. Returns the row. Rolled back with the test.
    """
    from sqlalchemy import select

    from app.modules.settings.models import AssessmentPolicy

    def _set(**fields: object) -> "AssessmentPolicy":
        policy = db_session.scalar(select(AssessmentPolicy).where(AssessmentPolicy.id == 1))
        if policy is None:
            policy = AssessmentPolicy(id=1, absent_as_zero=False, allow_makeup=True, drop_lowest_count=0)
            db_session.add(policy)
        for name, value in fields.items():
            setattr(policy, name, value)
        db_session.flush()
        return policy

    return _set


@pytest.fixture
def make_grading_scale(db_session) -> "callable":  # noqa: ANN001
    """Factory: create a GradingScale + bands for a given academic year.

    Defaults to the bands this system ships (`settings/service.py::_DEFAULT_BANDS`,
    `.99` ceilings) so letter assertions in the Grades suite exercise the real
    OQ-DB2 convention. `bands` takes `(letter, min_score, max_score, is_passing)`
    tuples if a test needs a custom scale.
    """
    from decimal import Decimal

    from app.modules.settings.models import GradingScale, GradingScaleBand

    _SHIPPED = [
        ("A", "90.00", "100.00", True),
        ("B", "80.00", "89.99", True),
        ("C", "70.00", "79.99", True),
        ("D", "60.00", "69.99", True),
        ("F", "0.00", "59.99", False),
    ]

    def _make(academic_year_id, *, pass_mark="60.00", bands=None) -> "GradingScale":  # noqa: ANN001
        scale = GradingScale(academic_year_id=academic_year_id, pass_mark=Decimal(pass_mark))
        db_session.add(scale)
        db_session.flush()
        for order, (letter, low, high, passing) in enumerate(bands or _SHIPPED):
            db_session.add(
                GradingScaleBand(
                    grading_scale_id=scale.id,
                    letter=letter,
                    min_score=Decimal(low),
                    max_score=Decimal(high),
                    is_passing=passing,
                    sort_order=order,
                )
            )
        db_session.flush()
        return scale

    return _make

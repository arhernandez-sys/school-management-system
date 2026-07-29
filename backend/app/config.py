"""Application configuration (architecture.md §8.4).

Pydantic-settings reads 12-factor env vars. Sensible local defaults are provided
so the app constructs without a fully-populated .env, but security-critical values
(JWT_SECRET) are guarded against shipping a default to non-local environments.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT_SECRET = "change-me-in-prod-use-a-32+-byte-random-secret"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "mysql+pymysql://sis:sis@127.0.0.1:3306/sims"

    # ── JWT / tokens ──────────────────────────────────────────────────────────
    jwt_secret: str = _INSECURE_DEFAULT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_access_ttl: int = 900  # 15 min
    jwt_refresh_ttl: int = 604_800  # 7 days

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Stored as a raw string and split, so a single comma-separated env var works.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # ── Auth policy ───────────────────────────────────────────────────────────
    lockout_threshold: int = 5
    lockout_duration: int = 900  # seconds locked once threshold hit
    session_idle_timeout: int = 1800  # FR-AUTH-10 idle window (seconds)
    password_min_length: int = 10

    # ── Argon2id parameters ───────────────────────────────────────────────────
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65_536  # KiB
    argon2_parallelism: int = 4

    # ── Environment ───────────────────────────────────────────────────────────
    environment: str = "local"

    # ── Seed ──────────────────────────────────────────────────────────────────
    seed_admin_email: str = "principal@school.local"
    seed_admin_password: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_local(self) -> bool:
        return self.environment.lower() == "local"

    @property
    def cookie_secure(self) -> bool:
        # Secure is mandatory whenever SameSite=None (cross-origin). Only relaxed
        # for a same-origin local dev server over http://localhost.
        return not self.is_local

    @field_validator("jwt_secret")
    @classmethod
    def _guard_secret(cls, v: str, info) -> str:  # noqa: ANN001
        # We cannot read `environment` reliably here (field ordering), so the hard
        # guard lives in `validate_runtime()` called by the app factory.
        return v

    def validate_runtime(self) -> None:
        """Fail fast on insecure production config. Called from the app factory."""
        if not self.is_local and self.jwt_secret == _INSECURE_DEFAULT_SECRET:
            raise RuntimeError(
                "JWT_SECRET must be set to a strong random value outside 'local' "
                "environment; refusing to start with the insecure default."
            )
        if not self.cors_origin_list:
            raise RuntimeError("CORS_ORIGINS must list at least one explicit origin.")
        if "*" in self.cors_origin_list:
            raise RuntimeError(
                "CORS_ORIGINS must not contain '*' — credentialed CORS requires an "
                "explicit allow-list (architecture.md §3.1)."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()

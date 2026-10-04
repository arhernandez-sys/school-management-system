"""Auth service layer (api-spec §2, FR-AUTH-01..10, architecture.md §3.1).

The service owns ALL database access + transaction boundaries for the 6 auth
endpoints; the router (router.py) stays thin (parse request → call service →
shape response + cookie). Reuses the existing security/cookies/deps/errors
primitives — no new crypto, no new dependencies.

Transaction discipline (api-spec §2.3, hard rule):
  * `login` MUST persist the `login_attempts` row AND the `failed_login_count` /
    `locked_until` bookkeeping EVEN ON AUTH FAILURE, then still return 401/423.
    So failure paths commit their side effects before raising the AppError.
  * Every mutating path commits exactly once on success; the router never commits.

Secrets discipline: no plaintext password is ever logged or returned, except the
one-time temporary password produced by `reset_password` (api-spec §2.3).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.common.enums import LECTURER_ROLES, Role
from app.common.schemas import CurrentUser, UserPreferences
from app.config import Settings
from app.core.errors import (
    AccountInactive,
    AccountLocked,
    Conflict,
    Forbidden,
    InvalidCredentials,
    NotFound,
    Unauthenticated,
    ValidationError,
)
from app.core.timeutil import ensure_aware
from app.core.security import (
    create_access_token,
    generate_temp_password,
    hash_password,
    needs_rehash,
    new_refresh_token,
    parse_refresh_jti,
    sha256_hash,
    validate_password_policy,
    verify_password,
)
from app.modules.auth.models import LoginAttempt, RefreshSession
from app.modules.settings.models import AssessmentPolicy, AuditLog
from app.modules.students.models import StudentProfile
from app.modules.teachers.models import TeacherProfile
from app.modules.users.models import User, UserPreferences as UserPreferencesRow


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# CurrentUser assembly (api-spec §4.4)
# ──────────────────────────────────────────────────────────────────────────────
def _preferences_for(db: Session, user: User) -> UserPreferences:
    """Resolve the user's preferences block; fall back to defaults if no row.

    `user_preferences` is 1:1 with users but may be absent (e.g. the seeded
    principal). CurrentUser.preferences is required, so we synthesize the column
    defaults rather than emit null.
    """
    row = db.get(UserPreferencesRow, user.id)
    if row is None:
        return UserPreferences(
            locale="en", theme="light", date_format=None, default_page_size=25
        )
    return UserPreferences.model_validate(row)


def students_can_view_grades(db: Session) -> bool:
    """The Dean's student grade-visibility switch (D32, brief §4).

    Lives here rather than in `settings.service` because `core.deps` and this module both
    need it on the hot path, and importing `settings.service` from `core.deps` would pull
    the whole Settings surface — including `reports.freeze` — into every authenticated
    request. This reads one boolean off one row.

    **Missing policy row → False**, i.e. hidden. The row is seeded and its absence is a
    setup error, but a setup error must not be the thing that exposes grades.
    """
    return bool(
        db.scalar(select(AssessmentPolicy.students_can_view_grades).where(AssessmentPolicy.id == 1))
    )


def build_current_user(db: Session, user: User) -> CurrentUser:
    """Assemble the CurrentUser payload, resolving profile ids + preferences.

    `student_profile_id` / `teacher_profile_id` are INFORMATIONAL (api-spec §4.4);
    server-side scoping never trusts a client echo of them.
    """
    student_profile_id: uuid.UUID | None = None
    teacher_profile_id: uuid.UUID | None = None

    if user.role == Role.STUDENT:
        student_profile_id = db.scalar(
            select(StudentProfile.id).where(
                StudentProfile.user_id == user.id,
                StudentProfile.deleted_at.is_(None),
            )
        )
    elif user.role in LECTURER_ROLES:
        # D43 — `LECTURER_ROLES` is {TEACHER, HOD}, not just TEACHER. An HOD IS a
        # lecturer with a `teacher_profiles` row, and this id is what the frontend uses
        # to route "My profile" and to recognise its own rows. Left as `== Role.TEACHER`
        # it would come back None and an HOD would look like an admin with no profile.
        teacher_profile_id = db.scalar(
            select(TeacherProfile.id).where(
                TeacherProfile.user_id == user.id,
                TeacherProfile.deleted_at.is_(None),
            )
        )

    return CurrentUser(
        id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        must_change_password=user.must_change_password,
        is_active=user.is_active,
        student_profile_id=student_profile_id,
        teacher_profile_id=teacher_profile_id,
        preferences=_preferences_for(db, user),
        students_can_view_grades=students_can_view_grades(db),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Refresh-session helpers
# ──────────────────────────────────────────────────────────────────────────────
def _create_refresh_session(
    db: Session,
    *,
    user: User,
    settings: Settings,
    user_agent: str | None,
    ip_address: str | None,
) -> str:
    """Mint a new refresh token, persist its hash + jti in `refresh_sessions`,
    and return the RAW token (cookie value). The raw token is never stored."""
    jti, raw_token, token_hash = new_refresh_token()
    now = _now()
    db.add(
        RefreshSession(
            id=jti,
            user_id=user.id,
            token_hash=token_hash,
            issued_at=now,
            last_used_at=now,
            expires_at=now + timedelta(seconds=settings.jwt_refresh_ttl),
            is_revoked=False,
            user_agent=user_agent,
            ip_address=ip_address,
        )
    )
    return raw_token


def _revoke_session(session: RefreshSession) -> None:
    session.is_revoked = True
    session.revoked_at = _now()


# ──────────────────────────────────────────────────────────────────────────────
# Result container (router maps these to HTTP + cookie)
# ──────────────────────────────────────────────────────────────────────────────
class AuthResult:
    """What the service returns on a successful login/refresh: the access token,
    the assembled CurrentUser, and the RAW refresh token the router sets as the
    cookie. (Kept as a plain object, not a Pydantic model — the raw refresh token
    must never enter a response body / OpenAPI schema.)"""

    __slots__ = ("access_token", "user", "raw_refresh_token")

    def __init__(self, access_token: str, user: CurrentUser, raw_refresh_token: str):
        self.access_token = access_token
        self.user = user
        self.raw_refresh_token = raw_refresh_token


# ──────────────────────────────────────────────────────────────────────────────
# POST /auth/login (FR-AUTH-01..04, FR-AUTH-07)
# ──────────────────────────────────────────────────────────────────────────────
def login(
    db: Session,
    *,
    identifier: str,
    password: str,
    settings: Settings,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> AuthResult:
    """Authenticate by email OR username + password.

    Non-enumerating: a wrong identifier and a wrong password produce the SAME
    `401 invalid_credentials`. Bookkeeping (login_attempts, failed_login_count,
    locked_until) is committed even on failure, then the error is raised.
    """
    ident = identifier.strip()
    user = db.scalar(
        select(User).where(
            ((User.email == ident) | (User.username == ident)),
            User.deleted_at.is_(None),
        )
    )

    # ── Unknown identifier: log the attempt, then 401 (no user row to update). ──
    if user is None:
        db.add(
            LoginAttempt(
                email_attempted=ident,
                user_id=None,
                succeeded=False,
                ip_address=ip_address,
            )
        )
        db.commit()
        raise InvalidCredentials("Invalid credentials.")

    now = _now()

    # ── Lockout gate (FR-AUTH-07): refuse while locked, surface retry window. ──
    locked_until = ensure_aware(user.locked_until)
    if locked_until is not None and locked_until > now:
        retry_after = int((locked_until - now).total_seconds())
        db.add(
            LoginAttempt(
                email_attempted=ident,
                user_id=user.id,
                succeeded=False,
                ip_address=ip_address,
            )
        )
        db.commit()
        raise AccountLocked(
            "Account is temporarily locked due to failed login attempts.",
            extra={"retry_after_seconds": max(retry_after, 1)},
        )

    # ── Verify password. ──────────────────────────────────────────────────────
    if not verify_password(password, user.password_hash):
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= settings.lockout_threshold:
            user.locked_until = now + timedelta(seconds=settings.lockout_duration)
        db.add(
            LoginAttempt(
                email_attempted=ident,
                user_id=user.id,
                succeeded=False,
                ip_address=ip_address,
            )
        )
        db.commit()
        raise InvalidCredentials("Invalid credentials.")

    # ── Inactive accounts: valid password but no access (FR-AUTH). ─────────────
    if not user.is_active:
        db.add(
            LoginAttempt(
                email_attempted=ident,
                user_id=user.id,
                succeeded=False,
                ip_address=ip_address,
            )
        )
        db.commit()
        raise AccountInactive("This account is inactive.")

    # ── Success. ───────────────────────────────────────────────────────────────
    # Opportunistic Argon2id rehash if cost params changed (transparent upgrade).
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now

    db.add(
        LoginAttempt(
            email_attempted=ident,
            user_id=user.id,
            succeeded=True,
            ip_address=ip_address,
        )
    )

    raw_refresh = _create_refresh_session(
        db, user=user, settings=settings, user_agent=user_agent, ip_address=ip_address
    )
    access_token = create_access_token(
        user_id=user.id, role=user.role.value, settings=settings
    )
    current_user = build_current_user(db, user)
    db.commit()
    return AuthResult(access_token, current_user, raw_refresh)


# ──────────────────────────────────────────────────────────────────────────────
# POST /auth/refresh — validate + ROTATE (api-spec §2.1/§2.3)
# ──────────────────────────────────────────────────────────────────────────────
def refresh(
    db: Session,
    *,
    raw_cookie: str | None,
    settings: Settings,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> AuthResult:
    """Validate the presented refresh cookie against the store and rotate it.

    On ANY failure raises `Unauthenticated(code="refresh_invalid")`; the router
    clears the cookie on that error. The `X-Refresh: 1` header requirement is
    enforced in the router (transport concern), not here.
    """
    invalid = Unauthenticated(
        "Your session could not be refreshed; please sign in again.",
        code="refresh_invalid",
    )

    if not raw_cookie:
        raise invalid

    jti = parse_refresh_jti(raw_cookie)
    if jti is None:
        raise invalid

    session = db.get(RefreshSession, jti)
    if session is None:
        raise invalid

    now = _now()
    # Verify the hash matches (defeats a forged jti with a wrong secret part),
    # and that the session is live, not revoked, not expired, within idle window.
    if (
        session.token_hash != sha256_hash(raw_cookie)
        or session.is_revoked
        or ensure_aware(session.expires_at) <= now
        or (now - ensure_aware(session.last_used_at)).total_seconds()
        > settings.session_idle_timeout
    ):
        raise invalid

    user = db.scalar(
        select(User).where(User.id == session.user_id, User.deleted_at.is_(None))
    )
    if user is None or not user.is_active:
        raise invalid

    # ── Rotate: revoke the old row, issue a new one. ───────────────────────────
    _revoke_session(session)
    raw_refresh = _create_refresh_session(
        db, user=user, settings=settings, user_agent=user_agent, ip_address=ip_address
    )
    access_token = create_access_token(
        user_id=user.id, role=user.role.value, settings=settings
    )
    current_user = build_current_user(db, user)
    db.commit()
    return AuthResult(access_token, current_user, raw_refresh)


# ──────────────────────────────────────────────────────────────────────────────
# POST /auth/logout (FR-AUTH-05) — idempotent
# ──────────────────────────────────────────────────────────────────────────────
def logout(db: Session, *, raw_cookie: str | None) -> None:
    """Revoke the refresh session named by the cookie. Idempotent: a missing,
    malformed, or already-revoked cookie is a no-op (caller still returns 204)."""
    if not raw_cookie:
        return
    jti = parse_refresh_jti(raw_cookie)
    if jti is None:
        return
    session = db.get(RefreshSession, jti)
    if session is None or session.is_revoked:
        return
    # Only revoke if the presented token actually matches the stored hash.
    if session.token_hash != sha256_hash(raw_cookie):
        return
    _revoke_session(session)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# PATCH /auth/me/password (FR-AUTH-09, FR-SET-05)
# ──────────────────────────────────────────────────────────────────────────────
def change_password(
    db: Session,
    *,
    user: User,
    current_password: str | None,
    new_password: str,
    keep_session_jti: uuid.UUID | None,
) -> None:
    """Self-service password change.

    `current_password` is required UNLESS `must_change_password` is set (forced
    first-change / post-admin-reset). On success: update the Argon2id hash, clear
    must_change_password, and revoke ALL OTHER refresh sessions (keep the caller's
    current one, identified by `keep_session_jti`).
    """
    if not user.must_change_password:
        if not current_password or not verify_password(
            current_password, user.password_hash
        ):
            raise Unauthenticated("Current password is incorrect.")

    policy_errors = validate_password_policy(new_password)
    if policy_errors:
        raise ValidationError(
            "The new password does not meet the policy.",
            code="weak_password",
            fields={"new_password": policy_errors},
        )

    user.password_hash = hash_password(new_password)
    user.must_change_password = False

    # Revoke all OTHER live sessions for this user (keep the current one).
    db.execute(
        update(RefreshSession)
        .where(
            RefreshSession.user_id == user.id,
            RefreshSession.is_revoked.is_(False),
            RefreshSession.id != keep_session_jti
            if keep_session_jti is not None
            else RefreshSession.id.isnot(None),
        )
        .values(is_revoked=True, revoked_at=_now())
    )
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# POST /auth/users/{user_id}/reset-password (FR-AUTH-08, FR-SET-04, D5)
# ──────────────────────────────────────────────────────────────────────────────
def reset_password(
    db: Session,
    *,
    actor: User,
    target_user_id: uuid.UUID,
) -> str:
    """Admin-initiated reset. Returns the generated temporary password ONCE.

    Authz (role gate principal|secretary is applied in the router). Here we
    enforce the fine-grained guards:
      * a Secretary may NOT reset a Principal → 403 (FR-SET-04);
      * cannot reset self → 409 cannot_reset_self (use /auth/me/password);
      * unknown target → 404 user_not_found.
    On success: set must_change_password, revoke ALL the target's sessions, write
    audit_log("user.reset_password"). The plaintext is never logged/stored.
    """
    if actor.id == target_user_id:
        raise Conflict(
            "You cannot reset your own password here; use change-password instead.",
            code="cannot_reset_self",
        )

    target = db.scalar(
        select(User).where(
            User.id == target_user_id, User.deleted_at.is_(None)
        )
    )
    if target is None:
        raise NotFound("User not found.", code="user_not_found")

    # Privilege guard: only a Principal may reset a Principal (FR-SET-04).
    if target.role == Role.PRINCIPAL and actor.role != Role.PRINCIPAL:
        raise Forbidden("You are not permitted to reset this user's password.")

    temp_password = generate_temp_password()
    target.password_hash = hash_password(temp_password)
    target.must_change_password = True
    # An admin reset also clears any active lockout so the user can sign in.
    target.failed_login_count = 0
    target.locked_until = None

    # Revoke ALL the target's live sessions (force re-auth everywhere).
    db.execute(
        update(RefreshSession)
        .where(
            RefreshSession.user_id == target.id,
            RefreshSession.is_revoked.is_(False),
        )
        .values(is_revoked=True, revoked_at=_now())
    )

    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="user.reset_password",
            entity_type="user",
            entity_id=target.id,
            summary={"target_role": target.role.value},
        )
    )
    db.commit()
    return temp_password

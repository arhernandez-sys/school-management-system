"""Shared FastAPI dependencies (architecture.md §6 core/deps.py).

`get_db`            — request-scoped SQLAlchemy session (commit/rollback handled
                      by the service layer; this just provides + closes it).
`get_current_user`  — verifies the Bearer access token, loads the live user row,
                      enforces is_active, the forced password change AND the read-only
                      roles' write ban (D43), and stashes user_id for request logging.
`require_role(...)` — coarse role gate (architecture §3.2 layer 1).

Note the asymmetry: role REACH is per-route (`require_role`), but the read-only WRITE
ban is central, because a route can be forgotten and an allowlist cannot express a verb.
See `_is_read_only_refusal`.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import READ_ONLY_ROLES, Role, StudentStatus
from app.core.errors import (
    AccountInactive,
    Forbidden,
    PasswordChangeRequired,
    Unauthenticated,
)
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.modules.users.models import User

# auto_error=False so a missing header yields our normalized 401, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)

#: (method, path suffix) pairs a user with `must_change_password` may still reach.
#:
#: Everything else is refused with 403 `password_change_required`. Before D31 Phase 5
#: the flag was WRITTEN by four paths (the bootstrap seed, admissions acceptance, the
#: Dean's reset, user creation) and returned on `CurrentUser`, but NO server path read
#: it — enforcement was a single client redirect in `LoginForm.tsx`, so a deep link, a
#: stale tab or any API client with a valid token walked straight past it.
#:
#: Each exemption earns its place:
#:   * `PATCH /auth/me/password` is the way OUT of the state. Gating it would lock the
#:     account out of the only action that clears the flag.
#:   * `GET /auth/me` is how the client LEARNS about the flag. The frontend's bootstrap
#:     is refresh-then-/me, so refusing it would drop a reloading user to anonymous and
#:     the forced-change screen would lose the very fact it branches on. It returns the
#:     caller's own identity and preferences and no school data.
#:   * `POST /auth/logout` — walking away must always be possible.
#:
#: `/auth/login` and `/auth/refresh` are absent because neither depends on
#: `get_current_user`; they authenticate by password / refresh cookie instead. Both
#: deliberately still SUCCEED for a flagged account: the flag reaches the client on
#: their `user` payload, which is what the forced-change flow reads.
_FORCED_CHANGE_EXEMPT: frozenset[tuple[str, str]] = frozenset(
    {
        ("PATCH", "/auth/me/password"),
        ("GET", "/auth/me"),
        ("POST", "/auth/logout"),
    }
)


#: HTTP verbs that change state. A read-only role is refused all of them.
_WRITE_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: (method, path suffix) pairs a READ-ONLY role may still reach despite the verb (D43).
#:
#: These are the three writes that are not writes to school data — they act on the
#: caller's own session and credentials. An auditor who cannot log out, cannot change the
#: temporary password they were issued, and cannot set their own page size is not
#: read-only, they are unusable: the forced-change flow would trap them permanently,
#: since `PATCH /auth/me/password` is the only way out of `must_change_password`.
#:
#: Deliberately NOT here: `POST /auth/login` and `POST /auth/refresh`, which never reach
#: this guard because neither depends on `get_current_user`.
_READ_ONLY_EXEMPT: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/auth/logout"),
        ("PATCH", "/auth/me/password"),
        ("PATCH", "/auth/me/preferences"),
    }
)


def _matches(request: Request, pairs: frozenset[tuple[str, str]]) -> bool:
    """Whether (method, path) matches one of `pairs`.

    Matched on the REQUEST PATH's suffix rather than on the router prefix, so it holds
    whether the app is mounted at `/api/v1` (main.py) or bare (a unit test building its
    own app). The method is part of the key: `GET /auth/me` is exempt, but a `PATCH`
    to the same path is a preferences write and is not.
    """
    path = request.url.path.rstrip("/") or "/"
    return any(
        request.method == method and path.endswith(suffix) for method, suffix in pairs
    )


def _is_forced_change_exempt(request: Request) -> bool:
    """Whether this request is one of the three a flagged account may still make."""
    return _matches(request, _FORCED_CHANGE_EXEMPT)


def _is_read_only_refusal(request: Request, user: User) -> bool:
    """Whether this request must be refused because the caller's role cannot write.

    **Why this lives in `get_current_user` and not in `require_role`.** `require_role`
    is an allowlist of role NAMES and has no idea what verb it is guarding — it cannot
    express "GET only". Expressing the auditor's rule through it would mean auditing all
    121 `Depends(...)` tuples across 17 routers and getting every one right, where the
    failure mode of a single miss is a read-only account that can delete a student.

    `get_current_user` is the one dependency every authenticated route passes through,
    so a route cannot opt out of this by being forgotten — including a route written
    next year by someone who has never heard of the auditor role. That inversion is the
    whole point: new endpoints are read-only for auditors by default.
    """
    if user.role not in READ_ONLY_ROLES:
        return False
    if request.method not in _WRITE_METHODS:
        return False
    return not _matches(request, _READ_ONLY_EXEMPT)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None or not creds.credentials:
        raise Unauthenticated("Authentication required.")
    try:
        claims = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise Unauthenticated("Access token expired.") from exc
    except jwt.PyJWTError as exc:
        raise Unauthenticated("Invalid access token.") from exc

    user_id = claims.get("sub")
    user = db.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    if user is None:
        raise Unauthenticated("Account not found.")
    if not user.is_active:
        # A token issued before deactivation must not grant access.
        raise AccountInactive("This account is inactive.")
    if user.must_change_password and not _is_forced_change_exempt(request):
        # The token is valid; the account simply is not cleared for anything else
        # until the temporary password has been replaced (see _FORCED_CHANGE_EXEMPT).
        raise PasswordChangeRequired(
            "You must change your password before continuing."
        )
    if _is_read_only_refusal(request, user):
        # D43 — the auditor's read-only guarantee, enforced once for every route.
        raise Forbidden(
            "This account has read-only access and cannot make changes.",
            code="read_only_role",
        )

    # For structured request logging (logging.py reads request.state.user_id).
    request.state.user_id = str(user.id)
    return user


def require_role(*roles: Role):
    """Return a dependency that allows only the given roles (architecture §3.2)."""
    allowed = set(roles)

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise Forbidden("You do not have access to this resource.")
        return user

    return _checker


def assert_student_access_window(db: Session, user: User) -> None:
    """Refuse a GRADUATED student who is past the school's post-graduation window.

    D39, Meeting #2 item 6: "Set Availability of Grades/online access to students after
    graduation, for a period, recommended time is 3 months."

    A graduate keeps their login and needs it: transcripts, references and outstanding
    results all matter most in the weeks right after they finish. What the school did not
    want is that access lasting forever. The window is
    `school_profile.post_graduation_access_days`, counted from
    `student_profiles.graduation_date`, and it is operator-set rather than a constant so
    the policy can change without a deployment.

    Three deliberate choices:

    * **Only STUDENTS, and only GRADUATED ones.** Staff are unaffected. A withdrawn or
      dropped-out student is not covered either — that is a different decision the school
      has not made, and inventing an expiry for it here would lock people out on a rule
      nobody agreed.
    * **NULL `post_graduation_access_days` means never expires; NULL `graduation_date`
      means the clock has not started.** Both are open, not closed. A missing policy or a
      missing date is an absence of information, and reading absence as "expired" would
      lock a current student out of their own grades — the exact failure worth being
      asymmetric about.
    * **The boundary is inclusive.** With a 90-day window, day 90 is still allowed and
      day 91 is not, so "three months" means the whole of the third month.

    403 with a distinct `access_expired` code, not 404: the record plainly exists and the
    graduate needs to be told WHY, so they contact the Registrar instead of assuming a bug.
    """
    if user.role != Role.STUDENT:
        return

    # Imported here rather than at module scope for the same reason the grade-visibility
    # switch is: a top-level import would make every module touching `deps` drag the
    # students and settings model graph in.
    from app.core.timeutil import school_today
    from app.modules.settings.models import SchoolProfile
    from app.modules.students.models import StudentProfile

    student = db.scalar(
        select(StudentProfile).where(
            StudentProfile.user_id == user.id, StudentProfile.deleted_at.is_(None)
        )
    )
    if student is None or student.status != StudentStatus.GRADUATED:
        return
    if student.graduation_date is None:
        return

    window = db.scalar(select(SchoolProfile.post_graduation_access_days).limit(1))
    if window is None:
        return

    expires_on = student.graduation_date + timedelta(days=int(window))
    if school_today() > expires_on:
        raise Forbidden(
            "Online access closed on "
            f"{expires_on.strftime('%d/%m/%Y')}, "
            f"{int(window)} days after graduation. The Registrar can still issue your "
            "transcript.",
            code="access_expired",
        )


def require_role_within_access_window(*roles: Role):
    """`require_role(*roles)` PLUS the post-graduation access window (D39, item 6).

    For the student-facing ACADEMIC RECORD surfaces that are not grade surfaces — today
    that is `/attendance/me`. Grade surfaces use `require_student_grade_visibility`, which
    applies the same window on top of the Dean's publish switch.

    Deliberately NOT applied to `/students/me`: an expired graduate should still be able
    to open their own profile and find the Registrar's contact details. Closing the record
    is the ask; closing the door on the person who needs to ask about it is not.
    """
    base = require_role(*roles)

    def _checker(
        user: User = Depends(base), db: Session = Depends(get_db)
    ) -> User:
        assert_student_access_window(db, user)
        return user

    return _checker


def require_student_grade_visibility(*roles: Role):
    """`require_role(*roles)` PLUS the Dean's student grade-visibility switch (D32, §4).

    **Why a dependency and not a check inside each service.** The rule is "a student may
    not reach a grade at all", and there are four separate student-facing grade surfaces
    (`/grades/me`, `/reports/report-card/me`, `/students/me/assessments`, and the
    dashboard's own-grade block). Putting the check in each service would be four places
    to forget it; putting it in the transport layer means a new student grade endpoint has
    to opt IN to exposure rather than remember to opt out.

    **Only STUDENTS are gated by it.** A Lecturer needs their own gradebook to teach and a
    Dean needs every grade to run the college; the flag is about what a student sees. The
    Registrar's removal is NOT here either — that is unconditional, and is expressed by
    leaving `Role.SECRETARY` out of the role tuple on those routes.

    403 `grades_hidden`, not 404: the resource plainly exists, the student simply is not
    permitted it right now, and a 404 would send them hunting for a bug.
    """
    allowed = set(roles)

    def _checker(
        user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> User:
        if user.role not in allowed:
            raise Forbidden("You do not have access to this resource.")
        if user.role == Role.STUDENT:
            # Imported here, not at module scope: `auth.service` imports `core.security`
            # and the users/settings models, and a top-level import would make every
            # module that touches `deps` drag that graph in.
            from app.modules.auth.service import students_can_view_grades

            if not students_can_view_grades(db):
                raise Forbidden(
                    "Grades are not published to students at the moment. Your lecturer "
                    "or the Dean can tell you your results.",
                    code="grades_hidden",
                )
            # D39 (Meeting #2 item 6) — checked AFTER the visibility switch, so a student
            # inside their window still gets the more specific `grades_hidden` message
            # when grades are simply unpublished.
            assert_student_access_window(db, user)
        return user

    return _checker

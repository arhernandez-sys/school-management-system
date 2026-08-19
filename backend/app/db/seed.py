"""Idempotent bootstrap seed (database-schema.md §11 seeding notes; sub-phase 7.0b).

Creates, ONLY IF ABSENT (safe to re-run), the minimum rows the app needs to boot:

  * `school_profile`        — the single id=1 identity row (placeholder name).
  * `assessment_policies`   — the single id=1 school-default grading policy
                              (DB-14 defaults: absent_as_zero=false, allow_makeup=true,
                              drop_lowest_count=0).
  * `academic_years`        — one active year + its two `semesters` (D10; one active).
  * `grading_scales`        — pass_mark=70 + the BAJC 8-band `grading_scale_bands`
                              A 95-100 (4.00) … C 70-74 (2.00), D 65-69 (1.00, FAIL),
                              F 0-64 (0.00, FAIL). Defined once in
                              `settings/grading_defaults.py`; editable in Settings.
  * one Principal `users`    — Argon2id-hashed temporary password, must_change_password.

Run:  python -m app.db.seed   (from the backend/ dir, with the venv active)

Password handling (hard rule): the temporary principal password is generated via
`app.core.security.generate_temp_password`, hashed with `hash_password` (Argon2id),
and PRINTED EXACTLY ONCE to stdout. The plaintext is NEVER stored, logged, or
returned. If `SEED_ADMIN_PASSWORD` is set in the env it is used instead (still only
its hash is stored); otherwise one is generated.

Idempotency: every step is guarded by an existence check, so a second run makes no
duplicate rows and prints a clear "already seeded" message. The principal is keyed
by `SEED_ADMIN_EMAIL`.
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.common.enums import AcademicYearStatus, Role
from app.core.security import generate_temp_password, hash_password
from app.db.session import SessionLocal

# Import via the aggregator so every mapper is configured.
from app.modules.settings.grading_defaults import (
    BAJC_GRADING_BANDS,
    DEFAULT_PASS_MARK,
)
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    GradingScale,
    GradingScaleBand,
    SchoolProfile,
    Semester,
)
from app.modules.users.models import User

# The shipped grading scale lives in ONE place now (D30 §D5) — it used to be
# written out here AND in settings/service.py, kept in step by hand.


def _seed_school_profile(db: Session) -> bool:
    if db.get(SchoolProfile, 1) is not None:
        return False
    db.add(SchoolProfile(id=1, name="My School"))
    return True


def _seed_assessment_policies(db: Session) -> bool:
    if db.get(AssessmentPolicy, 1) is not None:
        return False
    # Explicit DB-14 defaults (also the column defaults; set for clarity).
    db.add(AssessmentPolicy(id=1, absent_as_zero=False, allow_makeup=True,
                            drop_lowest_count=0))
    return True


def _seed_academic_year(db: Session) -> tuple[bool, AcademicYear]:
    """Create the first active year + two semesters + grading scale/bands if no
    active year exists. Returns (created, the_active_year)."""
    existing = db.scalar(
        select(AcademicYear).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
    )
    if existing is not None:
        return False, existing

    year = AcademicYear(
        name="2025-2026",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 6, 30),
        status=AcademicYearStatus.ACTIVE,
    )
    db.add(year)
    db.flush()  # assign year.id

    db.add_all([
        Semester(academic_year_id=year.id, name="Semester 1", sequence=1,
                 start_date=date(2025, 9, 1), end_date=date(2026, 1, 31),
                 is_active=True),
        Semester(academic_year_id=year.id, name="Semester 2", sequence=2,
                 start_date=date(2026, 2, 1), end_date=date(2026, 6, 30),
                 is_active=False),
    ])

    scale = GradingScale(academic_year_id=year.id, pass_mark=Decimal(DEFAULT_PASS_MARK))
    db.add(scale)
    db.flush()  # assign scale.id

    db.add_all([
        GradingScaleBand(
            grading_scale_id=scale.id, letter=letter,
            min_score=Decimal(lo), max_score=Decimal(hi),
            grade_point=Decimal(gp),
            is_passing=passing, sort_order=order,
        )
        for (letter, lo, hi, gp, passing, order) in BAJC_GRADING_BANDS
    ])
    return True, year


def _seed_principal(db: Session) -> tuple[bool, str | None]:
    """Create the bootstrap Principal if absent. Returns (created, temp_password).

    temp_password is only non-None when WE generated it (so the caller can print
    it once). If SEED_ADMIN_PASSWORD was supplied, we do not echo it.
    """
    settings = get_settings()
    email = settings.seed_admin_email

    existing = db.scalar(
        select(User).where(User.email == email, User.deleted_at.is_(None))
    )
    if existing is not None:
        return False, None

    supplied = settings.seed_admin_password
    if supplied:
        plaintext = supplied
        echo = None  # do not print an operator-supplied secret
    else:
        plaintext = generate_temp_password()
        echo = plaintext

    db.add(User(
        email=email,
        password_hash=hash_password(plaintext),  # Argon2id; plaintext discarded
        role=Role.PRINCIPAL,
        full_name="School Principal",
        is_active=True,
        must_change_password=True,
    ))
    # Drop the plaintext reference promptly; never logged/stored.
    del plaintext, supplied
    return True, echo


def run_seed() -> None:
    db = SessionLocal()
    created_any = False
    principal_pw: str | None = None
    principal_created = False
    try:
        if _seed_school_profile(db):
            created_any = True
            print("  + school_profile (id=1) created")
        else:
            print("  = school_profile already present")

        if _seed_assessment_policies(db):
            created_any = True
            print("  + assessment_policies (id=1, DB-14 defaults) created")
        else:
            print("  = assessment_policies already present")

        year_created, _year = _seed_academic_year(db)
        if year_created:
            created_any = True
            print("  + academic_year + 2 semesters + grading_scale + 5 bands created")
        else:
            print("  = active academic_year already present")

        principal_created, principal_pw = _seed_principal(db)
        if principal_created:
            created_any = True
            print(f"  + principal user created ({get_settings().seed_admin_email})")
        else:
            print("  = principal user already present")

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print()
    if not created_any:
        print("Already seeded — no changes made.")
        return

    print("Seed complete.")
    if principal_created and principal_pw is not None:
        # The ONE place the plaintext temp password is ever surfaced. Out-of-band
        # delivery to the principal; they must change it on first login.
        print()
        print("=" * 64)
        print("  PRINCIPAL TEMPORARY PASSWORD (shown once — copy it now):")
        print(f"      {principal_pw}")
        print("  Email:", get_settings().seed_admin_email)
        print("  This will NOT be shown again. must_change_password=true.")
        print("=" * 64)
    elif principal_created:
        print("Principal created using the operator-supplied SEED_ADMIN_PASSWORD "
              "(not echoed).")


if __name__ == "__main__":
    print("Running SIS bootstrap seed...")
    run_seed()
    sys.exit(0)

"""Settings service layer (api-spec §5 Module 11, FR-SET-01..07, D10/D11/DB-14).

The service owns ALL database access + transaction boundaries for the 18 Settings
endpoints; the router stays thin (parse request -> call service -> shape response).
Reuses the existing security/deps/errors/pagination primitives — no new deps.

Authz discipline (api-spec §3.3/§3.4 — this module manages users/roles, so the
fine-grained guards are security-critical):
  * Coarse role gates are applied in the router (`require_role(...)`).
  * Fine-grained guards (Secretary may not touch a Principal; only a Principal may
    assign/Change a privileged role) live here, next to the data.

One deliberately-stubbed integration point is flagged inline:
  * TODO(OQ-DB5) — logo object-storage upload (no object-storage bucket provisioned).
    The endpoint shape + validation are real; only the byte upload is stubbed.

The year-archival snapshot freeze is **no longer stubbed** (2026-07-28): computation
lives in `app/modules/reports/freeze.py` and is invoked by `archive_academic_year`
before the state transitions. See that function's docstring for the ordering rule.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.common.enums import AcademicYearStatus, Role
from app.common.schemas import (
    AcademicYearRef,
    CurrentUser,
    SemesterRef,
)
from app.config import Settings as AppSettings
from app.core.errors import Conflict, Forbidden, NotFound, ValidationError
from app.core.pagination import PageParams, paginate
from app.core.security import generate_temp_password, hash_password
from app.modules.auth.service import build_current_user
from app.modules.offerings.models import CourseOffering
from app.modules.settings.grading_defaults import (
    BAJC_GRADING_BANDS,
    DEFAULT_PASS_MARK,
)
from app.modules.settings.models import (
    AcademicYear,
    AssessmentPolicy,
    AuditLog,
    GradingScale,
    GradingScaleBand,
    SchoolProfile,
    Semester,
)
from app.modules.settings.schemas import (
    AccountUpdateRequest,
    ActiveTerm,
    AcademicYearCreateRequest,
    AcademicYearDetail,
    AssessmentPolicyRead,
    AssessmentPolicyUpdateRequest,
    GradingBand,
    GradingScaleRead,
    SchoolProfileRead,
    SchoolUpdateRequest,
    SemesterDetail,
    SemesterUpdateRequest,
    StandaloneSemesterCreateRequest,
    UserCreateRequest,
    UserListItem,
    UserUpdateRequest,
)
from app.modules.users.models import User, UserPreferences

# Roles that are "privileged" — assigning or moving a user INTO these, or any role
# *change*, is Principal-only (FR-SET-04, §5.11).
_PRIVILEGED_ROLES = {Role.PRINCIPAL, Role.SECRETARY}

# Allowed sort fields for the users list (whitelist — never interpolated, §6).
_USER_SORT_FIELDS = {
    "full_name": User.full_name,
    "email": User.email,
    "role": User.role,
    "last_login_at": User.last_login_at,
    "created_at": User.created_at,
}

# Image content types accepted for the logo upload (§5.11; 415 otherwise).
_LOGO_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
_LOGO_MAX_BYTES = 2 * 1024 * 1024  # 2 MiB cap (413 file_too_large)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _to_utc(value: datetime | None) -> datetime | None:
    """Normalise an inbound datetime to aware-UTC before it is stored (D30 §D6).

    The grade-submission deadline is the first datetime a CLIENT supplies, and a Dean
    in Belize will naturally send `...T17:00:00-06:00`. The column is a MariaDB
    `DATETIME`, so SQLAlchemy drops the offset on the way in -- storing 17:00 as though
    it were UTC and moving the real cutoff six hours earlier. Convert first; a naive
    value is taken as UTC, matching `core.timeutil.ensure_aware` on the way back out.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _audit(
    db: Session,
    *,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    summary: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# School profile / branding (§5.11)
# ──────────────────────────────────────────────────────────────────────────────
def _logo_url_for(_key: str | None) -> str | None:
    """Resolve a public logo URL from `logo_storage_key`.

    TODO(OQ-DB5): the Supabase Storage bucket name + anon key are not yet
    provisioned (OQ-FE-C pending). Until then there is no public base to compose,
    so we return None even when a key exists. When storage lands, build:
        f"{SUPABASE_STORAGE_PUBLIC_BASE}/{bucket}/{key}".
    Do NOT invent a bucket name here.
    """
    return None


def _school_or_404(db: Session) -> SchoolProfile:
    profile = db.get(SchoolProfile, 1)
    if profile is None:
        # The seed guarantees the id=1 row; absence is a setup error, not a client
        # 404 of a scoped resource.
        raise NotFound("School profile is not configured.", code="not_found")
    return profile


def get_school(db: Session) -> SchoolProfileRead:
    """GET /settings/school — the single-row identity (authenticated read)."""
    profile = _school_or_404(db)
    return SchoolProfileRead(
        name=profile.name,
        logo_url=_logo_url_for(profile.logo_storage_key),
        address=profile.address,
        contact_email=profile.contact_email,
        contact_phone=profile.contact_phone,
    )


def update_school(
    db: Session, *, actor: User, payload: SchoolUpdateRequest
) -> SchoolProfileRead:
    """PUT /settings/school (principal). Audited."""
    profile = _school_or_404(db)
    profile.name = payload.name
    profile.address = payload.address
    profile.contact_email = payload.contact_email
    profile.contact_phone = payload.contact_phone
    profile.updated_by = actor.id
    _audit(db, actor=actor, action="school.update", entity_type="school_profile")
    db.commit()
    return SchoolProfileRead(
        name=profile.name,
        logo_url=_logo_url_for(profile.logo_storage_key),
        address=profile.address,
        contact_email=profile.contact_email,
        contact_phone=profile.contact_phone,
    )


def validate_logo_upload(*, content_type: str | None, size_bytes: int) -> None:
    """Validate the multipart image part BEFORE attempting storage (§5.11).

    415 unsupported_media_type for a non-image; 413 file_too_large past the cap.
    These run regardless of whether storage is provisioned, so the contract's
    error surface is real today.
    """
    if content_type not in _LOGO_ALLOWED_TYPES:
        raise ValidationError(
            "Unsupported image type; use PNG, JPEG, WEBP, or SVG.",
            code="unsupported_media_type",
        )
    if size_bytes > _LOGO_MAX_BYTES:
        raise ValidationError(
            "Logo file is too large (max 2 MiB).",
            code="file_too_large",
        )


def upload_logo(
    db: Session, *, actor: User, content_type: str | None, data: bytes
) -> str | None:
    """POST /settings/school/logo (principal). Returns the resolved logo_url.

    TODO(OQ-DB5) — STORAGE ADAPTER BOUNDARY. The Supabase Storage bucket + anon
    key are not yet provisioned, so we do NOT perform a real upload here. We
    validate the file (done by the router via `validate_logo_upload`), then leave
    `logo_storage_key` untouched and return None. When storage lands, this is the
    single function that uploads the bytes and writes `logo_storage_key`.
    """
    validate_logo_upload(content_type=content_type, size_bytes=len(data))
    profile = _school_or_404(db)
    # Intentionally NOT writing logo_storage_key — no bucket/key to compute yet.
    _audit(
        db,
        actor=actor,
        action="school.logo_upload_stubbed",
        entity_type="school_profile",
        summary={"content_type": content_type, "size_bytes": len(data)},
    )
    db.commit()
    return _logo_url_for(profile.logo_storage_key)


# ──────────────────────────────────────────────────────────────────────────────
# Active term (§5.11 — the system-wide degrade signal)
# ──────────────────────────────────────────────────────────────────────────────
def get_active_term(db: Session) -> ActiveTerm:
    """GET /settings/active-term. Returns {academic_year, semester} for the active
    semester, else raises 409 no_active_semester (the uniform degrade code every
    module + /dashboard keys on, OQ-API-4)."""
    semester = db.scalar(select(Semester).where(Semester.is_active.is_(True)))
    if semester is None:
        raise Conflict("No active semester is configured.", code="no_active_semester")
    year = db.get(AcademicYear, semester.academic_year_id)
    if year is None:  # FK guarantees this, but be defensive
        raise Conflict("No active semester is configured.", code="no_active_semester")
    return ActiveTerm(
        academic_year=AcademicYearRef.model_validate(year),
        semester=SemesterRef.model_validate(semester),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Academic years + semesters (§5.11)
# ──────────────────────────────────────────────────────────────────────────────
def _year_detail(db: Session, year: AcademicYear) -> AcademicYearDetail:
    semesters = (
        db.execute(
            select(Semester)
            .where(Semester.academic_year_id == year.id)
            .order_by(Semester.sequence)
        )
        .scalars()
        .all()
    )
    return AcademicYearDetail(
        id=year.id,
        name=year.name,
        start_date=year.start_date,
        end_date=year.end_date,
        status=year.status,
        archived_at=year.archived_at,
        semesters=[SemesterDetail.model_validate(s) for s in semesters],
    )


def list_academic_years(db: Session) -> list[AcademicYearDetail]:
    """GET /settings/academic-years (P/S). Newest start_date first."""
    years = (
        db.execute(select(AcademicYear).order_by(AcademicYear.start_date.desc()))
        .scalars()
        .all()
    )
    return [_year_detail(db, y) for y in years]


def list_semesters(
    db: Session, *, academic_year_id: uuid.UUID | None
) -> list[SemesterDetail]:
    """GET /settings/semesters?academic_year_id? (P/S)."""
    stmt = select(Semester)
    if academic_year_id is not None:
        stmt = stmt.where(Semester.academic_year_id == academic_year_id)
    # Chronological, newest year first, then term order within the year.
    #
    # This previously ordered by `Semester.academic_year_id` — a UUID, so across
    # multiple years the terms came back in an arbitrary (and stable-looking, hence
    # deceptive) order. With no `academic_year_id` this endpoint returns EVERY year's
    # terms, and its only consumer is the report-card term picker, so "Semester 1" from
    # some random year could sort ahead of the current one.
    stmt = (
        stmt.join(AcademicYear, Semester.academic_year_id == AcademicYear.id)
        .order_by(AcademicYear.start_date.desc(), Semester.sequence)
    )
    rows = db.execute(stmt).scalars().all()
    return [SemesterDetail.model_validate(s) for s in rows]


def create_academic_year(
    db: Session, *, actor: User, payload: AcademicYearCreateRequest
) -> AcademicYearDetail:
    """POST /settings/academic-years (principal).

    Creates the year as ACTIVE + its terms + seeds the year's grading_scale and
    default bands (D11). The LOWEST-sequence term is set active, clearing any prior
    active semester (one-active invariant). Creating a second active year violates
    `uq_academic_years_one_active` → 409.

    D30 (§D3): **one or more** terms, no longer exactly two. The old rule demanded
    sequences of precisely `[1, 2]`, which is why BAJC's Summer and Spring blocks had
    nowhere to go. Sequences must still be DISTINCT — `uq_semesters_year_seq` is
    unchanged — and further terms can be added later through
    `POST /settings/semesters`.
    """
    if payload.end_date <= payload.start_date:
        raise ValidationError(
            "end_date must be after start_date.",
            fields={"end_date": ["Must be after start_date."]},
        )

    sequences = [s.sequence for s in payload.semesters]
    if len(set(sequences)) != len(sequences):
        raise ValidationError(
            "Each term needs its own sequence number within the year.",
            fields={"semesters": ["Sequence numbers must be distinct."]},
        )
    for spec in payload.semesters:
        if spec.end_date <= spec.start_date:
            raise ValidationError(
                f"Term '{spec.name}' must end after it starts.",
                fields={"semesters": [f"'{spec.name}': end_date must be after start_date."]},
            )

    # Pre-check the one-active invariant for a friendly 409 (the partial-unique
    # index is the real backstop, but pre-checking gives the documented code).
    existing_active = db.scalar(
        select(AcademicYear.id).where(
            AcademicYear.status == AcademicYearStatus.ACTIVE
        )
    )
    if existing_active is not None:
        raise Conflict(
            "An active academic year already exists; archive it first.",
            code="active_year_exists",
        )

    year = AcademicYear(
        name=payload.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=AcademicYearStatus.ACTIVE,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(year)
    db.flush()  # assign year.id

    # Clear any currently-active semester before activating this year's first one
    # (defensive: there should be none if no active year existed).
    db.execute(
        update(Semester)
        .where(Semester.is_active.is_(True))
        .values(is_active=False)
    )

    # The LOWEST sequence starts active — with N terms "sequence == 1" was no longer a
    # safe stand-in for "the first one", and a year whose terms started at 2 would
    # otherwise have been created with no active term at all.
    first_sequence = min(sequences)
    for spec in sorted(payload.semesters, key=lambda s: s.sequence):
        db.add(
            Semester(
                academic_year_id=year.id,
                name=spec.name,
                term_type=spec.term_type,
                sequence=spec.sequence,
                start_date=spec.start_date,
                end_date=spec.end_date,
                is_active=(spec.sequence == first_sequence),
            )
        )

    scale = GradingScale(
        academic_year_id=year.id,
        pass_mark=Decimal(DEFAULT_PASS_MARK),
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(scale)
    db.flush()  # assign scale.id
    db.add_all(
        [
            GradingScaleBand(
                grading_scale_id=scale.id,
                letter=letter,
                min_score=Decimal(lo),
                max_score=Decimal(hi),
                grade_point=Decimal(gp),
                is_passing=passing,
                sort_order=order,
            )
            for (letter, lo, hi, gp, passing, order) in BAJC_GRADING_BANDS
        ]
    )

    _audit(
        db,
        actor=actor,
        action="academic_year.create",
        entity_type="academic_year",
        entity_id=year.id,
        summary={"name": year.name},
    )
    db.commit()
    return _year_detail(db, year)


def _semester_or_404(db: Session, semester_id: uuid.UUID) -> Semester:
    semester = db.get(Semester, semester_id)
    if semester is None:
        raise NotFound("Semester not found.", code="not_found")
    return semester


def _assert_year_writable(db: Session, year_id: uuid.UUID) -> AcademicYear:
    year = db.get(AcademicYear, year_id)
    if year is None:
        raise NotFound("Academic year not found.", code="not_found")
    if year.status == AcademicYearStatus.ARCHIVED:
        raise Conflict(
            "Cannot change the terms of an archived year.", code="year_archived"
        )
    return year


def _assert_sequence_free(
    db: Session,
    *,
    academic_year_id: uuid.UUID,
    sequence: int,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Pre-check `uq_semesters_year_seq` for the documented 409.

    The unique index is the real backstop; this only turns a driver-level integrity
    error into a named code the UI can act on.
    """
    stmt = select(Semester.id).where(
        Semester.academic_year_id == academic_year_id,
        Semester.sequence == sequence,
    )
    if exclude_id is not None:
        stmt = stmt.where(Semester.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(
            f"Another term in this year already uses sequence {sequence}.",
            code="duplicate_semester_sequence",
        )


def _assert_midterm_window(
    start: datetime | None, end: datetime | None
) -> tuple[datetime | None, datetime | None]:
    """Validate the mid-term grading window and return it normalised to UTC (D32).

    **Both or neither.** A start with no end can never elapse, so the revision rules
    would hold every request back forever; an end with no start has nothing to measure
    "the assessment existed before the period began" against, so rule 2 could not be
    evaluated at all. Either half alone is a configuration that cannot produce a correct
    answer, so it is rejected here rather than half-honoured later.

    Mirrors `ck_semesters_midterm_window`, which is the backstop for a direct SQL edit;
    this is the readable 422 a Dean actually sees.
    """
    start = _to_utc(start)
    end = _to_utc(end)
    if (start is None) != (end is None):
        missing = "midterm_submission_end" if end is None else "midterm_submission_start"
        raise ValidationError(
            "The mid-term grading window needs both a start and an end date, or "
            "neither.",
            fields={missing: ["Required when the other mid-term date is set."]},
        )
    if start is not None and end is not None and end <= start:
        raise ValidationError(
            "midterm_submission_end must be after midterm_submission_start.",
            fields={
                "midterm_submission_end": ["Must be after midterm_submission_start."]
            },
        )
    return start, end


def create_semester(
    db: Session, *, actor: User, payload: StandaloneSemesterCreateRequest
) -> SemesterDetail:
    """POST /settings/semesters (Dean only; D30 §D3, §D14).

    NEW IN D30. There was deliberately no such endpoint before: the school's whole
    calendar came from `POST /settings/academic-years`, which hard-created exactly two
    terms, so adding BAJC's Summer or Spring block had no route at all.

    The new term is created INACTIVE. Activating is a separate, deliberate action
    (`PATCH /settings/semesters/{id}/activate`) because it moves the school-wide
    current term and would otherwise happen as a side effect of adding a future block.

    NOT VALIDATED, on purpose: that the term's dates fall inside the academic year's
    range. BAJC's Summer block legitimately sits outside it — the sample report card
    prints `Summer, July 2026 - August 2026` for the 2026-2027 year, which begins in
    August. Rejecting that would reject the institution's own calendar.
    """
    _assert_year_writable(db, payload.academic_year_id)

    if payload.end_date <= payload.start_date:
        raise ValidationError(
            "end_date must be after start_date.",
            fields={"end_date": ["Must be after start_date."]},
        )
    _assert_sequence_free(
        db, academic_year_id=payload.academic_year_id, sequence=payload.sequence
    )
    midterm_start, midterm_end = _assert_midterm_window(
        payload.midterm_submission_start, payload.midterm_submission_end
    )

    semester = Semester(
        academic_year_id=payload.academic_year_id,
        name=payload.name.strip(),
        term_type=payload.term_type,
        sequence=payload.sequence,
        start_date=payload.start_date,
        end_date=payload.end_date,
        grade_submission_deadline=_to_utc(payload.grade_submission_deadline),
        midterm_submission_start=midterm_start,
        midterm_submission_end=midterm_end,
        is_active=False,
    )
    db.add(semester)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="semester.create",
        entity_type="semester",
        entity_id=semester.id,
        summary={"name": semester.name, "term_type": semester.term_type.value},
    )
    db.commit()
    return SemesterDetail.model_validate(semester)


def update_semester(
    db: Session, *, actor: User, semester_id: uuid.UUID, payload: SemesterUpdateRequest
) -> SemesterDetail:
    """PATCH /settings/semesters/{id} (Dean only; D30 §D3, §D14).

    Corrects a term's name, kind, order or dates. A term created with the wrong dates
    was otherwise unfixable, since there is no delete path (see the router).

    `academic_year_id` and `is_active` are not editable here — see
    `SemesterUpdateRequest` for why. The date range is validated against the MERGED
    values, not just the supplied ones, so moving only `start_date` past the existing
    `end_date` is caught here rather than by `ck_semesters_dates` at the driver.
    """
    semester = _semester_or_404(db, semester_id)
    _assert_year_writable(db, semester.academic_year_id)

    start = payload.start_date or semester.start_date
    end = payload.end_date or semester.end_date
    if end <= start:
        raise ValidationError(
            "end_date must be after start_date.",
            fields={"end_date": ["Must be after start_date."]},
        )

    if payload.sequence is not None and payload.sequence != semester.sequence:
        _assert_sequence_free(
            db,
            academic_year_id=semester.academic_year_id,
            sequence=payload.sequence,
            exclude_id=semester.id,
        )
        semester.sequence = payload.sequence

    if payload.name is not None:
        semester.name = payload.name.strip()
    if payload.term_type is not None:
        semester.term_type = payload.term_type
    # PRESENCE, not None-ness: `null` reopens a closed grade window, omitted leaves it
    # alone. See `SemesterUpdateRequest` for why these fields are treated that way.
    if "grade_submission_deadline" in payload.model_fields_set:
        semester.grade_submission_deadline = _to_utc(payload.grade_submission_deadline)

    # D32 — same presence semantics, but validated on the MERGED pair, so sending only
    # `midterm_submission_end` is checked against the start already on the row rather
    # than against nothing. Sending `null` for one half while the other keeps a value is
    # what `_assert_midterm_window` rejects; clearing the window means sending both as
    # `null`.
    touches_midterm = bool(
        {"midterm_submission_start", "midterm_submission_end"}
        & payload.model_fields_set
    )
    if touches_midterm:
        merged_start = (
            payload.midterm_submission_start
            if "midterm_submission_start" in payload.model_fields_set
            else semester.midterm_submission_start
        )
        merged_end = (
            payload.midterm_submission_end
            if "midterm_submission_end" in payload.model_fields_set
            else semester.midterm_submission_end
        )
        (
            semester.midterm_submission_start,
            semester.midterm_submission_end,
        ) = _assert_midterm_window(merged_start, merged_end)

    semester.start_date = start
    semester.end_date = end

    _audit(
        db,
        actor=actor,
        action="semester.update",
        entity_type="semester",
        entity_id=semester.id,
    )
    db.commit()
    return SemesterDetail.model_validate(semester)


def activate_semester(
    db: Session, *, actor: User, semester_id: uuid.UUID
) -> SemesterDetail:
    """PATCH /settings/semesters/{id}/activate (principal). One-active invariant:
    clears the prior active semester, sets this one active. The target's year must
    not be archived."""
    semester = db.get(Semester, semester_id)
    if semester is None:
        raise NotFound("Semester not found.", code="not_found")

    year = db.get(AcademicYear, semester.academic_year_id)
    if year is not None and year.status == AcademicYearStatus.ARCHIVED:
        raise Conflict(
            "Cannot activate a semester of an archived year.", code="year_archived"
        )

    if not semester.is_active:
        # Clear the prior active first (the partial-unique index forbids two).
        db.execute(
            update(Semester)
            .where(Semester.is_active.is_(True))
            .values(is_active=False)
        )
        semester.is_active = True

    _audit(
        db,
        actor=actor,
        action="semester.activate",
        entity_type="semester",
        entity_id=semester.id,
    )
    db.commit()
    return SemesterDetail.model_validate(semester)


def freeze_midterm_grades(
    db: Session, *, actor: User, semester_id: uuid.UUID
) -> tuple[int, datetime]:
    """POST /settings/semesters/{id}/midterm-freeze (Dean only; D32, brief §6).

    Captures every enrolled student's report card for the term as a MID-TERM snapshot, so
    later reads serve a frozen document instead of recalculating from grades that have
    moved on. Returns `(rows_written, frozen_at)`.

    **Idempotent.** Re-running refreshes in place on
    `uq_report_card_snapshot (student_id, semester_id, kind)`. That is deliberate and
    useful: a Dean who corrects a mark after freezing can re-freeze rather than being told
    the term is already done.

    **This is the explicit half of a two-part mechanism.** The other half is the lazy
    freeze in `reports.service._midterm_report_card`, which captures on first read if the
    window has closed and nobody pressed this button. Both exist because the backend has
    no scheduler (`app/jobs/purge.py` says so explicitly) — the button gives the Dean
    control over WHEN, and the fallback guarantees a report is never simply missing.

    The window checks (409 `midterm_window_open`, 422 `no_midterm_window`) live in
    `freeze_midterm` so both entry points enforce them identically.

    Mirrors `archive_academic_year`: the computation lives in `reports.freeze` because a
    snapshot IS a report card, produced by the same builder that serves
    `/reports/report-card`. Imported lazily for the same circular-import reason.
    """
    from app.modules.reports.freeze import freeze_midterm

    semester = _semester_or_404(db, semester_id)
    written = freeze_midterm(db, actor=actor, semester=semester)
    frozen_at = _now()
    db.commit()
    return written, frozen_at


def archive_academic_year(
    db: Session, *, actor: User, year_id: uuid.UUID
) -> tuple[int, bool]:
    """POST /settings/academic-years/{id}/archive (principal). Returns
    (snapshots_written, no_active_year_remaining).

    THE FREEZE (schema §10.4, FR-SET-07) runs first, then the state transitions:
      1. compute + upsert `term_grade_snapshots` and `report_card_snapshots`
         (delegated to `reports.freeze.freeze_academic_year`)
      2. academic_years.status = 'archived' (+ archived_at)
      3. grading_scales.is_frozen = true (for this year's scale)
      4. classes.is_archived = true (for this year's sections)
      5. deactivate this year's semesters (so no_active_year_remaining is honest)
    Already archived -> 409 year_already_archived (no double-write).

    **Step 1 must precede step 2.** The report-card builder decides live-vs-frozen
    from `archived_at`, so setting the flag first would make the freeze read the
    snapshots it is meant to be creating and write nothing.

    Snapshot computation lives in `reports.freeze` rather than here because a
    snapshot IS a report card — it is produced by the same builder that serves
    `/reports/report-card`, and duplicating that shaping logic would guarantee the
    two drift apart. Imported lazily to avoid a circular import (Reports depends on
    this module for the logo URL resolver).
    """
    from app.modules.reports.freeze import freeze_academic_year

    year = db.get(AcademicYear, year_id)
    if year is None:
        raise NotFound("Academic year not found.", code="not_found")

    if year.status == AcademicYearStatus.ARCHIVED:
        # Request-level idempotency: do NOT re-run the freeze (OQ-API-4).
        raise Conflict(
            "This academic year is already archived.", code="year_already_archived"
        )

    # ── 1. Freeze, while the year is still live ────────────────────────────────
    snapshots_written = freeze_academic_year(db, actor=actor, year=year)

    # ── 2-5. State transitions ─────────────────────────────────────────────────
    year.status = AcademicYearStatus.ARCHIVED
    year.archived_at = _now()
    year.updated_by = actor.id

    db.execute(
        update(GradingScale)
        .where(GradingScale.academic_year_id == year.id)
        .values(is_frozen=True)
    )
    # D31: an offering is scoped to a SEMESTER, not to a year, so "archive this year's
    # offerings" is now a subquery through `semesters` rather than a direct column match.
    db.execute(
        update(CourseOffering)
        .where(
            CourseOffering.semester_id.in_(
                select(Semester.id).where(Semester.academic_year_id == year.id)
            )
        )
        .values(is_archived=True)
    )
    # Deactivate this year's semesters so the school has no active term until a new
    # year is created/activated (the uniform 409 no_active_semester degrade path).
    db.execute(
        update(Semester)
        .where(Semester.academic_year_id == year.id, Semester.is_active.is_(True))
        .values(is_active=False)
    )

    no_active_year_remaining = (
        db.scalar(
            select(func.count())
            .select_from(AcademicYear)
            .where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        or 0
    ) == 0

    _audit(
        db,
        actor=actor,
        action="academic_year.archive",
        entity_type="academic_year",
        entity_id=year.id,
        summary={"snapshots_written": snapshots_written},
    )
    db.commit()
    return snapshots_written, no_active_year_remaining


# ──────────────────────────────────────────────────────────────────────────────
# Grading scale (§5.11 — D11)
# ──────────────────────────────────────────────────────────────────────────────
def _resolve_scale_year_id(
    db: Session, academic_year_id: uuid.UUID | None
) -> uuid.UUID:
    """Resolve the target year: explicit id, else the active year. 404 if no
    active year and none supplied."""
    if academic_year_id is not None:
        if db.get(AcademicYear, academic_year_id) is None:
            raise NotFound("Academic year not found.", code="not_found")
        return academic_year_id
    active = db.scalar(
        select(AcademicYear.id).where(
            AcademicYear.status == AcademicYearStatus.ACTIVE
        )
    )
    if active is None:
        raise NotFound("No active academic year.", code="not_found")
    return active


def _scale_for_year(db: Session, year_id: uuid.UUID) -> GradingScale:
    scale = db.scalar(
        select(GradingScale).where(GradingScale.academic_year_id == year_id)
    )
    if scale is None:
        raise NotFound("No grading scale for this year.", code="not_found")
    return scale


def _read_scale(db: Session, scale: GradingScale) -> GradingScaleRead:
    bands = (
        db.execute(
            select(GradingScaleBand)
            .where(GradingScaleBand.grading_scale_id == scale.id)
            .order_by(GradingScaleBand.sort_order)
        )
        .scalars()
        .all()
    )
    return GradingScaleRead(
        academic_year_id=scale.academic_year_id,
        pass_mark=float(scale.pass_mark),
        is_frozen=scale.is_frozen,
        bands=[GradingBand.model_validate(b) for b in bands],
    )


def get_grading_scale(
    db: Session, *, academic_year_id: uuid.UUID | None
) -> GradingScaleRead:
    """GET /settings/grading-scale?academic_year_id? (authenticated; default active)."""
    year_id = _resolve_scale_year_id(db, academic_year_id)
    return _read_scale(db, _scale_for_year(db, year_id))


def _validate_band_contiguity(bands: list[GradingBand]) -> None:
    """Validate the bands tile [0, 100] with no gaps/overlaps (schema §5 rule 3).

    Raises 422 grading_bands_invalid listing the specific conflicts. The model
    already constrained each band to [0,100] and the field-level min<=max is
    checked here too (so a single inverted band is reported as a conflict rather
    than slipping through).
    """
    conflicts: list[str] = []

    for b in bands:
        if b.min_score > b.max_score:
            conflicts.append(
                f"Band {b.letter}: min_score ({b.min_score}) exceeds max_score "
                f"({b.max_score})."
            )

    ordered = sorted(bands, key=lambda b: b.min_score)

    # Must start at 0 and end at 100 (full coverage of the 0..100 domain).
    if ordered and ordered[0].min_score != 0:
        conflicts.append(
            f"Bands must start at 0 (lowest band {ordered[0].letter} starts at "
            f"{ordered[0].min_score})."
        )
    if ordered and ordered[-1].max_score != 100:
        conflicts.append(
            f"Bands must reach 100 (highest band {ordered[-1].letter} ends at "
            f"{ordered[-1].max_score})."
        )

    # Adjacent bands must be contiguous: next.min == prev.max (inclusive ceilings,
    # OQ-DB2 seed convention) OR next.min just above prev.max. We accept either an
    # exact touch (prev.max == next.min) which would double-count the boundary, OR
    # the inclusive `.xx`/next-integer convention. To be robust to both the seed's
    # ".99 ceiling" style and a clean half-open style, we flag a GAP when
    # next.min > prev.max + a small epsilon, and an OVERLAP when next.min < prev.max.
    for prev, nxt in zip(ordered, ordered[1:]):
        gap = float(nxt.min_score) - float(prev.max_score)
        if gap < 0:
            conflicts.append(
                f"Bands {prev.letter} and {nxt.letter} overlap "
                f"({prev.letter} ends {prev.max_score}, {nxt.letter} starts "
                f"{nxt.min_score})."
            )
        elif gap > 1.0:
            conflicts.append(
                f"Gap between {prev.letter} (ends {prev.max_score}) and "
                f"{nxt.letter} (starts {nxt.min_score})."
            )

    # Duplicate letters.
    letters = [b.letter for b in bands]
    dupes = {ltr for ltr in letters if letters.count(ltr) > 1}
    for ltr in sorted(dupes):
        conflicts.append(f"Duplicate band letter '{ltr}'.")

    if conflicts:
        raise ValidationError(
            "Grading bands must tile 0–100 with no gaps or overlaps.",
            code="grading_bands_invalid",
            fields={"bands": conflicts},
        )


def update_grading_scale(
    db: Session,
    *,
    actor: User,
    pass_mark: float,
    bands: list[GradingBand],
    academic_year_id: uuid.UUID | None,
) -> GradingScaleRead:
    """PUT /settings/grading-scale (principal).

    409 scale_frozen on a frozen scale (archived year); 422 grading_bands_invalid
    on non-contiguous bands. Replaces all bands transactionally."""
    year_id = _resolve_scale_year_id(db, academic_year_id)
    scale = _scale_for_year(db, year_id)

    if scale.is_frozen:
        raise Conflict(
            "This grading scale is frozen (the year is archived) and cannot be "
            "changed.",
            code="scale_frozen",
        )

    _validate_band_contiguity(bands)

    scale.pass_mark = Decimal(str(pass_mark))
    scale.updated_by = actor.id

    # Replace bands: delete existing, insert the new set (CASCADE not needed — we
    # delete explicitly within the same txn).
    db.execute(
        GradingScaleBand.__table__.delete().where(
            GradingScaleBand.grading_scale_id == scale.id
        )
    )
    db.add_all(
        [
            GradingScaleBand(
                grading_scale_id=scale.id,
                letter=b.letter,
                min_score=Decimal(str(b.min_score)),
                max_score=Decimal(str(b.max_score)),
                # Omitted → NULL, which `calc.grade_point_for` reads as "this scale
                # cannot answer" rather than as zero (D30 §D5).
                grade_point=None if b.grade_point is None else Decimal(str(b.grade_point)),
                is_passing=b.is_passing,
                sort_order=b.sort_order,
            )
            for b in bands
        ]
    )

    _audit(
        db,
        actor=actor,
        action="grading_scale.update",
        entity_type="grading_scale",
        entity_id=scale.id,
    )
    db.commit()
    return _read_scale(db, scale)


# ──────────────────────────────────────────────────────────────────────────────
# Assessment policy (§5.11 — DB-14 school defaults)
# ──────────────────────────────────────────────────────────────────────────────
def _policy_or_404(db: Session) -> AssessmentPolicy:
    policy = db.get(AssessmentPolicy, 1)
    if policy is None:
        raise NotFound("Assessment policy is not configured.", code="not_found")
    return policy


def get_assessment_policy(db: Session) -> AssessmentPolicyRead:
    """GET /settings/assessment-policy (P/S)."""
    return AssessmentPolicyRead.model_validate(_policy_or_404(db))


def update_assessment_policy(
    db: Session, *, actor: User, payload: AssessmentPolicyUpdateRequest
) -> AssessmentPolicyRead:
    """PUT /settings/assessment-policy (principal)."""
    policy = _policy_or_404(db)
    policy.absent_as_zero = payload.absent_as_zero
    policy.allow_makeup = payload.allow_makeup
    policy.drop_lowest_count = payload.drop_lowest_count
    policy.students_can_view_grades = payload.students_can_view_grades
    policy.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="assessment_policy.update",
        entity_type="assessment_policy",
        # D32 — who can see grades is an access-control decision, not a grading tweak, so
        # the audit row records the value rather than just "the policy changed".
        summary={"students_can_view_grades": payload.students_can_view_grades},
    )
    db.commit()
    return AssessmentPolicyRead.model_validate(policy)


# ──────────────────────────────────────────────────────────────────────────────
# User & role management (§5.11 — FR-SET-04; security-sensitive)
# ──────────────────────────────────────────────────────────────────────────────
def list_users(
    db: Session,
    *,
    params: PageParams,
    role: Role | None,
    is_active: bool | None,
    search: str | None,
):
    """GET /settings/users (P/S). Page[UserListItem] + role?/is_active?/search."""
    stmt = select(User).where(User.deleted_at.is_(None))
    if role is not None:
        stmt = stmt.where(User.role == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if search:
        like = f"%{search.strip()}%"
        # Parameterized ILIKE on name/email (never interpolated, §6).
        stmt = stmt.where(User.full_name.ilike(like) | User.email.ilike(like))

    # Sorting: whitelisted column + leading '-' for desc; stable id tiebreaker.
    sort = (params.sort or "full_name").strip()
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    col = _USER_SORT_FIELDS.get(key)
    if col is None:
        raise ValidationError(
            f"Unknown sort field '{key}'.", code="invalid_sort_field"
        )
    stmt = stmt.order_by(col.desc() if desc else col.asc(), User.id.asc())

    return paginate(db, stmt, params, serialize=UserListItem.model_validate)


def create_user(
    db: Session, *, actor: User, payload: UserCreateRequest
) -> tuple[User, str | None]:
    """POST /settings/users (P/S create teacher/student). Returns (user, temp_pw).

    Privilege guard (FR-SET-04): assigning a PRIVILEGED role (principal/secretary)
    is Principal-only → 403 role_change_forbidden. Duplicate live email → 409
    duplicate_email. New users always start with must_change_password=true (D5).
    temp_pw is non-None only when WE generated it (echoed once)."""
    if payload.role in _PRIVILEGED_ROLES and actor.role != Role.PRINCIPAL:
        raise Forbidden(
            "Only a Principal may assign the principal or secretary role.",
            code="role_change_forbidden",
        )

    email = payload.email.strip()
    existing = db.scalar(
        select(User.id).where(User.email == email, User.deleted_at.is_(None))
    )
    if existing is not None:
        raise Conflict("A user with this email already exists.", code="duplicate_email")

    if payload.username:
        dup_username = db.scalar(
            select(User.id).where(
                User.username == payload.username.strip(),
                User.deleted_at.is_(None),
            )
        )
        if dup_username is not None:
            raise Conflict(
                "A user with this username already exists.",
                code="duplicate_username",
            )

    supplied = payload.temporary_password
    if supplied:
        plaintext = supplied
        echo: str | None = None  # never echo an admin-supplied secret
    else:
        plaintext = generate_temp_password()
        echo = plaintext

    user = User(
        email=email,
        username=payload.username.strip() if payload.username else None,
        password_hash=hash_password(plaintext),
        role=payload.role,
        full_name=payload.full_name,
        is_active=True,
        must_change_password=True,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(user)
    db.flush()  # assign id for the audit + response

    _audit(
        db,
        actor=actor,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        summary={"role": payload.role.value},
    )
    del plaintext, supplied
    db.commit()
    return user, echo


def update_user(
    db: Session, *, actor: User, target_id: uuid.UUID, payload: UserUpdateRequest
) -> User:
    """PATCH /settings/users/{id}.

    Authz (FR-SET-04, §2.3 privilege guard):
      * role / is_active changes are Principal-only → 403 forbidden otherwise.
      * A Secretary may NOT edit a Principal at all (any field) → 403.
      * Benign edits (full_name/username) are allowed for P/S.
    404 for an unknown/deleted target (no existence leak). Audited on role/active
    changes."""
    target = db.scalar(
        select(User).where(User.id == target_id, User.deleted_at.is_(None))
    )
    if target is None:
        raise NotFound("User not found.", code="not_found")

    # A Secretary may never edit a Principal (privilege guard, §2.3).
    if target.role == Role.PRINCIPAL and actor.role != Role.PRINCIPAL:
        raise Forbidden("You are not permitted to edit this user.")

    changing_role = payload.role is not None and payload.role != target.role
    changing_active = (
        payload.is_active is not None and payload.is_active != target.is_active
    )

    # Privileged mutations are Principal-only.
    if (changing_role or changing_active) and actor.role != Role.PRINCIPAL:
        raise Forbidden(
            "Only a Principal may change a user's role or active status.",
            code="role_change_forbidden",
        )

    # Moving a user INTO a privileged role is Principal-only (already implied by
    # the guard above, but explicit for clarity / future role sets).
    if changing_role and payload.role in _PRIVILEGED_ROLES and actor.role != Role.PRINCIPAL:
        raise Forbidden(
            "Only a Principal may assign the principal or secretary role.",
            code="role_change_forbidden",
        )

    if payload.username is not None and payload.username.strip():
        new_username = payload.username.strip()
        if new_username != (target.username or ""):
            dup = db.scalar(
                select(User.id).where(
                    User.username == new_username,
                    User.id != target.id,
                    User.deleted_at.is_(None),
                )
            )
            if dup is not None:
                raise Conflict(
                    "A user with this username already exists.",
                    code="duplicate_username",
                )
            target.username = new_username

    if payload.full_name is not None:
        target.full_name = payload.full_name
    if changing_role:
        target.role = payload.role  # type: ignore[assignment]
    if changing_active:
        target.is_active = payload.is_active  # type: ignore[assignment]

    target.updated_by = actor.id

    if changing_role or changing_active:
        _audit(
            db,
            actor=actor,
            action="user.update",
            entity_type="user",
            entity_id=target.id,
            summary={
                "role_changed": changing_role,
                "active_changed": changing_active,
                "new_role": payload.role.value if changing_role else None,
                "new_active": payload.is_active if changing_active else None,
            },
        )
    db.commit()
    return target


# ──────────────────────────────────────────────────────────────────────────────
# Per-user account & preferences (§5.11 — FR-SET-05, every role)
# ──────────────────────────────────────────────────────────────────────────────
def _preferences_row(db: Session, user: User) -> UserPreferences:
    """Get or create the 1:1 preferences row (seeded users may lack one)."""
    row = db.get(UserPreferences, user.id)
    if row is None:
        row = UserPreferences(user_id=user.id)
        db.add(row)
        db.flush()
    return row


def get_account(db: Session, user: User) -> CurrentUser:
    """GET /settings/account — own CurrentUser + preferences (reuses auth's
    assembler so the shape is identical to /auth/me)."""
    return build_current_user(db, user)


def update_account(
    db: Session, *, user: User, payload: AccountUpdateRequest
) -> CurrentUser:
    """PATCH /settings/account (self). Updates own contact info + preferences."""
    if payload.full_name is not None:
        user.full_name = payload.full_name

    if payload.preferences is not None:
        prefs = _preferences_row(db, user)
        p = payload.preferences
        if p.locale is not None:
            prefs.locale = p.locale
        if p.theme is not None:
            prefs.theme = p.theme
        if p.date_format is not None:
            prefs.date_format = p.date_format
        if p.default_page_size is not None:
            prefs.default_page_size = p.default_page_size

    db.commit()
    return build_current_user(db, user)

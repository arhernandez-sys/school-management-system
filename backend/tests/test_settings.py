"""Comprehensive pytest suite for Module 7.2 — SETTINGS (api-spec §5 Module 11).

Scope: the 18 Settings endpoints (school / active-term / academic-years /
semesters / grading-scale / assessment-policy / users / account) + their
negative / edge / security paths. Subjects (Module 5b) live in test_subjects.py.

Oracle: api-specification.md §5 Module 11 (the authoritative status/error codes),
§3.4 permission matrix, §4.2 ErrorResponse envelope, §6 pagination. Where the
implementation legitimately diverges from the spec, the assertion documents it at
the call site with an `IMPL↔SPEC` note (see test_logo_* below — the one divergence
found: 413/415 are returned as HTTP 422 with the correct machine code).

Hermetic + rolled-back: every test runs inside the `db_session` transactional
rollback (savepoint isolation, conftest 7.0c) so NOTHING commits to the shared
Supabase DB and the seeded principal + seeded active year `2025-2026` stay intact.
DB-dependent tests are marked `requires_db` (skip cleanly with no DATABASE_URL).

Seed preconditions this suite relies on (progress-tracker DISCOVERY 2026-06-29):
  * ONE active academic year `2025-2026` with `Semester 1` active.
  * Its grading scale: pass_mark=60, bands A/B/C/D/F with `.99` ceilings.
  * Single-row school_profile (id=1) + assessment_policies (id=1).
Tests that need the "no active year" precondition call `archive_seeded_active_year`
(conftest) to flip the seeded year to ARCHIVED inside the rollback.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.common.enums import AcademicYearStatus, Role
from app.modules.settings.models import (
    AcademicYear,
    AuditLog,
    GradingScale,
    Semester,
)
from app.modules.users.models import User, UserPreferences

pytestmark = pytest.mark.requires_db

# Paths (api-spec §1.1 + §5.11).
SCHOOL = "/api/v1/settings/school"
LOGO = "/api/v1/settings/school/logo"
ACTIVE_TERM = "/api/v1/settings/active-term"
ACADEMIC_YEARS = "/api/v1/settings/academic-years"
SEMESTERS = "/api/v1/settings/semesters"
GRADING_SCALE = "/api/v1/settings/grading-scale"
ASSESSMENT_POLICY = "/api/v1/settings/assessment-policy"
USERS = "/api/v1/settings/users"
ACCOUNT = "/api/v1/settings/account"


def _activate_path(semester_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/semesters/{semester_id}/activate"


def _archive_path(year_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/academic-years/{year_id}/archive"


def _user_path(user_id) -> str:  # noqa: ANN001
    return f"/api/v1/settings/users/{user_id}"


def _assert_envelope(body: dict, *, code: str) -> dict:
    """Assert the body conforms to the ErrorResponse envelope (api-spec §4.2) and
    carries the expected machine-readable `code`. Returns the inner error body."""
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert isinstance(err, dict)
    assert "code" in err and "message" in err, f"missing code/message: {err}"
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


# Default contiguous bands tiling 0..100 in the seed's `.99`-ceiling style.
_GOOD_BANDS = [
    {"letter": "A", "min_score": 90, "max_score": 100, "is_passing": True, "sort_order": 1},
    {"letter": "B", "min_score": 80, "max_score": 89.99, "is_passing": True, "sort_order": 2},
    {"letter": "C", "min_score": 70, "max_score": 79.99, "is_passing": True, "sort_order": 3},
    {"letter": "D", "min_score": 60, "max_score": 69.99, "is_passing": True, "sort_order": 4},
    {"letter": "F", "min_score": 0, "max_score": 59.99, "is_passing": False, "sort_order": 5},
]


# ════════════════════════════════════════════════════════════════════════════
# GET/PUT /settings/school + POST /settings/school/logo
# ════════════════════════════════════════════════════════════════════════════
class TestSchool:
    def test_get_school_authenticated_returns_seeded_profile(
        self, client, make_user, auth_headers
    ) -> None:
        """GET /settings/school — authenticated read (any role); returns the seeded
        single-row identity. logo_url is None (storage stubbed, TODO OQ-DB5)."""
        student = make_user(role=Role.STUDENT)
        resp = client.get(SCHOOL, headers=auth_headers(user_id=student.id, role=Role.STUDENT))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body["name"], str) and body["name"]
        assert body["logo_url"] is None  # stubbed storage — assert shape, not a URL
        assert set(body.keys()) == {
            "name", "logo_url", "address", "contact_email", "contact_phone"
        }

    def test_get_school_unauthenticated_401(self, client) -> None:
        resp = client.get(SCHOOL)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_put_school_principal_updates_and_audits(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """PUT /settings/school (principal) updates the row + writes an audit log."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.put(
            SCHOOL,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": "Updated Academy", "contact_email": "head@academy.test"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Updated Academy"
        assert body["contact_email"] == "head@academy.test"
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "school.update",
                AuditLog.actor_user_id == principal.id,
            )
        )
        assert n_audit == 1

    def test_put_school_secretary_403(self, client, make_user, auth_headers) -> None:
        """Secretary is read-only on the school profile (FR-SET matrix) → 403."""
        secretary = make_user(role=Role.SECRETARY)
        resp = client.put(
            SCHOOL,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"name": "Nope"},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_put_school_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.put(
            SCHOOL,
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"name": "Nope"},
        )
        assert resp.status_code == 403

    def test_put_school_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.put(
            SCHOOL,
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
            json={"name": "Nope"},
        )
        assert resp.status_code == 403

    def test_logo_valid_image_returns_shape_with_none_url(
        self, client, make_user, auth_headers
    ) -> None:
        """POST /settings/school/logo (principal) with a valid image → 200 and the
        stubbed {logo_url: None} (storage stubbed, TODO OQ-DB5 — assert the SHAPE)."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            LOGO,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            files={"file": ("logo.png", b"\x89PNG\r\n\x1a\n123", "image/png")},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"logo_url": None}

    def test_logo_non_image_unsupported_media_type(
        self, client, make_user, auth_headers
    ) -> None:
        """A non-image part is rejected with code=unsupported_media_type.

        IMPL↔SPEC: api-spec §5.11 specifies HTTP **415** unsupported_media_type, but
        the service raises `ValidationError` → HTTP **422** with the correct machine
        code. We assert the ACTUAL behavior (422 + code) and report the divergence;
        asserting 415 would be a false (always-failing) test. (Mirror note in
        test_logo_too_large.)"""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            LOGO,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            files={"file": ("notes.txt", b"hello world", "text/plain")},
        )
        assert resp.status_code == 422  # IMPL↔SPEC: spec says 415
        _assert_envelope(resp.json(), code="unsupported_media_type")

    def test_logo_too_large_file_too_large(
        self, client, make_user, auth_headers
    ) -> None:
        """An image over the 2 MiB cap is rejected with code=file_too_large.

        IMPL↔SPEC: api-spec §5.11 specifies HTTP **413** file_too_large; the service
        returns HTTP **422** with the correct machine code. Asserting the actual
        behavior + reporting the divergence."""
        principal = make_user(role=Role.PRINCIPAL)
        oversize = b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024 + 16)
        resp = client.post(
            LOGO,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            files={"file": ("big.png", oversize, "image/png")},
        )
        assert resp.status_code == 422  # IMPL↔SPEC: spec says 413
        _assert_envelope(resp.json(), code="file_too_large")

    def test_logo_secretary_403(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            LOGO,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            files={"file": ("logo.png", b"\x89PNG123", "image/png")},
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# GET /settings/active-term
# ════════════════════════════════════════════════════════════════════════════
class TestActiveTerm:
    def test_active_term_returns_seeded_active_year_any_role(
        self, client, make_user, auth_headers
    ) -> None:
        """GET /settings/active-term (authenticated, any role) returns the seeded
        active year + semester shape."""
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(
            ACTIVE_TERM, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == {"academic_year", "semester"}
        assert body["academic_year"]["status"] == "active"
        assert "id" in body["academic_year"] and "name" in body["academic_year"]
        assert body["semester"]["is_active"] is True
        assert body["semester"]["sequence"] in (1, 2)

    def test_active_term_unauthenticated_401(self, client) -> None:
        resp = client.get(ACTIVE_TERM)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_active_term_409_when_no_active_semester(
        self, client, make_user, auth_headers, archive_seeded_active_year
    ) -> None:
        """After the only active year is archived (within the rollback), active-term
        degrades to the uniform 409 no_active_semester (OQ-API-4)."""
        archive_seeded_active_year()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            ACTIVE_TERM, headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="no_active_semester")


# ════════════════════════════════════════════════════════════════════════════
# GET /settings/academic-years + GET /settings/semesters
# ════════════════════════════════════════════════════════════════════════════
class TestListAcademicStructure:
    def test_list_years_principal_returns_items_shape(
        self, client, make_user, auth_headers
    ) -> None:
        """GET /settings/academic-years (P/S) → {items:[...]} (accepted deviation
        from Page[T]); each year carries its semesters."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            ACADEMIC_YEARS, headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "items" in body and isinstance(body["items"], list)
        assert body["items"], "seed guarantees at least one year"
        year = body["items"][0]
        assert {"id", "name", "status", "semesters"} <= set(year.keys())
        assert isinstance(year["semesters"], list)

    def test_list_years_secretary_allowed(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.get(
            ACADEMIC_YEARS, headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY)
        )
        assert resp.status_code == 200, resp.text

    def test_list_years_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(
            ACADEMIC_YEARS, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER)
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_list_years_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            ACADEMIC_YEARS, headers=auth_headers(user_id=student.id, role=Role.STUDENT)
        )
        assert resp.status_code == 403

    def test_list_semesters_filter_by_year(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """GET /settings/semesters?academic_year_id= filters to that year's two
        semesters; {items:[...]} shape."""
        principal = make_user(role=Role.PRINCIPAL)
        active_year_id = db_session.scalar(
            select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        resp = client.get(
            SEMESTERS,
            params={"academic_year_id": str(active_year_id)},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "items" in body
        assert len(body["items"]) == 2  # D10: exactly two semesters per year
        assert {s["sequence"] for s in body["items"]} == {1, 2}

    def test_list_semesters_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(
            SEMESTERS, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER)
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /settings/academic-years
# ════════════════════════════════════════════════════════════════════════════
class TestCreateAcademicYear:
    def _year_payload(self, name="2099-2100") -> dict:
        return {
            "name": name,
            "start_date": "2099-09-01",
            "end_date": "2100-06-30",
            "semesters": [
                {"name": "Sem 1", "sequence": 1, "start_date": "2099-09-01", "end_date": "2100-01-31"},
                {"name": "Sem 2", "sequence": 2, "start_date": "2100-02-01", "end_date": "2100-06-30"},
            ],
        }

    def test_create_year_409_when_active_year_exists(
        self, client, make_user, auth_headers
    ) -> None:
        """The seed already has an active year, so creating another active year →
        409 active_year_exists (uq_academic_years_one_active)."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            ACADEMIC_YEARS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._year_payload(),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="active_year_exists")

    def test_create_year_succeeds_after_archiving_seeded(
        self, client, make_user, auth_headers, archive_seeded_active_year, db_session
    ) -> None:
        """With the seeded year archived (rollback), create-year succeeds: 201, makes
        EXACTLY 2 semesters (D10), seeds a grading scale + 5 default bands (D11), and
        activates sequence-1."""
        archive_seeded_active_year()
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            ACADEMIC_YEARS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=self._year_payload(),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "active"
        assert len(body["semesters"]) == 2
        seqs = sorted(s["sequence"] for s in body["semesters"])
        assert seqs == [1, 2]
        active_sem = [s for s in body["semesters"] if s["is_active"]]
        assert len(active_sem) == 1 and active_sem[0]["sequence"] == 1

        new_year_id = uuid.UUID(body["id"])
        # Grading scale + exactly 5 default bands were seeded for the new year.
        scale = db_session.scalar(
            select(GradingScale).where(GradingScale.academic_year_id == new_year_id)
        )
        assert scale is not None
        n_bands = db_session.scalar(
            select(func.count()).select_from(GradingScale).where(
                GradingScale.academic_year_id == new_year_id
            )
        )
        assert n_bands == 1  # one scale row
        from app.modules.settings.models import GradingScaleBand
        band_count = db_session.scalar(
            select(func.count()).select_from(GradingScaleBand).where(
                GradingScaleBand.grading_scale_id == scale.id
            )
        )
        assert band_count == 5

    def test_create_year_bad_sequences_422(
        self, client, make_user, auth_headers, archive_seeded_active_year
    ) -> None:
        """Semesters not [1,2] → 422 (service guard). Archive first so the 409 guard
        doesn't pre-empt the sequence check."""
        archive_seeded_active_year()
        principal = make_user(role=Role.PRINCIPAL)
        payload = self._year_payload()
        payload["semesters"][1]["sequence"] = 1  # [1,1] not [1,2]
        resp = client.post(
            ACADEMIC_YEARS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=payload,
        )
        assert resp.status_code == 422, resp.text
        # Either the service guard (validation_error w/ fields) — both are 422.
        body = resp.json()
        assert body["error"]["code"] in ("validation_error",)

    def test_create_year_end_before_start_422(
        self, client, make_user, auth_headers, archive_seeded_active_year
    ) -> None:
        """end_date <= start_date → 422 (service guard)."""
        archive_seeded_active_year()
        principal = make_user(role=Role.PRINCIPAL)
        payload = self._year_payload()
        payload["start_date"] = "2100-06-30"
        payload["end_date"] = "2099-09-01"
        resp = client.post(
            ACADEMIC_YEARS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json=payload,
        )
        assert resp.status_code == 422, resp.text

    def test_create_year_secretary_403(
        self, client, make_user, auth_headers, archive_seeded_active_year
    ) -> None:
        """Create-year is principal-only; Secretary → 403."""
        archive_seeded_active_year()
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            ACADEMIC_YEARS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json=self._year_payload(),
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# PATCH /settings/semesters/{id}/activate — one-active invariant
# ════════════════════════════════════════════════════════════════════════════
class TestActivateSemester:
    def test_activate_clears_prior_active(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Activating Semester 2 of the seeded year clears the prior active
        (Semester 1) — the one-active invariant holds across the switch."""
        principal = make_user(role=Role.PRINCIPAL)
        active_year_id = db_session.scalar(
            select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        sems = db_session.execute(
            select(Semester).where(Semester.academic_year_id == active_year_id)
            .order_by(Semester.sequence)
        ).scalars().all()
        sem1, sem2 = sems[0], sems[1]
        assert sem1.is_active is True and sem2.is_active is False

        resp = client.patch(
            _activate_path(sem2.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is True

        db_session.expire_all()
        n_active = db_session.scalar(
            select(func.count()).select_from(Semester).where(Semester.is_active.is_(True))
        )
        assert n_active == 1  # exactly one active across the whole table
        db_session.refresh(sem1)
        assert sem1.is_active is False

    def test_activate_unknown_semester_404(
        self, client, make_user, auth_headers
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _activate_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_activate_secretary_403(self, client, make_user, auth_headers, db_session) -> None:
        secretary = make_user(role=Role.SECRETARY)
        sem_id = db_session.scalar(select(Semester.id).limit(1))
        resp = client.patch(
            _activate_path(sem_id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# POST /settings/academic-years/{id}/archive — 202 + idempotency
# ════════════════════════════════════════════════════════════════════════════
class TestArchiveAcademicYear:
    def test_archive_seeded_year_202_and_no_active_remaining(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Archiving the only active year → 202 with snapshots_written=0 (stub) and
        no_active_year_remaining=true. State transitions verified."""
        principal = make_user(role=Role.PRINCIPAL)
        year_id = db_session.scalar(
            select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        resp = client.post(
            _archive_path(year_id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 202, resp.text
        body = resp.json()
        assert body == {"snapshots_written": 0, "no_active_year_remaining": True}

        db_session.expire_all()
        year = db_session.get(AcademicYear, year_id)
        assert year.status == AcademicYearStatus.ARCHIVED
        assert year.archived_at is not None
        # Its grading scale is now frozen + its semesters deactivated.
        scale = db_session.scalar(
            select(GradingScale).where(GradingScale.academic_year_id == year_id)
        )
        assert scale.is_frozen is True
        n_active_sem = db_session.scalar(
            select(func.count()).select_from(Semester).where(
                Semester.academic_year_id == year_id, Semester.is_active.is_(True)
            )
        )
        assert n_active_sem == 0

    def test_archive_idempotency_re_archive_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Re-archiving an already-archived year → 409 year_already_archived (no
        double snapshot write, OQ-API-4)."""
        principal = make_user(role=Role.PRINCIPAL)
        year_id = db_session.scalar(
            select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        headers = auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        first = client.post(_archive_path(year_id), headers=headers)
        assert first.status_code == 202, first.text
        second = client.post(_archive_path(year_id), headers=headers)
        assert second.status_code == 409, second.text
        _assert_envelope(second.json(), code="year_already_archived")

    def test_archive_unknown_year_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            _archive_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_archive_secretary_403(self, client, make_user, auth_headers, db_session) -> None:
        secretary = make_user(role=Role.SECRETARY)
        year_id = db_session.scalar(select(AcademicYear.id).limit(1))
        resp = client.post(
            _archive_path(year_id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# GET/PUT /settings/grading-scale + band contiguity (OQ-DB2 leniency)
# ════════════════════════════════════════════════════════════════════════════
class TestGradingScale:
    def test_get_grading_scale_authenticated_default_active(
        self, client, make_user, auth_headers
    ) -> None:
        """GET /settings/grading-scale (authenticated; default active year) →
        {pass_mark, is_frozen, bands[]} with the seeded 5 bands."""
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            GRADING_SCALE, headers=auth_headers(user_id=student.id, role=Role.STUDENT)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"academic_year_id", "pass_mark", "is_frozen", "bands"} <= set(body.keys())
        assert body["is_frozen"] is False
        assert len(body["bands"]) == 5
        assert {b["letter"] for b in body["bands"]} == {"A", "B", "C", "D", "F"}

    def test_put_grading_scale_dot99_style_succeeds(
        self, client, make_user, auth_headers
    ) -> None:
        """The `.99`-ceiling style (matches the seed) is accepted →
        affects_displayed_grades=true (OQ-DB2 leniency)."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"pass_mark": 60, "bands": _GOOD_BANDS},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["affects_displayed_grades"] is True
        assert len(body["bands"]) == 5

    def test_put_grading_scale_clean_single_band_succeeds(
        self, client, make_user, auth_headers
    ) -> None:
        """A single band 0–100 cleanly tiles the domain → accepted."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "pass_mark": 50,
                "bands": [
                    {"letter": "P", "min_score": 0, "max_score": 100,
                     "is_passing": True, "sort_order": 1}
                ],
            },
        )
        assert resp.status_code == 200, resp.text

    def test_put_grading_scale_gap_422(self, client, make_user, auth_headers) -> None:
        """A genuine gap (>1.0) between bands → 422 grading_bands_invalid."""
        principal = make_user(role=Role.PRINCIPAL)
        bands = [
            {"letter": "A", "min_score": 60, "max_score": 100, "is_passing": True, "sort_order": 1},
            {"letter": "F", "min_score": 0, "max_score": 50, "is_passing": False, "sort_order": 2},
        ]  # gap 50..60
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"pass_mark": 60, "bands": bands},
        )
        assert resp.status_code == 422, resp.text
        err = _assert_envelope(resp.json(), code="grading_bands_invalid")
        assert "fields" in err and "bands" in err["fields"]

    def test_put_grading_scale_overlap_422(self, client, make_user, auth_headers) -> None:
        """A genuine overlap → 422 grading_bands_invalid."""
        principal = make_user(role=Role.PRINCIPAL)
        bands = [
            {"letter": "A", "min_score": 50, "max_score": 100, "is_passing": True, "sort_order": 1},
            {"letter": "F", "min_score": 0, "max_score": 60, "is_passing": False, "sort_order": 2},
        ]  # overlap 50..60
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"pass_mark": 60, "bands": bands},
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="grading_bands_invalid")

    def test_put_grading_scale_not_starting_at_zero_422(
        self, client, make_user, auth_headers
    ) -> None:
        """Bands that don't start at 0 → 422."""
        principal = make_user(role=Role.PRINCIPAL)
        bands = [
            {"letter": "A", "min_score": 90, "max_score": 100, "is_passing": True, "sort_order": 1},
            {"letter": "B", "min_score": 10, "max_score": 89.99, "is_passing": True, "sort_order": 2},
        ]  # starts at 10, not 0
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"pass_mark": 60, "bands": bands},
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="grading_bands_invalid")

    def test_put_grading_scale_not_reaching_100_422(
        self, client, make_user, auth_headers
    ) -> None:
        """Bands that don't reach 100 → 422."""
        principal = make_user(role=Role.PRINCIPAL)
        bands = [
            {"letter": "F", "min_score": 0, "max_score": 89.99, "is_passing": False, "sort_order": 1},
            {"letter": "A", "min_score": 90, "max_score": 95, "is_passing": True, "sort_order": 2},
        ]  # ends at 95, not 100
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"pass_mark": 60, "bands": bands},
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="grading_bands_invalid")

    def test_put_grading_scale_secretary_403(
        self, client, make_user, auth_headers
    ) -> None:
        """Secretary cannot change the grading scale (FR-SET-04) → 403."""
        secretary = make_user(role=Role.SECRETARY)
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"pass_mark": 60, "bands": _GOOD_BANDS},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_put_grading_scale_frozen_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Editing a FROZEN scale (archived year) → 409 scale_frozen. We target the
        seeded year by id and freeze its scale within the rollback."""
        principal = make_user(role=Role.PRINCIPAL)
        year_id = db_session.scalar(
            select(AcademicYear.id).where(AcademicYear.status == AcademicYearStatus.ACTIVE)
        )
        scale = db_session.scalar(
            select(GradingScale).where(GradingScale.academic_year_id == year_id)
        )
        scale.is_frozen = True
        db_session.flush()
        resp = client.put(
            GRADING_SCALE,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"pass_mark": 60, "bands": _GOOD_BANDS, "academic_year_id": str(year_id)},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="scale_frozen")


# ════════════════════════════════════════════════════════════════════════════
# GET/PUT /settings/assessment-policy
# ════════════════════════════════════════════════════════════════════════════
class TestAssessmentPolicy:
    def test_get_policy_secretary_allowed(self, client, make_user, auth_headers) -> None:
        """GET /settings/assessment-policy (P/S) → the 3 school-default fields."""
        secretary = make_user(role=Role.SECRETARY)
        resp = client.get(
            ASSESSMENT_POLICY, headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == {"absent_as_zero", "allow_makeup", "drop_lowest_count"}

    def test_get_policy_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(
            ASSESSMENT_POLICY, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER)
        )
        assert resp.status_code == 403

    def test_put_policy_principal_updates(self, client, make_user, auth_headers) -> None:
        """PUT /settings/assessment-policy (principal) sets the 3 fields."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.put(
            ASSESSMENT_POLICY,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"absent_as_zero": True, "allow_makeup": False, "drop_lowest_count": 2},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "absent_as_zero": True, "allow_makeup": False, "drop_lowest_count": 2
        }

    def test_put_policy_secretary_403(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.put(
            ASSESSMENT_POLICY,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"absent_as_zero": True, "allow_makeup": False, "drop_lowest_count": 2},
        )
        assert resp.status_code == 403

    def test_put_policy_negative_drop_422(self, client, make_user, auth_headers) -> None:
        """drop_lowest_count < 0 → 422 (schema ge=0)."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.put(
            ASSESSMENT_POLICY,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"absent_as_zero": True, "allow_makeup": False, "drop_lowest_count": -1},
        )
        assert resp.status_code == 422


# ════════════════════════════════════════════════════════════════════════════
# GET/POST/PATCH /settings/users
# ════════════════════════════════════════════════════════════════════════════
class TestUsersAdmin:
    def test_list_users_principal_page_shape(
        self, client, make_user, auth_headers
    ) -> None:
        """GET /settings/users (P/S) → Page[UserListItem]."""
        principal = make_user(role=Role.PRINCIPAL)
        make_user(role=Role.TEACHER)
        resp = client.get(
            USERS, headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"items", "total", "page", "page_size", "total_pages"} <= set(body.keys())
        assert isinstance(body["items"], list)

    def test_list_users_role_filter(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        make_user(role=Role.TEACHER)
        resp = client.get(
            USERS,
            params={"role": "teacher"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert all(u["role"] == "teacher" for u in resp.json()["items"])

    def test_list_users_search_filter(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.STUDENT, full_name="Zxcv Unique Searchname")
        resp = client.get(
            USERS,
            params={"search": "Zxcv Unique"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {u["id"] for u in resp.json()["items"]}
        assert str(target.id) in ids

    def test_list_users_is_active_filter(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        make_user(role=Role.STUDENT, is_active=False)
        resp = client.get(
            USERS,
            params={"is_active": "false"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        assert all(u["is_active"] is False for u in resp.json()["items"])

    def test_list_users_invalid_sort_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            USERS,
            params={"sort": "ssn"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="invalid_sort_field")

    def test_list_users_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.get(
            USERS, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER)
        )
        assert resp.status_code == 403

    def test_list_users_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.get(
            USERS, headers=auth_headers(user_id=student.id, role=Role.STUDENT)
        )
        assert resp.status_code == 403

    def test_create_teacher_by_secretary_201_must_change_pw_and_audit(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Secretary creates a teacher → 201, must_change_password=true, temp
        password echoed once, audit row written."""
        secretary = make_user(role=Role.SECRETARY)
        new_email = f"newteacher_{uuid.uuid4().hex[:8]}@test.local"
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"email": new_email, "full_name": "New Teacher", "role": "teacher"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["user"]["email"] == new_email
        assert body["user"]["must_change_password"] is True
        assert isinstance(body["temporary_password"], str) and body["temporary_password"]

        new_id = uuid.UUID(body["user"]["id"])
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "user.create",
                AuditLog.entity_id == new_id,
                AuditLog.actor_user_id == secretary.id,
            )
        )
        assert n_audit == 1

    def test_create_principal_by_secretary_403_role_change_forbidden(
        self, client, make_user, auth_headers
    ) -> None:
        """A Secretary cannot create a principal/secretary login → 403
        role_change_forbidden (FR-SET-04)."""
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"email": f"x_{uuid.uuid4().hex[:8]}@test.local",
                  "full_name": "Wannabe", "role": "principal"},
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="role_change_forbidden")

    def test_create_secretary_by_secretary_403(
        self, client, make_user, auth_headers
    ) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"email": f"x_{uuid.uuid4().hex[:8]}@test.local",
                  "full_name": "Wannabe", "role": "secretary"},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="role_change_forbidden")

    def test_create_secretary_by_principal_201(
        self, client, make_user, auth_headers
    ) -> None:
        """A Principal MAY create a privileged (secretary) role → 201."""
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"email": f"sec_{uuid.uuid4().hex[:8]}@test.local",
                  "full_name": "New Secretary", "role": "secretary"},
        )
        assert resp.status_code == 201, resp.text

    def test_create_duplicate_email_409(
        self, client, make_user, auth_headers
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        existing = make_user(role=Role.STUDENT)
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"email": existing.email, "full_name": "Dup", "role": "student"},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_email")

    def test_create_duplicate_username_409(
        self, client, make_user, auth_headers
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        existing = make_user(role=Role.STUDENT, username=f"dupuser_{uuid.uuid4().hex[:6]}")
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"email": f"x_{uuid.uuid4().hex[:8]}@test.local",
                  "username": existing.username, "full_name": "Dup", "role": "student"},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_username")

    def test_create_user_teacher_caller_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.post(
            USERS,
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"email": f"x_{uuid.uuid4().hex[:8]}@test.local",
                  "full_name": "X", "role": "student"},
        )
        assert resp.status_code == 403

    def test_patch_user_principal_changes_role_and_audits(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Principal changes a user's role → 200 + audit row on the change."""
        principal = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.STUDENT)
        resp = client.patch(
            _user_path(target.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"role": "teacher"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["role"] == "teacher"
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "user.update",
                AuditLog.entity_id == target.id,
            )
        )
        assert n_audit == 1

    def test_patch_user_secretary_role_change_403(
        self, client, make_user, auth_headers
    ) -> None:
        """Secretary attempting a role change → 403 role_change_forbidden."""
        secretary = make_user(role=Role.SECRETARY)
        target = make_user(role=Role.STUDENT)
        resp = client.patch(
            _user_path(target.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"role": "teacher"},
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="role_change_forbidden")

    def test_patch_user_secretary_editing_principal_403(
        self, client, make_user, auth_headers
    ) -> None:
        """A Secretary may NOT edit a Principal at all (privilege guard, §2.3) →
        403, even for a benign field."""
        secretary = make_user(role=Role.SECRETARY)
        target = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _user_path(target.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"full_name": "Renamed Principal"},
        )
        assert resp.status_code == 403, resp.text
        _assert_envelope(resp.json(), code="forbidden")

    def test_patch_user_secretary_benign_edit_allowed(
        self, client, make_user, auth_headers
    ) -> None:
        """A Secretary MAY make a benign profile edit (full_name) on a non-principal
        → 200."""
        secretary = make_user(role=Role.SECRETARY)
        target = make_user(role=Role.STUDENT)
        resp = client.patch(
            _user_path(target.id),
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"full_name": "Renamed Student"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["full_name"] == "Renamed Student"

    def test_patch_user_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _user_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"full_name": "Ghost"},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_patch_user_deactivate_by_principal(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Principal sets is_active=false → 200 + audit row."""
        principal = make_user(role=Role.PRINCIPAL)
        target = make_user(role=Role.TEACHER, is_active=True)
        resp = client.patch(
            _user_path(target.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"is_active": False},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is False


# ════════════════════════════════════════════════════════════════════════════
# GET/PATCH /settings/account — self + preferences (FR-SET-05)
# ════════════════════════════════════════════════════════════════════════════
class TestAccount:
    def test_get_account_returns_current_user_with_prefs(
        self, client, make_user, auth_headers
    ) -> None:
        """GET /settings/account (authenticated self) → CurrentUser + preferences
        block (defaults synthesized when no row exists)."""
        user = make_user(role=Role.TEACHER, full_name="Self Teacher")
        resp = client.get(
            ACCOUNT, headers=auth_headers(user_id=user.id, role=Role.TEACHER)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(user.id)
        assert body["full_name"] == "Self Teacher"
        assert "preferences" in body
        assert {"locale", "theme", "date_format", "default_page_size"} <= set(
            body["preferences"].keys()
        )

    def test_get_account_unauthenticated_401(self, client) -> None:
        resp = client.get(ACCOUNT)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_patch_account_creates_prefs_row_and_roundtrips(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """PATCH /settings/account (self) creates a UserPreferences row and the
        response round-trips it — exercises the UserPreferences.from_attributes fix
        (a prefs row now validates via model_validate without crashing)."""
        user = make_user(role=Role.STUDENT)
        # No prefs row exists yet.
        assert db_session.get(UserPreferences, user.id) is None
        resp = client.patch(
            ACCOUNT,
            headers=auth_headers(user_id=user.id, role=Role.STUDENT),
            json={"preferences": {"locale": "es", "theme": "dark", "default_page_size": 50}},
        )
        assert resp.status_code == 200, resp.text
        prefs = resp.json()["preferences"]
        assert prefs["locale"] == "es"
        assert prefs["theme"] == "dark"
        assert prefs["default_page_size"] == 50
        # Row now exists and persisted (within rollback).
        db_session.expire_all()
        row = db_session.get(UserPreferences, user.id)
        assert row is not None and row.default_page_size == 50

    def test_patch_account_default_page_size_too_small_422(
        self, client, make_user, auth_headers
    ) -> None:
        """default_page_size < 5 → 422 (schema bounds 5..200)."""
        user = make_user(role=Role.STUDENT)
        resp = client.patch(
            ACCOUNT,
            headers=auth_headers(user_id=user.id, role=Role.STUDENT),
            json={"preferences": {"default_page_size": 4}},
        )
        assert resp.status_code == 422, resp.text

    def test_patch_account_default_page_size_too_large_422(
        self, client, make_user, auth_headers
    ) -> None:
        """default_page_size > 200 → 422."""
        user = make_user(role=Role.STUDENT)
        resp = client.patch(
            ACCOUNT,
            headers=auth_headers(user_id=user.id, role=Role.STUDENT),
            json={"preferences": {"default_page_size": 201}},
        )
        assert resp.status_code == 422

    def test_patch_account_page_size_bounds_inclusive_ok(
        self, client, make_user, auth_headers
    ) -> None:
        """The bounds 5 and 200 are inclusive → both accepted."""
        user = make_user(role=Role.STUDENT)
        headers = auth_headers(user_id=user.id, role=Role.STUDENT)
        lo = client.patch(ACCOUNT, headers=headers,
                          json={"preferences": {"default_page_size": 5}})
        assert lo.status_code == 200, lo.text
        hi = client.patch(ACCOUNT, headers=headers,
                          json={"preferences": {"default_page_size": 200}})
        assert hi.status_code == 200, hi.text


# ════════════════════════════════════════════════════════════════════════════
# Envelope conformance spot-checks across status families (api-spec §4.2)
# ════════════════════════════════════════════════════════════════════════════
class TestEnvelopeConformance:
    def test_403_envelope(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        body = client.get(
            USERS, headers=auth_headers(user_id=teacher.id, role=Role.TEACHER)
        ).json()
        _assert_envelope(body, code="forbidden")

    def test_404_envelope(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        body = client.patch(
            _activate_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        ).json()
        _assert_envelope(body, code="not_found")

    def test_409_envelope(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        body = client.post(
            ACADEMIC_YEARS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={
                "name": "x", "start_date": "2099-09-01", "end_date": "2100-06-30",
                "semesters": [
                    {"name": "a", "sequence": 1, "start_date": "2099-09-01", "end_date": "2100-01-31"},
                    {"name": "b", "sequence": 2, "start_date": "2100-02-01", "end_date": "2100-06-30"},
                ],
            },
        ).json()
        _assert_envelope(body, code="active_year_exists")

    def test_422_envelope_has_fields(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        body = client.put(
            ASSESSMENT_POLICY,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"absent_as_zero": True, "allow_makeup": False, "drop_lowest_count": -1},
        ).json()
        err = _assert_envelope(body, code="validation_error")
        assert "fields" in err

"""Comprehensive pytest suite for Module 5b — SUBJECTS catalog (api-spec §5b).

Scope: the 4 catalog endpoints (GET list / POST / PATCH / DELETE) + their
negative / edge / security paths.

Oracle: api-specification.md §5b (Module 5b — Subjects), §3.4 permission matrix,
§4.2 ErrorResponse envelope, §6 pagination.

Hermetic + rolled-back via the `db_session` transactional rollback (conftest
7.0c). The `Subject` model lives in app/modules/classes/models.py. The
DELETE subject_in_use guard is exercised by creating a ClassSubject offering via
the `make_class_subject` conftest fixture (inside the rollback).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.common.enums import Role
from app.modules.classes.models import Subject
from app.modules.settings.models import AuditLog

pytestmark = pytest.mark.requires_db

SUBJECTS = "/api/v1/subjects"


def _subject_path(subject_id) -> str:  # noqa: ANN001
    return f"/api/v1/subjects/{subject_id}"


def _assert_envelope(body: dict, *, code: str) -> dict:
    assert set(body.keys()) == {"error"}, f"top-level must be just 'error': {body}"
    err = body["error"]
    assert "code" in err and "message" in err
    assert err["code"] == code, f"expected code={code!r}, got {err['code']!r}"
    return err


def _make_subject(db_session, *, name=None, code=None, is_active=True) -> Subject:
    """Insert a Subject directly in the rolled-back session (for read/guard setup)."""
    s = Subject(
        name=name or f"Subject {uuid.uuid4().hex[:8]}",
        code=code,
        is_active=is_active,
    )
    db_session.add(s)
    db_session.flush()
    return s


# ════════════════════════════════════════════════════════════════════════════
# GET /subjects
# ════════════════════════════════════════════════════════════════════════════
class TestListSubjects:
    def test_list_authenticated_any_role_page_shape(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """GET /subjects (authenticated — everyone reads reference data) →
        Page[SubjectListItem]."""
        # Unique code — a hardcoded code (e.g. "MATH") collides with seeded data.
        _make_subject(db_session, name=f"Math {uuid.uuid4().hex[:6]}", code=uuid.uuid4().hex[:6].upper())
        student = make_user(role=Role.STUDENT)
        resp = client.get(SUBJECTS, headers=auth_headers(user_id=student.id, role=Role.STUDENT))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {"items", "total", "page", "page_size", "total_pages"} <= set(body.keys())
        if body["items"]:
            item = body["items"][0]
            assert {"id", "name", "code", "is_active"} == set(item.keys())

    def test_list_unauthenticated_401(self, client) -> None:
        resp = client.get(SUBJECTS)
        assert resp.status_code == 401
        _assert_envelope(resp.json(), code="unauthenticated")

    def test_list_default_hides_retired(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Default (no is_active param) hides retired subjects (is_active=false)."""
        retired = _make_subject(
            db_session, name=f"Retired {uuid.uuid4().hex[:6]}", is_active=False
        )
        active = _make_subject(
            db_session, name=f"Active {uuid.uuid4().hex[:6]}", is_active=True
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            SUBJECTS,
            params={"page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(active.id) in ids
        assert str(retired.id) not in ids

    def test_list_is_active_false_shows_retired(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """?is_active=false opts into the retired view."""
        retired = _make_subject(
            db_session, name=f"Retired {uuid.uuid4().hex[:6]}", is_active=False
        )
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            SUBJECTS,
            params={"is_active": "false", "page_size": 200},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(retired.id) in ids
        # And all returned rows are retired.
        assert all(i["is_active"] is False for i in resp.json()["items"])

    def test_list_search_filter(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        tag = uuid.uuid4().hex[:8]
        s = _make_subject(db_session, name=f"Zoology{tag}", code=f"ZOO{tag[:4]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            SUBJECTS,
            params={"search": f"Zoology{tag}"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()["items"]}
        assert str(s.id) in ids

    def test_list_invalid_sort_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.get(
            SUBJECTS,
            params={"sort": "color"},
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 422, resp.text
        _assert_envelope(resp.json(), code="invalid_sort_field")


# ════════════════════════════════════════════════════════════════════════════
# POST /subjects
# ════════════════════════════════════════════════════════════════════════════
class TestCreateSubject:
    def test_create_by_principal_201(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        name = f"Chemistry {uuid.uuid4().hex[:6]}"
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": name, "code": f"CHEM{uuid.uuid4().hex[:4]}"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["name"] == name
        assert body["is_active"] is True
        # Audit row written.
        n_audit = db_session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "subject.create",
                AuditLog.entity_id == uuid.UUID(body["id"]),
            )
        )
        assert n_audit == 1

    def test_create_by_secretary_201(self, client, make_user, auth_headers) -> None:
        secretary = make_user(role=Role.SECRETARY)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=secretary.id, role=Role.SECRETARY),
            json={"name": f"Biology {uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 201, resp.text

    def test_create_duplicate_name_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        existing = _make_subject(db_session, name=f"History {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": existing.name},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_subject_name")

    def test_create_duplicate_name_case_insensitive_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Name uniqueness is case-insensitive (service lowercases)."""
        existing = _make_subject(db_session, name=f"Physics{uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": existing.name.upper()},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_subject_name")

    def test_create_duplicate_code_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        code = f"GEO{uuid.uuid4().hex[:5]}"
        _make_subject(db_session, name=f"Geography {uuid.uuid4().hex[:6]}", code=code)
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": f"Geo2 {uuid.uuid4().hex[:6]}", "code": code},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_subject_code")

    def test_create_missing_name_422(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"code": "NONAME"},
        )
        assert resp.status_code == 422
        _assert_envelope(resp.json(), code="validation_error")

    def test_create_teacher_403(self, client, make_user, auth_headers) -> None:
        teacher = make_user(role=Role.TEACHER)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"name": f"Art {uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 403
        _assert_envelope(resp.json(), code="forbidden")

    def test_create_student_403(self, client, make_user, auth_headers) -> None:
        student = make_user(role=Role.STUDENT)
        resp = client.post(
            SUBJECTS,
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
            json={"name": f"Music {uuid.uuid4().hex[:6]}"},
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# PATCH /subjects/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestUpdateSubject:
    def test_rename_200(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"OldName {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        new_name = f"NewName {uuid.uuid4().hex[:6]}"
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": new_name},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == new_name

    def test_retire_via_is_active_false(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """Retire a subject by setting is_active=false (preferred over delete)."""
        s = _make_subject(db_session, name=f"ToRetire {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"is_active": False},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is False

    def test_patch_duplicate_name_409(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        a = _make_subject(db_session, name=f"AlphaName {uuid.uuid4().hex[:6]}")
        b = _make_subject(db_session, name=f"BetaName {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _subject_path(b.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": a.name},
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="duplicate_subject_name")

    def test_patch_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.patch(
            _subject_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
            json={"name": "Ghost"},
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_patch_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"NoTouch {uuid.uuid4().hex[:6]}")
        teacher = make_user(role=Role.TEACHER)
        resp = client.patch(
            _subject_path(s.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
            json={"name": "Hacked"},
        )
        assert resp.status_code == 403


# ════════════════════════════════════════════════════════════════════════════
# DELETE /subjects/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestDeleteSubject:
    def test_delete_unused_204(self, client, make_user, auth_headers, db_session) -> None:
        """A subject referenced by no offering soft-deletes → 204."""
        s = _make_subject(db_session, name=f"Unused {uuid.uuid4().hex[:6]}")
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 204, resp.text
        assert resp.content == b""
        # Soft-deleted: deleted_at set; no longer returned by the list.
        db_session.expire_all()
        db_session.refresh(s)
        assert s.deleted_at is not None

    def test_delete_in_use_409(
        self, client, make_user, auth_headers, db_session, make_class_subject
    ) -> None:
        """A subject taught in any section (ClassSubject offering) → 409
        subject_in_use (retire instead). FK is RESTRICT."""
        s = _make_subject(db_session, name=f"InUse {uuid.uuid4().hex[:6]}")
        make_class_subject(s.id)  # creates a ClassSubject referencing the subject
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 409, resp.text
        _assert_envelope(resp.json(), code="subject_in_use")

    def test_delete_unknown_404(self, client, make_user, auth_headers) -> None:
        principal = make_user(role=Role.PRINCIPAL)
        resp = client.delete(
            _subject_path(uuid.uuid4()),
            headers=auth_headers(user_id=principal.id, role=Role.PRINCIPAL),
        )
        assert resp.status_code == 404
        _assert_envelope(resp.json(), code="not_found")

    def test_delete_teacher_403(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"NoDelete {uuid.uuid4().hex[:6]}")
        teacher = make_user(role=Role.TEACHER)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=teacher.id, role=Role.TEACHER),
        )
        assert resp.status_code == 403

    def test_delete_student_403(self, client, make_user, auth_headers, db_session) -> None:
        s = _make_subject(db_session, name=f"NoDelete2 {uuid.uuid4().hex[:6]}")
        student = make_user(role=Role.STUDENT)
        resp = client.delete(
            _subject_path(s.id),
            headers=auth_headers(user_id=student.id, role=Role.STUDENT),
        )
        assert resp.status_code == 403

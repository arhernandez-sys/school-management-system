"""Section F after enrolment — `GET/PUT /students/{id}/documents`.

The client asked for it: papers keep arriving after an applicant is accepted and enrolled,
and the application's own `PUT /applications/{id}/documents` is closed once it is
decided. The student record opens ONLY the checklist, on the same rows.
"""

from __future__ import annotations

import pytest

from app.modules.students.models import StudentProfile
from tests.conftest import admit, split_name
from tests.test_admissions import A, _assert_envelope, _file, graph  # noqa: F401

pytestmark = pytest.mark.requires_db

S = "/api/v1/students"


def _enrolled(client, graph):
    app_id = _file(client, graph, submit=True).json()["id"]
    client.put(
        f"{A}/{app_id}/documents",
        headers=graph.S,
        json={"items": [{"document_type": "passport_photo", "received": True}]},
    )
    r = admit(client, graph.S, app_id)
    assert r.status_code == 201, r.text
    return app_id, r.json()["student_id"]


def test_the_application_checklist_is_closed_once_decided(client, graph) -> None:
    app_id, _sid = _enrolled(client, graph)
    r = client.put(f"{A}/{app_id}/documents", headers=graph.S, json={"items": []})
    assert r.status_code == 409
    _assert_envelope(r.json(), code="application_decided")


def test_the_student_reads_the_applications_checklist(client, graph) -> None:
    app_id, sid = _enrolled(client, graph)
    body = client.get(f"{S}/{sid}/documents", headers=graph.S).json()
    assert body["application_id"] == app_id
    assert {d["document_type"]: d["received"] for d in body["items"]} == {"passport_photo": True}


def test_papers_can_be_ticked_after_enrolment(client, graph) -> None:
    app_id, sid = _enrolled(client, graph)
    current = client.get(f"{S}/{sid}/documents", headers=graph.P).json()["items"]
    r = client.put(
        f"{S}/{sid}/documents",
        headers=graph.P,
        json={"items": [*current, {"document_type": "hs_diploma", "received": True}]},
    )
    assert r.status_code == 200, r.text
    got = {d["document_type"]: d["received"] for d in r.json()["items"]}
    assert got == {"passport_photo": True, "hs_diploma": True}
    # Same rows the application shows — one checklist, not a copy.
    app = client.get(f"{A}/{app_id}", headers=graph.S).json()
    assert {d["document_type"] for d in app["documents"]} == {"passport_photo", "hs_diploma"}


def test_only_the_dean_and_registrar(client, graph) -> None:
    _app_id, sid = _enrolled(client, graph)
    for headers in (graph.T, graph.U):
        assert client.get(f"{S}/{sid}/documents", headers=headers).status_code == 403
        assert client.put(f"{S}/{sid}/documents", headers=headers, json={"items": []}).status_code == 403


def test_a_student_without_an_application(client, graph, db_session) -> None:
    from datetime import date

    s = StudentProfile(
        student_number=f"DOC{graph.tag[:6]}", **split_name("Paper Registered"),
        date_of_birth=date(2004, 1, 1), enrollment_date=date(2025, 9, 1), status="Active",
    )
    db_session.add(s)
    db_session.flush()
    body = client.get(f"{S}/{s.id}/documents", headers=graph.S).json()
    assert body == {"application_id": None, "items": []}
    r = client.put(f"{S}/{s.id}/documents", headers=graph.S, json={"items": []})
    assert r.status_code == 409
    _assert_envelope(r.json(), code="no_application")


def test_unknown_student_404(client, graph) -> None:
    import uuid

    assert client.get(f"{S}/{uuid.uuid4()}/documents", headers=graph.S).status_code == 404

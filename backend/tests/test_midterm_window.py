"""The mid-term grading window on a semester (D32 Phase 1, brief §2).

A Dean sets `semesters.midterm_submission_start` / `midterm_submission_end` alongside
the existing (now END-TERM) `grade_submission_deadline`. Those two datetimes are what
Phase 2's revision rules and Phase 4's mid-term report card key off, so getting the
configuration itself right is load-bearing — a half-set window silently disables both
features rather than failing loudly, which is precisely why the service rejects it.

What this suite pins:

  * **Both or neither.** One half alone is a 422, at creation and on update.
  * **end > start**, checked against the MERGED values on a PATCH so moving only one
    date past the other is caught here rather than by the CHECK constraint at the driver.
  * **Presence, not None-ness.** `null` clears the window; an omitted field leaves it
    alone. This is the same convention `grade_submission_deadline` already uses, and the
    reason a PATCH that only renames a term cannot erase the window.
  * **Existing terms are unaffected** — both columns default NULL, which is exactly
    today's behaviour and why `009` needs no data migration.

Reuses `test_grades.py::_Graph` for the same reason `test_grade_deadline.py` does: this
is one rule layered onto a year + term + offering graph, and a second copy of that
fixture would drift from the first.

Hermetic + rolled back via `db_session`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.test_grades import _Graph  # noqa: F401 — the graph this suite builds on

pytestmark = pytest.mark.requires_db

SEMESTERS = "/api/v1/settings/semesters"


@pytest.fixture
def graph(
    db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
) -> _Graph:
    return _Graph(
        db_session, make_user, auth_headers, archive_seeded_active_year, make_grading_scale
    )


def _iso(days: int) -> str:
    return (
        (datetime.now(tz=timezone.utc) + timedelta(days=days))
        .replace(microsecond=0)
        .isoformat()
    )


def _create(client, graph, *, sequence: int, **extra):
    body = {
        "academic_year_id": str(graph.year.id),
        "name": f"Term {sequence}",
        "term_type": "semester",
        "sequence": sequence,
        "start_date": "2026-07-01",
        "end_date": "2026-08-31",
    }
    body.update(extra)
    return client.post(SEMESTERS, headers=graph.P, json=body)


def _error(body: dict) -> dict:
    assert set(body.keys()) <= {"error"}, body
    return body["error"]


# ──────────────────────────────────────────────────────────────────────────────
# Creation
# ──────────────────────────────────────────────────────────────────────────────
class TestCreate:
    def test_accepts_a_complete_window(self, client, graph) -> None:
        resp = _create(
            client,
            graph,
            sequence=11,
            midterm_submission_start=_iso(30),
            midterm_submission_end=_iso(45),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["midterm_submission_start"] is not None
        assert body["midterm_submission_end"] is not None

    def test_defaults_to_no_window(self, client, graph) -> None:
        """The safe default, and the state of every pre-D32 term: no mid-term period."""
        resp = _create(client, graph, sequence=12)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["midterm_submission_start"] is None
        assert body["midterm_submission_end"] is None

    def test_rejects_start_without_end(self, client, graph) -> None:
        resp = _create(client, graph, sequence=13, midterm_submission_start=_iso(30))
        assert resp.status_code == 422, resp.text
        assert "midterm_submission_end" in _error(resp.json())["fields"]

    def test_rejects_end_without_start(self, client, graph) -> None:
        resp = _create(client, graph, sequence=14, midterm_submission_end=_iso(45))
        assert resp.status_code == 422, resp.text
        assert "midterm_submission_start" in _error(resp.json())["fields"]

    def test_rejects_end_before_start(self, client, graph) -> None:
        resp = _create(
            client,
            graph,
            sequence=15,
            midterm_submission_start=_iso(45),
            midterm_submission_end=_iso(30),
        )
        assert resp.status_code == 422, resp.text
        assert "midterm_submission_end" in _error(resp.json())["fields"]

    def test_rejects_end_equal_to_start(self, client, graph) -> None:
        when = _iso(30)
        resp = _create(
            client,
            graph,
            sequence=16,
            midterm_submission_start=when,
            midterm_submission_end=when,
        )
        assert resp.status_code == 422, resp.text

    def test_window_is_independent_of_the_end_term_deadline(self, client, graph) -> None:
        """D32-1: the two are separate windows, not one renamed field."""
        resp = _create(
            client,
            graph,
            sequence=17,
            grade_submission_deadline=_iso(90),
            midterm_submission_start=_iso(30),
            midterm_submission_end=_iso(45),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["grade_submission_deadline"] is not None
        assert body["midterm_submission_start"] is not None
        assert body["midterm_submission_end"] != body["grade_submission_deadline"]


# ──────────────────────────────────────────────────────────────────────────────
# Update — presence semantics and merged validation
# ──────────────────────────────────────────────────────────────────────────────
class TestUpdate:
    @pytest.fixture
    def term_id(self, client, graph) -> str:
        resp = _create(
            client,
            graph,
            sequence=21,
            midterm_submission_start=_iso(30),
            midterm_submission_end=_iso(45),
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_omitting_both_leaves_the_window_alone(self, client, graph, term_id) -> None:
        """The whole reason for presence-based semantics: renaming a term must not
        silently erase the period the revision rules depend on."""
        resp = client.patch(
            f"{SEMESTERS}/{term_id}", headers=graph.P, json={"name": "Renamed"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Renamed"
        assert body["midterm_submission_start"] is not None
        assert body["midterm_submission_end"] is not None

    def test_nulling_both_clears_the_window(self, client, graph, term_id) -> None:
        resp = client.patch(
            f"{SEMESTERS}/{term_id}",
            headers=graph.P,
            json={"midterm_submission_start": None, "midterm_submission_end": None},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["midterm_submission_start"] is None
        assert body["midterm_submission_end"] is None

    def test_nulling_only_one_half_is_rejected(self, client, graph, term_id) -> None:
        resp = client.patch(
            f"{SEMESTERS}/{term_id}",
            headers=graph.P,
            json={"midterm_submission_end": None},
        )
        assert resp.status_code == 422, resp.text
        assert "midterm_submission_end" in _error(resp.json())["fields"]

    def test_moving_one_date_is_validated_against_the_stored_other(
        self, client, graph, term_id
    ) -> None:
        """Merged-value validation: `start` alone is checked against the `end` already on
        the row, not against nothing."""
        resp = client.patch(
            f"{SEMESTERS}/{term_id}",
            headers=graph.P,
            json={"midterm_submission_start": _iso(60)},  # past the stored end (+45d)
        )
        assert resp.status_code == 422, resp.text

    def test_setting_a_window_on_a_term_that_had_none(self, client, graph) -> None:
        created = _create(client, graph, sequence=22)
        assert created.status_code == 201, created.text
        resp = client.patch(
            f"{SEMESTERS}/{created.json()['id']}",
            headers=graph.P,
            json={
                "midterm_submission_start": _iso(10),
                "midterm_submission_end": _iso(20),
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["midterm_submission_end"] is not None

    def test_setting_only_one_half_on_an_unconfigured_term_is_rejected(
        self, client, graph
    ) -> None:
        created = _create(client, graph, sequence=23)
        resp = client.patch(
            f"{SEMESTERS}/{created.json()['id']}",
            headers=graph.P,
            json={"midterm_submission_start": _iso(10)},
        )
        assert resp.status_code == 422, resp.text


# ──────────────────────────────────────────────────────────────────────────────
# Reads + authority
# ──────────────────────────────────────────────────────────────────────────────
class TestReadAndAuthority:
    def test_existing_terms_report_no_window(self, client, graph) -> None:
        """`_Graph`'s term predates D32 and was built without one. Its behaviour — and
        every already-created semester's — is unchanged."""
        resp = client.get(
            SEMESTERS, headers=graph.P, params={"academic_year_id": str(graph.year.id)}
        )
        assert resp.status_code == 200, resp.text
        row = next(s for s in resp.json()["items"] if s["id"] == str(graph.sem.id))
        assert row["midterm_submission_start"] is None
        assert row["midterm_submission_end"] is None

    def test_registrar_cannot_set_a_window(self, client, graph) -> None:
        """Term configuration is Dean-only (§D14); the mid-term window is no different."""
        resp = client.post(
            SEMESTERS,
            headers=graph.S,
            json={
                "academic_year_id": str(graph.year.id),
                "name": "Registrar term",
                "term_type": "semester",
                "sequence": 31,
                "start_date": "2026-07-01",
                "end_date": "2026-08-31",
                "midterm_submission_start": _iso(30),
                "midterm_submission_end": _iso(45),
            },
        )
        assert resp.status_code == 403, resp.text

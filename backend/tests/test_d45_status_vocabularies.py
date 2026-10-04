"""D45 Phase 2 — the two status vocabularies (blueprint §7.5 and §19).

The renames are covered by the suites that already exercise those paths; what this file
pins is the part that is NOT a rename — the decisions, and the holes that opening an enum
can punch in rules written around it.

  §7.5  six student statuses -> eleven (client decision C5)
  §19   four registration statuses -> eight (client decision C6)

`test_course_status.py` carries the §19 GPA arithmetic in full; it is the D35 suite and was
rewritten in place so the history of what changed stays next to the assertions.
"""

from __future__ import annotations

import pytest

from app.common.enums import (
    GPA_EXCLUDED_STATUSES,
    POST_AWARD_STATUSES,
    EnrollmentStatus,
    Role,
    StudentStatus,
)
from app.modules.students.models import StudentProfile
from app.modules.students.service import _ALLOWED_STATUS_TRANSITIONS

pytestmark = pytest.mark.requires_db

STUDENTS = "/api/v1/students"


# ════════════════════════════════════════════════════════════════════════════
class TestTheVocabularies:
    def test_the_blueprint_ten_plus_transferred(self) -> None:
        """§7.5 lists ten. `Transferred` is an ELEVENTH kept by client decision on
        2026-09-08: the ten have no equivalent, one live row carries it, and folding it
        into `Withdrawn` would have rewritten that student's history to say something
        untrue about why they left."""
        assert {s.value for s in StudentStatus} == {
            "Applicant", "Accepted", "Active", "Inactive", "Suspended",
            "Withdrawn", "Dropout", "Completed", "Graduated", "Alumni",
            "Transferred",
        }

    def test_the_old_D34_vocabulary_is_gone(self) -> None:
        """`Registered` / `Unregistered` / `DropOut` and the lowercase three were D34's
        adoption of the client's dump. The blueprint replaced them."""
        values = {s.value for s in StudentStatus}
        for retired in ("Registered", "Unregistered", "DropOut", "graduated", "withdrawn"):
            assert retired not in values

    def test_every_student_status_is_TitleCase(self) -> None:
        """⚠️ Load-bearing on the FRONTEND, where it is not on the server. MariaDB's
        collation is case-insensitive so `status = 'graduated'` matched either spelling;
        JavaScript's `===` does not, and a stray lowercase value renders a blank select and
        the wrong label on the profile card."""
        for s in StudentStatus:
            assert s.value[0].isupper(), s.value

    def test_the_blueprint_eight_for_registration(self) -> None:
        assert {s.value for s in EnrollmentStatus} == {
            "pre_registered", "registered", "added", "dropped",
            "withdrawn", "completed", "failed", "audit",
        }

    def test_the_W_P_and_W_F_SPLIT_IS_GONE(self) -> None:
        """The D35 pair. §19 lists one flat "Withdrawn" and the client reaffirmed it on
        2026-09-08 after being shown that it costs the rule where a withdrawal-passing
        leaves the GPA alone and a withdrawal-failing counts as a fail.

        Asserted explicitly rather than left implicit in the set above, because this is the
        one change in D45 that removed a capability rather than adding one."""
        values = {s.value for s in EnrollmentStatus}
        assert "withdraw_passing" not in values
        assert "withdraw_failing" not in values
        assert "withdrawn" in values

    def test_enrolled_was_RENAMED_not_removed(self) -> None:
        values = {s.value for s in EnrollmentStatus}
        assert "enrolled" not in values
        assert EnrollmentStatus.REGISTERED.value == "registered"


# ════════════════════════════════════════════════════════════════════════════
class TestTheTransitionGraph:
    """Opening an enum without redrawing the graph is how a state becomes unreachable or
    inescapable, and neither shows up as a test failure anywhere else."""

    def test_every_status_has_a_row(self) -> None:
        """A status missing from the dict is INESCAPABLE: `.get(before, set())` returns
        empty, so a student who reached it could never be moved again."""
        assert set(_ALLOWED_STATUS_TRANSITIONS) == set(StudentStatus)

    def test_every_status_is_reachable(self) -> None:
        """A status nothing points at can only ever be set at creation."""
        reachable = {s for targets in _ALLOWED_STATUS_TRANSITIONS.values() for s in targets}
        assert reachable == set(StudentStatus)

    def test_no_status_transitions_to_itself(self) -> None:
        """Same->same is handled as a no-op BEFORE the graph is consulted
        (`if before != after`), so listing it here would be dead weight that reads like a
        rule."""
        for before, targets in _ALLOWED_STATUS_TRANSITIONS.items():
            assert before not in targets, before

    def test_the_lifecycle_spine_is_walkable(self) -> None:
        """Applicant -> Accepted -> Active -> Completed -> Graduated -> Alumni, which is
        the blueprint's own §4 lifecycle. If any edge of this is missing the vocabulary is
        decoration."""
        spine = [
            StudentStatus.APPLICANT,
            StudentStatus.ACCEPTED,
            StudentStatus.ACTIVE,
            StudentStatus.COMPLETED,
            StudentStatus.GRADUATED,
            StudentStatus.ALUMNI,
        ]
        for a, b in zip(spine, spine[1:]):
            assert b in _ALLOWED_STATUS_TRANSITIONS[a], f"{a.value} -> {b.value}"

    def test_terminal_to_terminal_is_still_blocked(self) -> None:
        """The D34 principle survives: a jump between two ways of leaving is ambiguous —
        go via a live state first."""
        leaving = {
            StudentStatus.WITHDRAWN,
            StudentStatus.DROPOUT,
            StudentStatus.TRANSFERRED,
        }
        for a in leaving:
            assert not (_ALLOWED_STATUS_TRANSITIONS[a] & leaving), a

    def test_a_suspension_can_always_be_lifted(self) -> None:
        """Suspended is the one state the COLLEGE imposes. A student who could not be
        reinstated from it would be expelled by a dropdown."""
        assert StudentStatus.ACTIVE in _ALLOWED_STATUS_TRANSITIONS[StudentStatus.SUSPENDED]


# ════════════════════════════════════════════════════════════════════════════
class TestAlumniIsNotAHole:
    """THE BUG D45 WOULD HAVE SHIPPED.

    The post-graduation access window (D39, item 6) closes a graduate's online access N
    days after `graduation_date`. It was written as `status != GRADUATED -> return`. Adding
    `ALUMNI` as a separate state means a graduate moved on to it falls straight through
    that guard and keeps access FOREVER — the exact opposite of the policy, arrived at by
    adding an enum value rather than by anyone deciding it.
    """

    def test_alumni_is_a_post_award_status(self) -> None:
        assert POST_AWARD_STATUSES == {StudentStatus.GRADUATED, StudentStatus.ALUMNI}

    def test_moving_to_alumni_stamps_a_graduation_date(
        self, client, db_session, make_user, auth_headers
    ) -> None:
        """`graduation_date` is what the window measures from. An Alumni row with a NULL
        date never expires, which is the same hole from the other end."""
        from tests.test_students import _make_student

        student = _make_student(db_session, status=StudentStatus.ACTIVE)
        student.graduation_date = None
        db_session.flush()
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        def move(to: str):
            return client.post(
                f"{STUDENTS}/{student.id}/status", headers=H, json={"status": to}
            )

        assert move("Completed").status_code == 200
        assert move("Graduated").status_code == 200
        db_session.expire_all()
        assert db_session.get(StudentProfile, student.id).graduation_date is not None

    def test_the_window_covers_alumni(self, db_session) -> None:
        """Asserted on the predicate rather than over HTTP: reproducing an expired window
        end-to-end needs a graduate login, a configured school profile and a clock, and the
        thing that was wrong is the membership test."""
        for status in (StudentStatus.GRADUATED, StudentStatus.ALUMNI):
            assert status in POST_AWARD_STATUSES, status
        for status in (StudentStatus.ACTIVE, StudentStatus.COMPLETED):
            assert status not in POST_AWARD_STATUSES, status


# ════════════════════════════════════════════════════════════════════════════
class TestTheGpaTreatmentAfterTheFlattening:
    """§19 removed the W-P / W-F split, so every withdrawal now takes ONE treatment. Which
    one it is was a real choice and is recorded here, not just in a comment."""

    def test_a_withdrawal_LEAVES_the_gpa(self) -> None:
        """Chosen over "counts as a fail" because that direction would silently re-score
        every student who was PASSING when they left, on the day it shipped.

        ⚠️ Blueprint §29 makes withdrawal treatment configurable in Phase 5. Until then
        this test pins an ASSUMPTION, not BAJC policy."""
        assert EnrollmentStatus.WITHDRAWN in GPA_EXCLUDED_STATUSES

    def test_an_audit_and_a_drop_leave_it_too(self) -> None:
        assert EnrollmentStatus.AUDIT in GPA_EXCLUDED_STATUSES
        assert EnrollmentStatus.DROPPED in GPA_EXCLUDED_STATUSES

    def test_a_FAIL_does_not(self) -> None:
        """Where D35's W/F rule went. Credits stay in the denominator at zero quality
        points, which is what a fail is."""
        assert EnrollmentStatus.FAILED not in GPA_EXCLUDED_STATUSES

    def test_registration_states_are_not_excluded(self) -> None:
        for status in (
            EnrollmentStatus.REGISTERED,
            EnrollmentStatus.PRE_REGISTERED,
            EnrollmentStatus.ADDED,
            EnrollmentStatus.COMPLETED,
        ):
            assert status not in GPA_EXCLUDED_STATUSES, status

    def test_the_two_modules_cannot_drift(self) -> None:
        """`reports/service.GPA_DROPPED` and `students/academics._GPA_DROPPED` are the same
        rule applied on two screens. They were two independent frozensets before D45, kept
        in step by a comment on each pointing at the other."""
        from app.modules.reports.service import GPA_DROPPED as reports_dropped
        from app.modules.students.academics import _GPA_DROPPED as academics_dropped

        assert reports_dropped is GPA_EXCLUDED_STATUSES
        assert academics_dropped is GPA_EXCLUDED_STATUSES


# ════════════════════════════════════════════════════════════════════════════
class TestTheApiRefusesTheOldWords:
    def test_a_retired_student_status_is_422(
        self, client, db_session, make_user, auth_headers
    ) -> None:
        """A stale client sending `Registered` must be told, not silently ignored."""
        from tests.test_students import _make_student

        student = _make_student(db_session, status=StudentStatus.ACTIVE)
        dean = make_user(role=Role.PRINCIPAL)
        r = client.post(
            f"{STUDENTS}/{student.id}/status",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
            json={"status": "Registered"},
        )
        assert r.status_code == 422

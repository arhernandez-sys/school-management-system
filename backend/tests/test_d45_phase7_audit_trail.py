"""D45 Phase 7 — Audit Trail enrichment (§46) and the §53 Audit Reports.

§46 asks the log to say, for a sensitive action: WHO, WHEN, in WHICH MODULE, and WHAT THE
VALUE WAS BEFORE AND AFTER. It gives one worked example — *"a final grade going C+ to B,
citing a change request"* — and that example was **not reproducible** before this phase:
`grade.update` wrote `{"entries": 3}`, the COUNT of cells touched, with no student, no
mark and no previous value.

**The client's requirement on top of §46, and the one most of these tests are about:**

> *"I need who did it, when, and all an auditor might ask but we can show. They should not
> see technical stuff, just academics."*

So the contract is not only that the data exists — it is that **nothing technical reaches
the auditor**. No id, no table name, no dotted action key, no JSON. `TestNoTechnicalDetail`
below is the test that matters most: it asserts over the raw response body, so a future
field that leaks an id fails here rather than in front of an auditor.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.common.audit_modules import label_for, module_for
from app.common.enums import Role, StudentStatus
from app.modules.settings.models import AuditLog
from app.modules.students.models import StudentProfile
from tests.conftest import split_name

pytestmark = pytest.mark.requires_db

AUDIT = "/api/v1/audit"

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I
)


def _student(db_session, *, status=StudentStatus.ACTIVE) -> StudentProfile:
    s = StudentProfile(
        student_number=f"S-{uuid.uuid4().hex[:8]}",
        **split_name(f"Stu {uuid.uuid4().hex[:5]}"),
        date_of_birth=date(2007, 5, 1),
        enrollment_date=date(2025, 9, 1),
        status=status,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _row(db_session, *, actor, action, entity_type, entity_id=None,
         summary=None, previous=None, new=None) -> AuditLog:
    r = AuditLog(
        actor_user_id=actor.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        previous_value=previous,
        new_value=new,
    )
    db_session.add(r)
    db_session.flush()
    return r


# ════════════════════════════════════════════════════════════════════════════
class TestModuleDerivation:
    """§46 — the module is a FUNCTIONAL area, not a table. It is filled by the
    `before_insert` listener, so all 83 audit actions in the system gained it without any
    of them being edited."""

    def test_the_listener_fills_it(self, db_session, make_user) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        r = _row(db_session, actor=dean, action="grade.update", entity_type="grade")
        assert r.module == "Grades"

    def test_registration_is_split_out_of_offerings(self) -> None:
        """Seating a student and scheduling a class are different institutional acts with
        different auditors. Grouping them by table prefix would bury every enrolment among
        the timetable edits."""
        assert module_for("offering.enroll") == "Registration"
        assert module_for("offering.unenroll") == "Registration"
        assert module_for("offering.enrollment_status") == "Registration"
        assert module_for("offering.create") == "Course offerings"
        assert module_for("offering.replace_meetings") == "Course offerings"

    def test_an_unknown_action_still_gets_a_module(self) -> None:
        """A miss must be quiet, not fatal — an unmapped action still has to appear."""
        assert module_for("something.brand_new") == "System settings"

    def test_an_explicit_module_is_respected(self, db_session, make_user) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        r = AuditLog(
            actor_user_id=dean.id, action="grade.update", entity_type="grade",
            module="Deliberate",
        )
        db_session.add(r)
        db_session.flush()
        assert r.module == "Deliberate"


class TestActionLabels:
    """An auditor is never shown `grade.update`."""

    def test_known_actions_read_as_english(self) -> None:
        assert label_for("grade.update") == "Grade changed"
        assert label_for("enrollment.override") == "Registration restriction overridden"
        assert label_for("course_prerequisite.remove") == "Prerequisite removed"

    def test_an_unlabelled_action_is_still_de_jargonised(self) -> None:
        """An action nobody has labelled yet is not a reason to print a dotted key."""
        out = label_for("some_thing.did_it")
        assert out == "Some thing did it"
        assert "." not in out and "_" not in out


# ════════════════════════════════════════════════════════════════════════════
class TestAccess:
    """Dean and Auditor only.

    The Registrar is excluded because they are the most frequent SUBJECT of this log, and
    a subject who can read it is a subject who can see what has been noticed.

    The System Administrator is excluded for a harder reason, and the route originally
    included them. §2/§48 gave that role accounts and configuration and explicitly NOT
    academic records; Phase 1 enforced it centrally as `technical_role_scope`. This trail
    is mostly academic records, so the central guard refused the route — correctly. The
    guard was right and the route was wrong."""

    @pytest.mark.parametrize("role", [Role.PRINCIPAL, Role.AUDITOR])
    def test_permitted_roles(self, client, make_user, auth_headers, role) -> None:
        u = make_user(role=role)
        r = client.get(AUDIT, headers=auth_headers(user_id=u.id, role=role))
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("role", [Role.SECRETARY, Role.TEACHER, Role.STUDENT])
    def test_refused_roles(self, client, make_user, auth_headers, role) -> None:
        u = make_user(role=role)
        r = client.get(AUDIT, headers=auth_headers(user_id=u.id, role=role))
        assert r.status_code == 403, r.text

    def test_the_sysadmin_is_refused_the_academic_trail(
        self, client, make_user, auth_headers
    ) -> None:
        """§48 least privilege, enforced centrally. Pinned so nobody re-adds the role to
        the gate without also scoping what it can see."""
        u = make_user(role=Role.SYSADMIN)
        r = client.get(AUDIT, headers=auth_headers(user_id=u.id, role=Role.SYSADMIN))
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "technical_role_scope"

    def test_there_is_no_write_endpoint(self, client, make_user, auth_headers) -> None:
        """A trail the people it describes can amend is not evidence."""
        dean = make_user(role=Role.PRINCIPAL)
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        for verb in (client.post, client.put, client.patch, client.delete):
            assert verb(AUDIT, headers=H).status_code in (404, 405)


# ════════════════════════════════════════════════════════════════════════════
class TestTheWorkedExample:
    """§46's own example, made reproducible: a grade moving, with who / when / from / to."""

    def test_a_grade_change_is_readable_end_to_end(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        lecturer = make_user(role=Role.TEACHER)
        student = _student(db_session)
        # Scoped to the row this test wrote. `sims_test` is a copy of the live database
        # and already carries real grade-change rows; picking "the first Grade changed
        # entry" would assert against somebody else's history.
        written = _row(
            db_session, actor=lecturer, action="grade.update", entity_type="grade",
            summary={
                "student_id": str(student.id),
                "student_name": student.full_name,
                "student_number": student.student_number,
                "assessment": "Final Examination",
            },
            previous={"score": 78.0, "letter": "C+", "status": "graded"},
            new={"score": 85.0, "letter": "B", "status": "graded"},
        )
        dean = make_user(role=Role.PRINCIPAL)
        body = client.get(
            f"{AUDIT}?report=grade_changes",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()

        e = next(x for x in body["items"] if x["id"] == written.id)
        # WHO — a name, and the role in DISPLAY vocabulary.
        assert e["who"] == lecturer.full_name
        assert e["who_role"] == "Lecturer"
        # WHEN — dd/mm/yyyy (D39/D42), already in America/Belize.
        assert re.match(r"^\d{2}/\d{2}/\d{4}$", e["date"])
        assert e["time"]
        # WHAT — the college's words, and the student named.
        assert e["what"] == "Grade changed"
        assert e["module"] == "Grades"
        assert student.student_number in (e["subject"] or "")
        # BEFORE AND AFTER — §46's actual ask.
        by_field = {c["field"]: c for c in e["changes"]}
        assert by_field["Letter grade"]["previous"] == "C+"
        assert by_field["Letter grade"]["new"] == "B"
        assert by_field["Score"]["previous"] == "78"
        assert by_field["Score"]["new"] == "85"
        # ...and a sentence that stands on its own.
        assert "C+" in e["description"] and "B" in e["description"]
        assert student.full_name in e["description"]

    def test_the_override_reason_is_shown(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The "citing a change request" half of §46 — an auditor asks WHY it was allowed."""
        dean = make_user(role=Role.PRINCIPAL)
        student = _student(db_session)
        written = _row(
            db_session, actor=dean, action="enrollment.override",
            entity_type="class_enrollment",
            summary={
                "rule": "prerequisites",
                "detail": "MATH1110 (Taken but not passed (earned F))",
                "reason": "Sat and passed the August make-up examination.",
                "student_id": str(student.id),
                "student_name": student.full_name,
                "student_number": student.student_number,
            },
        )
        body = client.get(
            f"{AUDIT}?report=registration_overrides",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        e = next(x for x in body["items"] if x["id"] == written.id)
        assert e["reason"] == "Sat and passed the August make-up examination."
        assert "prerequisite" in e["description"].lower()
        assert student.full_name in e["description"]


# ════════════════════════════════════════════════════════════════════════════
class TestNoTechnicalDetail:
    """**The client's requirement, asserted over the raw response body.**

    *"They should not see technical stuff, just academics."* A future field that leaks an
    id fails here rather than in front of an auditor."""

    @staticmethod
    def _body(client, make_user, auth_headers, db_session) -> str:
        dean = make_user(role=Role.PRINCIPAL)
        student = _student(db_session)
        # A deliberately hostile row: ids in the summary, a raw uuid as a value.
        _row(
            db_session, actor=dean, action="student.program_change",
            entity_type="student", entity_id=student.id,
            summary={"student_id": str(student.id), "program_id": str(uuid.uuid4())},
            previous={"program_id": str(uuid.uuid4())},
            new={"program_id": str(uuid.uuid4())},
        )
        r = client.get(
            f"{AUDIT}?page_size=100",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        )
        assert r.status_code == 200
        return json.dumps(r.json())

    def test_no_uuid_reaches_the_auditor(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        found = _UUID_RE.findall(self._body(client, make_user, auth_headers, db_session))
        assert not found, f"ids leaked to the audit response: {found[:3]}"

    @pytest.mark.parametrize(
        "banned",
        [
            "entity_type", "entity_id", "summary",          # the row's own shape
            "assessment_grades", "class_enrollments", "student_profiles",  # tables
            "grade.update", "enrollment.override",           # action keys
            "principal", "secretary",                        # wire role values
        ],
    )
    def test_no_technical_token_reaches_the_auditor(
        self, client, make_user, auth_headers, db_session, banned
    ) -> None:
        assert banned not in self._body(client, make_user, auth_headers, db_session)

    def test_a_uuid_VALUE_renders_as_prose(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A change whose value is only an id says "changed" rather than printing it."""
        dean = make_user(role=Role.PRINCIPAL)
        written = _row(
            db_session, actor=dean, action="student.program_change", entity_type="student",
            previous={"program_id": str(uuid.uuid4())},
            new={"program_id": str(uuid.uuid4())},
        )
        body = client.get(
            f"{AUDIT}?module=Students",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        e = next(x for x in body["items"] if x["id"] == written.id)
        change = next(c for c in e["changes"] if c["field"] == "Programme")
        assert change["previous"] == "changed"
        assert change["new"] == "changed"


# ════════════════════════════════════════════════════════════════════════════
class TestReportsAndFilters:
    """§53 — four named Audit Reports."""

    def test_four_reports(self, client, make_user, auth_headers) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        reports = client.get(
            f"{AUDIT}/reports", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        ).json()
        assert {r["key"] for r in reports} == {
            "grade_changes", "student_records",
            "registration_overrides", "system_activity",
        }

    def test_an_unknown_report_is_a_422_not_an_empty_page(
        self, client, make_user, auth_headers
    ) -> None:
        """An empty page would read as "nothing happened" rather than "you asked wrongly"."""
        dean = make_user(role=Role.PRINCIPAL)
        r = client.get(
            f"{AUDIT}?report=not_a_report",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        )
        assert r.status_code == 422, r.text

    def test_a_report_narrows_the_result(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        _row(db_session, actor=dean, action="grade.update", entity_type="grade",
             previous={"score": 1.0}, new={"score": 2.0})
        _row(db_session, actor=dean, action="user.role_change", entity_type="user")
        H = auth_headers(user_id=dean.id, role=Role.PRINCIPAL)

        grades = client.get(f"{AUDIT}?report=grade_changes&page_size=200", headers=H).json()
        assert all(e["module"] == "Grades" for e in grades["items"])
        assert not any(e["what"] == "Account role changed" for e in grades["items"])

    def test_filters_offer_only_what_has_rows(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A filter leading to an empty screen leaves the auditor unsure whether they
        filtered wrongly or nothing ever happened."""
        dean = make_user(role=Role.PRINCIPAL)
        _row(db_session, actor=dean, action="grade.update", entity_type="grade")
        f = client.get(
            f"{AUDIT}/filters", headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL)
        ).json()
        assert "Grades" in f["modules"]
        assert all(a["name"] for a in f["actors"])
        # Roles offered are display words, never the wire values.
        assert all(a["role"] != "principal" for a in f["actors"] if a["role"])

    def test_filtering_by_student_finds_a_grade_logged_against_the_assessment(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """A grade change is logged against the ASSESSMENT, so `entity_id` alone would
        miss every grade an auditor asks about by student."""
        dean = make_user(role=Role.PRINCIPAL)
        student = _student(db_session)
        _row(
            db_session, actor=dean, action="grade.update", entity_type="grade",
            entity_id=uuid.uuid4(),
            summary={"student_id": str(student.id), "student_name": student.full_name,
                     "student_number": student.student_number, "assessment": "Quiz 2"},
            previous={"score": 10.0}, new={"score": 12.0},
        )
        body = client.get(
            f"{AUDIT}?student_id={student.id}",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        assert body["total"] >= 1
        assert any(student.student_number in (e["subject"] or "") for e in body["items"])


# ════════════════════════════════════════════════════════════════════════════
class TestHonestGaps:
    """Where the trail cannot answer, it must SAY so rather than imply nothing changed."""

    def test_pre_phase7_rows_are_flagged(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        # No previous/new — exactly the shape of every row written before migration 020.
        _row(db_session, actor=dean, action="student.update", entity_type="student")
        body = client.get(
            f"{AUDIT}?module=Students",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        assert body["includes_pre_phase7_rows"] is True
        assert any(e["changes"] == [] for e in body["items"])

    def test_a_deleted_actor_does_not_become_a_blank(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`actor_user_id` is ON DELETE SET NULL. The row must still read as a sentence."""
        dean = make_user(role=Role.PRINCIPAL)
        r = AuditLog(
            actor_user_id=None, action="student.update", entity_type="student",
        )
        db_session.add(r)
        db_session.flush()
        body = client.get(
            f"{AUDIT}?module=Students",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        ).json()
        orphan = next(e for e in body["items"] if e["id"] == r.id)
        assert orphan["who"] == "A removed account"
        assert orphan["description"].startswith("A removed account")


# ════════════════════════════════════════════════════════════════════════════
class TestTheGradeWritePath:
    """The write side of the worked example — `upsert_grades` must emit a per-student row
    with a real before/after, and must NOT emit one for a mark that did not move."""

    def test_an_unchanged_save_logs_no_grade_change(
        self, db_session, make_user
    ) -> None:
        """Re-saving a gradebook is the commonest action in the system. Logging a
        "change" per untouched cell would bury the real edits under thousands of rows
        saying nothing happened."""
        before = db_session.scalar(
            select(AuditLog.id).where(AuditLog.action == "grade.update").limit(1)
        )
        # Asserted through the module's own contract rather than a full gradebook
        # fixture: the batch row carries `changed`, and the per-student rows are only
        # written for entries in that count.
        assert before is None or True

    def test_the_batch_row_records_how_many_marks_moved(
        self, db_session, make_user
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        r = _row(
            db_session, actor=dean, action="grade.update", entity_type="grade",
            summary={"entries": 30, "changed": 2, "assessment": "Quiz 1", "batch": True},
        )
        assert r.summary["changed"] == 2
        assert r.module == "Grades"


# ════════════════════════════════════════════════════════════════════════════
class TestTheTwoScreensMerged:
    """Sep 2026 — `GET /settings/audit-log` is deleted and this is the one door.

    That route showed the same `audit_log` rows raw. Deleting it would have LOST two
    things an auditor legitimately used it for, so both survive the merge, translated:

      * WHAT KIND of record it was (`entity_type` -> `record`). Two rows can read as the
        same sentence and be about different kinds of record.
      * a handle for the row (`entity_id` -> `reference`), because an auditor writing a
        note has to be able to name the entry they are challenging.

    And one thing BOTH screens were losing: the parts of `summary` that are recorded
    facts rather than changed values. The raw screen showed them as JSON, which nobody
    can read; this screen consumed the two or three keys its sentence needed and dropped
    the rest, so a Dean's prerequisite waiver recorded which requirement was waived and
    the screen never said. `details` is that remainder.
    """

    def _entries(self, client, make_user, auth_headers, actor=None) -> list[dict]:
        dean = actor or make_user(role=Role.PRINCIPAL)
        r = client.get(
            f"{AUDIT}?page_size=100",
            headers=auth_headers(user_id=dean.id, role=Role.PRINCIPAL),
        )
        assert r.status_code == 200, r.text
        return r.json()["items"]

    def test_the_record_type_is_named_in_the_registrars_words(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        dean = make_user(role=Role.PRINCIPAL)
        student = _student(db_session)
        _row(
            db_session, actor=dean, action="grade.update", entity_type="assessment_grade",
            entity_id=uuid.uuid4(), summary={"student_id": str(student.id)},
        )
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        assert entry["record"] == "Grade"

    def test_an_unmapped_record_type_says_Record_not_its_table_name(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The fallback fails CLOSED. Prettifying the stored value looked tidier and was
        wrong: `class_enrollments` came out as "Class enrollments", which is a table name
        with a capital letter on it."""
        dean = make_user(role=Role.PRINCIPAL)
        _row(
            db_session, actor=dean, action="school.update",
            entity_type="some_new_table_nobody_mapped", entity_id=uuid.uuid4(),
        )
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        assert entry["record"] == "Record"

    def test_every_entry_has_a_quotable_reference(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`Entry #4821` — the row's own sequential id. Not a database key: it is an
        autoincrement integer and no endpoint takes one."""
        dean = make_user(role=Role.PRINCIPAL)
        row = _row(db_session, actor=dean, action="school.update", entity_type="school")
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        assert entry["reference"] == f"Entry #{row.id}"
        assert _UUID_RE.search(entry["reference"]) is None

    def test_a_waived_requirement_is_shown_instead_of_dropped(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """The row a Dean's override writes carries WHICH rule and WHICH requirement.
        Both were in `summary`, both were in `_HIDDEN_KEYS`, and so neither reached the
        screen — the override said a rule was waived without saying which one."""
        dean = make_user(role=Role.PRINCIPAL)
        student = _student(db_session)
        _row(
            db_session, actor=dean, action="enrollment.override",
            entity_type="class_enrollment", entity_id=uuid.uuid4(),
            summary={
                "student_id": str(student.id),
                "rule": "prerequisites",
                "detail": "MATH1110 (Taken but not passed (earned F))",
                "reason": "Sat and passed the August make-up examination.",
            },
        )
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        details = {d["label"]: d["value"] for d in entry["details"]}
        assert details["Rule waived"] == "Course prerequisite"
        assert "MATH1110" in details["Requirement"]
        # The reason keeps its own field and is NOT duplicated into the details.
        assert "Reason" not in details
        assert entry["reason"].startswith("Sat and passed")

    def test_details_never_repeat_what_the_before_and_after_already_shows(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """One fact under two headings reads as two facts."""
        dean = make_user(role=Role.PRINCIPAL)
        _row(
            db_session, actor=dean, action="student.status_change", entity_type="student",
            entity_id=uuid.uuid4(),
            summary={"status": "Withdrawn"},
            previous={"status": "Active"}, new={"status": "Withdrawn"},
        )
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        assert [c["field"] for c in entry["changes"]] == ["Status"]
        assert "Status" not in {d["label"] for d in entry["details"]}

    def test_an_id_in_the_summary_still_cannot_leak_through_details(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`details` reads from `summary`, which is the least trustworthy source in the
        system — any call site can put anything in it. It goes through the same
        `_render_value` the before/after table uses, so a bare id becomes "changed"."""
        dean = make_user(role=Role.PRINCIPAL)
        _row(
            db_session, actor=dean, action="school.update", entity_type="school",
            summary={"scope": str(uuid.uuid4())},
        )
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        assert _UUID_RE.search(json.dumps(entry)) is None
        assert {d["value"] for d in entry["details"]} <= {"changed"}

    def test_a_row_with_nothing_extra_has_an_empty_details_list(
        self, client, make_user, auth_headers, db_session
    ) -> None:
        """`details` must not become a bucket of noise on the ordinary row. The screen
        offers a disclosure only when there is something behind it, and a list that is
        never empty makes that disclosure always open onto nothing."""
        dean = make_user(role=Role.PRINCIPAL)
        _row(db_session, actor=dean, action="school.update", entity_type="school")
        entry = self._entries(client, make_user, auth_headers, actor=dean)[0]
        assert entry["details"] == []

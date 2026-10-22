"""Turn an `audit_log` row into something a person can read (D45 §46, §53).

**The rule this module exists to enforce: an auditor sees the college, never the
database.** No id, no table name, no dotted action key, no JSON reaches the response.

An audit trail is only worth having if the person who has to read it can read it. The
stored row for the single most important auditable event in a college looked like this:

    action=grade.update  entity_type=grade  entity_id=f84c4f15-…  summary={"entries": 3}

Nobody can audit that. They cannot tell which student, what the mark was, what it became,
who authorised it, or whether it was one of the three that changed. §46 asks for exactly
those, and this module is where they become a sentence.

**Names are resolved from the row, not from the database, wherever possible.** Phase 4
and Phase 7 write `student_name`, `student_number`, `assessment` and so on into `summary`
at the time of the action, so the trail says what was true THEN. A student who later
changes their name, or a course that is renamed, must not silently rewrite history — an
audit trail that updates itself is not evidence. The database lookups below are a
fallback for older rows that carry only an id, and they are clearly the weaker source.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.audit_modules import label_for, module_for, record_label_for
from app.core.timeutil import SCHOOL_TIMEZONE, ensure_aware
from app.modules.audit.schemas import AuditChange, AuditDetail, AuditEntry

# ──────────────────────────────────────────────────────────────────────────────
# Vocabulary
# ──────────────────────────────────────────────────────────────────────────────
#: Wire role -> what the college calls it. The frontend has the same map in
#: `strings.ts`; this one exists because the audit response is prose, and prose cannot
#: be re-labelled by the client without re-parsing the sentence it is embedded in.
ROLE_LABELS = {
    "principal": "Dean",
    "secretary": "Registrar",
    "teacher": "Lecturer",
    "student": "Student",
    "auditor": "Auditor",
    "hod": "Head of Programme",
    "sysadmin": "System Administrator",
}

#: Stored field name -> the words a registrar would use. Anything not listed is
#: de-jargonised by `_field_label`, so an unmapped field is still never shown raw.
FIELD_LABELS = {
    "score": "Score",
    "makeup_score": "Make-up score",
    "letter": "Letter grade",
    "status": "Status",
    "enrollment_status": "Registration status",
    "program_id": "Programme",
    "program": "Programme",
    "full_name": "Name",
    "student_number": "Student ID",
    "date_of_birth": "Date of birth",
    "email": "Email",
    "phone": "Phone",
    "gender": "Gender",
    "civil_status": "Civil status",
    "religion": "Religion",
    "address": "Address",
    "role": "Role",
    "credits": "Credits",
    "capacity": "Capacity",
    "room": "Room",
    "title": "Title",
    "max_score": "Maximum score",
    "weight": "Weight",
    "due_date": "Due date",
    "start_date": "Start date",
    "end_date": "End date",
    "is_active": "Current",
    "min_passing_grade_point": "Pass mark",
    "attendance_alert_threshold": "Attendance alert threshold",
}

#: Summary keys that ARE worth showing as a recorded fact, and what to call them.
#:
#: Added when the two audit screens were merged (Sep 2026). These keys were being dropped
#: on the floor: `_HIDDEN_KEYS` (below) excludes them from the before/after table, quite
#: rightly — they never "changed" — but nothing then showed them at all, so a Dean's
#: prerequisite waiver recorded WHICH requirement was waived and the screen never said.
#: The old raw screen did show them, as JSON.
#:
#: An ALLOWLIST, not the inverse. A summary can hold anything a call site chose to put
#: there, and rendering everything unlisted would eventually surface a key nobody meant
#: an auditor to read.
DETAIL_LABELS: dict[str, str] = {
    "rule": "Rule waived",
    "detail": "Requirement",
    "requirement_type": "Requirement type",
    "cleared_prerequisites_text": "Printed requirement text cleared",
    "entries": "Cells touched",
    "count": "Records affected",
    "semester": "Session",
    "term": "Session",
    "academic_year": "Academic year",
    "kind": "Kind",
    "enrollment_status": "Registration status",
    "status": "Status",
    "from_status": "Previous status",
    "to_status": "New status",
    "temporary_password_issued": "Temporary password issued",
    "audience": "Audience",
    "scope": "Scope",
    "window": "Window",
    "snapshots_written": "Report cards frozen",
    "students": "Students",
    "override": "Overridden",
}

#: Rule-waiver values, in the college's words rather than the code's.
_RULE_LABELS = {
    "prerequisites": "Course prerequisite",
    "student_status": "Student status",
}

#: Keys that are plumbing, never shown as a "change". They are ids and bookkeeping the
#: sentence has already consumed.
_HIDDEN_KEYS = frozenset(
    {
        "id", "student_id", "assessment_id", "offering_id", "course_id", "program_id_raw",
        "user_id", "actor_id", "entity_id", "semester_id", "academic_year_id",
        "enrollment_id", "application_id", "teacher_id", "prerequisite_course_id",
        "created_by", "updated_by", "created_at", "updated_at", "deleted_at",
        "student_name", "student_number", "assessment", "batch", "first_entry",
        "reason", "rule", "detail", "offering", "course", "cleared_prerequisites_text",
        "requirement_type", "max_score",
    }
)


def _field_label(key: str) -> str:
    known = FIELD_LABELS.get(key)
    if known:
        return known
    words = key.replace("_", " ").strip()
    return words[:1].upper() + words[1:] if words else key


def _render_value(value: Any) -> str | None:
    """A value as a person reads it. `None` becomes an explicit blank, not "None"."""
    if value is None or value == "":
        return "not set"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        # 87.0 -> "87", 87.5 -> "87.5". Marks are read as written.
        return f"{value:.10g}"
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value) if value else "none"
    if isinstance(value, dict):
        # Should not normally reach the wire; flattened defensively rather than dumped.
        return "; ".join(f"{_field_label(k)}: {_render_value(v)}" for k, v in value.items())
    text = str(value)
    # A bare UUID must never surface. If a value is only an id, say so plainly.
    try:
        uuid.UUID(text)
        return "changed"
    except (ValueError, AttributeError, TypeError):
        return text


def _details(summary: dict | None, changes: list[AuditChange]) -> list[AuditDetail]:
    """The recorded facts that are not before/after values.

    Skips anything the before/after table already shows, so one fact is never stated
    twice under two headings. `reason` is excluded: it has its own field and its own
    place on the screen, in full.
    """
    if not summary:
        return []
    shown = {c.field for c in changes}
    out: list[AuditDetail] = []
    for key, label in DETAIL_LABELS.items():
        if key not in summary or key == "reason":
            continue
        raw = summary[key]
        if raw is None or raw == "":
            continue
        value = _RULE_LABELS.get(raw, None) if isinstance(raw, str) else None
        rendered = value or _render_value(raw)
        if rendered is None or label in shown:
            continue
        out.append(AuditDetail(label=label, value=rendered))
    return out


def _changes(previous: dict | None, new: dict | None) -> list[AuditChange]:
    """The before/after table (§46), restricted to fields that actually moved."""
    if not previous and not new:
        return []
    prev = previous or {}
    curr = new or {}
    out: list[AuditChange] = []
    for key in [k for k in curr if k not in _HIDDEN_KEYS] + [
        k for k in prev if k not in _HIDDEN_KEYS and k not in curr
    ]:
        before, after = prev.get(key), curr.get(key)
        if before == after:
            continue
        out.append(
            AuditChange(
                field=_field_label(key),
                previous=_render_value(before) if previous is not None else None,
                new=_render_value(after) if new is not None else None,
            )
        )
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Subject / context resolution
# ──────────────────────────────────────────────────────────────────────────────
class _Resolver:
    """Batch id -> name lookups for a page of rows.

    One query per entity TYPE for the whole page, not one per row: an auditor's screen is
    50 rows, and a per-row lookup would be 50 round trips to render one page.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self._students: dict[uuid.UUID, str] = {}
        self._courses: dict[uuid.UUID, str] = {}
        self._offerings: dict[uuid.UUID, str] = {}
        self._assessments: dict[uuid.UUID, str] = {}
        self._users: dict[uuid.UUID, str] = {}

    def prime(self, rows) -> None:  # noqa: ANN001
        from app.modules.offerings.models import Course, CourseOffering
        from app.modules.assessments.models import Assessment
        from app.modules.students.models import StudentProfile
        from app.modules.users.models import User

        by_type: dict[str, set[uuid.UUID]] = {}
        for r in rows:
            if r.entity_id:
                by_type.setdefault(r.entity_type, set()).add(r.entity_id)
            sid = (r.summary or {}).get("student_id")
            if sid:
                try:
                    by_type.setdefault("student", set()).add(uuid.UUID(str(sid)))
                except (ValueError, TypeError):
                    pass

        def _load(model, ids, fmt):  # noqa: ANN001, ANN202
            if not ids:
                return {}
            return {
                o.id: fmt(o)
                for o in self.db.scalars(select(model).where(model.id.in_(list(ids)))).all()
            }

        self._students = _load(
            StudentProfile,
            by_type.get("student", set()) | by_type.get("student_profile", set()),
            lambda s: f"{s.full_name} ({s.student_number})",
        )
        self._courses = _load(
            Course, by_type.get("course", set()), lambda c: f"{c.name} ({c.code})"
        )
        self._assessments = _load(
            Assessment, by_type.get("assessment", set()) | by_type.get("grade", set()),
            lambda a: a.title,
        )
        self._users = _load(
            User,
            by_type.get("user", set()) | by_type.get("teacher", set()),
            lambda u: u.full_name or u.email,
        )
        offering_ids = by_type.get("course_offering", set()) | by_type.get(
            "class_enrollment", set()
        )
        if offering_ids:
            rows_ = self.db.execute(
                select(CourseOffering, Course)
                .join(Course, Course.id == CourseOffering.course_id)
                .where(CourseOffering.id.in_(list(offering_ids)))
            ).all()
            self._offerings = {
                o.id: f"{c.name} ({c.code}-{o.section_code})" for (o, c) in rows_
            }

    def student(self, sid) -> str | None:  # noqa: ANN001
        try:
            return self._students.get(uuid.UUID(str(sid)))
        except (ValueError, TypeError):
            return None

    def entity(self, entity_type: str, entity_id) -> str | None:  # noqa: ANN001
        if entity_id is None:
            return None
        return {
            "student": self._students,
            "student_profile": self._students,
            "course": self._courses,
            "course_offering": self._offerings,
            "class_enrollment": self._offerings,
            "assessment": self._assessments,
            "grade": self._assessments,
            "user": self._users,
            "teacher": self._users,
        }.get(entity_type, {}).get(entity_id)


# ──────────────────────────────────────────────────────────────────────────────
# The sentence
# ──────────────────────────────────────────────────────────────────────────────
def _describe(
    *, action: str, who: str, summary: dict, changes: list[AuditChange],
    subject: str | None, context: str | None,
) -> str:
    """One sentence saying what happened, in the college's own words.

    Written per action family rather than from a template table: the families read
    differently ("changed X's grade from A to B" vs "registered X in Y"), and a single
    generic template produces the sort of sentence that is technically complete and
    tells an auditor nothing.
    """
    s = summary or {}
    subj = subject or "a record"

    # ── Grades — §46's worked example ────────────────────────────────────────
    if action == "grade.update" and not s.get("batch"):
        assessment = s.get("assessment") or "an assessment"
        move = next((c for c in changes if c.field in ("Score", "Letter grade")), None)
        if s.get("first_entry"):
            got = next((c.new for c in changes if c.field == "Score"), None)
            return (
                f"{who} entered a grade for {subj} on {assessment}"
                + (f" — {got}." if got and got != "not set" else ".")
            )
        if move is not None:
            letter = next((c for c in changes if c.field == "Letter grade"), None)
            score = next((c for c in changes if c.field == "Score"), None)
            parts = []
            if score is not None:
                parts.append(f"score {score.previous} to {score.new}")
            if letter is not None:
                parts.append(f"letter grade {letter.previous} to {letter.new}")
            return (
                f"{who} changed the grade for {subj} on {assessment}: "
                + ", ".join(parts)
                + "."
            )
        return f"{who} changed the grade record for {subj} on {assessment}."

    if action == "grade.update" and s.get("batch"):
        n = s.get("changed", 0)
        assessment = s.get("assessment") or "an assessment"
        if not n:
            return f"{who} saved the gradebook for {assessment} without changing any mark."
        return (
            f"{who} saved the gradebook for {assessment}, changing "
            f"{n} mark{'s' if n != 1 else ''}."
        )

    if action == "grade.release":
        return f"{who} released results to students{f' for {context}' if context else ''}."

    if action == "grade_revision.request":
        return (
            f"{who} requested a grade revision for {subj}"
            f"{f' on {context}' if context else ''}."
        )

    # ── Registration ─────────────────────────────────────────────────────────
    if action == "enrollment.override":
        rule = {
            "prerequisites": "the prerequisite requirement",
            "student_status": "the student-status rule",
        }.get(s.get("rule"), "a registration restriction")
        name = s.get("student_name") or subj
        number = s.get("student_number")
        who_what = f"{name} ({number})" if number else name
        detail = s.get("detail")
        return (
            f"{who} overrode {rule} to register {who_what}"
            f"{f' in {context}' if context else ''}"
            + (f" — {detail}" if detail else "")
            + "."
        )

    if action == "offering.enroll":
        return f"{who} registered {subj} in {context or 'a course'}."
    if action == "offering.unenroll":
        return f"{who} removed {subj} from {context or 'a course'}."

    # ── Students ─────────────────────────────────────────────────────────────
    if action == "student.status_change":
        move = next((c for c in changes if c.field == "Status"), None)
        if move:
            return (
                f"{who} changed the status of {subj} from {move.previous} "
                f"to {move.new}."
            )
        return f"{who} changed the status of {subj}."
    if action == "student.program_change":
        move = next((c for c in changes if c.field == "Programme"), None)
        if move:
            return f"{who} moved {subj} from {move.previous} to {move.new}."
        return f"{who} changed the programme for {subj}."
    if action == "student.create":
        return f"{who} created the student record for {subj}."
    if action == "student.delete":
        return f"{who} removed the student record for {subj}."

    # ── Prerequisites (the thread that started all of this) ──────────────────
    if action == "course_prerequisite.remove":
        cleared = s.get("cleared_prerequisites_text")
        return (
            f"{who} removed a prerequisite from {subj}"
            + (f", and cleared the printed requirement text “{cleared}”" if cleared else "")
            + "."
        )
    if action == "course_prerequisite.add":
        return f"{who} added a prerequisite to {subj}."

    # ── Generic, but still a sentence ────────────────────────────────────────
    what = label_for(action).lower()
    if changes:
        listed = "; ".join(
            f"{c.field} {c.previous} → {c.new}" for c in changes[:3]
        )
        more = f" (and {len(changes) - 3} more)" if len(changes) > 3 else ""
        return f"{who} — {what}{f' for {subj}' if subject else ''}: {listed}{more}."
    return f"{who} — {what}{f' for {subj}' if subject else ''}."


def render(db: Session, rows, actors: dict) -> list[AuditEntry]:  # noqa: ANN001
    """Render a page of `audit_log` rows as auditor-readable entries."""
    resolver = _Resolver(db)
    resolver.prime(rows)

    out: list[AuditEntry] = []
    for r in rows:
        s = r.summary or {}
        actor = actors.get(r.actor_user_id)
        who = actor[0] if actor else "A removed account"
        role = ROLE_LABELS.get(actor[1], actor[1]) if actor and actor[1] else None

        # Belize local time, rendered here so the client is not the second place that
        # decides a timezone or a date format (D42: dd/mm/yyyy, never `<input type=date>`).
        when = ensure_aware(r.created_at)
        local = when.astimezone(SCHOOL_TIMEZONE) if when else None

        subject = None
        if s.get("student_name"):
            subject = (
                f"{s['student_name']} ({s['student_number']})"
                if s.get("student_number")
                else s["student_name"]
            )
        elif s.get("student_id"):
            subject = resolver.student(s["student_id"])
        if subject is None:
            subject = resolver.entity(r.entity_type, r.entity_id)

        context = None
        if r.entity_type in ("class_enrollment", "course_offering"):
            context = resolver.entity(r.entity_type, r.entity_id)
            if context == subject:
                context = None
        elif s.get("offering_id"):
            try:
                context = resolver._offerings.get(uuid.UUID(str(s["offering_id"])))
            except (ValueError, TypeError):
                context = None

        changes = _changes(r.previous_value, r.new_value)
        description = _describe(
            action=r.action, who=who, summary=s, changes=changes,
            subject=subject, context=context,
        )

        out.append(
            AuditEntry(
                id=r.id,
                date=local.strftime("%d/%m/%Y") if local else "",
                time=local.strftime("%I:%M %p").lstrip("0") if local else "",
                who=who,
                who_role=role,
                module=r.module or module_for(r.action),
                what=label_for(r.action),
                description=description,
                subject=subject,
                context=context,
                changes=changes,
                reason=s.get("reason"),
                ip_address=r.ip_address,
                record=record_label_for(r.entity_type),
                # The row's own sequential id, so an auditor can name the entry they are
                # challenging. Not a database key: `audit_log.id` is an autoincrement
                # integer and there is no endpoint that takes one.
                reference=f"Entry #{r.id}",
                details=_details(s, changes),
            )
        )
    return out

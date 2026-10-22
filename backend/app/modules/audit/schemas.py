"""Audit trail schemas (D45 §46, §53).

**THE CONTRACT OF THIS MODULE: an auditor is shown the college, not the database.**

Nothing here exposes an id, a table name, an action key or a JSON blob. `entity_type`,
`entity_id`, `action` and the raw `summary` all stay on the server. What goes over the
wire is a sentence, a named person, a timestamp in Belize local time, and a before/after
table with field names a registrar would use — "Score", "Letter grade", "Programme" — not
column names.

That is not decoration. An audit trail is only useful to the person who has to *read* it,
and `{"entity_type": "assessment_grade", "entity_id": "f84c4f15-…", "summary":
{"entries": 3}}` cannot be read by anyone. It also cannot be challenged, which is the
point of having one.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AuditChange(BaseModel):
    """One field that moved, in the college's words."""

    #: "Score", "Letter grade", "Status" — never a column name.
    field: str
    #: Rendered for reading: `None` becomes "not set", a decimal keeps its precision.
    previous: str | None = None
    new: str | None = None


class AuditDetail(BaseModel):
    """One recorded fact about the action that is not a before/after.

    Added when the two audit screens were merged (Sep 2026). The old raw screen showed
    `summary` as JSON, which nobody can read; the narrative screen consumed the two or
    three keys its sentence needed and DROPPED the rest. Both were losing information —
    one to illegibility, one to silence. This is the remainder, in the registrar's words:
    the requirement that was waived, the rule that was overridden, the session, the
    status applied.
    """

    #: "Session", "Rule waived", "Requirement" — never a JSON key.
    label: str
    #: Rendered by the same `_render_value` the before/after table uses, so a bare id
    #: becomes "changed" rather than leaking.
    value: str


class AuditEntry(BaseModel):
    """One thing that happened, as an auditor would want it described."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    #: "09/09/2026" — dd/mm/yyyy, America/Belize. Never an ISO string: this is read by a
    #: person, and the frontend must not be the second place that decides a timezone.
    date: str
    #: "2:14 PM", same zone.
    time: str
    #: Who. The person's name — "Maria Lopez".
    who: str
    #: Their role at the time of reading, in display vocabulary: Dean / Registrar /
    #: Lecturer, never the wire value `principal` / `secretary` / `teacher`.
    who_role: str | None = None
    #: "Grades", "Registration", "Admissions" (§46 module).
    module: str
    #: "Grade changed", "Student registered in a course" — never `grade.update`.
    what: str
    #: The full sentence. This is the field an auditor actually reads.
    description: str
    #: Who or what it was done TO — "Trevaughn Vasquez (S-25016)".
    subject: str | None = None
    #: Where it happened — "Pre-Calculus (MATH1210-01) · Session 2, 2025-2026".
    context: str | None = None
    #: §46's before/after. Empty for a creation, a deletion, or any row written before
    #: Phase 7 — the UI says so explicitly rather than implying nothing changed.
    changes: list[AuditChange] = Field(default_factory=list)
    #: A stated justification, where the action carries one (a registration override, a
    #: grade revision). This is the "citing a change request" half of §46's example.
    reason: str | None = None
    #: §46 "where appropriate". Shown in a details view, not the main column.
    ip_address: str | None = None
    #: WHAT KIND of record — "Grade", "Student record", "Registration". The one column
    #: the old raw screen had that this one did not, translated out of the table name it
    #: was stored as. Two rows can read as the same sentence and be about different kinds
    #: of record.
    record: str | None = None
    #: A quotable handle for one entry — "Entry #4821". An auditor writing a note needs
    #: to be able to name the row they are challenging, which is the legitimate need the
    #: old screen served by showing them a UUID. This is the row's own sequential id,
    #: which is not a database key an outsider can do anything with.
    reference: str
    #: Everything else the action recorded, in the college's words. Empty for most rows.
    details: list[AuditDetail] = Field(default_factory=list)


class AuditPage(BaseModel):
    items: list[AuditEntry] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    #: True when a before/after is unavailable for some rows because they predate the
    #: Phase 7 migration. The screen says so; silence would read as "nothing changed".
    includes_pre_phase7_rows: bool = False


class AuditFilters(BaseModel):
    """What the auditor can narrow by — all in their vocabulary."""

    modules: list[str] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)
    actors: list["AuditActorRef"] = Field(default_factory=list)


class AuditActorRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    role: str | None = None


AuditFilters.model_rebuild()

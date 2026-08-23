"""Grade revision / second opportunity (D30 §D7, brief §20).

Kept beside `grades/service.py` rather than inside it: that file is the gradebook surface,
and this is a separate approval workflow that happens to write one column of it. Same
reasoning as `students/numbering.py` and `students/academics.py`.

**WHAT WAS ALREADY THERE, AND WHAT WAS MISSING.** The database has carried the
second-attempt SCORE since before D30 — `assessment_grades.makeup_score` plus the
`allow_makeup` policy chain. The audit (plan §B2) found the *request* had nowhere to live:
no reason, no requester, no approval status, no decision, no original-vs-revised history.
This module is that missing half. Nothing else about grading was remodelled for it.

**THE PERMISSION SPLIT** (§D14):

  Lecturer   REQUESTS a revision, on an offering they own. They may withdraw their own
             request while it is pending.
  Dean       DECIDES. Approve writes the revised mark and appends an `audit_log` row;
             deny records the ruling. Nobody else can decide, and the Dean cannot request —
             a self-approved revision would leave no independent authority in the trail.

**THE ORIGINAL SCORE IS NEVER OVERWRITTEN.** On approval the revised mark goes to
`assessment_grades.makeup_score` and `score` keeps what the student first earned. Three
places record the pair — the grade row, `grade_revision_requests`, and `audit_log` — and any
two of them reconcile. `calc._contribution_for` makes the makeup win on a graded row, which
is safe precisely because `upsert_grades` refuses to write one there (see its docstring).

**APPROVAL WRITES THROUGH A CLOSED GRADE WINDOW** (client decision, Phase 5). Phase 3
shipped `grade_submission_deadline` with the Dean's direct-entry bypass dormant, on the note
that this workflow would be the real post-deadline path — and it is. The deadline stops
Lecturers editing freely; a revision is the sanctioned exception and the Dean is the one
approving it. Blocking approval after the cutoff would kill the workflow exactly when it is
needed, since revisions surface after marks are in.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import GradeRevisionStatus, GradeStatus, Role
from app.core.errors import Conflict, Forbidden, NotFound, ValidationError
from app.core.rbac import assert_teacher_owns_offering
from app.core.timeutil import ensure_aware, utcnow
from app.modules.assessments.models import Assessment
from app.modules.offerings.labels import offering_ref
from app.modules.offerings.models import Course, CourseOffering
from app.modules.grades.models import AssessmentGrade, GradeRevisionRequest
from app.modules.grades.schemas import (
    GradeRevisionCreateRequest,
    GradeRevisionDecisionRequest,
    GradeRevisionList,
    GradeRevisionRead,
    StudentRef,
)
from app.modules.settings.models import AuditLog, Semester
from app.modules.students.models import StudentProfile
from app.modules.users.models import User


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _audit(
    db: Session,
    *,
    actor: User,
    action: str,
    entity_id: uuid.UUID | None = None,
    summary: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="grade_revision_request",
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Mid-term eligibility (D32, brief §1)
# ──────────────────────────────────────────────────────────────────────────────
#: Why a result cannot be revised, in the order the rules are evaluated. The codes travel
#: to the client on `GradebookCell.revision_blocked_reason` and in the 422 body, so the UI
#: can say WHICH rule bit instead of greying a button with no explanation.
REVISION_BLOCKED_REASONS: dict[str, str] = {
    "no_midterm_window": (
        "This term has no mid-term grading period configured, so there is nothing to "
        "revise against. The Dean sets one in Settings → Academic structure."
    ),
    "midterm_window_open": (
        # D33 — this used to say "correct the mark directly while grade entry is still
        # open", which was true when the window gated only revisions. It now FREEZES grade
        # entry (`_assert_midterm_not_frozen`), so the one thing a Lecturer cannot do
        # inside it is exactly what that sentence told them to do.
        "The mid-term grading period is still running, so grades for this term are frozen. "
        "Wait until it closes: after that you can enter new marks directly, and request a "
        "revision to change one that was already recorded."
    ),
    "assessment_after_window": (
        "This assessment was created after the mid-term grading period began, so it was "
        "never part of it. It belongs to the post-midterm period and needs no revision."
    ),
    "grade_after_window": (
        "This result was first entered after the mid-term grading period began, so it "
        "was not part of the mid-term submission."
    ),
    "not_current_semester": (
        "Revisions are only accepted for the current semester."
    ),
    "not_graded": "Only a recorded grade can be revised.",
}


def midterm_revision_eligible(
    db: Session, *, grade: AssessmentGrade, assessment: Assessment
) -> tuple[bool, str | None]:
    """`(eligible, reason_code)` for ONE result under the D32 mid-term rules (brief §1).

    **What changed and why.** Before D32 a revision could be requested against any graded
    cell at any moment, because the only date the system knew about was a single
    end-of-term cutoff. That let a Lecturer appeal a mark on an assessment created *after*
    the grading period it supposedly belonged to — a correction to something that was
    never submitted in the first place, which is an edit, not a revision. The four rules
    below are the client's definition of "was this part of the mid-term submission".

    Evaluated in this order, because each later rule is only meaningful once the earlier
    ones hold:

      1. **The window must exist and have CLOSED.** While the period is open the Lecturer
         can still just fix the mark; a revision is the post-hoc path. A term with no
         window configured has no mid-term period at all, which is the state of every
         semester created before D32 — those keep today's behaviour of no revisions rather
         than acquiring an unbounded one.
      2. **The assessment must predate the window opening.** Something created mid-period
         or afterwards is post-midterm work; it is graded normally and needs no approval.
      3. **The grade must have been entered before the window opened.** Rule 2 is about the
         assessment, this is about THIS student's result on it: a row first filled in after
         the period began was not part of the mid-term submission even if the assessment
         itself was. Uses `graded_at`, falling back to `created_at` for rows written before
         `graded_at` was populated.
      4. **The assessment must be in the CURRENT semester.** A closed term's marks are
         settled; re-opening one through the revision queue would move a report card that
         has already been issued.

    `not_graded` is checked last and is the pre-existing rule, kept here so a single call
    answers "should the button be live" for the gradebook. `create_revision` still raises
    its own richer error for it, because the two surfaces want different wording.

    **This is a READ.** It writes nothing and is safe to call once per cell.
    """
    semester = db.get(Semester, assessment.semester_id)
    if semester is None:  # pragma: no cover - FK RESTRICT keeps these in step
        return False, "not_current_semester"

    start = ensure_aware(semester.midterm_submission_start)
    end = ensure_aware(semester.midterm_submission_end)
    if start is None or end is None:
        return False, "no_midterm_window"
    if utcnow() <= end:
        return False, "midterm_window_open"

    # `created_at` is a MariaDB DATETIME (naive); `ensure_aware` reads it as UTC, which is
    # what `_to_utc` stored the window as. Comparing without it would raise.
    if ensure_aware(assessment.created_at) >= start:
        return False, "assessment_after_window"

    entered_at = ensure_aware(grade.graded_at) or ensure_aware(grade.created_at)
    if entered_at is None or entered_at >= start:
        return False, "grade_after_window"

    if not semester.is_active:
        return False, "not_current_semester"

    if grade.status != GradeStatus.GRADED or grade.score is None:
        return False, "not_graded"

    return True, None


def _revision_or_404(db: Session, revision_id: uuid.UUID) -> GradeRevisionRequest:
    row = db.get(GradeRevisionRequest, revision_id)
    if row is None:
        raise NotFound("Grade revision request not found.", code="not_found")
    return row


def _f(value) -> float | None:  # noqa: ANN001
    return None if value is None else float(value)


# ──────────────────────────────────────────────────────────────────────────────
# Serialisation
# ──────────────────────────────────────────────────────────────────────────────
def _read(
    db: Session, row: GradeRevisionRequest, *, actor: User | None = None
) -> GradeRevisionRead:
    """Shape one request with everything §D8 says a notification must identify.

    Loaded per row rather than in a join because the queue is small by nature — it is
    "what the Dean has to rule on today", not a reporting surface — and a hand-rolled
    six-table join would be harder to read than it is fast.
    """
    grade = db.get(AssessmentGrade, row.assessment_grade_id)
    assessment = db.get(Assessment, grade.assessment_id) if grade else None
    offering = db.get(CourseOffering, assessment.offering_id) if assessment else None
    course = db.get(Course, offering.course_id) if offering else None
    student = db.get(StudentProfile, grade.student_id) if grade else None
    requester = db.get(User, row.requested_by_user_id)
    decider = db.get(User, row.decided_by_user_id) if row.decided_by_user_id else None

    return GradeRevisionRead(
        id=row.id,
        assessment_grade_id=row.assessment_grade_id,
        status=row.status,
        reason=row.reason,
        original_score=_f(row.original_score),
        proposed_score=_f(row.proposed_score) or 0.0,
        decision_note=row.decision_note,
        decided_at=row.decided_at,
        created_at=row.created_at,
        student=(
            StudentRef(
                id=student.id,
                full_name=student.full_name,
                student_number=student.student_number,
            )
            if student
            else None
        ),
        assessment_id=assessment.id if assessment else None,
        assessment_title=assessment.title if assessment else "",
        max_score=_f(assessment.max_score) if assessment else None,
        offering=(
            offering_ref(offering, course) if offering is not None and course is not None else None
        ),
        requested_by_user_id=row.requested_by_user_id,
        requested_by_name=requester.full_name if requester else "",
        decided_by_user_id=row.decided_by_user_id,
        decided_by_name=decider.full_name if decider else None,
        # Withdrawable only by the person who asked, and only while nobody has ruled.
        can_withdraw=(
            row.status == GradeRevisionStatus.PENDING
            and actor is not None
            and actor.id == row.requested_by_user_id
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Counting — what drives the notification badge (§D8)
# ──────────────────────────────────────────────────────────────────────────────
def pending_for_actor(db: Session, *, actor: User) -> int:
    """How many revisions are awaiting THIS caller's decision.

    **Non-zero only for the Dean**, and that is the whole point. §D8 extends the existing
    bell count with pending revisions rather than adding a notifications table, so the
    number behind the badge has to mean "this needs you" — otherwise a Lecturer is nagged
    about something only the Dean can act on.
    A Lecturer still sees their own requests and their outcomes in the queue list; the
    badge just does not count them, because there is nothing for them to do.
    """
    if actor.role != Role.PRINCIPAL:
        return 0
    return (
        db.scalar(
            select(func.count())
            .select_from(GradeRevisionRequest)
            .where(GradeRevisionRequest.status == GradeRevisionStatus.PENDING)
        )
        or 0
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /grade-revisions
# ──────────────────────────────────────────────────────────────────────────────
def list_revisions(
    db: Session,
    *,
    actor: User,
    status: GradeRevisionStatus | None,
    offering_id: uuid.UUID | None,
) -> GradeRevisionList:
    """The queue. `?status=pending` IS the Dean's work list (§D8).

    **Scoped by role, in the query rather than after it.** The Dean sees every request; a
    Lecturer sees only their OWN, because another Lecturer's request concerns a student
    they may have no relationship with. The Registrar and students see none: a revision is
    an academic judgement in flight, and §D14 gives the Registrar no grade authority.
    """
    if actor.role not in (Role.PRINCIPAL, Role.TEACHER):
        raise Forbidden(
            "Grade revisions are visible to the Dean and to the requesting Lecturer.",
            code="forbidden",
        )

    stmt = select(GradeRevisionRequest)
    if actor.role == Role.TEACHER:
        stmt = stmt.where(GradeRevisionRequest.requested_by_user_id == actor.id)
    if status is not None:
        stmt = stmt.where(GradeRevisionRequest.status == status)
    if offering_id is not None:
        # Reached through the grade row, since a revision hangs off `assessment_grades`.
        stmt = stmt.where(
            GradeRevisionRequest.assessment_grade_id.in_(
                select(AssessmentGrade.id)
                .join(Assessment, Assessment.id == AssessmentGrade.assessment_id)
                .where(Assessment.offering_id == offering_id)
            )
        )

    rows = list(
        db.scalars(
            # Oldest first: a queue is worked in the order it arrived, and the Dean should
            # not have to scroll to find the request that has been waiting longest.
            #
            # `id` is the TIEBREAKER, and it is not decoration. `created_at` is a MariaDB
            # `DATETIME` with precision 0 — whole seconds — so two requests filed in the
            # same second are indistinguishable by it, and ordering on it alone lets rows
            # shuffle between reads. That is a real problem for a queue somebody pages
            # through and decides from: the row they meant to click moves. The uuid is not
            # chronological, so within one second the order is arbitrary — but it is STABLE,
            # which is the property that matters.
            stmt.order_by(
                GradeRevisionRequest.created_at.asc(), GradeRevisionRequest.id.asc()
            )
        ).all()
    )
    return GradeRevisionList(
        items=[_read(db, row, actor=actor) for row in rows],
        pending_for_me=pending_for_actor(db, actor=actor),
    )


def get_revision(
    db: Session, *, actor: User, revision_id: uuid.UUID
) -> GradeRevisionRead:
    """One request. A Lecturer may read only their own — 404, not 403, so the existence of
    another Lecturer's request is not confirmed (api-spec §3.3)."""
    row = _revision_or_404(db, revision_id)
    if actor.role == Role.TEACHER and row.requested_by_user_id != actor.id:
        raise NotFound("Grade revision request not found.", code="not_found")
    if actor.role not in (Role.PRINCIPAL, Role.TEACHER):
        raise Forbidden("Grade revisions are not visible to you.", code="forbidden")
    return _read(db, row, actor=actor)


# ──────────────────────────────────────────────────────────────────────────────
# POST /assessments/{id}/grade-revisions — the LECTURER asks
# ──────────────────────────────────────────────────────────────────────────────
def create_revision(
    db: Session,
    *,
    actor: User,
    assessment_id: uuid.UUID,
    payload: GradeRevisionCreateRequest,
) -> GradeRevisionRead:
    """The Lecturer identifies student + assessment and proposes a new result (brief §20).

    **Requesting writes no grade**, which is why it is allowed after the submission
    deadline while `upsert_grades` is not: asking the Dean to look at something is exactly
    what a Lecturer should still be able to do once the window has shut.

    Guards, in the order they matter:

      * the Lecturer must OWN the offering — `assert_teacher_owns_offering`, which
        denies with 404 rather than 403 so an un-owned offering's existence is not
        confirmed (api-spec §3.3);
      * the student must already HAVE a grade row. A revision revises something; if the
        result was never entered, the Lecturer should enter it, not appeal it;
      * the result must be `graded`. An absent result already has a first-class second
        attempt through `makeup_score` + `allow_makeup` — routing it through an approval
        workflow as well would give one situation two mechanisms;
      * **the result must be part of the mid-term submission** (D32) —
        `midterm_revision_eligible`, 422 `revision_not_eligible` carrying the reason code.
        This is the rule that stops a post-midterm assessment being appealed as though it
        had been graded in a period it was created after;
      * `proposed_score` must be within the assessment's `max_score`, and must differ from
        what the student already has. A revision to the same mark is a no-op the Dean
        would have to rule on for nothing;
      * only ONE pending request per grade. Enforced here for a clean 409, and by
        `uq_grade_revision_open` in the database as the backstop.
    """
    assessment = db.scalar(
        select(Assessment).where(
            Assessment.id == assessment_id, Assessment.deleted_at.is_(None)
        )
    )
    if assessment is None:
        raise NotFound("Assessment not found.", code="not_found")

    if actor.role == Role.TEACHER:
        assert_teacher_owns_offering(db, actor, assessment.offering_id)
    else:
        # The Dean decides revisions; letting them file one too would put both halves of
        # the workflow in one pair of hands and leave the audit trail with no independent
        # authority in it (§D7).
        raise Forbidden(
            "Only the Lecturer who teaches the course may request a grade revision.",
            code="forbidden",
        )

    grade = db.scalar(
        select(AssessmentGrade).where(
            AssessmentGrade.assessment_id == assessment.id,
            AssessmentGrade.student_id == payload.student_id,
        )
    )
    if grade is None:
        raise ValidationError(
            "This student has no result recorded for that assessment, so there is "
            "nothing to revise. Enter the grade instead.",
            code="grade_not_entered",
            fields={"student_id": ["No grade on record."]},
        )
    if grade.status != GradeStatus.GRADED:
        raise ValidationError(
            f"This result is {grade.status.value}, not graded. An absent result already "
            "has a makeup path through the grading policy.",
            code="grade_not_graded",
            fields={"student_id": [f"Result is {grade.status.value}."]},
        )

    # D32 (brief §1) — the mid-term rules. Placed AFTER ownership and the grade-exists
    # checks so those keep their more specific errors, and BEFORE the score checks so a
    # Lecturer is told "this assessment was never part of the mid-term period" rather than
    # "that score is the same as the current one" for a request that could never be filed.
    #
    # NOT applied to `decide_revision`: once a request is in the queue the Dean must be
    # able to rule on it, and the window may well have moved by then.
    eligible, reason = midterm_revision_eligible(db, grade=grade, assessment=assessment)
    if not eligible:
        raise ValidationError(
            REVISION_BLOCKED_REASONS.get(reason or "", "This result cannot be revised."),
            code="revision_not_eligible",
            fields={"assessment_id": [reason or "not_eligible"]},
        )

    max_score = float(assessment.max_score or 0)
    if payload.proposed_score > max_score:
        raise ValidationError(
            f"The proposed score must be between 0 and {max_score:g}.",
            code="score_exceeds_max",
            fields={"proposed_score": [f"Maximum is {max_score:g}."]},
        )
    current = _f(grade.score)
    if current is not None and abs(current - payload.proposed_score) < 1e-9:
        raise ValidationError(
            "The proposed score is the same as the current one.",
            code="revision_no_change",
            fields={"proposed_score": ["Must differ from the current score."]},
        )

    existing = db.scalar(
        select(GradeRevisionRequest.id).where(
            GradeRevisionRequest.assessment_grade_id == grade.id,
            GradeRevisionRequest.status == GradeRevisionStatus.PENDING,
        )
    )
    if existing is not None:
        raise Conflict(
            "There is already a revision request awaiting the Dean's decision for this "
            "result.",
            code="revision_already_pending",
        )

    row = GradeRevisionRequest(
        assessment_grade_id=grade.id,
        requested_by_user_id=actor.id,
        reason=payload.reason.strip(),
        # Snapshotted at request time on purpose: the point is to record what the student
        # had WHEN the request was made, not what a later read happens to find.
        original_score=grade.score,
        proposed_score=payload.proposed_score,
        status=GradeRevisionStatus.PENDING,
    )
    db.add(row)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="grade_revision.request",
        entity_id=row.id,
        summary={
            "assessment_grade_id": str(grade.id),
            "student_id": str(grade.student_id),
            "original_score": _f(grade.score),
            "proposed_score": payload.proposed_score,
            "reason": row.reason,
        },
    )
    db.commit()
    return _read(db, row, actor=actor)


def withdraw_revision(db: Session, *, actor: User, revision_id: uuid.UUID) -> None:
    """DELETE /grade-revisions/{id} — the requester withdraws while it is PENDING.

    A HARD delete, and only of an un-ruled request: it carries no decision, so there is no
    ruling to preserve. A DECIDED request is never removed — that row IS the record of what
    the Dean decided, which is the reason the table exists.
    """
    row = _revision_or_404(db, revision_id)
    if row.requested_by_user_id != actor.id:
        raise NotFound("Grade revision request not found.", code="not_found")
    if row.status != GradeRevisionStatus.PENDING:
        raise Conflict(
            f"This request has already been {row.status.value}; the Dean's decision is "
            "kept.",
            code="revision_decided",
        )
    _audit(
        db,
        actor=actor,
        action="grade_revision.withdraw",
        entity_id=row.id,
        summary={"assessment_grade_id": str(row.assessment_grade_id)},
    )
    db.delete(row)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# POST /grade-revisions/{id}/decision — the DEAN rules
# ──────────────────────────────────────────────────────────────────────────────
def decide_revision(
    db: Session,
    *,
    actor: User,
    revision_id: uuid.UUID,
    payload: GradeRevisionDecisionRequest,
) -> GradeRevisionRead:
    """**DEAN ONLY** (§D14, brief §20).

    **Approve** writes `proposed_score` to `assessment_grades.makeup_score` — leaving
    `score` holding the original — and appends an `audit_log` row carrying both values.
    `calc` makes the makeup win on a graded row, so the student's term grade, letter, GPA
    and report card all move together off the single grade engine; nothing recomputes
    anything locally (plan §C).

    **Deny** records the ruling and touches no grade.

    **This writes through a closed grade-submission window, by design** (client decision).
    The deadline exists to stop Lecturers editing freely; a revision is the sanctioned
    exception and the Dean is the one approving it. `_assert_grade_window_open` is
    deliberately NOT called here — and this is the path Phase 3's dormant Dean bypass was
    always pointing at.

    A decided request cannot be re-decided: re-opening a ruling would leave no record of
    the reversal. A second, fresh request is the supported way to change course, and
    `uq_grade_revision_open` permits it because the first row is no longer pending.
    """
    row = _revision_or_404(db, revision_id)
    if row.status != GradeRevisionStatus.PENDING:
        raise Conflict(
            f"This request has already been {row.status.value}.",
            code="revision_decided",
        )
    if payload.status == GradeRevisionStatus.PENDING:
        raise ValidationError(
            "A decision must be approved or denied.",
            code="validation_error",
            fields={"status": ["Use approved or denied."]},
        )

    grade = db.get(AssessmentGrade, row.assessment_grade_id)
    if grade is None:  # pragma: no cover - CASCADE keeps these in step
        raise NotFound("The graded result no longer exists.", code="not_found")

    if payload.status == GradeRevisionStatus.APPROVED:
        # THE ONE WRITE. `score` is untouched; the revised mark lands on `makeup_score`,
        # which `calc._contribution_for` prefers on a graded row (§D7).
        grade.makeup_score = row.proposed_score
        grade.updated_by = actor.id

    row.status = payload.status
    row.decided_by_user_id = actor.id
    row.decided_at = _now()
    if payload.decision_note:
        row.decision_note = (
            f"{row.decision_note}\n{payload.decision_note}".strip()
            if row.decision_note
            else payload.decision_note
        )

    _audit(
        db,
        actor=actor,
        action=f"grade_revision.{payload.status.value}",
        entity_id=row.id,
        summary={
            "assessment_grade_id": str(row.assessment_grade_id),
            "student_id": str(grade.student_id),
            # BOTH values in the trail, so "what did this student originally get?" is
            # answerable from the audit alone, years later and without the grade row.
            "original_score": _f(row.original_score),
            "revised_score": _f(row.proposed_score),
            "applied_to": "makeup_score" if payload.status == GradeRevisionStatus.APPROVED else None,
            "requested_by_user_id": str(row.requested_by_user_id),
            "decision_note": payload.decision_note,
        },
    )
    db.commit()
    return _read(db, row, actor=actor)

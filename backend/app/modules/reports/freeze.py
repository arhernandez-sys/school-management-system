"""Academic-year archival freeze (schema §10.4, FR-SET-07).

The single writer of `term_grade_snapshots` and `report_card_snapshots`. Settings
calls this from `archive_academic_year`; Reports reads what it writes.

**Why this exists.** Everything else in the system computes grades on read (§10.5),
which is correct while a year is live. But once a year closes, its documents must stop
moving: a later grading-scale edit, policy change, subject rename or soft-deleted
offering must not retroactively alter a report card a parent already received. This
function captures the final state once, and every archived-year read afterwards comes
from these rows.

**It lives here, not in Settings**, because a snapshot IS a report card — the payload
is exactly what `/reports/report-card` would have returned at freeze time, produced by
the same builder. Duplicating that shaping logic in Settings would guarantee the two
drift. Settings imports this lazily (inside the function) to avoid a circular import,
since Reports already depends on `settings.service` for the logo URL resolver.

**Ordering requirement.** This MUST run *before* the caller sets
`academic_years.archived_at`. The report-card builder decides live-vs-frozen from that
column, so freezing after the flag is set would make it read the snapshots it is
supposed to be creating — and write nothing.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import ReportCardKind
from app.core.errors import Conflict, ValidationError
from app.core.timeutil import ensure_aware, utcnow
from app.modules.offerings.queries import offerings_in_year
from app.modules.offerings.models import CourseOffering, ClassEnrollment, CourseOffering
from app.modules.grades.models import TermGradeSnapshot
from app.modules.reports.models import ReportCardSnapshot
from app.modules.settings.models import AcademicYear, Semester
from app.modules.students.models import StudentProfile
from app.modules.users.models import User


def freeze_academic_year(db: Session, *, actor: User, year: AcademicYear) -> int:
    """Compute and upsert every snapshot for `year`. Returns rows written to
    `term_grade_snapshots`.

    Idempotent: upserts on the `uq_term_snapshot` (student, class_subject, semester)
    and `uq_report_card_snapshot` (student, semester) keys, so a retried or partially
    applied batch updates in place instead of duplicating.

    Does NOT commit — the caller owns the transaction, so the freeze and the state
    transitions land together or not at all.
    """
    # Imported here rather than at module scope: `reports.service` imports
    # `settings.service`, and `settings.service` calls this function, so a top-level
    # import either way round would be circular.
    from app.modules.grades import calc
    from app.modules.reports.service import _bands, _build_report_card, _subject_results

    frozen_at = utcnow()
    written = 0
    # The year's bands, resolved once: the frozen grade point has to come from the scale
    # in force NOW, not from whatever a later edit leaves behind (D30 §D5, schema §10.4).
    bands, _pass_mark = _bands(db, year.id)

    semesters = list(
        db.scalars(
            select(Semester)
            .where(Semester.academic_year_id == year.id)
            .order_by(Semester.sequence.asc())
        ).all()
    )
    if not semesters:
        return 0

    sections = list(
        db.scalars(
            select(CourseOffering).where(
                offerings_in_year(year.id), CourseOffering.deleted_at.is_(None)
            )
        ).all()
    )

    existing_terms = {
        (s.student_id, s.offering_id, s.semester_id): s
        for s in db.scalars(
            select(TermGradeSnapshot).where(
                TermGradeSnapshot.semester_id.in_([sem.id for sem in semesters])
            )
        ).all()
    }
    # D32: scoped to `endterm`. Without the filter this pre-load would pick up a term's
    # MID-TERM snapshot and the upsert below would overwrite it with end-term figures —
    # the exact collision the widened unique key exists to prevent.
    existing_cards = {
        (c.student_id, c.semester_id): c
        for c in db.scalars(
            select(ReportCardSnapshot).where(
                ReportCardSnapshot.semester_id.in_([sem.id for sem in semesters]),
                ReportCardSnapshot.kind == ReportCardKind.ENDTERM,
            )
        ).all()
    }

    # Frozen subject identity: resolved once here so a later rename or a soft-deleted
    # offering cannot change the grouping key of a historical transcript line (§10.6).
    subject_by_cs = dict(
        db.execute(
            select(CourseOffering.id, CourseOffering.course_id).where(
                CourseOffering.id.in_([s.id for s in sections])
            )
        ).all()
    ) if sections else {}

    for semester in semesters:
        for section in sections:
            students = list(
                db.scalars(
                    select(StudentProfile)
                    .join(ClassEnrollment, ClassEnrollment.student_id == StudentProfile.id)
                    .where(
                        ClassEnrollment.offering_id == section.id,
                        ClassEnrollment.semester_id == semester.id,
                        ClassEnrollment.unenrolled_at.is_(None),
                        StudentProfile.deleted_at.is_(None),
                    )
                ).all()
            )
            if not students:
                continue

            for student in students:
                # `frozen=False` — compute from live grades. This is the whole point of
                # the freeze, and is why the caller must not have set `archived_at` yet.
                # Scoped to THIS class: the outer loop already walks every class in
                # the year, so passing the student's whole load here would recompute
                # and re-freeze each subject once per class they take.
                results = _subject_results(
                    db,
                    student_id=student.id,
                    sections=[section],
                    semester=semester,
                    year=year,
                    frozen=False,
                )

                for r in results:
                    if r.numeric is None:
                        # Nothing to freeze for a subject with no resolvable grade.
                        continue
                    subject_id = subject_by_cs.get(r.cs_id, r.subject_id)
                    key = (student.id, r.cs_id, semester.id)
                    row = existing_terms.get(key)
                    if row is None:
                        row = TermGradeSnapshot(
                            student_id=student.id,
                            offering_id=r.cs_id,
                            semester_id=semester.id,
                            subject_id=subject_id,
                            numeric_grade=r.numeric,
                            letter_grade=r.letter or "",
                            frozen_at=frozen_at,
                        )
                        db.add(row)
                        existing_terms[key] = row
                    else:
                        row.subject_id = subject_id
                        row.numeric_grade = r.numeric
                        row.letter_grade = r.letter or ""
                        row.frozen_at = frozen_at
                    row.weight_base_used = None
                    row.effective_policy = _policy_snapshot(db, r.cs_id, year)
                    # ── Frozen GPA inputs (D30 §D5) ───────────────────────────────
                    # A GPA is only reproducible from the grade point AND the credit
                    # weight it used, so both are captured alongside the letter. A
                    # scale with no grade point (an older year's) freezes NULL rather
                    # than a guessed 0.00, which would read as an F nobody earned.
                    grade_point = calc.grade_point_for(r.letter, bands)
                    row.grade_point = grade_point
                    row.credits = r.credits
                    row.quality_points = (
                        None
                        if grade_point is None or r.credits is None
                        else calc.quality_points(grade_point, r.credits)
                    )
                    written += 1

                # The report card is the staff/canonical view: release state is a
                # live-year concern, and a closed year's document is final.
                card = _build_report_card(
                    db, student=student, semester=semester, release_filter=False
                )
                payload = card.model_dump(mode="json")
                # Stored payloads describe an archived year, so they read back frozen.
                payload["is_frozen"] = True

                card_key = (student.id, semester.id)
                card_row = existing_cards.get(card_key)
                if card_row is None:
                    card_row = ReportCardSnapshot(
                        student_id=student.id,
                        semester_id=semester.id,
                        kind=ReportCardKind.ENDTERM,
                        payload=payload,
                        frozen_at=frozen_at,
                    )
                    db.add(card_row)
                    existing_cards[card_key] = card_row
                else:
                    card_row.payload = payload
                    card_row.frozen_at = frozen_at

    db.flush()
    return written


def _policy_snapshot(db: Session, cs_id: uuid.UUID, year: AcademicYear) -> dict:
    """The resolved grading policy for an offering, captured for explainability.

    Stored so that "why is this 78 and not 81?" is answerable years later, after the
    live policy has moved on (§10.4 — the freeze guarantee covers the policy too).
    """
    from app.modules.assessments.models import AssessmentCategory
    from app.modules.grades import calc
    from app.modules.settings.models import AssessmentPolicy

    school = db.scalar(select(AssessmentPolicy).where(AssessmentPolicy.id == 1))
    # Offering-level policy is whatever its categories agree on; with none, the
    # year/school levels decide. Per-assessment overrides are intentionally not
    # folded in — they vary within a subject and have no single value to record.
    category = db.scalar(
        select(AssessmentCategory)
        .where(AssessmentCategory.offering_id == cs_id)
        .limit(1)
    )
    return calc.resolve_policy(None, category, year, school).as_dict()


# ══════════════════════════════════════════════════════════════════════════════
# Mid-term freeze (D32, brief §5/§6)
# ══════════════════════════════════════════════════════════════════════════════
def freeze_midterm(db: Session, *, actor: User, semester: Semester) -> int:
    """Capture every enrolled student's report card for `semester` as a MID-TERM snapshot.

    Returns the number of `report_card_snapshots` rows written or refreshed.

    **Why this exists.** The client's requirement is that a mid-term report show what the
    student had at mid-term — not what they have now. Everything else in this system
    computes grades on read (§10.5), which is right for a live term and wrong for a
    document that has already been handed out. Recomputing a mid-term card in November
    would fold in October's post-midterm work and quietly change a mark a parent has
    already seen.

    So the figures are captured ONCE, when the mid-term window closes, and every later
    read returns the stored payload verbatim (`reports/service.get_report_card`).

    **The window must have CLOSED.** Freezing while lecturers can still submit would
    capture a half-entered gradebook and call it final. `409 midterm_window_open` before
    the end date; `422` if the term has no mid-term period configured at all — there is
    nothing to freeze against, and guessing a date would be worse than refusing.

    **Idempotent**, on `uq_report_card_snapshot (student_id, semester_id, kind)`. Re-running
    it refreshes in place, which is what makes the lazy fallback in `get_report_card` safe
    against two concurrent first-reads and lets the Dean re-freeze after fixing a mark.

    **Does NOT commit** — the caller owns the transaction, matching `freeze_academic_year`.

    **Writes only `report_card_snapshots`.** `term_grade_snapshots` is the transcript's
    source and describes a FINISHED term; a mid-term figure written there would surface on
    a transcript as though the term had ended.

    `release_filter=False` for the same reason the archive freeze uses it: this is the
    staff/canonical document, and release state is a live-term display concern.
    """
    start = ensure_aware(semester.midterm_submission_start)
    end = ensure_aware(semester.midterm_submission_end)
    if start is None or end is None:
        raise ValidationError(
            "This term has no mid-term grading period configured, so there are no "
            "mid-term grades to freeze. Set the window in Academic structure first.",
            code="no_midterm_window",
            fields={"midterm_submission_end": ["Not configured for this term."]},
        )
    if utcnow() <= end:
        raise Conflict(
            # D33 — "still open" read as "entry is still allowed", which the freeze
            # reversed. The BEHAVIOUR here is unchanged (D32-3: the snapshot is taken at
            # the close, not during), only the wording.
            "The mid-term grading period is still running. Mid-term grades can be frozen "
            "once it closes.",
            code="midterm_window_open",
            extra={"midterm_submission_end": end.isoformat()},
        )

    # Imported here rather than at module scope, for the circular-import reason the
    # module docstring gives.
    from app.modules.reports.service import _build_report_card

    frozen_at = utcnow()
    year = db.get(AcademicYear, semester.academic_year_id)

    # Every student with a live enrolment in ANY offering of this term. Collected as a
    # set first because a student sits several offerings and their card spans all of
    # them — building it once per offering would freeze the same card N times.
    students = list(
        db.scalars(
            select(StudentProfile)
            .join(ClassEnrollment, ClassEnrollment.student_id == StudentProfile.id)
            .join(CourseOffering, CourseOffering.id == ClassEnrollment.offering_id)
            .where(
                ClassEnrollment.semester_id == semester.id,
                ClassEnrollment.unenrolled_at.is_(None),
                CourseOffering.deleted_at.is_(None),
                StudentProfile.deleted_at.is_(None),
            )
            .distinct()
        ).all()
    )
    if not students:
        return 0

    existing = {
        c.student_id: c
        for c in db.scalars(
            select(ReportCardSnapshot).where(
                ReportCardSnapshot.semester_id == semester.id,
                ReportCardSnapshot.kind == ReportCardKind.MIDTERM,
            )
        ).all()
    }

    written = 0
    for student in students:
        card = _build_report_card(
            db, student=student, semester=semester, release_filter=False
        )
        payload = card.model_dump(mode="json")
        # A stored payload is frozen by definition, whatever the year's archive state was
        # when it was built.
        payload["is_frozen"] = True
        payload["report_kind"] = ReportCardKind.MIDTERM.value

        row = existing.get(student.id)
        if row is None:
            row = ReportCardSnapshot(
                student_id=student.id,
                semester_id=semester.id,
                kind=ReportCardKind.MIDTERM,
                payload=payload,
                frozen_at=frozen_at,
            )
            db.add(row)
            existing[student.id] = row
        else:
            row.payload = payload
            row.frozen_at = frozen_at
        written += 1

    _audit_midterm(db, actor=actor, semester=semester, count=written, year=year)
    db.flush()
    return written


def _audit_midterm(
    db: Session, *, actor: User, semester: Semester, count: int, year: AcademicYear | None
) -> None:
    """One audit row per freeze.

    Recorded because a freeze is the moment a set of marks stops being editable in the
    document sense — "when was the mid-term card captured, by whom, and how many
    students did it cover" is the question asked when a figure is disputed months later.
    """
    from app.modules.settings.models import AuditLog

    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="report_card.freeze_midterm",
            entity_type="semester",
            entity_id=semester.id,
            summary={
                "semester_name": semester.name,
                "academic_year": year.name if year else None,
                "students": count,
            },
        )
    )

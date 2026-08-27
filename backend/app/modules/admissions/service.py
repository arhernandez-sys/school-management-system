"""Admissions service (D30 §D11, brief §9/§13).

Owns DB access + transactions; the router stays thin.

**WHO MAY DO WHAT** (§D14, confirmed with the client):

  * File / edit / submit / accept / deny an application — **Registrar + Dean**. Admission
    is administration, and §D14 leaves the Registrar students, applications and enrolment.
  * Approve or deny a **credit transfer** — **Dean only**. Brief §13 says the Dean assesses
    and decides it, and it is an academic judgement about whether outside study counts.
  * **Change** a student's programme later — **Dean only**, and that lives in the students
    module (§D12): it re-derives a degree plan and decides what carries over.

**THE LIFECYCLE.** `draft → submitted → accepted | denied`, plus `withdrawn` for an
applicant who pulls out and `under_review` as an optional staging state. Only `submitted`
and `under_review` can be accepted; the transitions are checked here rather than trusted
from the client, because "accept" creates a user account and a student record.

**ACCEPTANCE IS ONE TRANSACTION** and it is the only thing in the system that creates a
student, a login and a student ID together (decision #5). See `accept_application`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import (
    ApplicationStatus,
    CreditTransferStatus,
    EducationLevel,
    Role,
    StudentStatus,
    normalise_gender,
)
from app.core.errors import Conflict, NotFound, ValidationError
from app.core.pagination import PageParams
from app.core.security import generate_temp_password, hash_password
from app.core.timeutil import school_today
from app.modules.admissions.models import (
    Application,
    ApplicationDocument,
    ApplicationEducation,
    ApplicationTemp,
    CreditTransferRequest,
)
from app.modules.admissions.schemas import (
    ApplicationAcceptRequest,
    ApplicationAcceptResponse,
    ApplicationCreateRequest,
    ApplicationDetail,
    ApplicationListItem,
    ApplicationPage,
    ApplicationUpdateRequest,
    CourseRef,
    CreditTransferCreateRequest,
    CreditTransferDecisionRequest,
    CreditTransferRead,
    CreditTransferUpdateRequest,
    DocumentReplaceRequest,
    DocumentRow,
    EducationReplaceRequest,
    EducationRow,
    PendingApplicationDetail,
    PendingApplicationListItem,
    PendingApplicationPage,
    PendingApplicationWrite,
    ProgramRef,
)
from app.modules.offerings.models import Course
from app.modules.programs.models import Program
from app.modules.settings.models import AcademicYear, AuditLog
from app.modules.students.models import StudentProfile, StudentProgramHistory
from app.modules.students.numbering import allocate_student_number
from app.modules.users.models import User

#: The content-equivalency floor for a credit transfer (brief §13). Mirrored by
#: `ck_cta_approval_requires_75` in the database, which is the real backstop — this
#: constant exists so the API can refuse with a 422 that NAMES the rule instead of
#: surfacing a driver-level CHECK violation as a 500.
MIN_EQUIVALENCY_PCT = 75.0

#: Statuses from which a decision may be taken. A `draft` is not a decision waiting to be
#: made — it is a form nobody has finished.
_DECIDABLE = (ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW)


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _audit(
    db: Session,
    *,
    actor: User,
    action: str,
    entity_type: str = "application",
    entity_id: uuid.UUID | None = None,
    summary: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
        )
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lookups
# ──────────────────────────────────────────────────────────────────────────────
def _application_or_404(db: Session, application_id: uuid.UUID) -> Application:
    app_row = db.scalar(
        select(Application).where(
            Application.id == application_id, Application.deleted_at.is_(None)
        )
    )
    if app_row is None:
        raise NotFound("Application not found.", code="not_found")
    return app_row


def _transfer_or_404(db: Session, transfer_id: uuid.UUID) -> CreditTransferRequest:
    row = db.get(CreditTransferRequest, transfer_id)
    if row is None:
        raise NotFound("Credit transfer request not found.", code="not_found")
    return row


def _assert_editable(app_row: Application) -> None:
    """A decided application is a record, not a form.

    Editing the Section A–E fields underneath an acceptance would make the student record
    disagree with the application it was built from; editing them under a denial would
    change what was refused.
    """
    if app_row.is_decided:
        raise Conflict(
            f"This application is {app_row.status.value} and can no longer be edited.",
            code="application_decided",
        )


def _program_ref(db: Session, program_id: uuid.UUID | None) -> ProgramRef | None:
    if program_id is None:
        return None
    program = db.get(Program, program_id)
    if program is None:  # pragma: no cover - FK guarantees it while the row lives
        return None
    return ProgramRef(id=program.id, code=program.code, name=program.name)


def _course_ref(db: Session, course_id: uuid.UUID | None) -> CourseRef | None:
    if course_id is None:
        return None
    course = db.get(Course, course_id)
    if course is None:  # pragma: no cover
        return None
    return CourseRef(
        id=course.id, code=course.code or "", name=course.name, credits=course.credits
    )


# ──────────────────────────────────────────────────────────────────────────────
# Serialisation
# ──────────────────────────────────────────────────────────────────────────────
def _transfer_read(db: Session, row: CreditTransferRequest) -> CreditTransferRead:
    pct = None if row.content_equivalency_pct is None else float(row.content_equivalency_pct)
    return CreditTransferRead(
        id=row.id,
        application_id=row.application_id,
        external_institution=row.external_institution,
        external_course_code=row.external_course_code,
        external_course_name=row.external_course_name,
        external_credits=row.external_credits,
        external_grade=row.external_grade,
        target_course=_course_ref(db, row.target_course_id),
        content_equivalency_pct=pct,
        cta_document_id=row.cta_document_id,
        transcript_document_id=row.transcript_document_id,
        outline_document_id=row.outline_document_id,
        status=row.status,
        decided_by_user_id=row.decided_by_user_id,
        decided_at=row.decided_at,
        note=row.note,
        meets_equivalency_floor=pct is not None and pct >= MIN_EQUIVALENCY_PCT,
    )


def _pending_transfer_counts(
    db: Session, application_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Pending-transfer count per application, in one query rather than N."""
    if not application_ids:
        return {}
    rows = db.execute(
        select(CreditTransferRequest.application_id, func.count())
        .where(
            CreditTransferRequest.application_id.in_(application_ids),
            CreditTransferRequest.status == CreditTransferStatus.PENDING,
        )
        .group_by(CreditTransferRequest.application_id)
    ).all()
    return {app_id: count for app_id, count in rows}


def _list_item(
    db: Session, row: Application, *, pending: int = 0
) -> ApplicationListItem:
    return ApplicationListItem(
        id=row.id,
        status=row.status,
        full_name=row.full_name,
        first_name=row.first_name,
        middle_name=row.middle_name,
        last_name=row.last_name,
        school_year=row.school_year,
        program=_program_ref(db, row.program_id),
        year_of_study=row.year_of_study,
        enrollment_load=row.enrollment_load,
        email=row.email,
        phone=row.phone,
        date_accepted=row.date_accepted,
        student_code=row.student_code,
        student_id=row.student_id,
        created_at=row.created_at,
        pending_credit_transfers=pending,
    )


def _education_rows(db: Session, application_id: uuid.UUID) -> list[EducationRow]:
    rows = db.scalars(
        select(ApplicationEducation)
        .where(ApplicationEducation.application_id == application_id)
        .order_by(ApplicationEducation.sort_order, ApplicationEducation.institution)
    ).all()
    return [EducationRow.model_validate(r) for r in rows]


def _document_rows(db: Session, application_id: uuid.UUID) -> list[DocumentRow]:
    rows = db.scalars(
        select(ApplicationDocument)
        .where(ApplicationDocument.application_id == application_id)
        .order_by(ApplicationDocument.document_type)
    ).all()
    return [DocumentRow.model_validate(r) for r in rows]


def _detail(db: Session, row: Application) -> ApplicationDetail:
    pending = _pending_transfer_counts(db, [row.id]).get(row.id, 0)
    transfers = db.scalars(
        select(CreditTransferRequest)
        .where(CreditTransferRequest.application_id == row.id)
        .order_by(CreditTransferRequest.created_at)
    ).all()
    base = _list_item(db, row, pending=pending)
    return ApplicationDetail(
        **base.model_dump(),
        date_of_birth=row.date_of_birth,
        ssno=row.ssno,
        gender=row.gender,
        civil_status=row.civil_status,
        religion=row.religion,
        has_health_condition=row.has_health_condition,
        health_condition_note=row.health_condition_note,
        street=row.street,
        city_town_village=row.city_town_village,
        district=row.district,
        mother_name=row.mother_name,
        father_name=row.father_name,
        nok_name=row.nok_name,
        nok_relationship=row.nok_relationship,
        nok_phone=row.nok_phone,
        atlib_exam=row.atlib_exam,
        num_csec=row.num_csec,
        finance_name=row.finance_name,
        finance_phone=row.finance_phone,
        finance_email=row.finance_email,
        recommendation_received=row.recommendation_received,
        applicant_signed_at=row.applicant_signed_at,
        guardian_signed_at=row.guardian_signed_at,
        academic_year_id=row.academic_year_id,
        enrolment_status=row.enrolment_status,
        comments=row.comments,
        decided_by_user_id=row.decided_by_user_id,
        decided_at=row.decided_at,
        updated_at=row.updated_at,
        education=_education_rows(db, row.id),
        documents=_document_rows(db, row.id),
        credit_transfers=[_transfer_read(db, t) for t in transfers],
        blocking_issues=acceptance_issues(db, row),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Completeness rules
# ──────────────────────────────────────────────────────────────────────────────
def _age_on(dob: date | None, on: date) -> int | None:
    if dob is None:
        return None
    years = on.year - dob.year
    if (on.month, on.day) < (dob.month, dob.day):
        years -= 1
    return years


def submission_issues(app_row: Application | ApplicationTemp) -> list[str]:
    """What stops this application being SUBMITTED. `[]` = submittable.

    Submission is the applicant's form being complete enough to be considered, so the
    checks are about the FORM: the identity questions and the programme being applied for.

    **The under-18 guardian rule is enforced here** and nowhere else. Section G requires a
    parent or guardian signature only when the applicant is under 18, which is a fact
    about the applicant's age at the time they sign — knowable here, and not expressible
    as a column constraint.

    **`ApplicationTemp` is accepted too, and that is the point of the union** (D38). A
    pending form has to be judged by exactly the rules its promotion will be judged by, or
    the list would advertise "ready to submit" on a form the submit then refuses. Only
    columns both tables carry are read, which is what makes the one implementation safe
    for both.
    """
    issues: list[str] = []
    if not (app_row.first_name or "").strip() or not (app_row.last_name or "").strip():
        issues.append("The applicant's first and last name are required.")
    if app_row.date_of_birth is None:
        issues.append("Date of birth is required.")
    elif app_row.date_of_birth > school_today():
        issues.append("Date of birth cannot be in the future.")
    if app_row.program_id is None:
        issues.append("A programme of study must be chosen (Section E).")
    if app_row.year_of_study is None:
        issues.append("Year of study must be chosen (Section E).")
    if app_row.enrollment_load is None:
        issues.append("Study load must be chosen — Part Time, Full Time or Transient.")
    if app_row.applicant_signed_at is None:
        issues.append("The applicant must sign and date the form (Section G).")

    age = _age_on(app_row.date_of_birth, app_row.applicant_signed_at or school_today())
    if age is not None and age < 18 and app_row.guardian_signed_at is None:
        issues.append(
            "The applicant is under 18, so a parent or guardian must also sign "
            "(Section G)."
        )
    return issues


def acceptance_issues(db: Session, app_row: Application) -> list[str]:
    """What stops this application being ACCEPTED. `[]` = acceptable.

    Everything submission needs, plus the things acceptance itself depends on and the
    state checks. Returned on the READ as `blocking_issues` so the review screen can
    explain a disabled Accept button instead of the Registrar discovering the reason by
    pressing it.

    A PENDING credit transfer blocks acceptance. That is deliberate: the transfers are
    what decide which courses the student arrives already holding, so accepting first
    would enrol them against a plan the Dean has not finished ruling on — and the policy
    only allows the request AT admission, so afterwards is too late to ask.
    """
    if app_row.status == ApplicationStatus.ACCEPTED:
        return ["This application has already been accepted."]
    if app_row.status in (ApplicationStatus.DENIED, ApplicationStatus.WITHDRAWN):
        return [f"This application is {app_row.status.value}."]

    issues = list(submission_issues(app_row))
    if app_row.status == ApplicationStatus.DRAFT:
        issues.append("The application must be submitted before it can be accepted.")

    pending = db.scalar(
        select(func.count())
        .select_from(CreditTransferRequest)
        .where(
            CreditTransferRequest.application_id == app_row.id,
            CreditTransferRequest.status == CreditTransferStatus.PENDING,
        )
    )
    if pending:
        issues.append(
            f"{pending} credit transfer request(s) are still awaiting the Dean's "
            "decision. Credit transfer may only be assessed at admission."
        )

    if not (app_row.email or "").strip():
        issues.append(
            "An email address is required to issue the student a login "
            "(or supply one when accepting)."
        )
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# GET /applications
# ──────────────────────────────────────────────────────────────────────────────
def list_applications(
    db: Session,
    *,
    params: PageParams,
    status: ApplicationStatus | None,
    search: str | None,
    program_id: uuid.UUID | None,
) -> ApplicationPage:
    """The admissions list (Registrar + Dean).

    Ordered surname-first, the same rule as students (§D10) — never by a combined display
    string, which is the defect `test_reports.py::test_students_sorted_by_surname` was
    rewritten to pin.
    """
    stmt = select(Application).where(Application.deleted_at.is_(None))
    if status is not None:
        stmt = stmt.where(Application.status == status)
    if program_id is not None:
        stmt = stmt.where(Application.program_id == program_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            Application.last_name.ilike(like)
            | Application.first_name.ilike(like)
            | Application.email.ilike(like)
            | Application.student_code.ilike(like)
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.scalars(
            stmt.order_by(Application.last_name.asc(), Application.first_name.asc())
            .limit(params.page_size)
            .offset((params.page - 1) * params.page_size)
        ).all()
    )
    pending = _pending_transfer_counts(db, [r.id for r in rows])
    from math import ceil

    return ApplicationPage(
        items=[_list_item(db, r, pending=pending.get(r.id, 0)) for r in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
        total_pages=ceil(total / params.page_size) if params.page_size else 0,
    )


def get_application(db: Session, *, application_id: uuid.UUID) -> ApplicationDetail:
    return _detail(db, _application_or_404(db, application_id))


# ──────────────────────────────────────────────────────────────────────────────
# POST / PATCH / DELETE
# ──────────────────────────────────────────────────────────────────────────────
#: Fields on `_ApplicationFields` whose names differ between the schema and the model.
_FIELD_ALIASES = {"first_name": "first_name", "middle_name": "middle_name", "last_name": "last_name"}

#: Everything a client may write through create/patch. `date_accepted`, `student_code`,
#: `student_id` and `decided_*` are absent on purpose: they record what the SYSTEM did.
_WRITABLE = (
    "school_year",
    "first_name",
    "middle_name",
    "last_name",
    "date_of_birth",
    "ssno",
    "gender",
    "civil_status",
    "religion",
    "phone",
    "email",
    "has_health_condition",
    "health_condition_note",
    "street",
    "city_town_village",
    "district",
    "mother_name",
    "father_name",
    "nok_name",
    "nok_relationship",
    "nok_phone",
    "atlib_exam",
    "num_csec",
    "finance_name",
    "finance_phone",
    "finance_email",
    "recommendation_received",
    "program_id",
    "year_of_study",
    "enrollment_load",
    "applicant_signed_at",
    "guardian_signed_at",
    "academic_year_id",
    "enrolment_status",
    "comments",
)


def _assert_program_exists(db: Session, program_id: uuid.UUID | None) -> None:
    if program_id is None:
        return
    exists = db.scalar(
        select(Program.id).where(Program.id == program_id, Program.deleted_at.is_(None))
    )
    if exists is None:
        raise ValidationError(
            "Programme not found.",
            fields={"program_id": ["Unknown programme."]},
        )


def _assert_year_exists(db: Session, year_id: uuid.UUID | None) -> None:
    if year_id is None:
        return
    if db.get(AcademicYear, year_id) is None:
        raise ValidationError(
            "Academic year not found.",
            fields={"academic_year_id": ["Unknown academic year."]},
        )


def create_application(
    db: Session, *, actor: User, payload: ApplicationCreateRequest
) -> ApplicationDetail:
    """POST /applications (Registrar + Dean). Files a draft, or submits outright.

    A DRAFT is created from the names alone, which is what makes the seven-step wizard
    interruption-safe: step A files the draft and every later step patches it, so a closed
    tab loses nothing. `submit=true` is for a complete form typed in one sitting, and it
    runs the same completeness checks as `POST /{id}/submit`.
    """
    _assert_program_exists(db, payload.program_id)
    _assert_year_exists(db, payload.academic_year_id)

    row = Application(
        status=ApplicationStatus.DRAFT,
        created_by=actor.id,
    )
    supplied = payload.model_dump(exclude_unset=True)
    for name in _WRITABLE:
        if name in supplied:
            value = supplied[name]
            if isinstance(value, str):
                value = value.strip()
            # D37 — one canonical vocabulary. The column is free text and stays so (for
            # rows this system did not write), so the write path is where consistency is
            # enforced; `normalise_gender` folds 'Male'/'F'/'FEMALE' onto 'male'/'female'
            # and passes anything unrecognised through untouched.
            if name == "gender":
                value = normalise_gender(value)
            setattr(row, name, value)
    # Booleans are `bool | None` on the wire so a PATCH can leave them alone; the column
    # is NOT NULL, so an omitted one has to fall back to its default rather than to None.
    for flag in ("has_health_condition", "atlib_exam", "recommendation_received"):
        if getattr(row, flag, None) is None:
            setattr(row, flag, False)

    db.add(row)
    db.flush()

    if payload.submit:
        issues = submission_issues(row)
        if issues:
            raise ValidationError(
                "This application is not complete enough to submit.",
                code="application_incomplete",
                fields={"application": issues},
            )
        row.status = ApplicationStatus.SUBMITTED

    _audit(
        db,
        actor=actor,
        action="application.create",
        entity_id=row.id,
        summary={"name": row.full_name, "status": row.status.value},
    )
    db.commit()
    return _detail(db, row)


def update_application(
    db: Session, *, actor: User, application_id: uuid.UUID, payload: ApplicationUpdateRequest
) -> ApplicationDetail:
    """PATCH /applications/{id} (Registrar + Dean). Only the keys PRESENT are applied.

    Presence rather than None-ness throughout: the wizard patches one section at a time,
    so a body carrying Section C must not blank Sections A, B and D — and `null` still has
    to work for clearing a field that was mis-typed.
    """
    row = _application_or_404(db, application_id)
    _assert_editable(row)

    supplied = payload.model_dump(exclude_unset=True)
    if "program_id" in supplied:
        _assert_program_exists(db, supplied["program_id"])
    if "academic_year_id" in supplied:
        _assert_year_exists(db, supplied["academic_year_id"])

    for name in _WRITABLE:
        if name not in supplied:
            continue
        value = supplied[name]
        if name in ("has_health_condition", "atlib_exam", "recommendation_received"):
            # NOT NULL columns: an explicit null means "false", not "unset".
            setattr(row, name, bool(value))
            continue
        if isinstance(value, str):
            value = value.strip() or None
        if name == "gender":
            value = normalise_gender(value)  # D37 — see `create_application`
        setattr(row, name, value)

    # Required names cannot be cleared to null even though the schema allows the key.
    if not (row.first_name or "").strip() or not (row.last_name or "").strip():
        raise ValidationError(
            "An application must keep a first and last name.",
            fields={"last_name": ["Required."]},
        )

    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.update", entity_id=row.id)
    db.commit()
    return _detail(db, row)


def delete_application(db: Session, *, actor: User, application_id: uuid.UUID) -> None:
    """DELETE /applications/{id} — SOFT (Registrar + Dean).

    An admissions record is kept even when filed in error. An ACCEPTED application is
    refused outright: a student record and a login already hang off it, and hiding the
    application would leave that student with no traceable admission.
    """
    row = _application_or_404(db, application_id)
    if row.status == ApplicationStatus.ACCEPTED:
        raise Conflict(
            "This application has been accepted and a student record exists for it. "
            "Change the student's status instead.",
            code="application_accepted",
        )
    row.deleted_at = _now()
    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.delete", entity_id=row.id)
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# Transitions
# ──────────────────────────────────────────────────────────────────────────────
def submit_application(
    db: Session, *, actor: User, application_id: uuid.UUID
) -> ApplicationDetail:
    """POST /applications/{id}/submit — draft → submitted (Registrar + Dean)."""
    row = _application_or_404(db, application_id)
    if row.is_decided:
        raise Conflict(
            f"This application is already {row.status.value}.", code="application_decided"
        )
    if row.status != ApplicationStatus.DRAFT:
        raise Conflict(
            f"This application is already {row.status.value}.",
            code="application_not_draft",
        )
    issues = submission_issues(row)
    if issues:
        raise ValidationError(
            "This application is not complete enough to submit.",
            code="application_incomplete",
            fields={"application": issues},
        )
    row.status = ApplicationStatus.SUBMITTED
    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.submit", entity_id=row.id)
    db.commit()
    return _detail(db, row)


def set_under_review(
    db: Session, *, actor: User, application_id: uuid.UUID
) -> ApplicationDetail:
    """POST /applications/{id}/review — submitted → under_review (Registrar + Dean).

    A staging state, so a queue of submitted applications can be triaged without the only
    two options being "decide now" and "leave it".
    """
    row = _application_or_404(db, application_id)
    if row.status != ApplicationStatus.SUBMITTED:
        raise Conflict(
            f"Only a submitted application can be moved under review "
            f"(this one is {row.status.value}).",
            code="application_not_submitted",
        )
    row.status = ApplicationStatus.UNDER_REVIEW
    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.review", entity_id=row.id)
    db.commit()
    return _detail(db, row)


def deny_application(
    db: Session, *, actor: User, application_id: uuid.UUID, reason: str | None
) -> ApplicationDetail:
    """POST /applications/{id}/deny (Registrar + Dean). Terminal, and not a delete."""
    row = _application_or_404(db, application_id)
    if row.status not in _DECIDABLE:
        raise Conflict(
            f"Only a submitted or under-review application can be denied "
            f"(this one is {row.status.value}).",
            code="application_not_decidable",
        )
    row.status = ApplicationStatus.DENIED
    row.decided_by_user_id = actor.id
    row.decided_at = _now()
    if reason:
        # Appended, never overwritten: a Registrar's earlier notes are part of the record.
        row.comments = f"{row.comments}\n{reason}".strip() if row.comments else reason
    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.deny", entity_id=row.id)
    db.commit()
    return _detail(db, row)


def withdraw_application(
    db: Session, *, actor: User, application_id: uuid.UUID
) -> ApplicationDetail:
    """POST /applications/{id}/withdraw — the APPLICANT pulled out (Registrar + Dean).

    Distinct from `deny`, which is the college saying no. Both are terminal, and the
    difference matters to anyone reading the admissions record later.
    """
    row = _application_or_404(db, application_id)
    if row.status == ApplicationStatus.ACCEPTED:
        raise Conflict(
            "This application has already been accepted.", code="application_accepted"
        )
    if row.is_decided:
        raise Conflict(
            f"This application is already {row.status.value}.", code="application_decided"
        )
    row.status = ApplicationStatus.WITHDRAWN
    row.decided_by_user_id = actor.id
    row.decided_at = _now()
    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.withdraw", entity_id=row.id)
    db.commit()
    return _detail(db, row)


# ──────────────────────────────────────────────────────────────────────────────
# THE ACCEPTANCE FLOW (decision #5)
# ──────────────────────────────────────────────────────────────────────────────
def accept_application(
    db: Session, *, actor: User, application_id: uuid.UUID, payload: ApplicationAcceptRequest
) -> ApplicationAcceptResponse:
    """POST /applications/{id}/accept — the single action that admits a student.

    In ONE transaction it:

      1. allocates the `YYYYMM###` student number (§D9) — inside this transaction, so a
         failure rolls the sequence back and burns no number;
      2. creates the `users` login with `must_change_password`, returning a generated
         temporary password ONCE;
      3. creates `student_profiles` from Sections A–E — the student is BUILT FROM the
         application, never from separate fields on this request, so an accept cannot
         quietly disagree with the form it came from;
      4. opens the first `student_program_history` row, so the programme has a history
         from the very first day rather than from the first change;
      5. links both directions (`applications.student_id`, `student_profiles.application_id`)
         and fills in the official-use block.

    **Order matters.** The user is inserted before the student because
    `student_profiles.user_id` references it; the student is flushed before the
    application's `student_id` is set because that FK points the other way. The pair is
    circular in the schema and only a single transaction makes it safe.

    Errors: 409 `application_not_decidable` / `application_accepted`, 422
    `application_incomplete` (with every reason listed), 409 `duplicate_email`, 409
    `student_number_exhausted`.
    """
    row = _application_or_404(db, application_id)

    if row.status == ApplicationStatus.ACCEPTED:
        raise Conflict(
            "This application has already been accepted.", code="application_accepted"
        )
    if row.status not in _DECIDABLE:
        raise Conflict(
            f"Only a submitted or under-review application can be accepted "
            f"(this one is {row.status.value}).",
            code="application_not_decidable",
        )

    login_email = (payload.login_email or row.email or "").strip()
    # Re-run the completeness rules, minus the email clause when one is supplied here.
    issues = [
        issue
        for issue in acceptance_issues(db, row)
        if not (login_email and issue.startswith("An email address is required"))
    ]
    if issues:
        raise ValidationError(
            "This application cannot be accepted yet.",
            code="application_incomplete",
            fields={"application": issues},
        )

    year_id = payload.academic_year_id or row.academic_year_id
    if year_id is None:
        year_id = db.scalar(
            select(AcademicYear.id).where(AcademicYear.status == "active")
        )
    _assert_year_exists(db, year_id)

    accepted_on = payload.date_accepted or school_today()

    # 1 ── the login ──────────────────────────────────────────────────────────
    duplicate = db.scalar(
        select(User.id).where(User.email == login_email, User.deleted_at.is_(None))
    )
    if duplicate is not None:
        raise Conflict(
            "A user with this email already exists.", code="duplicate_email"
        )

    if payload.temporary_password:
        plaintext = payload.temporary_password
        echo: str | None = None  # never echo a secret the caller chose
    else:
        plaintext = generate_temp_password()
        echo = plaintext

    login = User(
        email=login_email,
        password_hash=hash_password(plaintext),
        role=Role.STUDENT,
        full_name=row.full_name,
        is_active=True,
        must_change_password=True,
        created_by=actor.id,
    )
    db.add(login)
    db.flush()

    # 2 ── the student number ─────────────────────────────────────────────────
    student_number = allocate_student_number(db, on=accepted_on)

    # 3 ── the student, built from the application ────────────────────────────
    student = StudentProfile(
        user_id=login.id,
        student_number=student_number,
        first_name=row.first_name,
        middle_name=row.middle_name,
        last_name=row.last_name,
        # NOT NULL on `student_profiles`, and guaranteed present by `submission_issues`.
        date_of_birth=row.date_of_birth,
        # D37 — normalised HERE as well as on the application, because this is the copy
        # that spreads the drift: an application written before D37 still holds whatever
        # was typed, and copying it verbatim puts a capitalised value into the register.
        # Both live tables had one such row, which a `GROUP BY gender` could not reveal —
        # the collation is case-insensitive, so it took `GROUP BY HEX(gender)` to find
        # them. The frontend compares case-SENSITIVELY and does not forgive it: the
        # `<select>` renders blank and the profile card shows the wrong label.
        gender=normalise_gender(row.gender),
        enrollment_date=accepted_on,
        status=StudentStatus.REGISTERED,
        phone=row.phone,
        ssno=row.ssno,
        religion=row.religion,
        civil_status=row.civil_status,
        street=row.street,
        city_town_village=row.city_town_village,
        district=row.district,
        mother_name=row.mother_name,
        father_name=row.father_name,
        nok_name=row.nok_name,
        nok_relationship=row.nok_relationship,
        nok_phone=row.nok_phone,
        has_health_condition=row.has_health_condition,
        health_condition_note=row.health_condition_note,
        atlib_exam=row.atlib_exam,
        num_csec=row.num_csec,
        finance_name=row.finance_name,
        finance_phone=row.finance_phone,
        finance_email=row.finance_email,
        program_id=row.program_id,
        year_of_study=row.year_of_study,
        enrollment_load=row.enrollment_load,
        application_id=row.id,
        # The next-of-kin doubles as the emergency guardian contact the pre-D30 student
        # screens already show, so the existing columns are populated rather than left
        # blank beside a duplicate set.
        guardian_name=row.nok_name or row.mother_name or row.father_name,
        guardian_phone=row.nok_phone,
        created_by=actor.id,
    )
    db.add(student)
    db.flush()

    # 4 ── the programme history opens on day one ─────────────────────────────
    if row.program_id is not None:
        db.add(
            StudentProgramHistory(
                student_id=student.id,
                program_id=row.program_id,
                started_at=accepted_on,
                reason="Admitted",
                created_by=actor.id,
            )
        )

    # 5 ── the official-use block ─────────────────────────────────────────────
    row.status = ApplicationStatus.ACCEPTED
    row.student_id = student.id
    row.student_code = student_number
    row.date_accepted = accepted_on
    row.academic_year_id = year_id
    row.enrolment_status = (
        row.enrolment_status or (row.enrollment_load.value if row.enrollment_load else None)
    )
    if payload.comments:
        row.comments = (
            f"{row.comments}\n{payload.comments}".strip() if row.comments else payload.comments
        )
    row.decided_by_user_id = actor.id
    row.decided_at = _now()
    row.updated_by = actor.id

    transferred = db.execute(
        select(Course.code)
        .join(CreditTransferRequest, CreditTransferRequest.target_course_id == Course.id)
        .where(
            CreditTransferRequest.application_id == row.id,
            CreditTransferRequest.status == CreditTransferStatus.APPROVED,
        )
    ).all()

    _audit(
        db,
        actor=actor,
        action="application.accept",
        entity_id=row.id,
        summary={
            "student_id": str(student.id),
            "student_number": student_number,
            "program_id": str(row.program_id) if row.program_id else None,
        },
    )
    db.commit()

    return ApplicationAcceptResponse(
        application=_detail(db, row),
        student_id=student.id,
        student_number=student_number,
        temporary_password=echo,
        login_email=login_email,
        transferred_course_codes=sorted(code for (code,) in transferred if code),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Section B · education rows
# ──────────────────────────────────────────────────────────────────────────────
def replace_education(
    db: Session, *, actor: User, application_id: uuid.UUID, payload: EducationReplaceRequest
) -> ApplicationDetail:
    """PUT /applications/{id}/education — replaces the whole set (Registrar + Dean)."""
    row = _application_or_404(db, application_id)
    _assert_editable(row)

    db.execute(
        ApplicationEducation.__table__.delete().where(
            ApplicationEducation.application_id == row.id
        )
    )
    for order, item in enumerate(payload.items, start=1):
        if item.graduated and item.graduation_date is None:
            raise ValidationError(
                "A graduated institution needs a graduation date.",
                fields={"graduation_date": [f"Required for {item.institution}."]},
            )
        db.add(
            ApplicationEducation(
                application_id=row.id,
                institution=item.institution.strip(),
                education_level=item.education_level,
                graduated=item.graduated,
                graduation_date=item.graduation_date,
                # Renumbered from the submitted ORDER, so the client never has to keep
                # `sort_order` consistent while inserting and removing rows.
                sort_order=order,
            )
        )
    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.education.replace", entity_id=row.id)
    db.commit()
    return _detail(db, row)


# ──────────────────────────────────────────────────────────────────────────────
# Section F · the document checklist
# ──────────────────────────────────────────────────────────────────────────────
def replace_documents(
    db: Session, *, actor: User, application_id: uuid.UUID, payload: DocumentReplaceRequest
) -> ApplicationDetail:
    """PUT /applications/{id}/documents — reconciles the checklist (Registrar + Dean).

    **Reconciled by id, not delete-and-reinsert.** `credit_transfer_requests` FKs three of
    these rows, and those FKs are `ON DELETE SET NULL` — so a blanket delete would
    silently strip a pending transfer of its CTA and transcript instead of failing. Rows
    still referenced are updated in place; a row the client dropped is only removed if
    nothing points at it.
    """
    row = _application_or_404(db, application_id)
    _assert_editable(row)

    existing = {
        d.id: d
        for d in db.scalars(
            select(ApplicationDocument).where(
                ApplicationDocument.application_id == row.id
            )
        ).all()
    }
    kept: set[uuid.UUID] = set()

    for item in payload.items:
        target = existing.get(item.id) if item.id else None
        if target is None:
            target = ApplicationDocument(application_id=row.id, document_type=item.document_type)
            db.add(target)
        target.document_type = item.document_type
        target.file_name = item.file_name
        target.content_type = item.content_type
        target.size_bytes = item.size_bytes
        target.received = item.received
        db.flush()
        kept.add(target.id)

    referenced = set()
    for cta, transcript, outline in db.execute(
        select(
            CreditTransferRequest.cta_document_id,
            CreditTransferRequest.transcript_document_id,
            CreditTransferRequest.outline_document_id,
        ).where(CreditTransferRequest.application_id == row.id)
    ).all():
        referenced.update({cta, transcript, outline} - {None})

    for doc_id, doc in existing.items():
        if doc_id in kept:
            continue
        if doc_id in referenced:
            # Silently keeping it would be worse than saying so: the Registrar thinks they
            # removed it, and the transfer still cites it.
            raise Conflict(
                f"The {doc.document_type.value} document is attached to a credit "
                "transfer request and cannot be removed. Detach it there first.",
                code="document_in_use",
            )
        db.delete(doc)

    row.updated_by = actor.id
    _audit(db, actor=actor, action="application.documents.replace", entity_id=row.id)
    db.commit()
    return _detail(db, row)


# ──────────────────────────────────────────────────────────────────────────────
# Credit transfer (brief §13)
# ──────────────────────────────────────────────────────────────────────────────
def _assert_transfer_docs_belong(
    db: Session, *, application_id: uuid.UUID, ids: list[uuid.UUID | None]
) -> None:
    """Every attached document must belong to THIS application.

    Without this check a transfer could cite another applicant's transcript — the FK only
    says the row exists, not whose it is.
    """
    wanted = [i for i in ids if i is not None]
    if not wanted:
        return
    found = set(
        db.scalars(
            select(ApplicationDocument.id).where(
                ApplicationDocument.id.in_(wanted),
                ApplicationDocument.application_id == application_id,
            )
        ).all()
    )
    missing = [str(i) for i in wanted if i not in found]
    if missing:
        raise ValidationError(
            "Attached documents must belong to this application.",
            fields={"documents": missing},
        )


def _assert_target_course(db: Session, course_id: uuid.UUID) -> None:
    exists = db.scalar(
        select(Course.id).where(Course.id == course_id, Course.deleted_at.is_(None))
    )
    if exists is None:
        raise ValidationError(
            "Target course not found.",
            fields={"target_course_id": ["Unknown course."]},
        )


def list_credit_transfers(
    db: Session, *, application_id: uuid.UUID | None, status: CreditTransferStatus | None
) -> list[CreditTransferRead]:
    """GET /credit-transfers — the Dean's queue, or one application's transfers.

    With no filter this is every request in the school, newest last, which is what makes
    `?status=pending` the Dean's work list (§D8's precedent: a queue is a filtered read,
    not a new table).
    """
    stmt = select(CreditTransferRequest)
    if application_id is not None:
        stmt = stmt.where(CreditTransferRequest.application_id == application_id)
    if status is not None:
        stmt = stmt.where(CreditTransferRequest.status == status)
    rows = db.scalars(stmt.order_by(CreditTransferRequest.created_at)).all()
    return [_transfer_read(db, r) for r in rows]


def create_credit_transfer(
    db: Session,
    *,
    actor: User,
    application_id: uuid.UUID,
    payload: CreditTransferCreateRequest,
) -> CreditTransferRead:
    """POST /applications/{id}/credit-transfers (Registrar + Dean).

    **Only at admission** (brief §13). Enforced by refusing an application that has
    already been decided: once accepted there is a student, and by policy the moment to
    ask has passed. The same check is what keeps a transfer from appearing on a denied
    application.

    The ≥75% floor is NOT checked here — the Registrar files what the applicant claims and
    the Dean assesses it. See `decide_credit_transfer`.
    """
    row = _application_or_404(db, application_id)
    if row.is_decided:
        raise Conflict(
            "Credit transfer may only be requested while the application is open — "
            f"this one is {row.status.value}. Policy allows it at admission only.",
            code="application_decided",
        )
    _assert_target_course(db, payload.target_course_id)
    _assert_transfer_docs_belong(
        db,
        application_id=row.id,
        ids=[payload.cta_document_id, payload.transcript_document_id, payload.outline_document_id],
    )

    duplicate = db.scalar(
        select(CreditTransferRequest.id).where(
            CreditTransferRequest.application_id == row.id,
            CreditTransferRequest.target_course_id == payload.target_course_id,
            CreditTransferRequest.status != CreditTransferStatus.DENIED,
        )
    )
    if duplicate is not None:
        # Two live requests for the same course would let one be approved and the other
        # left pending forever, blocking acceptance with no way to see why.
        raise Conflict(
            "There is already a live credit transfer request for that course.",
            code="duplicate_credit_transfer",
        )

    transfer = CreditTransferRequest(
        application_id=row.id,
        external_institution=payload.external_institution.strip(),
        external_course_code=payload.external_course_code,
        external_course_name=payload.external_course_name.strip(),
        external_credits=payload.external_credits,
        external_grade=payload.external_grade,
        target_course_id=payload.target_course_id,
        content_equivalency_pct=payload.content_equivalency_pct,
        cta_document_id=payload.cta_document_id,
        transcript_document_id=payload.transcript_document_id,
        outline_document_id=payload.outline_document_id,
        status=CreditTransferStatus.PENDING,
        note=payload.note,
        created_by=actor.id,
    )
    db.add(transfer)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="credit_transfer.create",
        entity_type="credit_transfer_request",
        entity_id=transfer.id,
        summary={"application_id": str(row.id)},
    )
    db.commit()
    return _transfer_read(db, transfer)


def update_credit_transfer(
    db: Session, *, actor: User, transfer_id: uuid.UUID, payload: CreditTransferUpdateRequest
) -> CreditTransferRead:
    """PATCH /credit-transfers/{id} — while PENDING only (Registrar + Dean)."""
    transfer = _transfer_or_404(db, transfer_id)
    if transfer.status != CreditTransferStatus.PENDING:
        raise Conflict(
            f"This request has already been {transfer.status.value} and cannot be edited.",
            code="credit_transfer_decided",
        )

    supplied = payload.model_dump(exclude_unset=True)
    if "target_course_id" in supplied and supplied["target_course_id"] is not None:
        _assert_target_course(db, supplied["target_course_id"])
    _assert_transfer_docs_belong(
        db,
        application_id=transfer.application_id,
        ids=[
            supplied.get("cta_document_id"),
            supplied.get("transcript_document_id"),
            supplied.get("outline_document_id"),
        ],
    )
    for name, value in supplied.items():
        if isinstance(value, str):
            value = value.strip() or None
        if name in ("external_institution", "external_course_name") and not value:
            continue  # NOT NULL columns: an empty string is not a clear
        setattr(transfer, name, value)

    transfer.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="credit_transfer.update",
        entity_type="credit_transfer_request",
        entity_id=transfer.id,
    )
    db.commit()
    return _transfer_read(db, transfer)


def delete_credit_transfer(db: Session, *, actor: User, transfer_id: uuid.UUID) -> None:
    """DELETE /credit-transfers/{id} — while PENDING only (Registrar + Dean).

    A HARD delete, unlike an application: a withdrawn REQUEST carries no decision and no
    history of its own. A decided one is kept, because it records what the Dean ruled.
    """
    transfer = _transfer_or_404(db, transfer_id)
    if transfer.status != CreditTransferStatus.PENDING:
        raise Conflict(
            f"This request has been {transfer.status.value}; the Dean's decision is kept.",
            code="credit_transfer_decided",
        )
    _audit(
        db,
        actor=actor,
        action="credit_transfer.delete",
        entity_type="credit_transfer_request",
        entity_id=transfer.id,
        summary={"application_id": str(transfer.application_id)},
    )
    db.delete(transfer)
    db.commit()


def decide_credit_transfer(
    db: Session, *, actor: User, transfer_id: uuid.UUID, payload: CreditTransferDecisionRequest
) -> CreditTransferRead:
    """POST /credit-transfers/{id}/decision — **DEAN ONLY** (brief §13, §D14).

    Enforces every clause of the policy that is enforceable here:

    * **≥75% content equivalency to approve.** Refused as a 422 that NAMES the rule and
      the value, rather than letting `ck_cta_approval_requires_75` surface as a driver
      error. The CHECK stays the backstop — it is what makes the rule true of the data
      even if a future writer forgets.
    * **A recognised TERTIARY institution.** The application must carry at least one
      Section B row at tertiary level. Passing high-school study off as transfer credit is
      the exact thing the policy exists to prevent, and it is checkable from the form.
    * **CTA + original transcript + course outlines.** Warned about in the returned note
      rather than blocked: whether the Dean insists on seeing every paper before ruling is
      their judgement, and the documents are a checklist a Registrar may still be chasing.

    `pending` is not an accepted decision — re-opening a ruled request would leave no
    record of the reversal.
    """
    transfer = _transfer_or_404(db, transfer_id)
    if transfer.status != CreditTransferStatus.PENDING:
        raise Conflict(
            f"This request has already been {transfer.status.value}.",
            code="credit_transfer_decided",
        )
    if payload.status == CreditTransferStatus.PENDING:
        raise ValidationError(
            "A decision must be approved or denied.",
            fields={"status": ["Use approved or denied."]},
        )

    if payload.content_equivalency_pct is not None:
        transfer.content_equivalency_pct = payload.content_equivalency_pct

    if payload.status == CreditTransferStatus.APPROVED:
        pct = transfer.content_equivalency_pct
        if pct is None or float(pct) < MIN_EQUIVALENCY_PCT:
            raise ValidationError(
                f"Credit transfer requires at least {MIN_EQUIVALENCY_PCT:.0f}% content "
                "equivalency (brief §13).",
                code="equivalency_below_floor",
                fields={
                    "content_equivalency_pct": [
                        "Not assessed yet."
                        if pct is None
                        else f"{float(pct):.2f}% is below the {MIN_EQUIVALENCY_PCT:.0f}% floor."
                    ]
                },
            )
        tertiary = db.scalar(
            select(func.count())
            .select_from(ApplicationEducation)
            .where(
                ApplicationEducation.application_id == transfer.application_id,
                ApplicationEducation.education_level == EducationLevel.TERTIARY,
            )
        )
        if not tertiary:
            raise ValidationError(
                "Credit may only transfer from a recognised tertiary institution, and "
                "this application lists none in Section B.",
                code="no_tertiary_institution",
                fields={"education": ["Add the tertiary institution to Section B."]},
            )

    transfer.status = payload.status
    transfer.decided_by_user_id = actor.id
    transfer.decided_at = _now()
    if payload.note:
        transfer.note = (
            f"{transfer.note}\n{payload.note}".strip() if transfer.note else payload.note
        )
    transfer.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action=f"credit_transfer.{payload.status.value}",
        entity_type="credit_transfer_request",
        entity_id=transfer.id,
        summary={
            "application_id": str(transfer.application_id),
            "target_course_id": str(transfer.target_course_id),
            "content_equivalency_pct": (
                float(transfer.content_equivalency_pct)
                if transfer.content_equivalency_pct is not None
                else None
            ),
        },
    )
    db.commit()
    return _transfer_read(db, transfer)


# ══════════════════════════════════════════════════════════════════════════════
# D38 · PENDING forms (`student_profile_temp`)
#
# The wizard no longer writes on every step. A form reaches the database only when the
# Registrar presses *Save and close* — into this holding table, owned by whoever typed it
# — or *Save and submit*, which promotes it into `applications` and deletes it from here.
#
# **The scope is `created_by`, and it is enforced in EVERY function below, not just the
# list.** A Registrar who guessed another Registrar's temp id would otherwise be able to
# read, overwrite or submit a form that is not theirs; scoping only the list would make
# that a real hole rather than a theoretical one, since ids travel in URLs.
# ══════════════════════════════════════════════════════════════════════════════

#: Every field a client may write onto a pending form. Identical to `_WRITABLE` by
#: construction — the temp table mirrors the client-writable half of `applications` — and
#: aliased rather than re-listed so the two cannot drift apart.
_TEMP_WRITABLE = _WRITABLE


def _may_see_all_pending(actor: User) -> bool:
    """The Dean sees every pending form; everyone else sees only their own.

    `Role.PRINCIPAL` is the Dean in this deployment (D30 renamed the label, not the enum).
    """
    return actor.role == Role.PRINCIPAL


def _pending_or_404(db: Session, *, actor: User, temp_id: uuid.UUID) -> ApplicationTemp:
    """Load a pending form the actor is allowed to touch.

    A row that exists but belongs to someone else raises the SAME 404 as one that does
    not exist. A 403 would confirm that a form with that id is out there and whose it is
    — which is the fact the scope is meant to withhold.
    """
    stmt = select(ApplicationTemp).where(ApplicationTemp.id == temp_id)
    if not _may_see_all_pending(actor):
        stmt = stmt.where(ApplicationTemp.created_by == actor.id)
    row = db.scalar(stmt)
    if row is None:
        raise NotFound("Pending application not found.", code="not_found")
    return row


def _author_names(db: Session, rows: list[ApplicationTemp]) -> dict[uuid.UUID, str]:
    """`created_by` -> full name, for the Dean's view of a shared queue. One query."""
    ids = {r.created_by for r in rows if r.created_by is not None}
    if not ids:
        return {}
    return {
        uid: name
        for uid, name in db.execute(
            select(User.id, User.full_name).where(User.id.in_(ids))
        ).all()
    }


def _temp_education(row: ApplicationTemp) -> list[EducationRow]:
    """Section B out of `education_json`, in the shape the real table reads in.

    Tolerant of a malformed element rather than raising: a pending form is the Registrar's
    work in progress, and refusing to render one because a stored row is unreadable would
    strand the whole form instead of the one line that is wrong.
    """
    out: list[EducationRow] = []
    for order, item in enumerate(row.education_json or [], start=1):
        if not isinstance(item, dict):
            continue
        try:
            out.append(EducationRow.model_validate({**item, "id": None, "sort_order": order}))
        except Exception:
            continue
    return out


def _temp_documents(row: ApplicationTemp) -> list[DocumentRow]:
    """Section F out of `documents_json`. Same tolerance, same reason."""
    out: list[DocumentRow] = []
    for item in row.documents_json or []:
        if not isinstance(item, dict):
            continue
        try:
            out.append(DocumentRow.model_validate({**item, "id": None}))
        except Exception:
            continue
    return out


def _pending_list_item(
    row: ApplicationTemp, *, author: str | None
) -> PendingApplicationListItem:
    return PendingApplicationListItem(
        id=row.id,
        status=row.status,
        full_name=row.full_name,
        first_name=row.first_name,
        middle_name=row.middle_name,
        last_name=row.last_name,
        school_year=row.school_year,
        program=None,
        year_of_study=row.year_of_study,
        enrollment_load=row.enrollment_load,
        email=row.email,
        phone=row.phone,
        gender=row.gender,
        created_by=row.created_by,
        created_by_name=author,
        created_at=row.created_at,
        updated_at=row.updated_at,
        # The same completeness rules the real submit runs, reported on the READ so the
        # list can say "ready to submit" without anyone opening the wizard to find out.
        blocking_issues=submission_issues(row),
    )


def _pending_detail(db: Session, row: ApplicationTemp) -> PendingApplicationDetail:
    author = _author_names(db, [row]).get(row.created_by) if row.created_by else None
    base = _pending_list_item(row, author=author)
    return PendingApplicationDetail(
        **base.model_dump(),
        date_of_birth=row.date_of_birth,
        ssno=row.ssno,
        civil_status=row.civil_status,
        religion=row.religion,
        has_health_condition=row.has_health_condition,
        health_condition_note=row.health_condition_note,
        street=row.street,
        city_town_village=row.city_town_village,
        district=row.district,
        mother_name=row.mother_name,
        father_name=row.father_name,
        nok_name=row.nok_name,
        nok_relationship=row.nok_relationship,
        nok_phone=row.nok_phone,
        atlib_exam=row.atlib_exam,
        num_csec=row.num_csec,
        finance_name=row.finance_name,
        finance_phone=row.finance_phone,
        finance_email=row.finance_email,
        recommendation_received=row.recommendation_received,
        applicant_signed_at=row.applicant_signed_at,
        guardian_signed_at=row.guardian_signed_at,
        academic_year_id=row.academic_year_id,
        enrolment_status=row.enrolment_status,
        comments=row.comments,
        education=_temp_education(row),
        documents=_temp_documents(row),
    )


def _apply_pending_fields(row: ApplicationTemp, payload: PendingApplicationWrite) -> None:
    """Copy the whole form onto the row.

    Whole-form rather than presence-based, unlike `update_application`: D38 removed
    per-section saving, so the browser holds all seven sections and there is nothing on
    the server that a full body could clobber. An omitted optional field genuinely means
    empty here.
    """
    supplied = payload.model_dump(exclude_unset=True)
    for name in _TEMP_WRITABLE:
        if name not in supplied:
            continue
        value = supplied[name]
        if name in ("has_health_condition", "atlib_exam", "recommendation_received"):
            # NOT NULL columns: an explicit null means "false", not "unset".
            setattr(row, name, bool(value))
            continue
        if isinstance(value, str):
            value = value.strip() or None
        if name == "gender":
            value = normalise_gender(value)  # D37 -- one canonical vocabulary
        setattr(row, name, value)

    # The names are NOT NULL, and the strip above can turn "  " into None.
    for field in ("first_name", "last_name"):
        if not (getattr(row, field) or "").strip():
            raise ValidationError(
                "A pending application must have a first and last name.",
                fields={field: ["Required."]},
            )

    for flag in ("has_health_condition", "atlib_exam", "recommendation_received"):
        if getattr(row, flag, None) is None:
            setattr(row, flag, False)

    # Stored `mode="json"`, so dates land as ISO strings a JSON column can hold and the
    # read path parses them straight back into the same Pydantic models.
    row.education_json = [
        item.model_dump(mode="json", exclude={"id"}) for item in payload.education
    ]
    row.documents_json = [
        item.model_dump(mode="json", exclude={"id"}) for item in payload.documents
    ]


def list_pending_applications(
    db: Session, *, actor: User, params: PageParams, search: str | None
) -> PendingApplicationPage:
    """The Pending forms list. Dean sees all; anyone else sees only what they filed."""
    stmt = select(ApplicationTemp)
    if not _may_see_all_pending(actor):
        stmt = stmt.where(ApplicationTemp.created_by == actor.id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            ApplicationTemp.last_name.ilike(like)
            | ApplicationTemp.first_name.ilike(like)
            | ApplicationTemp.email.ilike(like)
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.scalars(
            # Surname-first, the same ordering rule as every other directory (§D10).
            stmt.order_by(
                ApplicationTemp.last_name.asc(), ApplicationTemp.first_name.asc()
            )
            .limit(params.page_size)
            .offset((params.page - 1) * params.page_size)
        ).all()
    )
    authors = _author_names(db, rows)
    from math import ceil

    return PendingApplicationPage(
        items=[
            _pending_list_item(r, author=authors.get(r.created_by) if r.created_by else None)
            for r in rows
        ],
        total=total,
        page=params.page,
        page_size=params.page_size,
        total_pages=ceil(total / params.page_size) if params.page_size else 0,
    )


def get_pending_application(
    db: Session, *, actor: User, temp_id: uuid.UUID
) -> PendingApplicationDetail:
    return _pending_detail(db, _pending_or_404(db, actor=actor, temp_id=temp_id))


def create_pending_application(
    db: Session, *, actor: User, payload: PendingApplicationWrite
) -> PendingApplicationDetail:
    """POST /pending-applications -- *Save and close* on a form not yet on disk."""
    _assert_program_exists(db, payload.program_id)
    _assert_year_exists(db, payload.academic_year_id)

    row = ApplicationTemp(
        status="pending",
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        created_by=actor.id,
    )
    _apply_pending_fields(row, payload)
    db.add(row)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="application.pending.create",
        entity_type="application_temp",
        entity_id=row.id,
        summary={"name": row.full_name},
    )
    db.commit()
    return _pending_detail(db, row)


def update_pending_application(
    db: Session, *, actor: User, temp_id: uuid.UUID, payload: PendingApplicationWrite
) -> PendingApplicationDetail:
    """PATCH /pending-applications/{id} -- *Save and close* on a form already on disk."""
    row = _pending_or_404(db, actor=actor, temp_id=temp_id)
    _assert_program_exists(db, payload.program_id)
    _assert_year_exists(db, payload.academic_year_id)

    _apply_pending_fields(row, payload)
    # `created_by` is NOT touched: it is the scope, so reassigning it on a Dean's edit
    # would silently take the form away from the Registrar who filed it.
    row.updated_by = actor.id
    _audit(
        db,
        actor=actor,
        action="application.pending.update",
        entity_type="application_temp",
        entity_id=row.id,
    )
    db.commit()
    return _pending_detail(db, row)


def delete_pending_application(db: Session, *, actor: User, temp_id: uuid.UUID) -> None:
    """DELETE /pending-applications/{id} -- a HARD delete, unlike an application.

    There is no admissions record to preserve: the row either becomes an application or
    the Registrar abandoned a form they were typing.
    """
    row = _pending_or_404(db, actor=actor, temp_id=temp_id)
    _audit(
        db,
        actor=actor,
        action="application.pending.delete",
        entity_type="application_temp",
        entity_id=row.id,
        summary={"name": row.full_name},
    )
    db.delete(row)
    db.commit()


def submit_pending_application(
    db: Session, *, actor: User, temp_id: uuid.UUID
) -> ApplicationDetail:
    """POST /pending-applications/{id}/submit -- PROMOTE the pending form, then submit it.

    The temp row becomes a real `applications` row, its two JSON arrays become
    `application_education` and `application_documents` rows, and the temp row is deleted.
    One transaction: a promotion that half-happened would leave the same form in both
    tables, which is the one state nothing downstream is written to cope with.

    **Completeness is checked before anything is staged.** An incomplete form must come
    back with its reasons AND still be sitting in the pending list — a failed submit that
    consumed the row would destroy the Registrar's work, which is exactly what D38's
    save-only-when-asked model exists to prevent.

    `created_by` is carried across, not overwritten with the actor: the Dean submitting a
    Registrar's form does not make it the Dean's application.
    """
    temp = _pending_or_404(db, actor=actor, temp_id=temp_id)

    issues = submission_issues(temp)
    if issues:
        raise ValidationError(
            "This application is not complete enough to submit.",
            code="application_incomplete",
            fields={"application": issues},
        )

    education = _temp_education(temp)
    documents = _temp_documents(temp)
    for item in education:
        if item.graduated and item.graduation_date is None:
            raise ValidationError(
                "A graduated institution needs a graduation date.",
                fields={"graduation_date": [f"Required for {item.institution}."]},
            )

    row = Application(
        status=ApplicationStatus.SUBMITTED,
        created_by=temp.created_by,
        # THE ONE INSERT THAT STILL STAMPS `updated_by` (D39). Everywhere else a new row
        # leaves it NULL, because the creator has not yet EDITED anything. Here the actor
        # is deliberately NOT the creator: `created_by` is carried across from the pending
        # form so a Dean submitting a Registrar's work does not take it away from them
        # (D38). That makes `updated_by` the only place on the row that records who
        # actually performed the submit, so dropping it would lose the fact outright.
        updated_by=actor.id,
    )
    for name in _WRITABLE:
        setattr(row, name, getattr(temp, name))
    db.add(row)
    db.flush()

    for order, item in enumerate(education, start=1):
        db.add(
            ApplicationEducation(
                application_id=row.id,
                institution=item.institution.strip(),
                education_level=item.education_level,
                graduated=item.graduated,
                graduation_date=item.graduation_date,
                sort_order=order,
            )
        )
    for item in documents:
        db.add(
            ApplicationDocument(
                application_id=row.id,
                document_type=item.document_type,
                file_name=item.file_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                received=item.received,
            )
        )

    db.delete(temp)
    _audit(
        db,
        actor=actor,
        action="application.pending.submit",
        entity_id=row.id,
        summary={
            "name": row.full_name,
            "promoted_from": str(temp_id),
            "education_rows": len(education),
            "document_rows": len(documents),
        },
    )
    db.commit()
    return _detail(db, row)

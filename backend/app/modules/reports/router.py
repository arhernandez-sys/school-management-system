"""Reports router (api-spec §5 Module 10, FR-RPT-*, FR-TRN-*).

Thin transport; the service owns DB access. Mounts under `/api/v1`.

Endpoints:
  GET /reports/students          P/S/Teacher -> StudentPickerPage
  GET /reports/report-card       P/S/Teacher -> ReportCard        (?student_id=&semester_id=&kind=)
  GET /reports/report-card/me    Student     -> ReportCard        (?semester_id=&kind=)
  GET /reports/transcript        P/S ONLY    -> Transcript        (?student_id=)  [D26]
  GET /reports/offering-grades   P/S/Teacher -> OfferingGradesReport (?offering_id=)
  GET /reports/attendance        P/S/Teacher -> AttendanceReport  (?section_id=)
  GET /reports/enrollment        P/S ONLY    -> EnrollmentReport

D45 Phase 9 added the four INSTITUTIONAL reports of blueprint §53. They read the college
rather than one student, so they sit behind their own gate (Dean / Registrar / Auditor /
HOD, the HOD scoped to their own programmes) and their own service module:

  GET /reports/new-vs-returning      -> NewVsReturningReport      (?academic_year_id=)
  GET /reports/overcapacity          -> OvercapacityReport        (?semester_id=)
  GET /reports/credit-load           -> CreditLoadReport          (?semester_id=)
  GET /reports/programme-attendance  -> ProgrammeAttendanceReport (?semester_id=&program_id=)

Paths follow the finished frontend's QUERY-PARAM form, not api-spec §5.10's original
path-param form (`/reports/report-card/{student_id}`) — see the api-spec reconciliation
note. Route order matters: `/report-card/me` is declared BEFORE `/report-card` would
matter if the latter took a path param; it doesn't, but the literal stays first for
clarity.

The last three have no frontend caller today; they are built per the api-spec and are
thin shells over the same helpers the real screens use.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.common.enums import ReportCardKind, Role
from app.common.schemas import ErrorResponse
from app.core.deps import get_db, require_role, require_student_grade_visibility
from app.core.pagination import PageParams, page_params
from app.modules.reports import institutional, service
from app.modules.reports.schemas import (
    AttendanceReport,
    CreditLoadReport,
    NewVsReturningReport,
    OfferingGradesReport,
    OvercapacityReport,
    EnrollmentReport,
    ProgrammeAttendanceReport,
    ReportCard,
    StudentPickerPage,
    Transcript,
)
from app.modules.users.models import User

router = APIRouter(prefix="/reports", tags=["reports"])

_ERR = {"model": ErrorResponse}
_staff = require_role(
    Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER, Role.HOD, Role.AUDITOR
)
#: D43 — the Auditor joins the admins here (this gate carries TRANSCRIPT access) but
#: the HOD does NOT: their reports reach is their programme's gradebooks, not a
#: permanent record they have no role in issuing.
_admins = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.AUDITOR)
#: D32 (brief §4) — a student's own report card is grade information, so it is gated by
#: the Dean's `students_can_view_grades` switch exactly like `/grades/me` (403
#: `grades_hidden` when off). Staff report cards below are NOT gated: the switch governs
#: what a STUDENT sees, and the Registrar issuing report cards is core registry work.
_student = require_student_grade_visibility(Role.STUDENT)


@router.get(
    "/students",
    response_model=StudentPickerPage,
    summary="Student picker for the report screens",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_students(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=120)] = None,
    status: Annotated[str | None, Query()] = None,
    db: Session = Depends(get_db),
    _actor: User = Depends(_staff),
) -> StudentPickerPage:
    return service.list_students(db, params=params, search=search, status=status)


@router.get(
    "/report-card/me",
    response_model=ReportCard,
    summary="The signed-in student's own report card",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_my_report_card(
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    kind: Annotated[ReportCardKind, Query()] = ReportCardKind.ENDTERM,
    db: Session = Depends(get_db),
    actor: User = Depends(_student),
) -> ReportCard:
    """A subject with any unreleased graded work shows as `status="pending"` with no
    numeric (AC 5.5) — an official document must not print a partial average.

    D32: `kind=midterm` returns the frozen mid-term card, which carries NO release filter
    (see `get_my_report_card` in the service for why). Gated by the Dean's student
    grade-visibility switch like every other student grade surface."""
    return service.get_my_report_card(
        db, actor=actor, semester_id=semester_id, kind=kind
    )


@router.get(
    "/report-card",
    response_model=ReportCard,
    summary="A student's report card (P/S/Teacher)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_report_card(
    student_id: Annotated[uuid.UUID, Query()],
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    kind: Annotated[ReportCardKind, Query()] = ReportCardKind.ENDTERM,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> ReportCard:
    """404 `semester_not_found` for an unknown `semester_id` — no silent fallback to
    the active term, which would mask a client bug.

    **`kind` (D32, brief §5).** `endterm` (the default, and the pre-D32 behaviour)
    computes from current grades for a live year and reads `term_grade_snapshots` once the
    year archives. `midterm` reads a frozen `report_card_snapshots` payload verbatim and
    NEVER recalculates — that is the client's requirement, not an optimisation.

    Defaulting to `endterm` keeps every existing caller working unchanged.

    Mid-term extra failure modes, all from `freeze_midterm`: 409 `midterm_window_open`
    before the window closes, 422 `no_midterm_window` for a term with no mid-term period,
    404 `no_midterm_snapshot` for a student with no live enrolment in the term."""
    return service.get_report_card(
        db, actor=actor, student_id=student_id, semester_id=semester_id, kind=kind
    )


@router.get(
    "/transcript",
    response_model=Transcript,
    summary="A student's multi-year transcript (principal/secretary only — D26)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_transcript(
    student_id: Annotated[uuid.UUID, Query()],
    db: Session = Depends(get_db),
    actor: User = Depends(_admins),
) -> Transcript:
    """Archived years read frozen snapshots; the live year computes on read (§10.6)."""
    return service.get_transcript(db, actor=actor, student_id=student_id)


@router.get(
    "/offering-grades",
    response_model=OfferingGradesReport,
    summary="Per-offering grade summary + letter distribution",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_offering_grades(
    offering_id: Annotated[uuid.UUID, Query()],
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> OfferingGradesReport:
    """No frontend caller today — FR-RPT-02 is served by the real gradebook."""
    return service.get_offering_grades(
        db, actor=actor, offering_id=offering_id, semester_id=semester_id
    )


@router.get(
    "/attendance",
    response_model=AttendanceReport,
    response_model_by_alias=True,
    summary="Per-section attendance summary",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_attendance_report(
    section_id: Annotated[uuid.UUID, Query()],
    db: Session = Depends(get_db),
    actor: User = Depends(_staff),
) -> AttendanceReport:
    """No frontend caller today — FR-RPT-03 is served by `/attendance/summary`.
    Serialized by alias so the section key is emitted as `class`, matching the mock."""
    return service.get_attendance_report(db, actor=actor, section_id=section_id)


@router.get(
    "/enrollment",
    response_model=EnrollmentReport,
    summary="Headcount by grade and section (principal/secretary only)",
    responses={401: _ERR, 403: _ERR},
)
def get_enrollment_report(
    db: Session = Depends(get_db),
    actor: User = Depends(_admins),
) -> EnrollmentReport:
    """No frontend caller today — FR-RPT-04 is served by the principal dashboard."""
    return service.get_enrollment_report(db, actor=actor)


# ══════════════════════════════════════════════════════════════════════════════
# D45 Phase 9 — the four institutional reports of §53
#
# Mounted here rather than under a new `/institutional` prefix: they ARE reports, the
# frontend serves them as tabs of the Reports screen, and a second prefix would have
# split one screen's calls across two routers for no gain.
#
# `_institutional` is a WIDER gate than `_admins` (it adds the HOD) and a NARROWER one
# than `_staff` (it drops the Lecturer). The HOD is then scoped down to the programmes
# they head inside the service — a role allowlist cannot express "only your own
# programmes", which is the same reason D43 put the auditor's read-only refusal at the
# auth choke point instead of on 121 route tuples.
# ══════════════════════════════════════════════════════════════════════════════
_institutional = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.AUDITOR, Role.HOD)


@router.get(
    "/new-vs-returning",
    response_model=NewVsReturningReport,
    summary="New versus returning students for one academic year (§53 Enrollment)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_new_vs_returning(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_institutional),
) -> NewVsReturningReport:
    """Defaults to the ACTIVE year. 404 `academic_year_not_found` for an unknown id —
    never a silent fallback to the active year, which would answer a different question
    without saying so.

    New/returning is measured from REGISTRATIONS, not from `enrollment_date`. See
    `institutional.new_vs_returning` for why, and for the second, per-term reading that
    comes back alongside the year one."""
    return institutional.new_vs_returning(
        db, actor=actor, academic_year_id=academic_year_id
    )


@router.get(
    "/overcapacity",
    response_model=OvercapacityReport,
    summary="Classes past their capacity in one term (§53 Registration)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_overcapacity(
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_institutional),
) -> OvercapacityReport:
    """Defaults to the ACTIVE TERM (not the active year's first term). 404
    `semester_not_found` for an unknown id.

    Returns three lists, not one: over capacity, exactly at capacity, and no capacity
    recorded. An empty "over capacity" list means two very different things depending on
    the third one."""
    return institutional.overcapacity(db, actor=actor, semester_id=semester_id)


@router.get(
    "/credit-load",
    response_model=CreditLoadReport,
    summary="Credits each student is carrying this term (§53 Registration)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_credit_load(
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_institutional),
) -> CreditLoadReport:
    """Defaults to the ACTIVE TERM. Students with no registration this term are absent
    from the rows — a student carrying nothing has no load, and "should they be
    registered?" is §53's separate students-not-registered report.

    `mismatch` applies BAJC's own application-form rule (Part Time under 15 credits, Full
    Time over 15) and deliberately does NOT flag exactly 15, which the form leaves
    unstated."""
    return institutional.credit_load(db, actor=actor, semester_id=semester_id)


@router.get(
    "/programme-attendance",
    response_model=ProgrammeAttendanceReport,
    summary="Attendance per programme — §53's department report (C4)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_programme_attendance(
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
    program_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(_institutional),
) -> ProgrammeAttendanceReport:
    """"Department" means PROGRAMME (D45 decision C4 — there is no `departments` table and
    a programme is the unit BAJC has). Grouped by the STUDENT's programme, so a Biology
    student's absence in a General Studies elective counts against Biology.

    `program_id` drills into one programme and adds its per-student rows; an HOD may only
    drill into a programme they head (403 otherwise). Flagged strictly below the college's
    configured floor, matching the alerts screen."""
    return institutional.programme_attendance(
        db, actor=actor, semester_id=semester_id, program_id=program_id
    )

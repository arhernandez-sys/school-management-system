"""Students router (api-spec §5 Module 3) — the 10 student endpoints.

Thin transport layer; the service owns DB + transactions. Mounts under `/api/v1`
via app/main.py.

Endpoints:
  GET    /students                      P/S/Teacher   -> Page[StudentListItem]
  GET    /students/filter-options       P/S/Teacher   -> StudentFilterOptions        [D32]
  GET    /students/me                   Student       -> StudentDetail
  GET    /students/me/years             Student       -> StudentYearsResponse
  GET    /students/{id}                 P/S/Teacher   -> StudentDetail
  GET    /students/{id}/years           P/S/Teacher   -> StudentYearsResponse
  GET    /students/{id}/assessments     P/Teacher     -> StudentAssessmentsResponse  [D32]
  POST   /students                      P/S           -> StudentDetail (201)
  PATCH  /students/{id}                  P/S           -> StudentDetail
  POST   /students/{id}/status           P/S           -> StudentDetail
  DELETE /students/{id}                  P/S           -> 204

Route ordering note: the literal `/students/me` and `/students/me/years` are
declared BEFORE their `/{student_id}` counterparts so the literal path wins over
the UUID path param — otherwise FastAPI tries to parse "me" as a UUID and the
student's own routes 422.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.common.enums import Role, StudentStatus
from app.common.schemas import ErrorResponse, Page
from app.core.deps import get_db, require_role
from app.core.pagination import PageParams, page_params
from app.modules.students import academics, service
from app.modules.students.schemas import (
    AcademicHistory,
    ProgramChangeRequest,
    StudentProgramRef,
    StudentAssessmentsResponse,
    StudentCreateRequest,
    StudentDetail,
    StudentFilterOptions,
    StudentListItem,
    StudentStatusRequest,
    StudentUpdateRequest,
    StudentYearsResponse,
)
from app.modules.users.models import User

router = APIRouter(prefix="/students", tags=["students"])

_ERR = {"model": ErrorResponse}
_manage = require_role(Role.PRINCIPAL, Role.SECRETARY)
_read = require_role(Role.PRINCIPAL, Role.SECRETARY, Role.TEACHER)
_student_only = require_role(Role.STUDENT)
#: D32 (brief §4) — `/students/{id}/assessments` is the one route in this module that
#: returns GRADES, and the client asked for grade information to leave the registration
#: screens. So the Registrar is dropped from THIS route alone; `_read` above is unchanged
#: and still serves them the directory, the profile and the enrolment record.
#:
#: Unconditional, with no toggle, for the same reason as `grades/router.py`: the removal
#: was asked for outright, not as something to switch on and off.
_read_grades = require_role(Role.PRINCIPAL, Role.TEACHER)
#: A PROGRAMME change is the Dean's, unlike everything else in this module — it
#: re-derives a degree plan and rules on what carries over (D30 §D12, §D14).
_dean = require_role(Role.PRINCIPAL)


@router.get(
    "",
    response_model=Page[StudentListItem],
    summary="List students (P/S/Teacher; api-spec §5.3, FR-STU-06)",
    responses={401: _ERR, 403: _ERR, 422: _ERR},
)
def list_students(
    params: PageParams = Depends(page_params),
    search: Annotated[str | None, Query(max_length=160)] = None,
    status_filter: Annotated[StudentStatus | None, Query(alias="status")] = None,
    offering_id: Annotated[uuid.UUID | None, Query()] = None,
    year_of_study: Annotated[str | None, Query(max_length=50)] = None,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    religion: Annotated[str | None, Query(max_length=100)] = None,
    gender: Annotated[str | None, Query(max_length=20)] = None,
    program_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> Page[StudentListItem]:
    """Teacher results auto-restrict to students in a class they own any subject
    of (FR-STU-08). Students are denied at the role gate (403).

    `year_of_study` filters on the student's own level (D29 — it replaced `grade_level`,
    which used to be read off the student's homeroom). `offering_id` narrows to one
    course offering. `academic_year_id` (year switcher) restricts the directory to
    students enrolled in that year when it is a PAST year; the active year lists
    everyone.

    **D32 (brief §3) adds `religion`, `gender` and `program_id`.** Server-side, and they
    AND with each other and with everything above — "all Female students in Programme X"
    is two of them together. They filter on the student record itself, so a graduated or
    withdrawn student still matches; that is deliberate, and the same reasoning as the
    `academic_year_id` note above.

    `religion` is free text from the admissions form, so its permitted values come from
    `GET /students/filter-options` rather than an enum."""
    return service.list_students(
        db,
        caller=caller,
        params=params,
        search=search,
        status=status_filter,
        offering_id=offering_id,
        religion=religion,
        gender=gender,
        program_id=program_id,
        year_of_study=year_of_study,
        academic_year_id=academic_year_id,
    )


@router.get(
    "/filter-options",
    response_model=StudentFilterOptions,
    summary="Values the directory filters can take (P/S/Teacher; D32, brief §3)",
    responses={401: _ERR, 403: _ERR},
)
def student_filter_options(
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> StudentFilterOptions:
    """The DISTINCT religions actually present in the directory.

    Only `religion` is here, and only because it has to be: it is free text collected on
    the admissions form, so there is no enum to build a dropdown from and a hardcoded list
    would offer options that match nothing. `gender` is a fixed pair and programmes come
    from `/programs`.

    Declared BEFORE `/{student_id}` so the literal wins over the UUID path param —
    otherwise FastAPI tries to parse "filter-options" as a UUID and 422s."""
    return service.filter_options(db)


@router.get(
    "/me",
    response_model=StudentDetail,
    summary="The signed-in student's own profile (student; api-spec §5.3, FR-STU-09)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_my_student(
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_student_only),
) -> StudentDetail:
    """Server-derived scope: the profile is resolved from the token, never a param
    (§3.2). 404 no_student_profile if the login isn't linked to a student.

    `academic_year_id` rescopes `current_offerings` to the offerings the caller sat in that
    year — the student half of what `GET /{student_id}` already did for staff. WHICH
    student is still resolved from the token only; the param narrows the view of their
    own record and can never widen it to anyone else's."""
    return service.get_my_student(
        db, caller=caller, academic_year_id=academic_year_id
    )


@router.get(
    "/me/years",
    response_model=StudentYearsResponse,
    summary="Academic years the signed-in student was enrolled in (student; §5.3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def list_my_years(
    db: Session = Depends(get_db),
    caller: User = Depends(_student_only),
) -> StudentYearsResponse:
    """Backs the student-only top-bar year switcher. Server-derived scope (§3.2);
    404 no_student_profile if the login isn't linked. Declared before
    `/{student_id}/years` so "me" is never parsed as a UUID."""
    return service.list_my_years(db, caller=caller)


@router.get(
    "/{student_id}",
    response_model=StudentDetail,
    summary="Student detail (P/S/Teacher; api-spec §5.3, FR-STU-07)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def get_student(
    student_id: uuid.UUID,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> StudentDetail:
    """Teacher must own a class the student is enrolled in, else 404 (§3.3).
    Students are denied at the role gate (403 → use /students/me).

    `academic_year_id` rescopes `current_offerings` to the offerings the student sat in
    that year, so the profile header agrees with the assessments tab."""
    return service.get_student(
        db, caller=caller, student_id=student_id, academic_year_id=academic_year_id
    )


@router.get(
    "/{student_id}/years",
    response_model=StudentYearsResponse,
    summary="Academic years the student was enrolled in (P/S/Teacher; §5.3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def list_student_years(
    student_id: uuid.UUID,
    db: Session = Depends(get_db),
    caller: User = Depends(_read),
) -> StudentYearsResponse:
    """Backs the per-student year filter on the profile page. Teacher must own a
    section the student is in, else 404 (§3.3). Students are denied at the role
    gate (403 → use /students/me/years)."""
    return service.list_student_years(db, caller=caller, student_id=student_id)


@router.get(
    "/{student_id}/assessments",
    response_model=StudentAssessmentsResponse,
    summary="Assessments + term grades grouped by subject (Dean/Lecturer; §5.3)",
    responses={401: _ERR, 403: _ERR, 404: _ERR},
)
def list_student_assessments(
    student_id: uuid.UUID,
    academic_year_id: Annotated[uuid.UUID | None, Query()] = None,
    db: Session = Depends(get_db),
    caller: User = Depends(_read_grades),
) -> StudentAssessmentsResponse:
    """Teacher must own a section the student is in, else 404. `academic_year_id`
    scopes to the section the student sat in that YEAR (a year spans both
    semesters). A student self uses GET /grades/me.

    **D32: no longer open to the Registrar** — this is the grade information the client
    asked to remove from the registration screens (brief §4). The matching Grades &
    Assessments tab is hidden from them in `StudentDetailPage.tsx`."""
    return service.list_student_assessments(
        db, caller=caller, student_id=student_id, academic_year_id=academic_year_id
    )


@router.post(
    "",
    response_model=StudentDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a student (P/S; api-spec §5.3, FR-STU-01/02/05)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def create_student(
    payload: StudentCreateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> StudentDetail:
    """Optionally enrolls into `section_id` for the active semester in one txn.
    409 duplicate_student_number / section_archived / no_active_semester."""
    return service.create_student(db, actor=actor, payload=payload)


@router.patch(
    "/{student_id}",
    response_model=StudentDetail,
    summary="Update a student's profile (P/S; api-spec §5.3, FR-STU-03)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def update_student(
    student_id: uuid.UUID,
    payload: StudentUpdateRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> StudentDetail:
    """`status` is NOT editable here — use POST /students/{id}/status. Re-checks
    student_number uniqueness on change."""
    return service.update_student(
        db, actor=actor, student_id=student_id, payload=payload
    )


@router.post(
    "/{student_id}/status",
    response_model=StudentDetail,
    summary="Change a student's lifecycle status (P/S; api-spec §5.3, FR-STU-04)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def change_student_status(
    student_id: uuid.UUID,
    payload: StudentStatusRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> StudentDetail:
    """Auditable, guarded lifecycle change. 422 invalid_transition on an illegal
    move (FR-STU-04)."""
    return service.change_student_status(
        db, actor=actor, student_id=student_id, payload=payload
    )


@router.delete(
    "/{student_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a student if no academic history (P/S; §5.3, FR-STU-10)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR},
)
def delete_student(
    student_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: User = Depends(_manage),
) -> Response:
    """Blocked if any grade/attendance references the student (FK RESTRICT) → 409
    has_academic_history (deactivate instead)."""
    service.delete_student(db, actor=actor, student_id=student_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ──────────────────────────────────────────────────────────────────────────────
# Programme registration + derived academic history (D30 §D12, brief §12/§27)
# ──────────────────────────────────────────────────────────────────────────────
@router.get(
    "/{student_id}/academic-history",
    response_model=AcademicHistory,
    summary="Derived academic history — completed / failed / transferred / remaining (P/S)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 422: _ERR},
)
def get_academic_history(
    student_id: uuid.UUID,
    db: Session = Depends(get_db),
    _actor: User = Depends(_manage),
) -> AcademicHistory:
    """**Entirely derived** (§D12) — nothing about it is stored.

    Computed on every read from `class_enrollments` + `term_grade_snapshots` + approved
    `credit_transfer_requests` + `program_courses`, so a corrected grade shows up at once
    rather than leaving a cached figure to drift. The GPA comes from the single
    `calc.compute_gpa` that the report card and transcript also use.
    """
    return academics.academic_history(db, student_id=student_id)


@router.put(
    "/{student_id}/program",
    response_model=StudentProgramRef,
    summary="Register or CHANGE a student's programme — DEAN ONLY (§D12, §D14)",
    responses={401: _ERR, 403: _ERR, 404: _ERR, 409: _ERR, 422: _ERR},
)
def set_student_program(
    student_id: uuid.UUID,
    payload: ProgramChangeRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(_dean),
) -> StudentProgramRef:
    """**Dean only**, unlike the rest of this module.

    The Registrar owns the student record and admits students — but moving one between
    programmes re-derives their whole degree plan and decides which completed courses count
    toward the new award, which is academic authority (§D14). Assigning at ADMISSION goes
    through the Registrar's accept flow instead (§D11).

    Closes the open `student_program_history` row and opens a new one in the same
    transaction, so history is never destroyed. 409 `program_unchanged` when the student is
    already on that programme.
    """
    return academics.set_program(
        db, actor=actor, student_id=student_id, payload=payload
    )

"""Announcements service (api-spec §5 Module 9, FR-ANN-*).

Owns DB access + transactions for the 8 announcement endpoints; the router is thin.

**Targeting** is the heart of this module (`_audience_clause`): an announcement
reaches a user if it is school-wide (`all`), aimed at their role (`students` /
`teachers`), or aimed at a section they are linked to (`class`). A student's link is
their enrollment; a teacher's is owning any subject in the section.

**Uniquely among all modules, an archived academic year does NOT block writes here.**
An announcement is a communication, not academic history — a principal may still
post or correct a notice after a year is archived. Every other module raises 409
`year_archived`; this one deliberately does not, and a test asserts it.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from math import ceil

from sqlalchemy import ColumnElement, and_, exists, func, or_, select
from sqlalchemy.orm import Session

from app.common.enums import AnnouncementAudience, Role
from app.common.schemas import Page
from app.core.errors import Forbidden, NotFound, ValidationError
from app.core.pagination import PageParams
from app.core.rbac import teacher_section_ids
from app.core.timeutil import ensure_aware, utcnow
from app.modules.announcements.models import Announcement, AnnouncementRead
from app.modules.announcements.schemas import (
    BODY_PREVIEW_LEN,
    AnnouncementClassRef,
    AnnouncementCreateRequest,
    AnnouncementDetail,
    AnnouncementListItem,
    AnnouncementUpdateRequest,
    TargetClassesResponse,
    UnreadCountResponse,
)
from app.modules.classes.models import Class, ClassEnrollment, ClassSubject, ClassTeacher
from app.modules.settings.models import AuditLog
from app.modules.students.models import StudentProfile
from app.modules.users.models import User

_WHITESPACE = re.compile(r"\s+")


def _audit(db: Session, *, actor: User, action: str, entity_id=None, summary=None) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type="announcement",
            entity_id=entity_id,
            summary=summary,
        )
    )


def _body_preview(body: str) -> str:
    """Collapse whitespace and clip to `BODY_PREVIEW_LEN`, appending an ellipsis."""
    flat = _WHITESPACE.sub(" ", body).strip()
    if len(flat) <= BODY_PREVIEW_LEN:
        return flat
    return flat[:BODY_PREVIEW_LEN].rstrip() + "…"


# ──────────────────────────────────────────────────────────────────────────────
# Targeting
# ──────────────────────────────────────────────────────────────────────────────
def _linked_section_ids(db: Session, user: User) -> list[uuid.UUID]:
    """Sections this user is personally attached to.

    Student → sections they are actively enrolled in. Teacher → sections where they
    own any subject offering. Principal/secretary → **none**: they have no personal
    section link, which is why class-audience notices don't reach their feed.
    """
    if user.role == Role.STUDENT:
        return list(
            db.scalars(
                select(ClassEnrollment.class_id)
                .join(StudentProfile, ClassEnrollment.student_id == StudentProfile.id)
                .where(
                    StudentProfile.user_id == user.id,
                    StudentProfile.deleted_at.is_(None),
                    ClassEnrollment.unenrolled_at.is_(None),
                )
            ).all()
        )
    if user.role == Role.TEACHER:
        return teacher_section_ids(db, user)
    return []


#: Principal and secretary are interchangeable for announcements (stakeholder
#: decision 2026-07-27: "principal and secretary are the same"). Either can see and
#: manage the other's notices; neither can see a teacher's.
_ADMIN_ROLES = (Role.PRINCIPAL, Role.SECRETARY)


def _authored_by_admin() -> ColumnElement[bool]:
    """The announcement's author is a principal or secretary.

    A correlated EXISTS rather than a join so it can drop into an `or_()` without
    changing the statement's shape.
    """
    return exists().where(
        User.id == Announcement.author_id, User.role.in_(_ADMIN_ROLES)
    )


def _audience_clause(db: Session, user: User) -> ColumnElement[bool]:
    """Which announcements this user may see (FR-ANN-03).

    Stakeholder rules, ratified 2026-07-27:

    * A `class` announcement **reaches the class it names** — the enrolled students
      and the teachers who teach that section.
    * **Teachers** post only to sections they are assigned to, and see notices for
      those sections plus the school-wide and teacher-audience ones.
    * **Principal and secretary are equivalent.** Both post school-wide *and* to a
      named class, and both see everything the other posts.
    * **Admins do NOT see teacher-authored announcements.** A teacher's class notice
      is between them and their class. Because a teacher can only ever create a
      `class` announcement, "not teacher-authored" is the whole of that rule.

    An author always sees their own, whatever the audience.
    """
    own = Announcement.author_id == user.id

    if user.role in _ADMIN_ROLES:
        return or_(
            # School-wide notices.
            Announcement.audience == AnnouncementAudience.ALL,
            # Anything posted by the other admin — including their class notices and
            # their student/teacher-audience broadcasts.
            _authored_by_admin(),
            own,
        )

    clauses: list[ColumnElement[bool]] = [
        Announcement.audience == AnnouncementAudience.ALL,
        own,
    ]
    if user.role == Role.STUDENT:
        clauses.append(Announcement.audience == AnnouncementAudience.STUDENTS)
    if user.role == Role.TEACHER:
        clauses.append(Announcement.audience == AnnouncementAudience.TEACHERS)

    section_ids = _linked_section_ids(db, user)
    if section_ids:
        clauses.append(
            and_(
                Announcement.audience == AnnouncementAudience.CLASS,
                Announcement.class_id.in_(section_ids),
            )
        )
    return or_(*clauses)


def _visible_clause(db: Session, user: User) -> ColumnElement[bool]:
    """Targeting + live + published + not expired."""
    now = utcnow()
    return and_(
        Announcement.deleted_at.is_(None),
        _audience_clause(db, user),
        # Scheduled-for-later notices stay hidden. The mock omits this check, but
        # the compose form never sets `published_at`, so behaviour is identical for
        # all frontend-authored data — and a future-dated notice must not leak.
        Announcement.published_at <= now,
        or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
    )


def _unread_filter(user: User) -> ColumnElement[bool]:
    """NOT EXISTS against the read ledger — the `unread_only` filter and the badge."""
    return ~exists().where(
        AnnouncementRead.announcement_id == Announcement.id,
        AnnouncementRead.user_id == user.id,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Refs / serialization
# ──────────────────────────────────────────────────────────────────────────────
def _class_refs(db: Session, class_ids: list[uuid.UUID]) -> dict[uuid.UUID, AnnouncementClassRef]:
    if not class_ids:
        return {}
    rows = db.execute(
        select(Class.id, Class.name, Class.grade_level).where(Class.id.in_(class_ids))
    ).all()
    return {
        cid: AnnouncementClassRef(id=cid, name=name, grade_level=grade)
        for cid, name, grade in rows
    }


def _author_refs(db: Session, author_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    if not author_ids:
        return {}
    rows = db.execute(
        select(User.id, User.full_name, User.role).where(User.id.in_(author_ids))
    ).all()
    return {uid: {"id": uid, "full_name": name, "role": role} for uid, name, role in rows}


def _announcement_or_404(db: Session, announcement_id: uuid.UUID) -> Announcement:
    row = db.scalar(
        select(Announcement).where(
            Announcement.id == announcement_id, Announcement.deleted_at.is_(None)
        )
    )
    if row is None:
        raise NotFound("Announcement not found.", code="not_found")
    return row


def _is_read(db: Session, announcement_id: uuid.UUID, user: User) -> bool:
    return db.scalar(
        select(
            exists().where(
                AnnouncementRead.announcement_id == announcement_id,
                AnnouncementRead.user_id == user.id,
            )
        )
    ) or False


def _detail(db: Session, row: Announcement, user: User) -> AnnouncementDetail:
    class_refs = _class_refs(db, [row.class_id] if row.class_id else [])
    authors = _author_refs(db, [row.author_id] if row.author_id else [])
    return AnnouncementDetail(
        id=row.id,
        title=row.title,
        body=row.body,
        audience=row.audience,
        class_ref=class_refs.get(row.class_id) if row.class_id else None,
        author=authors.get(row.author_id) if row.author_id else None,
        published_at=row.published_at,
        expires_at=row.expires_at,
        is_read=_is_read(db, row.id, user),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Write authorization (FR-ANN-02/07)
# ──────────────────────────────────────────────────────────────────────────────
def _assert_can_target(
    db: Session, actor: User, audience: AnnouncementAudience, class_id: uuid.UUID | None
) -> None:
    """P/S may target any audience. A teacher may target ONLY a `class` audience on
    a section they own — never a broadcast. Students never post."""
    if actor.role in (Role.PRINCIPAL, Role.SECRETARY):
        return
    if actor.role != Role.TEACHER:
        raise Forbidden("You cannot post announcements.", code="forbidden")

    if audience != AnnouncementAudience.CLASS:
        raise Forbidden(
            "Teachers can only post announcements to their own classes.",
            code="teacher_cannot_broadcast",
        )
    if class_id is None or class_id not in _linked_section_ids(db, actor):
        raise Forbidden(
            "Teachers can only post announcements to their own classes.",
            code="teacher_cannot_broadcast",
        )


def _assert_can_modify(db: Session, actor: User, row: Announcement) -> None:
    """The author, or either admin acting on an admin-authored notice.

    Principal and secretary are equivalent here (stakeholder decision), so either can
    correct or withdraw the other's notice. **Neither can touch a teacher's** — that
    follows from admins not being able to see teacher-authored announcements at all;
    letting them edit something invisible to them would be incoherent.

    ⚠️ Operational consequence, flagged for the stakeholder: there is now **no
    administrative override** for a teacher's class announcement. If a teacher posts
    something inappropriate, only that teacher can remove it. Say the word if you
    want the principal to keep a moderator power.
    """
    if row.author_id == actor.id:
        return
    if actor.role in _ADMIN_ROLES and row.author_id is not None:
        author_role = db.scalar(select(User.role).where(User.id == row.author_id))
        if author_role in _ADMIN_ROLES:
            return
    raise Forbidden("You cannot change this announcement.", code="forbidden")


def _validate_window(published_at: datetime, expires_at: datetime | None) -> None:
    if expires_at is not None:
        published = ensure_aware(published_at)
        expires = ensure_aware(expires_at)
        if expires is not None and published is not None and expires <= published:
            raise ValidationError(
                "Expiry must be after the publish date.",
                fields={"expires_at": ["Expiry must be after the publish date."]},
            )


def _resolve_class_id(
    audience: AnnouncementAudience, class_id: uuid.UUID | None
) -> uuid.UUID | None:
    """A `class` audience requires a class; any other audience clears it.

    The DB enforces the same invariant via `ck_announcements_class_audience`, so this
    pre-check exists to return the documented 422 rather than an opaque integrity error.
    """
    if audience == AnnouncementAudience.CLASS:
        if class_id is None:
            raise ValidationError(
                "Choose a class for a class-targeted announcement.",
                code="class_audience_requires_class_id",
                fields={"class_id": ["A class is required for this audience."]},
            )
        return class_id
    return None


# ──────────────────────────────────────────────────────────────────────────────
# GET /announcements
# ──────────────────────────────────────────────────────────────────────────────
def list_announcements(
    db: Session,
    *,
    actor: User,
    params: PageParams,
    audience: AnnouncementAudience | None,
    unread_only: bool,
):
    """The caller's targeted feed, newest first.

    Built explicitly rather than through `paginate`'s per-row serializer: the feed
    rows need read-state, class and author decoration, and doing that per row would
    be three extra queries per item. Here it is a fixed three queries per PAGE.
    """
    stmt = select(Announcement).where(_visible_clause(db, actor))
    if audience is not None:
        stmt = stmt.where(Announcement.audience == audience)
    if unread_only:
        stmt = stmt.where(_unread_filter(actor))
    stmt = stmt.order_by(Announcement.published_at.desc(), Announcement.id.desc())

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.scalars(
            stmt.limit(params.page_size).offset((params.page - 1) * params.page_size)
        ).all()
    )

    read_ids: set[uuid.UUID] = set()
    if rows:
        read_ids = set(
            db.scalars(
                select(AnnouncementRead.announcement_id).where(
                    AnnouncementRead.user_id == actor.id,
                    AnnouncementRead.announcement_id.in_([r.id for r in rows]),
                )
            ).all()
        )
    class_refs = _class_refs(db, [r.class_id for r in rows if r.class_id])
    authors = _author_refs(db, [r.author_id for r in rows if r.author_id])

    items = [
        AnnouncementListItem(
            id=r.id,
            title=r.title,
            body_preview=_body_preview(r.body),
            audience=r.audience,
            class_ref=class_refs.get(r.class_id) if r.class_id else None,
            author=authors.get(r.author_id) if r.author_id else None,
            published_at=r.published_at,
            expires_at=r.expires_at,
            is_read=r.id in read_ids,
        )
        for r in rows
    ]
    return Page[AnnouncementListItem](
        items=items,
        total=total,
        page=params.page,
        page_size=params.page_size,
        total_pages=ceil(total / params.page_size) if params.page_size else 0,
    )


def unread_count(db: Session, *, actor: User) -> UnreadCountResponse:
    """The bell badge: unread announcements PLUS revisions awaiting the caller (§D8).

    **Extended rather than duplicated.** §D8 rules out a generic notifications table: the
    Dean's revision queue IS `GET /grade-revisions?status=pending`, and this count reaches
    it through `grades.revisions.pending_for_actor` rather than reimplementing the rule.
    `unread_count` stays the SUM, so a client reading only that field keeps working.

    The revision component is what awaits the CALLER'S decision, so it is non-zero only for
    the Dean. A badge that counted a Lecturer's own pending requests would be nagging them
    about something only the Dean can act on.

    Imported inside the function: `grades.revisions` imports `core.rbac`, and a top-level
    import here would widen this module's import graph for one integer.
    """
    from app.modules.grades import revisions as grade_revisions

    announcements = (
        db.scalar(
            select(func.count())
            .select_from(Announcement)
            .where(_visible_clause(db, actor), _unread_filter(actor))
        )
        or 0
    )
    revisions = grade_revisions.pending_for_actor(db, actor=actor)
    return UnreadCountResponse(
        unread_count=announcements + revisions,
        unread_announcements=announcements,
        pending_grade_revisions=revisions,
    )


def target_classes(db: Session, *, actor: User) -> TargetClassesResponse:
    """Sections the caller may aim a `class` announcement at (compose picker).

    P/S → every live, non-archived section. Teacher → only sections they own a
    subject in. Students never compose, so they get an empty list rather than a 403 —
    the endpoint is a picker source, and the compose UI is already hidden from them.
    """
    stmt = select(Class.id, Class.name, Class.grade_level).where(
        Class.deleted_at.is_(None), Class.is_archived.is_(False)
    )
    if actor.role == Role.TEACHER:
        owned = _linked_section_ids(db, actor)
        if not owned:
            return TargetClassesResponse(items=[])
        stmt = stmt.where(Class.id.in_(owned))
    elif actor.role not in (Role.PRINCIPAL, Role.SECRETARY):
        return TargetClassesResponse(items=[])

    rows = db.execute(stmt.order_by(Class.name.asc())).all()
    return TargetClassesResponse(
        items=[
            AnnouncementClassRef(id=cid, name=name, grade_level=grade)
            for cid, name, grade in rows
        ]
    )


def get_announcement(
    db: Session, *, actor: User, announcement_id: uuid.UUID
) -> AnnouncementDetail:
    """Detail read. 404 unless the announcement is visible to the caller.

    There is deliberately **no principal "read anything" exemption** — the
    stakeholder decision is that admins do not see teacher-authored notices, and a
    by-id backdoor would defeat that. `_audience_clause` already lets an author read
    their own regardless of audience, which is the only exemption that remains.

    The one relaxation versus the feed: an author may reach their own notice even
    once it has expired or while it is still scheduled, so they can edit it.
    """
    now = utcnow()
    row = db.scalar(
        select(Announcement).where(
            Announcement.id == announcement_id,
            Announcement.deleted_at.is_(None),
            _audience_clause(db, actor),
            or_(
                Announcement.author_id == actor.id,
                and_(
                    Announcement.published_at <= now,
                    or_(
                        Announcement.expires_at.is_(None),
                        Announcement.expires_at > now,
                    ),
                ),
            ),
        )
    )
    if row is None:
        raise NotFound("Announcement not found.", code="not_found")
    return _detail(db, row, actor)


# ──────────────────────────────────────────────────────────────────────────────
# Writes
# ──────────────────────────────────────────────────────────────────────────────
def create_announcement(
    db: Session, *, actor: User, payload: AnnouncementCreateRequest
) -> AnnouncementDetail:
    """POST /announcements. NOTE: no `year_archived` guard — see the module docstring."""
    class_id = _resolve_class_id(payload.audience, payload.class_id)
    _assert_can_target(db, actor, payload.audience, class_id)

    if class_id is not None:
        section = db.scalar(
            select(Class).where(Class.id == class_id, Class.deleted_at.is_(None))
        )
        if section is None:
            raise ValidationError(
                "Choose a class for a class-targeted announcement.",
                code="class_audience_requires_class_id",
                fields={"class_id": ["That class does not exist."]},
            )

    published_at = payload.published_at or utcnow()
    _validate_window(published_at, payload.expires_at)

    row = Announcement(
        author_id=actor.id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        audience=payload.audience,
        class_id=class_id,
        published_at=published_at,
        expires_at=payload.expires_at,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(row)
    db.flush()
    # The author has implicitly read their own notice, so it never lights their bell.
    db.add(AnnouncementRead(announcement_id=row.id, user_id=actor.id))
    _audit(db, actor=actor, action="announcement.create", entity_id=row.id)
    db.commit()
    return _detail(db, row, actor)


def update_announcement(
    db: Session, *, actor: User, announcement_id: uuid.UUID, payload: AnnouncementUpdateRequest
) -> AnnouncementDetail:
    """PATCH /announcements/{id} — author or principal."""
    row = _announcement_or_404(db, announcement_id)
    _assert_can_modify(db, actor, row)

    provided = payload.model_dump(exclude_unset=True)
    audience = provided.get("audience", row.audience)
    class_id = _resolve_class_id(
        audience, provided.get("class_id", row.class_id if audience == row.audience else None)
    )
    # Re-check targeting against the MERGED audience, so a teacher cannot escalate
    # an owned class notice into a school-wide broadcast by editing it.
    _assert_can_target(db, actor, audience, class_id)

    published_at = provided.get("published_at") or row.published_at
    expires_at = provided["expires_at"] if "expires_at" in provided else row.expires_at
    _validate_window(published_at, expires_at)

    if "title" in provided:
        row.title = provided["title"].strip()
    if "body" in provided:
        row.body = provided["body"].strip()
    row.audience = audience
    row.class_id = class_id
    if provided.get("published_at") is not None:
        row.published_at = provided["published_at"]
    if "expires_at" in provided:
        row.expires_at = provided["expires_at"]
    row.updated_by = actor.id

    _audit(db, actor=actor, action="announcement.update", entity_id=row.id)
    db.commit()
    return _detail(db, row, actor)


def delete_announcement(db: Session, *, actor: User, announcement_id: uuid.UUID) -> None:
    """DELETE /announcements/{id} — soft delete, author or principal."""
    row = _announcement_or_404(db, announcement_id)
    _assert_can_modify(db, actor, row)
    row.deleted_at = utcnow()
    row.updated_by = actor.id
    _audit(db, actor=actor, action="announcement.delete", entity_id=row.id)
    db.commit()


def mark_read(db: Session, *, actor: User, announcement_id: uuid.UUID) -> None:
    """POST /announcements/{id}/read — idempotent.

    404 unless the announcement targets the caller: marking something you were never
    shown read is meaningless, and answering 204 would leak that it exists.
    """
    row = db.scalar(
        select(Announcement).where(
            Announcement.id == announcement_id,
            Announcement.deleted_at.is_(None),
            _visible_clause(db, actor),
        )
    )
    if row is None:
        raise NotFound("Announcement not found.", code="not_found")

    already = db.scalar(
        select(AnnouncementRead).where(
            AnnouncementRead.announcement_id == row.id,
            AnnouncementRead.user_id == actor.id,
        )
    )
    if already is None:
        db.add(AnnouncementRead(announcement_id=row.id, user_id=actor.id))
        db.commit()

"""Announcement schemas (api-spec §5 Module 9, FR-ANN-*).

Read shapes mirror the finished frontend (`features/announcements/types.ts` +
`handlers/announcements.ts`), which WINS on divergence. Two names are easy to get
wrong: the class reference is **`class_ref`** (not `class` or `class_id`), and the
feed row carries **`body_preview`**, not the full `body`.

Write models set `extra="forbid"` (§1.4); wire is snake_case (§1.2).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.common.enums import AnnouncementAudience, Role

#: Feed previews are clipped to this many characters, whitespace collapsed, with an
#: ellipsis appended. Matches `handlers/announcements.ts::bodyPreview`.
BODY_PREVIEW_LEN = 140

#: Strip BEFORE length validation, so a whitespace-only value is a 422 on the field
#: rather than an announcement saved with an empty title. A plain
#: `Field(min_length=1)` accepts "   " (three characters) and the service's later
#: `.strip()` then silently stores "".
AnnouncementTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
AnnouncementBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class AnnouncementAuthorRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    full_name: str
    role: Role


class AnnouncementClassRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    grade_level: str


class AnnouncementListItem(BaseModel):
    """One feed row. Carries `body_preview`; the full body needs the detail call."""

    id: UUID
    title: str
    body_preview: str
    audience: AnnouncementAudience
    class_ref: AnnouncementClassRef | None = None
    author: AnnouncementAuthorRef | None = None
    published_at: datetime
    expires_at: datetime | None = None
    is_read: bool = False


class AnnouncementDetail(BaseModel):
    """Full announcement — the POST/PATCH response and the detail read."""

    id: UUID
    title: str
    body: str
    audience: AnnouncementAudience
    class_ref: AnnouncementClassRef | None = None
    author: AnnouncementAuthorRef | None = None
    published_at: datetime
    expires_at: datetime | None = None
    is_read: bool = False


class UnreadCountResponse(BaseModel):
    unread_count: int = 0


class TargetClassesResponse(BaseModel):
    """Sections the caller may aim a `class` announcement at (compose picker)."""

    items: list[AnnouncementClassRef] = Field(default_factory=list)


class AnnouncementCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: AnnouncementTitle
    body: AnnouncementBody
    audience: AnnouncementAudience = AnnouncementAudience.ALL
    class_id: UUID | None = None
    published_at: datetime | None = None
    expires_at: datetime | None = None


class AnnouncementUpdateRequest(BaseModel):
    """PATCH — all fields optional. `None` is meaningful for `expires_at` (clearing
    an expiry), so the service reads `model_dump(exclude_unset=True)` rather than
    testing for `None`."""

    model_config = ConfigDict(extra="forbid")
    title: AnnouncementTitle | None = None
    body: AnnouncementBody | None = None
    audience: AnnouncementAudience | None = None
    class_id: UUID | None = None
    published_at: datetime | None = None
    expires_at: datetime | None = None

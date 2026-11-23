/**
 * Announcements module wire types (api-spec §5 Module 9).
 *
 * There is no orval-generated client for Announcements (`orval.config.ts` covers the
 * auth / health / settings / courses tags), so these describe the exact JSON the API and the
 * MSW handler return, in snake_case.
 *
 * **D31** — a `class`-audience announcement targets an OFFERING. The audience VALUE stays
 * `'class'`: it is an enum member shared by the ORM, the API and these handlers, and
 * renaming an enum member is a migration rather than a relabel. What changed is what it
 * points at — `class_ref` (a homeroom, with a `grade_level`) became `offering`.
 */
import type { AnnouncementAudience, Role } from '@shared/types/enums';
import type { Page } from '@shared/types/api';

export type { AnnouncementAudience };

/** Minimal author reference embedded in feed/detail. */
export interface UserRef {
  id: string;
  full_name: string;
  role: Role;
}

/**
 * Offering reference for a `class`-audience announcement.
 *
 * A NARROW ref, deliberately not the shared `OfferingRef`: a feed row prints the label and
 * (on the compose picker) the course name, and nothing here reads the term or the credits.
 * The predecessor carried `grade_level`, a column that no longer exists.
 */
export interface AnnouncementOfferingRef {
  id: string;
  /** Server-derived "MATH1110-01". Print it; never rebuild it. */
  label: string;
  course_name: string | null;
}

/** Feed row (GET /announcements). */
export interface AnnouncementListItem {
  id: string;
  title: string;
  body_preview: string;
  audience: AnnouncementAudience;
  offering: AnnouncementOfferingRef | null;
  author: UserRef;
  published_at: string;
  expires_at: string | null;
  is_read: boolean;
}

/** Full announcement (GET /announcements/{id}, POST, PATCH). */
export interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  offering: AnnouncementOfferingRef | null;
  author: UserRef;
  published_at: string;
  expires_at: string | null;
  is_read: boolean;
}

export type AnnouncementsPageResult = Page<AnnouncementListItem>;

/** Query params for the feed. */
export interface AnnouncementListParams {
  page?: number;
  page_size?: number;
  audience?: AnnouncementAudience;
  unread_only?: boolean;
}

/** Create/edit payload sent to POST/PATCH. */
export interface AnnouncementWritePayload {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  offering_id?: string | null;
  expires_at?: string | null;
}

/** The read-state filter surfaced in the feed toolbar. */
export type ReadFilter = 'all' | 'unread';

/** An offering the caller may target (GET /announcements/target-offerings). */
export type TargetOffering = AnnouncementOfferingRef;

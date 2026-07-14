/**
 * Announcements module wire types (api-spec §5 Module 9).
 *
 * There is no orval-generated client for Announcements yet, so these describe the
 * exact JSON the MSW handler (handlers/announcements.ts) returns. They mirror the
 * api-spec response models (AnnouncementListItem / AnnouncementDetail / UserRef /
 * ClassRef) in snake_case. When the backend endpoints land in the served OpenAPI
 * these will be replaced by generated types.
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

/** Section reference for a `class`-audience announcement. */
export interface ClassRef {
  id: string;
  name: string;
  grade_level: string;
}

/** Feed row (GET /announcements). */
export interface AnnouncementListItem {
  id: string;
  title: string;
  body_preview: string;
  audience: AnnouncementAudience;
  class_ref: ClassRef | null;
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
  class_ref: ClassRef | null;
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
  class_id?: string | null;
  expires_at?: string | null;
}

/** The read-state filter surfaced in the feed toolbar. */
export type ReadFilter = 'all' | 'unread';

/** A section the caller may target (GET /announcements/target-classes). */
export interface TargetClass {
  id: string;
  name: string;
  grade_level: string;
}

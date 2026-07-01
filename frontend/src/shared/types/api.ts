/**
 * Shared API contract types.
 *
 * ── AUTH / ENVELOPE TYPES ARE NOW GENERATED (7.0e / OQ-FE-B) ──
 * `CurrentUser`, `AuthTokenResponse`, `UserPreferences`, `ErrorResponse` (and its
 * `ErrorBody`) are RE-EXPORTED from the orval-generated client
 * (`shared/api/generated/model`, derived from the backend FastAPI OpenAPI). The
 * former FE-3 hand-authored copies are deleted so the contract cannot drift — the
 * generated types are the single source of truth. Existing imports of these names
 * from `@shared/types/api` keep working unchanged (this barrel preserves the names).
 *
 * Still hand-authored here: `Page<T>`, `SemesterRef`, `SchoolIdentity` — these are
 * NOT yet present in the auth-only OpenAPI surface (the backend currently serves only
 * the 6 auth endpoints + /health). They will be replaced by generated types as the
 * later modules (Settings, Dashboard, …) add their endpoints to the schema. Keep the
 * envelope name `Page<T>` stable — it is imported widely.
 *
 * Wire format is snake_case (api-specification.md §1.2).
 */

// Generated auth + envelope types (single source of truth — do not re-declare).
export type {
  CurrentUser,
  AuthTokenResponse,
  UserPreferences,
  ErrorResponse,
  ErrorBody,
} from '@shared/api/generated/model';

/** Pagination envelope (api-specification.md §4.1). The DataTable binds to this. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Lightweight refs (api-specification.md §4.4). */
export interface SemesterRef {
  id: string;
  name: string;
  sequence: number;
  is_active: boolean;
}

export interface SchoolIdentity {
  name: string;
  logo_url?: string;
  address?: string;
  contact_email?: string;
  contact_phone?: string;
}

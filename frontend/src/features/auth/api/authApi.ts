/**
 * Auth API calls (api-specification.md §2). Thin wrappers over the ORVAL-GENERATED
 * operation functions (`shared/api/generated/auth`), which route through the shared
 * `customInstance` mutator → the `api` axios instance. So these inherit the in-memory
 * Bearer attach + single-flight refresh + credentialed cookie + `ApiError`
 * normalization from `client.ts` (the refresh logic is untouched).
 *
 * We keep these named wrappers (rather than calling the generated functions directly
 * at call sites) for three reasons that the generated client does not cover:
 *   - they own the side effect of pushing the access token into the client closure
 *     (`setAccessToken`) on login/logout — auth-token lifecycle, not HTTP transport;
 *   - `bootstrapSession()` composes refresh + /me into the one bootstrap primitive
 *     the AuthProvider needs;
 *   - they pin a stable, intention-revealing API for the rest of the app, decoupled
 *     from orval's verbose generated operation names.
 *
 * Types (`CurrentUser`, `AuthTokenResponse`, `ChangePasswordRequest`) come from the
 * generated model — the contract cannot drift from the backend.
 */

import { performRefresh, setAccessToken } from '@shared/api/client';
import {
  loginApiV1AuthLoginPost,
  logoutApiV1AuthLogoutPost,
  meApiV1AuthMeGet,
  changeMyPasswordApiV1AuthMePasswordPatch,
} from '@shared/api/generated/auth/auth';
import type {
  AuthTokenResponse,
  CurrentUser,
  ChangePasswordRequest,
} from '@shared/api/generated/model';

export interface LoginCredentials {
  identifier: string;
  password: string;
}

/** POST /auth/login — establishes a session; refresh cookie set by the server. */
export async function login(credentials: LoginCredentials): Promise<AuthTokenResponse> {
  const data = await loginApiV1AuthLoginPost(credentials);
  setAccessToken(data.access_token);
  return data;
}

/** POST /auth/logout — revokes the refresh session server-side, clears the cookie. */
export async function logout(): Promise<void> {
  try {
    await logoutApiV1AuthLogoutPost();
  } finally {
    setAccessToken(null);
  }
}

/** GET /auth/me — the principal's identity + role (bootstrap, guards, permission map). */
export async function fetchCurrentUser(): Promise<CurrentUser> {
  return meApiV1AuthMeGet();
}

/**
 * PATCH /auth/me/password — change own password (api-spec §2.3, FR-AUTH-09).
 * `current_password` is required UNLESS the user is in the forced-change flow
 * (must_change_password=true), where the backend accepts it omitted. On success the
 * backend clears `must_change_password` and revokes all other refresh sessions.
 */
export async function changePassword(body: ChangePasswordRequest): Promise<void> {
  await changeMyPasswordApiV1AuthMePasswordPatch(body);
}

/**
 * Bootstrap silent refresh (architecture §3.1). On a hard reload the in-memory
 * access token is gone; attempt a refresh BEFORE guards render. Resolves to the
 * CurrentUser when a valid refresh session exists, or null (anonymous) otherwise.
 */
export async function bootstrapSession(): Promise<CurrentUser | null> {
  try {
    await performRefresh(); // sets the access token on success
    return await fetchCurrentUser();
  } catch {
    setAccessToken(null);
    return null;
  }
}

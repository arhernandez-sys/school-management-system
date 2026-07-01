/**
 * Typed HTTP client (axios) — architecture.md §3.1, §7.2, §8.1.
 *
 * Responsibilities:
 *  - Base URL = VITE_API_BASE_URL (`/api/v1`), credentialed (withCredentials) so the
 *    HttpOnly `sis_refresh` cookie rides cross-origin (Vercel SPA ↔ Railway API).
 *  - Attaches the in-memory access token as `Authorization: Bearer` on each request.
 *  - SINGLE-FLIGHT refresh: on a 401, one `/auth/refresh` runs; concurrent 401s queue
 *    on the same in-flight promise and replay on success (no refresh stampede).
 *  - Normalizes errors into the `ErrorResponse` envelope shape via `ApiError`.
 *
 * Why axios over fetch: interceptors give a clean, centralized place for the
 * Bearer-attach + single-flight-refresh-and-replay logic without re-wrapping every
 * call site. The refresh queue is the load-bearing reason.
 *
 * The access token lives ONLY in this module's closure (in-memory) — never in
 * localStorage/sessionStorage (XSS hardening, architecture §3.1). The AuthProvider
 * is the owner and pushes the token here via `setAccessToken`.
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { AuthTokenResponse, ErrorResponse } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

// ── In-memory access token (closure-scoped; not persisted) ───────────────────
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Optional hook the AuthProvider registers so that a definitive refresh failure
 * (session ended) can drive the app to an anonymous/re-auth state. Keeps the
 * client decoupled from React.
 */
let onRefreshFailure: (() => void) | null = null;
export function setOnRefreshFailure(handler: (() => void) | null): void {
  onRefreshFailure = handler;
}

// ── Normalized API error ──────────────────────────────────────────────────────
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(status: number, body: ErrorResponse['error'] | undefined, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? 'unknown_error';
    if (body?.fields) this.fields = body.fields;
    if (body?.request_id) this.requestId = body.request_id;
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 0;
    const body = (error.response?.data as ErrorResponse | undefined)?.error;
    return new ApiError(status, body, error.message || 'Request failed');
  }
  return new ApiError(0, undefined, error instanceof Error ? error.message : 'Network error');
}

// ── Axios instances ────────────────────────────────────────────────────────────
// `api` carries the Bearer + refresh interceptors. `rawClient` is bare (no
// interceptors) and is used to call /auth/refresh itself, so a refresh can never
// recursively trigger another refresh.
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

const rawClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the in-memory access token on every request.
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

// ── Single-flight refresh ───────────────────────────────────────────────────────
let refreshPromise: Promise<string> | null = null;

/**
 * Calls POST /auth/refresh (cookie-authorized + the X-Refresh CSRF header, api-spec
 * §2.2). Returns the new access token. Coalesces concurrent callers onto one promise.
 */
export function performRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = rawClient
      .post<AuthTokenResponse>('/auth/refresh', null, {
        headers: { 'X-Refresh': '1' },
      })
      .then((res) => {
        const token = res.data.access_token;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        // Allow the next refresh cycle once this one settles.
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Extend the request config with a one-shot retry flag.
interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

// On 401, attempt a single-flight refresh and replay the original request once.
api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!(error instanceof AxiosError) || !error.response) {
      return Promise.reject(toApiError(error));
    }

    const status = error.response.status;
    const original = error.config as (RetriableConfig & InternalAxiosRequestConfig) | undefined;

    // Only attempt refresh-and-replay for a genuine 401 on a non-retried request,
    // and never for the refresh endpoint itself.
    const isRefreshCall = original?.url?.includes('/auth/refresh');
    if (status === 401 && original && !original._retried && !isRefreshCall) {
      original._retried = true;
      try {
        const newToken = await performRefresh();
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return api.request(original);
      } catch (refreshErr) {
        // Refresh definitively failed → session ended. Notify the AuthProvider.
        setAccessToken(null);
        onRefreshFailure?.();
        return Promise.reject(toApiError(refreshErr));
      }
    }

    return Promise.reject(toApiError(error));
  },
);

export { API_BASE_URL };

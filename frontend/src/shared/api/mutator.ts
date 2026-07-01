/**
 * orval custom mutator (api-specification.md §9, OQ-FE-B).
 *
 * orval-generated operations call THIS function instead of emitting their own
 * fetch/axios client. It delegates to the shared `api` axios instance from
 * `client.ts`, so every generated request inherits — for free and in one place:
 *   - `Authorization: Bearer <in-memory token>` (request interceptor)
 *   - SINGLE-FLIGHT refresh-and-replay on 401 (response interceptor)
 *   - `withCredentials: true` so the HttpOnly `sis_refresh` cookie rides along
 *   - error normalization into `ApiError` (the response interceptor rejects with it)
 *
 * Do NOT let orval generate a parallel HTTP client — that would bypass the refresh
 * logic, which is the entire reason orval is configured to reuse this instance.
 *
 * Signature contract: orval's `mutator` calls `customInstance<T>(config)` and (with
 * `override.mutator.alias`) may also pass a second `options` arg for per-call axios
 * overrides; we merge it. The returned promise resolves to the response body `T`
 * (we unwrap `response.data`) — matching how the hand-authored wrappers consume it.
 */

import type { AxiosRequestConfig } from 'axios';
import { api } from './client';

export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => {
  return api({ ...config, ...options }).then((response) => response.data as T);
};

export default customInstance;

// orval references this type for the generated `ErrorType` / `BodyType` aliases.
export type ErrorType<Error> = Error;
export type BodyType<BodyData> = BodyData;

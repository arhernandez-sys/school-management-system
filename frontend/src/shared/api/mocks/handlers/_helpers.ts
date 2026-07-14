/**
 * Shared MSW handler helpers (demo). Small utilities the per-module handler files
 * reuse so responses stay consistent (error envelope, list-param parsing).
 *
 * ⚠️ Module agents may import from here; do not add module-specific logic to this file.
 */
import { HttpResponse } from 'msw';
import type { DemoListParams } from '@shared/api/mocks/demo/dataset';

/** Build the api-spec ErrorResponse envelope (§4.2) with a given status. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
) {
  return HttpResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

/** Parse the common Page[T] list params (page/page_size/sort/search) from a URL. */
export function listParamsFrom(url: URL): DemoListParams {
  const page = url.searchParams.get('page');
  const pageSize = url.searchParams.get('page_size');
  const params: DemoListParams = {
    sort: url.searchParams.get('sort'),
    search: url.searchParams.get('search'),
  };
  if (page) params.page = Number(page);
  if (pageSize) params.page_size = Number(pageSize);
  return params;
}

/** Parse a nullable boolean query param ("true"/"false" → boolean, absent → null). */
export function boolParam(url: URL, key: string): boolean | null {
  const v = url.searchParams.get(key);
  if (v === null) return null;
  return v === 'true';
}

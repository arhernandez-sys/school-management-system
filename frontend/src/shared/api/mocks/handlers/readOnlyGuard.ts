import { http, HttpResponse } from 'msw';

/**
 * The Auditor's read-only guarantee, in the demo (D43).
 *
 * **This is the mock's mirror of `backend/app/core/deps.py::_is_read_only_refusal`,
 * and it is deliberately built the same way — once, centrally, in front of everything.**
 *
 * The demo layer re-implements authorization per handler (`sessionRole` appears in nine
 * files, each with its own gate), and that has twice certified behaviour the real backend
 * refused. Adding "and also check for auditor" to nine files would have been the third
 * time: the failure mode is a handler somebody forgets, and the whole point of the role is
 * that there is no such handler.
 *
 * Registered FIRST in `handlers/index.ts`. MSW v2 matches in array order and treats a
 * resolver returning `undefined` as "not handled, keep looking", so this sees every
 * request, refuses the mutating ones for an auditor, and gets out of the way for
 * everyone else.
 *
 * The three exemptions match `_READ_ONLY_EXEMPT` on the server: they act on the caller's
 * own session and credentials, not on school data. `/auth/login` needs no exemption —
 * nobody is an auditor until it succeeds.
 */
const SESSION_COOKIE = 'sis_mock_session';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT_SUFFIXES = ['/auth/logout', '/auth/me/password', '/auth/me/preferences'];

export const readOnlyGuardHandlers = [
  http.all('*', ({ request, cookies }) => {
    if (!WRITE_METHODS.has(request.method)) return undefined;
    if ((cookies[SESSION_COOKIE] ?? '') !== 'auditor') return undefined;

    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (EXEMPT_SUFFIXES.some((s) => path.endsWith(s))) return undefined;

    // Same envelope and same `code` the server sends, so anything the UI keys on the
    // error code for behaves identically in the demo.
    return HttpResponse.json(
      {
        error: {
          code: 'read_only_role',
          message: 'This account has read-only access and cannot make changes.',
        },
      },
      { status: 403 },
    );
  }),
];

export default readOnlyGuardHandlers;

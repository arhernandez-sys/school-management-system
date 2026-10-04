"""Request-scoped context for the audit trail (D45 §46).

§46 wants the client IP recorded against a sensitive action "where appropriate". The
services that write `audit_log` take `(db, actor, ...)` and have no `Request` — there are
83 distinct audit actions across 20 modules, and threading a `Request` through all of
them to reach `request.client` would change every service signature in the system to
carry a transport detail that only one column consumes.

A `ContextVar` is the right shape for exactly this: it is set once per request by
`AuditContextMiddleware`, read once per row by the `before_insert` listener on `AuditLog`,
and is invisible everywhere in between.

**It is deliberately optional.** Anything that writes an audit row outside an HTTP request
— a seed, a migration, a management command, a test calling the service directly — leaves
it unset and the column is NULL. That is the honest answer: there was no client. A
fabricated `127.0.0.1` would be worse than a blank, because an auditor cannot tell an
invented address from a real one.

ContextVars are per-task under asyncio, so concurrent requests cannot see each other's
value, and the token reset in the middleware's `finally` keeps a worker thread from
inheriting the previous request's address.
"""

from __future__ import annotations

from contextvars import ContextVar, Token

#: The resolved client address for the request currently being handled, or None.
_client_ip: ContextVar[str | None] = ContextVar("audit_client_ip", default=None)


def set_client_ip(value: str | None) -> Token:
    """Set the address for this request. Returns the token to reset with."""
    return _client_ip.set(value)


def reset_client_ip(token: Token) -> None:
    _client_ip.reset(token)


def get_client_ip() -> str | None:
    """The address for the request in flight, or None outside one."""
    return _client_ip.get()

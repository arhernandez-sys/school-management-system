"""Resolving the real client address behind an (optional) reverse proxy.

WHY THIS EXISTS
───────────────────────────────────────────────────────────────────────────────
`request.client.host` is the address of whatever opened the TCP connection. Put
ANY reverse proxy in front of the app — nginx, Caddy, a PaaS edge, Cloudflare —
and that is the proxy, identically, for every request on earth. Every
`login_attempts.ip_address`, every `refresh_sessions.ip_address` and every
IP-keyed rate-limit bucket then collapses onto one value: the forensic trail
becomes a column of the same string, and the limiter throttles the entire
internet as a single client.

WHY NOT JUST READ X-Forwarded-For
───────────────────────────────────────────────────────────────────────────────
Because `X-Forwarded-For` is a request header, so a client sets it. Trusting it
unconditionally is strictly WORSE than not reading it at all: an attacker sends
`X-Forwarded-For: 1.2.3.4`, rotates that value per request, and evades the rate
limiter completely while poisoning the audit log with addresses of their choosing.

So the header is honoured only when the immediate peer — the address we actually
observed at the socket, which cannot be forged — is in the operator-configured
`TRUSTED_PROXIES` list. With that list empty (the default) XFF is ignored outright
and the peer is used, which is exactly right for a directly-exposed app.

WHY THE RIGHTMOST ENTRY, NOT THE FIRST
───────────────────────────────────────────────────────────────────────────────
A conforming proxy APPENDS the address it received from. If a client sends
`X-Forwarded-For: 1.2.3.4` and our proxy appends their real address, the app sees

    X-Forwarded-For: 1.2.3.4, <attacker's real IP>

The leftmost entry is therefore attacker-controlled in every deployment — reading
it is the classic spoof. We instead walk the chain RIGHT to LEFT and take the
first entry that is not itself a trusted proxy: everything to the right of that
point was written by infrastructure we trust, everything at or left of it is
hearsay. Chained proxies work (each trusted hop is skipped); a forged prefix is
ignored because the attacker's genuine address sits to its right.

An unparseable hop stops the walk and falls back to the peer, because a chain we
cannot read is a chain we cannot trust.

⚠ UVICORN HAS ITS OWN, COMPETING PROXY-HEADER LAYER — TURN IT OFF
───────────────────────────────────────────────────────────────────────────────
Verified against uvicorn 0.34.0: `proxy_headers` defaults to TRUE and
`forwarded_allow_ips` defaults to `os.environ.get("FORWARDED_ALLOW_IPS",
"127.0.0.1")`. So out of the box, uvicorn's own `ProxyHeadersMiddleware` wraps
this app and REWRITES `scope["client"]` from `X-Forwarded-For` whenever the peer
is 127.0.0.1 — the exact layout of a self-hosted nginx/Caddy on the same host.

That happens ABOVE us, so by the time `resolve_client` runs, `request.client` is
no longer the socket peer and `TRUSTED_PROXIES` has been bypassed: the operator
configures one trust policy while a second, unconfigured one is silently in
charge. Run the server with uvicorn's layer disabled so this module is the single
decision point:

    uvicorn app.main:app --forwarded-allow-ips=""

(or export `FORWARDED_ALLOW_IPS=` before starting; a `.env` entry will NOT work —
pydantic-settings loads `.env` into the app, not into uvicorn's process
environment, and uvicorn resolves this default before importing the app.)

`_warn_if_peer_was_rewritten` below detects the situation at runtime and logs
once, because a silent misconfiguration here is invisible until an incident.
"""

from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass
from functools import lru_cache

from starlette.requests import Request

from app.config import Settings, get_settings

logger = logging.getLogger("sis.net")

_XFF_HEADER = "x-forwarded-for"

#: Rate-limit key used when the peer has no usable address at all (ASGI transports
#: without a client, e.g. a lifespan or in-process call). Everything anonymous
#: shares one bucket, which fails CLOSED — the safe direction.
_UNKNOWN_KEY = "unknown"


@dataclass(frozen=True, slots=True)
class ClientAddress:
    """Two views of the same resolution, so it is only performed once.

    `ip`  — a normalized IP string, or None when the peer is not an IP at all
            (Starlette's TestClient reports the literal host "testclient", and a
            unix-socket peer has no address). The `ip_address` audit columns take
            None rather than a junk value; they are advisory fields, not a
            security control, and `auth/service.py` stores them as-is.
    `key` — never empty, so the rate limiter always has something to count
            against even when `ip` is None.
    """

    ip: str | None
    key: str


def _normalize_ip(raw: str | None) -> str | None:
    """Parse one address, tolerating `host:port` and `[v6]:port` forms.

    Returns the canonical string form, or None if it is not an IP address.
    """
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    if value.startswith("["):
        # "[2001:db8::1]:443" — bracketed IPv6, optionally with a port.
        end = value.find("]")
        if end != -1:
            value = value[1:end]
    elif value.count(":") == 1 and "." in value:
        # "203.0.113.7:54321" — IPv4 with a port. A bare IPv6 always has >= 2
        # colons, so this test cannot mangle one.
        value = value.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


@lru_cache(maxsize=8)
def _trusted_networks(raw: str) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    """Parse TRUSTED_PROXIES once per distinct value (it is read every request).

    Entries are already validated at config load (`Settings._validate_trusted_proxies`),
    so an unparseable one here can only come from a hand-built Settings in a test;
    it is skipped rather than raised, since failing a request over config shape is
    worse than ignoring one entry.
    """
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            networks.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def _is_trusted(
    ip: str, networks: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]
) -> bool:
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # Version must match explicitly — `IPv4Address in IPv6Network` raises TypeError.
    return any(address.version == net.version and address in net for net in networks)


#: Set once we have complained about uvicorn's proxy-header layer, so the warning
#: does not repeat on every request. A missed duplicate under a race is harmless.
_peer_rewrite_warned = False


def _warn_if_peer_was_rewritten(request: Request) -> None:
    """Detect uvicorn's ProxyHeadersMiddleware having already replaced the peer.

    The tell is the port: uvicorn hardcodes `scope["client"] = (host, 0)` when it
    substitutes an `X-Forwarded-For` value, and a real accepted socket never has
    a peer port of 0. When that fires, `TRUSTED_PROXIES` is NOT in control of the
    address being recorded and rate-limited — see the module docstring for the
    launch flag that fixes it.
    """
    global _peer_rewrite_warned
    if _peer_rewrite_warned:
        return
    client = request.client
    if client is None or client.port != 0:
        return
    if _XFF_HEADER not in request.headers:
        return
    _peer_rewrite_warned = True
    logger.warning(
        "proxy_header_conflict: the ASGI server already replaced the client "
        "address from X-Forwarded-For, so TRUSTED_PROXIES is not in control of "
        "the audited/rate-limited IP. Start uvicorn with "
        '--forwarded-allow-ips="" (or export FORWARDED_ALLOW_IPS=) so '
        "app/core/net.py is the single trust decision point."
    )


def resolve_client(request: Request, settings: Settings | None = None) -> ClientAddress:
    """Determine the client address for auditing and rate limiting.

    See the module docstring for the trust model. Never raises.
    """
    settings = settings or get_settings()

    _warn_if_peer_was_rewritten(request)

    peer_host = request.client.host if request.client else None
    peer_ip = _normalize_ip(peer_host)
    resolved = peer_ip

    networks = _trusted_networks(settings.trusted_proxies)
    if networks and peer_ip is not None and _is_trusted(peer_ip, networks):
        forwarded = request.headers.get(_XFF_HEADER)
        if forwarded:
            for candidate in reversed(forwarded.split(",")):
                hop = _normalize_ip(candidate)
                if hop is None:
                    # Garbage in the chain: stop and keep the peer. Continuing
                    # left would mean trusting entries we can no longer attribute.
                    break
                if _is_trusted(hop, networks):
                    continue  # our own infrastructure; keep walking left
                resolved = hop
                break
            # If every hop was a trusted proxy we fall through with `resolved`
            # still set to the peer, which is the honest answer.

    return ClientAddress(ip=resolved, key=resolved or peer_host or _UNKNOWN_KEY)


def client_ip(request: Request, settings: Settings | None = None) -> str | None:
    """The client's IP for the `ip_address` audit columns, or None if unknown."""
    return resolve_client(request, settings).ip

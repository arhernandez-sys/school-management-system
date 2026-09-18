"""
Passenger entry point for cPanel's "Setup Python App" (shared hosting).

cPanel runs Python apps under Phusion Passenger, which speaks **WSGI**. This
backend is **ASGI** (FastAPI/Starlette). Handing Passenger the ASGI callable
directly does not fail at import time — it fails per request, with a 500 and a
`TypeError` in `stderr.log`, because Passenger calls it with the two-argument
WSGI signature. So the ASGI app is wrapped in `a2wsgi.ASGIMiddleware`, which
runs it in an event loop of its own and translates each WSGI request/response.

Set in the cPanel panel:

    Application root          <this file's directory>   (the `backend/` folder)
    Application startup file  passenger_wsgi.py
    Application entry point   application

`a2wsgi` is a DEPLOYMENT-TARGET dependency, not an application one — it is
deliberately absent from `requirements.txt` / `pyproject.toml`. Install it into
the virtualenv cPanel creates, alongside the runtime requirements:

    pip install -r requirements.txt
    pip install a2wsgi

What this bridge costs you, and why it is acceptable here:

  * WSGI has no streaming, no server-sent events and no websockets. Nothing in
    this backend uses them.
  * WSGI has no ASGI lifespan protocol, so startup/shutdown handlers never run.
    `app/main.py` registers none — `create_app()` does all its work at import.
  * Every async endpoint is driven through a bridged event loop rather than
    uvicorn's. Correct, but slower than `uvicorn app.main:app`. If throughput
    matters, run uvicorn on a VPS instead of Passenger on shared hosting.
"""

import os
import sys
from pathlib import Path

# ── Make the `app` package importable, whatever Passenger's cwd happens to be ──
# Passenger normally starts the process in the application root, but that is a
# convention, not a guarantee. Anchoring on THIS file's location is, so the
# import below cannot break because the panel's "Application root" was typed
# with a stray path component.
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# `Settings` reads `env_file=".env"`, which pydantic-settings resolves RELATIVE
# TO THE CURRENT WORKING DIRECTORY. Pinning the cwd here means a `.env` placed
# next to this file is found, instead of the settings silently falling back to
# their local-development defaults — which `validate_runtime()` would then
# reject as insecure production config (a 500 on every request, with the reason
# in `stderr.log`). Environment variables set in the cPanel panel take
# precedence over the file either way, and are the safer place for secrets.
os.chdir(BASE_DIR)

from a2wsgi import ASGIMiddleware  # noqa: E402  (must follow the sys.path setup)

from app.main import app as asgi_app  # noqa: E402


def _unmount(environ: dict) -> None:
    """Fold Passenger's mount prefix back into the path Starlette routes on.

    THIS IS THE FIX FOR "the routes are all there but every request 404s".

    When the cPanel app's URL has a path component (`school.edu.bz/api` rather
    than a bare `api.school.edu.bz`), Apache/Passenger splits the request:

        GET /api/v1/health   ->   SCRIPT_NAME="/api"   PATH_INFO="/v1/health"

    `a2wsgi` faithfully maps that to ASGI as `path="/api/v1/health"` plus
    `root_path="/api"` — and Starlette's router then STRIPS `root_path` off
    `path` before matching, so it looks for `/v1/health`. No such route exists,
    because every route in this app is mounted under the literal `/api/v1`
    prefix (`main.API_V1_PREFIX`), so the request 404s.

    That 404 is uncommonly hard to read, because the request log line prints the
    UNSTRIPPED path:

        sis.request request method=GET path=/api/v1/health status=404

    — a path that plainly does exist, reported missing. Anyone comparing it
    against the route table concludes the route table is wrong. It is not; the
    mount prefix is being subtracted twice.

    Clearing `SCRIPT_NAME` after prepending it makes `root_path` empty, so
    Starlette matches the full incoming path and the app answers identically
    whether it is mounted at a subdomain root or under a sub-path. It is a no-op
    on a root mount, where `SCRIPT_NAME` is already `""`.

    The cost of clearing `root_path`: FastAPI no longer knows the prefix, so the
    `servers` block in the generated OpenAPI document and the "Try it out"
    button in `/api/v1/docs` use paths relative to the mount instead of the site
    root. Nothing the SPA consumes is affected — it calls a relative
    `VITE_API_BASE_URL=/api/v1` and never reads `servers`.
    """
    script_name = environ.get("SCRIPT_NAME", "")
    if script_name:
        environ["PATH_INFO"] = script_name + environ.get("PATH_INFO", "")
        environ["SCRIPT_NAME"] = ""


_bridge = ASGIMiddleware(asgi_app)


#: The WSGI callable Passenger looks for. The name must match the panel's
#: "Application entry point" field exactly.
def application(environ, start_response):
    _unmount(environ)
    return _bridge(environ, start_response)

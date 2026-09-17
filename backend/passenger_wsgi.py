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

#: The WSGI callable Passenger looks for. The name must match the panel's
#: "Application entry point" field exactly.
application = ASGIMiddleware(asgi_app)

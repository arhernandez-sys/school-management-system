# Deploying SIS to cPanel — clean-slate procedure

**Status:** active. Written 17 Sep 2026 after a deploy to `api.sims.bajc.edu.bz` that
would not serve, while `backend/passenger_wsgi.py` imported cleanly and the route
table printed every path from the command line.

**Read §0a first.** It records what the live deployment actually does, measured
rather than assumed — and it turns out the Passenger wiring is already right and the
Python app is raising. §0b documents a *different* fault, a real routing bug that was
found and fixed along the way; it applies to a sub-path mount, which this deployment
is not. Do not act on §0b or §1 before reading §0a.

This document replaces trial-and-error. Work top to bottom and tick the boxes; each
phase ends in a check that either passes or tells you which phase is wrong. Do not
skip a check — the failures in this stack are almost all silent, and the one that
started this document reported a path as missing that demonstrably existed.

`RUNBOOK.md` §10 remains the reference for a **VPS / reverse-proxy** deploy (uvicorn
behind nginx). That is the better-performing target. This document is for shared
hosting, where Passenger is the only option available.

---

## 0a. The live deployment, as measured 17 Sep 2026

The target is **Layout B** (§2): two subdomains on the `edubx` cPanel account.

```
home                 /home/edubx/
application root     /home/edubx/repositories/school-management-system/backend
SPA                  https://sims.bajc.edu.bz/            <- WORKS (200, serves index.html)
API                  https://api.sims.bajc.edu.bz/        <- Passenger reached, app ERRORS
```

Probed from outside, every path on the API subdomain behaves like this:

| Path | Result | What it proves |
| --- | --- | --- |
| `/api/v1/health` | **500**, Apache HTML | Passenger ran the app; the app raised |
| `/health` | **500** | same |
| `/anything-random-xyz` | **500** | Passenger handles **every** path — it is mounted at the subdomain ROOT, correctly |
| `/` | 404 | docroot has no `index.html`; Passenger passes through paths that exist on disk. Harmless |
| `/api` | 301 → `/api/` | there is a **stray `api/` directory** in the API docroot. Leftover from an earlier attempt; delete it |
| TLS on both hosts | `ssl_verify_result=0` | AutoSSL is valid for the 4-label name. Nothing to do |

**The current blocker is a 500, not a 404.** A 500 on *every* path — including
`/anything-random-xyz`, which no route claims — means the failure happens while
importing or constructing the app, before routing is ever consulted. The routing bug
described in §0b is real and now fixed, but it is not what is stopping this deploy.

### The two things that produce exactly this

1. **`ModuleNotFoundError: No module named 'a2wsgi'`.** `a2wsgi` is deliberately
   absent from `requirements.txt` (it is a deployment-target dependency, not an
   application one), so `pip install -r requirements.txt` alone does **not** install
   it, and `passenger_wsgi.py` imports it at module scope. §5.
2. **`RuntimeError` from `validate_runtime()`.** `ENVIRONMENT` defaults to `local`
   (`app/config.py:160`), and `local` skips every guard — so a *missing* `.env` alone
   would boot and answer 200. But if `ENVIRONMENT=production` is set while
   `JWT_SECRET`, `DATABASE_URL` or `CORS_ORIGINS` are not, the app refuses to start
   and 500s on every request. §6.

> **`.env` is in `.gitignore`, so a cPanel Git Version Control deploy never carries
> it.** The application root is under `~/repositories/`, which is where cPanel clones
> git repositories — so the `.env` file has to be created **on the server, by hand,
> once**, and it survives subsequent pulls precisely because git ignores it.

`~/repositories/school-management-system/backend/stderr.log` names the actual
exception. Read it before changing anything — the two causes above have different
fixes and the same symptom. `deploy/cpanel-diagnose.sh` collects it along with
everything else in §9's table.

### Also, because the app root is a git clone

Local commits do not exist on the server until they are pushed **and** cPanel pulls
them. The routing fix in `backend/passenger_wsgi.py` and the SPA rewrite guard in
`frontend/public/.htaccess` are both in the working tree only. Commit, push, then
**cPanel → Git Version Control → Manage → Update from Remote → Deploy HEAD Commit**.

---

## 0b. First: find out WHICH 404 you have

There are two completely different 404s here and they have nothing to do with each
other. Read the **body**, not the status code. From your own machine:

```bash
curl -si https://<your-domain>/api/v1/health
```

| Response body | Meaning | Go to |
| --- | --- | --- |
| `{"error":{"code":"not_found","message":"Not Found"}}` | Python app is RUNNING. Passenger reached it. The URL prefix and the app's route prefix disagree. | §1 (the cause is fixed by the new `passenger_wsgi.py`) |
| Apache HTML — `<title>404 Not Found</title>` | Passenger was **never invoked**. Apache answered by itself. The `.htaccess` / document-root wiring is wrong. | §1 |
| `{"status":"ok"}` | The backend is fine. Your problem is the frontend. | §8 |

Both lead to the same clean rebuild, so you do not need to decide anything here — but
note which one you saw, because §9 tells you what it proved.

### What actually broke, so you recognise it if it returns

The app mounts **every** route under the literal prefix `/api/v1`
(`backend/app/main.py`, `API_V1_PREFIX`). When a cPanel Python app's URL has a path
component — `school.edu.bz/api` rather than a bare `api.school.edu.bz` — Apache
splits the incoming request in two before Passenger sees it:

```
GET /api/v1/health   ->   SCRIPT_NAME = "/api"     PATH_INFO = "/v1/health"
```

`a2wsgi` maps that to ASGI as `path="/api/v1/health"` with `root_path="/api"`, and
Starlette's router then **strips `root_path` off `path`** before matching. It looks
for `/v1/health`. Nothing is mounted there, so: 404.

The prefix is subtracted twice. Nothing is wrong with your route table — which is why
checking the route table from the command line proves nothing, and reassures you
falsely. Worse, the request log prints the *unstripped* path:

```
sis.request request method=GET path=/api/v1/health status=404
```

A path that exists, reported missing. That line is the fingerprint of this bug.

`_unmount()` in `backend/passenger_wsgi.py` now folds the prefix back in before the
bridge runs, so the app answers identically at a subdomain root or under a sub-path.
Verified by driving the WSGI callable directly with a synthesised Passenger environ
for all three mount shapes — `""`, `/api`, `/api/v1` — plus a POST with a JSON body.

---

## 1. Delete — the clean slate

> **You almost certainly do NOT need this section right now.** As measured in §0a,
> the subdomain, the document root, the `.htaccess` and the Passenger mount are all
> **already correct** — Passenger is invoking the app on every path. Destroying the
> app would throw away the one part that works and rebuild it identically. Go to §5
> and §6, fix the 500, and only come back here if `stderr.log` shows the app was
> never reached at all.
>
> This section is for a genuine clean slate: a mount that Apache answers by itself
> (plain HTML 404 on every path, §0b row 2), or a rebuild on a different host.

Order matters: destroy the app registration **before** deleting files, or cPanel
leaves a half-configured Apache include behind.

- [ ] **cPanel → Setup Python App → your app → Destroy** (the trash icon). This
      removes the registration and the virtualenv cPanel built. It does **not**
      reliably remove the `.htaccess` it wrote — the next items do that.
- [ ] **File Manager → Settings (top right) → tick "Show Hidden Files".** You cannot
      see or delete any of the following without this, and every one of them is a
      dotfile. This single setting is the most common reason a "clean" redeploy
      behaves exactly like the broken one.
- [ ] Delete `public_html/.htaccess` **only if you did not write it yourself** — a
      correct one is shipped in §8. If in doubt, download a copy first.
- [ ] Delete any `.htaccess` and stray `api/` folder in the API subdomain's document root.
      This is cPanel's generated Passenger wiring; a stale one points at an
      application root that no longer exists, which is an Apache 404 on every
      request — the second row of the table in §0.
- [ ] Delete the whole uploaded `backend/.venv/` folder if you uploaded one. A
      virtualenv built on Windows contains `Scripts\python.exe` and absolute `C:\`
      paths; on Linux it is not merely useless, it shadows the working one.
      **cPanel builds the venv for you — never upload one.**
- [ ] Delete every `__pycache__/` folder under `backend/`. A `.pyc` compiled from the
      *previous* `passenger_wsgi.py` can be loaded in preference to your new source
      file, so your fix appears to have no effect. Over SSH:
      `find ~/repositories/school-management-system/backend -name __pycache__ -type d -exec rm -rf {} +`
- [ ] Delete `backend/tests/`, `backend/scratchpad/`, `backend/.pytest_cache/` and
      `backend/openapi.json` from the server. None are needed at runtime;
      `openapi.json` is stale (RUNBOOK §12) and only invites confusion.
- [ ] Do not bother deleting `tmp/restart.txt`. You will recreate it in §6 — it must
      be *newer* than your last file change to mean anything.

Nothing in this list touches the database. Your `sims` data is untouched throughout.

---

## 2. The layout

### Layout B — API on its own subdomain  ← **this deployment**

```
/home/edubx/repositories/school-management-system/backend/   <- application root
                                                                (under ~/repositories,
                                                                 outside public_html — good)

https://sims.bajc.edu.bz/                 -> the SPA (contents of frontend/dist)
https://api.sims.bajc.edu.bz/api/v1/*     -> Passenger -> FastAPI
```

- Application URL: the **`api.sims.bajc.edu.bz` subdomain, path box EMPTY**. Leaving
  the path box empty is what makes `SCRIPT_NAME` empty, and an empty `SCRIPT_NAME` is
  why the §0b prefix bug cannot bite this deployment. Measured: it is mounted
  correctly today.
- `frontend/.env.production`: `VITE_API_BASE_URL=https://api.sims.bajc.edu.bz/api/v1`
- `CORS_ORIGINS=https://sims.bajc.edu.bz` — the request is cross-origin now, so the
  CORS allow-list becomes load-bearing instead of decorative. An origin missing here
  is a browser-only failure: `curl` keeps working, so it looks like a frontend bug.
- `TRUSTED_HOSTS=api.sims.bajc.edu.bz` — the host the API answers on, **not** the SPA's.

**Cross-origin is fully supported by the backend.** `app/core/cookies.py` sends the
`sis_refresh` cookie as `SameSite=None; Secure` whenever `ENVIRONMENT != local`,
which is exactly the posture a cross-site refresh call needs. Two conditions are
load-bearing:

- **Both subdomains must be HTTPS.** `SameSite=None` without `Secure` is rejected
  outright by every current browser, so on plain http every user is logged out on
  each reload. Measured 17 Sep 2026: AutoSSL is valid on both hosts.
  `api.sims.bajc.edu.bz` is a *four-label* name and a wildcard for `*.bajc.edu.bz`
  would **not** cover it — so if the certificate is ever reissued, re-check this.
- `ENVIRONMENT=production` must actually be set, or the cookie goes out `SameSite=Lax`
  and the browser drops it on the cross-site `/auth/refresh`. The symptom is "login
  works, then I'm logged out on reload" — which reads as an auth bug, not a config one.

### Layout A — same origin, API under a sub-path (the alternative)

Not what you have, and not worth switching to now that the subdomain works. Recorded
because `RUNBOOK.md` §10.2 recommends same-origin, and this is what it would mean:
SPA at `sims.bajc.edu.bz/`, API at `sims.bajc.edu.bz/api` (Application URL path box
= `api`), `VITE_API_BASE_URL=/api/v1` relative, and no CORS list to maintain. It
needs the `_unmount()` fix from §0b, and the `/api` exclusion in the SPA's
`.htaccess`, both of which are now in the repo.

> **Keep the application root outside any document root**, as it already is. Inside
> one, `backend/.env` is a plain downloadable file: anyone could fetch
> `https://sims.bajc.edu.bz/backend/.env` and read `JWT_SECRET` and the database
> password. Passenger only shields paths under its own mount URL.

---

## 3. Get the code onto the server

The application root is under `~/repositories/`, which is cPanel's **Git Version
Control** clone directory. So this is a `git pull`, not an upload:

- [ ] Commit and push the backend and frontend changes locally.
- [ ] **cPanel → Git Version Control → Manage → Update from Remote**, then
      **Deploy HEAD Commit**.
- [ ] Confirm the spelling of the clone directory. The repository is
      `school-management-system`. If the cPanel Python app's "Application root" says
      `school-management-school` — a plausible slip, and the path as reported — it
      points at a *different, empty* folder that cPanel created without complaint,
      and cPanel then serves its own stub from it. Both must be the same string:
      ```bash
      ls -d ~/repositories/*/backend
      ```
- [ ] Confirm these exist: `passenger_wsgi.py`, `app/main.py`, `requirements.txt` in
      `~/repositories/school-management-system/backend/`.
- [ ] Confirm the deployed `passenger_wsgi.py` contains `def _unmount(environ`:
      ```bash
      grep -c _unmount ~/repositories/school-management-system/backend/passenger_wsgi.py
      ```
      `0` means the pull did not land, or cPanel overwrote it (see §4). A file
      containing `It works!` is cPanel's stub, not this project's file.
- [ ] Delete the stray `api/` directory in the API subdomain's document root. It is a
      leftover from an earlier attempt with a path component in the Application URL;
      it does no harm at the root mount, but it makes `/api` answer 301 from Apache
      instead of reaching the app, which is confusing when you are reading probes.

Because `backend/.env` is git-ignored it is **never** carried by a pull. Create it
once on the server (§6); subsequent deploys leave it alone, which is the point.

---

## 4. Create the Python app

cPanel → **Setup Python App** → Create Application.

| Field | Value |
| --- | --- |
| Python version | **3.11 or newer.** `pyproject.toml` sets `requires-python = ">=3.11"` |
| Application root | `repositories/school-management-system/backend` — check the spelling (§3) |
| Application URL | `api.sims.bajc.edu.bz`, **path box EMPTY** |
| Application startup file | `passenger_wsgi.py` |
| Application entry point | `application` |

- [ ] Created.
- [ ] **Re-open `~/sis/backend/passenger_wsgi.py` and check for `_unmount` again.**
      cPanel writes a sample `passenger_wsgi.py` into the application root when it
      creates an app, and it will happily overwrite yours. If it did, re-upload the
      real file now. This is the single most likely way a correct fix disappears
      between §3 and §7.

If the Python version dropdown offers nothing ≥ 3.11, stop. The backend uses modern
syntax and typing that will raise on import under 3.9. Ask your host to enable a
newer interpreter, or move to a VPS and follow `RUNBOOK.md` §10 instead.

---

## 5. Install dependencies

Setup Python App shows a command like
`source /home/edubx/virtualenv/repositories/school-management-system/backend/3.11/bin/activate && cd /home/edubx/repositories/school-management-system/backend`.
Copy it from the panel — do not retype the path. Then in **Terminal** (or SSH):

```bash
source /home/edubx/virtualenv/repositories/school-management-system/backend/3.11/bin/activate
cd /home/edubx/repositories/school-management-system/backend

pip install -r requirements.txt
pip install a2wsgi                 # deployment-only; deliberately NOT in requirements.txt
```

- [ ] Both installs finished without an error.
- [ ] `python -c "import a2wsgi, fastapi, pymysql, app.main; print('imports ok')"`

If your host disables Terminal, Setup Python App has an **Add Package** box. Add
`a2wsgi`, then paste each pinned line from `requirements.txt` into it. Tedious — it is
worth one support ticket to get Terminal enabled instead.

`argon2-cffi` has to compile if no wheel matches the interpreter. If it fails on
missing `cffi` headers that is a host limitation, not a project one; open a ticket.

---

## 6. Configure and restart

- [ ] Create `~/repositories/school-management-system/backend/.env`. **Do not upload your local one** — it holds the dev
      `JWT_SECRET` and a local database URL, and `validate_runtime()` rejects both in
      production with a 500 on every request.

```ini
ENVIRONMENT=production
JWT_SECRET=<64 hex chars — generate fresh; >= 32 or the app refuses to start>
DATABASE_URL=mysql+pymysql://<cpanel_db_user>:<urlencoded-password>@127.0.0.1:3306/<cpanel_db_name>
CORS_ORIGINS=https://sims.bajc.edu.bz
TRUSTED_HOSTS=api.sims.bajc.edu.bz
TRUSTED_PROXIES=127.0.0.1
HSTS_MAX_AGE=300
```

URL-encode the password: `@` → `%40`, `#` → `%23`, `/` → `%2F`. An unencoded `@`
silently truncates the host, and you get a connection error naming a host you never
typed. cPanel database names and users are prefixed — `arhern_sims`, not `sims`.

`HSTS_MAX_AGE=300` is deliberately low. HSTS cannot be un-sent to a browser that
cached it; a year-long header on a bad certificate locks users out for a year. Raise
it to `31536000` once TLS is proven.

Secrets are safer in **Setup Python App → Environment variables** than in a file, and
panel variables take precedence over `.env` either way. If you use the panel, set
`JWT_SECRET` and `DATABASE_URL` there and leave them out of the file.

- [ ] Restart. Passenger caches the loaded app; editing a file changes nothing until
      you do this. Either click **Restart** in Setup Python App, or:
      `mkdir -p ~/repositories/school-management-system/backend/tmp && touch ~/repositories/school-management-system/backend/tmp/restart.txt`

---

## 7. Verify the backend ALONE — before touching the frontend

```bash
curl -si https://api.sims.bajc.edu.bz/api/v1/health
```

- [ ] `200` with `{"status":"ok"}`. **Do not continue past a failure here** — every
      frontend symptom downstream will be a misleading second-order effect.
- [ ] `curl -si https://api.sims.bajc.edu.bz/api/v1/ready` → `200 {"status":"ready"}`.
      A `503` means the app is healthy but cannot reach MariaDB: re-check
      `DATABASE_URL`, the password encoding, and that the cPanel DB user is
      **granted** on the database (creating both does not connect them).
- [ ] `https://api.sims.bajc.edu.bz/api/v1/docs` loads in a browser.
- [ ] Read `~/repositories/school-management-system/backend/stderr.log` once, top to bottom, even on a pass. The startup
      `hardening_advisory` warnings are the difference between "it runs" and "it is
      configured" (RUNBOOK §10.5).

Anything non-200 → §9.

---

## 8. Frontend

- [ ] Create `frontend/.env.production` locally with the value from §2 for your layout.
      Vite inlines env vars **at build time** — editing this on the server changes
      nothing, ever.
- [ ] Confirm `VITE_ENABLE_MOCKS` is not `true` for the production build. With mocks
      on, the SPA answers its own API calls from browser fixtures and looks completely
      healthy while the backend is unreachable.
- [ ] Build locally:

      ```powershell
      cd frontend
      npx tsc -b --force ; npx vite build
      ```

      `--force` is not optional: the incremental build has hidden an undefined
      identifier in this repo before, while reporting clean.
- [ ] Confirm `dist/.htaccess` exists. It ships from `frontend/public/.htaccess`, and
      its first rule excludes `/api/` from the SPA fallback. Without that exclusion
      Apache rewrites `/api/v1/health` to `index.html`, the browser gets HTML where it
      expected JSON, and the SPA fails with `Unexpected token '<'` — a message that
      points nowhere near this file.
- [ ] Upload the **contents** of `dist/` into the `sims.bajc.edu.bz` document root
      (not the `dist` folder itself). Zip → upload → Extract.
- [ ] Verify the dotfile arrived: File Manager with hidden files shown, or
      `ls -la <sims docroot>/.htaccess`. Extract tools drop dotfiles routinely.

### End-to-end

- [ ] `https://sims.bajc.edu.bz/` loads the login page.
- [ ] Log in, then **hard-reload** (Ctrl+Shift+R). Staying logged in is what proves the
      `Secure` refresh cookie works; being logged out means TLS or the
      `VITE_API_BASE_URL` layout is wrong, not your credentials.
- [ ] Navigate to a deep route, then hard-reload it. A 404 here means the SPA fallback
      in `.htaccess` is not active.
- [ ] DevTools → Network: API calls return JSON, and their `content-type` is
      `application/json`. `text/html` with status 200 is the `.htaccess` exclusion
      failing.

---

## 9. When a step fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `{"error":{"code":"not_found",...}}` on `/api/v1/health` | Sub-path mount, prefix subtracted twice (§0) | Confirm `passenger_wsgi.py` on the server has `_unmount`; delete `__pycache__`; restart |
| Apache HTML 404 | Passenger never ran: no `.htaccess` at the URL's document root, or it points at a dead app root | Destroy and recreate the app (§1, §4). Check `public_html/api/.htaccess` exists |
| Apache HTML 403, or a directory listing | Application URL path and document root disagree | Recreate the app with the path box exactly `api` |
| 500 on every request; `stderr.log` shows `RuntimeError` from `validate_runtime` | `.env` still has dev values, or is not being read | §6. Check `ENVIRONMENT=production`, a real `JWT_SECRET`, a non-default `DATABASE_URL` |
| 500; `TypeError: ... takes 2 positional arguments` | Entry point resolves to the raw ASGI app, not the WSGI bridge | Entry point must be `application`, startup file `passenger_wsgi.py` |
| 500; `ModuleNotFoundError: No module named 'a2wsgi'` | Installed into the wrong interpreter | Re-run §5 after `source`-ing the venv path the panel prints |
| 500; `ModuleNotFoundError: No module named 'app'` | Application root is not the folder holding `app/` | Set it to `repositories/school-management-system/backend` |
| `/health` 200 but `/ready` 503 | App up, MariaDB unreachable | `DATABASE_URL`, password URL-encoding, cPanel DB user grants |
| Your change has no effect | Passenger cached the old app, or a stale `.pyc` | `touch .../backend/tmp/restart.txt`, and delete `__pycache__` |
| SPA loads, API calls return HTML | `/api/` not excluded from the SPA rewrite | §8; confirm the SPA docroot `.htaccess` is the shipped one |
| Logged out on every hard reload | Serving over http, or an absolute `VITE_API_BASE_URL` on a cross-site origin | Enable AutoSSL; Layout A keeps the base URL relative |
| Everything works and no data is ever wrong | You may be running with mocks on | `VITE_ENABLE_MOCKS=false`, rebuild |

Read `~/repositories/school-management-system/backend/stderr.log` for every 5xx — it carries the actual exception.
Passenger's own errors land in cPanel → Errors, or `~/logs/`.

---

## 10. Known limits of this target

Passenger speaks WSGI, so this deployment has **no streaming, no server-sent events,
no websockets, and no ASGI lifespan events**. Nothing in this backend uses any of them
today — but that is a property of the current code, not a guarantee. Anything added
later that needs them will not work here, and will fail at request time rather than at
deploy time.

Throughput is lower than `uvicorn app.main:app`: every async endpoint runs through a
bridged event loop per request instead of uvicorn's. For a junior college's user count
this is fine. If it stops being fine, the move is a VPS and `RUNBOOK.md` §10, not a
tuning pass here.

Still outstanding regardless of host, from `RUNBOOK.md` §10.7: **no backups are
configured and no restore has ever been tested**, and the app connects to MariaDB as
the table owner rather than a least-privilege user.

#!/bin/bash
# =============================================================================
#  SIS on cPanel — read-only diagnostic.
#
#  Paste into cPanel -> Terminal (or SSH) and run:
#
#      bash ~/repositories/school-management-system/deploy/cpanel-diagnose.sh
#
#  ...or, if you have not pulled this file onto the server yet, paste the whole
#  script into the terminal directly.
#
#  It CHANGES NOTHING. It reads config, prints the few facts that decide where a
#  404 comes from, and probes the app from inside the server. Send the whole
#  output back.
#
#  Edit these two lines if your names differ:
API_HOST="api.sims.bajc.edu.bz"
SPA_HOST="sims.bajc.edu.bz"
# =============================================================================

echo "############ SIS cPanel diagnostic — $(date) ############"
echo "home = $HOME"
echo

# ── 1. Where do Apache's virtual hosts actually point? ───────────────────────
# THE decisive fact. cPanel, when you add `api.sims` while `sims` already
# exists, will happily offer a document root NESTED INSIDE the `sims` one. If it
# did, the SPA's .htaccess one level up rewrites every /api/v1/* request to
# index.html — a file that does not exist in the API docroot — and Apache
# answers 404 without Passenger ever being consulted. That is the single most
# likely explanation for "the SPA works, the API 404s".
echo "===== 1. DOCUMENT ROOTS (from Apache's own config) ====="
if [ -f /etc/apache2/conf/httpd.conf ]; then
  grep -E "ServerName|ServerAlias|DocumentRoot" /etc/apache2/conf/httpd.conf 2>/dev/null \
    | grep -A2 -B2 -E "sims\.bajc" | sed 's/^[ \t]*//'
else
  echo "(cannot read Apache config — normal on some hosts; use the next block instead)"
fi
echo
echo "----- as cPanel records them -----"
cat "$HOME/.cpanel/userdata/"* 2>/dev/null | grep -E "documentroot|servername" | sort -u
echo
echo "NOTE: if the API document root is a SUBDIRECTORY of the SPA document root,"
echo "      that is your bug. Fix = move the subdomain's docroot somewhere that"
echo "      is NOT under the SPA's, or add the /api exclusion to the SPA's"
echo "      .htaccess (deploy/htaccess-spa.conf / frontend/public/.htaccess)."
echo

# ── 2. The .htaccess files, and whether Passenger is wired at all ────────────
echo "===== 2. .htaccess FILES ====="
for d in "$HOME/public_html" "$HOME/$SPA_HOST" "$HOME/$API_HOST" \
         "$HOME/public_html/$SPA_HOST" "$HOME/public_html/$API_HOST" \
         "$HOME/$SPA_HOST/$API_HOST" "$HOME/$SPA_HOST/api" "$HOME/public_html/api"; do
  if [ -d "$d" ]; then
    echo "--- DIR EXISTS: $d"
    ls -la "$d" | head -8
    if [ -f "$d/.htaccess" ]; then
      echo "    .htaccess contents:"
      sed 's/^/      /' "$d/.htaccess"
    else
      echo "    (no .htaccess here)"
    fi
    echo
  fi
done
echo "A working Python app's docroot .htaccess contains PassengerAppRoot /"
echo "PassengerBaseURI / PassengerPython lines. If the API docroot has NO"
echo ".htaccess, Passenger is never invoked -> plain Apache 404."
echo

# ── 3. The application root ──────────────────────────────────────────────────
# Note the spelling. The repo is `school-management-system`. An app root typed
# as `school-management-school` is a DIFFERENT, EMPTY folder that cPanel creates
# for you without complaint, and then serves its own stub from.
echo "===== 3. APPLICATION ROOT CANDIDATES ====="
ls -la "$HOME/repositories/" 2>/dev/null || echo "(no ~/repositories)"
echo
for r in "$HOME/repositories/school-management-system/backend" \
         "$HOME/repositories/school-management-school/backend"; do
  echo "--- $r"
  if [ -d "$r" ]; then
    ls -la "$r" | head -14
    echo
    if [ -f "$r/passenger_wsgi.py" ]; then
      echo "    passenger_wsgi.py: $(wc -c < "$r/passenger_wsgi.py") bytes"
      if grep -q "_unmount" "$r/passenger_wsgi.py"; then
        echo "    -> OK: this is the project's file (has _unmount)"
      elif grep -q "It works" "$r/passenger_wsgi.py"; then
        echo "    -> *** THIS IS cPANEL'S STUB, NOT THE APP. *** It answers 200"
        echo "       'It works!' on every path. Re-deploy the real file."
      else
        echo "    -> OLD project file (no _unmount). Pull the latest commit."
      fi
    else
      echo "    *** NO passenger_wsgi.py HERE ***"
    fi
    echo "    .env present? $([ -f "$r/.env" ] && echo YES || echo '*** NO — app will 500 ***')"
    echo "    app/main.py present? $([ -f "$r/app/main.py" ] && echo YES || echo '*** NO — wrong folder ***')"
    echo "    __pycache__ dirs: $(find "$r" -name __pycache__ -type d 2>/dev/null | wc -l) (delete them)"
  else
    echo "    (does not exist)"
  fi
  echo
done

# ── 4. The virtualenv ────────────────────────────────────────────────────────
echo "===== 4. VIRTUALENV ====="
ls -d "$HOME"/virtualenv/*/*/ 2>/dev/null || echo "(no ~/virtualenv — the app was never created, or was destroyed)"
for v in "$HOME"/virtualenv/*/*/*/bin/python; do
  [ -x "$v" ] || continue
  echo "--- $v"
  echo "    version: $("$v" --version 2>&1)   (must be 3.11+)"
  "$v" -c "import a2wsgi; print('    a2wsgi: OK')" 2>/dev/null || echo "    a2wsgi: *** MISSING — pip install a2wsgi ***"
  "$v" -c "import fastapi; print('    fastapi: OK')" 2>/dev/null || echo "    fastapi: *** MISSING — pip install -r requirements.txt ***"
  "$v" -c "import pymysql; print('    pymysql: OK')" 2>/dev/null || echo "    pymysql: *** MISSING ***"
done
echo

# ── 5. Probe the app from inside the server ──────────────────────────────────
# Bypasses DNS and any CDN in front. The BODY is what identifies the 404:
#   {"error":{"code":"not_found"...}}  -> FastAPI answered. Routing/prefix issue.
#   <title>404 Not Found</title>      -> Apache answered. Passenger never ran.
#   It works!                         -> cPanel's stub is deployed, not the app.
echo "===== 5. LIVE PROBES (body is the diagnosis — read it, not the status) ====="
for u in "https://$API_HOST/api/v1/health" \
         "https://$API_HOST/" \
         "http://$API_HOST/api/v1/health" \
         "https://$SPA_HOST/api/v1/health"; do
  echo "--- $u"
  curl -sS -m 20 -o /tmp/sis_body.$$ -w "    http=%{http_code}  type=%{content_type}  ssl=%{ssl_verify_result}\n" "$u" 2>&1 \
    || echo "    (request failed — see message above)"
  echo "    body: $(head -c 240 /tmp/sis_body.$$ 2>/dev/null | tr '\n' ' ')"
  rm -f /tmp/sis_body.$$
  echo
done
echo "ssl=0 means the certificate verified. Anything else on the https probes"
echo "means AutoSSL has NOT issued a certificate covering $API_HOST."
echo "That matters: it is a FOUR-label name, and a wildcard cert for"
echo "*.bajc.edu.bz does NOT cover api.sims.bajc.edu.bz. Without a valid cert"
echo "the Secure refresh cookie is dropped and every user is logged out on"
echo "each reload, even once the 404 is fixed."
echo

# ── 6. Logs ──────────────────────────────────────────────────────────────────
echo "===== 6. LOGS (last 40 lines each) ====="
for f in "$HOME/repositories/school-management-system/backend/stderr.log" \
         "$HOME/repositories/school-management-school/backend/stderr.log" \
         "$HOME/logs/$API_HOST.error.log" "$HOME/logs/${API_HOST}-error.log"; do
  if [ -f "$f" ]; then
    echo "--- $f"
    tail -40 "$f" | sed 's/^/    /'
    echo
  fi
done
ls -la "$HOME/logs/" 2>/dev/null | head -20
echo
echo "############ end of diagnostic ############"

"""Drive the REAL API against a freshly seeded demo database — D31 Phase 5.

    cd backend
    $env:DATABASE_URL="mysql+pymysql://user:pw@127.0.0.1:3306/sims_d31"
    $env:ENVIRONMENT="local"
    .venv\\Scripts\\python.exe scratchpad\\drive_demo_api.py

WHY IT EXISTS. `verify_seed.py` proves the rows are internally consistent; it cannot prove the
application can READ them. This boots the app with `create_app()`, signs in with a seeded
credential, and walks the screens the demo exists for as all three roles. That distinction is not
academic — it is what found the D31 timetable defect: every row was valid, every invariant held,
and a student's week still rendered the same Monday class twice, because the service scoped to the
academic YEAR and D31 had just made one course in two terms of a year expressible for the first
time. Nothing short of asking the API for the week could see it.

⚠️ IT IS NOT READ-ONLY. It CHANGES the password of the three accounts it signs in as (that is the
only way past the forced-change gate) and it writes `refresh_sessions` / `login_attempts` rows.
Run it on a demo database, and re-run `seed_demo` afterwards to get back to a pristine seed —
`verify_seed.py` will report the difference if you forget.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

CREDS = BACKEND / "db" / "mariadb" / "generated" / "demo-credentials.txt"
API = "/api/v1"
#: What every account this script touches ends up with.
NEW_PW = "PhaseFive!Verify2026"

fails: list[str] = []


def seeded() -> dict[str, tuple[str, str]]:
    """role -> (email, password), first account of each role in the credentials file."""
    if not CREDS.exists():
        raise SystemExit(
            f"{CREDS} not found — run the demo seed first:\n"
            "    python -m db.mariadb.seed_demo"
        )
    out: dict[str, tuple[str, str]] = {}
    for line in CREDS.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) == 3 and "@" in parts[1]:
            out.setdefault(parts[0], (parts[1], parts[2]))
    return out


app = create_app()
client = TestClient(app)
CREDENTIALS = seeded()


def h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def show(label: str, resp, want: int = 200, probe=None):
    """Print one step's status, and its own summary of the body when it has one."""
    ok = resp.status_code == want
    detail = ""
    body = None
    if resp.content and "json" in resp.headers.get("content-type", ""):
        body = resp.json()
    if ok and body is not None and probe:
        try:
            detail = probe(body)
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"probe raised {exc!r}"
    elif not ok:
        detail = resp.text[:160].replace("\n", " ")
    print(f"  {'OK  ' if ok else 'FAIL'} {label:<52} {resp.status_code}  {detail}")
    if not ok:
        fails.append(label)
    return body


def sign_in(role: str) -> str:
    """Log in as the first seeded account of `role` and clear its forced-change flag.

    Tries the generated password first and `NEW_PW` second, so the script is re-runnable
    against a database it has already walked.
    """
    email, seeded_pw = CREDENTIALS[role]
    for pw in (seeded_pw, NEW_PW):
        r = client.post(f"{API}/auth/login", json={"identifier": email, "password": pw})
        if r.status_code != 200:
            continue
        token = r.json()["access_token"]
        if r.json()["user"]["must_change_password"]:
            client.patch(
                f"{API}/auth/me/password", headers=h(token),
                json={"new_password": NEW_PW},
            )
            # The change revokes every OTHER session; re-login for a clean token.
            r = client.post(
                f"{API}/auth/login", json={"identifier": email, "password": NEW_PW}
            )
            token = r.json()["access_token"]
        return token
    raise SystemExit(f"cannot log in as the seeded {role} ({email})")


def n(body, *keys) -> int:
    """Row count from whichever of `keys` the response actually used."""
    if isinstance(body, list):
        return len(body)
    for k in keys:
        if isinstance(body, dict) and isinstance(body.get(k), list):
            return len(body[k])
    return 0


# ── 1. The forced-change gate, on real seeded accounts ─────────────────────────────
print("== the forced password change (seeded must_change_password=true) ==")
p_email, p_pw = CREDENTIALS["principal"]
r = client.post(f"{API}/auth/login", json={"identifier": p_email, "password": p_pw})
if r.status_code == 401:
    # Already walked once: this script changed the password last time. Fall back so the
    # rest of the walk still runs, and say so rather than reporting a failed login.
    r = client.post(f"{API}/auth/login", json={"identifier": p_email, "password": NEW_PW})
login = show(
    "login as the seeded principal", r,
    probe=lambda b: f"{b['user']['full_name']!r} must_change={b['user']['must_change_password']}",
)
if login and login["user"]["must_change_password"]:
    flagged = login["access_token"]
    show("GET /auth/me is EXEMPT while flagged",
         client.get(f"{API}/auth/me", headers=h(flagged)),
         probe=lambda b: f"role={b['role']} must_change={b['must_change_password']}")
    blocked = client.get(f"{API}/settings/users", headers=h(flagged))
    show("a read is REFUSED while flagged", blocked, want=403,
         probe=lambda b: f"code={b['error']['code']!r}")
    if blocked.status_code == 403:
        if blocked.json()["error"]["code"] != "password_change_required":
            fails.append("the 403 carries the wrong error code")
    show("a write is refused too (not a read-only gate)",
         client.post(f"{API}/announcements", headers=h(flagged),
                     json={"title": "Nope", "body": "Never lands", "audience": "all"}),
         want=403)
else:
    print("  ..   already walked: the principal's flag is cleared, gate steps skipped")

# ── 2. The Principal's screens ─────────────────────────────────────────────────────
print("\n== principal walkthrough ==")
P = sign_in("principal")
show("GET /dashboard", client.get(f"{API}/dashboard", headers=h(P)),
     probe=lambda b: ", ".join(f"{k}={v}" for k, v in list(b.items())[:4]
                               if not isinstance(v, (list, dict))))
show("GET /settings/active-term", client.get(f"{API}/settings/active-term", headers=h(P)),
     probe=lambda b: str(b)[:90])

offerings = show(
    "GET /offerings", client.get(f"{API}/offerings", headers=h(P), params={"page_size": 60}),
    probe=lambda b: f"{len(b['items'])} of {b.get('total')}",
)
if offerings:
    math = [o for o in offerings["items"] if o["course"]["code"] == "MATH1110"]
    sections = sorted({o["label"] for o in math if o["semester"]["is_active"]})
    terms = {o["semester"]["name"] for o in math}
    print(f"       MATH1110 sections this term: {sections}")
    print(f"       MATH1110 runs in terms:      {sorted(terms)}")
    if len(sections) < 3:
        fails.append("D31 parallel sections are not visible on /offerings")
    if len(terms) < 2:
        fails.append("D31 same-course-two-terms is not visible on /offerings")

    off = offerings["items"][0]
    oid = off["id"]
    show(f"GET /offerings/{{id}} ({off['label']})",
         client.get(f"{API}/offerings/{oid}", headers=h(P)),
         probe=lambda b: f"{b['course']['code']} §{b.get('section_code')} "
                         f"{b['semester']['name']} enrolled={b.get('enrolled_count')}")
    show("GET /offerings/{id}/roster",
         client.get(f"{API}/offerings/{oid}/roster", headers=h(P)),
         probe=lambda b: f"{n(b, 'items', 'students')} enrolled")
    show("GET /offerings/{id}/meetings",
         client.get(f"{API}/offerings/{oid}/meetings", headers=h(P)),
         probe=lambda b: f"{n(b, 'items', 'meetings')} weekly slots")
    # `rows` x `assessments`, and BOTH matter: they are filtered by the same resolved
    # term, so the D31 gradebook defect emptied them together — an offering outside the
    # active term rendered 0 x 0 with no error. A zero on either is a red flag here.
    gb = show("GET /grades/offering/{id} (the gradebook)",
              client.get(f"{API}/grades/offering/{oid}", headers=h(P)),
              probe=lambda b: f"{n(b, 'rows')} rows x {n(b, 'assessments')} assessments "
                              f"in {b['semester']['name']}")
    if gb is not None and (not n(gb, "rows") or not n(gb, "assessments")):
        fails.append(
            f"the gradebook for {off['label']} ({off['semester']['name']}) is empty"
        )

students = show("GET /students",
                client.get(f"{API}/students", headers=h(P), params={"page_size": 5}),
                probe=lambda b: f"{len(b['items'])} of {b.get('total')}")
if students and students["items"]:
    sid = students["items"][0]["id"]
    show("GET /students/{id} (programme + year + load)",
         client.get(f"{API}/students/{sid}", headers=h(P)),
         probe=lambda b: f"prog={(b.get('program') or {}).get('code')} "
                         f"year={b.get('year_of_study')} load={b.get('enrollment_load')}")
    show("GET /students/{id}/academic-history",
         client.get(f"{API}/students/{sid}/academic-history", headers=h(P)),
         probe=lambda b: f"{n(b, 'items', 'terms')} entries")
    show("GET /timetable/students/{id}",
         client.get(f"{API}/timetable/students/{sid}", headers=h(P)),
         probe=lambda b: f"{sum(len(d['entries']) for d in b['days'])} slots")
    show("GET /reports/transcript",
         client.get(f"{API}/reports/transcript", headers=h(P), params={"student_id": sid}),
         probe=lambda b: f"gpa={b.get('cumulative_gpa')} credits={b.get('credits_earned')}")

for label, path, kw, probe in [
    ("GET /teachers", "/teachers", {}, lambda b: f"{len(b['items'])} of {b.get('total')}"),
    ("GET /programs", "/programs", {}, lambda b: f"{len(b['items'])} programmes"),
    ("GET /courses", "/courses", {"page_size": 5},
     lambda b: f"{len(b['items'])} of {b.get('total')}"),
    ("GET /announcements", "/announcements", {}, lambda b: f"{len(b['items'])} announcements"),
    ("GET /events", "/events", {}, lambda b: f"{n(b, 'items')} events"),
    ("GET /settings/grading-scale", "/settings/grading-scale", {},
     lambda b: f"pass_mark={b.get('pass_mark')} bands={n(b, 'bands')}"),
]:
    show(label, client.get(f"{API}{path}", headers=h(P), params=kw or None), probe=probe)

# ── 3. A Lecturer ─────────────────────────────────────────────────────────────────
print("\n== lecturer walkthrough ==")
T = sign_in("teacher")
show("GET /grades/offerings (their own)", client.get(f"{API}/grades/offerings", headers=h(T)),
     probe=lambda b: f"{n(b, 'items', 'offerings')} offerings")
show("GET /timetable/me", client.get(f"{API}/timetable/me", headers=h(T)),
     probe=lambda b: f"{sum(len(d['entries']) for d in b['days'])} slots")
show("GET /attendance/offerings", client.get(f"{API}/attendance/offerings", headers=h(T)),
     probe=lambda b: f"{n(b, 'items', 'offerings')} offerings")

# ── 4. A Student — the parallel-section scenario ──────────────────────────────────
print("\n== student walkthrough (the D31 scenario) ==")
S = sign_in("student")
show("GET /students/me", client.get(f"{API}/students/me", headers=h(S)),
     probe=lambda b: f"{b.get('full_name')!r} prog={(b.get('program') or {}).get('code')} "
                     f"year={b.get('year_of_study')}")
week = show("GET /timetable/me (their own week)",
            client.get(f"{API}/timetable/me", headers=h(S)),
            probe=lambda b: f"{sum(len(d['entries']) for d in b['days'])} slots")
if week:
    slots = [
        (d["day_name"][:3], e["start_time"][:5], e["offering"]["label"], e.get("room"))
        for d in week["days"] for e in d["entries"]
    ]
    for s in slots:
        print("        ", " ".join(str(x) for x in s))
    # The defect this script found: a year-scoped week rendered the same course twice,
    # once per term. Two identical (day, time, label) rows means it is back.
    if len(slots) != len(set(slots)):
        fails.append("the week contains DUPLICATE slots — term scoping has regressed")
show("GET /grades/me", client.get(f"{API}/grades/me", headers=h(S)),
     probe=lambda b: f"{n(b, 'by_subject', 'items')} courses")
show("GET /attendance/me", client.get(f"{API}/attendance/me", headers=h(S)),
     probe=lambda b: f"{n(b, 'history', 'items')} records, "
                     f"{(b.get('summary') or {}).get('pct_present')}% present")
show("GET /reports/report-card/me", client.get(f"{API}/reports/report-card/me", headers=h(S)),
     probe=lambda b: f"{n(b, 'subjects', 'rows', 'items')} rows")
show("GET /students/me/years", client.get(f"{API}/students/me/years", headers=h(S)),
     probe=lambda b: f"{n(b, 'items')} years")

print()
if fails:
    print(f"{len(fails)} STEP(S) FAILED:")
    for f in fails:
        print("   -", f)
    sys.exit(1)
print("ALL API STEPS PASSED")
print(f"\nNOTE: the three accounts walked above now have the password {NEW_PW!r}.")
print("Re-run `python -m db.mariadb.seed_demo` to return to a pristine seed.")

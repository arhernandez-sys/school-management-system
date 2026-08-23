"""Verify every account in demo-credentials.txt can actually LOG IN, and that the
file and the database describe the same set of accounts."""
import pathlib, re, sys, logging
logging.disable(logging.CRITICAL)
BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path: sys.path.insert(0, str(BACKEND))
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from app.main import create_app

API = "/api/v1"
creds = (BACKEND / "db/mariadb/generated/demo-credentials.txt").read_text(encoding="utf-8")
pairs = re.findall(r"([\w.\-+]+@[\w.\-]+)\s+(\S+)", creds)
import os
url = os.environ["DATABASE_URL"]  # export it; never write the DSN to a file in this tracked dir
eng = create_engine(url, future=True)

with eng.connect() as cx:
    db = cx.execute(text("SELECT DATABASE()")).scalar()
    db_emails = {r[0] for r in cx.execute(text("SELECT email FROM users"))}
    forced = cx.execute(text("SELECT COUNT(*) FROM users WHERE must_change_password=1")).scalar()
    hashes = cx.execute(text("SELECT COUNT(DISTINCT password_hash) FROM users")).scalar()

file_emails = {e for e, _ in pairs}
print(f"database: {db}")
print(f"accounts in file: {len(pairs)}   accounts in DB: {len(db_emails)}")
print(f"  in file but NOT in DB: {sorted(file_emails - db_emails) or 'none'}")
print(f"  in DB but NOT in file: {sorted(db_emails - file_emails) or 'none'}")
print(f"  must_change_password=1: {forced}/{len(db_emails)}   distinct hashes: {hashes}")

app = create_app()
ok, fail = [], []
with TestClient(app) as c:
    for email, pw in pairs:
        r = c.post(f"{API}/auth/login", json={"identifier": email, "password": pw})
        if r.status_code == 200:
            body = r.json()
            ok.append((email, body.get("user", {}).get("role"), body.get("user", {}).get("must_change_password")))
        else:
            fail.append((email, r.status_code, r.text[:90]))

print(f"\nLOGIN RESULTS: {len(ok)} succeeded, {len(fail)} failed")
for e, role, mcp in ok:
    print(f"  OK   {e:44s} role={role:10s} must_change_password={mcp}")
for e, code, body in fail:
    print(f"  FAIL {e:44s} {code} {body}")

bad = bool(fail) or file_emails != db_emails
print("\n" + ("VERIFICATION FAILED" if bad else "ALL LOGINS OK AND FILE MATCHES DATABASE"))
sys.exit(1 if bad else 0)

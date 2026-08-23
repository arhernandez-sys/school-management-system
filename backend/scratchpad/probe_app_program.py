"""Round-trip Section E: create a draft, PATCH program_id, read it back."""
import pathlib, sys, logging
logging.disable(logging.CRITICAL)
BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path: sys.path.insert(0, str(BACKEND))
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from app.main import create_app
API = "/api/v1"
EMAIL, PW = "secretary@belmopancomp.edu.bz", "a-q&9zs!bDJ%sC%w"
eng = create_engine("mysql+pymysql://root:Argo%40web1234@127.0.0.1:3306/sims")
def flag(v):
    with eng.begin() as c:
        c.execute(text("UPDATE users SET must_change_password=:v WHERE email=:e"), {"v": v, "e": EMAIL})

flag(0)
app_id = None
try:
    with TestClient(create_app()) as c:
        h = {"Authorization": "Bearer " + c.post(f"{API}/auth/login", json={"identifier": EMAIL, "password": PW}).json()["access_token"]}
        progs = c.get(f"{API}/programs?page=1&page_size=100", headers=h).json()["items"]
        pid = progs[0]["id"]
        r = c.post(f"{API}/applications", headers=h, json={"first_name": "Probe", "last_name": "Tester"})
        print("create:", r.status_code, r.text[:200] if r.status_code >= 400 else "")
        app_id = r.json()["id"]
        r = c.patch(f"{API}/applications/{app_id}", headers=h,
                    json={"program_id": pid, "year_of_study": "First", "enrollment_load": "Full Time"})
        print("patch E:", r.status_code, r.text[:300] if r.status_code >= 400 else "")
        if r.status_code < 400:
            print("  patch response program:", r.json().get("program"))
        r = c.get(f"{API}/applications/{app_id}", headers=h)
        d = r.json()
        print("GET detail -> program:", d.get("program"), " year:", d.get("year_of_study"), " load:", d.get("enrollment_load"))
        r = c.get(f"{API}/applications?page=1&page_size=5", headers=h)
        row = next((i for i in r.json()["items"] if i["id"] == app_id), None)
        print("LIST row keys:", sorted(row.keys()) if row else None)
        print("LIST row program:", row.get("program") if row else None, "| program_name:", (row or {}).get("program_name"))
finally:
    if app_id:
        with eng.begin() as cx:
            cx.execute(text("DELETE FROM applications WHERE id = :i"), {"i": app_id})
        print("cleaned up probe application", app_id)
    flag(1)
    print("must_change_password restored")

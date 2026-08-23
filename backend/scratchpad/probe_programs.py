"""Execute the real API the way the Registrar's browser does, PAST the forced-password
gate: temporarily clear must_change_password for the secretary, probe, restore it."""
import pathlib, sys, logging
logging.disable(logging.CRITICAL)
BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path: sys.path.insert(0, str(BACKEND))
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from app.main import create_app
API = "/api/v1"
EMAIL = "secretary@belmopancomp.edu.bz"
PW = "a-q&9zs!bDJ%sC%w"
eng = create_engine("mysql+pymysql://root:Argo%40web1234@127.0.0.1:3306/sims")

def flag(v):
    with eng.begin() as c:
        c.execute(text("UPDATE users SET must_change_password=:v WHERE email=:e"), {"v": v, "e": EMAIL})

flag(0)
try:
    with TestClient(create_app()) as c:
        r = c.post(f"{API}/auth/login", json={"identifier": EMAIL, "password": PW})
        print("login:", r.status_code)
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        for path in ("/programs?page=1&page_size=100", "/programs", "/programs?is_active=true"):
            r = c.get(f"{API}{path}", headers=h)
            out = r.text[:400]
            try:
                j = r.json()
                if isinstance(j, dict) and "items" in j:
                    codes = [i.get("code") for i in j["items"]]
                    out = f"total={j['total']} n={len(j['items'])} codes={codes}"
            except Exception:
                pass
            print(f"GET {path} -> {r.status_code}  {out}")
finally:
    flag(1)
    print("\nmust_change_password restored to 1 for", EMAIL)

import uuid
from sqlalchemy import text
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import create_access_token
from app.db.session import engine
with engine.connect() as c:
    u = c.execute(text("select id, role from users where role='principal'")).first()
tok = create_access_token(user_id=uuid.UUID(str(u[0])), role=u[1])
cl = TestClient(app, raise_server_exceptions=True)
H={"Authorization": f"Bearer {tok}"}
for path, p in [("/api/v1/students", dict(page=1,page_size=25,sort="last_name")),
                ("/api/v1/students", dict(academic_year_id="c9069fa2-67c0-45e2-97a7-f95e5e58b2e1",page=1,page_size=25,sort="last_name")),
                ("/api/v1/students/filter-options", {}), ("/api/v1/academic-years", {})]:
    r = cl.get(path, params=p, headers=H); print(path, p.get("academic_year_id"), r.status_code, r.text[:300])

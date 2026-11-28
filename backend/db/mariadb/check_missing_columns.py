"""List every table/column the ORM models expect that the database does not have.

Read-only. Run from the `backend` directory (.env is found the same way apply_sql.py
finds it, or from an exported DATABASE_URL):

    Windows : .\\.venv\\Scripts\\python.exe db\\mariadb\\check_missing_columns.py
    cPanel  : python db/mariadb/check_missing_columns.py   (with the app's virtualenv active)

Exit 0 when nothing is missing, 1 otherwise.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # apply_sql
sys.path.insert(0, str(HERE.parents[1]))  # backend/, so `app` imports from anywhere

import pymysql  # noqa: E402

import app.db.models  # noqa: E402,F401  (registers every model on Base.metadata)
from app.db.base import Base  # noqa: E402
from apply_sql import connection_kwargs  # noqa: E402


def main() -> int:
    kwargs = connection_kwargs()
    conn = pymysql.connect(**kwargs)  # type: ignore[arg-type]
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = DATABASE()"
            )
            existing: dict[str, set[str]] = {}
            for table, column in cur.fetchall():
                existing.setdefault(table, set()).add(column)
    finally:
        conn.close()

    print(f"database: {kwargs['database']}")
    missing = 0
    for table in sorted(Base.metadata.tables.values(), key=lambda t: t.name):
        if table.name not in existing:
            print(f"MISSING TABLE   {table.name}")
            missing += 1
            continue
        for column in table.columns:
            if column.name not in existing[table.name]:
                print(f"MISSING COLUMN  {table.name}.{column.name}")
                missing += 1

    print("OK - nothing missing" if not missing else f"{missing} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())

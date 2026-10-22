"""Compare every ORM-mapped column against the live database - read-only.

WHY THIS EXISTS
    `verify_schema.py` fingerprints migrations; it cannot see a column that was renamed or
    never created on a database provisioned some other way (a hand import on the cPanel
    host, an older dump). That shows up as a 500 on one endpoint with
    `Unknown column 'student_profiles.lastname'` in `stderr.log` - while the same code is
    fine locally. This lists, per table, the columns the code expects and the database
    lacks, so the mismatch is named instead of guessed.

USAGE (from the `backend` directory, inside the app's virtualenv)

    python db/mariadb/check_columns.py

    Exit 0 when every mapped table and column exists, 1 otherwise. Uses DATABASE_URL from
    the environment or `.env`, exactly as the app does.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)  # Settings reads `.env` relative to the cwd

from sqlalchemy import inspect  # noqa: E402

import app.main  # noqa: E402,F401  (imports every module, registering every model)
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402


def main() -> int:
    live = inspect(engine)
    db_tables = set(live.get_table_names())
    problems = 0
    for table in sorted(Base.metadata.tables.values(), key=lambda t: t.name):
        if table.name not in db_tables:
            print(f"MISSING TABLE  {table.name}")
            problems += 1
            continue
        have = {c["name"].lower() for c in live.get_columns(table.name)}
        for col in table.columns:
            if col.name.lower() not in have:
                print(f"MISSING COLUMN {table.name}.{col.name}")
                problems += 1
    print(f"\n{problems} problem(s) across {len(Base.metadata.tables)} mapped tables.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

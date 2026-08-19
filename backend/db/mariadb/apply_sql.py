"""Apply one of the hand-written MariaDB migration files, or inspect the schema.

WHY THIS EXISTS
    Alembic does not work against this database — the single checked-in revision is
    PostgreSQL-only (native enums, pgcrypto, RLS, CREATE INDEX CONCURRENTLY), so schema
    changes live in the numbered `.sql` files next to this script and RUNBOOK §4 calls
    provisioning "manual". Manual meant HeidiSQL, by hand, with no way to run a file from
    a terminal, script or CI.

    This gives those files a command-line path. It reads `backend/.env`, so it uses
    exactly the DSN the application uses and there is no second place to keep credentials.

USAGE (from the `backend` directory — .env is loaded by a RELATIVE path)

    # what is in the database right now
    .\\.venv\\Scripts\\python.exe db\\mariadb\\apply_sql.py --check

    # snapshot every CREATE TABLE before a migration (do this first)
    .\\.venv\\Scripts\\python.exe db\\mariadb\\apply_sql.py --backup pre_005.sql

    # apply a migration, statement by statement
    .\\.venv\\Scripts\\python.exe db\\mariadb\\apply_sql.py db\\mariadb\\005_tertiary.sql

NOTES
    * Statements run one at a time and each result is printed, so a failure names the
      exact statement instead of aborting the file with no context. Execution CONTINUES
      past a failure — the migrations are written to be re-runnable, so the useful output
      is the full list of what did and did not apply. Exit code is 1 if anything failed.
    * Session variables (`SET SESSION sql_mode`, `SET FOREIGN_KEY_CHECKS`) persist across
      statements because one connection is used for the whole file. The migrations rely
      on that.
    * autocommit is on. DDL is non-transactional in MariaDB anyway, so wrapping the file
      in a transaction would buy nothing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import pymysql

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def connection_kwargs() -> dict[str, object]:
    """Parse DATABASE_URL out of backend/.env into pymysql connect() kwargs.

    The password is URL-encoded in the DSN (`.env.example` insists on it: `@` -> `%40`),
    so it has to be unquoted here — pymysql wants the raw value.
    """
    if not ENV_FILE.exists():
        raise SystemExit(f"No .env at {ENV_FILE}")

    url: str | None = None
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
    if not url:
        raise SystemExit(f"DATABASE_URL not found in {ENV_FILE}")

    parsed = urlparse(url.replace("mysql+pymysql://", "mysql://", 1))
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": (parsed.path or "/").lstrip("/"),
        "charset": "utf8mb4",
        "autocommit": True,
    }


def split_statements(sql: str) -> list[str]:
    """Split a migration file into statements on top-level semicolons.

    `--` comment lines are dropped before splitting: the migrations are heavily
    commented and that prose contains both semicolons and apostrophes, either of which
    would confuse a naive scan.

    Quote tracking covers `'`, `"` and backtick, plus backslash escapes and the
    doubled-quote form (`'it''s'`). This is enough because the files use no DELIMITER
    changes and define no stored routines — if either is ever added, this needs a real
    parser.
    """
    body = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )

    statements: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i = 0
    while i < len(body):
        ch = body[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote in "'\"" and i + 1 < len(body):
                buf.append(body[i + 1])
                i += 2
                continue
            if ch == quote:
                if i + 1 < len(body) and body[i + 1] == quote:
                    buf.append(body[i + 1])
                    i += 2
                    continue
                quote = None
        elif ch in "'\"`":
            quote = ch
            buf.append(ch)
        elif ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
        else:
            buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def base_tables(cur) -> list[str]:
    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' "
        "ORDER BY table_name"
    )
    return [row[0] for row in cur.fetchall()]


def cmd_check(cur, database: str) -> int:
    names = base_tables(cur)
    print(f"{len(names)} tables in `{database}`\n")
    for name in names:
        cur.execute(f"SELECT COUNT(*) FROM `{name}`")
        print(f"  {name:<42} {cur.fetchone()[0]:>8} rows")
    return 0


def cmd_backup(cur, database: str, out: Path) -> int:
    names = base_tables(cur)
    parts = [f"-- Structure snapshot of `{database}` — {len(names)} tables", ""]
    for name in names:
        cur.execute(f"SELECT COUNT(*) FROM `{name}`")
        rows = cur.fetchone()[0]
        cur.execute(f"SHOW CREATE TABLE `{name}`")
        parts += [f"-- {name}: {rows} rows", cur.fetchall()[0][1] + ";", ""]
    out.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {out}  ({len(names)} tables)")
    return 0


def cmd_apply(cur, script: Path) -> int:
    statements = split_statements(script.read_text(encoding="utf-8"))
    print(f"{script.name}: {len(statements)} statements\n")

    failures: list[tuple[int, str, str]] = []
    for n, stmt in enumerate(statements, 1):
        label = " ".join(stmt.split())[:104]
        try:
            cur.execute(stmt)
            print(f"  [{n:>3}] ok    {label}")
        except Exception as exc:  # noqa: BLE001 — report every failure, don't abort
            print(f"  [{n:>3}] FAIL  {label}")
            print(f"        -> {exc}")
            failures.append((n, label, str(exc)))

    print(f"\n{len(statements) - len(failures)}/{len(statements)} statements applied")
    if failures:
        print("\nFAILED:")
        for n, label, exc in failures:
            print(f"  [{n}] {label}\n      {exc}")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("script", nargs="?", type=Path, help="migration .sql file to apply")
    parser.add_argument("--check", action="store_true", help="list tables and row counts, change nothing")
    parser.add_argument("--backup", type=Path, metavar="OUT.sql", help="write SHOW CREATE TABLE for every table")
    args = parser.parse_args()

    if not (args.check or args.backup or args.script):
        parser.error("give a script to apply, or --check / --backup")

    kwargs = connection_kwargs()
    database = str(kwargs["database"])
    with pymysql.connect(**kwargs) as conn:  # type: ignore[arg-type]
        cur = conn.cursor()
        if args.check:
            return cmd_check(cur, database)
        if args.backup:
            return cmd_backup(cur, database, args.backup)
        script = args.script
        if not script.exists():
            raise SystemExit(f"No such file: {script}")
        return cmd_apply(cur, script)


if __name__ == "__main__":
    sys.exit(main())

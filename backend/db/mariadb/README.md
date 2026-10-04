# `backend/db/mariadb/`

Everything that touches the **MariaDB 12.3** database `sims` directly.

| File | What it is |
|---|---|
| `sims_final.sql` | **The current database.** A complete HeidiSQL dump — 44 tables with data, every schema change through D45. The only provisioning artefact |
| `verify_schema.py` | Probes a live database for the columns, indexes and foreign keys the ORM expects |
| `apply_sql.py` | Applies a `.sql` file statement by statement, with an optional backup first |
| `seed_demo.py` | Rebuilds demo data into `generated/` (gitignored) |

## Provisioning

```powershell
# HeidiSQL: open sims_final.sql and run it. Or:
mariadb -u root -p < sims_final.sql
```

The dump does its own `CREATE DATABASE IF NOT EXISTS sims` and `USE sims`, so it needs
nothing prepared.

## ⚠️ The numbered migrations are gone

`001_missing_fields.sql` … `020_d45_audit_trail.sql`, plus `sims.sql`, `2tables.sql` and
the four `pre_*_backup.sql` snapshots, were **deleted on 10 September 2026**. Every one
had already been applied to the database `sims_final.sql` was dumped from, so as a
provisioning path they were redundant.

They remain in git history:

```powershell
git log --oneline --all -- backend/db/mariadb/008_course_offerings.sql
git show 58c2803:backend/db/mariadb/005_tertiary.sql | more
```

Source files still name them in docstrings — *"`005_tertiary.sql` §8 moved this column"*.
That prose is the surviving record of **why** a column exists and was left in place
deliberately.

**The consequence:** `sims_final.sql` is now the only description of the schema, so
**re-dump it after any schema change**. A stale dump means a fresh environment is built
from a stale schema, and nothing will warn you.

## Two rules for working against this database

**Never run `pytest` or any write path against live `sims`.** The test suite reads
`DATABASE_URL`, and `.env` points at `sims`. Copy it first:

```powershell
mariadb-dump -u root -p --databases sims > dump.sql
# edit the two `sims` occurrences at the top to `sims_test`, then:
mariadb -u root -p < dump.sql
$env:DATABASE_URL = 'mysql+pymysql://root:<pw>@127.0.0.1:3306/sims_test'
```

`sims_test` is the one throwaway. Recreate it in place; do not create `sims_d<NN>`
databases — a stale rehearsal copy once hid a garbled duplicate index in live `sims`.

**The collation is case-INSENSITIVE** (`utf8mb4_uca1400_ai_ci`). `=`, `GROUP BY` and
`<>` cannot see a change of case, so an ENUM re-spelling looks like a no-op. Migrate
through `varchar` and verify with `HEX()`.

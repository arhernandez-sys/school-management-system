-- assessments.type — DROPPED (16 Oct 2026). The client retired assessment types; an
-- assessment is grouped by its CATEGORY only.
--
-- Nothing computed from the column: the grade maths (`grades/calc.py`) never read it. It
-- was only displayed, and filterable on GET /assessments?type=, which is gone too.
--
-- ⚠️ Deploy the code and run this TOGETHER. The new code does not map the column, so with
-- the column still present every INSERT into `assessments` fails (NOT NULL, no default);
-- the OLD code reads the column, so with it dropped every assessment read fails.
--
-- Re-runnable: DROP COLUMN IF EXISTS is a no-op the second time.
--
-- Run (from backend/):
--   .\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\drop_assessment_type.sql
-- `sims_final.sql` no longer has the column, so a fresh database does not need this.

ALTER TABLE `assessments`
  DROP COLUMN IF EXISTS `type`;

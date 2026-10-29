-- D47 — assessment marking window + reopen requests (28 Oct 2026).
-- Plan: docs/d47-assessment-marking-plan.md
--
-- 1. `assessments.reopened_until` — set when the Dean approves a reopen request; it
--    extends the 5-day marking window (backend/app/modules/assessments/marking.py).
-- 2. The publish/release lifecycle is retired. `status` and `is_released` stay as
--    columns but no code reads them; every row is set to the values that mean "live,
--    counted", which is also what new rows are created with.
--
-- ⚠️ Deploy the code and run this TOGETHER: the new code maps `reopened_until`, so
-- every assessment read fails until the column exists.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS are no-ops the
-- second time, and the UPDATE is idempotent.
--
-- Run (from backend/):
--   .\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\d47_assessment_marking.sql
-- `sims_final.sql` already has all of this, so a fresh database does not need it.

ALTER TABLE `assessments`
  ADD COLUMN IF NOT EXISTS `reopened_until` datetime DEFAULT NULL
    COMMENT 'D47: marking window extended until (Dean-approved reopen); NULL = never reopened'
    AFTER `released_at`;

UPDATE `assessments`
   SET `status` = 'graded',
       `is_released` = 1,
       `released_at` = COALESCE(`released_at`, `created_at`)
 WHERE `status` <> 'graded' OR `is_released` = 0;

ALTER TABLE `assessments`
  ALTER COLUMN `status` SET DEFAULT 'graded',
  ALTER COLUMN `is_released` SET DEFAULT 1;

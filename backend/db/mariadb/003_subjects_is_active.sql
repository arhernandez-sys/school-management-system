-- ============================================================================
-- 003_subjects_is_active.sql   (one-time MariaDB hardening)
-- Fix the Subjects module's Postgres->MariaDB mismatch.
--
-- The 001 reconciliation modelled `subjects.is_active` as a GENERATED column
-- (is_active = deleted_at IS NULL), conflating "retired" with "soft-deleted".
-- But the Subject ORM/service treat `is_active` as an INDEPENDENT retire flag
-- (retire keeps the row + FK-resolvable for transcripts; delete is separate,
-- via deleted_at) and WRITE to it — which MariaDB rejects on a generated column
-- (ERROR 1906), breaking every subject create/update/retire.
--
-- Fix: make `is_active` a real column (default 1), and move the "unique name
-- among LIVE rows" partial index onto a separate deleted_at-based STORED helper
-- (`active_name`, NULL when soft-deleted -> NULLs distinct), mirroring the
-- `classes.active_class_name` pattern. This matches the ORM's uq_subjects_name
-- (name WHERE deleted_at IS NULL) and keeps retire/delete independent.
--
-- NOTE: one-time migration (rebuilds is_active). Existing rows -> is_active=1.
-- ============================================================================
USE `sims`;

ALTER TABLE `subjects` DROP INDEX `subjectName_is_active`;
ALTER TABLE `subjects` DROP COLUMN `is_active`;
ALTER TABLE `subjects`
  ADD COLUMN `is_active` tinyint(1) NOT NULL DEFAULT 1
      COMMENT 'Retire flag (independent of soft-delete)';
ALTER TABLE `subjects`
  ADD COLUMN `active_name` varchar(70)
      GENERATED ALWAYS AS (if(`deleted_at` is null, `name`, NULL)) STORED;
ALTER TABLE `subjects`
  ADD UNIQUE INDEX `uq_subjects_name` (`active_name`);

-- D47 — assessment marking window + reopen requests (28 Oct 2026).
-- Plan: docs/d47-assessment-marking-plan.md
--
-- 1. `assessments.reopened_until` — set when the Dean approves a reopen request; it
--    extends the 5-day marking window (backend/app/modules/assessments/marking.py).
-- 2. `assessment_reopen_requests` — a Lecturer asks the Dean to reopen a closed window
--    (assessments/reopen.py). One open request per assessment (`pending_flag`).
-- 3. The publish/release lifecycle is retired. `status` and `is_released` stay as
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

CREATE TABLE IF NOT EXISTS `assessment_reopen_requests` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `assessment_id` uuid NOT NULL COMMENT 'FK -> assessments (the closed marking window)',
  `requested_by_user_id` uuid NOT NULL COMMENT 'FK -> users (the Lecturer)',
  `reason` text NOT NULL COMMENT 'Why marking was missed. Required.',
  `status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `granted_days` smallint(6) DEFAULT NULL COMMENT 'Days the Dean granted on approval',
  `decided_by_user_id` uuid DEFAULT NULL COMMENT 'FK -> users (the Dean)',
  `decided_at` datetime DEFAULT NULL,
  `decision_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `pending_flag` tinyint(1) GENERATED ALWAYS AS (if(`status` = 'pending',1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assessment_reopen_open` (`assessment_id`,`pending_flag`),
  KEY `ix_assessment_reopen_status` (`status`),
  KEY `ix_assessment_reopen_requested_by` (`requested_by_user_id`),
  KEY `fk_assessment_reopen_decided_by` (`decided_by_user_id`),
  CONSTRAINT `fk_assessment_reopen_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_assessment_reopen_requested_by` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_assessment_reopen_decided_by` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_assessment_reopen_decided` CHECK (`status` = 'pending' or `decided_at` is not null),
  CONSTRAINT `ck_assessment_reopen_days` CHECK (`granted_days` is null or `granted_days` between 1 and 14)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

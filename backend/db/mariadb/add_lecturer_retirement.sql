-- Lecturer date of birth + retirement (22 Nov 2026).
--
-- teacher_profiles:
--   date_of_birth  date        NOT NULL (see STEP 2)
--   is_retired     tinyint(1)  NULL
--   retired_date   date        NULL
--
-- school_profile (Dean settings):
--   lecturer_retirement_age   — the age a lecturer retires at (default 60)
--   retirement_warning_years  — how many years before that age the lecturer shows on
--                               the Dean dashboard as "nearing retirement" (default 3)
--
-- Run (from backend/):
--   .\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\add_lecturer_retirement.sql
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS is a no-op the second time.

-- ── STEP 1 ─────────────────────────────────────────────────────────────────────
-- date_of_birth is added NULLABLE first. Existing lecturers have no birth date on
-- record, and adding a NOT NULL date column to a populated table fills every existing
-- row with '0000-00-00' — which the Python driver cannot read as a date and which
-- would break the lecturer screens.
ALTER TABLE `teacher_profiles`
  ADD COLUMN IF NOT EXISTS `date_of_birth` date DEFAULT NULL
    COMMENT 'Lecturer date of birth. Drives the retirement warning on the Dean dashboard.'
    AFTER `last_name`,
  ADD COLUMN IF NOT EXISTS `is_retired` tinyint(1) DEFAULT NULL
    COMMENT '1 = retired. NULL/0 = not retired.'
    AFTER `end_date`,
  ADD COLUMN IF NOT EXISTS `retired_date` date DEFAULT NULL
    COMMENT 'Date the lecturer retired. Only set when is_retired = 1.'
    AFTER `is_retired`;

ALTER TABLE `school_profile`
  ADD COLUMN IF NOT EXISTS `lecturer_retirement_age` smallint(6) NOT NULL DEFAULT 60
    COMMENT 'Age at which a lecturer retires (Dean setting).',
  ADD COLUMN IF NOT EXISTS `retirement_warning_years` smallint(6) NOT NULL DEFAULT 3
    COMMENT 'Years before retirement age that a lecturer appears on the Dean dashboard.';

-- ── STEP 2 — run AFTER every existing lecturer has a date of birth ─────────────
-- Find the ones still missing:
--   SELECT staff_number, full_name FROM teacher_profiles
--    WHERE date_of_birth IS NULL AND deleted_at IS NULL;
-- Then enforce NOT NULL:
--   ALTER TABLE `teacher_profiles` MODIFY `date_of_birth` date NOT NULL
--     COMMENT 'Lecturer date of birth. Drives the retirement warning on the Dean dashboard.';

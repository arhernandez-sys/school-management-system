-- student_profiles.completion_date — the transcript's "Date of Completion" (14 Oct 2026).
--
-- Stamped by `students.service.change_student_status` when a student moves to
-- `Completed`, and editable on the student form afterwards — the same rule as
-- `graduation_date`. Nullable: everyone who is not (yet) Completed has none, and
-- students already Completed/Graduated before this column existed stay NULL until
-- the Registrar enters the date by hand.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS is a no-op the second time.
--
-- Run (from backend/):
--   .\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\add_completion_date.sql
-- `sims_final.sql` already carries the column, so a fresh database does not need this.

ALTER TABLE `student_profiles`
  ADD COLUMN IF NOT EXISTS `completion_date` date DEFAULT NULL
    COMMENT 'Set when status becomes `Completed` (14 Oct 2026). Printed as Date of Completion on the transcript. NULL for everyone else.'
    AFTER `transferred_from`;

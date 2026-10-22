-- student_profiles.grades_withheld — the Dean's per-student grade hold (21 Oct 2026).
--
-- With `assessment_policies.students_can_view_grades` ON, the Dean can still hide grades
-- from named students. It only ever hides: with the school-wide switch OFF nobody sees
-- grades whatever this column says. Enforced by
-- `core.deps.require_student_grade_visibility`; written by
-- `PUT /students/{id}/grades-withheld` (Dean only, audited).
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS is a no-op the second time.
--
-- Run (from backend/):
--   .\.venv\Scripts\python.exe db\mariadb\apply_sql.py db\mariadb\add_grades_withheld.sql
-- `sims_final.sql` already carries the column, so a fresh database does not need this.

ALTER TABLE `student_profiles`
  ADD COLUMN IF NOT EXISTS `grades_withheld` tinyint(1) NOT NULL DEFAULT 0
    COMMENT 'Dean''s per-student grade hold (21 Oct 2026). 1 = hidden from this student even while grades are published.'
    AFTER `graduation_date`;

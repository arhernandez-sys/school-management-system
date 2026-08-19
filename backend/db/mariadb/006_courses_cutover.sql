-- ============================================================================
-- 006_courses_cutover.sql
-- D30 Phase 2 — swap the course catalog from `subjects` to `courses`.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> 002 -> 003 -> 004 -> 005 -> **006**
-- Companion doc : docs/tertiary-refactor-plan.md §D2
--
-- ⚠️ DO NOT APPLY THIS FILE ON ITS OWN.
--
--   It must be applied IN THE SAME STEP as the Phase 2 code change that moves the
--   catalog onto `courses`:
--
--     * `Subject.__tablename__` -> "courses" (backend/app/modules/classes/models.py)
--     * the subjects service/schemas gain `credits` and `component`
--     * `courses.code` reconciled with the service, which currently allows a
--       code-less subject while `courses.code` is NOT NULL
--
--   Applying the DDL alone puts the database ahead of the application and every write
--   fails. That is not hypothetical: an earlier version of `005` re-pointed these two
--   FKs by itself and 73 tests failed with 1452 "a foreign key constraint fails",
--   because carrying the EXISTING rows into `courses` does nothing for rows the service
--   creates afterwards in `subjects`. `005` now keeps the FKs on `subjects` and repairs
--   a database where that earlier version already moved them.
--
-- WHAT THE SWAP IS
--
--   `005` already created `courses` and copied every `subjects` row into it PRESERVING
--   ITS UUID, so `class_subjects.subject_id` and `term_grade_snapshots.subject_id`
--   already hold values that are valid `courses.id`. Only the FK TARGET has to move —
--   there is no data migration left to do.
--
--   The COLUMNS keep the name `subject_id`. Renaming them to `course_id` would force a
--   rebuild of the STORED generated column `class_subjects.cs_active_subject` (derived
--   from `subject_id`) together with its unique index
--   `uq_class_subjects_class_subject`, and would churn the ORM and a large share of the
--   test suite — for a cosmetic gain. Decision #3 in the plan (preserve technical
--   identifiers) applies here too.
--
-- BEFORE APPLYING, confirm the copy is still complete — both must return 0:
--
--   SELECT COUNT(*) FROM subjects s LEFT JOIN courses c ON c.id = s.id WHERE c.id IS NULL;
--   SELECT COUNT(*) FROM class_subjects cs LEFT JOIN courses c ON c.id = cs.subject_id
--     WHERE c.id IS NULL;
--
-- SYNTAX NOTE: MariaDB places `IF NOT EXISTS` AFTER `FOREIGN KEY`, not after
-- `ADD CONSTRAINT` (valid there for a CHECK, a 1064 syntax error for a FOREIGN KEY).
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ----------------------------------------------------------------------------
-- Re-point the two — and only two — foreign keys that reach the catalog.
-- (`sims.sql:327`, `sims.sql:778` / `001:552`.)
-- ----------------------------------------------------------------------------
ALTER TABLE `class_subjects`
  DROP FOREIGN KEY IF EXISTS `fk_class_subjects_subject`;
ALTER TABLE `class_subjects`
  ADD CONSTRAINT `fk_class_subjects_course` FOREIGN KEY IF NOT EXISTS (`subject_id`)
    REFERENCES `courses` (`id`) ON UPDATE NO ACTION;
ALTER TABLE `class_subjects`
  MODIFY COLUMN `subject_id` uuid NOT NULL
    COMMENT 'FK -> courses (D30; column name preserved, see this file header)';

ALTER TABLE `term_grade_snapshots`
  DROP FOREIGN KEY IF EXISTS `fk_term_snapshot_subject`;
ALTER TABLE `term_grade_snapshots`
  ADD CONSTRAINT `fk_term_snapshot_course` FOREIGN KEY IF NOT EXISTS (`subject_id`)
    REFERENCES `courses` (`id`) ON DELETE NO ACTION;
ALTER TABLE `term_grade_snapshots`
  MODIFY COLUMN `subject_id` uuid NOT NULL
    COMMENT 'Frozen course identity at freeze time. FK -> courses (D30).';


-- ----------------------------------------------------------------------------
-- Retire `subjects`.
--
-- The table is KEPT, not dropped — same treatment as the dormant `students` / `staff` /
-- `grades` / `cat_assessment` tables that 001-004 deliberately left alone. Its rows are
-- the provenance of the `courses` rows that replaced them, and dropping it would make
-- the swap irreversible for no gain. Nothing references it once the two FKs above move.
-- ----------------------------------------------------------------------------
ALTER TABLE `subjects`
  COMMENT = 'RETIRED by D30 (006) - superseded by `courses`. Rows were copied there preserving their UUIDs. Kept for provenance; no FK points here.';


SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

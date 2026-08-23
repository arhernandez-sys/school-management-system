-- ============================================================================
-- 009_midterm_windows.sql
-- D32 - mid-term grading windows, student grade visibility, and two report kinds.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> ... -> 007 -> 008 -> **009**
-- Companion doc : docs/midterm-revision-reports-plan.md  (§B lists these six changes)
-- Verify with   : db/mariadb/apply_sql.py --check
--
-- THIS FILE IS SAFE. Unlike `006` and `008`, it deletes nothing, migrates no rows and
-- rewrites no data. Every column it adds is NULL-or-defaulted in a way that reproduces
-- TODAY'S BEHAVIOUR exactly:
--
--   * `semesters.midterm_submission_*` default NULL - a term with no mid-term window
--     behaves precisely as it does now (no revision gating, no mid-term report card).
--   * `assessment_policies.students_can_view_grades` defaults 0 - which is the D32-2
--     decision, so the visibility change lands with the DDL rather than needing a
--     follow-up UPDATE.
--   * `report_card_snapshots.kind` defaults 'endterm' - every row the archive freeze
--     has ever written (currently zero) is an end-term card, so the default is the
--     correct backfill and no UPDATE is required.
--
-- It CAN be applied before the code that uses it. The application simply ignores the
-- new columns until D32 Phase 1-4 land. That is a deliberate difference from `006`/`008`
-- and the reason this file needs no companion-code warning.
--
-- IDEMPOTENCY
--   Column additions use ADD COLUMN IF NOT EXISTS. The CHECK constraints use the
--   DROP IF EXISTS / ADD IF NOT EXISTS pair `005` established. The unique-index swap in
--   §3 drops and recreates unconditionally, which is re-runnable because the recreate
--   names the same index with the final column list.
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ============================================================================
-- 1. semesters - the mid-term grading window (brief §2, D32-1)
--
--    The school previously had ONE cutoff per term. That is enough to stop a lecturer
--    typing, but not enough to answer "which grading period does this assessment belong
--    to" - and that question is the whole of the revision-eligibility rules and the
--    mid-term report.
--
--    `grade_submission_deadline` is KEPT and is now the END-TERM cutoff. It is not
--    renamed: the name change would ripple through the ORM, both schema modules, the
--    generated frontend client and three test files for no behavioural gain. The COMMENT
--    below is the record of what it means now.
--
--    Both new columns are NULL together or set together - see ck_semesters_midterm_window.
--    A start with no end can never elapse (so every revision request would be held back
--    forever); an end with no start has nothing to measure "existed before" against.
-- ============================================================================
ALTER TABLE `semesters`
  ADD COLUMN IF NOT EXISTS `midterm_submission_start` datetime NULL DEFAULT NULL
    COMMENT 'D32: mid-term grading period opens. NULL = this term has no mid-term period.'
    AFTER `grade_submission_deadline`,
  ADD COLUMN IF NOT EXISTS `midterm_submission_end` datetime NULL DEFAULT NULL
    COMMENT 'D32: mid-term grading period closes. Revisions unlock and the mid-term report card can be frozen once this has passed.'
    AFTER `midterm_submission_start`;

ALTER TABLE `semesters`
  MODIFY COLUMN `grade_submission_deadline` datetime NULL DEFAULT NULL
    COMMENT 'END-TERM grade-entry cutoff (D32-1; was the only cutoff before D32). Enforced as 409 grade_window_closed in grades/service.upsert_grades.';

ALTER TABLE `semesters`
  DROP CONSTRAINT IF EXISTS `ck_semesters_midterm_window`;
ALTER TABLE `semesters`
  ADD CONSTRAINT IF NOT EXISTS `ck_semesters_midterm_window` CHECK (
    (`midterm_submission_start` IS NULL AND `midterm_submission_end` IS NULL)
    OR (`midterm_submission_start` IS NOT NULL
        AND `midterm_submission_end` IS NOT NULL
        AND `midterm_submission_end` > `midterm_submission_start`)
  );


-- ============================================================================
-- 2. assessment_policies - student grade visibility (brief §4, D32-2)
--
--    Lands on the existing Dean-only singleton (id = 1) rather than in a new settings
--    table: it is already the one row the Dean edits at /settings/assessment-policy, it
--    already carries school-wide grading policy, and a second singleton would need its
--    own endpoint, screen and singleton CHECK for one boolean.
--
--    DEFAULT 0 is the client's decision, not a conservative guess: students lose grade
--    visibility unless the Dean turns it back on. The Registrar's removal is NOT a flag -
--    it is unconditional, and lives in the role checks rather than here.
-- ============================================================================
ALTER TABLE `assessment_policies`
  ADD COLUMN IF NOT EXISTS `students_can_view_grades` tinyint(1) NOT NULL DEFAULT 0
    COMMENT 'D32: when 0, students cannot reach any grade surface (403 grades_hidden). Dean-controlled. Never exposes revision state either way.';


-- ============================================================================
-- 3. report_card_snapshots - two report kinds per term (brief §5/§6)
--
--    THE DEFECT THIS FIXES. The unique key was (student_id, semester_id), which assumes
--    one frozen card per student per term. D32 needs two: the mid-term card, frozen when
--    the mid-term window closes, and the end-term card, frozen when the year archives.
--    Under the old key the second freeze would collide with - and overwrite - the first,
--    silently destroying the mid-term record the client specifically asked to preserve.
--
--    DEFAULT 'endterm' is the correct backfill: `freeze_academic_year` is the only writer
--    that has ever existed, and everything it wrote is an end-term card. (The live table
--    holds 0 rows today, so this is belt and braces.)
--
--    The index is dropped and recreated rather than guarded, because MariaDB has no
--    "alter index" and the recreate names the final column list - so a replay converges
--    on the same shape.
-- ============================================================================
ALTER TABLE `report_card_snapshots`
  ADD COLUMN IF NOT EXISTS `kind` enum('midterm','endterm') NOT NULL DEFAULT 'endterm'
    COMMENT 'D32: which report this payload is. midterm = frozen at the mid-term window close; endterm = frozen at year archival.'
    AFTER `semester_id`;

ALTER TABLE `report_card_snapshots`
  DROP INDEX IF EXISTS `uq_report_card_snapshot`;
ALTER TABLE `report_card_snapshots`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_report_card_snapshot` (`student_id`, `semester_id`, `kind`);


SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

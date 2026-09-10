-- ============================================================================
-- 019_d45_status_vocabularies.sql
--
-- D45 Phase 2 — the two status vocabularies from the revised blueprint.
--
--   §7.5  `student_profiles.status`      6 values -> 11   (client decision C5)
--   §19   `class_enrollments.enrollment_status`  4 -> 8   (client decision C6)
--
-- ⚠️ RUN THIS AFTER THE PHASE 2 CODE IS MERGED. Both columns are narrowed at the
--    end, so a database ahead of the code is fine and a database BEHIND it is a
--    500 on every student and roster screen.
--
-- ⚠️ WHY EACH COLUMN GOES VIA `varchar` INSTEAD OF ONE `MODIFY ... enum(...)`.
--    Two independent reasons, and both are silent failures:
--
--    1. ALTERing an ENUM remaps by STRING VALUE. `Registered` does not appear in
--       the new list, so a direct MODIFY would not rename it — it would coerce
--       every one of those 42 rows to '' (or fail, depending on sql_mode).
--
--    2. This schema's collation is `utf8mb4_uca1400_ai_ci` — case-INSENSITIVE.
--       While the column is still an ENUM declaring `graduated`, the statement
--       `SET status = 'Graduated'` matches the existing member case-insensitively
--       and stores the OLD lowercase bytes. The update would report success and
--       change nothing. As `varchar` the assignment is byte-literal.
--
--    Hence: widen to varchar -> UPDATE with an explicit map -> narrow to the new
--    ENUM. The verification at the foot uses HEX(), because `=` cannot see the
--    difference this migration is making.
--
-- Live `sims` before this runs (surveyed 2026-09-08):
--   student_profiles.status  Registered 42 · Unregistered 1 · graduated 1
--                            · transferred 1 · withdrawn 1 · DropOut 0
--   class_enrollments        enrolled 393 · audit 0 · withdraw_passing 0
--                            · withdraw_failing 0
--   So no row lands on a value that is being removed, and nothing needs a
--   judgement call at migration time.
--
-- Rehearsed on `sims_test`, applied twice, second run a clean no-op.
-- ============================================================================


SET @OLD_SQL_MODE := @@SQL_MODE;
SET SQL_MODE = 'STRICT_ALL_TABLES';


-- ============================================================================
-- 1. §7.5 — THE STUDENT LIFECYCLE, 6 VALUES -> 11
--
-- Ten come from the blueprint. `Transferred` is an ELEVENTH, kept by client
-- decision (2026-09-08): the blueprint's ten have no equivalent, one live row
-- carries it, and folding it into `Withdrawn` would have rewritten that
-- student's history to say something untrue about why they left.
--
-- The case is normalised to TitleCase throughout. D34 preserved the client
-- dump's mixed `Registered` / `graduated` spelling because their dump was the
-- authority for the column; the blueprint is the authority now and writes all
-- ten in TitleCase, so the inconsistency no longer buys anything.
-- ----------------------------------------------------------------------------

ALTER TABLE `student_profiles`
  MODIFY COLUMN `status` varchar(20) NOT NULL
    COMMENT 'D45 §7.5 - transitional varchar; narrowed to the 11-value enum below.';

-- Byte-literal now that the column is varchar. Ordered longest-first is not
-- needed (no value is a prefix of another), but each UPDATE is keyed on the OLD
-- spelling and every old spelling is unique, so this is idempotent: a second run
-- matches nothing because the old values no longer exist.
UPDATE `student_profiles` SET `status` = 'Active'      WHERE `status` = 'Registered';
UPDATE `student_profiles` SET `status` = 'Inactive'    WHERE `status` = 'Unregistered';
UPDATE `student_profiles` SET `status` = 'Dropout'     WHERE `status` = 'DropOut';
UPDATE `student_profiles` SET `status` = 'Graduated'   WHERE `status` = 'graduated';
UPDATE `student_profiles` SET `status` = 'Withdrawn'   WHERE `status` = 'withdrawn';
UPDATE `student_profiles` SET `status` = 'Transferred' WHERE `status` = 'transferred';

-- ⚠️ STOP HERE IF THIS RETURNS ANY ROW. It lists every value that is NOT one of
-- the eleven, which is the only way the narrowing below can lose data. On live
-- `sims` it returns nothing.
--   SELECT `status`, HEX(`status`), COUNT(*) FROM `student_profiles`
--    WHERE `status` NOT IN ('Applicant','Accepted','Active','Inactive','Suspended',
--                           'Withdrawn','Dropout','Completed','Graduated','Alumni',
--                           'Transferred')
--    GROUP BY `status`;

ALTER TABLE `student_profiles`
  MODIFY COLUMN `status` enum(
    'Applicant','Accepted','Active','Inactive','Suspended',
    'Withdrawn','Dropout','Completed','Graduated','Alumni',
    'Transferred'
  ) NOT NULL DEFAULT 'Active'
  COMMENT 'D45 §7.5. Ten from the blueprint; `Transferred` is an eleventh kept by client decision 2026-09-08.';


-- ============================================================================
-- 2. §19 — THE REGISTRATION VOCABULARY, 4 VALUES -> 8
--
-- `enrolled` -> `registered` is a pure rename; 393 rows.
--
-- ⚠️ `withdraw_passing` + `withdraw_failing` COLLAPSE INTO ONE `withdrawn`, and
--    that removes a RULE, not just two labels. D35 established with BAJC
--    (2026-08-23) that a withdrawal-passing leaves the GPA alone while a
--    withdrawal-failing counts as a fail. §19 lists one flat "Withdrawn" and the
--    client reaffirmed it on 2026-09-08 after being shown this consequence.
--
--    No DATA is lost — both values have zero rows. What goes is the CAPABILITY:
--    nothing downstream can tell the two apart any more, so every withdrawal now
--    takes one treatment, and D45 makes that "leave the GPA" because the other
--    direction would invent a failing grade for a student who was passing.
--    Blueprint §29 makes this configurable in Phase 5; until then it is a
--    documented assumption. See `app/common/enums.GPA_EXCLUDED_STATUSES`.
--
-- `enroll_active_flag` is NOT touched and needs no rebuild: it is generated as
-- `if(unenrolled_at is null, 1, NULL)` and has never read this column, so
-- `uq_enroll_active` is unaffected by any of this.
-- ----------------------------------------------------------------------------

ALTER TABLE `class_enrollments`
  MODIFY COLUMN `enrollment_status` varchar(20) NOT NULL
    COMMENT 'D45 §19 - transitional varchar; narrowed to the 8-value enum below.';

UPDATE `class_enrollments` SET `enrollment_status` = 'registered'
 WHERE `enrollment_status` = 'enrolled';
UPDATE `class_enrollments` SET `enrollment_status` = 'withdrawn'
 WHERE `enrollment_status` IN ('withdraw_passing', 'withdraw_failing');

-- ⚠️ STOP HERE IF THIS RETURNS ANY ROW.
--   SELECT `enrollment_status`, HEX(`enrollment_status`), COUNT(*)
--     FROM `class_enrollments`
--    WHERE `enrollment_status` NOT IN ('pre_registered','registered','added','dropped',
--                                      'withdrawn','completed','failed','audit')
--    GROUP BY `enrollment_status`;

ALTER TABLE `class_enrollments`
  MODIFY COLUMN `enrollment_status` enum(
    'pre_registered','registered','added','dropped',
    'withdrawn','completed','failed','audit'
  ) NOT NULL DEFAULT 'registered'
  COMMENT 'D45 §19. `withdrawn` is ONE value - the D35 W-P / W-F split was removed by client decision 2026-09-08.';


SET SQL_MODE = @OLD_SQL_MODE;

-- ============================================================================
-- VERIFY — with HEX(), because `=` is case-insensitive here and cannot see the
-- re-spelling this migration performs.
-- ============================================================================
-- SELECT `status`, HEX(`status`), COUNT(*) FROM `student_profiles`
--  GROUP BY `status`, HEX(`status`) ORDER BY 1;
--   expect: Active/416374697665 42 · Graduated 1 · Inactive 1 · Transferred 1 · Withdrawn 1
--   and every HEX must start 41-5A (an uppercase first byte). A lowercase first
--   byte means the UPDATE ran while the column was still an ENUM and did nothing.
--
-- SELECT `enrollment_status`, HEX(`enrollment_status`), COUNT(*)
--   FROM `class_enrollments` GROUP BY 1, 2;
--   expect: registered / 7265676973746572656420... 393
--
-- SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles'
--    AND COLUMN_NAME = 'status';
-- ============================================================================

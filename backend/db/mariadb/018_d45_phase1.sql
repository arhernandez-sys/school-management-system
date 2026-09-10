-- ============================================================================
-- 018_d45_phase1.sql
--
-- D45 Phase 1 — the self-contained items from the client's revised blueprint
-- (`BAJC Student Information Management System_Revised.docx`, 8 Sep 2026), where
-- the highlight colour carries the instruction: YELLOW = build, blue = defer.
--
-- Three changes, all additive. Nothing here drops or narrows a column, so it is
-- safe to run twice — every statement is guarded.
--
--   §9   the two requirements columns become TEXT (they were varchar(100))
--   §23  the attendance warning threshold becomes configuration, not a constant
--   §8   Department Management lands on `programs` (client decision C4, 2026-09-08)
--
-- ⚠️ RUN THIS AFTER THE PHASE 1 CODE IS MERGED, not before. The application reads
--    `school_profile.attendance_alert_threshold` and the two new `programs`
--    columns; a database ahead of the code is harmless here, but a database
--    BEHIND the merged code is a 500 on the settings and programmes screens.
--
-- Rehearsed on `sims_test`, applied twice, second run a clean no-op.
-- ============================================================================


SET @OLD_SQL_MODE := @@SQL_MODE;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';


-- ============================================================================
-- 1. §9 — A REQUIREMENTS PARAGRAPH DOES NOT FIT IN 100 CHARACTERS
--
-- D44 created both columns as `varchar(100)` because that is what the client's
-- `sims_10` dump carried. The blueprint's §9 asks for "Admission requirements"
-- and "Graduation requirements", which on every prospectus BAJC prints are a
-- paragraph each. The column was never large enough to hold the thing it names.
--
-- Widening a varchar to TEXT is an in-place metadata change for InnoDB on this
-- table size and cannot truncate: every existing value is at most 100 bytes.
-- ----------------------------------------------------------------------------

ALTER TABLE `programs`
  MODIFY COLUMN `admission_requirements` text NULL
    COMMENT 'What an applicant needs to get in. Prose, not rules (D44; widened D45 §9).',
  MODIFY COLUMN `graduation_requirements` text NULL
    COMMENT 'What a student needs to finish. Prose, not rules (D44; widened D45 §9).';


-- ============================================================================
-- 2. §8 — DEPARTMENT MANAGEMENT, ON `programs`
--
-- The blueprint's §8 assumes a Departments table. This system does not have one
-- and that is deliberate: D43 established that BAJC organises by PROGRAMME, and
-- the HOD role is scoped through `program_heads`. Asked directly on 2026-09-08,
-- the client chose to put the two highlighted fields on `programs` rather than
-- build a `departments` table and re-parent every programme and course to it.
--
-- `head_of_department` is a DISPLAYED NAME and nothing more. `program_heads`
-- remains the authoritative link — it is a real FK to a teacher and it is what
-- the HOD role's scoping reads. This column exists because a programme can have
-- a named head on the prospectus before that person has a login to attach to.
-- Two columns, two different questions. Do not let this one start driving access.
-- ----------------------------------------------------------------------------

ALTER TABLE `programs`
  ADD COLUMN IF NOT EXISTS `head_of_department` varchar(150) NULL
    COMMENT 'D45 §8. Displayed head. The authoritative link stays `program_heads`.'
    AFTER `graduation_requirements`,
  ADD COLUMN IF NOT EXISTS `office_information` text NULL
    COMMENT 'D45 §8 - office location / hours / contact. Free text (client, 2026-09-08).'
    AFTER `head_of_department`;


-- ============================================================================
-- 3. §23 — THE ATTENDANCE THRESHOLD BECOMES CONFIGURATION
--
-- Blueprint §23: "Configurable alerts should allow the college to define
-- thresholds. Example: Attendance below 80% = Warning." It was
-- `ATTENDANCE_ALERT_THRESHOLD = 80.0`, a module constant in
-- `attendance/service.py` — precisely what §57 says not to do: "important
-- institutional rules should be configurable rather than placed directly in
-- programming code."
--
-- NOT NULL with an 80 default, unlike `post_graduation_access_days` on the same
-- table. Nullable there means "no policy = never expires", which is a real and
-- safe state. There is no equivalent here: a college with no threshold does not
-- want an alerts screen that flags nobody, it wants the number it has always
-- used. 80 is the blueprint's own example and the value the constant carried, so
-- this migration changes no behaviour on the day it runs — which is the point.
-- ----------------------------------------------------------------------------

ALTER TABLE `school_profile`
  ADD COLUMN IF NOT EXISTS `attendance_alert_threshold` decimal(5,2) NOT NULL DEFAULT 80.00
    COMMENT 'Attendance % at or below which a student or class is flagged (D45 §23).';


SET SQL_MODE = @OLD_SQL_MODE;

-- ============================================================================
-- VERIFY (expect one row each, and the third to read 80.00)
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'programs'
--    AND COLUMN_NAME IN ('admission_requirements','graduation_requirements',
--                        'head_of_department','office_information');
--
-- SELECT `attendance_alert_threshold` FROM `school_profile`;
-- ============================================================================

-- ============================================================================
-- 015_updated_at_null_on_insert.sql
-- D39 - a new row leaves `updated_at` EMPTY. It means "when was this edited",
--       and a record nobody has edited has no answer.
--
-- Target engine : MariaDB 12.3.2
-- Run order     : sims.sql -> 001 -> ... -> 013 -> 014 -> **015**
-- Companion doc : docs/d39-meeting2-feedback-plan.md
-- Verify with   : db/mariadb/verify_schema.py --expect 015
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- Every one of these 37 columns was `NOT NULL DEFAULT current_timestamp()`, so an
-- INSERT that never mentions `updated_at` still gets it stamped with the creation
-- instant. The consequence is on screen: a course created and never touched again
-- reports "Last updated 17/08/2026" - which is not an edit date, it is the creation
-- date wearing an edit date's label. All 125 live `courses` rows read that way, and
-- there is no way for a reader to tell them from a row that genuinely was edited one
-- second after it was created.
--
-- `updated_by` already behaved correctly - it has always been NULLable and no service
-- sets it on insert - so the two halves of the same fact disagreed: `updated_by` said
-- "nobody has edited this" while `updated_at` gave a date.
--
-- ── THE CHANGE ──────────────────────────────────────────────────────────────
--
-- `NULL DEFAULT NULL ON UPDATE current_timestamp()`.
--
-- The `ON UPDATE` clause is KEPT deliberately. Dropping the default is what makes an
-- INSERT leave the column empty; the `ON UPDATE` is what still stamps a real edit, and
-- it is a second line of defence behind SQLAlchemy's own `onupdate=func.now()`. A row
-- written by a hand-run SQL fix - which the chain does often - still gets stamped.
--
-- ── EXISTING ROWS ARE NOT TOUCHED (operator's decision) ─────────────────────
--
-- Widening NOT NULL -> NULL cannot reject or alter existing data, so every row keeps
-- the value it has. The alternative was blanking rows where `updated_at = created_at`,
-- which was declined and is worth recording WHY: it is an INFERENCE, not a fact. A row
-- genuinely edited within the same second as its creation is indistinguishable from one
-- never edited, and once blanked the difference is gone for good. So old rows keep
-- reading as edited-on-their-creation-date until someone actually edits them; only new
-- rows get the honest empty.
--
-- ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
--
-- `MODIFY COLUMN` states the whole target definition rather than a delta, so re-running
-- this file is a no-op. It is also safe on a database where only some of the 37 have
-- been converted.
--
-- ── ONE COLUMN IS DELIBERATELY LEFT ALONE ───────────────────────────────────
--
-- `student_number_sequences.updated_at` is NOT in this list, and must not be. That table
-- is a counter, not a record: one row per `YYYYMM` whose whole purpose is to be UPDATEd
-- to hand out the next student number. Its `updated_at` is the last time a number was
-- issued, which is real information about a row that is only ever written by being
-- updated. It keeps its NOT NULL and its default.
-- ============================================================================

USE `sims`;

ALTER TABLE `academic_years` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `announcements` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `applications` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `application_documents` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `application_education` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `assessments` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `assessment_categories` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `assessment_grades` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `assessment_policies` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `attendance_records` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `class_enrollments` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `class_meetings` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `class_teachers` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `courses` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `course_offerings` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `course_prerequisites` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `credit_transfer_requests` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `events` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `grade_revision_requests` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `grading_scales` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `grading_scale_bands` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `password_reset_tokens` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `programs` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `program_courses` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `refresh_sessions` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `report_card_snapshots` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `school_profile` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `semesters` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `student_documents` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `student_profiles` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `student_profile_temp` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `student_program_history` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `teacher_profiles` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `term_grade_snapshots` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `users` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();
ALTER TABLE `user_preferences` MODIFY COLUMN `updated_at` datetime NULL DEFAULT NULL ON UPDATE current_timestamp();

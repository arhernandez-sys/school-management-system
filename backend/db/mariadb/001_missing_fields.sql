-- ============================================================================
-- 001_missing_fields.sql
-- Reconcile the live `sims` MariaDB schema with the SIS backend ORM models and
-- the finished frontend contract.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci, case-insensitive)
-- Authored from : backend/app/db/base.py (mixins), every backend/app/modules/*/models.py,
--                 frontend/src/shared/api/mocks/demo/types.ts + handlers/events.ts,
--                 docs/database-schema.md (Postgres design intent, translated to MariaDB).
--
-- Design notes
--  * ORM mapped names are the FIXED reference; the DB is made to match them.
--  * Postgres constructs are translated to MariaDB:
--      - timestamptz            -> datetime
--      - boolean                -> tinyint(1)
--      - jsonb                  -> longtext + CHECK (json_valid(...))
--      - partial UNIQUE indexes -> STORED generated columns that are NULL when the
--                                  row is soft-deleted/inactive (NULLs are distinct in
--                                  a MariaDB UNIQUE, giving Postgres partial-index
--                                  semantics). This mirrors the pattern sims.sql
--                                  already uses (active_flag / is_active_number /
--                                  unique_code / active_username).
--  * Idempotent where MariaDB allows it:
--      - ADD COLUMN / INDEX / CONSTRAINT ... IF NOT EXISTS
--      - DROP INDEX IF EXISTS
--    Operations MariaDB has no IF-guard for (CHANGE/rename, type-narrowing MODIFY,
--    PRIMARY KEY swaps, TABLE rename) are wrapped in information_schema-guarded
--    prepared statements so the whole script re-runs cleanly in HeidiSQL.
--
-- Safe to run against the live `sims` DB (tables are ~0 rows). FK checks are
-- disabled around the additions and restored at the end.
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
-- Permissive mode so legacy '0000-00-00' defaults and type widenings don't trip
-- strict-mode errors mid-migration.
SET SESSION sql_mode = '';

USE `sims`;


-- ============================================================================
-- users  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - Replace invalid '0000-00-00 00:00:00' defaults on locked_until/last_login_at
--    with proper NULL (ORM: nullable datetime, no default).
--  - Add created_at/updated_at (TimestampMixin) + created_by/updated_by (AuditMixin).
--  - Rework email/username uniqueness to ORM partial-unique semantics
--    (unique only while deleted_at IS NULL) via a STORED generated column, matching
--    the existing active_username pattern; drop the redundant plain unique keys.
-- ============================================================================
UPDATE `users` SET `locked_until`  = NULL WHERE CAST(`locked_until`  AS CHAR) = '0000-00-00 00:00:00';
UPDATE `users` SET `last_login_at` = NULL WHERE CAST(`last_login_at` AS CHAR) = '0000-00-00 00:00:00';

ALTER TABLE `users`
  MODIFY COLUMN `locked_until`  datetime NULL DEFAULT NULL COMMENT 'Non-null = temporarily locked',
  MODIFY COLUMN `last_login_at` datetime NULL DEFAULT NULL COMMENT 'informational',
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_users_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_users_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

-- Partial-unique email (unique only while not soft-deleted), matching uq_users_email in the ORM.
ALTER TABLE `users` DROP INDEX IF EXISTS `email`;
ALTER TABLE `users` DROP INDEX IF EXISTS `uq_users_email`;
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `active_email` varchar(254)
      GENERATED ALWAYS AS (if(`deleted_at` is null, `email`, NULL)) STORED;
ALTER TABLE `users` ADD UNIQUE INDEX IF NOT EXISTS `uq_users_email` (`active_email`);

-- Drop the too-strict plain username unique; keep the partial uq_users_username (active_username).
ALTER TABLE `users` DROP INDEX IF EXISTS `username`;


-- ============================================================================
-- user_preferences  (TimestampMixin)
-- ============================================================================
ALTER TABLE `user_preferences`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();


-- ============================================================================
-- refresh_sessions  (TimestampMixin)
--  - token_hash is a 64-char SHA-256 HEX string (security.sha256_hash -> hexdigest()),
--    so varbinary(50) is too short. Widen to varchar(64).
--  - Drop the duplicate plain unique index; keep uq_refresh_sessions_token_hash.
--  - Add created_at/updated_at.
-- ============================================================================
ALTER TABLE `refresh_sessions` DROP INDEX IF EXISTS `token_hash`;
ALTER TABLE `refresh_sessions`
  MODIFY COLUMN `token_hash` varchar(64) NOT NULL COMMENT 'SHA-256 hex of the refresh token (64 chars)',
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();
ALTER TABLE `refresh_sessions` ADD UNIQUE INDEX IF NOT EXISTS `uq_refresh_sessions_token_hash` (`token_hash`);


-- ============================================================================
-- password_reset_tokens  (TimestampMixin)
--  (`created_by` already present as an app column; only timestamps are missing.)
-- ============================================================================
ALTER TABLE `password_reset_tokens`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();


-- ============================================================================
-- login_attempts  (no mixins in the ORM)  -> no changes required.
-- ============================================================================


-- ============================================================================
-- student_profiles  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - user_id: ORM is nullable with FK ON DELETE SET NULL; sims had NOT NULL and no FK.
--  - enrollment_date: ORM is NOT NULL (see README note re: backfill on populated DBs).
--  - Add created_at/updated_at + created_by/updated_by; add FK on user_id.
--  (deleted_at + is_active_number partial-unique already present.)
-- ============================================================================
ALTER TABLE `student_profiles`
  MODIFY COLUMN `user_id` uuid NULL COMMENT 'FK -> users; the login this student is (nullable)',
  MODIFY COLUMN `enrollment_date` date NOT NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_student_profiles_user`       FOREIGN KEY IF NOT EXISTS (`user_id`)    REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_student_profiles_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_student_profiles_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- student_documents  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - Add deleted_at + timestamps + audit.
--  - Add FK student_id -> student_profiles (ON DELETE RESTRICT per ORM).
--  - Add UNIQUE(storage_key) (uq_student_documents_key).
-- ============================================================================
ALTER TABLE `student_documents`
  ADD COLUMN IF NOT EXISTS `deleted_at` datetime NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_student_documents_student`    FOREIGN KEY IF NOT EXISTS (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_student_documents_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_student_documents_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_student_documents_key` (`storage_key`);


-- ============================================================================
-- teacher_profiles  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - FIX deleted_at int(1) -> datetime NULL (must rebuild the is_active generated
--    column + its unique key, which depend on deleted_at).
--  - Add created_at/updated_at + created_by/updated_by.
--  - Add partial-unique on user_id (uq_teacher_profiles_user; NULLs distinct).
--  - Add FRONTEND-ONLY extended profile fields (DemoTeacher): avatar_url, bio,
--    gender, education, designation, address, expertise[] (JSON). These are NOT in
--    the ORM model yet; they satisfy the finished teacher profile UI.
-- ============================================================================
ALTER TABLE `teacher_profiles` DROP INDEX IF EXISTS `uq_teacher_profiles_number`;
ALTER TABLE `teacher_profiles` DROP COLUMN IF EXISTS `is_active`;
ALTER TABLE `teacher_profiles`
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL;
ALTER TABLE `teacher_profiles`
  ADD COLUMN IF NOT EXISTS `is_active` int(11)
      GENERATED ALWAYS AS (if(`deleted_at` is null, 1, NULL)) VIRTUAL;
ALTER TABLE `teacher_profiles`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_teacher_profiles_number` (`staff_number`, `is_active`) USING HASH;

-- CHECK constraints have no "IF NOT EXISTS" form in MariaDB; drop-then-add keeps this re-runnable.
ALTER TABLE `teacher_profiles` DROP CONSTRAINT IF EXISTS `ck_teacher_profiles_expertise_json`;
ALTER TABLE `teacher_profiles`
  ADD COLUMN IF NOT EXISTS `created_at`   datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at`   datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by`   uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by`   uuid NULL,
  -- Frontend DemoTeacher extended profile:
  ADD COLUMN IF NOT EXISTS `avatar_url`   varchar(500) NULL,
  ADD COLUMN IF NOT EXISTS `bio`          text NULL,
  ADD COLUMN IF NOT EXISTS `gender`       enum('male','female','other') NULL,
  ADD COLUMN IF NOT EXISTS `education`    varchar(255) NULL,
  ADD COLUMN IF NOT EXISTS `designation`  varchar(150) NULL,
  ADD COLUMN IF NOT EXISTS `address`      text NULL,
  ADD COLUMN IF NOT EXISTS `expertise`    longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
      COMMENT 'JSON array of {area, level} (DemoTeacher.expertise)',
  ADD CONSTRAINT `fk_teacher_profiles_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_teacher_profiles_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `ck_teacher_profiles_expertise_json` CHECK (`expertise` is null or json_valid(`expertise`)),
  ADD UNIQUE INDEX IF NOT EXISTS `uq_teacher_profiles_user` (`user_id`);


-- ============================================================================
-- subjects  (TimestampMixin + SoftDeleteMixin)
--  - Rename legacy subjectName -> name (ORM `name`).
--  - Relax legacy NOT-NULL columns that the ORM does not populate (code, category)
--    so ORM inserts succeed; category/elective are legacy (see README).
--  - Add created_at/updated_at.
--  (deleted_at + is_active + unique_code partial-uniques already present.)
-- ============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'subjects' AND column_name = 'subjectName') > 0,
  'ALTER TABLE `subjects` CHANGE COLUMN `subjectName` `name` varchar(70) NOT NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE `subjects`
  MODIFY COLUMN `code`     varchar(70) NULL,
  MODIFY COLUMN `category` varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();


-- ============================================================================
-- classes  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - Rename legacy className -> name (ORM `name`).
--  - grade_level: ORM/frontend is a STRING ("Form 1"); change smallint -> varchar.
--  - Relax legacy classStaffID NOT-NULL (ORM never sets it) so inserts succeed.
--  - FIX unique key: sims had UNIQUE(academic_year_id) ALONE; ORM wants
--    UNIQUE(academic_year_id, name) WHERE deleted_at IS NULL -> emulate with a STORED
--    generated column (active_class_name).
--  - Add homeroom_label (FRONTEND-ONLY, DemoSection.homeroom_label; not in ORM).
--  - Add created_at/updated_at + created_by/updated_by.
-- ============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'classes' AND column_name = 'className') > 0,
  'ALTER TABLE `classes` CHANGE COLUMN `className` `name` varchar(150) NOT NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE `classes`
  MODIFY COLUMN `grade_level`  varchar(50) NOT NULL DEFAULT '0',
  MODIFY COLUMN `deleted_at`   datetime NULL DEFAULT NULL,
  MODIFY COLUMN `classStaffID` int(11) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `homeroom_label` varchar(150) NULL COMMENT 'Frontend DemoSection.homeroom_label',
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_classes_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_classes_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `classes` DROP INDEX IF EXISTS `uq_classes_year_name`;
ALTER TABLE `classes`
  ADD COLUMN IF NOT EXISTS `active_class_name` varchar(150)
      GENERATED ALWAYS AS (if(`deleted_at` is null, `name`, NULL)) STORED;
ALTER TABLE `classes`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_classes_year_name` (`academic_year_id`, `active_class_name`);


-- ============================================================================
-- class_subjects  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - Add deleted_at + timestamps + audit.
--  - Convert UNIQUE(class_id, subject_id) to partial (WHERE deleted_at IS NULL)
--    so a subject can be re-added to a section after a soft delete.
-- ============================================================================
ALTER TABLE `class_subjects`
  ADD COLUMN IF NOT EXISTS `deleted_at` datetime NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_class_subjects_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_class_subjects_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `class_subjects` DROP INDEX IF EXISTS `uq_class_subjects_class_subject`;
ALTER TABLE `class_subjects`
  ADD COLUMN IF NOT EXISTS `cs_active_subject` uuid
      GENERATED ALWAYS AS (if(`deleted_at` is null, `subject_id`, NULL)) STORED;
ALTER TABLE `class_subjects`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_class_subjects_class_subject` (`class_id`, `cs_active_subject`);


-- ============================================================================
-- class_teachers  (TimestampMixin + AuditMixin)
-- ============================================================================
ALTER TABLE `class_teachers`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_class_teachers_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_class_teachers_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- class_enrollments  (TimestampMixin + AuditMixin)
--  - Convert UNIQUE(class_id, student_id, semester_id) to partial
--    (WHERE unenrolled_at IS NULL) so a student can be re-enrolled after removal.
-- ============================================================================
ALTER TABLE `class_enrollments`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_class_enrollments_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_class_enrollments_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `class_enrollments`
  ADD COLUMN IF NOT EXISTS `enroll_active_flag` tinyint(1)
      GENERATED ALWAYS AS (if(`unenrolled_at` is null, 1, NULL)) STORED;
ALTER TABLE `class_enrollments` DROP INDEX IF EXISTS `uq_enroll_active`;
ALTER TABLE `class_enrollments`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_enroll_active` (`class_id`, `student_id`, `semester_id`, `enroll_active_flag`);


-- ============================================================================
-- academic_years  (TimestampMixin + AuditMixin)
--  - Relax legacy NOT-NULL columns yearID / YEAR (ORM never sets them) so inserts succeed.
--  (name unique + active_flag partial-unique already present.)
-- ============================================================================
ALTER TABLE `academic_years`
  MODIFY COLUMN `yearID` int(11) NULL DEFAULT NULL,
  MODIFY COLUMN `YEAR`   int(11) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_academic_years_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_academic_years_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- semesters  (TimestampMixin)
-- ============================================================================
ALTER TABLE `semesters`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();


-- ============================================================================
-- grading_scales  (TimestampMixin + AuditMixin)
-- ============================================================================
ALTER TABLE `grading_scales`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_grading_scales_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_grading_scales_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- grading_scale_bands  (TimestampMixin)
-- ============================================================================
ALTER TABLE `grading_scale_bands`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();


-- ============================================================================
-- assessment_policies  (TimestampMixin + AuditMixin)
-- ============================================================================
ALTER TABLE `assessment_policies`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_assessment_policies_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_assessment_policies_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- school_profile  (TimestampMixin + AuditMixin, single-row id=1)
--  - Add the MISSING PRIMARY KEY (id) + singleton CHECK(id = 1).
--  - Add color_primary / color_secondary (FRONTEND DemoSchoolProfile.colors; not in ORM).
--  - Add created_at/updated_at + created_by/updated_by.
-- ============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = 'school_profile'
       AND constraint_type = 'PRIMARY KEY') = 0,
  'ALTER TABLE `school_profile` ADD PRIMARY KEY (`id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE `school_profile` DROP CONSTRAINT IF EXISTS `ck_school_profile_singleton`;
ALTER TABLE `school_profile`
  ADD COLUMN IF NOT EXISTS `color_primary`   varchar(9) NULL COMMENT 'Brand primary color (hex), DemoSchoolProfile.colors.primary',
  ADD COLUMN IF NOT EXISTS `color_secondary` varchar(9) NULL COMMENT 'Brand secondary color (hex), DemoSchoolProfile.colors.secondary',
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `ck_school_profile_singleton` CHECK (`id` = 1),
  ADD CONSTRAINT `fk_school_profile_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_school_profile_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- audit_log  (append-only; bigint identity PK)
--  - ORM uses Identity(always=True); sims id is a plain bigint. Make it AUTO_INCREMENT.
-- ============================================================================
ALTER TABLE `audit_log`
  MODIFY COLUMN `id` bigint(20) NOT NULL AUTO_INCREMENT;


-- ============================================================================
-- assessment_categories  (TimestampMixin + AuditMixin)
--  - FIX TABLE NAME: sims spells it `assesment_categories` (one 's'); the ORM
--    __tablename__ is `assessment_categories`. Rename so ORM queries resolve.
--    (InnoDB rewrites the FK from assessments.category_id automatically.)
--  - Add created_at/updated_at + created_by/updated_by.
-- ============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'assesment_categories') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'assessment_categories') = 0,
  'RENAME TABLE `assesment_categories` TO `assessment_categories`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE `assessment_categories`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_assessment_categories_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_assessment_categories_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- assessments  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - type: enum('Exam','Quiz','Assignment') -> enum('quiz','test','exam','assignment')
--    (lowercase wire labels; adds 'test', drops the old capitalized set).
--  - status: enum('draft','published','archived') -> enum('draft','published','grading','graded')
--    to match AssessmentStatus in the ORM.
--  - Add deleted_at + timestamps + audit + the class_subject/semester lookup index.
-- ============================================================================
ALTER TABLE `assessments`
  MODIFY COLUMN `type`   enum('quiz','test','exam','assignment') NOT NULL,
  MODIFY COLUMN `status` enum('draft','published','grading','graded') NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS `deleted_at` datetime NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_assessments_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_assessments_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD INDEX IF NOT EXISTS `ix_assessments_class_subject_semester` (`class_subject_id`, `semester_id`);


-- ============================================================================
-- assessment_grades  (TimestampMixin + AuditMixin)
--  - Legacy extra column max_score int NOT NULL has no ORM counterpart and no
--    default -> ORM inserts would fail. Relax to NULL so inserts succeed
--    (see README: leave vs drop). chk_score_limit still holds (NULL -> passes).
--  - Add created_at/updated_at + created_by/updated_by.
-- ============================================================================
ALTER TABLE `assessment_grades`
  MODIFY COLUMN `max_score` int(11) NULL DEFAULT NULL COMMENT 'Legacy/extra; not in ORM',
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_assessment_grades_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_assessment_grades_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- attendance_records  (TimestampMixin + AuditMixin)
--  - Add ALL four missing FKs (class/student/enrollment/semester).
--  - Add UNIQUE(class_id, student_id, attendance_date) upsert key + lookup indexes.
--  - Add created_at/updated_at + created_by/updated_by.
-- ============================================================================
ALTER TABLE `attendance_records`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_attendance_class`      FOREIGN KEY IF NOT EXISTS (`class_id`)      REFERENCES `classes` (`id`)            ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_attendance_student`    FOREIGN KEY IF NOT EXISTS (`student_id`)    REFERENCES `student_profiles` (`id`)   ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_attendance_enrollment` FOREIGN KEY IF NOT EXISTS (`enrollment_id`) REFERENCES `class_enrollments` (`id`)  ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_attendance_semester`   FOREIGN KEY IF NOT EXISTS (`semester_id`)   REFERENCES `semesters` (`id`)          ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_attendance_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`)    REFERENCES `users` (`id`)              ON DELETE SET NULL,
  ADD CONSTRAINT `fk_attendance_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`)    REFERENCES `users` (`id`)              ON DELETE SET NULL,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_attendance_class_student_date` (`class_id`, `student_id`, `attendance_date`),
  ADD INDEX IF NOT EXISTS `ix_attendance_class_date`        (`class_id`, `attendance_date`),
  ADD INDEX IF NOT EXISTS `ix_attendance_student_semester`  (`student_id`, `semester_id`);


-- ============================================================================
-- announcements  (TimestampMixin + AuditMixin + SoftDeleteMixin)
--  - author_id: ORM nullable + FK ON DELETE SET NULL; sims was NOT NULL, no FK.
--  - Add FK class_id -> classes (ON DELETE CASCADE) + class/audience CHECK.
--  - Add deleted_at + timestamps + audit + list indexes.
-- ============================================================================
ALTER TABLE `announcements` DROP CONSTRAINT IF EXISTS `ck_announcements_class_audience`;
ALTER TABLE `announcements`
  MODIFY COLUMN `author_id` uuid NULL COMMENT 'FK -> users (display author); nullable per ORM',
  ADD COLUMN IF NOT EXISTS `deleted_at` datetime NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD COLUMN IF NOT EXISTS `created_by` uuid NULL,
  ADD COLUMN IF NOT EXISTS `updated_by` uuid NULL,
  ADD CONSTRAINT `fk_announcements_author`     FOREIGN KEY IF NOT EXISTS (`author_id`)  REFERENCES `users` (`id`)   ON DELETE SET NULL,
  ADD CONSTRAINT `fk_announcements_class`      FOREIGN KEY IF NOT EXISTS (`class_id`)   REFERENCES `classes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_announcements_created_by` FOREIGN KEY IF NOT EXISTS (`created_by`) REFERENCES `users` (`id`)   ON DELETE SET NULL,
  ADD CONSTRAINT `fk_announcements_updated_by` FOREIGN KEY IF NOT EXISTS (`updated_by`) REFERENCES `users` (`id`)   ON DELETE SET NULL,
  ADD CONSTRAINT `ck_announcements_class_audience` CHECK ((`audience` = 'class') = (`class_id` is not null)),
  ADD INDEX IF NOT EXISTS `ix_announcements_class`     (`class_id`),
  ADD INDEX IF NOT EXISTS `ix_announcements_audience`  (`audience`),
  ADD INDEX IF NOT EXISTS `ix_announcements_published` (`published_at`);


-- ============================================================================
-- announcement_reads  (no mixins; composite PK per-user read ledger)
--  - FIX PK: sims had PRIMARY KEY(announcement_id) only; ORM PK is
--    (announcement_id, user_id). Add both FKs (ON DELETE CASCADE) + user index.
-- ============================================================================
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND table_name = 'announcement_reads'
       AND constraint_name = 'PRIMARY') = 1,
  'ALTER TABLE `announcement_reads` DROP PRIMARY KEY, ADD PRIMARY KEY (`announcement_id`,`user_id`)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE `announcement_reads`
  ADD CONSTRAINT `fk_announcement_reads_ann`  FOREIGN KEY IF NOT EXISTS (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_announcement_reads_user` FOREIGN KEY IF NOT EXISTS (`user_id`)         REFERENCES `users` (`id`)         ON DELETE CASCADE,
  ADD INDEX IF NOT EXISTS `ix_announcement_reads_user` (`user_id`);


-- ============================================================================
-- report_card_snapshots  (TimestampMixin)
--  - Add FKs student_id -> student_profiles, semester_id -> semesters (RESTRICT).
--  - Add UNIQUE(student_id, semester_id) + timestamps.
-- ============================================================================
ALTER TABLE `report_card_snapshots`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD CONSTRAINT `fk_report_card_student`  FOREIGN KEY IF NOT EXISTS (`student_id`)  REFERENCES `student_profiles` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_report_card_semester` FOREIGN KEY IF NOT EXISTS (`semester_id`) REFERENCES `semesters` (`id`)        ON DELETE RESTRICT,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_report_card_snapshot` (`student_id`, `semester_id`);


-- ============================================================================
-- term_grade_snapshots  (TimestampMixin)
--  - Add ALL four FKs (student/class_subject/semester/subject; RESTRICT) + student index + timestamps.
-- ============================================================================
ALTER TABLE `term_grade_snapshots`
  ADD COLUMN IF NOT EXISTS `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  ADD CONSTRAINT `fk_term_snapshot_student`       FOREIGN KEY IF NOT EXISTS (`student_id`)       REFERENCES `student_profiles` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_term_snapshot_class_subject` FOREIGN KEY IF NOT EXISTS (`class_subject_id`) REFERENCES `class_subjects` (`id`)   ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_term_snapshot_semester`      FOREIGN KEY IF NOT EXISTS (`semester_id`)      REFERENCES `semesters` (`id`)        ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_term_snapshot_subject`       FOREIGN KEY IF NOT EXISTS (`subject_id`)       REFERENCES `subjects` (`id`)         ON DELETE RESTRICT,
  ADD INDEX IF NOT EXISTS `ix_term_snapshot_student` (`student_id`);


-- ============================================================================
-- events  (NEW TABLE — calendar; frontend DemoEvent + handlers/events.ts)
--  Not yet an ORM model. Two visibilities: global (everyone) / internal (staff only).
--  Only principal/secretary create-edit-delete (enforced in the app layer).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `events` (
  `id`                 uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `title`              varchar(150) NOT NULL,
  `description`        text NULL,
  `category`           enum('holiday','exam','meeting','activity','other') NOT NULL DEFAULT 'other',
  `visibility`         enum('global','internal') NOT NULL DEFAULT 'global' COMMENT 'global = everyone; internal = staff only',
  `start_date`         date NOT NULL,
  `end_date`           date NULL COMMENT 'NULL = single-day event',
  `all_day`            tinyint(1) NOT NULL DEFAULT 1,
  `start_time`         time NULL COMMENT 'HH:mm; only when all_day = 0',
  `end_time`           time NULL,
  `location`           varchar(200) NULL,
  `created_by_user_id` uuid NOT NULL COMMENT 'FK -> users (author)',
  `created_at`         datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`         datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_events_start_date` (`start_date`),
  KEY `ix_events_date_range` (`start_date`, `end_date`),
  KEY `fk_events_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_events_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_events_dates` CHECK (`end_date` is null or `end_date` >= `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- Restore session settings.
-- ============================================================================
SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

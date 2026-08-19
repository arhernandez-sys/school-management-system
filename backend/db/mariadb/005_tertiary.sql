-- ============================================================================
-- 005_tertiary.sql
-- Schema side of D30 — the tertiary / junior-college model for
-- Belize Adventist Junior College (BAJC).
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci, case-insensitive)
-- Run order     : sims.sql -> 001 -> 002 -> 003 -> 004 -> **005** (this file)
-- Companion doc : docs/tertiary-refactor-plan.md  (audits, design, phase checklists)
--
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
--   The stakeholder supplied `sims_bk.sql`, a dump of the live `sims` database
--   containing NEW tertiary work: `courses`, `programs`, `educational_background`,
--   `documents`, and a large set of tertiary columns bolted onto `student_profiles`.
--
--   That dump is NOT the schema this application runs on. It forked from the base
--   `sims.sql` BEFORE 001-004 and therefore lacks the mixin columns on ~25 tables,
--   `login_attempts.attempted_at`'s default (ERROR 1364 - every login fails),
--   `audit_log.id` AUTO_INCREMENT, the `subjects.is_active` fix (ERROR 1906), the
--   `classes.name` / `subjects.name` renames, the widened `refresh_sessions.token_hash`,
--   and `class_meetings` entirely.
--
--   Resolved with the stakeholder (2026-08-13) as a MERGE: keep 001-004, adopt the
--   tertiary additions on top. This file is that merge. See plan §B1.
--
-- ---------------------------------------------------------------------------
-- THE ONE THING THIS FILE IS REALLY FOR
--
--   Today NO STORED GRADE CAN REACH A CREDIT VALUE. The graded chain is
--   `assessment_grades -> assessments -> class_subjects -> subjects`, and `subjects`
--   has no credits. `courses` HAS credits but is referenced by nothing and references
--   nothing. That single fact is why credit-weighted GPA, quality points,
--   credits-earned and credits-remaining are all impossible.
--
--   Section 2 closes that chain. Everything else is downstream of it.
--
-- ---------------------------------------------------------------------------
-- STAKEHOLDER DECISION: `courses` BECOMES THE CATALOG (not `subjects`)
--
--   The recommendation was the reverse - `subjects` is the app's spine (gradebook,
--   term snapshots, 1037 tests) while `courses` is wired to nothing. The stakeholder
--   chose `courses`. Recorded in plan §Decisions #2.
--
--   Mitigation, and it makes the change nearly free: `subjects.id` is already `uuid`
--   and the new `courses.id` is `uuid`, so section 2 COPIES EVERY `subjects` ROW INTO
--   `courses` PRESERVING ITS UUID. Every existing `class_subjects.subject_id` and
--   `term_grade_snapshots.subject_id` value then already points at a valid
--   `courses.id`, and only the FK TARGET has to move. No data is orphaned.
--
--   REFINEMENT vs the plan's D2 step 3: the COLUMNS KEEP THE NAME `subject_id`.
--   Renaming them to `course_id` would force a rebuild of the STORED generated column
--   `class_subjects.cs_active_subject` (derived from `subject_id`) and its unique
--   index, and would churn the ORM and a large share of the test suite - for a
--   cosmetic gain. Per decision #3 (display-label-only rename, preserve technical
--   identifiers), the identifier stays and only the FK moves. The plan is updated
--   to match.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCY
--
--   Re-runnable. Uses ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
--   DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT IF NOT EXISTS throughout.
--
--   Where `IF NOT EXISTS` is NOT sufficient - because a table of the same name may
--   already exist in the WRONG shape from `sims_bk.sql` - the file uses an
--   information_schema guard + PREPARE to quarantine the legacy table under a
--   `*_legacy_pre_d30` name FIRST. Quarantine RENAMES, never drops: any rows the
--   stakeholder has are preserved for manual review.
--
-- Postgres -> MariaDB translations applied (same rules as 001):
--   * uuid PK       -> `uuid NOT NULL DEFAULT uuid_v4()` (app still supplies the id)
--   * timestamptz   -> datetime
--   * boolean       -> tinyint(1)
--   * jsonb         -> longtext + CHECK (json_valid(...))
--   * partial index -> a STORED generated column that is NULL for soft-deleted rows
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ============================================================================
-- 1. QUARANTINE THE LEGACY TERTIARY TABLES FROM sims_bk.sql
--
-- These four tables may already exist in the live DB in a shape this application
-- cannot use: int PKs against a uuid-keyed schema, `createdby varchar` audit columns
-- instead of the AuditMixin FKs, and no relationships in either direction.
--
-- Each is renamed aside, never dropped. If the table is absent (a DB provisioned
-- from the repo scripts), each guard is a no-op.
--
--   courses                -> courses_legacy_pre_d30                (int courseid)
--   programs               -> programs_legacy_pre_d30               (programid, varchar audit)
--   educational_background -> educational_background_legacy_pre_d30 (no student_id - unusable)
--   documents              -> documents_legacy_pre_d30              (doc-type lookup, uuid vs int mismatch)
--
-- `educational_background` is superseded by `application_education` (section 9),
-- which has the student/application link the original lacks. `documents` is
-- superseded by `application_documents` plus the existing `student_documents`.
-- ============================================================================

-- courses: quarantine only if it is the legacy int-keyed shape.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'courses' AND column_name = 'courseid') > 0,
  'RENAME TABLE `courses` TO `courses_legacy_pre_d30`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- programs: quarantine only if it is the legacy `programid` shape.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'programs' AND column_name = 'programid') > 0,
  'RENAME TABLE `programs` TO `programs_legacy_pre_d30`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- educational_background: quarantine if present at all (it has no student_id, so it
-- cannot store the application form's repeating institution table).
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'educational_background') > 0,
  'RENAME TABLE `educational_background` TO `educational_background_legacy_pre_d30`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- documents: quarantine if present at all.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'documents') > 0,
  'RENAME TABLE `documents` TO `documents_legacy_pre_d30`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================================
-- 2. `courses` - THE COURSE CATALOG
--
-- One row per BAJC course: ITEC1104 "Introduction to Computers", GEC, 3 credits.
-- NOT an offering - a scheduled instance of a course in a term is a `classes` row
-- (the D29 subject class) joined through `class_subjects`.
--
-- `credits` is the column that closes the grade->credit chain. It is the reason
-- this file exists.
--
-- `component` is BAJC's own classification, printed on every page of the course
-- sequence PDF: GEC (General Education Core), SEC, CEC.
--
-- `prerequisites_text` carries the PDF's raw human-readable string verbatim
-- ("EDUC1210, 2226, 2228, 2330, 2334, 2336", "ALL COURSES"). It is documentation
-- only - VALIDATION READS `course_prerequisites` (section 5), never this column.
-- The legacy `courses.prerequisites varchar(50)` was too short to even hold the
-- real values.
--
-- Partial uniques follow the `subjects` pattern: a STORED generated column that is
-- NULL for soft-deleted rows, because NULLs are distinct in a MariaDB UNIQUE.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `courses` (
  `id`                 uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `code`               varchar(70) NOT NULL COMMENT 'BAJC course code, e.g. ITEC1104, BIOL1102L. Width matches subjects.code exactly so the 2a copy cannot truncate.',
  `name`               varchar(200) NOT NULL COMMENT 'e.g. Introduction to Computers',
  `credits`            smallint(6) NOT NULL DEFAULT 3 COMMENT 'Credit value; BAJC uses 1,2,3,4,6,9',
  `component`          enum('GEC','SEC','CEC') NULL COMMENT 'BAJC component classification',
  `description`        text NULL,
  `prerequisites_text` varchar(255) NULL COMMENT 'Raw text from the course-sequence PDF. Documentation only - validation reads course_prerequisites.',
  `is_active`          tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Retire flag, distinct from soft-delete (mirrors subjects.is_active, see 003)',
  `deleted_at`         datetime NULL,
  `created_at`         datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`         datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`         uuid NULL,
  `updated_by`         uuid NULL,
  `active_code`        varchar(70) GENERATED ALWAYS AS (if(`deleted_at` is null,`code`,NULL)) STORED,
  `active_name`        varchar(200) GENERATED ALWAYS AS (if(`deleted_at` is null,`name`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_courses_code` (`active_code`),
  UNIQUE KEY `uq_courses_name` (`active_name`),
  KEY `fk_courses_created_by` (`created_by`),
  KEY `fk_courses_updated_by` (`updated_by`),
  CONSTRAINT `fk_courses_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_courses_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_courses_credits` CHECK (`credits` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ----------------------------------------------------------------------------
-- 2a. Carry every `subjects` row into `courses`, PRESERVING ITS UUID.
--
-- This is what makes the catalog swap non-destructive. After this INSERT, every
-- `class_subjects.subject_id` and `term_grade_snapshots.subject_id` already holds a
-- valid `courses.id`, so section 2b only has to move the FK target.
--
-- `credits` defaults to 3 (BAJC's overwhelmingly common value) - the Dean corrects
-- the exceptions (1-credit labs, the 6-credit field experience, the 9-credit
-- internship) when the real catalog is seeded in Phase 2.
--
-- INSERT IGNORE + NOT EXISTS makes the copy re-runnable.
-- ----------------------------------------------------------------------------
INSERT IGNORE INTO `courses` (`id`, `code`, `name`, `credits`, `is_active`, `deleted_at`, `created_at`, `updated_at`)
SELECT
  s.`id`,
  COALESCE(NULLIF(TRIM(s.`code`), ''), CONCAT('SUBJ-', LEFT(REPLACE(CAST(s.`id` AS char), '-', ''), 8))),
  s.`name`,
  3,
  s.`is_active`,
  s.`deleted_at`,
  s.`created_at`,
  s.`updated_at`
FROM `subjects` s
WHERE NOT EXISTS (SELECT 1 FROM `courses` c WHERE c.`id` = s.`id`);


-- ----------------------------------------------------------------------------
-- 2b. THE FK SWAP IS *NOT* DONE HERE - it moved to 006_courses_cutover.sql.
--
-- WHY, because this was got wrong once and the reasoning matters:
--
--   An earlier version of this file re-pointed `class_subjects.subject_id` and
--   `term_grade_snapshots.subject_id` from `subjects` to `courses`. The DDL applied
--   cleanly and the carried-over rows all resolved - and then 73 tests failed with
--   1452 "a foreign key constraint fails".
--
--   The reason is that carrying the EXISTING rows across is only half the problem.
--   Every WRITE path still creates a subject in `subjects` only, so the moment the
--   service inserted a new subject and then a `class_subjects` row pointing at it, the
--   FK had nothing to resolve against. Re-pointing the FK without moving the writes
--   puts the database ahead of the application.
--
--   So the swap is a COORDINATED schema + code change: the FK moves in the same step
--   that `Subject.__tablename__` becomes `courses` and the subjects service starts
--   writing there. That is Phase 2 (plan §D2), and it lives in `006`.
--
-- This file therefore ENSURES the two FKs still point at `subjects`, which also
-- REPAIRS a database where the earlier version of this file already moved them. It is
-- a no-op on a database that never had the swap applied.
--
-- `courses` above is still created and still populated - it simply sits unused until
-- `006`. Nothing references it yet, so that costs nothing and keeps this file additive.
--
-- VERIFIED: these are the ONLY two foreign keys into `subjects` in the whole schema
-- (`sims.sql:327`, `sims.sql:778` / `001:552`).
--
-- SYNTAX NOTE for `006` and anything after it: MariaDB places `IF NOT EXISTS` AFTER
-- `FOREIGN KEY`, not after `ADD CONSTRAINT`. It is valid after `ADD CONSTRAINT` for a
-- CHECK, but a 1064 syntax error for a FOREIGN KEY. `001_missing_fields.sql:552` has
-- the correct form.
-- ----------------------------------------------------------------------------
ALTER TABLE `class_subjects`
  DROP FOREIGN KEY IF EXISTS `fk_class_subjects_course`;
ALTER TABLE `class_subjects`
  ADD CONSTRAINT `fk_class_subjects_subject` FOREIGN KEY IF NOT EXISTS (`subject_id`)
    REFERENCES `subjects` (`id`) ON UPDATE NO ACTION;
ALTER TABLE `class_subjects`
  MODIFY COLUMN `subject_id` uuid NOT NULL
    COMMENT 'FK -> subjects. Moves to courses in 006 (D30 catalog cutover).';

ALTER TABLE `term_grade_snapshots`
  DROP FOREIGN KEY IF EXISTS `fk_term_snapshot_course`;
ALTER TABLE `term_grade_snapshots`
  ADD CONSTRAINT `fk_term_snapshot_subject` FOREIGN KEY IF NOT EXISTS (`subject_id`)
    REFERENCES `subjects` (`id`) ON DELETE NO ACTION;
ALTER TABLE `term_grade_snapshots`
  MODIFY COLUMN `subject_id` uuid NOT NULL
    COMMENT 'Frozen catalog identity. FK -> subjects; moves to courses in 006.';


-- ============================================================================
-- 3. `programs` - THE STUDIES / MAJORS OFFERED
--
-- The eight BAJC Associate-degree programmes.
--
-- `min_passing_grade_point` is the home for the brief's most easily-missed rule:
-- the passing mark is PER PROGRAMME. Primary Education passes at C (2.00);
-- every other programme passes at C+ (2.50). It cannot live on `grading_scales`,
-- whose `pass_mark` is one number per ACADEMIC YEAR.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `programs` (
  `id`                      uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `code`                    varchar(10) NOT NULL COMMENT 'e.g. BMAD - printed on the semester report',
  `name`                    varchar(250) NOT NULL COMMENT 'e.g. Business Management',
  `award`                   varchar(100) NULL COMMENT 'e.g. Associate of Social Science',
  `total_credits`           smallint(6) NULL COMMENT 'Total Programme Credits from the sequence PDF (86-102)',
  `min_passing_grade_point` decimal(3,2) NOT NULL DEFAULT 2.50
      COMMENT 'Programme pass mark as a grade point. 2.50 = C+ (all programmes); Primary Education is set to 2.00 = C.',
  `is_active`               tinyint(1) NOT NULL DEFAULT 1,
  `deleted_at`              datetime NULL,
  `created_at`              datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`              datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`              uuid NULL,
  `updated_by`              uuid NULL,
  `active_code`             varchar(10) GENERATED ALWAYS AS (if(`deleted_at` is null,`code`,NULL)) STORED,
  `active_name`             varchar(250) GENERATED ALWAYS AS (if(`deleted_at` is null,`name`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_programs_code` (`active_code`),
  UNIQUE KEY `uq_programs_name` (`active_name`),
  KEY `fk_programs_created_by` (`created_by`),
  KEY `fk_programs_updated_by` (`updated_by`),
  CONSTRAINT `fk_programs_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_programs_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_programs_pass_gp` CHECK (`min_passing_grade_point` BETWEEN 0 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 4. `program_courses` - THE CURRICULUM (programme -> term block -> course)
--
-- This is the structure the entire course-sequence PDF lives in, and it did not
-- exist in any form: `programs` and `courses` had no relationship at all.
--
-- CRITICAL DISTINCTION. `term_label` here is a CURRICULUM POSITION, not a calendar
-- term. "Semester 1" means "the first semester of this programme's plan", not any
-- particular dated semester in `semesters`. The two are deliberately separate:
--
--   * WHEN a course is actually taught  -> `semesters` (section 6)
--   * WHERE it sits in the plan         -> this table
--
-- Term blocks are NOT uniform across programmes and are NOT limited to 1-2:
--   * 7 programmes : Summer 1, Semester 1, Semester 2, Semester 3, Semester 4
--   * Primary Ed.  : Summer 1, Sem 1, Sem 2, Spring 1, Sem 3, Sem 4, Spring 2, Semester 5
--
-- so `term_label` is free text with a `term_order` for display, not an enum. An enum
-- would force a migration the first time BAJC adds a block.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `program_courses` (
  `id`          uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `program_id`  uuid NOT NULL COMMENT 'FK -> programs',
  `course_id`   uuid NOT NULL COMMENT 'FK -> courses',
  `term_label`  varchar(50) NOT NULL COMMENT 'Curriculum position, e.g. "Summer 1", "Semester 3", "Spring 2"',
  `term_order`  smallint(6) NOT NULL COMMENT 'Display/sequence order of the block within the programme (1-based)',
  `is_required` tinyint(1) NOT NULL DEFAULT 1,
  `created_at`  datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`  datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`  uuid NULL,
  `updated_by`  uuid NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_program_courses` (`program_id`,`course_id`),
  KEY `ix_program_courses_program_order` (`program_id`,`term_order`),
  KEY `fk_program_courses_course` (`course_id`),
  KEY `fk_program_courses_created_by` (`created_by`),
  KEY `fk_program_courses_updated_by` (`updated_by`),
  CONSTRAINT `fk_program_courses_program` FOREIGN KEY (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_program_courses_course` FOREIGN KEY (`course_id`)
    REFERENCES `courses` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_program_courses_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_program_courses_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_program_courses_term_order` CHECK (`term_order` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 5. `course_prerequisites` - A REAL PREREQUISITE RELATION
--
-- Replaces `courses.prerequisites varchar(50)`, which was free text, unqueryable,
-- had no FK, and was too short to hold the real values.
--
-- `requirement_type` exists for one real case in the source material:
--   'course'               -> prerequisite_course_id names a specific course
--   'all_program_courses'  -> prerequisite_course_id IS NULL; the gate is "every
--                             course in the programme", which is what
--                             EDUC3201 (Internship) <- "ALL COURSES" actually says.
--
-- `program_id` is nullable: a prerequisite may be global to the course, or scoped to
-- one programme's plan.
--
-- Real multi-valued examples this now expresses correctly:
--   AGRI2118 <- AGRI1108, AGRI1109
--   EDUC1210 <- EDUC1102, EDUC1104
--   EDUC2305 <- EDUC1210, 2226, 2228, 2330, 2334, 2336   (six rows)
--   BIOL1204L <- BIOL1102L                               (labs gate on labs)
--
-- ENFORCEMENT IS IN THE SERVICE, NOT HERE. A prerequisite is satisfied only by
-- SUCCESSFUL COMPLETION - a passing term grade or an approved credit transfer -
-- judged against the PROGRAMME's `min_passing_grade_point`. Prior enrolment alone
-- is never enough. No CHECK constraint can express that.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `course_prerequisites` (
  `id`                     uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `course_id`              uuid NOT NULL COMMENT 'FK -> courses (the gated course)',
  `prerequisite_course_id` uuid NULL COMMENT 'FK -> courses (the required course); NULL when requirement_type = all_program_courses',
  `program_id`             uuid NULL COMMENT 'FK -> programs; NULL = applies in every programme',
  `requirement_type`       enum('course','all_program_courses') NOT NULL DEFAULT 'course',
  `created_at`             datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`             datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`             uuid NULL,
  `updated_by`             uuid NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_prereq` (`course_id`,`prerequisite_course_id`,`program_id`),
  KEY `ix_course_prereq_course` (`course_id`),
  KEY `fk_course_prereq_prereq` (`prerequisite_course_id`),
  KEY `fk_course_prereq_program` (`program_id`),
  KEY `fk_course_prereq_created_by` (`created_by`),
  KEY `fk_course_prereq_updated_by` (`updated_by`),
  CONSTRAINT `fk_course_prereq_course` FOREIGN KEY (`course_id`)
    REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_prereq_prereq` FOREIGN KEY (`prerequisite_course_id`)
    REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_prereq_program` FOREIGN KEY (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_course_prereq_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_prereq_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_course_prereq_shape` CHECK (
    (`requirement_type` = 'course'              AND `prerequisite_course_id` IS NOT NULL) OR
    (`requirement_type` = 'all_program_courses' AND `prerequisite_course_id` IS NULL)
  ),
  CONSTRAINT `ck_course_prereq_not_self` CHECK (
    `prerequisite_course_id` IS NULL OR `prerequisite_course_id` <> `course_id`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 6. `semesters` - N CALENDAR TERMS PER YEAR, AND THE GRADE DEADLINE
--
-- Two changes.
--
-- (a) The 2-terms-per-year cap is removed. `ck_semesters_sequence CHECK (sequence IN
--     (1,2))` and `uq_semesters_year_seq (academic_year_id, sequence)` together made
--     it impossible to record more than two terms in an academic year. BAJC runs
--     Summer and Spring blocks alongside its numbered semesters. The uniqueness is
--     retained - a sequence number is still unique within a year - but the CHECK is
--     dropped and `term_type` is added so the kind of term is a queryable fact rather
--     than something parsed out of `name`.
--
--     `uq_semesters_one_active` is DELIBERATELY LEFT IN PLACE. Exactly one term is
--     active school-wide at a time; that invariant is unchanged by having more terms.
--
-- (b) `grade_submission_deadline` - brief §18. The cutoff after which Lecturers can
--     no longer submit or change grades. DEAN-ONLY to configure. Enforced in
--     `grades/service.py::upsert_grades`, the single grade write path, returning 409
--     `grade_window_closed`. NULL = no deadline set, window open.
--
--     It belongs on the term, not in a new settings table: the deadline is a property
--     of a specific term, and the existing settings architecture has no generic
--     key/value store by design.
-- ============================================================================
ALTER TABLE `semesters`
  DROP CONSTRAINT IF EXISTS `ck_semesters_sequence`;

ALTER TABLE `semesters`
  ADD COLUMN IF NOT EXISTS `term_type` enum('summer','semester','spring') NOT NULL DEFAULT 'semester'
      COMMENT 'BAJC term kind. Curriculum position lives on program_courses.term_label, not here.'
      AFTER `name`,
  ADD COLUMN IF NOT EXISTS `grade_submission_deadline` datetime NULL
      COMMENT 'Brief §18 - Lecturer grade-entry cutoff. Dean-only. NULL = window open.'
      AFTER `end_date`;

ALTER TABLE `semesters`
  MODIFY COLUMN `sequence` smallint(6) NOT NULL
      COMMENT 'Order within the academic year (1-based). No longer capped at 2 - D30.';


-- ============================================================================
-- 7. GRADE POINTS, QUALITY POINTS, GPA
--
-- (a) `grading_scale_bands.grade_point` - the missing 4.00-scale column. Without it
--     the official BAJC scale has nowhere to live and GPA is not computable.
--
--     The scale itself is SEEDED IN APPLICATION CODE (Phase 3), not here, because
--     bands are per-academic-year rows created alongside a `grading_scales` row and
--     the app already owns that lifecycle (`settings/service.py`, `db/seed.py`).
--     For reference, the values from the academic policy:
--
--       A   95-100  4.00      C+  75-79   2.50
--       A-  90-94   3.75      C   70-74   2.00
--       B+  85-89   3.50      D   65-69   1.00
--       B   80-84   3.00      F   0-64    0.00
--
--     Nullable, because existing rows (the current A/B/C/D/F 90/80/70/60 scale) have
--     no grade point until the Dean re-enters the scale.
--
-- (b) `term_grade_snapshots` gains the three frozen values. A snapshot must stay
--     reproducible: if `courses.credits` is edited years later, an already-issued
--     transcript must not silently change. Same reasoning as the existing
--     `subject_id` and `effective_policy` columns on that table.
--
--     Quality Points = Grade Point x Credits.
--     GPA           = Total Quality Points / Total Credits.
-- ============================================================================
ALTER TABLE `grading_scale_bands`
  ADD COLUMN IF NOT EXISTS `grade_point` decimal(3,2) NULL
      COMMENT 'BAJC 4.00 scale, e.g. A=4.00, A-=3.75, C+=2.50. NULL until the Dean sets the scale.'
      AFTER `max_score`;

ALTER TABLE `grading_scale_bands`
  ADD CONSTRAINT IF NOT EXISTS `ck_bands_grade_point`
      CHECK (`grade_point` IS NULL OR `grade_point` BETWEEN 0 AND 4);

ALTER TABLE `term_grade_snapshots`
  ADD COLUMN IF NOT EXISTS `grade_point` decimal(3,2) NULL
      COMMENT 'Frozen grade point for letter_grade under the scale in force at freeze'
      AFTER `letter_grade`,
  ADD COLUMN IF NOT EXISTS `credits` smallint(6) NULL
      COMMENT 'Frozen course credits at freeze - a later catalog edit must not alter an issued transcript'
      AFTER `grade_point`,
  ADD COLUMN IF NOT EXISTS `quality_points` decimal(6,2) NULL
      COMMENT 'Frozen grade_point x credits'
      AFTER `credits`;


-- ============================================================================
-- 8. `class_enrollments.enrollment_status`
--
-- The legacy `courses.coursestatus enum('Audit','Withdraw Passing','Withdraw Failing')`
-- was an ENROLMENT fact sitting on the CATALOG - it described what one student did in
-- one offering, not a property of the course. Moved to where it belongs.
--
-- 'enrolled' is the default and covers every existing row.
-- ============================================================================
ALTER TABLE `class_enrollments`
  ADD COLUMN IF NOT EXISTS `enrollment_status`
      enum('enrolled','audit','withdraw_passing','withdraw_failing') NOT NULL DEFAULT 'enrolled'
      COMMENT 'Per-student outcome for this offering. Was courses.coursestatus, which was on the wrong table.'
      AFTER `unenrolled_at`;


-- ============================================================================
-- 9. STUDENT PROFILE - THE TERTIARY / APPLICATION-FORM COLUMNS
--
-- Sourced from the BAJC application form (application1 / application2) and the
-- tertiary columns already present in `sims_bk.sql`.
--
-- THREE THINGS TO NOTE.
--
-- (1) NAMES ARE SPLIT (brief §11). `firstname`/`middlename`/`lastname` are added and
--     backfilled from `full_name`. Student listings must sort ascending by
--     `lastname`, then `firstname` - never by a combined display string.
--
--     `full_name` IS DELIBERATELY LEFT IN PLACE by this file. The ORM still writes it,
--     and dropping it here would break the running app in the window before the
--     Phase 1 code change lands. It is dropped in `006` once the ORM has cut over.
--
-- (2) `yearofstudy` FROM sims_bk.sql IS NOT ADOPTED. Its enum
--     ('Summer','First','Second','Part Time','Full Time','Transient') conflates two
--     INDEPENDENT fields that Section E of the form asks separately:
--       "Year of study applying for: First / Second"   -> year_of_study
--       "Part Time (<15 crs) / Full Time (>15 crs) / Transient" -> enrollment_load
--     A student is "Second year" AND "Full Time"; one column cannot hold both.
--
-- (3) `program_id` is a proper uuid FK. The `sims_bk.sql` column was
--     `programid varchar(8)` against `programs.programid uuid` - a type mismatch with
--     no FK, so it could never have been joined.
-- ============================================================================
ALTER TABLE `student_profiles`
  -- Section A - name parts (brief §11)
  ADD COLUMN IF NOT EXISTS `firstname` varchar(50) NULL AFTER `student_number`,
  ADD COLUMN IF NOT EXISTS `middlename` varchar(50) NULL AFTER `firstname`,
  ADD COLUMN IF NOT EXISTS `lastname` varchar(50) NULL AFTER `middlename`,

  -- Section A - identity and personal
  ADD COLUMN IF NOT EXISTS `ssno` varchar(9) NULL COMMENT 'Social Security No.' AFTER `date_of_birth`,
  ADD COLUMN IF NOT EXISTS `religion` varchar(100) NULL AFTER `gender`,
  ADD COLUMN IF NOT EXISTS `civil_status` varchar(50) NULL COMMENT 'Form: "Civic Status"' AFTER `religion`,
  ADD COLUMN IF NOT EXISTS `has_health_condition` tinyint(1) NOT NULL DEFAULT 0
      COMMENT 'Form: health or learning condition we should know about',
  ADD COLUMN IF NOT EXISTS `health_condition_note` text NULL,

  -- Section A - address
  ADD COLUMN IF NOT EXISTS `street` varchar(200) NULL AFTER `address`,
  ADD COLUMN IF NOT EXISTS `city_town_village` varchar(200) NULL COMMENT 'Form: Village, Town, or City' AFTER `street`,
  ADD COLUMN IF NOT EXISTS `district`
      enum('Corozal','Orange Walk','Belize','Cayo','Stann Creek','Toledo') NULL AFTER `city_town_village`,

  -- Section A - parents and next of kin
  ADD COLUMN IF NOT EXISTS `mother_name` varchar(200) NULL AFTER `guardian_email`,
  ADD COLUMN IF NOT EXISTS `father_name` varchar(200) NULL AFTER `mother_name`,
  ADD COLUMN IF NOT EXISTS `nok_name` varchar(200) NULL COMMENT 'Next of kin for emergencies' AFTER `father_name`,
  ADD COLUMN IF NOT EXISTS `nok_relationship` varchar(100) NULL AFTER `nok_name`,
  ADD COLUMN IF NOT EXISTS `nok_phone` varchar(50) NULL AFTER `nok_relationship`,

  -- Section B - examinations
  ADD COLUMN IF NOT EXISTS `atlib_exam` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Form Section B: ATLIB Exam taken',
  ADD COLUMN IF NOT EXISTS `num_csec` smallint(6) NULL COMMENT 'Form Section B: Number of CSEC Exams (1-8+)',

  -- Section C - financial
  ADD COLUMN IF NOT EXISTS `finance_name` varchar(200) NULL COMMENT 'Who will finance the study',
  ADD COLUMN IF NOT EXISTS `finance_phone` varchar(50) NULL,
  ADD COLUMN IF NOT EXISTS `finance_email` varchar(254) NULL,

  -- Section E - programme of study (see note 2 in this section's header)
  ADD COLUMN IF NOT EXISTS `program_id` uuid NULL COMMENT 'FK -> programs (proper uuid FK, D30)',
  ADD COLUMN IF NOT EXISTS `year_of_study` enum('First','Second') NULL
      COMMENT 'Form Section E: year of study applying for',
  ADD COLUMN IF NOT EXISTS `enrollment_load` enum('Part Time','Full Time','Transient') NULL
      COMMENT 'Form Section E: Part Time (<15 crs) / Full Time (>15 crs) / Transient',

  -- Provenance
  ADD COLUMN IF NOT EXISTS `application_id` uuid NULL COMMENT 'FK -> applications; the application this student was admitted from';

ALTER TABLE `student_profiles`
  ADD INDEX IF NOT EXISTS `fk_student_profiles_program` (`program_id`),
  ADD INDEX IF NOT EXISTS `fk_student_profiles_application` (`application_id`),
  ADD INDEX IF NOT EXISTS `ix_student_profiles_lastname` (`lastname`,`firstname`);

ALTER TABLE `student_profiles`
  ADD CONSTRAINT `fk_student_profiles_program` FOREIGN KEY IF NOT EXISTS (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE SET NULL;

ALTER TABLE `student_profiles`
  ADD CONSTRAINT IF NOT EXISTS `ck_student_profiles_num_csec`
      CHECK (`num_csec` IS NULL OR `num_csec` BETWEEN 0 AND 20);

-- Backfill the name parts from full_name. Best-effort and idempotent (only touches
-- rows not yet split): last token -> lastname, first token -> firstname, the rest ->
-- middlename. The Registrar corrects the handful this gets wrong; a person's name is
-- not reliably parseable and this is a one-time convenience, not a rule.
UPDATE `student_profiles`
SET
  `firstname` = TRIM(SUBSTRING_INDEX(TRIM(`full_name`), ' ', 1)),
  `lastname`  = TRIM(SUBSTRING_INDEX(TRIM(`full_name`), ' ', -1)),
  `middlename` = NULLIF(TRIM(
      SUBSTRING(
        TRIM(`full_name`),
        CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), ' ', 1)) + 2,
        GREATEST(
          CHAR_LENGTH(TRIM(`full_name`))
            - CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), ' ', 1))
            - CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), ' ', -1)) - 2,
          0)
      )
  ), '')
WHERE `firstname` IS NULL
  AND `full_name` IS NOT NULL
  AND TRIM(`full_name`) <> '';

-- Single-word names: the split above puts the same token in both slots. Keep it as
-- the lastname (that is what listings sort on) and clear the firstname.
UPDATE `student_profiles`
SET `firstname` = NULL
WHERE `firstname` = `lastname`
  AND TRIM(`full_name`) NOT LIKE '% %';


-- ============================================================================
-- 10. `student_number_sequences` - CONCURRENCY-SAFE YYYYMM### IDs (brief §10)
--
-- There is no student-ID generation anywhere in the codebase today:
-- `student_number` is client-supplied and only checked for uniqueness
-- (`students/service.py:576`). The brief requires server-generated `YYYYMM###`
-- (202608001, 202608002, ...) with no duplicates under concurrent registration.
--
-- Allocation is a single statement inside the caller's transaction:
--
--   INSERT INTO student_number_sequences (year_month, last_seq) VALUES (?, 1)
--     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1;
--   SELECT last_seq FROM student_number_sequences WHERE year_month = ?;
--
-- The row lock taken by the upsert serialises concurrent allocators, so two
-- simultaneous registrations cannot receive the same number. The existing
-- partial-unique on `student_profiles.student_number` remains the backstop; a
-- collision is retried rather than trusted away.
--
-- Kept as its own table rather than MAX(student_number)+1 because a MAX scan is
-- racy under concurrency and would also be confused by imported or legacy IDs that
-- do not follow the format.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `student_number_sequences` (
  `year_month` char(6) NOT NULL COMMENT 'YYYYMM, e.g. 202608',
  `last_seq`   int(11) NOT NULL DEFAULT 0 COMMENT 'Highest ### issued for this year/month',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`year_month`),
  CONSTRAINT `ck_student_number_seq_nonneg` CHECK (`last_seq` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 11. `applications` - THE ADMISSION RECORD (brief §9)
--
-- There was no applicant entity. Students were created directly, so the form's
-- "FOR OFFICIAL USE ONLY" block (Date Accepted, Academic Year, Programme of Study,
-- Enrolment Status, Student Code, Comments) had nowhere to live, and
-- `student_profiles.status` is a lifecycle enum (active/graduated/withdrawn), not an
-- admission status.
--
-- Stakeholder decision #5: the form creates an APPLICATION. Acceptance is the single
-- action that creates the student, issues the YYYYMM### ID and provisions the login.
-- That ordering also matters for credit transfer, which the policy allows ONLY at
-- entrance/admission - there is no student to attach it to yet.
--
-- Fields mirror the paper form section by section so the full-screen workflow and the
-- record stay in step.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `applications` (
  `id`                    uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `status`                enum('draft','submitted','under_review','accepted','denied','withdrawn')
                          NOT NULL DEFAULT 'draft',
  `school_year`           varchar(20) NULL COMMENT 'Form header: School year',

  -- Section A - personal
  `firstname`             varchar(50) NOT NULL,
  `middlename`            varchar(50) NULL,
  `lastname`              varchar(50) NOT NULL,
  `date_of_birth`         date NULL,
  `ssno`                  varchar(9) NULL COMMENT 'Social Security No.',
  `gender`                varchar(25) NULL,
  `civil_status`          varchar(50) NULL,
  `religion`              varchar(100) NULL,
  `phone`                 varchar(50) NULL COMMENT 'Personal telephone number',
  `email`                 varchar(254) NULL COMMENT 'Personal e-mail address',
  `has_health_condition`  tinyint(1) NOT NULL DEFAULT 0,
  `health_condition_note` text NULL,

  -- Section A - address
  `street`                varchar(200) NULL,
  `city_town_village`     varchar(200) NULL,
  `district`              enum('Corozal','Orange Walk','Belize','Cayo','Stann Creek','Toledo') NULL,

  -- Section A - parents and next of kin
  `mother_name`           varchar(200) NULL,
  `father_name`           varchar(200) NULL,
  `nok_name`              varchar(200) NULL,
  `nok_relationship`      varchar(100) NULL,
  `nok_phone`             varchar(50) NULL,

  -- Section B - examinations (the institutions themselves are application_education)
  `atlib_exam`            tinyint(1) NOT NULL DEFAULT 0,
  `num_csec`              smallint(6) NULL COMMENT 'Number of CSEC Exams (1-8+)',

  -- Section C - financial
  `finance_name`          varchar(200) NULL,
  `finance_phone`         varchar(50) NULL,
  `finance_email`         varchar(254) NULL,

  -- Section D - recommendation
  `recommendation_received` tinyint(1) NOT NULL DEFAULT 0
      COMMENT 'BAJC Character and Academic Recommendation Form, completed by a high school teacher',

  -- Section E - programme of study
  `program_id`            uuid NULL COMMENT 'FK -> programs',
  `year_of_study`         enum('First','Second') NULL,
  `enrollment_load`       enum('Part Time','Full Time','Transient') NULL,

  -- Section G - agreement
  `applicant_signed_at`   date NULL,
  `guardian_signed_at`    date NULL COMMENT 'Required only if the applicant is under 18',

  -- FOR OFFICIAL USE ONLY
  `date_accepted`         date NULL,
  `academic_year_id`      uuid NULL COMMENT 'FK -> academic_years',
  `enrolment_status`      varchar(50) NULL,
  `student_code`          varchar(20) NULL COMMENT 'The YYYYMM### issued on acceptance',
  `comments`              text NULL COMMENT 'Comments/Observations',
  `decided_by_user_id`    uuid NULL COMMENT 'FK -> users (Dean or Registrar)',
  `decided_at`            datetime NULL,
  `student_id`            uuid NULL COMMENT 'FK -> student_profiles; set on acceptance',

  `deleted_at`            datetime NULL,
  `created_at`            datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`            datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`            uuid NULL,
  `updated_by`            uuid NULL,
  PRIMARY KEY (`id`),
  KEY `ix_applications_status` (`status`),
  KEY `ix_applications_lastname` (`lastname`,`firstname`),
  KEY `fk_applications_program` (`program_id`),
  KEY `fk_applications_year` (`academic_year_id`),
  KEY `fk_applications_student` (`student_id`),
  KEY `fk_applications_decided_by` (`decided_by_user_id`),
  KEY `fk_applications_created_by` (`created_by`),
  KEY `fk_applications_updated_by` (`updated_by`),
  CONSTRAINT `fk_applications_program` FOREIGN KEY (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_year` FOREIGN KEY (`academic_year_id`)
    REFERENCES `academic_years` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_student` FOREIGN KEY (`student_id`)
    REFERENCES `student_profiles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_decided_by` FOREIGN KEY (`decided_by_user_id`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_applications_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_applications_num_csec` CHECK (`num_csec` IS NULL OR `num_csec` BETWEEN 0 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Deferred FK: student_profiles.application_id -> applications.id. Added here because
-- `applications` did not exist when section 9 ran.
ALTER TABLE `student_profiles`
  ADD CONSTRAINT `fk_student_profiles_application` FOREIGN KEY IF NOT EXISTS (`application_id`)
    REFERENCES `applications` (`id`) ON DELETE SET NULL;


-- ============================================================================
-- 12. `application_education` - SECTION B'S REPEATING INSTITUTION TABLE
--
-- Replaces the quarantined `educational_background`, which had NO `student_id` and no
-- `application_id` - nothing tied a row to a person, and `student_profiles` referenced
-- it through a single `educationbg_id`, so only ONE institution could ever be
-- recorded. The form's table has four rows.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `application_education` (
  `id`              uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_id`  uuid NOT NULL COMMENT 'FK -> applications',
  `institution`     varchar(250) NOT NULL COMMENT 'Name of Institution',
  `education_level` enum('High School','Tertiary') NOT NULL DEFAULT 'High School',
  `graduated`       tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Graduated? (Yes or No)',
  `graduation_date` date NULL,
  `sort_order`      smallint(6) NOT NULL DEFAULT 1,
  `created_at`      datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`      datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_application_education_application` (`application_id`),
  CONSTRAINT `fk_application_education_application` FOREIGN KEY (`application_id`)
    REFERENCES `applications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 13. `application_documents` - SECTION F'S CHECKLIST
--
-- The five documents the form requires. Mirrors the existing `student_documents`
-- storage pattern (`storage_key`, `content_type`, `size_bytes`) so the same upload
-- path serves both. `document_type` replaces the quarantined `documents` lookup
-- table, matching how `student_documents.document_type` already works.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `application_documents` (
  `id`             uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_id` uuid NOT NULL COMMENT 'FK -> applications',
  `document_type`  enum('passport_photo','hs_diploma','recommendation_form',
                        'social_security_card','course_outline','transcript','cta','other')
                   NOT NULL COMMENT 'Form Section F checklist, plus the credit-transfer documents',
  `file_name`      varchar(150) NULL COMMENT 'Original name',
  `storage_key`    varchar(200) NULL COMMENT 'Object-storage path/key',
  `content_type`   varchar(100) NULL COMMENT 'MIME',
  `size_bytes`     bigint(20) NULL,
  `received`       tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Ticked even when no file is uploaded (paper submission)',
  `created_at`     datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`     datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_application_documents_application` (`application_id`),
  CONSTRAINT `fk_application_documents_application` FOREIGN KEY (`application_id`)
    REFERENCES `applications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 14. `credit_transfer_requests` - THE CTA PROCESS (brief §13)
--
-- Nothing existed for this. The academic policy is encoded as follows:
--
--   * studied and PASSED at another recognised tertiary institution
--     -> external_institution, external_course_code/name, external_grade
--   * minimum 75% CONTENT EQUIVALENCY with the BAJC course
--     -> content_equivalency_pct, enforced at approval (see below)
--   * equivalent in knowledge and skills
--     -> the Dean's assessment, recorded in `note`
--   * applied for ONLY when applying for entrance/admission
--     -> anchored on application_id, NOT student_id. This is structural: there is no
--        student yet at the time a transfer may be requested.
--   * requires CTA + original transcript + course outlines
--     -> the three document FKs, all into application_documents
--   * assessment is submitted to THE DEAN
--     -> decided_by_user_id; the service restricts the decision to the Dean role
--
-- The 75% floor is enforced by CHECK only for APPROVED rows. A request may be filed
-- and reviewed at any percentage - the rule is that it cannot be APPROVED below 75.
-- Encoding it as a flat column CHECK would make a legitimate 60%-equivalency request
-- unrecordable, which would push staff to work around the system.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `credit_transfer_requests` (
  `id`                      uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `application_id`          uuid NOT NULL COMMENT 'FK -> applications. Transfers are admission-time only, by policy.',
  `external_institution`    varchar(250) NOT NULL,
  `external_course_code`    varchar(50) NULL,
  `external_course_name`    varchar(200) NOT NULL,
  `external_credits`        smallint(6) NULL,
  `external_grade`          varchar(15) NULL COMMENT 'Grade earned at the external institution',
  `target_course_id`        uuid NOT NULL COMMENT 'FK -> courses; the BAJC course being claimed',
  `content_equivalency_pct` decimal(5,2) NULL COMMENT 'Assessed content match. Must be >= 75.00 to approve.',
  `cta_document_id`         uuid NULL COMMENT 'FK -> application_documents (completed CTA form)',
  `transcript_document_id`  uuid NULL COMMENT 'FK -> application_documents (original transcript)',
  `outline_document_id`     uuid NULL COMMENT 'FK -> application_documents (course outlines)',
  `status`                  enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `decided_by_user_id`      uuid NULL COMMENT 'FK -> users; the Dean',
  `decided_at`              datetime NULL,
  `note`                    text NULL COMMENT 'Dean assessment of knowledge/skills equivalency',
  `created_at`              datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`              datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`              uuid NULL,
  `updated_by`              uuid NULL,
  PRIMARY KEY (`id`),
  KEY `ix_cta_application` (`application_id`),
  KEY `ix_cta_status` (`status`),
  KEY `fk_cta_target_course` (`target_course_id`),
  KEY `fk_cta_decided_by` (`decided_by_user_id`),
  CONSTRAINT `fk_cta_application` FOREIGN KEY (`application_id`)
    REFERENCES `applications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cta_target_course` FOREIGN KEY (`target_course_id`)
    REFERENCES `courses` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cta_cta_doc` FOREIGN KEY (`cta_document_id`)
    REFERENCES `application_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_transcript_doc` FOREIGN KEY (`transcript_document_id`)
    REFERENCES `application_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_outline_doc` FOREIGN KEY (`outline_document_id`)
    REFERENCES `application_documents` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_decided_by` FOREIGN KEY (`decided_by_user_id`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cta_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_cta_equivalency_range` CHECK (
    `content_equivalency_pct` IS NULL OR `content_equivalency_pct` BETWEEN 0 AND 100
  ),
  CONSTRAINT `ck_cta_approval_requires_75` CHECK (
    `status` <> 'approved' OR
    (`content_equivalency_pct` IS NOT NULL AND `content_equivalency_pct` >= 75.00)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 15. `student_program_history` - PROGRAMME CHANGES WITHOUT DATA LOSS (brief §12)
--
-- The brief is explicit that changing a student's programme must not simply overwrite
-- a field and must never destroy academic history. This table is the append-only
-- record of which programme a student was in, and when.
--
-- Everything else about a programme change is DERIVED, not stored: courses completed /
-- failed / passed / transferred / currently enrolled, courses required by the new
-- programme, courses still outstanding, credits earned and remaining, and GPA all come
-- from `class_enrollments` + `term_grade_snapshots` + approved
-- `credit_transfer_requests` + `program_courses`. Storing them would create a second
-- source of truth that drifts.
--
-- `ended_at IS NULL` marks the current programme. The partial-unique trick (a STORED
-- generated column that is NULL once the row is closed) enforces "at most one open
-- programme per student".
-- ============================================================================
CREATE TABLE IF NOT EXISTS `student_program_history` (
  `id`           uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `student_id`   uuid NOT NULL COMMENT 'FK -> student_profiles',
  `program_id`   uuid NOT NULL COMMENT 'FK -> programs',
  `started_at`   date NOT NULL,
  `ended_at`     date NULL COMMENT 'NULL = the student is currently in this programme',
  `reason`       varchar(255) NULL COMMENT 'Why the programme changed',
  `created_at`   datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`   datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`   uuid NULL,
  `updated_by`   uuid NULL,
  `open_flag`    tinyint(1) GENERATED ALWAYS AS (if(`ended_at` is null,1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_program_open` (`student_id`,`open_flag`),
  KEY `ix_student_program_student` (`student_id`),
  KEY `fk_student_program_program` (`program_id`),
  CONSTRAINT `fk_student_program_student` FOREIGN KEY (`student_id`)
    REFERENCES `student_profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_student_program_program` FOREIGN KEY (`program_id`)
    REFERENCES `programs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_student_program_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_program_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_student_program_dates` CHECK (`ended_at` IS NULL OR `ended_at` >= `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- 16. `grade_revision_requests` - SECOND OPPORTUNITY / GRADE REVISION (brief §20)
--
-- HONEST STATUS: the database ALREADY SUPPORTED HALF OF THIS. `assessment_grades`
-- has `makeup_score` ("Makeup result; substitutes when allow_makeup") backed by the
-- 4-level `allow_makeup` policy chain, so the SECOND-ATTEMPT SCORE has always had a
-- home. What was missing is the REQUEST, the REASON, the APPROVAL and the HISTORY.
-- This table is that missing half - it is not a reinvention of the score slot.
--
-- Workflow (brief §20):
--   1-3. Lecturer identifies the student and assessment and requests a revision
--   4.   Lecturer must provide a description/reason  -> `reason` is NOT NULL
--   5.   Lecturer records the new result             -> `proposed_score`
--   6.   The Dean is notified                        -> the pending queue IS the
--        notification; see plan §D8. No separate notifications table - that would
--        duplicate an architecture the app already has.
--   7-9. The Dean approves or denies                 -> status, decided_by, decided_at
--   10.  Only an APPROVED request writes the grade   -> the service writes makeup_score
--
-- `original_score` is captured AT REQUEST TIME so the pre-revision value survives even
-- if the underlying row later changes. The brief requires the original not to
-- disappear; between this column and the `audit_log` row written on decision, it does
-- not.
--
-- The partial-unique allows only ONE OPEN request per grade - otherwise a Lecturer
-- could queue several conflicting revisions for the same cell and the Dean would have
-- no defined order to apply them in. Historical decided rows are unconstrained.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `grade_revision_requests` (
  `id`                  uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `assessment_grade_id` uuid NOT NULL COMMENT 'FK -> assessment_grades (the cell being revised)',
  `requested_by_user_id` uuid NOT NULL COMMENT 'FK -> users (the Lecturer)',
  `reason`              text NOT NULL COMMENT 'Brief §20 step 4 - description of the second assessment. Required.',
  `original_score`      decimal(6,2) NULL COMMENT 'assessment_grades.score captured at request time',
  `proposed_score`      decimal(6,2) NOT NULL COMMENT 'The new result the Lecturer recorded',
  `status`              enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `decided_by_user_id`  uuid NULL COMMENT 'FK -> users (the Dean)',
  `decided_at`          datetime NULL,
  `decision_note`       text NULL,
  `created_at`          datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`          datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `pending_flag`        tinyint(1) GENERATED ALWAYS AS (if(`status` = 'pending',1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grade_revision_open` (`assessment_grade_id`,`pending_flag`),
  KEY `ix_grade_revision_status` (`status`),
  KEY `ix_grade_revision_requested_by` (`requested_by_user_id`),
  KEY `fk_grade_revision_decided_by` (`decided_by_user_id`),
  CONSTRAINT `fk_grade_revision_grade` FOREIGN KEY (`assessment_grade_id`)
    REFERENCES `assessment_grades` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_grade_revision_requested_by` FOREIGN KEY (`requested_by_user_id`)
    REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_grade_revision_decided_by` FOREIGN KEY (`decided_by_user_id`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_grade_revision_scores_nonneg` CHECK (
    `proposed_score` >= 0 AND (`original_score` IS NULL OR `original_score` >= 0)
  ),
  CONSTRAINT `ck_grade_revision_decided` CHECK (
    `status` = 'pending' OR `decided_at` IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- Restore session settings.
-- ============================================================================
SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;


-- ============================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
--   * It does not DROP anything. The four legacy tertiary tables are renamed to
--     `*_legacy_pre_d30` and kept. `subjects` is left in place and simply stops being
--     the catalog. The dormant `students` / `staff` / `grades` / `cat_assessment`
--     tables are untouched, as they were by 001-004.
--
--   * It does not drop `student_profiles.full_name`. The running ORM still writes it;
--     removing it here would break the app in the window before the Phase 1 code lands.
--     `006` drops it once the ORM has cut over.
--
--   * It does not seed. The BAJC grading scale, the 8 programmes and their course
--     sequences are seeded from application code in Phases 2-3, where the existing
--     `settings/service.py` and `db/seed.py` lifecycles own that work.
--
--   * It does not address COURSE RETAKES. `class_enrollments.uq_enroll_active` has no
--     attempt/sequence column, so a repeated course still cannot be represented. This
--     is outside the brief's scope and is flagged in plan §G item 5 rather than
--     silently changed - altering that unique key affects enrolment, attendance and
--     the gradebook.
-- ============================================================================

-- ============================================================================
-- 017_sims10_reconcile.sql


SET @OLD_FOREIGN_KEY_CHECKS := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE := @@SQL_MODE;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';


-- ============================================================================
-- 1. `number_sequences` - ONE ALLOCATOR, TWO KINDS OF NUMBER
--
-- `student_number_sequences` (005 §D9) is `year_month char(6)` PRIMARY KEY, which
-- encodes the YYYYMM### format in the SCHEMA. D44 changes the student format to
-- YYYY-NNNNN and adds APP-YYYY-NNNNN, so the key stops being a year-month and
-- there are two counters instead of one.
--
-- Generalised rather than adding a second near-identical table: the safety of the
-- allocation lives entirely in `INSERT ... ON DUPLICATE KEY UPDATE last_seq =
-- last_seq + 1` taking the InnoDB row lock inside the caller's transaction
-- (see numbering.py). That is one piece of reasoning, and it should have one
-- implementation, not two copies that can drift.
--
-- `seq_key` is varchar, not an int year: the retired YYYYMM keys are preserved
-- below under their own scope, and a future counter may not be year-shaped.
--
-- `student_number_sequences` is KEPT, not dropped - the 006 convention. It holds
-- the provenance of every number issued before D44 and costs one row.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `number_sequences` (
  `scope`      varchar(20) NOT NULL
      COMMENT 'What is being numbered: `student` | `application`. `student_ym` is the retired pre-D44 YYYYMM namespace, kept for provenance and never allocated from.',
  `seq_key`    varchar(10) NOT NULL
      COMMENT 'The bucket the counter resets in - `2026` for both live scopes. varchar because the retired scope keys are YYYYMM and a future scope may not be year-shaped.',
  `last_seq`   int(11)     NOT NULL DEFAULT 0
      COMMENT 'Highest sequence issued for this (scope, key).',
  `created_at` datetime    NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`scope`,`seq_key`),
  CONSTRAINT `ck_number_sequences_nonneg` CHECK (`last_seq` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT = 'Row-locked counters behind the generated human IDs (D44). Replaces student_number_sequences.';

-- Carry the retired YYYYMM counters across under their own scope. They are never
-- allocated from again - the new student key is the YEAR - but throwing away the
-- record of which numbers were issued is not something to do casually.
INSERT INTO `number_sequences` (`scope`, `seq_key`, `last_seq`, `created_at`, `updated_at`)
SELECT 'student_ym', `year_month`, `last_seq`, `created_at`, `updated_at`
FROM `student_number_sequences`
ON DUPLICATE KEY UPDATE `last_seq` = GREATEST(`number_sequences`.`last_seq`, VALUES(`last_seq`));


-- ============================================================================
-- 2. `applications.status` - THE CLIENT'S TEN-STATE VOCABULARY
--
-- From six to ten. Four are genuinely new (`documents_pending`, `eligible`,
-- `deferred`, `enrolled`) and one is a RENAME: `denied` -> `rejected`.
--
-- The rename is why this is three statements and not one. A single MODIFY to the
-- final list would truncate the live row currently sitting on `denied` - MariaDB
-- has no idea the two labels mean the same thing. So: widen to the UNION of both
-- vocabularies, rewrite the data, then narrow. This is the same shape as 011 §3,
-- and for the same reason.
--
-- 2a and 2c are both guarded, and the guard is on the column TYPE rather than a
-- version marker, so the file can be re-run against a database at any of the
-- three intermediate states and will finish the job rather than fail.
-- ----------------------------------------------------------------------------

-- 2a. Widen to the union. Nothing is unstorable at this point.
SET @status_is_final := (
  SELECT COUNT(*) FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name`   = 'applications'
    AND `column_name`  = 'status'
    AND `column_type` LIKE '%rejected%'
    AND `column_type` NOT LIKE '%denied%'
);
SET @sql := IF(@status_is_final = 0,
  'ALTER TABLE `applications` MODIFY COLUMN `status`
     enum(''draft'',''submitted'',''under_review'',''documents_pending'',''eligible'',
          ''accepted'',''denied'',''rejected'',''deferred'',''withdrawn'',''enrolled'')
     NOT NULL DEFAULT ''draft''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2b. The rename itself. Matches zero rows once it has run.
UPDATE `applications` SET `status` = 'rejected' WHERE `status` = 'denied';

-- 2c. Narrow to the final ten. Must come after 2b or the `denied` row truncates.
SET @sql := IF(@status_is_final = 0,
  'ALTER TABLE `applications` MODIFY COLUMN `status`
     enum(''draft'',''submitted'',''under_review'',''documents_pending'',''eligible'',
          ''accepted'',''rejected'',''deferred'',''withdrawn'',''enrolled'')
     NOT NULL DEFAULT ''draft''
     COMMENT ''D44, client vocabulary. draft/submitted/under_review unchanged. documents_pending = returned to the applicant for missing paperwork. eligible = meets the requirements, awaiting a decision. rejected was `denied` before D44. deferred = decision held to a later intake. enrolled = accepted AND registered. accepted/rejected/withdrawn/enrolled are terminal.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- 3. `applications.conditions_of_admission` - from the dump, verbatim
--
-- Free text on the acceptance, e.g. "must pass the ATLIB exam by January". The
-- dump's varchar(180) is kept as-is; it is the client's own sizing of a field
-- they already fill in on paper.
-- ----------------------------------------------------------------------------

ALTER TABLE `applications`
  ADD COLUMN IF NOT EXISTS `conditions_of_admission` varchar(180) NULL DEFAULT NULL
    COMMENT 'Conditions attached to an acceptance (D44, from the client dump). Free text.'
    AFTER `student_code`;


-- ============================================================================
-- 4. `applications.application_number` - APP-YYYY-NNNNN
--
-- Not in the dump. Applications have only ever been addressed by uuid, which is
-- unusable over a phone call.
--
-- NULLABLE, not NOT NULL, and deliberately so. The unique index is what actually
-- protects the format; making the column NOT NULL would mean the backfill below
-- has to succeed before the ALTER, which turns a re-runnable file into an ordered
-- one. Every row written by the application has a number - `create_application`
-- allocates before the insert - so the nullability is a migration affordance, not
-- a permitted state.
--
-- The unique index is PLAIN, not partial. Unlike `student_profiles.student_number`
-- there is no soft-delete generated-column dance here: an application is soft
-- deleted via `deleted_at` but keeps its number, and reissuing a deleted
-- application's number to a new applicant is not something anyone wants.
-- ----------------------------------------------------------------------------

ALTER TABLE `applications`
  ADD COLUMN IF NOT EXISTS `application_number` varchar(20) NULL DEFAULT NULL
    COMMENT 'Human reference, APP-YYYY-NNNNN (D44). Allocated at create from number_sequences; NULL only mid-migration.'
    AFTER `id`;

ALTER TABLE `applications`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_applsimsications_number` (`application_number`);

-- 4a. Backfill, ordered by `created_at` so the numbers follow the order the
--     applications were actually filed. Keyed on IS NULL, so it matches nothing
--     on a second run.
UPDATE `applications` a
  JOIN (
    SELECT `id`,
           CONCAT('APP-', YEAR(`created_at`), '-',
                  LPAD(ROW_NUMBER() OVER (PARTITION BY YEAR(`created_at`)
                                          ORDER BY `created_at`, `id`), 5, '0')) AS `num`
    FROM `applications`
    WHERE `application_number` IS NULL
  ) d ON d.`id` = a.`id`
SET a.`application_number` = d.`num`;

-- 4b. Point the counter at the highest number now on disk, per year, so the first
--     number the application issues is the next one and not a collision.
INSERT INTO `number_sequences` (`scope`, `seq_key`, `last_seq`)
SELECT 'application',
       CAST(YEAR(`created_at`) AS CHAR),
       MAX(CAST(SUBSTRING_INDEX(`application_number`, '-', -1) AS UNSIGNED))
FROM `applications`
WHERE `application_number` IS NOT NULL
GROUP BY YEAR(`created_at`)
ON DUPLICATE KEY UPDATE `last_seq` = GREATEST(`number_sequences`.`last_seq`, VALUES(`last_seq`));


-- ============================================================================
-- 5. `semesters.term_type` - 'independent'
--
-- APPENDED, so every existing row keeps its ordinal and no index is invalidated.
-- Lowercase, against the dump - see the header, item 1.
-- ----------------------------------------------------------------------------

SET @term_needs_independent := (
  SELECT COUNT(*) FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name`   = 'semesters'
    AND `column_name`  = 'term_type'
    AND `column_type` NOT LIKE '%independent%'
);
SET @sql := IF(@term_needs_independent = 1,
  'ALTER TABLE `semesters` MODIFY COLUMN `term_type`
     enum(''summer'',''semester'',''spring'',''independent'')
     NOT NULL DEFAULT ''semester''
     COMMENT ''BAJC term kind. Curriculum position lives on program_courses.term_label, not here. D44 appended `independent` (independent study).''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- 6. `semesters.semester_status` - from the dump, snake_cased
--
-- Landed as storage only: nothing in the API reads or writes it yet, and the
-- lifecycle it describes overlaps `is_active` and the year's archive state, so
-- wiring it up without deciding which one wins would create a second, quieter
-- source of truth for "is this term running". The column exists so the client's
-- own data loads; giving it behaviour is a separate decision.
-- ----------------------------------------------------------------------------

ALTER TABLE `semesters`
  ADD COLUMN IF NOT EXISTS `semester_status`
    enum('planning','registration_open','active','grade_submission','closed','archived')
    NOT NULL DEFAULT 'active'
    COMMENT 'D44, from the client dump. STORAGE ONLY - no API reads or writes it; `is_active` is still what decides the current term. Dump had `grade submission` with a space; snake_cased to match every other enum here.'
    AFTER `end_date`;


-- ============================================================================
-- 7. `programs` - three columns from the dump
--
-- `comments` is `text NULL` here, not the dump's `varchar(500) NOT NULL DEFAULT '1'`.
-- A NOT NULL default of the string '1' is a leftover from whatever was typed into
-- HeidiSQL to create the column, and it would put a literal 1 in the comments box
-- of all seven programmes. `student_profiles.comments` is already `text NULL`;
-- this matches it.
--
-- `head_of_dept_id` is NOT added - see the header, item 2.
-- ----------------------------------------------------------------------------

ALTER TABLE `programs`
  ADD COLUMN IF NOT EXISTS `admission_requirements` varchar(100) NULL DEFAULT NULL
    COMMENT 'D44, from the client dump. What an applicant needs to enter this programme.'
    AFTER `award`;

ALTER TABLE `programs`
  ADD COLUMN IF NOT EXISTS `graduation_requirements` varchar(100) NULL DEFAULT NULL
    COMMENT 'D44, from the client dump. What a student needs to complete it.'
    AFTER `admission_requirements`;

ALTER TABLE `programs`
  ADD COLUMN IF NOT EXISTS `comments` text NULL DEFAULT NULL
    COMMENT 'D44, from the client dump. Free-text notes on the programme. Dump had varchar(500) NOT NULL DEFAULT ''1''; that default is a stray test value.'
    AFTER `is_active`;


-- ============================================================================
-- 8. `classroom` - NEW TABLE, from the dump
--
-- Kept close to the dump's shape, including its column names (`Building`,
-- `Capacity`, `roomcode`), because this is the client's own table and renaming
-- their columns to match house style would make their dump and this database
-- disagree for no gain.
--
-- Three corrections: the redundant `KEY classroomid` on the primary key column is
-- dropped, 'Availble' is spelled, and `room_type` loses its `NOT NULL DEFAULT '0'`.
--
-- 'Active'/'Inactive' and 'In-Use'/'Available'/'Occupied' are two different
-- axes in one enum - whether the room is in service, and whether it is busy right
-- now. That is the client's design and it is preserved; the API will only ever
-- write the first pair, because the second is a function of the timetable and not
-- a fact anyone should be typing in.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `classroom` (
  `classroomid` uuid        NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `roomcode`    varchar(25) NOT NULL COMMENT 'e.g. A-101. Unique among live rooms.',
  `Building`    varchar(60) NOT NULL COMMENT 'Client column name, kept as dumped.',
  `Capacity`    int(9)      NOT NULL DEFAULT 0 COMMENT 'Seats. 0 = not recorded.',
  `room_type`   varchar(150) NULL DEFAULT NULL COMMENT 'e.g. Lecture / Lab / Computer lab. Free text.',
  `status`      enum('Active','Inactive','In-Use','Available','Occupied')
                NOT NULL DEFAULT 'Active'
                COMMENT 'Client vocabulary, dumped as-is apart from spelling Available. The API writes Active/Inactive only; the rest describe live occupancy, which the timetable knows and a person should not be typing.',
  `created_by`  uuid         NULL,
  `created_on`  datetime    NOT NULL DEFAULT current_timestamp(),
  `edited_by`   uuid         NULL,
  `edited_on`   datetime     NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`classroomid`),
  UNIQUE KEY `uq_classroom_roomcode` (`roomcode`),
  KEY `fk_classroom_created_by` (`created_by`),
  KEY `fk_classroom_edited_by` (`edited_by`),
  CONSTRAINT `fk_classroom_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_classroom_edited_by` FOREIGN KEY (`edited_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_classroom_capacity` CHECK (`Capacity` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT = 'Physical rooms (D44, from the client dump sims_10).';



ALTER TABLE `course_offerings`
  ADD COLUMN IF NOT EXISTS `classroomid` uuid NULL DEFAULT NULL
    COMMENT 'FK -> classroom. NULL = no room assigned. D44; the dump had DEFAULT uuid_v4(), which would point every existing offering at a room that does not exist.'
    AFTER `capacity`;

ALTER TABLE `course_offerings`
  ADD INDEX IF NOT EXISTS `fk_course_offerings_classroom` (`classroomid`);

-- MariaDB has no `ADD CONSTRAINT IF NOT EXISTS`, so the FK is guarded the long way.
SET @needs_classroom_fk := (
  SELECT COUNT(*) = 0 FROM `information_schema`.`table_constraints`
  WHERE `table_schema`   = DATABASE()
    AND `table_name`     = 'course_offerings'
    AND `constraint_name`= 'fk_course_offerings_classroom'
);
SET @sql := IF(@needs_classroom_fk = 1,
  'ALTER TABLE `course_offerings`
     ADD CONSTRAINT `fk_course_offerings_classroom` FOREIGN KEY (`classroomid`)
     REFERENCES `classroom` (`classroomid`) ON DELETE SET NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ====================================================================

SET @role_needs_sysadmin := (
  SELECT COUNT(*) FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name`   = 'users'
    AND `column_name`  = 'role'
    AND `column_type` NOT LIKE '%sysadmin%'
);
SET @sql := IF(@role_needs_sysadmin = 1,
  'ALTER TABLE `users` MODIFY COLUMN `role`
     enum(''principal'',''secretary'',''teacher'',''student'',''hod'',''auditor'',''sysadmin'')
     NOT NULL
     COMMENT ''principal / secretary / teacher / student / hod / auditor / sysadmin. D44 appended sysadmin as STORAGE ONLY - app.common.enums.Role has no member for it and no route accepts it.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE = @OLD_SQL_MODE;



SELECT `status`, COUNT(*) AS `rows_with_status`
FROM `applications` GROUP BY `status` ORDER BY `status`;

SELECT `application_number`, `status`, DATE(`created_at`) AS `filed`
FROM `applications` ORDER BY `application_number`;

SELECT `scope`, `seq_key`, `last_seq` FROM `number_sequences` ORDER BY `scope`, `seq_key`;

SELECT `table_name`, `column_name`, `column_type`, `is_nullable`
FROM `information_schema`.`columns`
WHERE `table_schema` = DATABASE()
  AND (
    (`table_name` = 'applications'      AND `column_name` IN ('status','application_number','conditions_of_admission'))
 OR (`table_name` = 'semesters'         AND `column_name` IN ('term_type','semester_status'))
 OR (`table_name` = 'programs'          AND `column_name` IN ('admission_requirements','graduation_requirements','comments'))
 OR (`table_name` = 'course_offerings'  AND `column_name` = 'classroomid')
 OR (`table_name` = 'users'             AND `column_name` = 'role')
  )
ORDER BY `table_name`, `column_name`;

SELECT COUNT(*) AS `classroom_table_exists`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE() AND `table_name` = 'classroom';

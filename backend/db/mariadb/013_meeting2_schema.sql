-- ============================================================================
-- 013_meeting2_schema.sql
-- D39 - reconcile `teacher_profiles` with the client's third dump, and add the
--       `religions` lookup table.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> ... -> 011 -> 012 -> **013**
-- Companion doc : docs/d39-meeting2-feedback-plan.md
-- Source dump   : Downloads/3tables.sql (HeidiSQL, 2026-08-26) - `courses`,
--                 `religions`, `teacher_profiles`
-- Verify with   : db/mariadb/verify_schema.py --expect 013
--
-- ── WHERE THIS CAME FROM ────────────────────────────────────────────────────
--
-- Meeting #2 item 10 asked for four changes to the lecturer record: add SS#, add a
-- teacher licence number (ALPHANUMERIC - the sample is `OWD-2019-00035`), rename
-- `IsPresent` to `IsEmployed`, and rename `Degree`/`Education` to `Academic
-- Qualification`. The DB person then supplied `3tables.sql` carrying those plus four
-- more columns, and a new `religions` table for item 8.
--
-- A column-by-column diff of that dump against LIVE `sims` was run before writing this
-- file. Three of its differences are NOT applied, and the reasons are the point of this
-- header - a later diff will show live and the dump disagreeing, and this is where to
-- find out whether that is a bug or a decision.
--
-- ── WHAT THE DUMP SAYS AND THIS FILE DOES NOT DO ────────────────────────────
--
-- (a) `courses`.`course_status` enum('Audit','Withdraw Passing','Withdraw Failing')
--     NOT ADDED. Audit and withdrawal are facts about ONE STUDENT'S ENROLMENT, not
--     about the course. D35 already modelled this as
--     `class_enrollments`.`enrollment_status` enum('enrolled','audit',
--     'withdraw_passing','withdraw_failing'), which is what the transcript's AU / W/P /
--     W/F notation and the GPA calculation both read. A column on `courses` could only
--     mean "BIOL1102 is withdrawn for everybody", and having two places to record the
--     same fact is how they come to disagree. Raised with the DB person.
--
-- (b) `teacher_profiles`.`academic_qualification` varchar(30)
--     ADDED AS varchar(255), not varchar(30). Thirty characters is too narrow for the
--     data that already exists: four live rows hold 31-character qualifications, e.g.
--     'M.Sc. Introduction to Sociology'. The dump's own copy of those rows shows them
--     already truncated to 'M.Sc. Introduction to Sociolog', so the width has visibly
--     cost data once. This migration RENAMES the existing `education` varchar(255)
--     rather than adding a new column, so every live value survives intact.
--
-- (c) `courses` row data
--     NOT RELOADED. All 125 rows in the dump match live exactly on (id, code); there is
--     nothing to load. The dump additionally sets `created_by` to the nil UUID
--     00000000-0000-0000-0000-000000000000, which is NOT a row in `users` - loading it
--     would violate `fk_courses_created_by`. Live keeps NULL.
--
-- Two more dump differences are deliberately not followed, for the same
-- would-reject-existing-rows reason:
--
--   * `gender` enum('male','female') - live keeps 'other' as a third value. Narrowing an
--     enum silently blanks any row holding the removed value.
--   * `address` varchar(350) - live keeps `text`. Narrowing would truncate.
--
-- And two are not followed because the dump contradicts itself:
--
--   * `ssno`, `first_name`, `last_name` are declared NOT NULL in the dump, but its own
--     INSERT supplies '' for eleven of the twelve rows. A NOT NULL column that is
--     satisfied only by the empty string is not a constraint, and it would break every
--     existing INSERT path that does not know about the column yet. All new columns
--     here are NULLable.
--
-- ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
--   §1 uses ADD COLUMN IF NOT EXISTS.
--   §2 is a RENAME, which has no IF NOT EXISTS. It is guarded on
--      information_schema so a second run is a no-op.
--   §3/§4 backfill only rows that are still NULL, so re-running cannot overwrite an
--      edit made after the first run.
--   §5 uses CREATE TABLE IF NOT EXISTS + INSERT .. ON DUPLICATE KEY UPDATE.
--
-- ── §6 IS THE ONLY DESTRUCTIVE STEP. TAKE A BACKUP FIRST. ───────────────────
--   It DELETES `teacher_profiles` staff_number '096543' (Arturo Hernandez), which the
--   client's dump does not carry and which this reconcile is instructed to follow.
--   Verified safe before writing: the row has no `user_id` login and zero
--   `class_teachers` assignments, so nothing references it. It is still a real staff
--   record, so:
--
--     db\mariadb\apply_sql.py --backup pre_013.sql
--
--   before running this file. §6 is written so a second run is a no-op.
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ============================================================================
-- 1. teacher_profiles - the eight columns the dump has and live does not
--
--    All NULLable with no default, so every existing row is untouched and no current
--    INSERT path breaks. See the header for why the dump's NOT NULLs are not followed.
-- ============================================================================
ALTER TABLE `teacher_profiles`
  ADD COLUMN IF NOT EXISTS `first_name` varchar(250) NULL DEFAULT NULL
    COMMENT 'D39. Backfilled from full_name in §3. Teachers kept a single full_name where students were split by 007; the client dump splits them, and a register sorted by surname needs the parts.'
    AFTER `full_name`,
  ADD COLUMN IF NOT EXISTS `last_name` varchar(250) NULL DEFAULT NULL
    COMMENT 'D39. Backfilled from full_name in §3.'
    AFTER `first_name`,
  ADD COLUMN IF NOT EXISTS `ssno` varchar(9) NULL DEFAULT NULL
    COMMENT 'D39 (Meeting #2 item 10, "ss#"). Belize social security number. Same width as student_profiles.ssno.'
    AFTER `last_name`,
  ADD COLUMN IF NOT EXISTS `licensenum` varchar(15) NULL DEFAULT NULL
    COMMENT 'D39 (Meeting #2 item 10, "TeacherLicense#"). ALPHANUMERIC - the sample is OWD-2019-00035, so this is never an integer.'
    AFTER `email`,
  ADD COLUMN IF NOT EXISTS `is_employed` tinyint(1) NULL DEFAULT NULL
    COMMENT 'D39 (Meeting #2 item 10, "change IsPresent to IsEmployed"). Backfilled from status in §4. `status` remains what the application filters on; this mirrors it for the client''s own reports.'
    AFTER `status`,
  ADD COLUMN IF NOT EXISTS `hire_date` datetime NULL DEFAULT NULL
    COMMENT 'D39. NULL default, not current_timestamp() as the dump has it - defaulting to now would assert every existing lecturer was hired the day this migration ran.'
    AFTER `is_employed`,
  ADD COLUMN IF NOT EXISTS `end_date` datetime NULL DEFAULT NULL
    COMMENT 'D39. NULL while employed. Same reasoning as hire_date on the default.'
    AFTER `hire_date`,
  ADD COLUMN IF NOT EXISTS `comments` varchar(500) NULL DEFAULT NULL
    COMMENT 'D39. Free-text staff note.'
    AFTER `expertise`;


-- ============================================================================
-- 2. teacher_profiles.education -> academic_qualification  (Meeting #2 item 10)
--
--    A RENAME, keeping varchar(255). Adding a new narrow column and copying would have
--    truncated the four 31-character values live already holds; see header note (b).
--
--    Guarded because RENAME COLUMN has no IF EXISTS: the whole statement is skipped
--    when `education` is already gone.
-- ============================================================================
SET @needs_rename := (
  SELECT COUNT(*) FROM `information_schema`.`columns`
  WHERE `table_schema` = 'sims'
    AND `table_name` = 'teacher_profiles'
    AND `column_name` = 'education'
);

SET @sql := IF(@needs_rename = 1,
  'ALTER TABLE `teacher_profiles`
     CHANGE COLUMN `education` `academic_qualification` varchar(255) NULL DEFAULT NULL
     COMMENT ''D39 (Meeting #2 item 10, "change column Degree/Education to Academic Qualification"). Renamed from `education`; width kept at 255 because four live values are 31 chars and the client dump''''s varchar(30) had already truncated them.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- 3. Backfill first_name / last_name from full_name
--
--    Split on the LAST space: everything before is the given name(s), everything after
--    is the surname. This mirrors what 007_student_names.sql did, and it is the same
--    trade - it gets 'Maria Reyes' right and 'Maria de la Cruz' wrong, which is why the
--    columns are additive and `full_name` remains the authoritative display value.
--
--    Only touches rows where BOTH are still NULL, so a hand-corrected split survives a
--    re-run. A full_name with no space at all gets it as the last name.
-- ============================================================================
UPDATE `teacher_profiles`
SET
  `first_name` = NULLIF(TRIM(SUBSTRING_INDEX(`full_name`, ' ', 1)), ''),
  `last_name`  = NULLIF(TRIM(SUBSTRING_INDEX(`full_name`, ' ', -1)), '')
WHERE `first_name` IS NULL
  AND `last_name` IS NULL
  AND `full_name` IS NOT NULL
  AND TRIM(`full_name`) <> '';

-- A single-word full_name puts the same token in both columns above. It is a surname.
UPDATE `teacher_profiles`
SET `first_name` = NULL
WHERE `first_name` IS NOT NULL
  AND `first_name` = `last_name`;


-- ============================================================================
-- 4. Backfill is_employed from status  (IsPresent -> IsEmployed)
--
--    `status` stays authoritative - it is what the ORM maps and what every query
--    filters on. `is_employed` is the client's spelling of the same fact, so it is
--    seeded from status here and kept in step by the application from now on.
--    Only fills NULLs, so a deliberate divergence set later is not stamped back.
-- ============================================================================
UPDATE `teacher_profiles`
SET `is_employed` = IF(`status` = 'active', 1, 0)
WHERE `is_employed` IS NULL;


-- ============================================================================
-- 5. religions - the lookup table for Meeting #2 item 8
--
--    Reproduced EXACTLY as the client's dump defines it, including the int PK and the
--    `createdon` / `createdby` / `editedby` / `editedon` spelling. That breaks this
--    schema's house convention twice over (uuid PKs; created_at / created_by with a FK
--    to users), and normally the chain would rename it the way 011 renamed the client's
--    student columns.
--
--    It is kept verbatim here because the application treats this table as a READ-ONLY
--    vocabulary: it lists the rows into a dropdown and never writes one. The client owns
--    the contents, and matching their spelling means their own tooling can maintain it
--    without a translation layer. If the application ever needs to WRITE religions, that
--    is the moment to bring it onto house convention - not before.
--
--    Note what this table is NOT: it is not a foreign key. `student_profiles`.`religion`
--    stays varchar(100) free text, because rows imported from the client's previous
--    system hold values this list does not carry and a FK would reject them. D37 settled
--    this shape for gender and school year - constrain the WRITE PATH, not the column.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `religions` (
  `id` int(9) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `code_name` varchar(10) DEFAULT NULL,
  `createdon` datetime NOT NULL,
  `createdby` varchar(50) NOT NULL,
  `editedby` varchar(50) DEFAULT NULL,
  `editedon` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='D39 (Meeting #2 item 8). Read-only vocabulary for the Religion dropdown. Client-owned; NOT referenced by a FK - student_profiles.religion stays free text.';

INSERT INTO `religions` (`id`, `name`, `code_name`, `createdon`, `createdby`)
VALUES
  (1, 'Catholic', 'CATH', '2026-08-24 18:59:48', 'admin'),
  (2, 'Seventh Day Adventist', 'SDA', '2026-08-24 19:00:26', 'admin')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `code_name` = VALUES(`code_name`);


-- ============================================================================
-- 6. DESTRUCTIVE - remove the staff row the client's dump does not carry
--
--    Live has 13 lecturers; the dump has 12. The extra one is staff_number '096543'
--    (Arturo Hernandez). The reconcile is instructed to follow the dump.
--
--    Checked before writing this: the row has `user_id` NULL (no login to orphan) and
--    zero rows in `class_teachers` (no course assignment to break). `class_teachers`
--    .`teacher_id` is the only FK into this table, so the delete cannot cascade.
--
--    Deliberately NOT a TRUNCATE-and-reload of the whole table, which is the literal
--    reading of "drop the data and use the data in this sql": the dump's other twelve
--    rows carry the SAME ids as live, so reloading them is an in-place update, while a
--    truncate would have destroyed 23 `class_teachers` assignments pointing at them.
--    Deleting one row achieves what the dump asks and nothing more.
-- ============================================================================
DELETE FROM `teacher_profiles`
WHERE `staff_number` = '096543'
  AND `user_id` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `class_teachers` ct WHERE ct.`teacher_id` = `teacher_profiles`.`id`
  );


SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
SET SESSION sql_mode = @OLD_SQL_MODE;

-- ============================================================================
-- 011_client_schema_reconcile.sql
-- D34 - reconcile `student_profiles` with the client's own current schema.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> ... -> 009 -> 010 (drops) -> **011**
-- Companion doc : docs/d34-client-schema-reconcile-plan.md
-- Verify with   : db/mariadb/apply_sql.py --check
--
-- ── WHERE THIS CAME FROM ────────────────────────────────────────────────────
--
-- The client supplied a HeidiSQL dump of THEIR `student_profiles` (plus `courses` and
-- `programs`), which has moved on from the `sims.sql` this repo was built against. A
-- column-by-column diff against the live database found:
--
--   * 10 columns present in their dump and absent from live under ANY spelling  -> §1
--   * `yearofstudy` carrying a 'Summer' value live has in neither of its two
--     successor columns                                                          -> §2
--   * a DIFFERENT `status` vocabulary, with their own comment explaining it       -> §3
--
-- Everything else that looked new was a RENAME the migration chain had already done and
-- is deliberately NOT re-added. Recorded here so the next person diffing the two does
-- not mistake a rename for a missing column:
--
--     their dump          live (authoritative)         who renamed it
--     -----------------   --------------------------   --------------
--     studentnumber       student_number  (text)        001 / 007
--     civicstatus         civil_status                  005
--     sufferhealth Y/N    has_health_condition tinyint  005
--     atlibexam    Y/N    atlib_exam           tinyint  005
--     mothername          mother_name                   005
--     fathername          father_name                   005
--     parentphone         guardian_phone                sims.sql
--     parentemail         guardian_email                sims.sql
--     ctv                 city_town_village             005
--     programid  var(8)   program_id  uuid + FK         005  (a varchar(8) could never
--                                                            have joined programs.id)
--     yearofstudy         year_of_study + enrollment_load  D30 §D11 (one column could
--                                                            answer neither question)
--     createdby/on        created_by (uuid FK)/created_at  sims.sql
--     editedby/on         updated_by (uuid FK)/updated_at  sims.sql
--
-- Four columns are LIVE-ONLY and are kept: `address` (printed verbatim on letters and
-- report cards), `guardian_name`, `health_condition_note`, `application_id`.
--
-- Two columns in §1 are added ON THE CLIENT'S INSTRUCTION despite not fitting the live
-- model, and are flagged rather than silently accepted - see the notes on
-- `educationbg_id` and `doc_id`.
--
-- ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
--   §1 uses ADD COLUMN IF NOT EXISTS.
--   §2 and §3 are ENUM widenings, which MariaDB has no IF NOT EXISTS for. Both are
--   guarded on `information_schema.columns.column_type` so a second run is a no-op, and
--   §3's data migration is written so re-running it cannot re-map an already-mapped row.
--
-- ── §3 IS THE ONLY DESTRUCTIVE STEP. TAKE A BACKUP FIRST. ───────────────────
--   It REWRITES `student_profiles.status` on every row that reads 'active' or 'inactive'.
--   The mapping is one-way (there is no way to tell a row that was always 'Registered'
--   from one that used to be 'active' afterwards), so:
--
--       python db/mariadb/apply_sql.py --backup pre_011.sql
--       mysqldump --no-create-info sims student_profiles > pre_011_students.sql
--
--   `--backup` is SCHEMA ONLY. The second command is the one that saves the rows.
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ============================================================================
-- 1. student_profiles - the ten columns the client's dump has and live did not
--
--    All nullable with no default, so every one of the existing rows is untouched and
--    the application's behaviour is unchanged until the code reads them.
--
--    House snake_case is used for the five the client spelled as one word
--    (`studentid_original`, `transferedfrom`, `graduationdate`, `dropoutdate`,
--    `dropoutreason`). The chain's rule is that EXISTING identifiers are preserved and
--    NEW ones follow house style - and `transferedfrom` is additionally a misspelling of
--    "transferred", which is not worth casting in a column name. The mapping is recorded
--    in the COMMENT on each column so a diff against the client's dump still reconciles.
-- ============================================================================
ALTER TABLE `student_profiles`
  ADD COLUMN IF NOT EXISTS `student_id_original` int(8) NULL DEFAULT NULL
    COMMENT 'D34 (client dump: studentid_original). The student ID this record carried in the system it was imported from; NULL for anyone registered here.'
    AFTER `student_number`,

  -- The student's OWN email. Live had none at all: `StudentDetail.email` was derived
  -- from the linked `users` row (D33), which is NULL for anyone with no login - so a
  -- paper registration had nowhere to record an address the office could actually write
  -- to. This column is that place, and it is independent of the login.
  ADD COLUMN IF NOT EXISTS `email` varchar(254) NULL DEFAULT NULL
    COMMENT 'D34. The student''s own email address, independent of any login on `users`. NOT the login: see users.email for that.'
    AFTER `phone`,

  ADD COLUMN IF NOT EXISTS `transferred_from` varchar(250) NULL DEFAULT NULL
    COMMENT 'D34 (client dump: transferedfrom). The institution a transfer student came from. Free text.'
    AFTER `email`,

  -- Stamped automatically by `change_student_status` on a move to `graduated`, and
  -- editable afterwards. Without that the column would be permanently NULL, which is
  -- what happened to `report_card_snapshots.storage_key`.
  ADD COLUMN IF NOT EXISTS `graduation_date` date NULL DEFAULT NULL
    COMMENT 'D34 (client dump: graduationdate). Set when status becomes `graduated`. NULL for everyone else.'
    AFTER `transferred_from`,

  ADD COLUMN IF NOT EXISTS `dropout_date` datetime NULL DEFAULT NULL
    COMMENT 'D34 (client dump: dropoutdate). Set when status becomes `DropOut`. NULL for everyone else.'
    AFTER `graduation_date`,

  ADD COLUMN IF NOT EXISTS `dropout_reason` varchar(250) NULL DEFAULT NULL
    COMMENT 'D34 (client dump: dropoutreason). Why the student left. Free text.'
    AFTER `dropout_date`,

  ADD COLUMN IF NOT EXISTS `comments` text NULL DEFAULT NULL
    COMMENT 'D34. Registrar''s free-text notes on the record. Not shown to the student.'
    AFTER `dropout_reason`,

  ADD COLUMN IF NOT EXISTS `origin` varchar(50) NULL DEFAULT NULL
    COMMENT 'D34. Where this record came from (e.g. an import batch, a migration, `admissions`). Free text.'
    AFTER `comments`,

  -- ⚠️ ADDED ON THE CLIENT'S INSTRUCTION, WITH NO FOREIGN KEY, because there is nothing
  -- to point it at. Prior education in this system is APPLICATION-scoped
  -- (`application_education.application_id`) - a student has no education-background row
  -- of their own, by design: the application is a frozen record of what was declared.
  -- Left as a bare uuid so the client's own tooling has the column it expects. Nothing in
  -- the API reads or writes it yet; see the plan doc.
  ADD COLUMN IF NOT EXISTS `educationbg_id` uuid NULL DEFAULT NULL
    COMMENT 'D34 (client dump). Client-requested. NO FK: there is no student-level education table - prior education is application-scoped via application_education. Unused by the API.'
    AFTER `origin`,

  -- ⚠️ ADDED ON THE CLIENT'S INSTRUCTION, and it cannot be a foreign key either:
  -- `student_documents.id` is a uuid, not an int. It is also a scalar where the relation
  -- is 1:N - a student's documents are `student_documents WHERE student_id = ?` - so this
  -- can hold at most one of them and cannot say which. Kept for the client's tooling.
  ADD COLUMN IF NOT EXISTS `doc_id` int(11) NULL DEFAULT NULL
    COMMENT 'D34 (client dump). Client-requested. NO FK: student_documents.id is uuid, not int, and documents are 1:N via student_documents.student_id. Unused by the API.'
    AFTER `educationbg_id`;


-- ============================================================================
-- 2. student_profiles.enrollment_load - add 'Summer'
--
--    The client's `yearofstudy` enum is
--        ('Summer','First','Second','Part Time','Full Time','Transient')
--    which conflates the YEAR ('First','Second') with the LOAD ('Part Time','Full Time',
--    'Transient'); D30 §D11 split those into two columns precisely because one could
--    answer neither question.
--
--    'Summer' is neither a year nor, strictly, a load - it names a TERM. It goes on
--    `enrollment_load` because that is where 'Transient' lives and it answers the same
--    question ("how is this student attending"), and because putting it on
--    `year_of_study` would make "which year are they in" unanswerable for a summer
--    student, which is the exact defect the split fixed.
--
--    Guarded: re-running is a no-op once 'Summer' is present.
-- ============================================================================
SET @load_needs_summer := (
  SELECT COUNT(*) FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name`  = 'student_profiles'
    AND `column_name` = 'enrollment_load'
    AND `column_type` NOT LIKE '%Summer%'
);
SET @sql := IF(@load_needs_summer = 1,
  'ALTER TABLE `student_profiles` MODIFY COLUMN `enrollment_load`
     enum(''Part Time'',''Full Time'',''Transient'',''Summer'') NULL DEFAULT NULL
     COMMENT ''Study load (D30 §D11). D34 added Summer from the client dump''''s yearofstudy enum.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- 3. student_profiles.status - adopt the client's vocabulary
--
--    Their enum, with their own comment on it:
--
--      Registered    "instead of active"
--      Unregistered  "when student do not continue further semesters, but has
--                     successfully completed the last semester"
--      DropOut       (new state; pairs with dropout_date / dropout_reason in §1)
--      graduated     "Dean/Registrar are the only ones with access to change to this
--                     status"  -- already true: POST /students/{id}/status is
--                                 require_role(PRINCIPAL, SECRETARY), i.e. Dean+Registrar
--      transferred   unchanged
--      withdrawn     unchanged
--
--    NOTE THE MIXED CASE. Three values are TitleCase and three are lowercase. That is
--    exactly how the client's dump reads, and the dump is the authority for this column,
--    so it is reproduced rather than tidied - normalising it would put the DB and their
--    tooling out of step for a cosmetic gain. The collation is
--    `utf8mb4_uca1400_ai_ci`, which is case-INSENSITIVE, so a query for 'registered'
--    still matches 'Registered'; the case matters for what is STORED and echoed, not for
--    comparison.
--
--    THREE STEPS, and the order is load-bearing. MariaDB will not let a row hold a value
--    the enum does not list, so the column must accept both vocabularies before any row
--    can be moved between them.
-- ============================================================================

-- 3a. Widen to the UNION of both vocabularies. No row changes.
SET @status_needs_migration := (
  SELECT COUNT(*) FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name`  = 'student_profiles'
    AND `column_name` = 'status'
    AND `column_type` NOT LIKE '%Registered%'
);
SET @sql := IF(@status_needs_migration = 1,
  'ALTER TABLE `student_profiles` MODIFY COLUMN `status`
     enum(''active'',''inactive'',''Registered'',''Unregistered'',''DropOut'',
          ''transferred'',''graduated'',''withdrawn'')
     NOT NULL DEFAULT ''active''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3b. Migrate the rows. Idempotent by construction: after this runs there is no row left
--     reading 'active'/'inactive', so a second run matches nothing.
UPDATE `student_profiles` SET `status` = 'Registered'   WHERE `status` = 'active';
UPDATE `student_profiles` SET `status` = 'Unregistered' WHERE `status` = 'inactive';

-- 3c. Narrow to the final vocabulary. This is what makes the old values unstorable, so it
--     must come after 3b or it fails with "Data truncated for column 'status'".
SET @sql := IF(@status_needs_migration = 1,
  'ALTER TABLE `student_profiles` MODIFY COLUMN `status`
     enum(''Registered'',''Unregistered'',''DropOut'',''transferred'',''graduated'',''withdrawn'')
     NOT NULL DEFAULT ''Registered''
     COMMENT ''D34, client vocabulary. Registered=enrolled. Unregistered=completed the last semester but is not continuing. DropOut=left mid-programme (see dropout_date/reason). graduated/transferred/withdrawn unchanged. Only Dean+Registrar may set graduated.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- 4. VERIFY (reads only - safe to re-run on its own)
-- ============================================================================
SELECT `status`, COUNT(*) AS rows_with_status
FROM `student_profiles`
GROUP BY `status`
ORDER BY `status`;

SELECT `column_name`, `column_type`, `is_nullable`
FROM `information_schema`.`columns`
WHERE `table_schema` = DATABASE()
  AND `table_name` = 'student_profiles'
  AND `column_name` IN (
    'student_id_original','email','transferred_from','graduation_date','dropout_date',
    'dropout_reason','comments','origin','educationbg_id','doc_id','status','enrollment_load'
  )
ORDER BY `column_name`;


SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
SET SESSION sql_mode = @OLD_SQL_MODE;

-- ============================================================================
-- 5. AFTERWARDS
--
--    The COMPANION CODE IS REQUIRED for §3. Unlike `009`, this file cannot be applied
--    ahead of the application: the moment §3c lands, a backend still carrying
--    StudentStatus.ACTIVE = "active" cannot write a status at all, and every
--    `status == 'active'` filter (the dashboard's active-student count, the enrollable
--    -student picker, the transcript's cohort) silently matches ZERO rows rather than
--    failing. Apply this together with the D34 backend + frontend change, not before it.
--
--    Then: db/mariadb/apply_sql.py --check, and re-run the backend suite.
-- ============================================================================

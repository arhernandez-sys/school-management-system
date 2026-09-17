USE sims;


-- ── 1. the rename ──────────────────────────────────────────────────────────
SET @old_exists := (
    SELECT COUNT(*)
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'student_profile_temp'
);

SET @new_exists := (
    SELECT COUNT(*)
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'application_temp'
);

--  Both branches are plain SELECT/RENAME TABLE, which MariaDB allows in a
--  prepared statement. (DO is not on that list, so it is deliberately not used.)
SET @sql := IF(
    @old_exists = 1 AND @new_exists = 0,
    'RENAME TABLE `student_profile_temp` TO `application_temp`',
    'Ssims_testELECT ''Nothing to do: already renamed, or the old table is not here.'' AS note'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ── 2. confirm ─────────────────────────────────────────────────────────────
--  Expect exactly one row: application_temp, with the row count it had before.
SELECT TABLE_NAME,
       TABLE_ROWS AS approx_rows,
       TABLE_COLLATION
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('student_profile_temp', 'application_temp');

--  Expect eight rows, all carried across untouched: one PRIMARY KEY, four FOREIGN
--  KEYs (fk_apptemp_created_by / program / updated_by / year) and three CHECKs
--  (ck_apptemp_num_csec / education_json / documents_json). Nothing needs renaming
--  afterwards — they were already named *_apptemp_*, which is part of why the table
--  name being wrong went unnoticed for so long.
SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'application_temp'
 ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME;


-- ── 3. AFTERWARDS ──────────────────────────────────────────────────────────
--  `backend/db/mariadb/sims_final.sql` has been edited by hand to match, so a
--  rebuild from the dump creates `application_temp` directly. If you re-dump
--  `sims` from HeidiSQL after running this, the new dump will already be correct
--  and can simply replace it.

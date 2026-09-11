-- ═══════════════════════════════════════════════════════════════════════════
--  RENAME  student_profile_temp  →  application_temp
--  Run against: sims   (HeidiSQL, or `mysql -u root -p sims < this file`)
--  Written: 11 Sep 2026
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WHY
--  ───
--  The table never held a student profile. It holds an APPLICATION that has been
--  saved but not yet submitted — the applicant is not a student, and may never
--  become one. The name was a mistake made when D38 introduced the holding table,
--  and it has been misleading every reader since. Everything else already said
--  "application temp": the ORM class is `ApplicationTemp`, every index and
--  constraint is named `fk_apptemp_*` / `ck_apptemp_*`, the audit trail writes
--  `entity_type = 'application_temp'`, and even the D38 migration that created the
--  table was called `012_application_temp.sql`. The table name was the only thing
--  still saying "student profile", which is exactly why it lasted this long.
--
--  WHAT THIS TOUCHES
--  ─────────────────
--  Only the table's name. MariaDB carries the columns, the primary key, all four
--  indexes and all seven constraints across a RENAME unchanged, and — because they
--  are already `*_apptemp_*` — none of them need renaming afterwards.
--
--  Nothing anywhere in the schema has a foreign key POINTING AT this table: it is
--  a holding area that is read once and deleted on submit, so there is no inbound
--  reference to repoint. That is what makes this a one-statement change rather
--  than a migration.
--
--  Rows are preserved. A RENAME is a catalogue operation, not a copy.
--
--  THE CODE IS ALREADY ON THE NEW NAME
--  ───────────────────────────────────
--  `ApplicationTemp.__tablename__` was changed to `application_temp` in the same
--  change set as this file. So between now and running this, the admissions
--  pending-forms endpoints will fail with "Table 'sims.application_temp' doesn't
--  exist". Run this before using them again.
--
--  RE-RUNNABLE
--  ───────────
--  Guarded: if the rename has already happened (or the old table was never there),
--  it does nothing rather than erroring.


-- ── 0. make sure you are on the right database ─────────────────────────────
--  Everything below uses DATABASE(), so pick one explicitly rather than relying
--  on whatever HeidiSQL happens to have selected.
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

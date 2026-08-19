-- ============================================================================
-- 007_student_names.sql
-- D30 Phase 1 — retire `student_profiles.full_name`; the split name parts become
-- the only stored truth (plan §D10, brief §11).
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> **007**
-- Companion doc : docs/tertiary-refactor-plan.md §D10
--
-- ⚠️ APPLY THIS FILE IN THE SAME STEP AS THE PHASE 1 ORM CHANGE.
--
--   Same rule that governs `006`, for the same reason. `005` added the name parts and
--   backfilled them but DELIBERATELY left `full_name` in place, because the running ORM
--   still wrote it and `student_profiles.full_name` is NOT NULL — dropping the column
--   while `StudentProfile.full_name` was still a mapped column would have made every
--   student INSERT fail. The code side that must land with this file:
--
--     * `StudentProfile.full_name` (mapped column) -> `first_name`/`middle_name`/
--       `last_name` mapped onto the existing `firstname`/`middlename`/`lastname`
--       columns, plus a `full_name` HYBRID PROPERTY that concatenates them
--     * every student listing ordered by `lastname`, `firstname` — never by a
--       combined display string
--     * `app/db/seed.py`, `db/mariadb/seed_demo.py`, `010_seed_demo.sql` and
--       `tests/conftest.py`, all of which INSERT `full_name`
--
--   NOTE: the header of `005` and plan §E say "`006` drops it". `006` was later
--   claimed by the courses cutover, so the drop is here in `007`. The plan is
--   updated to match.
--
-- ---------------------------------------------------------------------------
-- WHY `firstname` STAYS NULLABLE AND ONLY `lastname` IS TIGHTENED
--
--   `005` §9 backfills the parts from `full_name` and then deliberately sets
--   `firstname = NULL` for SINGLE-WORD names, keeping the sole token as the
--   `lastname` — because that is what listings sort on. Making `firstname` NOT NULL
--   would contradict that and fail on any such row.
--
--   So the DATABASE requires a surname and tolerates a missing given name (legacy
--   rows), while the API requires both: `StudentCreateRequest.first_name` and
--   `.last_name` are required fields, so nothing new can be created without one.
--   Strict where new data enters, permissive where old data already lives.
--
--   On this repo-provisioned database the tightening is a no-op — all 45 students
--   have both parts and 0 have a NULL surname (verified 2026-08-16).
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCY
--
--   Re-runnable. `IF EXISTS` / `IF NOT EXISTS` throughout, and the defensive re-split
--   below only touches rows that are not yet split. Once `full_name` is gone the
--   re-split statements are skipped entirely — see the guard.
--
--   NOT DROPPED, deliberately: nothing but `full_name`. `ix_student_profiles_lastname`
--   already exists (created by `005` §9) and backs the new ordering, so no index is
--   added here.
-- ============================================================================

SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ----------------------------------------------------------------------------
-- 1. Defensive re-split.
--
-- A no-op here (0 rows), but this file must also be safe on the stakeholder's
-- database, where `005` may have been applied to rows that were edited afterwards.
-- Identical logic to `005` §9 so the two files cannot disagree.
--
-- Wrapped in a prepared statement guarded on the existence of `full_name`: on a
-- re-run of `007` the column is already gone and a bare UPDATE would be a 1054.
-- ----------------------------------------------------------------------------
SET @has_full_name = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'student_profiles'
    AND COLUMN_NAME = 'full_name'
);

SET @sql = IF(@has_full_name = 1, '
  UPDATE `student_profiles`
  SET
    `firstname` = TRIM(SUBSTRING_INDEX(TRIM(`full_name`), '' '', 1)),
    `lastname`  = TRIM(SUBSTRING_INDEX(TRIM(`full_name`), '' '', -1)),
    `middlename` = NULLIF(TRIM(
        SUBSTRING(
          TRIM(`full_name`),
          CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), '' '', 1)) + 2,
          GREATEST(
            CHAR_LENGTH(TRIM(`full_name`))
              - CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), '' '', 1))
              - CHAR_LENGTH(SUBSTRING_INDEX(TRIM(`full_name`), '' '', -1)) - 2,
            0)
        )
    ), '''')
  WHERE (`lastname` IS NULL OR TRIM(`lastname`) = '''')
    AND `full_name` IS NOT NULL
    AND TRIM(`full_name`) <> ''''
', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Single-word names: the split above puts the same token in both slots. Keep it as
-- the lastname and clear the firstname (same rule as `005` §9).
SET @sql = IF(@has_full_name = 1, '
  UPDATE `student_profiles`
  SET `firstname` = NULL
  WHERE `firstname` = `lastname`
    AND TRIM(`full_name`) NOT LIKE ''% %''
', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Last resort for a row with no usable name at all: `lastname` is about to become
-- NOT NULL, and MariaDB with a permissive sql_mode would silently coerce NULL to ''.
-- Make that explicit and visible rather than implicit, so the Registrar can find and
-- fix the row by searching for the marker.
UPDATE `student_profiles`
SET `lastname` = CONCAT('UNKNOWN-', LEFT(REPLACE(CAST(`id` AS char), '-', ''), 8))
WHERE `lastname` IS NULL OR TRIM(`lastname`) = '';


-- ----------------------------------------------------------------------------
-- 2. The surname becomes mandatory. The given name does not — see the header.
-- ----------------------------------------------------------------------------
ALTER TABLE `student_profiles`
  MODIFY COLUMN `lastname` varchar(50) NOT NULL
    COMMENT 'Family name. Listings sort on (lastname, firstname) - D30 §D10.';

ALTER TABLE `student_profiles`
  MODIFY COLUMN `firstname` varchar(50) NULL
    COMMENT 'Given name. NULL only for legacy single-token names; the API requires it.';


-- ----------------------------------------------------------------------------
-- 3. Drop `full_name`.
--
-- No data is lost: `CONCAT_WS('' '', firstname, middlename, lastname) = full_name`
-- held on all 45 rows before this ran (verified 2026-08-16), and the ORM's
-- `full_name` hybrid property reproduces exactly that expression — in Python for a
-- loaded instance and as `concat_ws` in SQL, so `.ilike()` searching still works.
-- ----------------------------------------------------------------------------
ALTER TABLE `student_profiles`
  DROP COLUMN IF EXISTS `full_name`;


SET SESSION sql_mode = @OLD_SQL_MODE;

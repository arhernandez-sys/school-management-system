-- ============================================================================
-- 010_drop_legacy_pre_d31.sql
-- D32 §7 - retire the seven D31 quarantine tables.
--
-- Target engine : MariaDB 12.3.2
-- Run order     : after 009. Independent of it; ordering only matters within THIS file.
-- Companion doc : docs/midterm-revision-reports-plan.md §A5 (the full audit table)
-- Audit date    : 2026-08-21, against the live `sims`
--
-- ############################################################################
-- ##  EXECUTED 2026-08-23 (D34). ALL SEVEN TABLES ARE GONE.                 ##
-- ##                                                                        ##
-- ##  The operator gave the go-ahead for all seven ("remove all legacy      ##
-- ##  tables it is not needed"), including the two populated ones. Before   ##
-- ##  the drops:                                                            ##
-- ##    * schema AND all 144 rows were dumped (--backup is schema-only, so  ##
-- ##      the 133 rows of pre-D31 homeroom history needed a real dump);     ##
-- ##    * S1's pre-flight was run and REQUIRED to confirm - four tables     ##
-- ##      empty, all 11 subjects rows verified present in `courses` under   ##
-- ##      the same ids, and 0 live tables holding an FK into any of them.   ##
-- ##  After: 46 tables -> 39, which is the ORM's own table count.           ##
-- ##                                                                        ##
-- ##  ONE TEST FIRED, exactly as S4 below said it would:                    ##
-- ##  test_courses.py::test_the_catalog_row_lives_in_courses_and_subjects_  ##
-- ##  is_retired asserted "the quarantined copy must be KEPT, never         ##
-- ##  dropped". That assertion is now INVERTED to require its absence.      ##
-- ##                                                                        ##
-- ##  THE STATEMENTS BELOW REMAIN COMMENTED OUT. They are a record of what  ##
-- ##  was run, not something to run again - a plain DROP on a table that is ##
-- ##  already gone fails, which is the point (see S2's note).               ##
-- ##                                                                        ##
-- ##  ---- original header, still true of the file as written ----          ##
-- ##  EVERY STATEMENT IN THIS FILE IS COMMENTED OUT.                        ##
-- ##                                                                        ##
-- ##  Applying it as-is does NOTHING, deliberately. A DROP TABLE cannot be  ##
-- ##  rolled back and cannot be re-run, so the decision to execute is the   ##
-- ##  operator's and BAJC's, not the migration chain's. Uncomment §2 (and   ##
-- ##  only §2) once the go-ahead is given.                                  ##
-- ##                                                                        ##
-- ##  BEFORE UNCOMMENTING ANYTHING:                                         ##
-- ##      python db/mariadb/apply_sql.py --backup pre_010.sql               ##
-- ##  `--backup` writes SHOW CREATE TABLE for every table. That is the      ##
-- ##  SCHEMA only - it does NOT contain the 133 rows in §3. If those rows   ##
-- ##  are wanted, dump them separately with mysqldump first.                ##
-- ############################################################################
--
-- ── HOW THE AUDIT WAS DONE ──────────────────────────────────────────────────
--
--   1. Every `__tablename__` in `backend/app/modules/*/models.py` was compared against
--      the live table list. The sets match exactly apart from the seven below, so the
--      ORM references none of them.
--   2. The only raw SQL anywhere in `backend/app` is `SELECT 1` in `db/session.py`, so
--      an ORM sweep is a COMPLETE reference sweep - there is no second query surface
--      hiding a reference.
--   3. `information_schema`: **no live table holds a foreign key INTO any of these**.
--      The single inbound FK is legacy-to-legacy
--      (`class_subjects_legacy_pre_d31.class_id -> classes_legacy_pre_d31`), which only
--      dictates the drop ORDER in §2/§3.
--   4. The database contains **0 views, 0 stored routines and 0 triggers**, so there is
--      no procedural code referencing them either.
--   5. The frontend and the OpenAPI surface mention none of them.
--
-- ── WHAT KEEPING THEM COSTS ─────────────────────────────────────────────────
--
--   Not nothing, which is worth stating plainly. The two populated join tables hold
--   OUTBOUND foreign keys onto LIVE tables:
--
--       classes_legacy_pre_d31       -> users, academic_years
--       class_subjects_legacy_pre_d31 -> users, academic_years, courses
--
--   So a retired 2024-era join row can still block the deletion of a live `courses` row
--   or a live `users` row. That is a real operational snag rather than a purely cosmetic
--   one, and it is the argument for eventually dropping the two populated tables too.
--
-- ── VERDICTS (full table in the plan doc §A5) ───────────────────────────────
--
--   SAFE TO REMOVE (5)
--     grades_legacy_pre_d31           0 rows   superseded by assessment_grades
--     staff_legacy_pre_d31            0 rows   superseded by teacher_profiles
--     students_legacy_pre_d31         0 rows   superseded by student_profiles
--     cat_assessment_legacy_pre_d31   0 rows   superseded by assessment_categories
--     subjects_legacy_pre_d31        11 rows   VERIFIED FULLY MIGRATED - all 11 rows
--                                              exist in `courses` under the SAME id and
--                                              the SAME code (checked 2026-08-21). The
--                                              plan doc originally listed this as
--                                              "requires investigation"; the check was
--                                              done and it passed, so it moved up.
--
--   REQUIRES A DECISION (2) - safe as CODE, but they still hold data
--     classes_legacy_pre_d31         17 rows   the K-12 homerooms. D31 DELETED the
--                                              operational data rather than migrating it,
--                                              so these 17 rows are the only surviving
--                                              evidence that the homeroom era existed.
--     class_subjects_legacy_pre_d31 116 rows   the homeroom-to-subject join, collapsed
--                                              into course_offerings.course_id.
--
--   CANNOT REMOVE: none.
-- ============================================================================


-- ============================================================================
-- 1. PRE-FLIGHT (safe to run - reads only)
--
--    Run this BEFORE uncommenting anything and confirm the counts match the verdicts
--    above. A non-zero count on one of the four "empty" tables means the audit is stale
--    and the whole file needs re-deriving, not editing.
-- ============================================================================
SELECT
  (SELECT COUNT(*) FROM `grades_legacy_pre_d31`)         AS grades_rows,
  (SELECT COUNT(*) FROM `staff_legacy_pre_d31`)          AS staff_rows,
  (SELECT COUNT(*) FROM `students_legacy_pre_d31`)       AS students_rows,
  (SELECT COUNT(*) FROM `cat_assessment_legacy_pre_d31`) AS cat_assessment_rows,
  (SELECT COUNT(*) FROM `subjects_legacy_pre_d31`)       AS subjects_rows,
  (SELECT COUNT(*) FROM `classes_legacy_pre_d31`)        AS classes_rows,
  (SELECT COUNT(*) FROM `class_subjects_legacy_pre_d31`) AS class_subjects_rows;

-- Re-verify the `subjects` migration claim. MUST return 0 rows; anything back means a
-- legacy subject is NOT in `courses` and §2's last DROP must not be run.
SELECT s.`id`, s.`name`, s.`code`
FROM `subjects_legacy_pre_d31` s
LEFT JOIN `courses` c ON c.`id` = s.`id`
WHERE c.`id` IS NULL;


-- ============================================================================
-- 2. THE SAFE DROPS (5 tables) - UNCOMMENT ONLY AFTER §1 CONFIRMS AND A BACKUP EXISTS
--
--    Four are empty. `subjects_legacy_pre_d31` is not, but its rows are duplicated into
--    `courses` under the same primary keys, so nothing is lost.
--
--    No `IF EXISTS` guard is used on purpose: this file is a one-shot operator action,
--    not part of the re-runnable chain, and a plain DROP failing loudly on a table that
--    is already gone is better than a silent no-op that hides a half-applied run.
-- ============================================================================
-- DROP TABLE `grades_legacy_pre_d31`;
-- DROP TABLE `staff_legacy_pre_d31`;
-- DROP TABLE `students_legacy_pre_d31`;
-- DROP TABLE `cat_assessment_legacy_pre_d31`;
-- DROP TABLE `subjects_legacy_pre_d31`;


-- ============================================================================
-- 3. THE TWO POPULATED TABLES - NOT RECOMMENDED WITHOUT BAJC'S SIGN-OFF
--
--    133 rows of pre-D31 history. No code reads them, but "no code reads it" and "nobody
--    wants it" are different claims and only BAJC can make the second.
--
--    ORDER MATTERS: `class_subjects_legacy_pre_d31.class_id` is a foreign key onto
--    `classes_legacy_pre_d31`, so the child goes first. Dropping the parent first fails
--    with errno 150 rather than cascading.
--
--    If they are to go, dump the ROWS first - `apply_sql.py --backup` captures schema
--    only:
--        mysqldump --no-create-info sims classes_legacy_pre_d31 \
--            class_subjects_legacy_pre_d31 > legacy_pre_d31_rows.sql
-- ============================================================================
-- DROP TABLE `class_subjects_legacy_pre_d31`;
-- DROP TABLE `classes_legacy_pre_d31`;


-- ============================================================================
-- 4. AFTERWARDS
--
--    python db/mariadb/apply_sql.py --check
--
--    Expect 46 tables to become 41 (after §2) or 39 (after §2 and §3). 39 is the ORM's
--    own table count, so that is the number at which the database holds exactly what the
--    application models and nothing else.
--
--    Then re-run the backend suite. It does not touch these tables, so it should be
--    unaffected - and if it is not, that is precisely the signal this audit was for.
-- ============================================================================

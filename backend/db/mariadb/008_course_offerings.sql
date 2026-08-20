-- ============================================================================
-- 008_course_offerings.sql
-- D31 - collapse the K-12 offering layer into a tertiary one.
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci)
-- Run order     : sims.sql -> 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> **008**
-- Companion doc : docs/tertiary-offerings-refactor-plan.md (Phase 1)
-- Verify with   : db/mariadb/verify_schema.py
--
-- WARNING - THIS FILE DELETES OPERATIONAL DATA. READ SECTION 2 BEFORE RUNNING.
--
-- ⚠️ DO NOT APPLY THIS FILE ON ITS OWN.
--
--   Like `006`, it must land in the SAME STEP as the code that expects it (Phase 2-4:
--   `CourseOffering` replacing `Class`/`ClassSubject`, `offering_id` on the wire). Apply
--   the DDL alone and every offering write fails. `006`'s header records what happened
--   the one time that rule was broken; `005` §2b records what happened when a migration
--   tried to defend itself against a later one instead.
--
-- WHAT IS WRONG WITH THE OLD MODEL
--
--   1. `classes` is scoped to an academic YEAR (`academic_year_id`) and has no
--      `semester_id`. That is the homeroom assumption: a Form 1A lasts a school year. A
--      tertiary offering is a SEMESTER thing - "Programming I, Semester 1 2026" and
--      "Programming I, Semester 2 2026" are two different offerings, and under the old
--      shape they could only be told apart by two same-year rows with different names.
--      Note that `class_enrollments`, `assessments` and `term_grade_snapshots` ALL carry
--      `semester_id` already: the term was tracked everywhere except on the thing being
--      offered.
--
--   2. `classes.grade_level varchar(50) NOT NULL` held `Form 1`..`Form 4`, so every
--      offering had to declare a Form. With it went `section varchar(2)` (the homeroom
--      letter), `homeroom_label`, `numStudents` (a denormalised count) and
--      `classStaffID int(11)` (a legacy int FK pointing at nothing).
--
--   3. `class_subjects` was a many-to-many that only made sense when one homeroom taught
--      seven subjects - every one of the 17 live `classes` rows had ~7 courses attached.
--      One offering teaches ONE course, so the join table becomes a column.
--
-- WHAT REPLACES IT
--
--   `course_offerings` = one course, in one semester, optionally sectioned. It absorbs
--   `classes` and `class_subjects` in one table, and every child that used to hang off
--   `class_subject_id` (or `class_id`) now hangs off `offering_id`.
--
--   `program_courses` is NOT touched. The Programme -> Course relationship was reviewed
--   and is correct: 243 rows across 8 programmes, unique on (program_id, course_id),
--   with `term_label`/`term_order` for the curriculum position. A programme prescribes
--   courses; an offering schedules one. Those are different facts and stay apart.
--
--   NO `name` COLUMN, deliberately. `classes.name` held "Form 1A"; an offering's label
--   is derived from its course code, section and term. Storing it would be a second
--   place for the same fact to live - the identical argument that keeps `credits` on
--   `courses` and off the offering.
--
--   NO `room` COLUMN, deliberately. Room is per MEETING (`class_meetings.room`): one
--   course legitimately meets in different rooms on different days.
--
-- IDEMPOTENCY
--
--   Re-runnable. Every statement is `IF [NOT] EXISTS` or guarded through
--   information_schema + PREPARE. The destructive section 2 is gated on the
--   PRE-COLLAPSE SENTINEL (`class_subjects` still existing), so a second run - after the
--   demo data has been re-seeded - deletes NOTHING. That gate is the whole reason the
--   deletes are safe to ship inside a migration.
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

-- NO `USE \`sims\`;` HERE, unlike 005-007. This file DELETES data (section 2), and a
-- hardcoded database name means it always hits `sims` no matter which DSN you connected
-- with - you cannot rehearse it on a copy, and pointing DATABASE_URL at a staging
-- database would still wipe production. `apply_sql.py` already selects the database from
-- DATABASE_URL, so honouring the connection is both safer and testable. (005-007 keep
-- theirs; changing them is not this migration's business.)


-- ----------------------------------------------------------------------------
-- 0. THE PRE-COLLAPSE SENTINEL
--
-- `class_subjects` exists only before this file has run. Section 2 keys every delete
-- off it, so the destructive work happens exactly once and a replay is inert.
-- ----------------------------------------------------------------------------
SET @pre_collapse = (
  SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name = 'class_subjects'
);


-- ----------------------------------------------------------------------------
-- 1. `course_offerings` - THE OFFERING
--
-- Identity is (course_id, semester_id, section_code). `active_section` COALESCEs the
-- nullable section to '' before the unique index sees it: without that, two unsectioned
-- offerings of the same course in the same term would BOTH be allowed, because SQL
-- unique indexes do not collide on NULL. It also folds in the soft-delete, so a deleted
-- offering stops blocking its own replacement - the same generated-column trick
-- `classes.active_class_name` and `class_subjects.cs_active_subject` used.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `course_offerings` (
  `id`            uuid        NOT NULL COMMENT 'PK',
  `course_id`     uuid        NOT NULL COMMENT 'FK -> courses. WHAT is taught (credits live there, not here).',
  `semester_id`   uuid        NOT NULL COMMENT 'FK -> semesters. WHEN it is taught. Replaces classes.academic_year_id (D31).',
  `section_code`  varchar(10)     NULL COMMENT 'Parallel sections of one course in one term: 01, 02. NULL = the only section.',
  `capacity`      smallint(6)     NULL COMMENT 'Seats. NULL = uncapped.',
  `is_archived`   tinyint(1)  NOT NULL DEFAULT 0,
  `deleted_at`    datetime        NULL,
  `created_at`    datetime    NOT NULL DEFAULT current_timestamp(),
  `updated_at`    datetime    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`    uuid            NULL,
  `updated_by`    uuid            NULL,
  `active_section` varchar(10) GENERATED ALWAYS AS
      (if(`deleted_at` is null, coalesce(`section_code`, ''), NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_offering_active` (`course_id`, `semester_id`, `active_section`),
  KEY `fk_course_offerings_semester` (`semester_id`),
  KEY `fk_course_offerings_created_by` (`created_by`),
  KEY `fk_course_offerings_updated_by` (`updated_by`),
  CONSTRAINT `fk_course_offerings_course`   FOREIGN KEY (`course_id`)   REFERENCES `courses` (`id`)   ON UPDATE NO ACTION,
  CONSTRAINT `fk_course_offerings_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_course_offerings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_course_offerings_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_course_offerings_capacity` CHECK (`capacity` is null or `capacity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT = 'One course, one semester, one section. Absorbs classes + class_subjects (D31).';


-- ----------------------------------------------------------------------------
-- 2. CLEAR THE HOMEROOM-ERA OPERATIONAL DATA  ⚠️ DESTRUCTIVE ⚠️
--
-- WHY THIS IS A DELETE AND NOT A MIGRATION. Two independent blockers, neither solvable
-- by a query:
--
--   * `classes` is year-scoped and an offering is semester-scoped. One academic year
--     maps to TWO semesters and nothing in the data says which one a homeroom's teaching
--     belonged to. The mapping is 1-to-many, so there is no correct value to compute.
--
--   * `class_enrollments` points at the HOMEROOM, not at a course. A student in Form 1A
--     was implicitly taking all ~7 of its courses, so per-course enrolment would have to
--     be INVENTED by fanning each of the 113 rows out across its courses - manufacturing
--     enrolment records nobody ever made.
--
-- The data being dropped is Form 1A-era demo data (17 homerooms named `Form 1A`/`Form 2A`
-- teaching `Mathematics`, none of it a real BAJC course): 2,888 assessment grades, 904
-- attendance records, 454 assessments, 290 frozen term grades, 237 categories, 118
-- lecturer assignments, 113 enrolments, 43 report cards. `docs/tertiary-refactor-plan.md`
-- §F already recorded this dataset as pre-D29 and wrong. Phase 5 re-seeds it on the
-- tertiary shape.
--
-- The catalog, programmes, curriculum, prerequisites, grading scale, students, staff,
-- users, academic years and semesters are all UNTOUCHED.
--
-- GATED on @pre_collapse so a replay after re-seeding destroys nothing.
-- ----------------------------------------------------------------------------
SET @d1 = IF(@pre_collapse > 0, 'DELETE FROM `assessment_grades`', 'DO 0');
PREPARE p_d1 FROM @d1; EXECUTE p_d1; DEALLOCATE PREPARE p_d1;

SET @d2 = IF(@pre_collapse > 0, 'DELETE FROM `assessments`', 'DO 0');
PREPARE p_d2 FROM @d2; EXECUTE p_d2; DEALLOCATE PREPARE p_d2;

SET @d3 = IF(@pre_collapse > 0, 'DELETE FROM `assessment_categories`', 'DO 0');
PREPARE p_d3 FROM @d3; EXECUTE p_d3; DEALLOCATE PREPARE p_d3;

SET @d4 = IF(@pre_collapse > 0, 'DELETE FROM `attendance_records`', 'DO 0');
PREPARE p_d4 FROM @d4; EXECUTE p_d4; DEALLOCATE PREPARE p_d4;

SET @d5 = IF(@pre_collapse > 0, 'DELETE FROM `class_teachers`', 'DO 0');
PREPARE p_d5 FROM @d5; EXECUTE p_d5; DEALLOCATE PREPARE p_d5;

SET @d6 = IF(@pre_collapse > 0, 'DELETE FROM `class_meetings`', 'DO 0');
PREPARE p_d6 FROM @d6; EXECUTE p_d6; DEALLOCATE PREPARE p_d6;

SET @d7 = IF(@pre_collapse > 0, 'DELETE FROM `class_enrollments`', 'DO 0');
PREPARE p_d7 FROM @d7; EXECUTE p_d7; DEALLOCATE PREPARE p_d7;

SET @d8 = IF(@pre_collapse > 0, 'DELETE FROM `term_grade_snapshots`', 'DO 0');
PREPARE p_d8 FROM @d8; EXECUTE p_d8; DEALLOCATE PREPARE p_d8;

-- Frozen report cards embed the old model in their payload, so they cannot outlive it.
SET @d9 = IF(@pre_collapse > 0, 'DELETE FROM `report_card_snapshots`', 'DO 0');
PREPARE p_d9 FROM @d9; EXECUTE p_d9; DEALLOCATE PREPARE p_d9;

-- Class-scoped announcements (1 live row). DELETED rather than unscoped: setting
-- class_id NULL would silently promote a message written for one class into a
-- school-wide announcement, which is a change of audience, not a change of schema.
SET @d10 = IF(@pre_collapse > 0,
  'DELETE FROM `announcement_reads` WHERE `announcement_id` IN (SELECT `id` FROM `announcements` WHERE `class_id` IS NOT NULL)',
  'DO 0');
PREPARE p_d10 FROM @d10; EXECUTE p_d10; DEALLOCATE PREPARE p_d10;

SET @d11 = IF(@pre_collapse > 0, 'DELETE FROM `announcements` WHERE `class_id` IS NOT NULL', 'DO 0');
PREPARE p_d11 FROM @d11; EXECUTE p_d11; DEALLOCATE PREPARE p_d11;


-- ----------------------------------------------------------------------------
-- 3. RE-POINT THE CHILDREN: class_subject_id / class_id  ->  offering_id
--
-- Each table follows the same five steps, in this order for a reason:
--   drop the FK -> drop any unique index that names the old column -> add the new
--   column -> drop the old column -> add the FK and rebuild the unique index.
--
-- ADD-then-DROP rather than `RENAME COLUMN`, because ADD/DROP has `IF [NOT] EXISTS`
-- forms and RENAME COLUMN does not, so this shape is re-runnable as written. Nothing is
-- copied across because section 2 emptied these tables - on a populated database this
-- file is the wrong tool, which is what the header warning is about.
-- ----------------------------------------------------------------------------

-- 3a. assessments -----------------------------------------------------------
ALTER TABLE `assessments` DROP FOREIGN KEY IF EXISTS `fk_assessments_class_subject`;
ALTER TABLE `assessments` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)' AFTER `id`;
ALTER TABLE `assessments` DROP COLUMN IF EXISTS `class_subject_id`;
ALTER TABLE `assessments` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)';
ALTER TABLE `assessments`
  ADD CONSTRAINT `fk_assessments_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION;

-- 3b. assessment_categories -------------------------------------------------
ALTER TABLE `assessment_categories` DROP FOREIGN KEY IF EXISTS `fk_categories_class_subject`;
ALTER TABLE `assessment_categories` DROP INDEX IF EXISTS `uq_categories_class_subject_name`;
ALTER TABLE `assessment_categories` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)' AFTER `id`;
ALTER TABLE `assessment_categories` DROP COLUMN IF EXISTS `class_subject_id`;
ALTER TABLE `assessment_categories` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)';
ALTER TABLE `assessment_categories`
  ADD CONSTRAINT `fk_categories_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION;
ALTER TABLE `assessment_categories`
  ADD UNIQUE KEY IF NOT EXISTS `uq_categories_offering_name` (`offering_id`, `name`);

-- 3c. class_teachers - the lecturer assignment ------------------------------
ALTER TABLE `class_teachers` DROP FOREIGN KEY IF EXISTS `fk_class_teachers_class_subject`;
ALTER TABLE `class_teachers` DROP INDEX IF EXISTS `uq_class_teachers_class_subject_teacher`;
ALTER TABLE `class_teachers` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)' AFTER `id`;
ALTER TABLE `class_teachers` DROP COLUMN IF EXISTS `class_subject_id`;
ALTER TABLE `class_teachers` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)';
ALTER TABLE `class_teachers`
  ADD CONSTRAINT `fk_class_teachers_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION;
ALTER TABLE `class_teachers`
  ADD UNIQUE KEY IF NOT EXISTS `uq_class_teachers_offering_teacher` (`offering_id`, `teacher_id`);

-- 3d. class_meetings - the weekly timetable ---------------------------------
ALTER TABLE `class_meetings` DROP FOREIGN KEY IF EXISTS `fk_class_meetings_class_subject`;
ALTER TABLE `class_meetings` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)' AFTER `id`;
ALTER TABLE `class_meetings` DROP COLUMN IF EXISTS `class_subject_id`;
ALTER TABLE `class_meetings` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)';
ALTER TABLE `class_meetings`
  ADD CONSTRAINT `fk_class_meetings_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION;

-- 3e. term_grade_snapshots - the frozen term grade --------------------------
-- `subject_id` STAYS: it is the frozen course identity and 006 pointed it at `courses`.
-- `semester_id` STAYS too - denormalisation is correct in a frozen record.
ALTER TABLE `term_grade_snapshots` DROP FOREIGN KEY IF EXISTS `fk_term_snapshot_class_subject`;
ALTER TABLE `term_grade_snapshots` DROP INDEX IF EXISTS `uq_term_snapshot`;
ALTER TABLE `term_grade_snapshots` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)' AFTER `id`;
ALTER TABLE `term_grade_snapshots` DROP COLUMN IF EXISTS `class_subject_id`;
ALTER TABLE `term_grade_snapshots` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_subject_id)';
ALTER TABLE `term_grade_snapshots`
  ADD CONSTRAINT `fk_term_snapshot_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON DELETE NO ACTION;
ALTER TABLE `term_grade_snapshots`
  ADD UNIQUE KEY IF NOT EXISTS `uq_term_snapshot` (`student_id`, `offering_id`, `semester_id`);

-- 3f. class_enrollments - the student registration --------------------------
-- `enroll_active_flag` is generated from `unenrolled_at`, NOT from `class_id`, so it
-- needs no rebuild. Only `uq_enroll_active` names the old column.
ALTER TABLE `class_enrollments` DROP FOREIGN KEY IF EXISTS `fk_enroll_class`;
ALTER TABLE `class_enrollments` DROP INDEX IF EXISTS `uq_enroll_active`;
ALTER TABLE `class_enrollments` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_id, which pointed at a HOMEROOM)' AFTER `id`;
ALTER TABLE `class_enrollments` DROP COLUMN IF EXISTS `class_id`;
ALTER TABLE `class_enrollments` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_id, which pointed at a HOMEROOM)';
ALTER TABLE `class_enrollments`
  ADD CONSTRAINT `fk_enroll_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION;
ALTER TABLE `class_enrollments`
  ADD UNIQUE KEY IF NOT EXISTS `uq_enroll_active`
    (`offering_id`, `student_id`, `semester_id`, `enroll_active_flag`);

-- 3g. attendance_records ----------------------------------------------------
ALTER TABLE `attendance_records` DROP FOREIGN KEY IF EXISTS `fk_attendance_class`;
ALTER TABLE `attendance_records` DROP INDEX IF EXISTS `uq_attendance_class_student_date`;
ALTER TABLE `attendance_records` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings (D31; was class_id)' AFTER `id`;
ALTER TABLE `attendance_records` DROP COLUMN IF EXISTS `class_id`;
ALTER TABLE `attendance_records` MODIFY COLUMN `offering_id` uuid NOT NULL
  COMMENT 'FK -> course_offerings (D31; was class_id)';
ALTER TABLE `attendance_records`
  ADD CONSTRAINT `fk_attendance_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON UPDATE NO ACTION;
ALTER TABLE `attendance_records`
  ADD UNIQUE KEY IF NOT EXISTS `uq_attendance_offering_student_date`
    (`offering_id`, `student_id`, `attendance_date`);

-- 3h. announcements - offering scoping stays OPTIONAL ----------------------
-- Three dependencies on `class_id` here, not one, and the rehearsal on a copy of the
-- database is what found them: a CHECK constraint, a plain index, and the FK. MariaDB
-- refuses `DROP COLUMN` while a CHECK still names the column (1054 "Unknown column
-- 'class_id' in 'CHECK'").
--
-- `ck_announcements_class_audience` is a STAKEHOLDER RULE, not incidental plumbing:
-- `audience = 'class'` must hold if and only if a target is set. It is re-created against
-- `offering_id` with the same semantics - dropping it would let a class-audience
-- announcement exist with no class, which is the bug the constraint exists to prevent.
--
-- The `audience` ENUM keeps its `'class'` member. It is a wire value the ORM, the API and
-- the MSW handlers all share, and D30 decision #3 preserves technical identifiers while
-- renaming display labels - the UI already says "Course offering". Changing the enum is a
-- contract change and belongs with the Phase 3 wire rename, not here.
ALTER TABLE `announcements` DROP CONSTRAINT IF EXISTS `ck_announcements_class_audience`;
ALTER TABLE `announcements` DROP FOREIGN KEY IF EXISTS `fk_announcements_class`;
ALTER TABLE `announcements` DROP INDEX IF EXISTS `ix_announcements_class`;
ALTER TABLE `announcements` ADD COLUMN IF NOT EXISTS `offering_id` uuid NULL
  COMMENT 'FK -> course_offerings; required iff audience=''class''. NULL = school-wide (D31; was class_id).';
ALTER TABLE `announcements` DROP COLUMN IF EXISTS `class_id`;
ALTER TABLE `announcements`
  ADD CONSTRAINT `fk_announcements_offering` FOREIGN KEY IF NOT EXISTS (`offering_id`)
    REFERENCES `course_offerings` (`id`) ON DELETE CASCADE;
ALTER TABLE `announcements` ADD INDEX IF NOT EXISTS `ix_announcements_offering` (`offering_id`);
-- `IF NOT EXISTS` goes AFTER `ADD CONSTRAINT` for a CHECK - the mirror image of the FK
-- rule in 005's syntax note, and 005 §9 already uses this form. Without it a replay dies
-- with 1826 "Duplicate CHECK constraint name", which is how the rehearsal caught it.
ALTER TABLE `announcements`
  ADD CONSTRAINT IF NOT EXISTS `ck_announcements_offering_audience`
    CHECK (`audience` = 'class' = (`offering_id` is not null));


-- ----------------------------------------------------------------------------
-- 4. DROP THE LAST K-12 COLUMN OUTSIDE `classes`
--
-- `student_profiles.year_group` was D29's Form-level ("Form 1"). Every live row is NULL:
-- D30 superseded it with `year_of_study` (First/Second) plus `enrollment_load`
-- (part/full time/transient), which is what the application form actually asks.
-- ----------------------------------------------------------------------------
ALTER TABLE `student_profiles` DROP COLUMN IF EXISTS `year_group`;


-- ----------------------------------------------------------------------------
-- 5. QUARANTINE THE SUPERSEDED TABLES - BY RENAME, NEVER BY DROP
--
-- Same treatment `005` §1 gave the legacy tertiary tables. The rows are the provenance
-- of what replaced them and a rename is reversible; a DROP is not. Nothing references
-- any of these once section 3 has run.
--
--   classes, class_subjects  - superseded by course_offerings
--   subjects                 - superseded by courses in 006 (11 dormant rows)
--   students, staff, grades, cat_assessment - dead since before D29; the ORM maps none
--                              of them and all four are empty
--
-- Guarded twice over: only when the source exists AND the target does not, so a replay
-- neither errors nor clobbers an existing quarantine.
-- ----------------------------------------------------------------------------
SET @r1 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='class_subjects') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='class_subjects_legacy_pre_d31') = 0,
  'RENAME TABLE `class_subjects` TO `class_subjects_legacy_pre_d31`', 'DO 0');
PREPARE p_r1 FROM @r1; EXECUTE p_r1; DEALLOCATE PREPARE p_r1;

SET @r2 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='classes') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='classes_legacy_pre_d31') = 0,
  'RENAME TABLE `classes` TO `classes_legacy_pre_d31`', 'DO 0');
PREPARE p_r2 FROM @r2; EXECUTE p_r2; DEALLOCATE PREPARE p_r2;

SET @r3 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='subjects') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='subjects_legacy_pre_d31') = 0,
  'RENAME TABLE `subjects` TO `subjects_legacy_pre_d31`', 'DO 0');
PREPARE p_r3 FROM @r3; EXECUTE p_r3; DEALLOCATE PREPARE p_r3;

SET @r4 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='students') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='students_legacy_pre_d31') = 0,
  'RENAME TABLE `students` TO `students_legacy_pre_d31`', 'DO 0');
PREPARE p_r4 FROM @r4; EXECUTE p_r4; DEALLOCATE PREPARE p_r4;

SET @r5 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='staff') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='staff_legacy_pre_d31') = 0,
  'RENAME TABLE `staff` TO `staff_legacy_pre_d31`', 'DO 0');
PREPARE p_r5 FROM @r5; EXECUTE p_r5; DEALLOCATE PREPARE p_r5;

SET @r6 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='grades') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='grades_legacy_pre_d31') = 0,
  'RENAME TABLE `grades` TO `grades_legacy_pre_d31`', 'DO 0');
PREPARE p_r6 FROM @r6; EXECUTE p_r6; DEALLOCATE PREPARE p_r6;

SET @r7 = IF(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='cat_assessment') > 0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='cat_assessment_legacy_pre_d31') = 0,
  'RENAME TABLE `cat_assessment` TO `cat_assessment_legacy_pre_d31`', 'DO 0');
PREPARE p_r7 FROM @r7; EXECUTE p_r7; DEALLOCATE PREPARE p_r7;

ALTER TABLE `classes_legacy_pre_d31`
  COMMENT = 'RETIRED by D31 (008) - the K-12 homeroom. Superseded by course_offerings. Kept for provenance.';
ALTER TABLE `class_subjects_legacy_pre_d31`
  COMMENT = 'RETIRED by D31 (008) - the homeroom-to-subject join. Collapsed into course_offerings.course_id.';


SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

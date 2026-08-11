-- ============================================================================
-- 004_subject_class_model.sql
-- Schema side of D29 — the sixth-form SUBJECT-CLASS model (supersedes D23).
--
-- Target engine : MariaDB 12.3.2 (utf8mb4 / utf8mb4_uca1400_ai_ci, case-insensitive)
-- Authored from : backend/app/modules/classes/models.py  (ClassMeeting)
--                 backend/app/modules/students/models.py (StudentProfile.year_group)
--
-- WHAT D29 CHANGED, AND WHY THIS FILE IS SHORT
--   Pre-D29 a `classes` row was a homeroom section teaching many subjects, and a
--   student enrolled in exactly ONE of them. A sixth form works like a university:
--   the principal creates subject classes ("Math-1", "Math-2", "Biology-10") and
--   enrols each student into the ones they take, so Freddy and John can share
--   Biology while sitting in different Math classes.
--
--   That reframe needed almost no DDL. `class_enrollments` was already a plain join
--   table whose `uq_enroll_active` covers (class_id, student_id, semester_id), which
--   always permitted one row per class — the "one homeroom" rule lived in service
--   code (a silent transfer-on-enrol), not in the schema. `attendance_records` is
--   keyed (class_id, student_id, attendance_date), so per-subject-class registers
--   also work unchanged. Only two things are genuinely new:
--
--     1. `class_meetings`            — the weekly day/time/room that builds timetables.
--     2. `student_profiles.year_group` — the student's own level. It used to be read
--        off their homeroom (`classes.grade_level`); with no homeroom, the report-card
--        header and the student-list level column need a home for it.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS. FK checks are
-- disabled around the additions and restored at the end, per 001's convention.
--
-- Postgres -> MariaDB translations applied (same rules as 001):
--   * uuid PK          -> `uuid NOT NULL DEFAULT uuid_v4()` (app still supplies the id)
--   * timestamptz      -> datetime
--   * smallint / time  -> smallint / time (no translation needed)
--   * partial index     -> a plain KEY. The ORM's `ix_class_meetings_class_subject` is
--                          partial (WHERE deleted_at IS NULL) but it is a lookup index,
--                          not a UNIQUE, so the generated-column trick 001 uses for
--                          partial UNIQUEs is unnecessary here — a plain KEY has the
--                          same effect on reads.
-- ============================================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SESSION sql_mode = '';

USE `sims`;


-- ============================================================================
-- class_meetings  (NEW — TimestampMixin + AuditMixin + SoftDeleteMixin)
--
-- Anchored on class_subject_id, NOT class_id: teachers own class_subjects (see
-- class_teachers), so a teacher's timetable is one join off this table, and the rows
-- stay meaningful for any pre-D29 multi-subject class where "when does it meet" is
-- only answerable per subject.
--
-- Times are free-form, not slots in a fixed period grid (stakeholder decision,
-- 2026-08-06), so no bell schedule has to be configured before a class can be
-- scheduled. Overlaps are deliberately NOT rejected: teacher / room / student clashes
-- are reported as warnings by the service, following the warn-only precedent already
-- set for over-capacity enrolment (D-Q6).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `class_meetings` (
  `id`               uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `class_subject_id` uuid NOT NULL COMMENT 'FK -> class_subjects (the subject class that meets)',
  `day_of_week`      smallint(6) NOT NULL COMMENT 'ISO weekday: 1=Mon .. 5=Fri (app.common.enums.DayOfWeek)',
  `start_time`       time NOT NULL,
  `end_time`         time NOT NULL,
  `room`             text NULL COMMENT 'Free text, e.g. "Room A" / "Lab 1"',
  `created_at`       datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at`       datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by`       uuid NULL,
  `updated_by`       uuid NULL,
  `deleted_at`       datetime NULL,
  PRIMARY KEY (`id`),
  KEY `ix_class_meetings_class_subject` (`class_subject_id`),
  KEY `ix_class_meetings_day_start` (`day_of_week`, `start_time`),
  KEY `fk_class_meetings_created_by` (`created_by`),
  KEY `fk_class_meetings_updated_by` (`updated_by`),
  CONSTRAINT `fk_class_meetings_class_subject` FOREIGN KEY (`class_subject_id`)
    REFERENCES `class_subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_class_meetings_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_meetings_updated_by` FOREIGN KEY (`updated_by`)
    REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_class_meetings_day_of_week` CHECK (`day_of_week` between 1 and 5),
  CONSTRAINT `ck_class_meetings_time_order`  CHECK (`end_time` > `start_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ============================================================================
-- student_profiles.year_group  (NEW)
--
-- The student's own level — "Lower 6" / "Upper 6". Free text rather than an enum
-- because the school names its own levels, and an enum would force a migration to
-- rename one. Nullable so existing rows load; the office fills it in.
-- ============================================================================
ALTER TABLE `student_profiles`
  ADD COLUMN IF NOT EXISTS `year_group` text NULL
      COMMENT 'Student level, e.g. Lower 6 / Upper 6 (D29 - was read off the homeroom)'
      AFTER `gender`;


-- ============================================================================
-- Restore session settings.
-- ============================================================================
SET SESSION sql_mode = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

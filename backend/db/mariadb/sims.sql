-- --------------------------------------------------------
-- Host:                         127.0.0.1
-- Server version:               12.3.2-MariaDB - MariaDB Server
-- Server OS:                    Win64
-- HeidiSQL Version:             12.20.0.7320
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


-- Dumping database structure for sims
CREATE DATABASE IF NOT EXISTS `sims` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci */;
USE `sims`;

-- Dumping structure for table sims.academic_years
CREATE TABLE IF NOT EXISTS `academic_years` (
  `yearID` int(11) DEFAULT NULL,
  `id` uuid NOT NULL,
  `name` varchar(100) NOT NULL,
  `YEAR` int(11) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `archived_at` datetime DEFAULT NULL,
  `absent_as_zero` tinyint(1) DEFAULT NULL,
  `allow_makeup` tinyint(1) DEFAULT NULL,
  `drop_lowest_count` smallint(6) DEFAULT NULL,
  `active_flag` varchar(6) GENERATED ALWAYS AS (if(`status` = 'active','active',NULL)) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `uq_academic_years_one_active` (`active_flag`),
  KEY `fk_academic_years_created_by` (`created_by`),
  KEY `fk_academic_years_updated_by` (`updated_by`),
  CONSTRAINT `fk_academic_years_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_academic_years_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_academic_years_dates` CHECK (`end_date` > `start_date`),
  CONSTRAINT `ck_academic_years_drop_nonneg` CHECK (`drop_lowest_count` is null or `drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.announcement_reads
CREATE TABLE IF NOT EXISTS `announcement_reads` (
  `announcement_id` uuid NOT NULL COMMENT 'PK/FK → announcements',
  `user_id` uuid NOT NULL COMMENT 'PK/FK → users',
  `read_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`announcement_id`,`user_id`),
  KEY `ix_announcement_reads_user` (`user_id`),
  CONSTRAINT `fk_announcement_reads_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_announcement_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.announcements
CREATE TABLE IF NOT EXISTS `announcements` (
  `id` uuid NOT NULL COMMENT 'PK',
  `author_id` uuid DEFAULT NULL COMMENT 'FK -> users (display author); nullable per ORM',
  `title` varchar(150) NOT NULL,
  `body` text NOT NULL,
  `audience` enum('all','students','teachers','class') NOT NULL COMMENT 'all / students / teachers / class',
  `class_id` uuid DEFAULT NULL COMMENT 'FK → classes; required iff audience=''class''',
  `published_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT 'Publish date; ordering basis',
  `expires_at` datetime DEFAULT NULL COMMENT 'Optional expiry',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_announcements_author` (`author_id`),
  KEY `fk_announcements_created_by` (`created_by`),
  KEY `fk_announcements_updated_by` (`updated_by`),
  KEY `ix_announcements_class` (`class_id`),
  KEY `ix_announcements_audience` (`audience`),
  KEY `ix_announcements_published` (`published_at`),
  CONSTRAINT `fk_announcements_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_announcements_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_announcements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_announcements_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_announcements_class_audience` CHECK (`audience` = 'class' = (`class_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.assessment_categories
CREATE TABLE IF NOT EXISTS `assessment_categories` (
  `id` uuid NOT NULL COMMENT 'PK',
  `class_subject_id` uuid NOT NULL COMMENT 'FK → class_subjects',
  `name` text NOT NULL COMMENT '''Quizzes'', ''Exams''',
  `weight` decimal(5,2) NOT NULL COMMENT 'Category weight',
  `absent_as_zero` tinyint(1) DEFAULT NULL COMMENT 'Category-level override; NULL = inherit',
  `allow_makeup` tinyint(1) DEFAULT NULL COMMENT 'Category-level override; NULL = inherit',
  `drop_lowest_count` smallint(6) DEFAULT NULL COMMENT 'Category-level override; NULL = inherit',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_class_subject_name` (`class_subject_id`,`name`) USING HASH,
  KEY `fk_categories_class_subject` (`class_subject_id`),
  KEY `fk_assessment_categories_created_by` (`created_by`),
  KEY `fk_assessment_categories_updated_by` (`updated_by`),
  CONSTRAINT `fk_assessment_categories_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessment_categories_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_categories_class_subject` FOREIGN KEY (`class_subject_id`) REFERENCES `class_subjects` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `ck_categories_weight` CHECK (`weight` >= 0),
  CONSTRAINT `ck_categories_drop_nonneg` CHECK (`drop_lowest_count` is null or `drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.assessment_grades
CREATE TABLE IF NOT EXISTS `assessment_grades` (
  `id` uuid NOT NULL COMMENT 'PK',
  `assessment_id` uuid NOT NULL COMMENT 'FK → assessments',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `enrollment_id` uuid NOT NULL COMMENT 'FK → class_enrollments (provenance)',
  `status` enum('pending','graded','absent','excused','exempt') NOT NULL DEFAULT 'pending' COMMENT 'pending / graded / absent / excused / exempt',
  `score` decimal(6,2) DEFAULT NULL COMMENT 'Graded score; NULL unless status=''graded''',
  `makeup_score` decimal(6,2) DEFAULT NULL COMMENT 'Makeup result; substitutes when allow_makeup',
  `is_released` tinyint(1) DEFAULT NULL COMMENT 'Per-row override; NULL = inherit assessment',
  `graded_at` datetime DEFAULT NULL COMMENT 'When score entered (status → graded)',
  `max_score` int(11) DEFAULT NULL COMMENT 'Legacy/extra; not in ORM',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grades_assessment_student` (`assessment_id`,`student_id`),
  KEY `fk_grades_student` (`student_id`),
  KEY `fk_grades_enrollment` (`enrollment_id`),
  KEY `fk_assessment_grades_created_by` (`created_by`),
  KEY `fk_assessment_grades_updated_by` (`updated_by`),
  CONSTRAINT `fk_assessment_grades_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessment_grades_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessment_grades_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_grades_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_grades_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `class_enrollments` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_grades_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `ck_grades_score_when_graded` CHECK (`status` = 'graded' and `score` is not null or `status` <> 'graded' and `score` is null),
  CONSTRAINT `ck_grades_score_nonneg` CHECK (`score` is null or `score` >= 0),
  CONSTRAINT `ck_grades_makeup_nonneg` CHECK (`makeup_score` is null or `makeup_score` >= 0),
  CONSTRAINT `chk_score_limit` CHECK (`score` <= `max_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.assessment_policies
CREATE TABLE IF NOT EXISTS `assessment_policies` (
  `id` smallint(6) NOT NULL DEFAULT 1 COMMENT 'PK, pinned to 1 (single-row guard)',
  `absent_as_zero` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'School default',
  `allow_makeup` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'School default',
  `drop_lowest_count` smallint(6) NOT NULL DEFAULT 0 COMMENT 'School default; drop none',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_assessment_policies_created_by` (`created_by`),
  KEY `fk_assessment_policies_updated_by` (`updated_by`),
  CONSTRAINT `fk_assessment_policies_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessment_policies_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_assessment_policies_singleton` CHECK (`id` = 1),
  CONSTRAINT `ck_assessment_policies_drop_nonneg` CHECK (`drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.assessments
CREATE TABLE IF NOT EXISTS `assessments` (
  `id` uuid NOT NULL COMMENT 'PK',
  `class_subject_id` uuid NOT NULL COMMENT 'FK → class_subjects',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters',
  `category_id` uuid DEFAULT NULL COMMENT 'FK → assessment_categories (optional)',
  `title` varchar(150) NOT NULL,
  `type` enum('quiz','test','exam','assignment') NOT NULL,
  `max_score` decimal(6,2) NOT NULL,
  `weight` decimal(5,2) NOT NULL DEFAULT 1.00,
  `assessment_date` date DEFAULT NULL,
  `status` enum('draft','published','grading','graded') NOT NULL DEFAULT 'draft',
  `is_released` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Grade-release gate (assessment-level)',
  `released_at` datetime DEFAULT NULL,
  `absent_as_zero` tinyint(1) DEFAULT NULL COMMENT 'Per-assessment override (highest precedence)',
  `allow_makeup` tinyint(1) DEFAULT NULL COMMENT 'Per-assessment override; NULL = inherit',
  `drop_lowest_count` smallint(6) DEFAULT NULL COMMENT 'Per-assessment override; NULL = inherit',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_assessments_class_subject` (`class_subject_id`),
  KEY `fk_assessments_semester` (`semester_id`),
  KEY `fk_assessments_category` (`category_id`),
  KEY `fk_assessments_created_by` (`created_by`),
  KEY `fk_assessments_updated_by` (`updated_by`),
  KEY `ix_assessments_class_subject_semester` (`class_subject_id`,`semester_id`),
  CONSTRAINT `fk_assessments_category` FOREIGN KEY (`category_id`) REFERENCES `assessment_categories` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessments_class_subject` FOREIGN KEY (`class_subject_id`) REFERENCES `class_subjects` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assessments_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_assessments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_assessments_maxscore` CHECK (`max_score` > 0),
  CONSTRAINT `ck_assessments_weight` CHECK (`weight` >= 0),
  CONSTRAINT `ck_assessments_drop_nonneg` CHECK (`drop_lowest_count` is null or `drop_lowest_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.attendance_records
CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` uuid NOT NULL COMMENT 'PK',
  `class_id` uuid NOT NULL COMMENT 'FK → classes (the section)',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `enrollment_id` uuid NOT NULL COMMENT 'FK → class_enrollments (section provenance)',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters (summary scoping)',
  `attendance_date` date NOT NULL COMMENT 'The day',
  `status` enum('present','absent','late','excused') NOT NULL DEFAULT 'present' COMMENT 'present / absent / late / excused',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_class_student_date` (`class_id`,`student_id`,`attendance_date`),
  KEY `fk_attendance_enrollment` (`enrollment_id`),
  KEY `fk_attendance_semester` (`semester_id`),
  KEY `fk_attendance_created_by` (`created_by`),
  KEY `fk_attendance_updated_by` (`updated_by`),
  KEY `ix_attendance_class_date` (`class_id`,`attendance_date`),
  KEY `ix_attendance_student_semester` (`student_id`,`semester_id`),
  CONSTRAINT `fk_attendance_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_attendance_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `class_enrollments` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_attendance_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.audit_log
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `actor_user_id` uuid DEFAULT NULL COMMENT 'FK → users (who)',
  `action` varchar(50) NOT NULL COMMENT 'e.g. ''grade.update'', ''student.deactivate',
  `entity_type` varchar(50) NOT NULL COMMENT '''assessment_grade'', ''student_profile''',
  `entity_id` uuid DEFAULT NULL COMMENT 'Affected row',
  `summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Small before/after or context blob',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`) USING BTREE,
  KEY `k_audit_actor` (`actor_user_id`),
  CONSTRAINT `k_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `summary` CHECK (json_valid(`summary`))
) ENGINE=InnoDB AUTO_INCREMENT=3450 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.cat_assessment
CREATE TABLE IF NOT EXISTS `cat_assessment` (
  `assessmentID` int(11) NOT NULL AUTO_INCREMENT,
  `assessmentName` varchar(25) NOT NULL,
  `percentage` int(11) NOT NULL,
  PRIMARY KEY (`assessmentID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.class_enrollments
CREATE TABLE IF NOT EXISTS `class_enrollments` (
  `id` uuid NOT NULL COMMENT 'PK',
  `class_id` uuid NOT NULL COMMENT 'FK → classes (the section)',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters (term scoping)',
  `enrolled_at` datetime NOT NULL DEFAULT current_timestamp(),
  `unenrolled_at` datetime DEFAULT NULL COMMENT 'Non-null = removed (kept for history)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `enroll_active_flag` tinyint(1) GENERATED ALWAYS AS (if(`unenrolled_at` is null,1,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enroll_active` (`class_id`,`student_id`,`semester_id`,`enroll_active_flag`),
  KEY `fk_enroll_student` (`student_id`),
  KEY `fk_enroll_semester` (`semester_id`),
  KEY `fk_class_enrollments_created_by` (`created_by`),
  KEY `fk_class_enrollments_updated_by` (`updated_by`),
  CONSTRAINT `fk_class_enrollments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_enrollments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_enroll_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_enroll_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.class_subjects
CREATE TABLE IF NOT EXISTS `class_subjects` (
  `id` uuid NOT NULL COMMENT 'PK (surrogate)',
  `class_id` uuid NOT NULL COMMENT 'FK → classes (the section)',
  `subject_id` uuid NOT NULL COMMENT 'FK → subjects',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Offering can be retired without dropping history',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `cs_active_subject` uuid GENERATED ALWAYS AS (if(`deleted_at` is null,`subject_id`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class_subjects_class_subject` (`class_id`,`cs_active_subject`),
  KEY `fk_class_subjects_subject` (`subject_id`),
  KEY `fk_class_subjects_created_by` (`created_by`),
  KEY `fk_class_subjects_updated_by` (`updated_by`),
  CONSTRAINT `fk_class_subjects_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_subjects_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_subjects_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_subjects_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.class_teachers
CREATE TABLE IF NOT EXISTS `class_teachers` (
  `id` uuid NOT NULL COMMENT 'PK',
  `class_subject_id` uuid NOT NULL COMMENT 'FK → class_subjects',
  `teacher_id` uuid NOT NULL COMMENT 'FK → teacher_profiles',
  `is_lead` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Display marker only; does not affect edit rights',
  `assigned_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class_teachers_class_subject_teacher` (`class_subject_id`,`teacher_id`),
  KEY `fk_class_teachers_teacher` (`teacher_id`),
  KEY `fk_class_teachers_created_by` (`created_by`),
  KEY `fk_class_teachers_updated_by` (`updated_by`),
  CONSTRAINT `fk_class_teachers_class_subject` FOREIGN KEY (`class_subject_id`) REFERENCES `class_subjects` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_teachers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_class_teachers_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teacher_profiles` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `fk_class_teachers_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.classes
CREATE TABLE IF NOT EXISTS `classes` (
  `id` uuid NOT NULL,
  `academic_year_id` uuid NOT NULL,
  `name` varchar(150) NOT NULL,
  `grade_level` varchar(50) NOT NULL DEFAULT '0',
  `section` varchar(2) DEFAULT '0',
  `capacity` smallint(6) DEFAULT NULL,
  `is_archived` tinyint(1) DEFAULT 0,
  `classStaffID` int(11) DEFAULT NULL,
  `numStudents` int(11) NOT NULL DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `homeroom_label` varchar(150) DEFAULT NULL COMMENT 'Frontend DemoSection.homeroom_label',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `active_class_name` varchar(150) GENERATED ALWAYS AS (if(`deleted_at` is null,`name`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_classes_year_name` (`academic_year_id`,`active_class_name`),
  KEY `classStaffID` (`classStaffID`) USING BTREE,
  KEY `fk_classes_created_by` (`created_by`),
  KEY `fk_classes_updated_by` (`updated_by`),
  CONSTRAINT `fk_classes_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_classes_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_classes_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`),
  CONSTRAINT `ck_classes_capacity` CHECK (`capacity` is null or `capacity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.events
CREATE TABLE IF NOT EXISTS `events` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `title` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `category` enum('holiday','exam','meeting','activity','other') NOT NULL DEFAULT 'other',
  `visibility` enum('global','internal') NOT NULL DEFAULT 'global' COMMENT 'global = everyone; internal = staff only',
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL COMMENT 'NULL = single-day event',
  `all_day` tinyint(1) NOT NULL DEFAULT 1,
  `start_time` time DEFAULT NULL COMMENT 'HH:mm; only when all_day = 0',
  `end_time` time DEFAULT NULL,
  `location` varchar(200) DEFAULT NULL,
  `created_by_user_id` uuid NOT NULL COMMENT 'FK -> users (author)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_events_start_date` (`start_date`),
  KEY `ix_events_date_range` (`start_date`,`end_date`),
  KEY `fk_events_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_events_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_events_dates` CHECK (`end_date` is null or `end_date` >= `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.grades
CREATE TABLE IF NOT EXISTS `grades` (
  `gradeID` int(11) NOT NULL AUTO_INCREMENT,
  `academicYearID` int(11) DEFAULT NULL,
  `classID` int(11) DEFAULT NULL,
  `subjectID` int(11) DEFAULT NULL,
  `staffID` int(11) DEFAULT NULL,
  `grade` int(11) DEFAULT NULL,
  `assessmentTypeID` int(11) DEFAULT NULL,
  `honour` varchar(20) DEFAULT NULL,
  `dateCreated` date NOT NULL,
  `createdBy` varchar(20) NOT NULL,
  `editBy` varchar(20) NOT NULL,
  `dateEdited` date NOT NULL,
  PRIMARY KEY (`gradeID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.grading_scale_bands
CREATE TABLE IF NOT EXISTS `grading_scale_bands` (
  `id` uuid NOT NULL COMMENT 'PK',
  `grading_scale_id` uuid NOT NULL COMMENT 'FK → grading_scales',
  `letter` char(2) NOT NULL COMMENT '''A'', ''B'', …',
  `min_score` decimal(5,2) NOT NULL DEFAULT 0.00 COMMENT 'Inclusive lower bound',
  `max_score` decimal(5,2) NOT NULL DEFAULT 100.00 COMMENT 'Inclusive upper bound',
  `is_passing` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Convenience flag',
  `sort_order` smallint(6) NOT NULL COMMENT 'Display order',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bands_scale_letter` (`grading_scale_id`,`letter`),
  CONSTRAINT `fk_bands_scale` FOREIGN KEY (`grading_scale_id`) REFERENCES `grading_scales` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `ck_bands_range` CHECK (`min_score` >= 0 and `max_score` <= 100 and `min_score` <= `max_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.grading_scales
CREATE TABLE IF NOT EXISTS `grading_scales` (
  `id` uuid NOT NULL COMMENT 'PK',
  `academic_year_id` uuid NOT NULL COMMENT 'FK → academic_years (1:1)',
  `pass_mark` decimal(5,2) NOT NULL DEFAULT 60.00 COMMENT 'Pass/fail boundary',
  `is_frozen` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Set true when the year archives',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grading_scales_year` (`academic_year_id`),
  KEY `fk_grading_scales_created_by` (`created_by`),
  KEY `fk_grading_scales_updated_by` (`updated_by`),
  CONSTRAINT `fk_grading_scales_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_grading_scales_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_grading_scales_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `ck_grading_scales_passmark` CHECK (`pass_mark` between 0 and 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.login_attempts
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id` uuid NOT NULL COMMENT 'PK',
  `email_attempted` varchar(255) NOT NULL COMMENT 'What was tried (non-enumerating)',
  `user_id` uuid DEFAULT NULL COMMENT 'FK → users if resolved',
  `succeeded` tinyint(1) NOT NULL,
  `ip_address` inet6 DEFAULT NULL,
  `attempted_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_login_attempts_user` (`user_id`),
  CONSTRAINT `fk_login_attempts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.password_reset_tokens
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` uuid NOT NULL COMMENT 'PK',
  `user_id` uuid NOT NULL COMMENT 'FK → users',
  `token_hash` text NOT NULL COMMENT 'SHA-256 of the one-time token',
  `expires_at` datetime NOT NULL COMMENT 'Short-lived',
  `used_at` datetime DEFAULT NULL COMMENT 'Non-null = consumed (single-use)',
  `created_by` uuid DEFAULT NULL COMMENT 'The admin who initiated',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pwreset_token_hash` (`token_hash`) USING HASH,
  KEY `fk_pwreset_user` (`user_id`),
  KEY `fk_pwreset_creator` (`created_by`),
  CONSTRAINT `fk_pwreset_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_pwreset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.refresh_sessions
CREATE TABLE IF NOT EXISTS `refresh_sessions` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK; also the token''s jti',
  `user_id` uuid NOT NULL COMMENT 'FK → users',
  `token_hash` varchar(64) NOT NULL COMMENT 'SHA-256 hex of the refresh token (64 chars)',
  `issued_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_used_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL COMMENT 'Absolute expiry (~7 days)',
  `is_revoked` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Logout/reset/lockout sets true',
  `revoked_at` datetime DEFAULT NULL,
  `user_agent` text DEFAULT NULL COMMENT 'Diagnostic',
  `ip_address` inet6 DEFAULT NULL COMMENT 'Diagnostic (inet type)',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_sessions_token_hash` (`token_hash`),
  KEY `fk_refresh_sessions_user` (`user_id`),
  CONSTRAINT `fk_refresh_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.report_card_snapshots
CREATE TABLE IF NOT EXISTS `report_card_snapshots` (
  `id` uuid NOT NULL COMMENT 'PK',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters',
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Fully-rendered report card' CHECK (json_valid(`payload`)),
  `storage_key` text DEFAULT NULL COMMENT 'Optional pointer to a generated PDF',
  `frozen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_card_snapshot` (`student_id`,`semester_id`),
  KEY `fk_report_card_semester` (`semester_id`),
  CONSTRAINT `fk_report_card_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_report_card_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.school_profile
CREATE TABLE IF NOT EXISTS `school_profile` (
  `id` smallint(6) NOT NULL DEFAULT 1,
  `name` varchar(150) NOT NULL,
  `logo_storage_key` varchar(200) DEFAULT NULL,
  `address` varchar(100) DEFAULT NULL,
  `contact_email` varchar(254) DEFAULT NULL,
  `contact_phone` varchar(100) DEFAULT NULL,
  `color_primary` varchar(9) DEFAULT NULL COMMENT 'Brand primary color (hex), DemoSchoolProfile.colors.primary',
  `color_secondary` varchar(9) DEFAULT NULL COMMENT 'Brand secondary color (hex), DemoSchoolProfile.colors.secondary',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_school_profile_created_by` (`created_by`),
  KEY `fk_school_profile_updated_by` (`updated_by`),
  CONSTRAINT `fk_school_profile_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_school_profile_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_school_profile_singleton` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.semesters
CREATE TABLE IF NOT EXISTS `semesters` (
  `id` uuid NOT NULL COMMENT 'PK',
  `academic_year_id` uuid NOT NULL COMMENT 'FK → academic_years',
  `name` varchar(200) NOT NULL COMMENT 'e.g. ''Fall'', ''Spring''',
  `sequence` smallint(6) NOT NULL COMMENT '1 or 2',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Exactly one true globally',
  `active_unique_helper` int(11) GENERATED ALWAYS AS (if(`is_active` = 1,1,NULL)) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_semesters_year_seq` (`academic_year_id`,`sequence`),
  UNIQUE KEY `uq_semesters_one_active` (`active_unique_helper`),
  CONSTRAINT `fk_semesters_year` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON UPDATE NO ACTION,
  CONSTRAINT `ck_semesters_sequence` CHECK (`sequence` in (1,2)),
  CONSTRAINT `ck_semesters_dates` CHECK (`end_date` > `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.staff
CREATE TABLE IF NOT EXISTS `staff` (
  `staffID` int(11) NOT NULL,
  `firstname` varchar(50) NOT NULL,
  `middlename` varchar(50) DEFAULT NULL,
  `lastname` varchar(50) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `sex` varchar(6) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `positionID` int(11) NOT NULL,
  `maritalID` int(11) DEFAULT NULL,
  `dateJoined` date DEFAULT NULL,
  `dateCreated` date NOT NULL,
  `createdBy` varchar(20) NOT NULL,
  `editBy` varchar(20) NOT NULL,
  `dateEdited` date NOT NULL,
  PRIMARY KEY (`staffID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.student_documents
CREATE TABLE IF NOT EXISTS `student_documents` (
  `id` uuid NOT NULL COMMENT 'PK',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `file_name` varchar(50) NOT NULL COMMENT 'Original name',
  `storage_key` varchar(150) NOT NULL COMMENT 'Object-storage path/key',
  `content_type` text DEFAULT NULL COMMENT 'MIME',
  `size_bytes` bigint(20) DEFAULT NULL,
  `document_type` varchar(100) DEFAULT NULL COMMENT 'e.g. ''birth_certificate',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_documents_key` (`storage_key`),
  KEY `fk_student_documents_student` (`student_id`),
  KEY `fk_student_documents_created_by` (`created_by`),
  KEY `fk_student_documents_updated_by` (`updated_by`),
  CONSTRAINT `fk_student_documents_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_documents_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_student_documents_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.student_profiles
CREATE TABLE IF NOT EXISTS `student_profiles` (
  `id` uuid NOT NULL COMMENT 'PK (surrogate)',
  `user_id` uuid DEFAULT NULL COMMENT 'FK -> users; the login this student is (nullable)',
  `student_number` text NOT NULL COMMENT 'Human student ID e.g. ''S1012'' (unique)',
  `full_name` text NOT NULL,
  `date_of_birth` date NOT NULL,
  `gender` varchar(25) DEFAULT NULL COMMENT 'Free/lookup text; not a fixed enum',
  `enrollment_date` date NOT NULL,
  `status` enum('active','inactive','transferred','graduated','withdrawn') NOT NULL DEFAULT 'active' COMMENT 'active/inactive/transferred/graduated/withdrawn',
  `guardian_name` text DEFAULT NULL COMMENT 'Parent/guardian contact',
  `guardian_phone` text DEFAULT NULL,
  `guardian_email` varchar(254) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `phone` text DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `is_active_number` varchar(50) GENERATED ALWAYS AS (if(`deleted_at` is null,`student_number`,NULL)) VIRTUAL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_profiles_user` (`user_id`),
  UNIQUE KEY `uq_student_profiles_number` (`is_active_number`),
  KEY `fk_student_profiles_created_by` (`created_by`),
  KEY `fk_student_profiles_updated_by` (`updated_by`),
  CONSTRAINT `fk_student_profiles_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_profiles_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_student_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.students
CREATE TABLE IF NOT EXISTS `students` (
  `studentID` varchar(9) NOT NULL,
  `firstname` varchar(50) NOT NULL,
  `middlename` varchar(50) DEFAULT NULL,
  `lastname` varchar(50) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `sex` varchar(6) NOT NULL DEFAULT '0',
  `dob` date NOT NULL,
  `address` varchar(150) NOT NULL,
  `districtID` int(11) NOT NULL,
  `guardianID` int(11) NOT NULL,
  `dateEnrolled` date NOT NULL,
  `dateCreated` date NOT NULL,
  `createdBy` varchar(20) NOT NULL,
  `editBy` varchar(20) NOT NULL,
  `dateEdited` date NOT NULL,
  PRIMARY KEY (`studentID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.subjects
CREATE TABLE IF NOT EXISTS `subjects` (
  `id` uuid NOT NULL,
  `name` varchar(70) NOT NULL,
  `code` varchar(70) DEFAULT NULL,
  `category` varchar(20) DEFAULT NULL,
  `elective` bit(1) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `unique_code` varchar(255) GENERATED ALWAYS AS (if(`deleted_at` is null,`code`,NULL)) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `active_name` varchar(70) GENERATED ALWAYS AS (if(`deleted_at` is null,`name`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subjects_code` (`unique_code`),
  UNIQUE KEY `uq_subjects_name` (`active_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.teacher_profiles
CREATE TABLE IF NOT EXISTS `teacher_profiles` (
  `id` uuid NOT NULL COMMENT 'PK',
  `user_id` uuid DEFAULT NULL COMMENT 'FK → users; the login this teacher is',
  `staff_number` text NOT NULL COMMENT 'Human staff ID (unique)',
  `full_name` varchar(250) NOT NULL,
  `email` varchar(254) DEFAULT NULL COMMENT 'Contact; login email lives on users',
  `phone` text DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL COMMENT 'active / inactive',
  `subject_specializations` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Postgres array of subject labels (GIN-indexed)' CHECK (json_valid(`subject_specializations`)),
  `deleted_at` datetime DEFAULT NULL,
  `is_active` int(11) GENERATED ALWAYS AS (if(`deleted_at` is null,1,NULL)) VIRTUAL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `avatar_url` varchar(500) DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `gender` enum('male','female','other') DEFAULT NULL,
  `education` varchar(255) DEFAULT NULL,
  `designation` varchar(150) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `expertise` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'JSON array of {area, level} (DemoTeacher.expertise)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_teacher_profiles_user` (`user_id`),
  UNIQUE KEY `uq_teacher_profiles_number` (`staff_number`,`is_active`) USING HASH,
  KEY `fk_teacher_profiles_user` (`user_id`),
  KEY `fk_teacher_profiles_created_by` (`created_by`),
  KEY `fk_teacher_profiles_updated_by` (`updated_by`),
  CONSTRAINT `fk_teacher_profiles_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_teacher_profiles_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_teacher_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `ck_teacher_profiles_expertise_json` CHECK (`expertise` is null or json_valid(`expertise`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.term_grade_snapshots
CREATE TABLE IF NOT EXISTS `term_grade_snapshots` (
  `id` uuid NOT NULL COMMENT 'PK',
  `student_id` uuid NOT NULL COMMENT 'FK → student_profiles',
  `class_subject_id` uuid NOT NULL COMMENT 'FK → class_subjects',
  `semester_id` uuid NOT NULL COMMENT 'FK → semesters',
  `subject_id` uuid NOT NULL COMMENT 'FK → subjects (frozen subject identity)',
  `numeric_grade` decimal(6,2) NOT NULL COMMENT 'Frozen weighted term grade',
  `letter_grade` varchar(15) NOT NULL COMMENT 'Frozen derived letter (scale at freeze)',
  `weight_base_used` decimal(6,2) DEFAULT NULL COMMENT 'Denominator after exempt/excused/pending removal',
  `effective_policy` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Resolved grading policy in force at freeze' CHECK (json_valid(`effective_policy`)),
  `frozen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_term_snapshot` (`student_id`,`class_subject_id`,`semester_id`),
  KEY `fk_term_snapshot_class_subject` (`class_subject_id`),
  KEY `fk_term_snapshot_semester` (`semester_id`),
  KEY `fk_term_snapshot_subject` (`subject_id`),
  KEY `ix_term_snapshot_student` (`student_id`),
  CONSTRAINT `fk_term_snapshot_class_subject` FOREIGN KEY (`class_subject_id`) REFERENCES `class_subjects` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_term_snapshot_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_term_snapshot_student` FOREIGN KEY (`student_id`) REFERENCES `student_profiles` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `fk_term_snapshot_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.user_preferences
CREATE TABLE IF NOT EXISTS `user_preferences` (
  `user_id` uuid NOT NULL COMMENT 'PK and FK → users',
  `locale` text NOT NULL DEFAULT 'en' COMMENT 'locale code',
  `theme` text NOT NULL DEFAULT 'light' COMMENT 'v1 light only; column ready for dark',
  `date_format` text DEFAULT NULL COMMENT 'Optional override',
  `default_page_size` smallint(6) NOT NULL DEFAULT 25 COMMENT 'List density preference',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_preferences_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `ck_user_preferences_page_size` CHECK (`default_page_size` between 5 and 200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Data exporting was unselected.

-- Dumping structure for table sims.users
CREATE TABLE IF NOT EXISTS `users` (
  `id` uuid NOT NULL DEFAULT uuid_v4() COMMENT 'PK',
  `email` varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Login identifier; case-insensitive unique',
  `username` varchar(100) DEFAULT NULL COMMENT 'Optional alternate login',
  `password_hash` text NOT NULL COMMENT 'Argon2id hash only; never plaintext',
  `role` enum('principal','secretary','teacher','student') NOT NULL COMMENT 'principal / secretary / teacher / student',
  `full_name` varchar(200) NOT NULL COMMENT 'Display name',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Disabled accounts cannot log in',
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Forces change on first login / admin reset',
  `failed_login_count` smallint(6) NOT NULL DEFAULT 0 COMMENT 'Brute-force throttle',
  `locked_until` datetime DEFAULT NULL COMMENT 'Non-null = temporarily locked',
  `last_login_at` datetime DEFAULT NULL COMMENT 'informational',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `active_username` varchar(255) GENERATED ALWAYS AS (if(`deleted_at` is null,`username`,NULL)) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` uuid DEFAULT NULL,
  `updated_by` uuid DEFAULT NULL,
  `active_email` varchar(254) GENERATED ALWAYS AS (if(`deleted_at` is null,`email`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`active_username`) USING BTREE,
  UNIQUE KEY `uq_users_email` (`active_email`),
  KEY `fk_users_created_by` (`created_by`),
  KEY `fk_users_updated_by` (`updated_by`),
  CONSTRAINT `fk_users_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_users_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_users_failed_login_nonneg` CHECK (`failed_login_count` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='Authentication principal. One role per user. Principal/Secretary are admin accounts; Teacher/Student users link 1:1 to a profile row.';

-- Data exporting was unselected.

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
